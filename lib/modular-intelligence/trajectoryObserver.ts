import { createHash } from 'node:crypto'
import type { ToolExperienceFields } from './types'
import type { TrajectorySourceType } from './trajectorySourceTypes'

export type { TrajectorySourceType } from './trajectorySourceTypes'
export { SOURCE_TYPES } from './trajectorySourceTypes'

/**
 * Observational tool-trajectory capture for curriculum candidacy.
 *
 * Passive: does not execute tools, does not train, does not promote gold,
 * does not write to production.
 *
 * Extra fields ride on existing AGIExperienceRecord.model_target via
 * toExperienceCapture when a caller later chooses to persist references.
 */

export const REVIEW_STATES = [
  'RAW',
  'NORMALIZED',
  'VERIFIED',
  'CURRICULUM_CANDIDATE',
  'EVAL_CANDIDATE',
  'REJECTED',
] as const

export type ReviewState = (typeof REVIEW_STATES)[number]

export const RESULT_BOUND_CHARS = 2048

const SECRET_KEY_RE = /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?token|session|private[_-]?key|x-api-key)$/i

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}/gi },
  { name: 'sk_live', re: /\bsk_(live|test)_[A-Za-z0-9]{8,}/g },
  { name: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g },
  { name: 'env_assign', re: /\b(API_KEY|SECRET|PASSWORD|TOKEN|COOKIE|AUTHORIZATION)\s*=\s*[^\s]+/gi },
  { name: 'signed_url', re: /([?&](?:signature|X-Amz-Signature|token|access_token|key)=)[^&\s]+/gi },
]

export function sanitizeTrajectoryText(value: string): { text: string; redacted: string[] } {
  let text = value
  const redacted: string[] = []
  for (const { name, re } of SECRET_PATTERNS) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
    const next = text.replace(new RegExp(re.source, flags), (match) => {
      if (name === 'signed_url') {
        const prefix = /([?&](?:signature|X-Amz-Signature|token|access_token|key)=)/i.exec(match)?.[1] ?? ''
        return `${prefix}[REDACTED:${name}]`
      }
      return `[REDACTED:${name}]`
    })
    if (next !== text) redacted.push(name)
    text = next
  }
  return { text, redacted }
}

export function sanitizeTrajectoryValue(value: unknown, redacted: string[] = []): unknown {
  if (typeof value === 'string') {
    const s = sanitizeTrajectoryText(value)
    redacted.push(...s.redacted)
    return s.text
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTrajectoryValue(item, redacted))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = '[REDACTED:secret_key]'
        redacted.push('secret_key')
        continue
      }
      out[key] = sanitizeTrajectoryValue(nested, redacted)
    }
    return out
  }
  return value
}

export function boundTrajectoryJson(value: unknown, maxChars = RESULT_BOUND_CHARS): {
  value: unknown
  bounded: boolean
  original_chars: number
  content_sha256: string
} {
  const json = JSON.stringify(value ?? null) ?? 'null'
  const hash = createHash('sha256').update(json).digest('hex')
  if (json.length <= maxChars) {
    return { value, bounded: false, original_chars: json.length, content_sha256: hash }
  }
  return {
    value: {
      bounded: true,
      preview: json.slice(0, maxChars),
      original_chars: json.length,
      content_sha256: hash,
    },
    bounded: true,
    original_chars: json.length,
    content_sha256: hash,
  }
}

export type ObservationalTrajectory = {
  review_state: 'RAW'
  auto_train: false
  auto_promote: false
  auto_curriculum: false
  auto_verified: false
  request: string
  decision: ToolExperienceFields['decision']
  selected_tool: string | null
  arguments: Record<string, string>
  tool_result: unknown
  success: boolean
  correction: string | null
  provenance: Record<string, string>
  capability_family: string
  composedRuntimeId?: string
  timestamp: string
  secrets_redacted: string[]
  result_bounded?: boolean
  result_content_sha256?: string
}

export function observeToolExperience(
  experience: ToolExperienceFields,
  extras?: { composedRuntimeId?: string; timestamp?: string },
): ObservationalTrajectory {
  const redacted: string[] = []
  const request = String(sanitizeTrajectoryValue(experience.request, redacted) ?? '')
  const corr = experience.correction
    ? String(sanitizeTrajectoryValue(experience.correction, redacted) ?? '')
    : null
  const argsRaw = sanitizeTrajectoryValue(experience.arguments, redacted)
  const argumentsSafe =
    argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
      ? Object.fromEntries(
          Object.entries(argsRaw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
        )
      : {}
  const sanitizedResult = sanitizeTrajectoryValue(experience.tool_result, redacted)
  const bounded = boundTrajectoryJson(sanitizedResult)
  return {
    review_state: 'RAW',
    auto_train: false,
    auto_promote: false,
    auto_curriculum: false,
    auto_verified: false,
    request,
    decision: experience.decision,
    selected_tool: experience.selected_tool,
    arguments: argumentsSafe,
    tool_result: bounded.value,
    success: experience.success,
    correction: corr,
    provenance: { ...experience.provenance, capture: 'observational' },
    capability_family: experience.capability_family,
    composedRuntimeId: extras?.composedRuntimeId,
    timestamp: extras?.timestamp ?? new Date().toISOString(),
    secrets_redacted: [...new Set(redacted)],
    result_bounded: bounded.bounded,
    result_content_sha256: bounded.content_sha256,
  }
}

export function trajectoryIdFor(parts: {
  request: string
  decision: string
  tool: string | null
  arguments: Record<string, string>
  timestamp: string
}): string {
  const canonical = JSON.stringify({
    request: parts.request,
    decision: parts.decision,
    tool: parts.tool,
    arguments: parts.arguments,
    timestamp: parts.timestamp,
  })
  return `wrtj_${createHash('sha256').update(canonical).digest('hex').slice(0, 20)}`
}

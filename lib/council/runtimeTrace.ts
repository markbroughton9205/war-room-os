export type CouncilTraceStageName =
  | 'trace_error'
  | 'request_received'
  | 'command_parsed'
  | 'current_intent_resolved'
  | 'active_scope_built'
  | 'topic_scope_built'
  | 'mode_governor_resolved'
  | 'research_planned'
  | 'providers_selected'
  | 'provider_calls_started'
  | 'provider_responses_received'
  | 'integrity_checked'
  | 'red_team_checked'
  | 'scope_guardian_checked'
  | 'final_moderated'
  | 'council_report_built'
  | 'memory_recommendation_recorded'

export type CouncilTraceObservationMode = 'runtime_observed' | 'inferred'

export type CouncilTraceStage = {
  stage: CouncilTraceStageName
  module: string
  inputSummary: unknown
  outputSummary: unknown
  stateChange: string
  timestamp: string
  missionVersion: number
  observation: CouncilTraceObservationMode
}

export type CouncilRuntimeTraceSnapshot = {
  councilTraceId: string
  missionId: string
  missionVersion: number
  finalReportId: string
  sessionId: string | null
  providerResponseIds: Record<string, string[]>
  stages: CouncilTraceStage[]
  redaction: {
    applied: boolean
    policy: string
  }
  createdAt: string
  completedAt: string
}

export type CouncilRuntimeTrace = {
  enabled: boolean
  readonly councilTraceId: string
  readonly missionId: string
  readonly missionVersion: number
  readonly finalReportId: string
  record(stage: CouncilTraceStageName, detail: {
    module: string
    inputSummary?: unknown
    outputSummary?: unknown
    stateChange: string
    observation?: CouncilTraceObservationMode
  }): void
  registerProviderResponse(family: string): string
  snapshot(): CouncilRuntimeTraceSnapshot | undefined
}

export type CouncilTraceValidationResult = {
  ok: boolean
  errors: string[]
}

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|cookie|token|secret|service[_-]?role|password|refresh[_-]?token|access[_-]?token|recovery|invitation)/i
// fc- has a negative lookbehind because 'f' and 'c' are both valid
// hexadecimal digits: a random UUID naturally produces the literal
// substring "fc-" at a hex-group boundary roughly 1 in 20 times (always
// preceded by another hex digit, since UUID groups are 4+ chars), which
// previously caused legitimate values (e.g. a responseId embedding a UUID)
// to be falsely redacted. A length floor does not fix this -- the rest of
// a UUID/identifier easily supplies 20+ further matching characters. The
// lookbehind requires "fc-" to start a token (preceded by nothing, or by a
// non-identifier separator), which a genuine standalone Firecrawl key
// satisfies but a hex-boundary collision never does. sk-/sb_secret_/tvly-/
// xai-/eyJ/bearer all require at least one non-hex letter, so a hex-only
// UUID cannot produce them and they don't need the same treatment.
const SECRET_VALUE_PATTERN = /(bearer\s+[a-z0-9._-]+|eyJ[a-z0-9._-]+|sk-[a-z0-9_-]+|sb_secret_[a-z0-9_-]+|(?<![a-z0-9_])fc-[a-z0-9_-]+|tvly-[a-z0-9_-]+|xai-[a-z0-9_-]+|AIza[A-Za-z0-9_-]{20,})/i
const MAX_STRING_CHARS = 240
const MAX_ARRAY_ITEMS = 12
const MAX_OBJECT_KEYS = 24
const TRACE_UNAVAILABLE = '[trace_unavailable]'
const TRACE_REDACTED = '[REDACTED]'

export const COUNCIL_RUNTIME_TRACE_ACTIVATION_CONTRACT = {
  bodyAliases: ['councilTraceDebug', 'debugCouncilTrace'],
  header: 'x-war-room-council-trace',
  acceptedHeaderValues: ['1', 'true', 'yes', 'debug'],
} as const

export function isCouncilRuntimeTraceRequested(req: Request, body: Record<string, unknown>): boolean {
  const bodyFlag = body.councilTraceDebug === true || body.debugCouncilTrace === true
  const headerFlag = /^(1|true|yes|debug)$/i.test(req.headers.get('x-war-room-council-trace') ?? '')
  return bodyFlag || headerFlag
}

export function createCouncilRuntimeTrace(args: {
  enabled: boolean
  sessionId?: string | null
  missionVersion?: number
}): CouncilRuntimeTrace {
  const councilTraceId = createTraceId('ctrace')
  const missionId = createTraceId('mission')
  const finalReportId = createTraceId('creport')
  const missionVersion = args.missionVersion ?? 1
  const createdAt = new Date().toISOString()
  const stages: CouncilTraceStage[] = []
  const providerResponseIds: Record<string, string[]> = {}

  return {
    enabled: args.enabled,
    councilTraceId,
    missionId,
    missionVersion,
    finalReportId,
    record(stage, detail) {
      if (!args.enabled) return
      try {
        stages.push({
          stage,
          module: safeTraceString(detail.module),
          inputSummary: sanitizeTraceValue(detail.inputSummary ?? null),
          outputSummary: sanitizeTraceValue(detail.outputSummary ?? null),
          stateChange: safeTraceString(detail.stateChange),
          timestamp: new Date().toISOString(),
          missionVersion,
          observation: detail.observation ?? 'runtime_observed',
        })
      } catch (error) {
        appendTraceError(stages, missionVersion, error)
      }
    },
    registerProviderResponse(family) {
      try {
        const safeFamily = safeTraceString(family)
        const responseId = createTraceId(`resp_${slug(safeFamily) || 'provider'}`)
        if (args.enabled) {
          providerResponseIds[safeFamily] = [...(providerResponseIds[safeFamily] ?? []), responseId]
        }
        return responseId
      } catch (error) {
        appendTraceError(stages, missionVersion, error)
        return createTraceId('resp_provider')
      }
    },
    snapshot() {
      try {
        if (!args.enabled) return undefined
        return {
          councilTraceId,
          missionId,
          missionVersion,
          finalReportId,
          sessionId: typeof args.sessionId === 'string' ? safeTraceString(args.sessionId) : null,
          providerResponseIds: sanitizeTraceValue(providerResponseIds) as Record<string, string[]>,
          // inputSummary/outputSummary are already-sanitized object trees stored
          // by reference on the internal stage record. A plain `{...stage}`
          // spread only copies that reference, not the tree itself, so a
          // caller mutating the returned snapshot's inputSummary/outputSummary
          // would mutate the internally stored object too and corrupt every
          // later snapshot() call. Re-running the (pure, idempotent)
          // sanitizer produces a fresh, unaliased copy without repaying the
          // cost of re-sanitizing the whole stage record's primitive fields.
          stages: stages.map(stage => ({
            ...stage,
            inputSummary: sanitizeTraceValue(stage.inputSummary),
            outputSummary: sanitizeTraceValue(stage.outputSummary),
          })),
          redaction: {
            applied: true,
            policy: 'Prompt bodies, credentials, cookies, auth tokens, invite/recovery tokens, Google/Gemini API keys, and long free-text fields are redacted or summarized.',
          },
          createdAt,
          completedAt: new Date().toISOString(),
        }
      } catch (error) {
        appendTraceError(stages, missionVersion, error)
        return undefined
      }
    },
  }
}

export function attachCouncilTrace<T extends Record<string, unknown>>(
  payload: T,
  trace: CouncilRuntimeTrace,
): T & { councilTrace?: CouncilRuntimeTraceSnapshot } {
  try {
    const snapshot = trace.snapshot()
    if (!snapshot) return payload
    return { ...payload, councilTrace: snapshot }
  } catch {
    return payload
  }
}

export function validateCouncilRuntimeTraceSnapshot(
  trace: CouncilRuntimeTraceSnapshot,
  requiredStages: CouncilTraceStageName[] = [],
): CouncilTraceValidationResult {
  const errors: string[] = []
  let lastIndex = -1
  const stageNames = trace.stages.map(stage => stage.stage)

  for (const required of requiredStages) {
    const index = stageNames.indexOf(required)
    if (index === -1) {
      errors.push(`missing stage: ${required}`)
      continue
    }
    if (index < lastIndex) errors.push(`stage out of order: ${required}`)
    lastIndex = Math.max(lastIndex, index)
  }

  if (!trace.councilTraceId || !trace.missionId || !trace.finalReportId) {
    errors.push('trace identifiers are incomplete')
  }
  if (trace.missionVersion < 1) errors.push('mission version must be >= 1')
  if (containsSecretLikeValue(trace)) errors.push('trace contains secret-like value')

  return { ok: errors.length === 0, errors }
}

export function summarizeTextForTrace(text: unknown): Record<string, unknown> {
  try {
    if (typeof text !== 'string') return { type: typeof text }
    const trimmed = text.trim()
    return {
      type: 'string',
      chars: text.length,
      empty: trimmed.length === 0,
      preview: sanitizeTraceString(trimmed.slice(0, 120)),
    }
  } catch {
    return { type: 'unknown', error: TRACE_UNAVAILABLE }
  }
}

export function sanitizeTraceValue(value: unknown, depth = 0): unknown {
  try {
    if (value == null) return value
    if (typeof value === 'string') return sanitizeTraceString(value)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`
    if (Array.isArray(value)) {
      if (depth >= 3) return `[array:${safeArrayLength(value)}]`
      return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeTraceValue(item, depth + 1))
    }
    if (typeof value === 'object') {
      if (depth >= 3) return '[object]'
      const out: Record<string, unknown> = {}
      const entries = safeObjectEntries(value as Record<string, unknown>)
      for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
        out[key] = SECRET_KEY_PATTERN.test(key) ? TRACE_REDACTED : sanitizeTraceValue(item, depth + 1)
      }
      return out
    }
    return `[${typeof value}]`
  } catch {
    return TRACE_UNAVAILABLE
  }
}

function sanitizeTraceString(value: string): string {
  try {
    if (SECRET_VALUE_PATTERN.test(value)) return TRACE_REDACTED
    const compact = value.replace(/\s+/g, ' ').trim()
    if (compact.length <= MAX_STRING_CHARS) return compact
    return `${compact.slice(0, MAX_STRING_CHARS)}…[truncated:${compact.length}]`
  } catch {
    return TRACE_UNAVAILABLE
  }
}

function createTraceId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${uuid}`
}

function slug(value: string): string {
  return safeTraceString(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function containsSecretLikeValue(value: unknown): boolean {
  try {
    if (typeof value === 'string') {
      return SECRET_VALUE_PATTERN.test(value) && value !== TRACE_REDACTED
    }
    if (Array.isArray(value)) return value.some(containsSecretLikeValue)
    if (value && typeof value === 'object') {
      return safeObjectEntries(value as Record<string, unknown>).some(([, item]) => containsSecretLikeValue(item))
    }
    return false
  } catch {
    return false
  }
}

function safeTraceString(value: unknown): string {
  if (typeof value !== 'string') return `[${typeof value}]`
  return sanitizeTraceString(value)
}

function safeObjectEntries(value: Record<string, unknown>): [string, unknown][] {
  try {
    return Object.keys(value).map(key => {
      try {
        return [key, value[key]] as [string, unknown]
      } catch {
        return [key, TRACE_UNAVAILABLE] as [string, unknown]
      }
    })
  } catch {
    return [['trace_error', TRACE_UNAVAILABLE]]
  }
}

function safeArrayLength(value: unknown[]): number | string {
  try {
    return value.length
  } catch {
    return 'unknown'
  }
}

function appendTraceError(stages: CouncilTraceStage[], missionVersion: number, error: unknown): void {
  try {
    stages.push({
      stage: 'trace_error',
      module: 'lib/council/runtimeTrace.ts',
      inputSummary: null,
      outputSummary: { error: error instanceof Error ? safeTraceString(error.message) : TRACE_UNAVAILABLE },
      stateChange: 'Trace instrumentation failed open; normal Council execution continued.',
      timestamp: new Date().toISOString(),
      missionVersion,
      observation: 'runtime_observed',
    })
  } catch {
    /* Trace failures must never escape trace instrumentation. */
  }
}

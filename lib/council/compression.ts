import {
  councilFamilyIntegrityLabel,
  sanitizeCouncilFamilyResponse,
} from '@/lib/council/providerResponseSanitizer'
import { detectPromptIntent } from '@/lib/council/promptIntent'
import { compactDisplayWhitespace, toDisplayText } from '@/lib/council/toDisplayText'
import { shouldPassthroughCouncilProviderText } from '@/lib/council/stabilityMode'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export const COUNCIL_OUTPUT_MODES = ['brief', 'standard', 'deep', 'repair', 'revenue', 'red_team'] as const

export type CouncilOutputMode = (typeof COUNCIL_OUTPUT_MODES)[number]

export type CouncilEvidenceWeight =
  | 'verified'
  | 'source-backed'
  | 'inferred'
  | 'uncertain'
  | 'unsupported'

export type RedTeamCalibration =
  | 'confirmed_issue'
  | 'potential_issue'
  | 'missing_evidence'
  | 'no_active_harm_observed'
  | 'recommended_verification'

export type CouncilCompressionMessage = {
  id?: string
  familyName: string
  content: unknown
  provider?: string
  messageType: string
  repairPacket?: unknown
  integrityIncomplete?: boolean
}

export type CouncilCompressedFinding = {
  id: string
  text: string
  evidenceWeight: CouncilEvidenceWeight
  supportingFamilies: string[]
  sourceMessageIds: string[]
  softened: boolean
}

export type CouncilCompressedSummary = {
  mode: CouncilOutputMode
  generatedAt: string
  decisionSummary: string[]
  evidence: CouncilCompressedFinding[]
  disagreements: string[]
  risk: {
    level: 'low' | 'medium' | 'high'
    summary: string
    redTeamCalibration: RedTeamCalibration
  }
  nextAction: string
  repairPacket: {
    applicable: boolean
    symptom: string
    rootCause: string
    filesRoutes: string[]
    fixPlan: string[]
    validationCommands: string[]
    cursorPacketOption: string
  } | null
  revenuePacket: {
    applicable: boolean
    opportunity: string
    leverageScore: number
    timeToMoney: string
    nextAction: string
    risk: string
    requiredEvidence: string[]
  } | null
  duplicateReduction: {
    collapsedFindingCount: number
    rawFindingCount: number
  }
  guardrails: {
    providerTruthPreserved: true
    auditLogsPreserved: true
    approvalGatesPreserved: true
    noHiddenExecution: true
    noAutomaticMutation: true
    noAutomaticOutreachOrSpend: true
  }
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'into',
  'about',
  'there',
  'their',
  'should',
  'would',
  'could',
  'needs',
  'need',
  'must',
  'have',
  'has',
])

const VALIDATION_COMMANDS = [
  'pnpm exec tsc --noEmit',
  'pnpm exec eslint app components lib --max-warnings=0',
  'pnpm run build',
]

export function councilOutputModeLabel(mode: CouncilOutputMode) {
  switch (mode) {
    case 'brief':
      return 'Brief'
    case 'deep':
      return 'Deep'
    case 'repair':
      return 'Repair'
    case 'revenue':
      return 'Revenue'
    case 'red_team':
      return 'Red Team'
    case 'standard':
    default:
      return 'Standard'
  }
}

export function buildCouncilOutputModeInstruction(mode: CouncilOutputMode): string {
  const common = [
    'Phase 20 output discipline: be operational, concise, non-theatrical, and evidence-weighted.',
    'Every claim should be framed as verified, source-backed, inferred, uncertain, or unsupported. Soften or omit unsupported claims.',
    'Collapse duplicate points instead of repeating other families. Preserve provider truth, audit logs, approval gates, and advisory-only boundaries.',
    'No hidden execution, no fake autonomy, no automatic code mutation, no outreach, and no spend.',
  ]
  const specific: Record<CouncilOutputMode, string[]> = {
    brief: [
      'Brief mode: maximum 5 bullets total. Include one highest-priority action, one risk, and one evidence note.',
    ],
    standard: [
      'Standard mode: Decision Summary, Evidence, Risk, and Next Action. Keep each section short.',
    ],
    deep: [
      'Deep mode: allow more detail only where it changes the decision. Still avoid theatrical repetition.',
    ],
    repair: [
      'Repair mode: output symptom, likely root cause, files/routes to inspect, fix plan, validation commands, and optional Cursor packet handoff. Manual approval only.',
    ],
    revenue: [
      'Revenue mode: output opportunity, leverage score, time-to-money, next action, risk, and required evidence. Do not claim income without proof.',
    ],
    red_team: [
      'Red Team mode: classify as confirmed issue, potential issue, missing evidence, no active harm observed, or recommended verification. Do not use catastrophic language unless evidence exists.',
    ],
  }
  return [...common, ...specific[mode]].join('\n')
}

function normalizeFamilyName(value: unknown) {
  return compactDisplayWhitespace(toDisplayText(value).replace(/\s+family$/i, '')) || 'Council'
}

function compactWhitespace(value: unknown) {
  return compactDisplayWhitespace(value)
}

function sentenceCandidates(content: unknown): string[] {
  const text = toDisplayText(content)
  if (!text) return []
  return text
    .split(/\n+|(?:^|\s)[*-]\s+|(?<=[.!?])\s+/)
    .map(line => compactWhitespace(line.replace(/^\d+\.\s+/, '')))
    .filter(line => line.length >= 24)
    .slice(0, 8)
}

function keyForClaim(text: unknown) {
  const normalized = toDisplayText(text)
  if (!normalized) return ''
  const words = normalized
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' source ')
    .replace(/[`"'()[\]{}:;,.!?/\\|]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))
  return words.slice(0, 10).join(' ')
}

function evidenceWeightFor(text: string): CouncilEvidenceWeight {
  const t = text.toLowerCase()
  if (/\b(verified|confirmed|observed|measured|logged|build passed|test passed|status: ok|http 200)\b/.test(t)) {
    return 'verified'
  }
  if (/https?:\/\/|\b(source|citation|supabase|vercel|ledger|audit|log|route|file|api|provider|screenshot)\b/.test(t)) {
    return 'source-backed'
  }
  if (/\b(likely|suggests|appears|points to|probably|because|root cause|inferred)\b/.test(t)) {
    return 'inferred'
  }
  if (/\b(unknown|unclear|maybe|might|could|needs evidence|not enough evidence|unavailable|gap)\b/.test(t)) {
    return 'uncertain'
  }
  if (/\b(definitely|catastrophic|compromised|runaway|silent bleeding|financial danger|no kill switch|guaranteed)\b/.test(t)) {
    return 'unsupported'
  }
  return 'inferred'
}

function rankWeight(weight: CouncilEvidenceWeight) {
  switch (weight) {
    case 'verified':
      return 5
    case 'source-backed':
      return 4
    case 'inferred':
      return 3
    case 'uncertain':
      return 2
    case 'unsupported':
    default:
      return 1
  }
}

function softenUnsupported(text: unknown) {
  const normalized = toDisplayText(text)
  if (!normalized) return ''
  return normalized
    .replace(/\bcatastrophic\b/gi, 'material')
    .replace(/\bcompromised telemetry\b/gi, 'telemetry gap')
    .replace(/\brunaway automation\b/gi, 'automation risk to verify')
    .replace(/\bsilent bleeding\b/gi, 'unverified loss risk')
    .replace(/\bfinancial danger\b/gi, 'financial risk to verify')
    .replace(/\bno kill switch\b/gi, 'missing stop-control evidence')
}

function hasRepairSignal(text: string) {
  return /\b(bug|broken|error|exception|failed|failure|repair|fix|route|api|typescript|eslint|build|runtime|panel|provider)\b/i.test(text)
}

function hasRevenueSignal(text: string) {
  return /\b(revenue|income|opportunity|client|lead|sales|proposal|contract|time-to-money|leverage|customer|payout)\b/i.test(text)
}

function redTeamCalibrationFor(messages: CouncilCompressionMessage[]): RedTeamCalibration {
  const redText = messages
    .filter(message => /red.?team/i.test(toDisplayText(message.familyName)))
    .map(message => toDisplayText(message.content))
    .join('\n')
    .toLowerCase()
  const allText = messages.map(message => toDisplayText(message.content)).join('\n').toLowerCase()

  if (/\b(confirmed|verified|reproduced|observed|logged|evidence shows)\b/.test(redText)) return 'confirmed_issue'
  if (/\b(missing evidence|insufficient evidence|unknown|telemetry gap|unavailable)\b/.test(redText)) return 'missing_evidence'
  if (/\b(no active harm|no evidence of active harm|not observed)\b/.test(redText)) return 'no_active_harm_observed'
  if (/\b(verify|validation|check|confirm)\b/.test(redText)) return 'recommended_verification'
  if (/\b(risk|issue|concern|failure|bug)\b/.test(allText)) return 'potential_issue'
  return 'no_active_harm_observed'
}

function riskLevel(messages: CouncilCompressionMessage[], findings: CouncilCompressedFinding[]): 'low' | 'medium' | 'high' {
  const text = messages.map(message => toDisplayText(message.content)).join('\n').toLowerCase()
  const verifiedRisk = findings.some(
    finding => finding.evidenceWeight === 'verified' && /\b(security|data loss|payment|production|failed|broken)\b/i.test(finding.text),
  )
  if (verifiedRisk) return 'high'
  if (/\b(security|payment|production|deploy|schema|outage|blocked|approval required)\b/.test(text)) return 'medium'
  return 'low'
}

function latestDecreeIndex(messages: CouncilCompressionMessage[]) {
  return messages.findLastIndex(message => {
    const fam = message.familyName.toUpperCase()
    return message.messageType === 'decree' || fam.includes("RA'EL") || fam === 'RAEL'
  })
}

function normalizeOrchestrationFamily(familyName: unknown): CouncilOrchestrationFamily | null {
  const raw = toDisplayText(familyName).replace(/\s+family$/i, '').trim().toLowerCase()
  if (/red\s*team/.test(raw)) return 'red_team'
  const key = raw.replace(/\s+/g, '_')
  const map: Record<string, CouncilOrchestrationFamily> = {
    chatgpt: 'chatgpt',
    claude: 'claude',
    grok: 'grok',
    gemini: 'gemini',
    red_team: 'red_team',
    baby: 'baby',
    kimi: 'kimi',
    bridge_architect: 'bridge_architect',
  }
  return map[key] ?? null
}

function latestDecreeText(messages: CouncilCompressionMessage[]): string {
  const idx = latestDecreeIndex(messages)
  if (idx < 0) return ''
  return toDisplayText(messages[idx]?.content).trim()
}

function responseMessages(messages: CouncilCompressionMessage[], stabilityMode: boolean) {
  const start = latestDecreeIndex(messages)
  const decreeText = latestDecreeText(messages)
  const promptIntent = decreeText ? detectPromptIntent(decreeText) : undefined
  return messages
    .slice(start >= 0 ? start + 1 : 0)
    .filter(message => message.messageType === 'response' || message.messageType === 'repair_packet')
    .filter(message => toDisplayText(message.content).trim())
    .map(message => {
      const content = toDisplayText(message.content)
      const family = normalizeOrchestrationFamily(message.familyName)
      if (!family) return { ...message, content }
      const sanitized = sanitizeCouncilFamilyResponse(family, content, { decreeText, promptIntent, stabilityMode })
      if (!sanitized.incomplete) return message
      const label = councilFamilyIntegrityLabel(family, true)
      return {
        ...message,
        content: label ? `${label}\n${sanitized.displayText}` : sanitized.displayText,
        integrityIncomplete: true,
      }
    })
}

function synthesisEligibleMessages(messages: CouncilCompressionMessage[], stabilityMode: boolean) {
  return responseMessages(messages, stabilityMode).filter(message => !message.integrityIncomplete)
}

function buildFindings(messages: CouncilCompressionMessage[], stabilityMode: boolean): CouncilCompressedFinding[] {
  const groups = new Map<string, CouncilCompressedFinding>()
  let rawIndex = 0
  for (const message of synthesisEligibleMessages(messages, stabilityMode)) {
    const family = normalizeFamilyName(message.familyName)
    for (const candidate of sentenceCandidates(message.content)) {
      rawIndex += 1
      const rawWeight = evidenceWeightFor(candidate)
      const softened = rawWeight === 'unsupported'
      const text = softened ? `Needs evidence: ${softenUnsupported(candidate)}` : candidate
      const key = keyForClaim(text) || `claim-${rawIndex}`
      const existing = groups.get(key)
      if (existing) {
        if (!existing.supportingFamilies.includes(family)) existing.supportingFamilies.push(family)
        if (message.id && !existing.sourceMessageIds.includes(message.id)) existing.sourceMessageIds.push(message.id)
        if (rankWeight(rawWeight) > rankWeight(existing.evidenceWeight)) existing.evidenceWeight = rawWeight
        existing.softened = existing.softened || softened
        continue
      }
      groups.set(key, {
        id: `finding-${groups.size + 1}`,
        text,
        evidenceWeight: rawWeight,
        supportingFamilies: [family],
        sourceMessageIds: message.id ? [message.id] : [],
        softened,
      })
    }
  }
  return [...groups.values()]
    .filter(finding => finding.evidenceWeight !== 'unsupported' || finding.softened)
    .sort((a, b) => {
      const supportDelta = b.supportingFamilies.length - a.supportingFamilies.length
      if (supportDelta) return supportDelta
      return rankWeight(b.evidenceWeight) - rankWeight(a.evidenceWeight)
    })
}

function disagreementLines(findings: CouncilCompressedFinding[]) {
  const uncertain = findings.filter(finding => finding.evidenceWeight === 'uncertain').slice(0, 3)
  if (!uncertain.length) return ['No material disagreement detected in the visible council turn.']
  return uncertain.map(finding => `Unresolved: ${finding.text}`)
}

function filesRoutesFromText(text: string) {
  const matches = text.match(/(?:app|components|lib|api|supabase|docs)\/[A-Za-z0-9._/-]+|\/api\/[A-Za-z0-9._/-]+/g)
  return [...new Set(matches ?? [])].slice(0, 8)
}

function buildRepairPacket(messages: CouncilCompressionMessage[], findings: CouncilCompressedFinding[]) {
  const text = messages.map(message => toDisplayText(message.content)).join('\n')
  const applicable = messages.some(message => message.repairPacket) || hasRepairSignal(text)
  if (!applicable) return null
  const top = findings[0]?.text ?? 'System issue detected; inspect the latest council turn before acting.'
  return {
    applicable: true,
    symptom: top,
    rootCause: findings.find(finding => /root cause|because|likely|points to/i.test(finding.text))?.text ?? 'Root cause is not verified yet; treat this as a repair hypothesis.',
    filesRoutes: filesRoutesFromText(text),
    fixPlan: findings.slice(0, 3).map(finding => finding.text),
    validationCommands: VALIDATION_COMMANDS,
    cursorPacketOption: 'Generate Repair Packet prepares a manual Cursor handoff only after Commander approval.',
  }
}

function buildRevenuePacket(messages: CouncilCompressionMessage[], findings: CouncilCompressedFinding[]) {
  const text = messages.map(message => toDisplayText(message.content)).join('\n')
  if (!hasRevenueSignal(text)) return null
  const verifiedCount = findings.filter(finding => finding.evidenceWeight === 'verified' || finding.evidenceWeight === 'source-backed').length
  const leverageScore = Math.max(35, Math.min(95, 50 + verifiedCount * 10 + (/\b(client|contract|proposal|lead)\b/i.test(text) ? 15 : 0)))
  return {
    applicable: true,
    opportunity: findings.find(finding => hasRevenueSignal(finding.text))?.text ?? 'Revenue opportunity detected in the latest council turn.',
    leverageScore,
    timeToMoney: /\b(today|24 hours|now|immediate|lead)\b/i.test(text) ? 'near-term' : 'requires validation',
    nextAction: 'Queue a Commander-approved review action with required evidence before outreach or spend.',
    risk: findings.find(finding => /\brisk|unknown|uncertain|approval|evidence\b/i.test(finding.text))?.text ?? 'Evidence is required before claiming revenue potential.',
    requiredEvidence: [
      'source or lead URL',
      'estimated payout or contract value',
      'time requirement',
      'approval before outreach or spend',
    ],
  }
}

function fallbackDecision(messages: CouncilCompressionMessage[], stabilityMode: boolean) {
  const eligible = synthesisEligibleMessages(messages, stabilityMode)
  const last = eligible.at(-1)
  if (!last) {
    const incompleteFamilies = responseMessages(messages, stabilityMode)
      .filter(message => message.integrityIncomplete)
      .map(message => normalizeFamilyName(message.familyName))
    if (incompleteFamilies.length) {
      return `Council received incomplete provider response(s) from ${incompleteFamilies.join(', ')}; awaiting fallback or retry.`
    }
    return 'Council is waiting for a new decree or provider response.'
  }
  return compactWhitespace(last.content).slice(0, 220)
}

export function compressCouncilOutput(
  messages: CouncilCompressionMessage[],
  mode: CouncilOutputMode = 'standard',
  opts?: {
    /**
     * Server-reported stability mode, e.g. from the `councilStabilityMode` field
     * on the /api/chat response. Takes precedence over the env-based check —
     * COUNCIL_STABILITY_MODE is server-only and always reads as unset when this
     * runs client-side (compressCouncilOutput is called directly from
     * app/page.tsx), so callers running in the browser must pass this explicitly.
     */
    stabilityMode?: boolean
  },
): CouncilCompressedSummary {
  const stabilityMode = opts?.stabilityMode ?? shouldPassthroughCouncilProviderText()
  if (stabilityMode) {
    const relevant = responseMessages(messages, stabilityMode)
    const last = relevant.at(-1)
    const summary = last
      ? compactDisplayWhitespace(toDisplayText(last.content)).slice(0, 220)
      : 'Council stability mode — synthesis compression disabled.'
    return {
      mode,
      generatedAt: new Date().toISOString(),
      decisionSummary: summary ? [summary] : ['Awaiting provider response.'],
      evidence: [],
      disagreements: [],
      risk: {
        level: 'low',
        summary: 'Stability mode: compression and repair synthesis disabled.',
        redTeamCalibration: 'recommended_verification',
      },
      nextAction: 'Continue council dialogue with provider routing only.',
      duplicateReduction: { collapsedFindingCount: 0, rawFindingCount: 0 },
      guardrails: {
        providerTruthPreserved: true,
        auditLogsPreserved: true,
        approvalGatesPreserved: true,
        noHiddenExecution: true,
        noAutomaticMutation: true,
        noAutomaticOutreachOrSpend: true,
      },
      repairPacket: null,
      revenuePacket: null,
    }
  }

  const relevant = responseMessages(messages, stabilityMode)
  const findings = buildFindings(messages, stabilityMode)
  const repairPacket = buildRepairPacket(relevant, findings)
  const revenuePacket = buildRevenuePacket(relevant, findings)
  const calibration = redTeamCalibrationFor(relevant)
  const level = riskLevel(relevant, findings)
  const topFindings = findings.slice(0, mode === 'brief' ? 2 : mode === 'deep' ? 6 : 4)

  const decisionSummary = topFindings.length
    ? topFindings.map(finding => finding.text)
    : [fallbackDecision(messages, stabilityMode)]
  const nextAction =
    mode === 'repair' && repairPacket
      ? repairPacket.fixPlan.find(plan => plan.trim().length >= 24 && !/^(prepare|generate|create)\s+(a\s+)?repair/i.test(plan.trim()))
        ?? 'Describe the broken panel, symptom, and expected behavior before generating a repair packet.'
      : mode === 'revenue' && revenuePacket
        ? revenuePacket.nextAction
        : topFindings[0]?.text ?? 'Ask the council for a concrete next action.'
  const riskSummary =
    calibration === 'confirmed_issue'
      ? 'Confirmed issue language requires direct evidence and validation.'
      : calibration === 'missing_evidence'
        ? 'Risk is evidence-limited; verify before escalation.'
        : calibration === 'no_active_harm_observed'
          ? 'No active harm observed in visible council output.'
          : calibration === 'recommended_verification'
            ? 'Verification recommended before acting.'
            : 'Potential issue; keep approval gates in place.'

  return {
    mode,
    generatedAt: new Date().toISOString(),
    decisionSummary: mode === 'brief' ? decisionSummary.slice(0, 3) : decisionSummary,
    evidence: topFindings,
    disagreements: disagreementLines(findings),
    risk: {
      level,
      summary: riskSummary,
      redTeamCalibration: calibration,
    },
    nextAction,
    repairPacket,
    revenuePacket,
    duplicateReduction: {
      collapsedFindingCount: findings.length,
      rawFindingCount: responseMessages(messages, stabilityMode).reduce((total, message) => total + sentenceCandidates(message.content).length, 0),
    },
    guardrails: {
      providerTruthPreserved: true,
      auditLogsPreserved: true,
      approvalGatesPreserved: true,
      noHiddenExecution: true,
      noAutomaticMutation: true,
      noAutomaticOutreachOrSpend: true,
    },
  }
}

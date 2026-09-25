/**
 * Browser-safe Foundry contract/verdict view types and copy helpers.
 * Disk-backed evaluation lives in foundryContractVerdictView.ts (server-only).
 */
import type {
  FoundryAcceptanceContract,
  FoundryAcceptanceEvidence,
  FoundryContractEvent,
  FoundryEngineeringClass,
  FoundryMissionContract,
  FoundryVerdictRecord,
} from './foundryContractTypes'

export const FOUNDRY_CRITERION_UI_STATUSES = ['PASS', 'FAIL', 'INCONCLUSIVE', 'MISSING', 'STALE'] as const
export type FoundryCriterionUiStatus = (typeof FOUNDRY_CRITERION_UI_STATUSES)[number]

export const FOUNDRY_VERDICT_UI_STATES = ['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE', 'NOT_EVALUATED'] as const
export type FoundryVerdictUiState = (typeof FOUNDRY_VERDICT_UI_STATES)[number]

export const FOUNDRY_TRUTHFUL_HEADLINES = [
  'PROJECT READY',
  'SITE READY',
  'VERIFYING',
  'BLOCKED',
  'FAILED',
  'NEEDS EVIDENCE',
  'NEEDS COMMANDER',
  'LEGACY MISSION',
] as const
export type FoundryTruthfulHeadline = (typeof FOUNDRY_TRUTHFUL_HEADLINES)[number]

const SECRETISH = /api[_-]?key|authorization:|bearer\s+[a-z0-9._-]+|password|secret|private[_-]?key|BEGIN [A-Z ]+PRIVATE KEY/i

export function compactFoundryHash(hash: string | null | undefined): string {
  const value = String(hash ?? '').trim()
  if (!value) return '—'
  if (value.length <= 16) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function sanitizeCommanderEvidenceText(value: string | null | undefined, limit = 180): string {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  if (SECRETISH.test(raw)) return '[redacted]'
  return raw.length > limit ? `${raw.slice(0, limit)}…` : raw
}

export type FoundryCriterionUiRow = {
  criterionId: string
  description: string
  verificationType: string
  required: boolean
  status: FoundryCriterionUiStatus
  evidenceId: string | null
  producer: string | null
  timestamp: string | null
  artifactReference: string | null
  commandReference: string | null
  result: string | null
  contentHash: string | null
  specVersion: string | null
  stale: boolean
}

export type FoundryContractVerdictView = {
  engineeringClass: FoundryEngineeringClass
  legacy: boolean
  legacyLabel: string | null
  missionId: string
  specVersion: string | null
  specApproved: boolean
  reapprovalRequired: boolean
  previousSpecVersion: string | null
  previousMissionHash: string | null
  previousAcceptanceHash: string | null
  missionContract: {
    id: string | null
    status: string | null
    hash: string | null
    compactHash: string
    specVersion: string | null
    engineeringClass: FoundryEngineeringClass
    sealed: boolean
  }
  acceptanceContract: {
    id: string | null
    status: string | null
    hash: string | null
    compactHash: string
    criterionCount: number
    sealed: boolean
  }
  criteria: FoundryCriterionUiRow[]
  verdict: FoundryVerdictUiState
  verdictReason: string
  evaluatedAt: string | null
  reviewOutcome: string | null
  completionRefusedReason: string | null
  projectReadyAdmissible: boolean
  truthfulHeadline: FoundryTruthfulHeadline
  nextAction: string
  approvalCopy: {
    specVersion: string
    missionCompactHash: string
    acceptanceCompactHash: string
    bindsExecution: true
  }
  approval: {
    approvalId: string | null
    status: string | null
    approvedAt: string | null
    specVersion: string | null
    missionHash: string | null
    acceptanceHash: string | null
    missionCompactHash: string
    acceptanceCompactHash: string
    superseded: boolean
  } | null
  approvalHistory: Array<{
    approvalId: string
    status: string
    specVersion: string
    missionCompactHash: string
    acceptanceCompactHash: string
    approvedAt: string
  }>
  schemaVersion: 1
}

export type FoundryContractVerdictViewInput = {
  missionId: string
  graphId?: string | null
  engineeringClass?: string | null
  specVersion?: string | null
  specApproved?: boolean
  approvedMissionHash?: string | null
  approvedAcceptanceHash?: string | null
  missionContractId?: string | null
  acceptanceContractId?: string | null
  reviewOutcome?: string | null
  previewReady?: boolean
  projectReadyFlag?: boolean
  tasksComplete?: boolean
  previewUrl?: string | null
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
  evidence?: FoundryAcceptanceEvidence[]
  verdict?: FoundryVerdictRecord | null
  events?: FoundryContractEvent[]
}

export function commanderCompletionRefusedReason(input: {
  verdict: FoundryVerdictUiState
  criteria: FoundryCriterionUiRow[]
  reviewOutcome?: string | null
  reapprovalRequired?: boolean
  events?: FoundryContractEvent[]
}): string | null {
  if (input.verdict === 'PASS' && !input.reapprovalRequired) return null
  const event = [...(input.events ?? [])].reverse().find(item => item.type === 'COMPLETION_REFUSED')
  const missing = input.criteria.find(item => item.required && item.status === 'MISSING')
  const stale = input.criteria.find(item => item.required && item.status === 'STALE')
  const failed = input.criteria.find(item => item.required && item.status === 'FAIL')
  if (missing) return `Completion refused: required criterion ${missing.criterionId} has no current evidence.`
  if (failed) return `Completion refused: test evidence failed.`
  if (stale) return `Completion refused: acceptance evidence belongs to superseded spec version.`
  if (input.reviewOutcome === 'FAIL') return 'Completion refused: independent review failed.'
  if (input.reapprovalRequired) return 'Completion refused: contract changed after approval. Re-approval required.'
  if (input.verdict === 'BLOCKED') return 'Completion refused: mission is blocked.'
  if (input.verdict === 'INCONCLUSIVE') return 'Completion refused: required acceptance evidence is incomplete.'
  if (input.verdict === 'NOT_EVALUATED') return 'Completion refused: independent verdict has not been evaluated.'
  if (event?.text) {
    const text = event.text.replace(/^COMPLETION_REFUSED:?\s*/i, '').trim()
    return text.startsWith('Completion refused') ? text : `Completion refused: ${text}`
  }
  return 'Completion refused: Verdict PASS is required.'
}

export function commanderNextAction(input: {
  legacy: boolean
  verdict: FoundryVerdictUiState
  criteria: FoundryCriterionUiRow[]
  reviewOutcome?: string | null
  reapprovalRequired?: boolean
  projectReadyAdmissible?: boolean
}): string {
  if (input.legacy) return 'Pre-contract mission; Standalone Engineer contract gates do not apply.'
  if (input.projectReadyAdmissible) return 'PROJECT READY is legally admissible. Live deploy remains unauthorized.'
  if (input.reapprovalRequired) return 'NEEDS COMMANDER: Approve updated contract.'
  const failed = input.criteria.find(item => item.required && item.status === 'FAIL')
  if (failed || input.verdict === 'FAIL' && input.reviewOutcome !== 'FAIL') return 'FAILED: Required test criterion failed.'
  if (input.reviewOutcome === 'FAIL') return 'FAILED: Independent review found a defect. Repair and re-verify.'
  const stale = input.criteria.find(item => item.required && item.status === 'STALE')
  if (stale) return 'NEEDS EVIDENCE: Re-run required tests against the current contract.'
  const missing = input.criteria.find(item => item.required && item.status === 'MISSING')
  if (missing || input.verdict === 'INCONCLUSIVE' || input.verdict === 'NOT_EVALUATED') return 'NEEDS EVIDENCE: Run required tests.'
  if (input.verdict === 'BLOCKED') return 'BLOCKED: Protected path scope conflict.'
  return 'NEEDS EVIDENCE: Run required tests.'
}

export function truthfulHeadlineForView(input: {
  legacy: boolean
  projectReadyAdmissible: boolean
  verdict: FoundryVerdictUiState
  reapprovalRequired: boolean
  criteria: FoundryCriterionUiRow[]
  site?: boolean
}): FoundryTruthfulHeadline {
  if (input.legacy) return 'LEGACY MISSION'
  if (input.projectReadyAdmissible) return input.site ? 'SITE READY' : 'PROJECT READY'
  if (input.reapprovalRequired) return 'NEEDS COMMANDER'
  if (input.verdict === 'FAIL' || input.criteria.some(item => item.required && item.status === 'FAIL')) return 'FAILED'
  if (input.verdict === 'BLOCKED') return 'BLOCKED'
  if (input.verdict === 'NOT_EVALUATED') return 'VERIFYING'
  return 'NEEDS EVIDENCE'
}

export function projectReadyUiAdmissible(view: Pick<FoundryContractVerdictView, 'legacy' | 'projectReadyAdmissible' | 'verdict'>): boolean {
  if (view.legacy) return view.projectReadyAdmissible
  return view.verdict === 'PASS' && view.projectReadyAdmissible
}

export type LearningProvider =
  | 'ChatGPT'
  | 'Claude'
  | 'Grok'
  | 'Gemini'
  | 'Red Team'
  | 'Cursor'
  | 'Codex'
  | 'Future Agent'

export type OutcomeLedgerKind =
  | 'decree'
  | 'project'
  | 'analyst_finding'
  | 'prediction'
  | 'approval'
  | 'execution'
  | 'repair'
  | 'provider_review'

export type OutcomeStatus = 'successful' | 'partial' | 'failed' | 'unresolved' | 'watching'

export type OutcomeLedgerEntry = {
  id: string
  kind: OutcomeLedgerKind
  title: string
  project: string
  decree?: string
  providers: LearningProvider[]
  findings: string[]
  prediction?: string
  approvals: Array<{
    label: string
    required: boolean
    granted: boolean
    approvedBy?: 'Commander'
  }>
  executionOutcome: string
  repairOutcome?: string
  timeline: {
    openedAt: string
    evaluatedAt: string
    durationMinutes: number
  }
  status: OutcomeStatus
  successScore: number
  unresolvedRisks: string[]
  rollbackHistory: string[]
  confidence: number
  accuracy: number
  usefulness: number
  contradictionsMissed: number
  anomalyIndicators: string[]
  evidence: string[]
}

export type OutcomeLedgerSummary = {
  totalEntries: number
  successfulEntries: number
  averageConfidence: number
  averageAccuracy: number
  averageUsefulness: number
  unresolvedRiskCount: number
  contradictionMisses: number
  anomalyCount: number
  approvalGateIntegrity: 'intact' | 'needs_review'
}

export const OUTCOME_LEDGER_ENTRIES: OutcomeLedgerEntry[] = [
  {
    id: 'outcome-runtime-truth-001',
    kind: 'decree',
    title: 'Runtime truth doctrine enforced before synthesis',
    project: 'War Room Core',
    decree: 'Live Environment and runtime integrity evidence must be consulted before operational claims.',
    providers: ['ChatGPT', 'Claude', 'Cursor'],
    findings: [
      'Static assumptions degrade operational accuracy when live health data is available.',
      'Runtime integrity packets reduce hallucinated system-state claims.',
    ],
    prediction: 'Source-backed runtime claims will outperform model-only summaries.',
    approvals: [{ label: 'Doctrine promotion', required: true, granted: true, approvedBy: 'Commander' }],
    executionOutcome: 'Promoted as a standing operational truth and surfaced in system panels.',
    timeline: { openedAt: '2026-05-01T12:00:00.000Z', evaluatedAt: '2026-05-10T18:00:00.000Z', durationMinutes: 13080 },
    status: 'successful',
    successScore: 0.94,
    unresolvedRisks: ['Evidence freshness still depends on individual source health.'],
    rollbackHistory: ['No rollback required; additive doctrine only.'],
    confidence: 0.95,
    accuracy: 0.93,
    usefulness: 0.96,
    contradictionsMissed: 0,
    anomalyIndicators: [],
    evidence: ['Runtime Integrity dashboard', 'Live Environment packet', 'Configuration sweep'],
  },
  {
    id: 'outcome-repair-ledger-002',
    kind: 'repair',
    title: 'Approval-gated repair workflow preserved rollback checkpoints',
    project: 'Engineering Bridge',
    providers: ['Cursor', 'Red Team', 'Codex'],
    findings: [
      'Repair proposals are safest when checkpointed before mutation.',
      'Red-team diagnosis catches risky patches before execution.',
    ],
    approvals: [{ label: 'Repair mutation', required: true, granted: true, approvedBy: 'Commander' }],
    executionOutcome: 'Repair remained proposal-bound until approval, then emitted traceable ledger rows.',
    repairOutcome: 'Partial repair success with unresolved follow-up risks tracked for Commander review.',
    timeline: { openedAt: '2026-05-06T09:15:00.000Z', evaluatedAt: '2026-05-06T11:45:00.000Z', durationMinutes: 150 },
    status: 'partial',
    successScore: 0.81,
    unresolvedRisks: ['Post-build verification can still reveal integration failures.'],
    rollbackHistory: ['Checkpoint created before repair plan application.'],
    confidence: 0.87,
    accuracy: 0.84,
    usefulness: 0.9,
    contradictionsMissed: 1,
    anomalyIndicators: ['Unexpected build latency spike'],
    evidence: ['Repair readiness audit', 'Patch history summary', 'Action approval ledger'],
  },
  {
    id: 'outcome-intel-retrieval-003',
    kind: 'analyst_finding',
    title: 'Retrieval-first intelligence improved local opportunity review',
    project: 'Intelligence Retrieval',
    providers: ['Grok', 'Gemini', 'Claude'],
    findings: [
      'Source overlap improved confidence in local event analysis.',
      'Contradiction clusters were more visible when sources were mapped before synthesis.',
    ],
    prediction: 'Local intelligence workflows will benefit from source overlap and contradiction scoring.',
    approvals: [{ label: 'External action', required: true, granted: false }],
    executionOutcome: 'No external outreach executed; findings remained classified intelligence.',
    timeline: { openedAt: '2026-05-09T14:30:00.000Z', evaluatedAt: '2026-05-11T16:00:00.000Z', durationMinutes: 2970 },
    status: 'watching',
    successScore: 0.76,
    unresolvedRisks: ['Some municipal feeds update slowly overnight.'],
    rollbackHistory: ['Not applicable; no production mutation.'],
    confidence: 0.82,
    accuracy: 0.79,
    usefulness: 0.86,
    contradictionsMissed: 0,
    anomalyIndicators: ['Narrative synchronization across two unrelated local sources'],
    evidence: ['Persistent source network', 'Source fallback planner', 'Contradiction scanner'],
  },
]

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function summarizeOutcomeLedger(entries: OutcomeLedgerEntry[] = OUTCOME_LEDGER_ENTRIES): OutcomeLedgerSummary {
  const approvalsIntact = entries.every(entry => (
    entry.approvals.every(approval => !approval.required || approval.granted || entry.executionOutcome.toLowerCase().includes('no external'))
  ))

  return {
    totalEntries: entries.length,
    successfulEntries: entries.filter(entry => entry.status === 'successful').length,
    averageConfidence: average(entries.map(entry => entry.confidence)),
    averageAccuracy: average(entries.map(entry => entry.accuracy)),
    averageUsefulness: average(entries.map(entry => entry.usefulness)),
    unresolvedRiskCount: entries.reduce((sum, entry) => sum + entry.unresolvedRisks.length, 0),
    contradictionMisses: entries.reduce((sum, entry) => sum + entry.contradictionsMissed, 0),
    anomalyCount: entries.reduce((sum, entry) => sum + entry.anomalyIndicators.length, 0),
    approvalGateIntegrity: approvalsIntact ? 'intact' : 'needs_review',
  }
}

export function getOutcomeLedgerSnapshot() {
  return {
    entries: OUTCOME_LEDGER_ENTRIES,
    summary: summarizeOutcomeLedger(),
    guardrail: 'Learning may evaluate, classify, forecast, and propose; external execution remains Commander-approved only.',
  }
}

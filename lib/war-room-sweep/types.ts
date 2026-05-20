export type SweepSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type SweepCategory =
  | 'missing_configuration'
  | 'schema_database'
  | 'provider_runtime'
  | 'signal_intelligence'
  | 'ui_ux'
  | 'engineering_runtime'
  | 'council_orchestration'
  | 'mission_revenue'

export type SweepClassification = 'add' | 'fix' | 'remove'

export type SweepFinding = {
  id: string
  title: string
  category: SweepCategory
  severity: SweepSeverity
  evidence: string[]
  affectedFeature: string
  affectedPanel: string
  suggestedAction: string
  classification: SweepClassification
  duplicateOf?: string
  repairPacketAvailable: boolean
  cursorReadyCommand?: string
}

export type SweepReportSummary = {
  readinessScore: number
  missingConfigCount: number
  repairCount: number
  duplicateCount: number
  staleDegradedCount: number
  topFixes: SweepFinding[]
  topAdditions: SweepFinding[]
  topRemovals: SweepFinding[]
  duplicates: SweepFinding[]
  missingConfig: SweepFinding[]
  recommendedNextRepairPacketId: string | null
}

export type SweepReport = {
  generatedAt: string
  findings: SweepFinding[]
  summary: SweepReportSummary
  sources: Array<{ id: string; label: string; status: 'ok' | 'degraded' | 'error' }>
  guardrails: {
    diagnosticOnly: true
    autoMutation: false
    exposesSecrets: false
  }
}

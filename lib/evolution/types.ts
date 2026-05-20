import type { OperatorNextStepsPayload } from '@/lib/operator/nextStepsReport'

export type RepairSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type MissingConfigCategory =
  | 'api_key'
  | 'env_variable'
  | 'supabase_table'
  | 'column'
  | 'migration'
  | 'rss_source'
  | 'provider'
  | 'worker'
  | 'queue'
  | 'payment'
  | 'cron'

export type MissingConfigStatus = 'missing' | 'degraded' | 'disabled' | 'failed' | 'unknown'

export type RepairIntelligenceSection =
  | 'system_readiness'
  | 'missing_configuration'
  | 'required_migrations'
  | 'provider_issues'
  | 'schema_drift'
  | 'runtime_degradation'
  | 'repair_queue'
  | 'next_required_action'

export type RepairApprovalState = 'not_required' | 'approval_required' | 'awaiting_approval' | 'unknown'

export type MissingConfigItem = {
  id: string
  name: string
  category: MissingConfigCategory
  status: MissingConfigStatus
  severity: RepairSeverity
  affectedFeature: string
  affectedPanel?: string
  reason: string
  requiredFix: string
  repairPacketAvailable: boolean
  envVarNames?: string[]
}

export type RepairIntelligenceItem = {
  id: string
  title: string
  issueType: string
  section: RepairIntelligenceSection
  severity: RepairSeverity
  affectedPanel: string
  affectedRoute?: string
  evidence: string[]
  dependencyChain: string[]
  suggestedFiles: string[]
  suggestedSqlMigration?: string
  validationCommands: string[]
  approvalState: RepairApprovalState
  repairPacketAvailable: boolean
  cursorCommand?: string
}

export type ReadinessScores = {
  provider: number
  schema: number
  signal: number
  operator: number
  revenue: number
  overall: number
}

export type RepairIntelligenceSnapshot = {
  generatedAt: string
  scores: ReadinessScores
  missingConfiguration: MissingConfigItem[]
  sections: Record<RepairIntelligenceSection, RepairIntelligenceItem[]>
  nextRequiredAction: RepairIntelligenceItem | null
  operatorNextSteps: OperatorNextStepsPayload['report']
  operatorNextStepsMarkdown: string
  repairQueue: RepairIntelligenceItem[]
  sources: Array<{ id: string; label: string; status: 'ok' | 'degraded' | 'error' }>
  guardrails: {
    exposesSecrets: false
    browserDbMutation: false
    fakeConfiguredStates: false
    fakeRepairedStates: false
  }
}

export type EvolutionOperatorSummary = {
  overallReadiness: number
  readinessLabel: string
  blockerCount: number
  missingConfigCount: number
  nextActionTitle: string
  nextActionDetail: string
}

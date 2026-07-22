export type RedTeamWorkspaceSource = 'red_sentinel' | 'red_team_coder'

export type RedTeamWorkspaceItem = {
  id: string
  source: RedTeamWorkspaceSource
  observation: string
  classification: string
  severity: string
  affectedSubsystem: string
  evidence: string[]
  suspectedCause: string
  /** Nothing in the system confirms a root cause automatically — always null. */
  confirmedCause: null
  securityImpact: string
  userImpact: string
  reliabilityImpact: string
  recommendedRepair: string
  verificationPlan: string[]
  /** null when the source subsystem does not produce a rollback plan. */
  rollbackPlan: string[] | null
  unresolvedQuestions: string[]
}

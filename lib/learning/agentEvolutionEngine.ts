import { detectStrategicPatterns } from './strategicPatternDetector'

export type ProposedSpecializedAgent =
  | 'Local Scout Agent'
  | 'Freight Intelligence Agent'
  | 'Repair Analyst Agent'
  | 'Market Watch Agent'
  | 'Financial Forecast Agent'
  | 'Infrastructure Analyst Agent'

export type AgentEvolutionProposal = {
  id: string
  agent: ProposedSpecializedAgent
  reason: string
  inheritedDoctrineIds: string[]
  scopedMemory: string[]
  allowedActions: string[]
  forbiddenActions: string[]
  confidence: number
  requiresCommanderApproval: true
}

export function getAgentEvolutionProposals(): AgentEvolutionProposal[] {
  const patterns = detectStrategicPatterns()
  const sourcePattern = patterns.find(pattern => pattern.id === 'pattern-source-backed-confidence')
  const repairPattern = patterns.find(pattern => pattern.id === 'pattern-validation-bottleneck')

  return [
    {
      id: 'agent-proposal-local-scout',
      agent: 'Local Scout Agent',
      reason: 'Repeated source-backed local intelligence benefits from a scoped scout that tracks source freshness and contradictions.',
      inheritedDoctrineIds: ['doctrine-retrieval-before-synthesis', 'doctrine-approval-before-mutation'],
      scopedMemory: ['local opportunities', 'source reliability', 'contradiction clusters'],
      allowedActions: ['classify sources', 'rank opportunities', 'draft Commander briefings'],
      forbiddenActions: ['contact people', 'spend money', 'register accounts', 'mutate production'],
      confidence: sourcePattern?.confidence ?? 0.72,
      requiresCommanderApproval: true,
    },
    {
      id: 'agent-proposal-repair-analyst',
      agent: 'Repair Analyst Agent',
      reason: 'Repair outcomes show a recurring need for validation forecasting and rollback-aware diagnosis.',
      inheritedDoctrineIds: ['doctrine-rollback-before-repair', 'doctrine-approval-before-mutation'],
      scopedMemory: ['repair ledger', 'rollback checkpoints', 'validation failures'],
      allowedActions: ['diagnose failures', 'draft repair plans', 'estimate validation risk'],
      forbiddenActions: ['apply patches without approval', 'deploy', 'rollback without approval'],
      confidence: repairPattern?.confidence ?? 0.7,
      requiresCommanderApproval: true,
    },
    {
      id: 'agent-proposal-market-watch',
      agent: 'Market Watch Agent',
      reason: 'Forecast and provider score drift can be monitored as recommendations without external execution.',
      inheritedDoctrineIds: ['doctrine-retrieval-before-synthesis', 'doctrine-runtime-truth'],
      scopedMemory: ['market shifts', 'provider scorecards', 'forecast assumptions'],
      allowedActions: ['watch signals', 'forecast risk', 'prepare escalation queue entries'],
      forbiddenActions: ['trade', 'purchase services', 'send external notifications automatically'],
      confidence: 0.74,
      requiresCommanderApproval: true,
    },
  ]
}

export function getAgentEvolutionSummary() {
  const proposals = getAgentEvolutionProposals()
  return {
    proposed: proposals.length,
    approvalBound: proposals.every(proposal => proposal.requiresCommanderApproval),
    highestConfidence: [...proposals].sort((a, b) => b.confidence - a.confidence)[0],
  }
}

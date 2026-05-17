import type { AutomationModeDefinition } from './automationModeRegistry'
import type { ExecutionDomainDefinition } from './executionDomainRegistry'
import type { ExecutionRiskScore } from './executionRiskScoring'

export type AutomationEscalationPlan = {
  domainId: ExecutionDomainDefinition['id']
  modeId: AutomationModeDefinition['id']
  status: 'none' | 'watch' | 'commander_review' | 'red_team_required'
  reasons: string[]
  familyRoles: {
    chatgpt: string
    claude: string
    grok: string
    gemini: string
    redTeam: string
  }
}

export function planAutomationEscalation(
  domain: ExecutionDomainDefinition,
  mode: AutomationModeDefinition,
  risk: ExecutionRiskScore,
): AutomationEscalationPlan {
  const reasons = [...domain.escalationRules, ...risk.blockers, ...risk.warnings]
  const status = risk.blockers.length || risk.band === 'high'
    ? 'red_team_required'
    : risk.band === 'elevated' || mode.id === 'approval_checkpoint'
      ? 'commander_review'
      : risk.band === 'moderate'
        ? 'watch'
        : 'none'

  return {
    domainId: domain.id,
    modeId: mode.id,
    status,
    reasons,
    familyRoles: {
      chatgpt: 'Workflow orchestration: propose safe routing, handoffs, and Commander approval packet structure.',
      claude: 'Infrastructure and dependency review: verify persistence, queues, rollback readiness, and missing prerequisites.',
      grok: 'Signal and opportunity radar: flag market, lead, freight, and notification triggers without claiming unsourced live data.',
      gemini: 'Cross-source correlation: compare evidence, memory scope, confidence, and contradictions.',
      redTeam: 'Risk and contradiction review: block overreach, spend leakage, hidden execution, and stale doctrine.',
    },
  }
}

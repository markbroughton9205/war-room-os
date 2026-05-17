export type AutomationModeId =
  | 'manual'
  | 'assisted'
  | 'approval_checkpoint'
  | 'bounded_auto'
  | 'full_auto_domain'

export type AutomationModeRisk = 'minimal' | 'low' | 'moderate' | 'elevated'

export type AutomationModeDefinition = {
  id: AutomationModeId
  label: string
  summary: string
  behavior: string
  commanderApprovalRequired: boolean
  executionAllowed: boolean
  recurringAllowed: boolean
  isolatedDomainRequired: boolean
  rollbackPlanRequired: boolean
  throttleRequired: boolean
  maxRisk: AutomationModeRisk
  safeguards: string[]
}

export const AUTOMATION_MODES: AutomationModeDefinition[] = [
  {
    id: 'manual',
    label: 'Manual',
    summary: 'No execution, recommendation only.',
    behavior: 'War Room may explain options and prepare a briefing; the Commander performs every action outside the system.',
    commanderApprovalRequired: true,
    executionAllowed: false,
    recurringAllowed: false,
    isolatedDomainRequired: false,
    rollbackPlanRequired: false,
    throttleRequired: false,
    maxRisk: 'minimal',
    safeguards: ['Recommendation only', 'No queue dispatch', 'No financial activity', 'No external mutation'],
  },
  {
    id: 'assisted',
    label: 'Assisted',
    summary: 'Prepares actions, Commander executes.',
    behavior: 'War Room may assemble task packets, drafts, dependencies, and checklists while leaving execution to the Commander.',
    commanderApprovalRequired: true,
    executionAllowed: false,
    recurringAllowed: false,
    isolatedDomainRequired: false,
    rollbackPlanRequired: true,
    throttleRequired: false,
    maxRisk: 'low',
    safeguards: ['Commander handoff required', 'Rollback notes required', 'Audit trail prepared', 'No direct execution'],
  },
  {
    id: 'approval_checkpoint',
    label: 'Approval Checkpoint',
    summary: 'Executes only after explicit approval.',
    behavior: 'War Room may stage a bounded execution request, but each action remains blocked until an explicit approval record exists.',
    commanderApprovalRequired: true,
    executionAllowed: true,
    recurringAllowed: false,
    isolatedDomainRequired: true,
    rollbackPlanRequired: true,
    throttleRequired: true,
    maxRisk: 'moderate',
    safeguards: ['Explicit approval gate', 'Checkpoint validation', 'Throttle profile', 'Rollback plan'],
  },
  {
    id: 'bounded_auto',
    label: 'Bounded Auto',
    summary: 'Recurring scoped tasks within limits.',
    behavior: 'War Room may coordinate recurring queue-bound work inside fixed doctrine, memory, risk, spend, and frequency limits.',
    commanderApprovalRequired: true,
    executionAllowed: true,
    recurringAllowed: true,
    isolatedDomainRequired: true,
    rollbackPlanRequired: true,
    throttleRequired: true,
    maxRisk: 'moderate',
    safeguards: ['Domain scoped', 'Spend ceiling', 'Cooldowns', 'Failure shutoff', 'Commander revocation'],
  },
  {
    id: 'full_auto_domain',
    label: 'Full Auto Domain',
    summary: 'Approved isolated domain automation with throttles and rollback plans.',
    behavior: 'War Room may operate inside a pre-approved isolated domain only after boundaries, rollback, audit, and emergency stops are configured.',
    commanderApprovalRequired: true,
    executionAllowed: true,
    recurringAllowed: true,
    isolatedDomainRequired: true,
    rollbackPlanRequired: true,
    throttleRequired: true,
    maxRisk: 'elevated',
    safeguards: ['Isolated domain approval', 'Emergency shutdown', 'Rollback cost tracking', 'Continuous audit reconstruction'],
  },
]

export function getAutomationModes() {
  return AUTOMATION_MODES
}

export function getAutomationMode(id: AutomationModeId) {
  return AUTOMATION_MODES.find(mode => mode.id === id)
}

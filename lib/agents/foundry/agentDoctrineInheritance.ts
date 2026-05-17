import type { AgentBlueprint, FoundryAgent } from './agentBlueprints'

export type DoctrineInheritanceCheck = {
  agentId: string
  enforced: boolean
  inheritedDoctrine: string[]
  missingDoctrine: string[]
  rule: string
}

const REQUIRED_DOCTRINE = [
  'runtime-truth',
  'approval-before-action',
]

export function getDoctrineInheritanceForBlueprint(blueprint: AgentBlueprint): DoctrineInheritanceCheck {
  const missingDoctrine = REQUIRED_DOCTRINE.filter(id => !blueprint.assignedDoctrine.includes(id))
  return {
    agentId: blueprint.id,
    enforced: missingDoctrine.length === 0,
    inheritedDoctrine: blueprint.assignedDoctrine,
    missingDoctrine,
    rule: 'Agents inherit War Room doctrine and cannot activate unless runtime truth and approval boundaries are assigned.',
  }
}

export function getDoctrineInheritanceForAgent(agent: FoundryAgent): DoctrineInheritanceCheck {
  const missingDoctrine = REQUIRED_DOCTRINE.filter(id => !agent.assignedDoctrine.includes(id))
  return {
    agentId: agent.id,
    enforced: missingDoctrine.length === 0,
    inheritedDoctrine: agent.assignedDoctrine,
    missingDoctrine,
    rule: 'Active workers must remain doctrine-bound and approval-governed.',
  }
}

export function doctrineAllowsActivation(agent: FoundryAgent) {
  const check = getDoctrineInheritanceForAgent(agent)
  return {
    ok: check.enforced,
    reason: check.enforced
      ? 'Doctrine inheritance is complete for activation.'
      : `Missing doctrine: ${check.missingDoctrine.join(', ')}`,
  }
}

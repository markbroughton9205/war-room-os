import { canAcceptWork } from './lifecycle'
import type { AgentView } from './registry'
import { riskRank, type MemoryScope, type ProtectedEffect, type RiskClass, type SafePermission, type Specialization } from './types'

export type AgentTask = {
  title: string
  domain: Specialization
  riskClass: RiskClass
  permissions: SafePermission[]
  memory: MemoryScope[]
  /** Protected effects the task would cause. Any of these always escalates. */
  effects: ProtectedEffect[]
}
export type ScopeVerdict =
  | { verdict: 'IN_SCOPE' }
  | { verdict: 'ESCALATE'; reasons: string[]; to: string }
  | { verdict: 'REFUSE'; reasons: string[] }

/** A specialized agent keeps to its boundary: out-of-domain or over-risk work escalates; non-ACTIVE agents refuse. */
export function checkTaskScope(agent: AgentView, task: AgentTask): ScopeVerdict {
  if (!canAcceptWork(agent.state)) return { verdict: 'REFUSE', reasons: [`agent is ${agent.state}, not ACTIVE`] }
  const reasons: string[] = []
  if (task.domain !== agent.spec.specialization) reasons.push(`task domain ${task.domain} is outside specialization ${agent.spec.specialization}`)
  if (riskRank(task.riskClass) > riskRank(agent.spec.riskCeiling)) reasons.push(`task risk ${task.riskClass} exceeds ceiling ${agent.spec.riskCeiling}`)
  const extraPerm = task.permissions.filter((p) => !agent.spec.permissionScope.includes(p))
  if (extraPerm.length) reasons.push(`permissions outside scope: ${extraPerm.join(', ')}`)
  const extraMem = task.memory.filter((m) => !agent.spec.memoryScope.includes(m))
  if (extraMem.length) reasons.push(`memory outside scope: ${extraMem.join(', ')}`)
  if (task.effects.length) reasons.push(`protected effects require Commander approval: ${task.effects.join(', ')}`)
  return reasons.length ? { verdict: 'ESCALATE', reasons, to: agent.spec.escalationPath } : { verdict: 'IN_SCOPE' }
}

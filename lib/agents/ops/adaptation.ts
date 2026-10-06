import { randomUUID } from 'node:crypto'
import type { AgentOpsLog } from './log'
import { isCommander } from './lifecycle'
import { deriveAgents } from './registry'
import { FORBIDDEN_ADAPTATIONS, MEMORY_SCOPES, SAFE_PERMISSIONS, type Actor, type AdaptationKind, type AdaptationProposal, type MemoryScope, type SafePermission } from './types'

export class AdaptationError extends Error { constructor(public readonly code: 'FORBIDDEN_KIND' | 'OUT_OF_BOUNDS' | 'INVALID' | 'NOT_AUTHORIZED', msg: string) { super(msg) } }

const ALLOWED: readonly AdaptationKind[] = ['workflow_change', 'narrow_task_classification', 'broaden_task_classification', 'retrieval_strategy_update', 'weak_tool_flag', 'permission_change_request', 'retire_step']
/** Adaptation kinds that widen what an agent may do and therefore always need a Commander decision. */
export const REQUIRES_COMMANDER = new Set<AdaptationKind>(['permission_change_request', 'broaden_task_classification'])

export function proposeAdaptation(
  log: AgentOpsLog,
  agentId: string,
  input: { kind: string; summary: string; evidenceRefs: string[]; requestedPermissions?: SafePermission[]; requestedMemory?: MemoryScope[] },
  now: Date = new Date(),
): AdaptationProposal {
  if ((FORBIDDEN_ADAPTATIONS as readonly string[]).includes(input.kind)) throw new AdaptationError('FORBIDDEN_KIND', `${input.kind} is forbidden for adaptive agents`)
  if (!(ALLOWED as readonly string[]).includes(input.kind)) throw new AdaptationError('FORBIDDEN_KIND', `unknown adaptation kind: ${input.kind}`)
  const kind = input.kind as AdaptationKind
  const agent = deriveAgents(log).agents.get(agentId)
  if (!agent) throw new AdaptationError('INVALID', `unknown agent: ${agentId}`)
  if (agent.state === 'RETIRED' || agent.state === 'REJECTED') throw new AdaptationError('INVALID', `agent is ${agent.state}`)
  if (!input.summary.trim() || input.evidenceRefs.filter((r) => r.trim()).length === 0) throw new AdaptationError('INVALID', 'summary and at least one evidence reference required')
  const perms = input.requestedPermissions ?? []
  const mem = input.requestedMemory ?? []
  if (kind !== 'permission_change_request' && (perms.length || mem.length)) throw new AdaptationError('OUT_OF_BOUNDS', 'only permission_change_request may carry permission or memory requests')
  if (kind === 'permission_change_request') {
    if (!perms.length && !mem.length) throw new AdaptationError('INVALID', 'permission change must name what is requested')
    if (perms.some((p) => !SAFE_PERMISSIONS.includes(p)) || mem.some((m) => !MEMORY_SCOPES.includes(m))) throw new AdaptationError('OUT_OF_BOUNDS', 'only safe permissions and known memory scopes can be requested (protected effects are never requestable here)')
  }
  const proposal: AdaptationProposal = { id: `adapt-${randomUUID()}`, agentId, kind, summary: input.summary.trim(), evidenceRefs: input.evidenceRefs, requestedPermissions: perms.length ? perms : undefined, requestedMemory: mem.length ? mem : undefined, createdAt: now.toISOString(), applied: false }
  log.append({ t: 'adaptation', proposal })
  return proposal
}

export function decideAdaptation(log: AgentOpsLog, proposalId: string, status: 'APPROVED' | 'REJECTED', by: Actor, reason: string, now: Date = new Date()) {
  if (!isCommander(by)) throw new AdaptationError('NOT_AUTHORIZED', 'adaptation decisions require a Commander')
  if (!reason.trim()) throw new AdaptationError('INVALID', 'reason required')
  if (!log.view().records.some((r) => r.t === 'adaptation' && r.proposal.id === proposalId)) throw new AdaptationError('INVALID', `unknown proposal: ${proposalId}`)
  return log.append({ t: 'decision', proposalId, status, by, at: now.toISOString(), reason })
}

/** Applies an APPROVED permission_change_request as a new agent version. deriveAgents re-verifies the approval on every replay. */
export function applyApprovedScopeChange(log: AgentOpsLog, proposalId: string, by: Actor, now: Date = new Date()) {
  if (!isCommander(by)) throw new AdaptationError('NOT_AUTHORIZED', 'applying a scope change requires a Commander')
  const rec = log.view().records.find((r) => r.t === 'adaptation' && r.proposal.id === proposalId)
  if (!rec || rec.t !== 'adaptation' || rec.proposal.kind !== 'permission_change_request') throw new AdaptationError('INVALID', 'not a permission change request')
  const agent = deriveAgents(log).agents.get(rec.proposal.agentId)
  if (!agent) throw new AdaptationError('INVALID', 'unknown agent')
  if (deriveAgents(log).appliedScopes.has(proposalId)) throw new AdaptationError('INVALID', 'scope change already applied')
  const latest = [...log.view().records].reverse().find((r) => r.t === 'decision' && r.proposalId === proposalId)
  if (!latest || latest.t !== 'decision' || latest.status !== 'APPROVED') throw new AdaptationError('NOT_AUTHORIZED', 'no Commander approval on record for this scope change')
  const permissionScope = [...new Set([...agent.spec.permissionScope, ...(rec.proposal.requestedPermissions ?? [])])]
  const memoryScope = [...new Set([...agent.spec.memoryScope, ...(rec.proposal.requestedMemory ?? [])])]
  log.append({ t: 'scope', agentId: agent.spec.id, proposalId, permissionScope, memoryScope, by, at: now.toISOString() })
  const after = deriveAgents(log).agents.get(agent.spec.id)!
  if (after.spec.version === agent.spec.version) throw new AdaptationError('NOT_AUTHORIZED', 'scope change was not applied: no Commander approval on record')
  return after
}

import { AgentOpsLog } from './log'
import { AgentTransitionError, assertTransition } from './lifecycle'
import { missingCriteria } from './need'
import { PROTECTED_EFFECTS, SAFE_PERMISSIONS, SPECIALIZATIONS, MEMORY_SCOPES, RISK_CLASSES, type Actor, type AgentSpec, type AgentState, type NeedRecord, type TransitionRecord } from './types'

export type AgentView = { spec: AgentSpec; state: AgentState; history: TransitionRecord[] }

export class NeedGateError extends Error { constructor(public readonly missing: string[], msg: string) { super(msg) } }

export type AgentDraft = Omit<AgentSpec, 'id' | 'createdAt' | 'version' | 'needId'> & { id?: string }

/** Derives agents from the log by replaying only transitions that are valid at their position (defends against forged records). */
export function deriveAgents(log: AgentOpsLog): { agents: Map<string, AgentView>; needs: Map<string, NeedRecord>; rejectedTransitions: number } {
  const v = log.view()
  const needs = new Map<string, NeedRecord>()
  const agents = new Map<string, AgentView>()
  let rejectedTransitions = 0
  for (const r of v.records) {
    if (r.t === 'need') needs.set(r.need.id, r.need)
    else if (r.t === 'agent') { if (!agents.has(r.agent.id)) agents.set(r.agent.id, { spec: r.agent, state: 'PROPOSED', history: [] }) }
    else if (r.t === 'transition') {
      const a = agents.get(r.tr.agentId)
      if (!a || a.state !== r.tr.from) { rejectedTransitions += 1; continue }
      try { assertTransition(r.tr.from, r.tr.to, r.tr.by) } catch { rejectedTransitions += 1; continue }
      a.state = r.tr.to
      a.history.push(r.tr)
    }
  }
  return { agents, needs, rejectedTransitions }
}

export class AgentRegistry {
  constructor(readonly log: AgentOpsLog) {}

  recordNeed(need: NeedRecord): void { this.log.append({ t: 'need', need }) }

  /** Propose an agent from a recorded need. Refused unless all seven roadmap criteria are evidenced. */
  propose(needId: string, draft: AgentDraft, now: Date = new Date()): AgentSpec {
    const need = deriveAgents(this.log).needs.get(needId)
    if (!need) throw new Error(`unknown need: ${needId}`)
    const missing = missingCriteria(need)
    if (missing.length) throw new NeedGateError(missing, `agent proposal refused: no evidence for ${missing.join(', ')}`)
    if (!SPECIALIZATIONS.includes(draft.specialization)) throw new Error(`unknown specialization: ${draft.specialization}`)
    if (!RISK_CLASSES.includes(draft.riskCeiling)) throw new Error('unknown risk ceiling')
    if (!draft.permissionScope.length || draft.permissionScope.some((p) => !SAFE_PERMISSIONS.includes(p))) throw new Error('permission scope must be a non-empty set of safe permissions')
    if ((draft.permissionScope as string[]).some((p) => (PROTECTED_EFFECTS as readonly string[]).includes(p))) throw new Error('protected effects cannot be part of a permission scope')
    if (!draft.memoryScope.length || draft.memoryScope.some((m) => !MEMORY_SCOPES.includes(m))) throw new Error('memory scope must be a non-empty set of known scopes')
    if (!draft.ioContract.input.trim() || !draft.ioContract.output.trim()) throw new Error('io contract required')
    if (!draft.escalationPath.trim() || !draft.reviewProcess.trim()) throw new Error('escalation path and review process required')
    const id = draft.id ?? `agent-${draft.specialization}-${needId.slice(-8)}`
    if (deriveAgents(this.log).agents.has(id)) throw new Error(`agent already exists: ${id}`)
    const spec: AgentSpec = { ...draft, id, needId, version: 1, createdAt: now.toISOString() }
    this.log.append({ t: 'agent', agent: spec })
    return spec
  }

  transition(agentId: string, to: AgentState, by: Actor, reason: string, now: Date = new Date()): AgentView {
    if (!reason.trim()) throw new Error('transition reason required')
    const cur = deriveAgents(this.log).agents.get(agentId)
    if (!cur) throw new Error(`unknown agent: ${agentId}`)
    assertTransition(cur.state, to, by) // throws AgentTransitionError, nothing written
    this.log.append({ t: 'transition', tr: { agentId, from: cur.state, to, by, at: now.toISOString(), reason } })
    return deriveAgents(this.log).agents.get(agentId)!
  }

  get(agentId: string): AgentView | undefined { return deriveAgents(this.log).agents.get(agentId) }
  list(): AgentView[] { return [...deriveAgents(this.log).agents.values()] }
}
export { AgentTransitionError }

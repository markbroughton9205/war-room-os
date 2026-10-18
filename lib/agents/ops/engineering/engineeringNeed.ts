import { createHash } from 'node:crypto'
import type { AgentOpsLog } from '../log'
import { detectNeed, missingCriteria } from '../need'
import { AgentRegistry, deriveAgents, type AgentView, NeedGateError } from '../registry'
import type { Actor, EngineeringTool, NeedEvidenceItem, NeedRecord, RiskClass, Specialization, Unknown } from '../types'
import { MAX_RUNNING_ASSIGNMENTS, deriveAssignments } from './assignments'

export const MAX_ACTIVE_AGENTS = 12

/** What each engineering capability needs. The mapping describes requirements, not proof that any agent can do it. */
export const CAPABILITIES: Record<string, { label: string; tools: EngineeringTool[]; specializations: Specialization[] }> = {
  feature_implementation: { label: 'multi-layer feature implementation', tools: ['read_workspace', 'write_workspace', 'run_typecheck', 'run_workspace_tests', 'model_local'], specializations: ['feature_implementation', 'codebase_triage'] },
  defect_repair: { label: 'evidence-driven defect repair', tools: ['read_workspace', 'write_workspace', 'run_workspace_tests', 'model_local'], specializations: ['defect_repair', 'codebase_triage'] },
  test_authoring: { label: 'test authoring', tools: ['read_workspace', 'write_workspace', 'run_workspace_tests'], specializations: ['test_authoring', 'feature_implementation'] },
  repository_analysis: { label: 'read-only repository analysis', tools: ['read_workspace'], specializations: ['codebase_triage'] },
}

/** Evidence strength of a capability claim. Only DEMONSTRATED/EVIDENCE_BACKED count as proven. */
export type EvidenceType = 'DEMONSTRATED' | 'EVIDENCE_BACKED' | 'INFERRED' | 'UNTESTED'
export type CapabilityAssessment = {
  agentId: string
  capability: string
  type: EvidenceType
  proven: boolean
  completedPassed: number
  failedOrFailing: number
  successRate: number | Unknown
  contradicted: boolean
  basis: string[]
}

export function capabilityEvidence(log: AgentOpsLog, agent: AgentView, capability: string): CapabilityAssessment {
  const def = CAPABILITIES[capability]
  const asg = [...deriveAssignments(log).assignments.values()].filter((a) => a.assignment.agentId === agent.spec.id && a.assignment.capabilities.includes(capability))
  const passed = asg.filter((a) => a.state === 'COMPLETED' && a.outcome?.validation === 'PASSED')
  const failing = asg.filter((a) => a.state === 'FAILED' || (a.state === 'COMPLETED' && a.outcome?.validation === 'FAILED'))
  const terminal = passed.length + failing.length
  const successRate = terminal >= 2 ? passed.length / terminal : 'UNKNOWN'
  const contradicted = failing.length > 0 && failing.length >= passed.length
  const toolsOk = !!def && def.tools.every((t) => (agent.spec.toolScope ?? []).includes(t))
  const specOk = !!def && def.specializations.includes(agent.spec.specialization)
  let type: EvidenceType = 'UNTESTED'
  const basis: string[] = []
  if (passed.length >= 2 && !contradicted) { type = 'DEMONSTRATED'; basis.push(`${passed.length} completed assignments passed validation`, ...passed.slice(0, 3).map((a) => `assignment ${a.assignment.id}`)) }
  else if (passed.length === 1 && !contradicted) { type = 'EVIDENCE_BACKED'; basis.push(`1 completed assignment passed validation (${passed[0].assignment.id}); not yet repeated`) }
  else if (toolsOk && specOk) { type = 'INFERRED'; basis.push(`specialization ${agent.spec.specialization} and tool scope match ${capability}; no completed validated assignment`) }
  else basis.push(toolsOk ? 'tool scope matches but specialization does not' : 'tool scope does not cover this capability')
  if (contradicted) basis.push(`${failing.length} failed assignment(s) contradict this capability`)
  return { agentId: agent.spec.id, capability, type, proven: type === 'DEMONSTRATED' || type === 'EVIDENCE_BACKED', completedPassed: passed.length, failedOrFailing: failing.length, successRate, contradicted, basis }
}

export type Candidate = {
  agentId: string
  state: string
  specialization: string
  assessments: CapabilityAssessment[]
  weakest: EvidenceType
  proven: boolean
  available: boolean
  unavailableReason: string | null
  liveAssignments: number
}
const RANK: Record<EvidenceType, number> = { DEMONSTRATED: 3, EVIDENCE_BACKED: 2, INFERRED: 1, UNTESTED: 0 }

export type SpecialistDecision = {
  action: 'REUSE' | 'REUSE_UNPROVEN' | 'CREATE_PROPOSAL' | 'NO_SPECIALIST_AVAILABLE'
  agentId: string | null
  candidates: Candidate[]
  reasons: string[]
  /** Concrete, evidence-based benefit of the chosen action (never "parallelism is available"). */
  benefit: string
  resources: { liveAssignments: number; maxAssignments: number; activeAgents: number; maxActiveAgents: number }
  creation: { allowed: boolean; missingCriteria: string[]; needId: string | null } | null
}

export function decideSpecialist(log: AgentOpsLog, req: { taskClass: string; capabilities: string[]; riskClass?: RiskClass; excludeAgents?: string[] }, now: Date = new Date()): SpecialistDecision {
  const agents = [...deriveAgents(log).agents.values()]
  const asg = [...deriveAssignments(log).assignments.values()]
  const live = asg.filter((a) => ['RUNNING', 'PAUSED', 'BLOCKED', 'CANCEL_REQUESTED', 'STOPPING'].includes(a.state))
  const resources = { liveAssignments: live.length, maxAssignments: MAX_RUNNING_ASSIGNMENTS, activeAgents: agents.filter((a) => a.state === 'ACTIVE').length, maxActiveAgents: MAX_ACTIVE_AGENTS }
  const needTools = [...new Set(req.capabilities.flatMap((c) => CAPABILITIES[c]?.tools ?? []))]
  const reasons: string[] = []
  if (req.capabilities.some((c) => !CAPABILITIES[c])) reasons.push(`unknown capability requested: ${req.capabilities.filter((c) => !CAPABILITIES[c]).join(', ')}`)
  const candidates: Candidate[] = agents
    .filter((a) => !(req.excludeAgents ?? []).includes(a.spec.id) && needTools.every((t) => (a.spec.toolScope ?? []).includes(t)))
    .map((a) => {
      const assessments = req.capabilities.map((c) => capabilityEvidence(log, a, c))
      const weakest = assessments.reduce<EvidenceType>((w, x) => (RANK[x.type] < RANK[w] ? x.type : w), 'DEMONSTRATED')
      const liveCount = live.filter((x) => x.assignment.agentId === a.spec.id).length
      const unavailableReason = a.state !== 'ACTIVE' ? `agent is ${a.state}` : liveCount > 0 ? 'agent already has a live assignment' : resources.liveAssignments >= MAX_RUNNING_ASSIGNMENTS ? 'global concurrency limit reached' : null
      return { agentId: a.spec.id, state: a.state, specialization: a.spec.specialization, assessments, weakest, proven: assessments.every((x) => x.proven), available: unavailableReason === null, unavailableReason, liveAssignments: liveCount }
    })
    .sort((x, y) => RANK[y.weakest] - RANK[x.weakest] || (x.assessments.some((a) => a.contradicted) ? 1 : 0) - (y.assessments.some((a) => a.contradicted) ? 1 : 0) || x.liveAssignments - y.liveAssignments || x.agentId.localeCompare(y.agentId))
  const usable = candidates.filter((c) => c.available && !c.assessments.some((a) => a.contradicted))
  const provenAvail = usable.find((c) => c.proven)
  if (provenAvail) {
    return { action: 'REUSE', agentId: provenAvail.agentId, candidates, reasons: [...reasons, `${provenAvail.agentId} has ${provenAvail.weakest} evidence for ${req.capabilities.join(', ')} and is available`], benefit: 'reuses an agent with validated outcomes on this capability; avoids creating a duplicate specialist', resources, creation: null }
  }
  // creation only with real recurring-work evidence, a concrete shortfall and free resources
  const need = needFromAssignments(log, req.taskClass, now)
  const shortfall = candidates.length === 0 ? 'no existing agent has the required tool scope' : candidates.every((c) => !c.proven) ? 'existing candidates have no validated outcomes on this capability' : 'proven candidates are unavailable or contradicted'
  const resourcesFree = resources.liveAssignments < MAX_RUNNING_ASSIGNMENTS && resources.activeAgents < MAX_ACTIVE_AGENTS
  const creation = { allowed: need.missing.length === 0 && resourcesFree, missingCriteria: need.missing, needId: need.need?.id ?? null }
  if (creation.allowed) {
    return { action: 'CREATE_PROPOSAL', agentId: null, candidates, reasons: [...reasons, shortfall, `recurring ${req.taskClass} work with passed validation is evidenced (${need.refs.length} assignments)`], benefit: `a dedicated specialist is justified by ${need.refs.length} completed validated ${req.taskClass} assignments (recurring pattern), and no existing agent can take it`, resources, creation }
  }
  const fallback = usable[0]
  if (fallback) {
    return { action: 'REUSE_UNPROVEN', agentId: fallback.agentId, candidates, reasons: [...reasons, shortfall, `capability is ${fallback.weakest} (not proven); creation not justified: ${creation.missingCriteria.length ? 'NO EVIDENCE for ' + creation.missingCriteria.join(', ') : 'resources unavailable'}`], benefit: 'uses an existing agent whose suitability is not yet proven; outcome will become evidence', resources, creation }
  }
  return { action: 'NO_SPECIALIST_AVAILABLE', agentId: null, candidates, reasons: [...reasons, shortfall, creation.missingCriteria.length ? `creation refused: NO EVIDENCE for ${creation.missingCriteria.join(', ')}` : 'creation blocked by resource limits'], benefit: 'none: the parent mission should proceed without a specialist or escalate to the Commander', resources, creation }
}

/** Builds need evidence ONLY from real completed, validated assignments of this task class. */
export function needFromAssignments(log: AgentOpsLog, taskClass: string, now: Date = new Date()): { need: NeedRecord | null; missing: string[]; refs: string[] } {
  const done = [...deriveAssignments(log).assignments.values()].filter((a) => a.assignment.taskClass === taskClass && a.state === 'COMPLETED' && a.outcome?.validation === 'PASSED')
  const refs = done.map((a) => `assignment:${a.assignment.id}`)
  const ev: NeedEvidenceItem[] = []
  if (done.length >= 2) {
    const tools = [...new Set(done.flatMap((a) => a.assignment.tools))]
    const outputs = [...new Set(done.flatMap((a) => a.assignment.expectedOutputs))].slice(0, 5)
    const ms = done.map((a) => a.outcome?.latencyMs).filter((x): x is number => typeof x === 'number')
    ev.push(
      { criterion: 'recurring_task_pattern', summary: `${done.length} completed ${taskClass} assignments across missions ${[...new Set(done.map((a) => a.assignment.parentMission.id))].join(', ')}`, evidenceRefs: refs },
      { criterion: 'validated_workflow_with_measurable_value', summary: `all ${done.length} passed validation${ms.length ? `; mean latency ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)}ms` : '; latency UNKNOWN'}`, evidenceRefs: refs },
      { criterion: 'clear_permission_scope', summary: `tools actually used and authorized: ${tools.join(', ')}`, evidenceRefs: refs },
      { criterion: 'useful_memory_boundary', summary: 'scope limited to the bound workspace, assignment checkpoints and agent operational memory', evidenceRefs: refs },
      { criterion: 'repeatable_io_contract', summary: `consistent expected outputs: ${outputs.join('; ')}`, evidenceRefs: refs },
      { criterion: 'known_escalation_path', summary: 'escalation to the Commander via assignment BLOCKED/FAILED states and the operator surface', evidenceRefs: [`assignment-states:${done[0].assignment.id}`] },
      { criterion: 'failure_drift_review_process', summary: 'outcomes feed evaluateAgent and lesson capture; Commander reviews failures', evidenceRefs: [`evaluation:${taskClass}`] },
    )
  }
  const id = `need-eng-${taskClass}-${createHash('sha256').update(refs.sort().join('|')).digest('hex').slice(0, 8)}`
  const need = done.length >= 2 ? detectNeed({ id, title: `Recurring ${taskClass} engineering work`, evidence: ev }, now) : null
  const missing = need ? missingCriteria(need) : ['recurring_task_pattern', 'validated_workflow_with_measurable_value', 'clear_permission_scope', 'useful_memory_boundary', 'repeatable_io_contract', 'known_escalation_path', 'failure_drift_review_process']
  return { need, missing, refs }
}

/** Proposes a specialist (never approves or activates it: the Commander does). Idempotent by task class. */
export function proposeSpecialist(log: AgentOpsLog, input: { taskClass: string; capability: string; name: string; purpose: string; workspaceNote: string }, now: Date = new Date()): { agentId: string; created: boolean } {
  const reg = new AgentRegistry(log)
  const agentId = `agent-eng-${input.taskClass}`
  if (reg.get(agentId)) return { agentId, created: false }
  const nd = needFromAssignments(log, input.taskClass, now)
  if (!nd.need || nd.missing.length) throw new NeedGateError(nd.missing, `specialist proposal refused: NO EVIDENCE for ${nd.missing.join(', ')}`)
  const def = CAPABILITIES[input.capability]
  if (!def) throw new Error(`unknown capability: ${input.capability}`)
  const existingNeed = [...log.view().records].some((r) => r.t === 'need' && r.need.id === nd.need!.id)
  if (!existingNeed) reg.recordNeed(nd.need)
  reg.propose(nd.need.id, {
    id: agentId, name: input.name, purpose: input.purpose, specialization: def.specializations[0], riskCeiling: 'moderate',
    permissionScope: ['read_repo', 'write_own_reports'], memoryScope: ['project_knowledge', 'agent_operational'],
    ioContract: { input: 'assignment (objective, acceptance criteria, bound workspace)', output: 'validated changes plus outcome record' },
    escalationPath: 'commander', reviewProcess: 'Commander reviews assignment outcomes, failures and lessons; evaluation recommends narrow/retrain/retire',
    toolScope: def.tools,
  }, now)
  return { agentId, created: true }
}
export type { Actor }

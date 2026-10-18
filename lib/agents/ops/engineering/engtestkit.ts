import { AgentOpsLog } from '../log'
import { AgentRegistry, type AgentDraft } from '../registry'
import { fullNeed, draft, NOW, tmp } from '../testkit'
import type { AssignmentOutcome, EngineeringTool, Specialization } from '../types'
import { assign, completeAssignment, startAssignment, keyFor, type AssignDraft } from './assignments'

export { harness, NOW, mins, tmp } from '../testkit'
export const C = 'commander:mark'
export const ALL_TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']

export function engWorld() {
  const dir = tmp()
  const log = new AgentOpsLog(dir)
  const reg = new AgentRegistry(log)
  return { dir, log, reg }
}

/** An ACTIVE agent that went through the need gate and Commander approval. */
export function addAgent(w: ReturnType<typeof engWorld>, id: string, specialization: Specialization = 'feature_implementation', toolScope: EngineeringTool[] = ALL_TOOLS, over: Partial<AgentDraft> = {}) {
  const need = fullNeed(`need for ${id}`)
  w.reg.recordNeed(need)
  const spec = w.reg.propose(need.id, draft({ id, name: id, specialization, permissionScope: ['read_repo', 'write_own_reports'], memoryScope: ['project_knowledge', 'agent_operational'], toolScope, ...over }), NOW)
  w.reg.transition(spec.id, 'APPROVED', C, 'ok', NOW)
  w.reg.transition(spec.id, 'ACTIVE', C, 'ok', NOW)
  return spec
}

export const passed = (over: Partial<AssignmentOutcome> = {}): AssignmentOutcome => ({ validation: 'PASSED', summary: 'validated', artifacts: ['a.ts'], executor: { provider: 'test-double', model: 'scripted' }, tokens: 'UNKNOWN', latencyMs: 1000, retries: 0, ...over })

export function draftFor(agentId: string, mission: string, objective: string, over: Partial<AssignDraft> = {}): AssignDraft {
  return {
    idempotencyKey: keyFor(mission, 'feature_implementation', objective), agentId, parentMission: { id: mission, title: `mission ${mission}` }, taskClass: 'feature_implementation', capabilities: ['feature_implementation'],
    objective, expectedOutputs: ['working feature', 'passing tests'], completionConditions: ['typecheck passes', 'tests pass'],
    workspace: { id: 'ws1', root: '/tmp/ws1', kind: 'sandbox' }, tools: ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local'],
    limits: { maxSteps: 10, maxRuntimeMs: 60_000, maxModelCalls: 10, maxRetries: 2 }, dependencies: [], ...over,
  }
}

/** Run an assignment to COMPLETED with the given outcome (mechanics helper, clearly a test double). */
export function doneAssignment(w: ReturnType<typeof engWorld>, agentId: string, mission: string, objective: string, outcome: AssignmentOutcome = passed(), over: Partial<AssignDraft> = {}) {
  const { assignment } = assign(w.log, draftFor(agentId, mission, objective, over), C, NOW)
  startAssignment(w.log, assignment.id, 'system:runner', NOW)
  completeAssignment(w.log, assignment.id, 'system:runner', outcome, NOW)
  return assignment
}

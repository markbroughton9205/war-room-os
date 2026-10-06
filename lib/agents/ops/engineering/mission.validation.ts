/**
 * Phase 10 continuation: END-TO-END specialist mission through the real components (need gate, evidence-typed capability, reuse-vs-create decision,
 * Commander lifecycle, durable assignments, the complete-feature workflow with real files/commands/HTTP verification, checkpoints, restart,
 * pause/resume/cancel, limits, duplicate prevention, retirement).  The MODEL is a labelled scripted double (mechanics); real-model evidence lives in the
 * Forge benchmarks. Run: pnpm run validate:agent-eng-mission
 */
import path from 'node:path'
import { AgentOpsLog } from '../log'
import { harness, engWorld, addAgent, draftFor, C, NOW, tmp } from './engtestkit'
import { assign, completeAssignment, deriveAssignments, pauseAssignment, requestCancel, resumeAssignment, startAssignment } from './assignments'
import { CHAT_FEATURE, CHAT_REFERENCE, CHAT_VERIFY_SCRIPT, makeChatApp } from './chatFixture'
import { runFeatureWorkflow } from './workflow'
import { Workspace } from './runtime/workspaceFs'
import { makeIndependentVerification } from './runtime/verifier'
import { ScriptedModel, fenced } from './scriptedModel'
import { capabilityEvidence, decideSpecialist, proposeSpecialist } from './engineeringNeed'
import { continueAssignment, latestCheckpoint } from './continuity'
import { AgentRegistry, deriveAgents } from '../registry'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_MISSION_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const REQ = { request: CHAT_FEATURE.request, acceptance: CHAT_FEATURE.acceptance, hints: CHAT_FEATURE.hints }
const STORE_TEST = `import test from 'node:test'\nimport assert from 'node:assert'\nimport { mkdtempSync } from 'node:fs'\nimport { tmpdir } from 'node:os'\nimport path from 'node:path'\nprocess.env.CHAT_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'store-')), 'sessions.json')\nconst store = await import('../src/messageStore.mjs')\ntest('sessions round-trip through the data file', () => {\n  store.saveSessions([{ id: 'x', name: 'x', createdAt: 'now', messages: [] }])\n  assert.strictEqual(store.loadSessions()[0].id, 'x')\n})\n`
const good = (c: { kind: string; path: string | null }) => (c.kind === 'file' && c.path === 'test/messageStore.test.mjs' ? fenced(STORE_TEST) : c.kind === 'file' && c.path === 'test/chatService.test.mjs' ? 'NO_CHANGE' : c.kind === 'file' && c.path && CHAT_REFERENCE[c.path] ? fenced(CHAT_REFERENCE[c.path]) : null)

const w = engWorld()
const generalist = addAgent(w, 'agent-generalist', 'feature_implementation')
const limits = { maxSteps: 30, maxRuntimeMs: 600_000, maxModelCalls: 40, maxRetries: 3 }
async function mission(missionId: string, agentId: string, over: { crash?: number; model?: ScriptedModel } = {}) {
  const root = makeChatApp(path.join(tmp(), missionId))
  const asg = assign(w.log, draftFor(agentId, missionId, CHAT_FEATURE.request, { workspace: { id: missionId, root, kind: 'sandbox' }, limits }), C, NOW).assignment
  startAssignment(w.log, asg.id, 'system:runner', NOW)
  const model = over.model ?? new ScriptedModel(good)
  const res = await runFeatureWorkflow({ log: w.log, assignmentId: asg.id, ws: new Workspace(root), model, tools: TOOLS, finalVerification: makeIndependentVerification('independent verification', tmp(), 'verify.mjs', CHAT_VERIFY_SCRIPT, root), crashAfterSteps: over.crash }, REQ)
  return { asg, root, res, model }
}
const ask = () => decideSpecialist(w.log, { taskClass: 'feature_implementation', capabilities: ['feature_implementation'] }, NOW)

// 1. need -> capability evaluation -> decision, from evidence only
const d0 = ask()
check('M01_with_no_history_the_decision_is_an_unproven_reuse_and_creation_is_refused_naming_the_missing_evidence', d0.action === 'REUSE_UNPROVEN' && d0.agentId === generalist.id && d0.creation!.allowed === false && d0.creation!.missingCriteria.length > 0 && d0.candidates[0].weakest !== 'DEMONSTRATED', JSON.stringify([d0.action, d0.reasons]))
const m1 = await mission('mission-1', generalist.id)
check('M02_mission_one_runs_the_full_workflow_to_COMPLETED_with_independent_verification_passed', m1.res.status === 'COMPLETED' && deriveAssignments(w.log).assignments.get(m1.asg.id)!.outcome!.validation === 'PASSED')
const m2 = await mission('mission-2', generalist.id)
const cap = capabilityEvidence(w.log, deriveAgents(w.log).agents.get(generalist.id)!, 'feature_implementation')
const d2 = ask()
check('M03_two_validated_outcomes_make_the_capability_DEMONSTRATED_and_the_decision_REUSE_with_evidence_cited', m2.res.status === 'COMPLETED' && cap.type === 'DEMONSTRATED' && d2.action === 'REUSE' && d2.agentId === generalist.id && d2.reasons.join(' ').includes('DEMONSTRATED'), `${cap.type} ${d2.action}`)

// 2. the proven agent is busy -> a specialist is justified by the recurring evidence, proposed, and only the Commander activates it
const busyRoot = makeChatApp(path.join(tmp(), 'busy'))
const busy = assign(w.log, draftFor(generalist.id, 'mission-busy', 'long running work', { workspace: { id: 'busy', root: busyRoot, kind: 'sandbox' }, limits }), C, NOW).assignment
startAssignment(w.log, busy.id, 'system:runner', NOW)
const d3 = ask()
check('M04_when_the_proven_agent_is_busy_creation_is_justified_by_the_two_completed_assignments_not_by_parallelism_alone', d3.action === 'CREATE_PROPOSAL' && d3.creation!.allowed && d3.creation!.missingCriteria.length === 0 && /recurring/.test(d3.reasons.join(' ')), `${d3.action} ${d3.reasons.join(' | ')}`)
const prop = proposeSpecialist(w.log, { taskClass: 'feature_implementation', capability: 'feature_implementation', name: 'Feature specialist', purpose: 'implement persistent cross-layer features', workspaceNote: 'sandbox workspaces' }, NOW)
check('M05_the_proposal_is_PROPOSED_not_active_and_cannot_receive_work_until_the_Commander_approves_and_activates', prop.created && deriveAgents(w.log).agents.get(prop.agentId)!.state === 'PROPOSED' && (() => { try { assign(w.log, draftFor(prop.agentId, 'mission-x', 'x'), C, NOW); return false } catch { return true } })())
const reg = new AgentRegistry(w.log)
reg.transition(prop.agentId, 'APPROVED', C, 'recurring work evidenced', NOW); reg.transition(prop.agentId, 'ACTIVE', C, 'activate', NOW)
const m3 = await mission('mission-3', prop.agentId)
const capS = capabilityEvidence(w.log, deriveAgents(w.log).agents.get(prop.agentId)!, 'feature_implementation')
check('M06_the_specialist_does_real_work_and_its_capability_evidence_starts_at_EVIDENCE_BACKED_not_assumed_proven', m3.res.status === 'COMPLETED' && capS.type === 'EVIDENCE_BACKED', `${m3.res.status} ${capS.type}`)

// 3. specialist failure -> successor continuity (another agent finishes from the checkpoint)
const failing = new ScriptedModel((c) => (c.kind === 'file' && c.path === 'public/app.js' ? 'I am not sure how to do this.' : good(c)))
const m4 = await mission('mission-4', prop.agentId, { model: failing })
check('M07_a_specialist_failure_is_recorded_honestly_with_the_partial_work_checkpointed', m4.res.status === 'FAILED' && deriveAssignments(w.log).assignments.get(m4.asg.id)!.state === 'FAILED' && latestCheckpoint(w.log, m4.asg.id)!.state.fileChanges.length >= 3)
const contd = continueAssignment(w.log, m4.asg.id, generalist.id, C, 'specialist failed on the UI step; successor continues', NOW)
check('M08_a_successor_assignment_for_another_agent_is_created_once_and_linked_to_the_failed_one', contd.created)
// free the generalist, then run the successor
completeAssignment(w.log, busy.id, 'system:runner', { validation: 'PASSED', summary: 'long running work done', artifacts: [], executor: 'UNKNOWN', tokens: 'UNKNOWN', latencyMs: 'UNKNOWN', retries: 0 }, NOW)
startAssignment(w.log, contd.assignmentId, 'system:runner', NOW)
const succ = await runFeatureWorkflow({ log: w.log, assignmentId: contd.assignmentId, ws: new Workspace(m4.root), model: new ScriptedModel(good), tools: TOOLS, finalVerification: makeIndependentVerification('independent verification', tmp(), 'verify.mjs', CHAT_VERIFY_SCRIPT, m4.root) }, REQ)
check('M09_the_successor_completes_the_work_from_the_predecessor_checkpoint_with_independent_verification', succ.status === 'COMPLETED' && deriveAssignments(w.log).assignments.get(contd.assignmentId)!.state === 'COMPLETED')

// 4. restart: a brand-new log object over the same file reproduces the same durable state
const reopened = new AgentOpsLog(w.dir)
const a1 = [...deriveAssignments(w.log).assignments.values()].map((v) => `${v.assignment.id}:${v.state}`).sort().join()
const a2 = [...deriveAssignments(reopened).assignments.values()].map((v) => `${v.assignment.id}:${v.state}`).sort().join()
check('M10_after_a_restart_agents_assignments_and_checkpoints_are_identical_from_durable_state', a1 === a2 && deriveAgents(reopened).agents.get(prop.agentId)!.state === 'ACTIVE' && !!latestCheckpoint(reopened, m3.asg.id))

// 5. controls: duplicates, pause/resume, cancel, limits
const dup = assign(w.log, draftFor(prop.agentId, 'mission-3', CHAT_FEATURE.request, { workspace: { id: 'mission-3', root: m3.root, kind: 'sandbox' }, limits }), C, NOW)
check('M11_duplicate_work_is_prevented_the_same_mission_and_objective_returns_the_existing_assignment', !dup.created && dup.assignment.id === m3.asg.id)
const r5 = makeChatApp(path.join(tmp(), 'pc'))
const pc = assign(w.log, draftFor(prop.agentId, 'mission-pc', CHAT_FEATURE.request, { workspace: { id: 'pc', root: r5, kind: 'sandbox' }, limits }), C, NOW).assignment
startAssignment(w.log, pc.id, 'system:runner', NOW)
pauseAssignment(w.log, pc.id, C, 'hold', NOW)
const paused = await runFeatureWorkflow({ log: w.log, assignmentId: pc.id, ws: new Workspace(r5), model: new ScriptedModel(good), tools: TOOLS }, REQ)
resumeAssignment(w.log, pc.id, C, 'go', NOW)
requestCancel(w.log, pc.id, C, 'no longer needed', NOW)
const cancelled = await runFeatureWorkflow({ log: w.log, assignmentId: pc.id, ws: new Workspace(r5), model: new ScriptedModel(good), tools: TOOLS }, REQ)
check('M12_pause_blocks_all_work_and_a_cancel_is_acknowledged_and_stopped_at_a_safe_boundary', paused.status === 'PAUSED' && paused.modelCalls === 0 && cancelled.status === 'CANCELLED' && deriveAssignments(w.log).assignments.get(pc.id)!.cancellation === 'STOPPED')
const r6 = makeChatApp(path.join(tmp(), 'lim'))
const lim = assign(w.log, draftFor(generalist.id, 'mission-lim', CHAT_FEATURE.request, { workspace: { id: 'lim', root: r6, kind: 'sandbox' }, limits: { ...limits, maxModelCalls: 2 } }), C, NOW).assignment
startAssignment(w.log, lim.id, 'system:runner', NOW)
const limited = await runFeatureWorkflow({ log: w.log, assignmentId: lim.id, ws: new Workspace(r6), model: new ScriptedModel(good), tools: TOOLS }, REQ)
check('M13_the_model_call_ceiling_stops_the_work_and_is_never_exceeded_or_raised', limited.status === 'FAILED' && limited.modelCalls <= 2 && deriveAssignments(w.log).assignments.get(lim.id)!.assignment.limits.maxModelCalls === 2)

// 6. retirement: a retired specialist gets no new assignments, its history stays
reg.transition(prop.agentId, 'RETIRED', C, 'consolidating onto the generalist', NOW)
check('M14_a_retired_specialist_receives_no_new_assignments_and_keeps_its_evidence', (() => { try { assign(w.log, draftFor(prop.agentId, 'mission-new', 'new work'), C, NOW); return false } catch { return true } })() && ask().candidates.every((c) => c.agentId !== prop.agentId || !c.available))
finish()

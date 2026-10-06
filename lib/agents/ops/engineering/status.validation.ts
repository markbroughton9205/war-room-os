/** Phase 10 continuation: honest operational visibility + Commander-gated assignment controls. Run: pnpm run validate:agent-eng-status */
import path from 'node:path'
import { harness, engWorld, addAgent, draftFor, C, NOW, tmp } from './engtestkit'
import { assign, deriveAssignments, startAssignment } from './assignments'
import { CHAT_FEATURE, CHAT_REFERENCE, makeChatApp } from './chatFixture'
import { runFeatureWorkflow } from './workflow'
import { Workspace } from './runtime/workspaceFs'
import { ScriptedModel, fenced } from './scriptedModel'
import { buildAssignmentStatus, listAssignmentStatuses } from './status'
import { handleOpsControl, handleOpsRead } from '../api'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_STATUS_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const w = engWorld(); const agent = addAgent(w, 'agent-feature', 'feature_implementation')
const root = makeChatApp(path.join(tmp(), 'chat'))
const asg = assign(w.log, draftFor(agent.id, 'mission-chat', CHAT_FEATURE.request, { workspace: { id: 'ws', root, kind: 'sandbox' } }), C, NOW).assignment
const q = buildAssignmentStatus(w.log, deriveAssignments(w.log).assignments.get(asg.id)!)
check('S01_a_queued_assignment_shows_goal_and_honest_waiting_with_nothing_verified_and_no_invented_progress', q.goal === CHAT_FEATURE.request && q.doingNow === 'waiting to start' && q.verified.length === 0 && q.details.checkpointSeq === 'NONE' && q.details.modelCalls === 'UNKNOWN' && q.details.executor === 'UNKNOWN' && !('percent' in q))
startAssignment(w.log, asg.id, 'system:runner', NOW)
const base = (p: string) => new URL(`http://x/api/agents/ops?${p}`)
// pause via the Commander-gated API, then the runner honours it
let r = await handleOpsControl({ action: 'pauseAssignment', assignmentId: asg.id, reason: 'hold' }, 'commander:mark', w.log, NOW)
check('S02_commander_can_pause_and_a_non_commander_cannot', r.status === 200 && (await handleOpsControl({ action: 'pauseAssignment', assignmentId: asg.id }, null, w.log, NOW)).status === 403 && (await handleOpsControl({ action: 'pauseAssignment', assignmentId: asg.id }, 'system:x', w.log, NOW)).status === 403)
const paused = ((handleOpsRead(base(`section=assignment&id=${asg.id}`), w.log, NOW).body as { data: ReturnType<typeof buildAssignmentStatus> }).data)
check('S03_paused_status_says_no_work_is_happening_and_that_approval_is_needed_to_resume', paused.state === 'PAUSED' && paused.doingNow.includes('no work is happening') && paused.approvalNeeded === 'Commander must resume')
r = await handleOpsControl({ action: 'resumeAssignment', assignmentId: asg.id }, 'commander:mark', w.log, NOW)
const model = new ScriptedModel((c) => (c.kind === 'file' && c.path && CHAT_REFERENCE[c.path] ? fenced(CHAT_REFERENCE[c.path]) : null))
const res = await runFeatureWorkflow({ log: w.log, assignmentId: asg.id, ws: new Workspace(root), model, tools: TOOLS, crashAfterSteps: 2 }, { request: CHAT_FEATURE.request, acceptance: CHAT_FEATURE.acceptance, hints: CHAT_FEATURE.hints })
const mid = buildAssignmentStatus(w.log, deriveAssignments(w.log).assignments.get(asg.id)!)
check('S04_mid_run_status_derives_from_the_checkpoint_done_steps_are_verified_pending_steps_remain', res.status === 'CRASHED' && mid.details.steps.some((s) => s.status === 'DONE') && mid.remaining.length > 0 && mid.details.filesChanged.length >= 1 && typeof mid.details.checkpointSeq === 'number')
const c1 = await handleOpsControl({ action: 'cancelAssignment', assignmentId: asg.id, reason: 'stop' }, 'commander:mark', w.log, NOW)
const cx = buildAssignmentStatus(w.log, deriveAssignments(w.log).assignments.get(asg.id)!)
check('S05_cancel_is_a_request_202_whose_real_phase_is_visible_not_pretended_stopped', c1.status === 202 && cx.details.cancellation === 'REQUESTED' && cx.state === 'CANCEL_REQUESTED' && cx.doingNow.includes('safe point'))
check('S06_list_section_and_unknown_id_behave', listAssignmentStatuses(w.log).length === 1 && (handleOpsRead(base('section=assignment&id=nope'), w.log, NOW).status === 404) && (handleOpsRead(base('section=assignments'), w.log, NOW).status === 200))
check('S07_controls_on_unknown_assignments_fail_closed_without_writing', (await handleOpsControl({ action: 'pauseAssignment', assignmentId: 'asg-nope' }, 'commander:mark', w.log, NOW)).status >= 400)
finish()

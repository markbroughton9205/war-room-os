/** Phase 10 continuation: successor continuity — a successor starts from the predecessor's structured checkpoint. Run: pnpm run validate:agent-eng-successor */
import path from 'node:path'
import { harness, engWorld, addAgent, draftFor, C, NOW, tmp } from './engtestkit'
import { assign, deriveAssignments, interruptAssignment, startAssignment } from './assignments'
import { CHAT_FEATURE, CHAT_REFERENCE, makeChatApp } from './chatFixture'
import { runFeatureWorkflow } from './workflow'
import { Workspace } from './runtime/workspaceFs'
import { ScriptedModel, fenced } from './scriptedModel'
import { continueAssignment, latestCheckpoint } from './continuity'
import { seedFromHandoff } from './successor'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_SUCCESSOR_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']
const REQ = { request: CHAT_FEATURE.request, acceptance: CHAT_FEATURE.acceptance, hints: CHAT_FEATURE.hints }
const good = (c: { kind: string; path: string | null }) => (c.kind === 'file' && c.path && CHAT_REFERENCE[c.path] ? fenced(CHAT_REFERENCE[c.path]) : null)

async function crashed() {
  const w = engWorld(); const a = addAgent(w, 'agent-a'); const b = addAgent(w, 'agent-b')
  const root = makeChatApp(path.join(tmp(), 'chat'))
  const asg = assign(w.log, draftFor(a.id, 'mission-s', CHAT_FEATURE.request, { workspace: { id: 'ws', root, kind: 'sandbox' }, limits: { maxSteps: 30, maxRuntimeMs: 600_000, maxModelCalls: 40, maxRetries: 3 } }), C, NOW).assignment
  startAssignment(w.log, asg.id, 'system:runner', NOW)
  const m = new ScriptedModel(good)
  const r = await runFeatureWorkflow({ log: w.log, assignmentId: asg.id, ws: new Workspace(root), model: m, tools: TOOLS, crashAfterSteps: 3 }, REQ)
  interruptAssignment(w.log, asg.id, 'system:recovery', 'runner process died', NOW)
  return { w, a, b, root, asg, r }
}

const x = await crashed()
check('U01_predecessor_crashed_with_three_steps_done_and_a_structured_checkpoint', x.r.status === 'CRASHED' && latestCheckpoint(x.w.log, x.asg.id)!.state.steps.filter((s) => s.status === 'DONE').length === 3)
check('U02_without_a_handoff_there_is_no_seed', !seedFromHandoff(x.w.log, x.asg.id, new Workspace(x.root)).seeded)
const cont = continueAssignment(x.w.log, x.asg.id, x.b.id, C, 'predecessor died; successor continues', NOW)
startAssignment(x.w.log, cont.assignmentId, 'system:runner', NOW)
const seed = seedFromHandoff(x.w.log, cont.assignmentId, new Workspace(x.root))
check('U03_the_successor_seed_keeps_the_three_done_steps_and_returns_the_rest_to_PENDING', seed.seeded && seed.safe && seed.skip.length === 3 && seed.state.steps.filter((s) => s.status === 'DONE').length === 3 && seed.state.steps.filter((s) => s.status === 'PENDING').length >= 3, JSON.stringify(seed.seeded ? seed.skip : seed))
check('U04_the_seed_carries_file_hashes_and_doNotRepeat_from_the_predecessor_not_a_transcript', seed.seeded && seed.state.fileChanges.length === latestCheckpoint(x.w.log, x.asg.id)!.state.fileChanges.length && seed.state.objective === CHAT_FEATURE.request && JSON.stringify(seed.state).length < 20_000)
// drift: someone edited a DONE file after the crash
const y = await crashed()
const cont2 = continueAssignment(y.w.log, y.asg.id, y.b.id, C, 'continue', NOW)
const doneFile = latestCheckpoint(y.w.log, y.asg.id)!.state.fileChanges[0].path
new Workspace(y.root).write(doneFile, '// edited by someone else\n')
const seed2 = seedFromHandoff(y.w.log, cont2.assignmentId, new Workspace(y.root))
check('U05_a_drifted_file_makes_the_seed_unsafe_with_the_conflict_named', seed2.seeded && !seed2.safe && seed2.conflicts.some((c) => c.includes(doneFile)))
void deriveAssignments
finish()

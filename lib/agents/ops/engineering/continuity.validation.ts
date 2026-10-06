import { readFileSync } from 'node:fs'
/** Phase 10 continuation: checkpoints, consequential-action ledger, reconciliation, handoff, resume. Run: pnpm run validate:agent-eng-continuity */
import { harness, engWorld, addAgent, draftFor, passed, C, NOW } from './engtestkit'
import { AgentOpsLog } from '../log'
import { AssignmentError, assign, deriveAssignments, failAssignment, interruptAssignment, startAssignment } from './assignments'
import { ContinuityError, buildHandoffPacket, checkpointHistory, continueAssignment, effectStatus, handoffFor, latestCheckpoint, planResume, runEffectOnce, saveCheckpoint, sha256 } from './continuity'
import type { CheckpointState } from '../types'

const { check, finish } = harness('AGENT_ENG_CONTINUITY_VALIDATION')
const cpState = (over: Partial<CheckpointState> = {}): CheckpointState => ({
  objective: 'add persistent pinned notes', acceptanceCriteria: ['pinned notes survive restart'],
  steps: [
    { id: 's1', title: 'storage: persist pinned flag', status: 'DONE', layer: 'storage', files: ['src/notesStore.mjs'] },
    { id: 's2', title: 'domain: pinNote()', status: 'DONE', layer: 'domain', files: ['src/notesService.mjs'] },
    { id: 's3', title: 'api: PATCH /api/notes/:id', status: 'ACTIVE', layer: 'api', files: ['server.mjs'] },
    { id: 's4', title: 'ui: pin button', status: 'PENDING', layer: 'ui', files: ['public/app.js'] },
  ],
  currentStepId: 's3',
  fileChanges: [
    { path: 'src/notesStore.mjs', beforeHash: sha256('store-v1'), afterHash: sha256('store-v2'), stepId: 's1' },
    { path: 'src/notesService.mjs', beforeHash: sha256('svc-v1'), afterHash: sha256('svc-v2'), stepId: 's2' },
  ],
  artifacts: ['plan.json'], validations: [{ stepId: 's2', command: 'node --test test/', status: 'PASSED', at: NOW.toISOString(), outputHash: sha256('ok'), summary: '3 tests passed' }],
  blockers: [], effectsDone: ['write:src/notesStore.mjs', 'write:src/notesService.mjs'], doNotRepeat: [{ key: 'approach:rewrite-store-with-sqlite', reason: 'failed: adds an unavailable dependency' }], dependencies: [],
  workspace: { id: 'ws1', root: '/tmp/ws1', kind: 'sandbox', gitHead: 'UNKNOWN', baselineTreeHash: sha256('tree0'), baselineFileHashes: { 'src/notesStore.mjs': sha256('store-v1'), 'src/notesService.mjs': sha256('svc-v1'), 'server.mjs': sha256('srv-v1'), 'README.md': sha256('readme-v1') } },
  ...over,
})
const hashes = (m: Record<string, string>) => ({ fileHash: (p: string) => m[p] ?? null, allFileHashes: m })

const w = engWorld(); const a = addAgent(w, 'agent-a'); const b = addAgent(w, 'agent-b')
const asg = assign(w.log, draftFor(a.id, 'm1', 'pinned notes'), C, NOW).assignment
startAssignment(w.log, asg.id, 'system:r', NOW)

// ---- checkpoints
const seq1 = saveCheckpoint(w.log, asg.id, cpState({ steps: cpState().steps.map((s) => (s.id === 's2' ? { ...s, status: 'PENDING' as const } : s)), fileChanges: cpState().fileChanges.slice(0, 1) }), 'system:r', NOW)
const seq2 = saveCheckpoint(w.log, asg.id, cpState(), 'system:r', NOW)
check('L01_checkpoints_are_sequenced_latest_wins_and_history_is_kept', seq1 === 1 && seq2 === 2 && latestCheckpoint(w.log, asg.id)!.seq === 2 && checkpointHistory(w.log, asg.id).map((h) => h.done).join() === '1,2')
check('L02_checkpoint_contains_the_required_engineering_state', (() => { const s = latestCheckpoint(w.log, asg.id)!.state; return !!s.objective && s.acceptanceCriteria.length === 1 && s.steps.length === 4 && s.currentStepId === 's3' && s.fileChanges.length === 2 && s.validations.length === 1 && s.effectsDone.length === 2 && s.doNotRepeat.length === 1 && s.workspace.gitHead === 'UNKNOWN' && s.workspace.root === '/tmp/ws1' })())
const bad = (fn: () => unknown) => { try { fn(); return 'none' } catch (e) { return e instanceof ContinuityError ? e.code : 'other:' + (e as Error).message.slice(0, 40) } }
check('L03_unauthorized_actor_unknown_assignment_and_oversized_checkpoints_are_refused', bad(() => saveCheckpoint(w.log, asg.id, cpState(), 'agent:self', NOW)) === 'NOT_AUTHORIZED' && bad(() => saveCheckpoint(w.log, 'nope', cpState(), 'system:r', NOW)) === 'UNKNOWN_ASSIGNMENT' && bad(() => saveCheckpoint(w.log, asg.id, cpState({ validations: Array.from({ length: 121 }, () => cpState().validations[0]) }), 'system:r', NOW)) === 'INVALID')
// credential-like text is REDACTED before it is persisted (it is never stored, and it does not abort the assignment); a checkpoint with only secret text still saves
const secretSeq = saveCheckpoint(w.log, asg.id, cpState({ failureReason: 'key sk-abcdefghijklmnopqrstuvwxyz123456 leaked' }), 'system:r', NOW)
check('L03b_credential_like_checkpoint_text_is_redacted_never_persisted', !readFileSync(w.log.file, 'utf8').includes('sk-abcdefghijklmnopqrstuvwxyz123456') && latestCheckpoint(w.log, asg.id)!.state.failureReason!.includes('[REDACTED]') && secretSeq === 3)
// keep the sequence of the following checks stable: make the secret-bearing checkpoint identical to the previous one again
saveCheckpoint(w.log, asg.id, cpState(), 'system:r', NOW)

// ---- consequential-action ledger
let runs = 0
const files: Record<string, string> = { 'a.txt': sha256('v1') }
const write = (afterText: string) => async () => { runs += 1; const before = files['a.txt'] ?? null; files['a.txt'] = sha256(afterText); return { value: 'ok', fileChanges: [{ path: 'a.txt', beforeHash: before, afterHash: sha256(afterText), stepId: 's1' }] } }
const cur = (p: string) => files[p] ?? null
const o1 = await runEffectOnce(w.log, asg.id, 'write:a.txt', { kind: 'file_write', consequential: true, summary: 'write a.txt' }, write('v2'), cur)
const o2 = await runEffectOnce(w.log, asg.id, 'write:a.txt', { kind: 'file_write', consequential: true, summary: 'write a.txt' }, write('v2'), cur)
check('L04_a_completed_consequential_action_is_never_repeated', o1.ran && !o2.ran && o2.skipped === 'ALREADY_DONE' && runs === 1 && effectStatus(w.log, asg.id, 'write:a.txt').state === 'DONE')
// crash after the file landed but before DONE was recorded
files['b.txt'] = sha256('old')
const expectLanded = [{ path: 'b.txt', beforeHash: sha256('old'), afterHash: sha256('new'), stepId: 's2' }]
const { beginEffect } = await import('./continuity')
beginEffect(w.log, asg.id, 'write:b.txt', { kind: 'file_write', consequential: true, summary: 'write b.txt', fileChanges: expectLanded })
files['b.txt'] = sha256('new') // the write happened, then the process died
const before = runs
const o3 = await runEffectOnce(new AgentOpsLog(w.dir), asg.id, 'write:b.txt', { kind: 'file_write', consequential: true, summary: 'write b.txt' }, async () => { runs += 1; return { value: 'x' } }, cur)
check('L05_interrupted_effect_that_already_landed_is_reconciled_not_repeated', !o3.ran && o3.skipped === 'RECONCILED_LANDED' && runs === before && effectStatus(w.log, asg.id, 'write:b.txt').state === 'DONE')
files['c.txt'] = sha256('old'); beginEffect(w.log, asg.id, 'write:c.txt', { kind: 'file_write', consequential: true, summary: 'write c.txt', fileChanges: [{ path: 'c.txt', beforeHash: sha256('old'), afterHash: sha256('new'), stepId: 's2' }] })
const o4 = await runEffectOnce(w.log, asg.id, 'write:c.txt', { kind: 'file_write', consequential: true, summary: 'write c.txt' }, async () => { runs += 1; files['c.txt'] = sha256('new'); return { value: 'x', fileChanges: [{ path: 'c.txt', beforeHash: sha256('old'), afterHash: sha256('new'), stepId: 's2' }] } }, cur)
check('L06_interrupted_effect_that_never_landed_is_safely_re_run', o4.ran && effectStatus(w.log, asg.id, 'write:c.txt').state === 'DONE')
files['d.txt'] = sha256('old'); beginEffect(w.log, asg.id, 'write:d.txt', { kind: 'file_write', consequential: true, summary: 'write d.txt', fileChanges: [{ path: 'd.txt', beforeHash: sha256('old'), afterHash: sha256('new'), stepId: 's2' }] })
files['d.txt'] = sha256('someone else edited this')
const o5 = await runEffectOnce(w.log, asg.id, 'write:d.txt', { kind: 'file_write', consequential: true, summary: 'write d.txt' }, async () => { runs += 1; return { value: 'x' } }, cur)
check('L07_drifted_file_is_a_conflict_the_other_edit_is_never_overwritten', !o5.ran && !!o5.conflict && o5.conflict.includes('d.txt') && files['d.txt'] === sha256('someone else edited this'))
let testRuns = 0
for (let i = 0; i < 3; i++) await runEffectOnce(w.log, asg.id, 'test:all', { kind: 'test_run', consequential: false, summary: 'run tests' }, async () => { testRuns += 1; return { value: 'pass' } }, cur)
check('L08_non_consequential_validations_always_re_run_on_current_state', testRuns === 3)
const failer = async () => { await runEffectOnce(w.log, asg.id, 'cmd:boom', { kind: 'command', consequential: true, summary: 'boom' }, async () => { throw new Error('exit 1') }, cur) }
let threw = false; try { await failer() } catch { threw = true }
check('L09_failed_effects_are_recorded_and_surface_the_error', threw && effectStatus(w.log, asg.id, 'cmd:boom').state === 'FAILED')

// ---- resume planning
const intact = planResume(w.log, asg.id, hashes({ 'src/notesStore.mjs': sha256('store-v2'), 'src/notesService.mjs': sha256('svc-v2'), 'server.mjs': sha256('srv-v1'), 'README.md': sha256('readme-v1') }))
check('L10_resume_skips_done_steps_whose_files_are_intact_and_lists_remaining', intact.safeToResume && intact.skip.join() === 's1,s2' && intact.redo.length === 0 && intact.remaining.join() === 's3,s4' && intact.revalidate.join() === 'node --test test/')
const notApplied = planResume(w.log, asg.id, hashes({ 'src/notesStore.mjs': sha256('store-v2'), 'src/notesService.mjs': sha256('svc-v1'), 'server.mjs': sha256('srv-v1'), 'README.md': sha256('readme-v1') }))
check('L11_done_step_whose_change_is_missing_is_redone_not_assumed', notApplied.skip.join() === 's1' && notApplied.redo.some((r) => r.stepId === 's2' && r.reason.includes('not in its recorded state')) && notApplied.safeToResume)
const drift = planResume(w.log, asg.id, hashes({ 'src/notesStore.mjs': sha256('someone edited'), 'src/notesService.mjs': sha256('svc-v2'), 'server.mjs': sha256('srv-v1'), 'README.md': sha256('readme-v1') }))
check('L12_drift_makes_resume_unsafe_and_names_the_conflicting_file', !drift.safeToResume && drift.conflicts[0].includes('src/notesStore.mjs') && drift.redo.some((r) => r.stepId === 's1' && r.reason.includes('drifted')))
const unrelated = planResume(w.log, asg.id, hashes({ 'src/notesStore.mjs': sha256('store-v2'), 'src/notesService.mjs': sha256('svc-v2'), 'server.mjs': sha256('srv-v1'), 'README.md': sha256('edited by Mark meanwhile'), 'extra.md': sha256('new file') }))
check('L13_unrelated_changes_are_identified_and_preserved', Array.isArray(unrelated.unrelatedChanges) && unrelated.unrelatedChanges.join() === 'README.md,extra.md' && unrelated.safeToResume)
const unknownBase = (() => { const x = engWorld(); const ag = addAgent(x, 'agent-u'); const t = assign(x.log, draftFor(ag.id, 'mu', 'u'), C, NOW).assignment; startAssignment(x.log, t.id, 'system:r', NOW); saveCheckpoint(x.log, t.id, cpState({ workspace: { ...cpState().workspace, baselineFileHashes: 'UNKNOWN', baselineTreeHash: 'UNKNOWN' } }), 'system:r', NOW); return planResume(x.log, t.id, hashes({})) })()
check('L14_missing_baseline_reports_UNKNOWN_instead_of_guessing_unrelated_changes', unknownBase.unrelatedChanges === 'UNKNOWN')
check('L15_unresolved_effects_are_listed_for_the_successor', (() => { const x = engWorld(); const ag = addAgent(x, 'agent-v'); const t = assign(x.log, draftFor(ag.id, 'mv', 'v'), C, NOW).assignment; startAssignment(x.log, t.id, 'system:r', NOW); saveCheckpoint(x.log, t.id, cpState(), 'system:r', NOW); beginEffect(x.log, t.id, 'migrate:db', { kind: 'command', consequential: true, summary: 'run migration' }); return planResume(x.log, t.id, hashes({ 'src/notesStore.mjs': sha256('store-v2'), 'src/notesService.mjs': sha256('svc-v2') })).unresolvedEffects.join() === 'migrate:db' })())

// ---- handoff
failAssignment(w.log, asg.id, 'system:r', 'API step failed twice: PATCH handler rejects valid ids', passed({ validation: 'FAILED', summary: 'validation failed' }), NOW)
const pk = buildHandoffPacket(w.log, asg.id, 'specialist failed')
check('L16_packet_says_what_was_attempted_changed_succeeded_failed_remains_and_why_it_stopped', pk.attempted.length === 3 && pk.changed.length === 2 && pk.succeeded.some((s) => s.startsWith('s1')) && pk.succeeded.some((s) => s.includes('validation passed')) && pk.remaining.some((r) => r.startsWith('s3')) && pk.stopReason.includes('PATCH handler') && pk.objective.includes('pinned') && pk.acceptanceCriteria.length === 1)
check('L17_packet_lists_what_must_not_be_repeated_including_completed_consequential_actions', pk.doNotRepeat.some((d) => d.key === 'approach:rewrite-store-with-sqlite') && pk.doNotRepeat.some((d) => d.key === 'write:a.txt' && d.reason.includes('already completed')) && pk.consequentialActionsDone.includes('write:a.txt') && pk.consequentialActionsDone.includes('write:b.txt'))
check('L18_packet_is_bounded_structured_state_not_a_conversation_dump', JSON.stringify(pk).length < 6000 && !('messages' in pk) && !('transcript' in pk))
const cont = continueAssignment(w.log, asg.id, b.id, C, 'predecessor failed; successor continues from checkpoint', NOW)
const again = continueAssignment(w.log, asg.id, b.id, C, 'predecessor failed; successor continues from checkpoint', NOW)
const h = handoffFor(w.log, cont.assignmentId)
check('L19_successor_assignment_is_created_once_linked_and_carries_the_packet', cont.created && !again.created && again.assignmentId === cont.assignmentId && !!h && h.fromAssignment === asg.id && h.packet.remaining.length > 0 && deriveAssignments(w.log).assignments.get(cont.assignmentId)!.assignment.agentId === b.id && deriveAssignments(w.log).assignments.get(cont.assignmentId)!.assignment.objective.includes('continuation of'))
check('L20_retired_successor_refused_and_write_handoff_to_another_agent_needs_a_commander', (() => { const r = addAgent(w, 'agent-r'); w.reg.transition(r.id, 'RETIRED', C, 'x', NOW); try { continueAssignment(w.log, asg.id, r.id, C, 'x', NOW); return false } catch (e) { return e instanceof AssignmentError && e.code === 'AGENT_NOT_ACTIVE' } })() && (() => { const c3 = addAgent(w, 'agent-c3'); try { continueAssignment(w.log, asg.id, c3.id, 'system:runner', 'x', NOW); return false } catch (e) { return e instanceof ContinuityError && e.code === 'NOT_AUTHORIZED' } })())
// same agent resume after a crash (system may resume under the existing grant)
const crash = engWorld(); const ca = addAgent(crash, 'agent-crash'); const ct = assign(crash.log, draftFor(ca.id, 'mc', 'crash me'), C, NOW).assignment; startAssignment(crash.log, ct.id, 'system:r', NOW); saveCheckpoint(crash.log, ct.id, cpState(), 'system:r', NOW); interruptAssignment(crash.log, ct.id, 'system:recovery', 'process restarted', NOW)
const resumed = continueAssignment(crash.log, ct.id, ca.id, 'system:recovery', 'resume after restart', NOW)
check('L21_same_agent_resumes_an_interrupted_assignment_from_its_checkpoint_after_restart', resumed.created && deriveAssignments(new AgentOpsLog(crash.dir)).assignments.get(ct.id)!.state === 'INTERRUPTED' && deriveAssignments(new AgentOpsLog(crash.dir)).assignments.get(resumed.assignmentId)!.state === 'QUEUED' && resumed.packet.remaining.length > 0)
check('L22_continuity_state_survives_process_restart', (() => { const re = new AgentOpsLog(w.dir); return latestCheckpoint(re, asg.id)!.seq === 4 && effectStatus(re, asg.id, 'write:a.txt').state === 'DONE' && !!handoffFor(re, cont.assignmentId) })())
void bad
finish()

/** Generic validation of the completion gate: a task owning files is COMPLETED only while those files pass authoritative validation. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { completionRefusal, gateCompletion, MAX_INVALIDATIONS, firstStartDigest, unchangedSinceStart, type Diagnose } from './foundryCompletionGate'
import { diagnoseFile } from './foundryNarrowRepair'
import type { EvidenceRecord, MissionGraph, MissionTask } from './foundryMissionExecutive'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const at = '2026-01-01T00:00:00.000Z'
const task = (taskId: string, state: MissionTask['state'], extra: Partial<MissionTask> = {}): MissionTask => ({ taskId, missionId: 'm', description: taskId, state, dependencies: [], blockers: [], resourceClaims: [], filesAtRisk: [], evidenceNeeded: [], completionCondition: '', retryState: { attempts: 0 }, createdAt: at, updatedAt: at, ...extra })
const graph = (tasks: MissionTask[]): MissionGraph => ({ missionId: 'm', goal: 'g', tasks, updatedAt: at })
const evidence = (id: string, files: string[]): EvidenceRecord => ({ evidenceId: id, criterion: id, source: 'typecheck exit=0', sourceDigests: Object.fromEntries(files.map(file => [file, 'd'])), at, status: 'CURRENT' })

// Real compiler over real files in a temp project.
const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-gate-'))
const diagnose: Diagnose = file => diagnoseFile(root, file).map(item => ({ file, line: item.line, code: item.code, message: item.message }))
const CLEAN = 'export const a: number = 1\n'
const BROKEN = "export const b: number = 'x'\n"
writeFileSync(path.join(root, 'clean.ts'), CLEAN)
writeFileSync(path.join(root, 'broken.ts'), BROKEN)
const options = { maxAttempts: 3 }

// 1. an authored file that is clean: the task may complete and stays complete.
{
  const g = graph([task('t_clean', 'COMPLETED', { files: ['clean.ts'] })])
  assert.equal(completionRefusal({ taskId: 't_clean', files: ['clean.ts'] }, diagnose), null)
  const outcome = gateCompletion(g, [], diagnose, options)
  assert.equal(outcome.invalidated.length, 0)
  assert.equal(outcome.graph.tasks[0].state, 'COMPLETED')
  ok('clean owned file: the task may COMPLETE and stays COMPLETED')
}

// 2. an authored file with a TypeScript error: the task cannot complete.
{
  const refusal = completionRefusal({ taskId: 't_broken', files: ['broken.ts'] }, diagnose)
  assert.ok(refusal && /cannot be COMPLETED/.test(refusal) && /TS2322/.test(refusal), String(refusal))
  ok('owned file with a TypeScript error: COMPLETED is refused with the diagnostic')
}

// 3. previously COMPLETED, then invalid: completion invalidated, history kept, evidence stale, dependents wait; unrelated work untouched.
{
  const g = graph([
    task('t_broken', 'COMPLETED', { files: ['broken.ts'], updatedAt: '2026-01-02T00:00:00.000Z' }),
    task('t_clean', 'COMPLETED', { files: ['clean.ts'] }),
    task('t_dep', 'READY', { dependencies: ['t_broken'], files: ['clean.ts'] }),
    task('t_done_dep', 'COMPLETED', { dependencies: ['t_broken'], files: ['clean.ts'] }),
    task('t_free', 'READY'),
  ])
  const records = [evidence('e_broken', ['broken.ts']), evidence('e_clean', ['clean.ts'])]
  const outcome = gateCompletion(g, records, diagnose, options)
  const byId = Object.fromEntries(outcome.graph.tasks.map(item => [item.taskId, item]))
  assert.equal(byId.t_broken.state, 'READY', 'repair required, not COMPLETED')
  assert.equal(byId.t_broken.completionHistory?.[0].event, 'COMPLETION_INVALIDATED')
  assert.equal(byId.t_broken.completionHistory?.[0].priorCompletedAt, '2026-01-02T00:00:00.000Z', 'the incorrect completion stays on record')
  assert.ok(byId.t_broken.completionHistory?.[0].diagnostics[0].includes('TS2322'))
  assert.equal(byId.t_broken.retryState.attempts, 1)
  assert.equal(byId.t_dep.state, 'WAITING', 'a dependent no longer treats it as satisfied')
  assert.deepEqual(byId.t_dep.blockers.map(item => `${item.kind}:${item.ref}`), ['DEPENDENCY:t_broken'])
  assert.equal(byId.t_done_dep.state, 'COMPLETED', 'a dependent already complete on clean files is re-gated on its own files, not reset')
  assert.equal(byId.t_clean.state, 'COMPLETED', 'unrelated clean task stays complete')
  assert.equal(byId.t_free.state, 'READY')
  const stale = Object.fromEntries(outcome.evidence.map(item => [item.evidenceId, item]))
  assert.equal(stale.e_broken.status, 'STALE')
  assert.ok(stale.e_broken.staleBecause?.[0].includes('completion invalidated'))
  assert.equal(stale.e_clean.status, 'CURRENT', 'unaffected evidence stays current')
  // idempotent: the already-invalidated task is not COMPLETED, so nothing happens twice
  assert.equal(gateCompletion(outcome.graph, outcome.evidence, diagnose, options).invalidated.length, 0)
  // attempts used up: FAILED, not an endless READY loop
  // earlier failed attempts (spent before it first completed) do not count against the repair
  const earlier = gateCompletion(graph([task('t_broken', 'COMPLETED', { files: ['broken.ts'], retryState: { attempts: 2 } })]), [], diagnose, options)
  assert.equal(earlier.graph.tasks[0].state, 'READY', 'a fresh repair, not an immediate failure')
  assert.equal(earlier.graph.tasks[0].retryState.attempts, 1)
  // but a task that keeps being invalidated is bounded
  const history = Array.from({ length: MAX_INVALIDATIONS + 1 }, () => ({ at, event: 'COMPLETION_INVALIDATED' as const, priorCompletedAt: at, reason: 'x', diagnostics: [] as string[] }))
  const worn = gateCompletion(graph([task('t_broken', 'COMPLETED', { files: ['broken.ts'], completionHistory: history })]), [], diagnose, options)
  assert.equal(worn.graph.tasks[0].state, 'FAILED', 'invalidated again and again: stop looping')
  ok('completion invalidated: history kept, task reopened, dependents wait, only affected evidence stale, unrelated tasks untouched')
}

// 4. repairing the file to clean lets the task complete again.
{
  writeFileSync(path.join(root, 'broken.ts'), "export const b: number = 2\n")
  assert.equal(completionRefusal({ taskId: 't_broken', files: ['broken.ts'] }, diagnose), null)
  const g = graph([task('t_broken', 'COMPLETED', { files: ['broken.ts'] })])
  assert.equal(gateCompletion(g, [], diagnose, options).invalidated.length, 0)
  ok('repaired to clean: the task can COMPLETE again')
}

// 5. unchanged owned files are not re-validated on every tick; a changed digest is.
{
  let calls = 0
  const counting: Diagnose = file => { calls += 1; return diagnose(file) }
  const g = graph([task('t_clean', 'COMPLETED', { files: ['clean.ts'] })])
  const first = gateCompletion(g, [], counting, { ...options, digestOf: () => 'v1' })
  assert.equal(calls, 1)
  gateCompletion(first.graph, [], counting, { ...options, digestOf: () => 'v1' })
  assert.equal(calls, 1, 'same digest: no re-validation')
  gateCompletion(first.graph, [], counting, { ...options, digestOf: () => 'v2' })
  assert.equal(calls, 2, 'changed files are validated again')
  ok('validation is skipped for unchanged owned files and repeated when they change')
}

// 6. tasks that own no files are never gated.
{
  const outcome = gateCompletion(graph([task('t_read', 'COMPLETED')]), [], () => { throw new Error('must not run') }, options)
  assert.equal(outcome.invalidated.length, 0)
  ok('tasks without owned files are not gated')
}

// 7-10. A task that owns files cannot COMPLETE with those files byte-identical to when its attempt started, even when they validate.
const digestOf = (files: string[]) => createHash('sha256').update(files.map(file => `${file}\n${readFileSync(path.join(root, file), 'utf8')}`).join('\n--\n')).digest('hex')
{
  const same = digestOf(['clean.ts'])
  const outcome = gateCompletion(graph([task('t_noop', 'COMPLETED', { files: ['clean.ts'], startDigest: same })]), [], diagnose, { ...options, digestOf })
  assert.equal(outcome.invalidated.length, 1, 'a valid but untouched file is not a completed task')
  assert.equal(outcome.invalidated[0].unchanged, true)
  assert.equal(outcome.invalidated[0].diagnostics.length, 0)
  assert.equal(outcome.graph.tasks[0].state, 'READY', 'back to READY for a fresh attempt')
  assert.equal(outcome.graph.tasks[0].startDigest, same, 'the baseline is the FIRST start: a retry is judged against it, not against a later partial result')
  assert.ok(/without changing any file it owns/.test(outcome.graph.tasks[0].completionHistory?.[0].reason ?? ''), String(outcome.graph.tasks[0].completionHistory?.[0].reason))
  ok('completed with the owned file byte-identical to its start: completion invalidated, task reopened, reason recorded')
}
{
  const outcome = gateCompletion(graph([task('t_did', 'COMPLETED', { files: ['clean.ts'], startDigest: 'a-different-digest' })]), [], diagnose, { ...options, digestOf })
  assert.equal(outcome.invalidated.length, 0)
  assert.equal(outcome.graph.tasks[0].state, 'COMPLETED')
  assert.ok(outcome.graph.tasks[0].completionCheck, 'recorded as checked')
  ok('owned file changed since the start and clean: the task stays COMPLETED')
}
{
  const outcome = gateCompletion(graph([task('t_old', 'COMPLETED', { files: ['clean.ts'] })]), [], diagnose, { ...options, digestOf })
  assert.equal(outcome.invalidated.length, 0, 'no start digest: no claim about change')
  assert.equal(unchangedSinceStart({ files: ['clean.ts'] }, digestOf(['clean.ts'])), false)
  assert.equal(unchangedSinceStart({ files: [], startDigest: 'x' }, 'x'), false, 'no owned files: nothing to change')
  ok('tasks without a start digest or without owned files are not judged on change')
}
{
  const same = digestOf(['clean.ts'])
  const refusal = completionRefusal({ taskId: 't_noop', files: ['clean.ts'], startDigest: same }, diagnose, same)
  assert.ok(refusal && /none of the files it owns/.test(refusal), String(refusal))
  assert.equal(completionRefusal({ taskId: 't_did', files: ['clean.ts'], startDigest: 'other' }, diagnose, same), null)
  ok('an explicit COMPLETED is refused while the owned files are unchanged since the start')
}

// 11. A retry keeps the baseline of the task's FIRST start: an attempt that begins on a file an earlier attempt already changed counts as changed.
{
  assert.equal(firstStartDigest({ startDigest: 'first' }, 'second'), 'first', 'the first start wins')
  assert.equal(firstStartDigest({}, 'second'), 'second', 'a task that never started takes the current digest')
  const first = digestOf(['clean.ts'])
  writeFileSync(path.join(root, 'retry.ts'), 'export const r: number = 2\n')
  const retry = gateCompletion(graph([task('t_retry', 'COMPLETED', { files: ['retry.ts'], startDigest: firstStartDigest({ startDigest: 'original-before-attempt-1' }, digestOf(['retry.ts'])) })]), [], diagnose, { ...options, digestOf })
  assert.equal(retry.invalidated.length, 0, 'the file differs from the original baseline, so the retry that found it already fixed is accepted')
  const noop = gateCompletion(graph([task('t_noop2', 'COMPLETED', { files: ['clean.ts'], startDigest: firstStartDigest({ startDigest: first }, 'later') })]), [], diagnose, { ...options, digestOf })
  assert.equal(noop.invalidated.length, 1, 'still unchanged against the first baseline: rejected on every attempt')
  ok('the baseline is the first start: a retry on an already-fixed file is accepted; a task that never changed its file is rejected on every attempt')
}

rmSync(root, { recursive: true, force: true })
console.log(`FOUNDRY_COMPLETION_GATE_VALIDATION ${passed}/11`)

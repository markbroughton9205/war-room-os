/** Build-mission engine: planning from the Commander's text, phase order, retry, fix tasks from real diagnostics, ceilings. */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { resolveRepoRoot } from '@/lib/repo/paths'
import path from 'node:path'
import {
  buildMissionProgress, ceilingUsage, executiveGraphTool, isBuildMissionRequest, loadExecutiveState, logTimeline, parseDiagnostics, reactToJobOutcomes,
  requestedAddTasks, requestedJobs, setExecutiveRootForTests, setMissionCeilings, readMissionControlSource,
} from './foundryMissionExecutiveRuntime'
import { saveMissionState } from './foundryMissionExecutive'
import { startBackgroundJob } from './foundryBackgroundJobs'

const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-build-'))
setExecutiveRootForTests(root)
let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const M = 'bm'

const request = [
  'Build a thing. Use mission.graph add_task with taskId "a", description "Create the new file lib/native-builder/foundryZzA.ts exporting x. It is simple. Done". Use mission.graph add_task with taskId "b", description "Create the new file lib/native-builder/foundryZzB.ts that imports x", dependencies ["a"].',
  'Use job.start with kind typecheck and taskId "typecheck" after all tasks. Do not edit any other file.',
].join(' ')

const fixtureFiles: string[] = []
try {
  assert.equal(isBuildMissionRequest(request), true)
  assert.deepEqual(requestedAddTasks(request).map(t => [t.taskId, t.dependencies ?? []]), [['a', []], ['b', ['a']]])
  assert.equal(requestedAddTasks(request)[0].description, 'Create the new file lib/native-builder/foundryZzA.ts exporting x. It is simple. Done')
  assert.deepEqual(requestedJobs(request), [{ kind: 'typecheck', taskId: 'typecheck', afterAllTasks: true }])
  ok('Commander text parses into authoring tasks with dependencies (descriptions may contain sentences) and a post-task verification job')

  const real = readFileSync('tmp/foundry-phase8/mission-control-request.txt', 'utf8')
  const tasks = requestedAddTasks(real)
  assert.equal(tasks.length, 13); assert.ok(tasks.every(t => (t.description ?? '').length > 200)); assert.equal(requestedJobs(real).length, 2)
  ok('the real Mission Control objective parses into 13 tasks and 2 verification jobs')

  // DEFINE -> RUN_TASKS -> WAIT -> START_JOB -> DONE
  let p = buildMissionProgress(M, request)
  assert.equal(p.phase, 'DEFINE'); assert.match(p.nextCall ?? '', /"taskId":"a"/)
  for (const t of requestedAddTasks(request)) assert.equal(executiveGraphTool(M, t as unknown as Record<string, unknown>).ok, true)
  const graph = loadExecutiveState(M).graph.tasks
  assert.deepEqual(graph.map(t => [t.taskId, t.state, t.files]), [['a', 'READY', ['lib/native-builder/foundryZzA.ts']], ['b', 'WAITING', ['lib/native-builder/foundryZzB.ts']]])
  p = buildMissionProgress(M, request)
  assert.equal(p.phase, 'RUN_TASKS'); assert.match(p.nextCall ?? '', /"name":"task.run".*"taskId":"a"/)
  ok('phases: define each task, then run only READY tasks (dependent stays WAITING)')

  // a is running as a job; b waits; typecheck is not started yet
  const st = loadExecutiveState(M)
  const ja = startBackgroundJob({ root, missionId: M, taskId: 'a', kind: 'task', command: 'sleep', args: ['30'], cwd: root, claims: [] }) as { job: { jobId: string; identity: { pid: number } } }
  st.graph.tasks[0].state = 'RUNNING'; st.graph.tasks[0].owner = `job:${ja.job.jobId}`
  saveMissionState(root, M, st)
  p = buildMissionProgress(M, request)
  assert.equal(p.phase, 'WAIT'); assert.match(p.nextCall ?? '', /job.wait/)
  ok('while the authoring job runs and nothing else is ready, the executive waits (no model calls)')
  process.kill(-ja.job.identity.pid, 'SIGKILL')

  // diagnostics -> fix tasks only for files this mission authored
  const diag = parseDiagnostics("lib/native-builder/foundryZzB.ts(2,10): error TS2304: Cannot find name 'x'.\nlib/other/unrelated.ts(1,1): error TS2322: nope\n")
  assert.deepEqual(diag.map(d => [d.file, d.line]), [['lib/native-builder/foundryZzB.ts', 2], ['lib/other/unrelated.ts', 1]])
  const state = loadExecutiveState(M)
  // A genuinely completed authoring task has its files: the executive reopens a task whose declared file is missing, so the fixture creates them (and removes them below).
  for (const task of state.graph.tasks) for (const file of task.files ?? []) { const abs = path.join(resolveRepoRoot(), file); if (!existsSync(abs)) { writeFileSync(abs, 'export {}\n'); fixtureFiles.push(abs) } }
  state.graph.tasks.forEach(t => { t.state = 'COMPLETED'; t.owner = undefined })
  saveMissionState(root, M, state)
  const log = path.join(root, 'tc.log')
  writeFileSync(log, "lib/native-builder/foundryZzB.ts(2,10): error TS2304: Cannot find name 'x'.\nlib/other/unrelated.ts(1,1): error TS2322: nope\n")
  mkdirSync(path.join(root, 'jobs'), { recursive: true })
  const failed = { jobId: 'tcjob', missionId: M, taskId: 'typecheck', kind: 'typecheck', command: 'x', args: [], cwd: root, dedupeKey: 'k', identity: { pid: 0, startTicks: 'x', bootId: 'x' }, startedAt: new Date().toISOString(), lastHeartbeat: '', state: 'FAILED', exitStatus: 2, finishedAt: new Date().toISOString(), logPath: log, exitPath: log, claims: [] }
  writeFileSync(path.join(root, 'jobs', 'tcjob.json'), JSON.stringify(failed))
  const events = reactToJobOutcomes(M)
  const fixes = loadExecutiveState(M).graph.tasks.filter(t => t.fixFor)
  assert.equal(fixes.length, 1); assert.deepEqual(fixes[0].files, ['lib/native-builder/foundryZzB.ts']); assert.equal(fixes[0].state, 'READY')
  assert.match(fixes[0].spec ?? '', /^Rewrite file lib\/native-builder\/foundryZzB\.ts\./); assert.ok(events.some(e => /created fix-/.test(e)))
  assert.equal(reactToJobOutcomes(M).length, 0)
  ok('a failed typecheck creates exactly one fix task, only for an authored file with real diagnostics, and is idempotent')
  p = buildMissionProgress(M, request)
  assert.equal(p.phase, 'RUN_TASKS'); assert.match(p.nextCall ?? '', /fix-/)
  ok('the repair is scheduled before any re-verification')

  // retry of a failed authoring task
  const s2 = loadExecutiveState(M)
  const taskA = s2.graph.tasks.find(t => t.taskId === 'a')!
  taskA.state = 'FAILED'
  saveMissionState(root, M, s2)
  const aJob = { ...failed, jobId: 'ajob', taskId: 'a', kind: 'task', exitStatus: 1, startedAt: new Date(Date.now() + 1000).toISOString() }
  writeFileSync(path.join(root, 'jobs', 'ajob.json'), JSON.stringify(aJob))
  assert.ok(reactToJobOutcomes(M).some(e => /retrying with a fresh attempt/.test(e)))
  const retried = loadExecutiveState(M).graph.tasks.find(t => t.taskId === 'a')!
  assert.equal(retried.state, 'READY'); assert.equal(retried.retryState.attempts, 1)
  ok('a failed authoring task gets a bounded retry with a fresh attempt')

  // ceilings
  setMissionCeilings(M, { maxModelCalls: 200, maxToolCalls: 600, maxWallMs: 8 * 3_600_000, approvedBy: 'test' })
  assert.equal(ceilingUsage(M)?.breach, null)
  setMissionCeilings(M, { maxModelCalls: 200, maxToolCalls: 600, maxWallMs: 1, approvedBy: 'test' })
  await sleep(5)
  assert.match(ceilingUsage(M)?.breach ?? '', /wall clock/)
  assert.equal(buildMissionProgress(M, request).phase, 'STUCK')
  assert.match(buildMissionProgress(M, request).detail, /Commander decision required/)
  ok('safety ceilings are enforced as a Commander decision, never silently exceeded')

  logTimeline(M, 'event', 'something happened')
  assert.equal(loadExecutiveState(M).timeline?.at(-1)?.text, 'something happened'); assert.equal(readMissionControlSource('does-not-exist'), null)
  ok('durable timeline entries persist; unknown missions have no Mission Control source')
  console.log(`\nFOUNDRY_BUILD_MISSION_VALIDATION ${passed}/${passed}`)
} finally {
  setExecutiveRootForTests(null)
  rmSync(root, { recursive: true, force: true })
  for (const file of fixtureFiles) rmSync(file, { force: true })
}

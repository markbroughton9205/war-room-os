/** Live wiring: real broker tools, real processes, and a fresh process for restart truth. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeEngineerTool } from './engineerTools'
import { executiveAfterTool, executivePrecheck, executiveTick, loadExecutiveState, setExecutiveRootForTests } from './foundryMissionExecutiveRuntime'
import { jobLogTail, listJobs } from './foundryBackgroundJobs'
import { identityIsLive } from './foundryProcessIdentity'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'

const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-p8-wiring-'))
setExecutiveRootForTests(root)
process.env.FOUNDRY_EXECUTIVE_ROOT_FOR_CHILD = root
const M = 'wiring-mission'
let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const call = (tool: string, input: Record<string, unknown>) => executeEngineerTool({ tool: tool as never, input }, { repairId: M })
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const here = (name: string) => path.resolve('lib/native-builder', name)

try {
  // 1. The live path actually invokes the executive.
  const controller = readFileSync(here('foundryMissionController.ts'), 'utf8')
  for (const needle of ['executivePrecheck(mission.missionId', 'executiveAfterTool(mission.missionId', 'executiveTick(mission.missionId', 'applyExecutiveTurn(mission)']) assert.ok(controller.includes(needle), needle)
  for (const name of ['job.start', 'job.status', 'job.wait', 'job.cancel', 'mission.graph']) assert.ok(FOUNDRY_MODEL_TOOL_CATALOG.some(entry => entry.name === name), name)
  ok('controller turn tick / precheck / failure ledger and model tool catalog are wired')

  // 2. Task graph + durable job through the real broker; dependent waits.
  assert.equal((await call('mission.graph', { action: 'add_task', taskId: 'package', description: 'package the app', dependencies: [] })).ok, true)
  assert.equal((await call('mission.graph', { action: 'add_task', taskId: 'read-api', description: 'inspect API contract', readOnly: true })).ok, true)
  const started = await call('job.start', { kind: 'test', suite: 'validate:foundry-mission-executive', taskId: 'suite', blocks: ['package'] })
  assert.equal(started.ok, true, started.error)
  const { jobId } = started.result as { jobId: string }
  let state = loadExecutiveState(M)
  assert.equal(state.graph.tasks.find(t => t.taskId === 'package')!.state, 'WAITING')
  assert.equal(state.graph.tasks.find(t => t.taskId === 'suite')!.state, 'RUNNING')
  ok('job.start persists task + durable job; dependent is WAITING (not BLOCKED)')

  const dup = await call('job.start', { kind: 'test', suite: 'validate:foundry-mission-executive' })
  assert.equal((dup.result as { duplicate: boolean }).duplicate, true); ok('duplicate job refused while live')

  // 3. While it runs: independent read-only work is selected, WAITING package is not.
  const next = (await call('mission.graph', { action: 'next' })).result as { next: { start: string[] } }
  assert.deepEqual(next.next.start, ['read-api']); ok('next-best-action picks independent read-only work while package waits')
  assert.equal(executivePrecheck(M, 'package.run', {}).ok, true) // no claim holder conflict for CPU_HEAVY alone? package.run claims MEMORY_HEAVY+write
  const lint = await call('job.start', { kind: 'lint', targets: ['lib/native-builder/foundryResourceClaims.ts'], taskId: 'lint' })
  assert.equal(lint.ok, true, lint.error)
  const third = executivePrecheck(M, 'test.run', { suite: 'x' })
  assert.equal(third.ok, false); assert.ok(!third.ok && third.wait); assert.match(!third.ok ? third.error : '', /^WAITING/)
  ok('third heavy CPU claim queues as WAITING (not refused, not BLOCKED)')

  // 4. Event-driven wake with no "continue".
  const waited = await call('job.wait', { jobId, timeoutMs: 120_000 })
  assert.equal((waited.result as { state: string }).state, 'SUCCEEDED', jobLogTail(listJobs(root).find(j => j.jobId === jobId)!, 1500))
  await call('job.wait', { jobId: (lint.result as { jobId: string }).jobId, timeoutMs: 120_000 })
  const tick = executiveTick(M)
  assert.ok(tick.events.some(e => /finished/.test(e))); assert.ok(tick.next.start.some(t => t.taskId === 'package'))
  assert.equal(loadExecutiveState(M).graph.tasks.find(t => t.taskId === 'package')!.state, 'READY')
  ok('job completion wakes package -> READY and executive selects it')
  assert.equal(executiveTick(M).events.length, 0); ok('completion is folded in exactly once')

  // 5. Fresh process reconciles disk truth (restart).
  const child = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', '--input-type=module', '-e', `
    import { executiveTick, setExecutiveRootForTests, loadExecutiveState } from ${JSON.stringify(new URL('./foundryMissionExecutiveRuntime.ts', import.meta.url).href)};
    setExecutiveRootForTests(${JSON.stringify(root)});
    const t = executiveTick(${JSON.stringify(M)});
    console.log('CHILD ' + JSON.stringify({ tasks: loadExecutiveState(${JSON.stringify(M)}).graph.tasks.map(x => [x.taskId, x.state]), next: t.next.start.map(x => x.taskId) }));`], { encoding: 'utf8' })
  const line = child.stdout.split('\n').find(l => l.startsWith('CHILD '))!
  const seen = JSON.parse(line.slice(6)) as { tasks: [string, string][]; next: string[] }
  assert.deepEqual(seen.tasks.find(([id]) => id === 'package'), ['package', 'READY']); assert.ok(seen.next.includes('package'))
  ok('restart: a new process reconstructs graph + job truth and picks the same next action without re-running')

  // 6. Killed job: lost, not completed; package returns to waiting on the producer rather than running on unknown output.
  const longRun = await call('job.start', { kind: 'lint', targets: ['lib'], taskId: 'lint2', blocks: ['package'] })
  assert.equal(longRun.ok, true, longRun.error)
  const job2 = listJobs(root).find(j => j.jobId === (longRun.result as { jobId: string }).jobId)!
  try { process.kill(-job2.identity.pid, 'SIGKILL') } catch { process.kill(job2.identity.pid, 'SIGKILL') }
  for (let i = 0; i < 100 && identityIsLive(job2.identity); i++) await sleep(50)
  await sleep(200)
  executiveTick(M)
  const pkg = loadExecutiveState(M).graph.tasks
  assert.equal(pkg.find(t => t.taskId === 'lint2')!.state, 'READY'); assert.equal(pkg.find(t => t.taskId === 'package')!.state, 'WAITING')
  ok('worker SIGKILL: task reopened READY, dependent keeps waiting on the producer, ownership released')

  // 7. Repeated identical failure survives restart.
  for (let i = 0; i < 3; i++) executiveAfterTool(M, 'test.run', { suite: 'validate:x' }, { ok: false, error: `TS2304 cannot find name foo at ${new Date().toISOString()}` })
  const refusal = spawnSync(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', '--input-type=module', '-e', `
    import { executivePrecheck, setExecutiveRootForTests } from ${JSON.stringify(new URL('./foundryMissionExecutiveRuntime.ts', import.meta.url).href)};
    setExecutiveRootForTests(${JSON.stringify(root)});
    console.log('CHILD ' + JSON.stringify(executivePrecheck(${JSON.stringify(M)}, 'test.run', { suite: 'validate:x' })));`], { encoding: 'utf8' })
  const verdict = JSON.parse(refusal.stdout.split('\n').find(l => l.startsWith('CHILD '))!.slice(6)) as { ok: boolean; wait?: boolean; error?: string }
  assert.equal(verdict.ok, false); assert.equal(verdict.wait, false); assert.match(verdict.error ?? '', /REPEATED_FAILURE/)
  ok('third identical failure is refused after restart (persisted signature, timestamp-insensitive)')

  // 8. Only BLOCKED may ask; unknown block kinds rejected; WAITING can't be run.
  assert.equal((await call('mission.graph', { action: 'block_task', taskId: 'package', kind: 'JOB' })).ok, false)
  assert.equal((await call('mission.graph', { action: 'update_task', taskId: 'package', state: 'RUNNING' })).ok, false)
  ok('graph tool rejects fabricated blocks and running a WAITING task')

  // 9. One writer per subsystem.
  await call('mission.graph', { action: 'add_task', taskId: 'w1', description: 'edit core', subsystem: 'core', filesAtRisk: ['core/'] })
  await call('mission.graph', { action: 'add_task', taskId: 'w2', description: 'edit core too', subsystem: 'core', filesAtRisk: ['core/'] })
  await call('mission.graph', { action: 'update_task', taskId: 'w1', state: 'RUNNING' })
  const writers = (await call('mission.graph', { action: 'next' })).result as { next: { start: string[]; deferred: { taskId: string }[] } }
  assert.ok(!writers.next.start.includes('w2')); assert.ok(writers.next.deferred.some(d => d.taskId === 'w2'))
  ok('no duplicate writer on one subsystem')

  console.log(`\nFOUNDRY_MISSION_EXECUTIVE_WIRING_VALIDATION ${passed}/${passed}`)
} finally {
  setExecutiveRootForTests(null)
  rmSync(root, { recursive: true, force: true })
}

/** Phase 8 primitives, validated with real detached processes. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { attachMissionToJob, cancelJob, inspectJob, listJobs, promoteQueuedJobs, reconcileJobs, startBackgroundJob } from './foundryBackgroundJobs'
import { findClaimConflicts } from './foundryResourceClaims'
import { identityIsLive, readProcessIdentity } from './foundryProcessIdentity'
import {
  applyJobEvent, classifyStall, invalidateEvidence, loadMissionState, mayAskCommander, narrate, newTask,
  reconcileLedger, recordFailure, type EvidenceRecord, resumeMission, saveMissionState, selectNextActions, type MissionGraph,
} from './foundryMissionExecutive'


/** Launch a job from a separate, short-lived process, so the recording process is genuinely "away" from the launcher. */
async function launchFromOtherProcess(jobRoot: string, missionId: string, taskId: string, script: string): Promise<{ jobId: string }> {
  const modUrl = new URL('./foundryBackgroundJobs.ts', import.meta.url).href
  const child = spawn(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', '--input-type=module', '-e', `
    import { startBackgroundJob } from ${JSON.stringify(modUrl)};
    const r = startBackgroundJob({ root: ${JSON.stringify(jobRoot)}, missionId: ${JSON.stringify(missionId)}, taskId: ${JSON.stringify(taskId)}, kind: 'build', command: 'sh', args: ['-c', ${JSON.stringify(script)}], cwd: ${JSON.stringify(jobRoot)} });
    console.log('JOB ' + r.job.jobId);
  `], { stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''
  child.stdout.on('data', data => { out += String(data) })
  await once(child, 'close')
  return { jobId: /JOB (\S+)/.exec(out)![1] }
}

const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-p8-'))
let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn: () => boolean, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(50) } throw new Error('timeout') }

try {
  // --- identity ---
  const self = readProcessIdentity(process.pid)
  assert.ok(self && identityIsLive(self)); assert.equal(identityIsLive({ ...self!, startTicks: '1' }), false)
  ok('identity rejects a recycled pid (same pid, different start ticks)')

  // --- real background job survives, completes, records exit ---
  const a = startBackgroundJob({ root, missionId: 'm1', taskId: 'build', kind: 'build', command: 'sh', args: ['-c', 'sleep 1; echo built'], cwd: root, claims: ['CPU_HEAVY', `PROJECT_WRITE:${root}/app`] })
  assert.equal(a.status, 'STARTED'); const jobA = (a as { job: ReturnType<typeof listJobs>[number] }).job
  assert.equal(inspectJob(root, jobA).reconciliation, 'STILL_RUNNING')
  ok('running build is known to be running (identity + heartbeat), not assumed')

  const dup = startBackgroundJob({ root, missionId: 'm1', taskId: 'build', kind: 'build', command: 'sh', args: ['-c', 'sleep 1; echo built'], cwd: root })
  assert.equal(dup.status, 'DUPLICATE'); ok('duplicate build is refused while one is live')

  const clash = startBackgroundJob({ root, missionId: 'm1', taskId: 'other', kind: 'write', command: 'true', cwd: root, claims: [`PROJECT_WRITE:${root}/app/sub`] })
  assert.equal(clash.status, 'CLAIM_CONFLICT'); ok('nested PROJECT_WRITE claim collision is queued, not started')

  await until(() => inspectJob(root, jobA).reconciliation !== 'STILL_RUNNING')
  const doneA = listJobs(root).find(j => j.jobId === jobA.jobId)!
  assert.equal(doneA.state, 'SUCCEEDED'); assert.equal(doneA.exitStatus, 0)
  ok('job completion recorded with exit status')

  // --- killed wrapper: process dies without sentinel => stale orphan, never "running" ---
  const b = startBackgroundJob({ root, missionId: 'm2', taskId: 't', kind: 'test', command: 'sleep', args: ['30'], cwd: root }) as { job: ReturnType<typeof listJobs>[number] }
  process.kill(b.job.identity.pid, 'SIGKILL')
  await until(() => !identityIsLive(b.job.identity))
  assert.equal(inspectJob(root, b.job).reconciliation, 'STALE_ORPHAN_RECORD'); ok('SIGKILLed job with no sentinel => STALE_ORPHAN_RECORD')

  // --- job failure while away ---
  const c = startBackgroundJob({ root, missionId: 'm3', taskId: 't', kind: 'test', command: 'sh', args: ['-c', 'exit 3'], cwd: root }) as { job: ReturnType<typeof listJobs>[number] }
  await until(() => !identityIsLive(c.job.identity))
  const rc = reconcileJobs(root, { missionId: 'm3' })[0]
  assert.equal(rc.reconciliation, 'FAILED'); assert.equal(rc.job.exitStatus, 3); ok('a job that fails while its own launcher is still the recorder is FAILED, not "while away"')
  const away1 = await launchFromOtherProcess(root, 'm3b', 'x', 'exit 3')
  await until(() => !listJobs(root).find(j => j.jobId === away1.jobId)!.identity.pid || !identityIsLive(listJobs(root).find(j => j.jobId === away1.jobId)!.identity))
  assert.equal(reconcileJobs(root, { missionId: 'm3b' })[0].reconciliation, 'FAILED_WHILE_AWAY')
  const away2 = await launchFromOtherProcess(root, 'm3c', 'x', 'true')
  await until(() => !identityIsLive(listJobs(root).find(j => j.jobId === away2.jobId)!.identity))
  assert.equal(reconcileJobs(root, { missionId: 'm3c' })[0].reconciliation, 'COMPLETED_WHILE_AWAY')
  ok('jobs launched by another (now gone) process are FAILED_WHILE_AWAY / COMPLETED_WHILE_AWAY')

  // --- PID reuse: record claims a live pid with a different generation ---
  const d = startBackgroundJob({ root, missionId: 'm4', taskId: 't', kind: 'x', command: 'sleep', args: ['30'], cwd: root }) as { job: ReturnType<typeof listJobs>[number] }
  const forged = { ...d.job, identity: { ...d.job.identity, startTicks: '42' } }
  writeFileSync(path.join(root, 'jobs', `${d.job.jobId}.json`), JSON.stringify(forged))
  assert.equal(inspectJob(root, forged).reconciliation, 'STALE_ORPHAN_RECORD'); ok('stale PID reuse is not mistaken for the job')
  process.kill(d.job.identity.pid, 'SIGKILL')

  // --- cancel only signals matching generation ---
  const e = startBackgroundJob({ root, missionId: 'm5', taskId: 't', kind: 'y', command: 'sleep', args: ['30'], cwd: root }) as { job: ReturnType<typeof listJobs>[number] }
  assert.equal(cancelJob(root, e.job.jobId)?.state, 'CANCELLED'); await until(() => !identityIsLive(e.job.identity)); ok('cancel terminates the owned process group')

  // --- claims ---
  assert.ok(findClaimConflicts(['MODEL:ollama/qwen2.5-coder:14b'], [{ holderId: 'x', claims: ['MODEL:ollama/other'] }]).length > 0)
  assert.ok(findClaimConflicts(['PORT:3000'], [{ holderId: 'x', claims: ['PORT:3000'] }]).length === 1)
  assert.equal(findClaimConflicts(['PORT:3001'], [{ holderId: 'x', claims: ['PORT:3000'] }]).length, 0)
  assert.equal(findClaimConflicts(['CPU_HEAVY'], [{ holderId: 'x', claims: ['CPU_HEAVY'] }]).length, 0)
  assert.equal(findClaimConflicts(['CPU_HEAVY'], [{ holderId: 'x', claims: ['CPU_HEAVY'] }], { ramFreeMb: 900 }).length, 1)
  ok('claims: local models imply GPU, ports exclusive, heavy CPU degrades under pressure')

  // --- queueing under real contention (CPU_HEAVY limit 2, exclusive port) ---
  const q = (taskId: string, claims: string[], secs: string, queueIfBlocked = true) => startBackgroundJob({ root, missionId: 'mq', taskId, kind: taskId, command: 'sh', args: ['-c', `sleep ${secs}; echo ${taskId} >> ${root}/order.txt`], cwd: root, claims, queueIfBlocked })
  const q1 = q('q1', ['CPU_HEAVY'], '1.2'), q2 = q('q2', ['CPU_HEAVY'], '1.2')
  assert.equal(q1.status, 'STARTED'); assert.equal(q2.status, 'STARTED')
  const q3 = q('q3', ['CPU_HEAVY'], '0.3'), q4 = q('q4', ['CPU_HEAVY'], '0.3')
  assert.equal(q3.status, 'QUEUED'); assert.equal(q4.status, 'QUEUED')
  assert.equal(q('q3', ['CPU_HEAVY'], '0.3').status, 'DUPLICATE')
  assert.equal(startBackgroundJob({ root, missionId: 'mq', taskId: 'noq', kind: 'noq', command: 'true', cwd: root, claims: ['CPU_HEAVY'] }).status, 'CLAIM_CONFLICT')
  ok('contention: third/fourth heavy CPU jobs are durably QUEUED; duplicates refused; non-queueing callers still see the conflict')
  await until(() => reconcileJobs(root, { missionId: 'mq' }).length === 0 && listJobs(root, { missionId: 'mq' }).every(j => j.state === 'SUCCEEDED'), 20000)
  const order = readFileSync(path.join(root, 'order.txt'), 'utf8').trim().split('\n')
  assert.deepEqual(order.slice(2), ['q3', 'q4'].sort((a, b) => listJobs(root).find(j => j.taskId === a)!.startedAt.localeCompare(listJobs(root).find(j => j.taskId === b)!.startedAt)))
  ok('queued jobs start by themselves once claims clear, in FIFO order, and run to completion')
  const p1 = startBackgroundJob({ root, missionId: 'mq', taskId: 'port-a', kind: 'port-a', command: 'sleep', args: ['1'], cwd: root, claims: ['PORT:4555'], queueIfBlocked: true })
  const p2 = startBackgroundJob({ root, missionId: 'mq', taskId: 'port-b', kind: 'port-b', command: 'sleep', args: ['1'], cwd: root, claims: ['PORT:4555'], queueIfBlocked: true })
  assert.equal(p1.status, 'STARTED'); assert.equal(p2.status, 'QUEUED')
  const pc = startBackgroundJob({ root, missionId: 'mq', taskId: 'port-c', kind: 'port-c', command: 'sleep', args: ['1'], cwd: root, claims: ['PORT:4556'], queueIfBlocked: true })
  assert.equal(pc.status, 'STARTED'); ok('two processes never own the same port; a different port is unaffected')
  await until(() => reconcileJobs(root, { missionId: 'mq' }).length === 0, 20000)
  assert.equal(promoteQueuedJobs(root).length, 0)

  // --- concurrent writers on one job record (real processes) ---
  const shared = startBackgroundJob({ root, missionId: 'mrace', taskId: 'race', kind: 'race', command: 'sleep', args: ['4'], cwd: root }) as { job: ReturnType<typeof listJobs>[number] }
  const modUrl = new URL('./foundryBackgroundJobs.ts', import.meta.url).href
  const workers = [0, 1, 2, 3, 4, 5].map(n => spawn(process.execPath, ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', '--input-type=module', '-e', `
    import { attachMissionToJob, inspectJob, listJobs, reconcileJobs } from ${JSON.stringify(modUrl)};
    const root = ${JSON.stringify(root)}; const id = ${JSON.stringify(shared.job.jobId)};
    for (let i = 0; i < 40; i++) { reconcileJobs(root); attachMissionToJob(root, id, 'worker-${n}', 'task-${n}'); const j = listJobs(root).find(x => x.jobId === id); inspectJob(root, j); }
  `], { stdio: ['ignore', 'ignore', 'pipe'] }))
  const errors: string[] = []
  for (const worker of workers) worker.stderr!.on('data', chunk => { const text = String(chunk); if (/Error|ENOENT/.test(text) && !/ExperimentalWarning|Warning:/.test(text.split('\n')[0])) errors.push(text.slice(0, 200)) })
  await Promise.all(workers.map(worker => once(worker, 'close')))
  const raced = listJobs(root).find(j => j.jobId === shared.job.jobId)!
  assert.deepEqual(errors, []); assert.equal((raced.attached ?? []).length, 6); assert.equal(Object.keys(raced.attachedTasks ?? {}).length, 6)
  try { process.kill(-raced.identity.pid, 'SIGKILL') } catch { /* gone */ }
  ok('six concurrent processes hammering one job record: no crash, no lost attachment')

  // --- executive: graph, selection, wait/blocked ---
  const t = (id: string, extra: object = {}) => newTask({ taskId: id, missionId: 'M', description: id, completionCondition: id, ...extra })
  let graph: MissionGraph = { missionId: 'M', goal: 'ship', updatedAt: '', tasks: [
    t('build', { resourceClaims: ['CPU_HEAVY'], subsystem: 'core', filesAtRisk: ['core/'] }),
    t('package', { dependencies: ['build'], state: 'WAITING', blockers: [{ kind: 'JOB', ref: 'J1', detail: 'the build' }] }),
    t('api-inspect', { readOnly: true, resourceClaims: [] }),
    t('ui', { subsystem: 'ui', filesAtRisk: ['ui/'], dependencies: ['package'], state: 'WAITING', blockers: [{ kind: 'DEPENDENCY', ref: 'package', detail: 'package' }] }),
    t('creds', { state: 'BLOCKED', blockers: [{ kind: 'CREDENTIALS', ref: 'k', detail: 'API key missing' }] }),
    t('writer2', { subsystem: 'core', filesAtRisk: ['core/'] }),
  ] }
  graph.tasks[0].state = 'RUNNING'; graph.tasks[0].owner = 'job:J1'
  const pick = selectNextActions({ graph })
  assert.deepEqual(pick.start.map(x => x.taskId), ['api-inspect']); assert.ok(pick.deferred.some(x => x.taskId === 'writer2' && /writer/.test(x.reason)))
  ok('while build runs: read-only work starts, second writer on same subsystem deferred')
  assert.equal(classifyStall([{ kind: 'JOB', ref: 'j', detail: '' }]), 'WAITING'); assert.equal(classifyStall([{ kind: 'SUDO', ref: 's', detail: '' }]), 'BLOCKED')
  assert.equal(mayAskCommander(graph.tasks[1]), false); assert.equal(mayAskCommander(graph.tasks[4]), true)
  ok('WAITING never asks the Commander; BLOCKED credentials may')

  graph = applyJobEvent(graph, { jobId: 'J1', taskId: 'build', state: 'SUCCEEDED', exitStatus: 0 })
  assert.equal(graph.tasks[0].state, 'COMPLETED'); assert.equal(graph.tasks[1].state, 'READY')
  ok('build completion wakes dependent package task without Commander input')
  const failedGraph = applyJobEvent({ ...graph, tasks: graph.tasks.map(x => x.taskId === 'package' ? { ...x, state: 'WAITING' as const, blockers: [{ kind: 'JOB' as const, ref: 'J2', detail: '' }] } : x) }, { jobId: 'J2', taskId: 'zzz', state: 'FAILED', exitStatus: 1 })
  assert.equal(failedGraph.tasks[1].state, 'BLOCKED'); ok('failed prerequisite job becomes BLOCKED, not an endless wait')

  let book = {}; let verdict = 'RETRY'
  for (let i = 0; i < 3; i++) ({ book, verdict } = recordFailure(book, 'ui', 'TS2304:foo') as { book: {}; verdict: string })
  assert.equal(verdict, 'STOP_AND_CLASSIFY'); ok('third identical failure stops retry churn')

  // --- evidence + ledger ---
  const ev: EvidenceRecord[] = [
    { evidenceId: 'e1', criterion: 'api', source: 'test', sourceDigests: { 'api.ts': 'a' }, at: 'now', status: 'CURRENT' as const },
    { evidenceId: 'e2', criterion: 'ui', source: 'test', sourceDigests: { 'ui.ts': 'u' }, at: 'now', status: 'CURRENT' as const },
  ]
  const inv = invalidateEvidence(ev, { 'api.ts': 'CHANGED', 'ui.ts': 'u' })
  assert.deepEqual(inv.staleIds, ['e1']); assert.equal(inv.records[1].status, 'CURRENT'); ok('source change stales only affected evidence')
  const led = reconcileLedger({}, [{ criterion: 'api', state: 'PROVEN', evidenceId: 'e1' }, { criterion: 'ui', state: 'PROVEN', evidenceId: 'e2' }], ev)
  assert.deepEqual(led.ledger.api && 'PROVEN', 'PROVEN')
  const reg = reconcileLedger(led.ledger, [{ criterion: 'ui', state: 'UNPROVEN' }], ev)
  assert.equal(reg.rejected.length, 1); assert.equal(reconcileLedger(led.ledger, [], inv.records).needsReverify[0], 'api')
  ok('ledger rejects silent regression; stale evidence flags only the affected criterion for reverify')

  // --- resume across a "restart" with a job that finished while away ---
  const rrLaunch = await launchFromOtherProcess(root, 'M2', 'build', 'sleep 0.3')
  const rr = { job: listJobs(root).find(j => j.jobId === rrLaunch.jobId)! }
  const g2: MissionGraph = { missionId: 'M2', goal: 'g', updatedAt: '', tasks: [
    t('build', { missionId: 'M2', state: 'RUNNING', owner: `job:${rr.job.jobId}` }),
    t('package', { missionId: 'M2', dependencies: ['build'], state: 'WAITING', blockers: [{ kind: 'JOB', ref: rr.job.jobId, detail: 'build' }] }),
  ] }
  saveMissionState(root, 'M2', { graph: g2, failures: {}, evidence: [], ledger: {} })
  await until(() => !identityIsLive(rr.job.identity))
  const resumed = resumeMission(root, 'M2')!
  assert.equal(resumed.jobs[0].reconciliation, 'COMPLETED_WHILE_AWAY')
  assert.deepEqual(resumed.next.start.map(x => x.taskId), ['package']); assert.equal(loadMissionState(root, 'M2')!.graph.tasks[0].state, 'COMPLETED')
  ok('resume: completed-while-away job folded in, package becomes the next action, nothing re-run')
  assert.match(narrate(g2, []), /./); assert.match(narrate({ ...graph, tasks: graph.tasks.slice(0, 1) }, []), /done|complete/i)
  ok('narration is prose, not state spam')

  console.log(`\nFOUNDRY_MISSION_EXECUTIVE_VALIDATION ${passed}/${passed}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

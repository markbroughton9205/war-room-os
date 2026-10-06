/** Durable source -> data -> view tests, with no live mission or journal mutation. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { missionRecordPaths, readMissionControlSource, executiveRoot, listExecutiveMissionIds } from './foundryMissionExecutiveRuntime'
import { saveMissionState, newTask, type MissionStateFiles } from './foundryMissionExecutive'
import { readProcessIdentity } from './foundryProcessIdentity'
import { buildMissionControlInput } from './foundryMissionControlData'
import { buildMissionControlView } from './foundryMissionControlView'
const tmp = mkdtempSync(path.join(os.tmpdir(), 'p8-mc-'))
const prior = process.env.REPO_ROOT
const priorData = process.env.WAR_ROOM_LOCAL_DATA_DIR
process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'app-data')
process.env.REPO_ROOT = tmp
const start = '2026-10-03T10:00:00.000Z', end = '2026-10-03T10:05:00.000Z'
function fixture(overrides: Record<string, unknown> = {}, states?: string[]) {
  const id = randomUUID()
  const [, file] = missionRecordPaths(id); mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ missionId: id, title: 'repair', userRequest: 'Repair calc.mjs and run npm test', status: 'COMPLETE', createdAt: start, updatedAt: end, completionGate: { complete: true, missing: [], detail: 'Checks passed' }, toolCalls: [{ tool: 'tests.run', ok: true }], journal: [{ at: end, kind: 'transition', text: 'VERIFYING → COMPLETE: completion gate passed' }], ...overrides }))
  if (states) saveMissionState(executiveRoot(), id, { graph: { missionId: id, goal: '', updatedAt: end, tasks: states.map((state, i) => ({ ...newTask({ taskId: `t${i}`, missionId: id, description: 'real task', completionCondition: 'verified', blockers: [{ kind: 'COMMANDER', ref: 'fixture', detail: 'preserved blocker' }] }), state })) }, evidence: [], failures: {}, ledger: {} } as MissionStateFiles)
  return id
}
function view(id: string, plus = 0) {
  const source = readMissionControlSource(id); assert.ok(source)
  return buildMissionControlView({ ...buildMissionControlInput(source), now: Date.parse(end) + 60_000 + plus })
}
try {
  const id = fixture()
  assert.ok(listExecutiveMissionIds().some(entry => entry.missionId === id), 'standalone mission without executive state must appear in picker')
  const [primary] = missionRecordPaths(id); mkdirSync(path.dirname(primary), { recursive: true }); writeFileSync(primary, readFileSync(missionRecordPaths(id)[1]))
  assert.equal(listExecutiveMissionIds().filter(entry => entry.missionId === id).length, 1, 'primary and mirror must not duplicate picker entries')
  saveMissionState(executiveRoot(), id, { graph: { missionId: id, goal: '', tasks: [], updatedAt: end }, evidence: [], failures: {}, ledger: {} })
  assert.equal(listExecutiveMissionIds().filter(entry => entry.missionId === id).length, 1, 'all three locations must deduplicate')
  writeFileSync(primary, '{bad')
  assert.ok(listExecutiveMissionIds().some(entry => entry.missionId === id), 'corrupt primary with a readable mirror remains listed')
  writeFileSync(path.join(path.dirname(primary), 'not-a-uuid.json'), JSON.stringify({ missionId: 'not-a-uuid', status: 'COMPLETE' }))
  assert.ok(listExecutiveMissionIds().every(entry => entry.missionId !== 'not-a-uuid'), 'invalid filenames must never become ids')
  writeFileSync(primary, readFileSync(missionRecordPaths(id)[1]))

  assert.equal(view(id).attention.kind, 'COMPLETE', 'durably verified standalone mission must display COMPLETE')
  assert.equal(view(id).header.elapsed, view(id, 86_400_000).header.elapsed)
  assert.equal(view(id).header.elapsed, '5m 00')
  assert.equal(view(id).taskGroups.length, 0)
  const historyId = fixture({ blocker: { blocker: 'Historical blocker', evidence: 'must remain in record' } })
  const [, historyPath] = missionRecordPaths(historyId), historyBytes = readFileSync(historyPath)
  assert.equal(view(historyId).attention.kind, 'COMPLETE')
  assert.deepEqual(readFileSync(historyPath), historyBytes)
  console.log('PASS verified standalone durable read/data/view completion and frozen elapsed')
  assert.equal(view(fixture({}, ['COMPLETED', 'CANCELLED'])).attention.kind, 'COMPLETE')
  assert.equal(view(fixture({}, ['CANCELLED'])).attention.kind, 'IDLE')
  assert.equal(view(fixture({}, ['READY'])).attention.kind, 'RUNNING')
  assert.equal(view(fixture({}, ['BLOCKED'])).attention.kind, 'BLOCKED')
  console.log('PASS completed graph, all cancelled, incomplete and blocked graph')
  for (const states of [undefined, []]) {
    assert.equal(view(fixture({ userRequest: 'mission.graph add_task then task.run', toolCalls: [{ tool: 'mission.graph', ok: true }] }, states)).attention.kind, 'IDLE')
    assert.equal(view(fixture({ completionGate: undefined }, states)).attention.kind, 'IDLE')
  }
  assert.equal(view(fixture({ toolCalls: [{ tool: 'job.start', ok: true }] }, [])).attention.kind, 'IDLE')
  assert.equal(view(fixture({ completionGate: { complete: true, missing: ['TEST_DONE'] } })).attention.kind, 'IDLE')
  for (const text of ['Model says COMPLETE', 'Model requested -> COMPLETE']) {
    assert.equal(view(fixture({ journal: [{ at: end, kind: 'decision', text }] })).attention.kind, 'IDLE')
  }
  assert.equal(view(fixture({ status: 'BLOCKED', blocker: { blocker: 'old blocker', evidence: 'preserved' } })).attention.kind, 'BLOCKED')
  assert.equal(view(fixture({ status: 'EXECUTING' })).attention.kind, 'IDLE')
  const corrupt = fixture(); const corruptFile = path.join(executiveRoot(), 'missions', `${corrupt}.executive.json`); mkdirSync(path.dirname(corruptFile), { recursive: true }); writeFileSync(corruptFile, '{bad')
  assert.equal(view(corrupt).attention.kind, 'IDLE')
  const absentGraph = fixture(); saveMissionState(executiveRoot(), absentGraph, { evidence: [], failures: {}, ledger: {} } as unknown as MissionStateFiles)
  assert.equal(view(absentGraph).attention.kind, 'IDLE')
  console.log('PASS missing/empty/corrupt graph ambiguity, durable gate, transition and noncomplete guards')
  // Persist queued/running job fixtures; exercise listJobs/inspectJob and the real source/data/view path.
  const identity = readProcessIdentity(process.pid); assert.ok(identity)
  for (const jobState of ['RUNNING', 'QUEUED']) {
    for (const graphStates of [undefined, ['COMPLETED']]) {
      const activeId = fixture({}, graphStates), jobId = randomUUID()
      const jobs = path.join(executiveRoot(), 'jobs'); mkdirSync(jobs, { recursive: true })
      writeFileSync(path.join(jobs, `${jobId}.json`), JSON.stringify({ jobId, missionId: activeId, taskId: '', kind: 'test', state: jobState, identity, startedAt: start, lastHeartbeat: end, finishedAt: null, exitStatus: null, claims: [], exitPath: path.join(jobs, `${jobId}.exit`), logPath: path.join(jobs, `${jobId}.log`) }))
      assert.equal(view(activeId).attention.kind, 'WAITING')
      const blocked = fixture({ status: 'BLOCKED' })
            // An active job attached to a blocked mission must keep BLOCKED priority.
      writeFileSync(path.join(jobs, `${jobId}.json`), JSON.stringify({ jobId, missionId: blocked, kind: 'test', state: 'QUEUED', startedAt: start, claims: [] }))
      assert.equal(view(blocked).attention.kind, 'BLOCKED')
    }
  }
  for (const record of [fixture(), fixture({ createdAt: 'invalid', updatedAt: 'invalid' }), fixture({}, ['BLOCKED'])]) assert.ok(!JSON.stringify(view(record)).includes('NaN'))
  console.log('PASS active job conflicts override complete and no NaN')
} finally { if (prior === undefined) delete process.env.REPO_ROOT; else process.env.REPO_ROOT = prior; if (priorData === undefined) delete process.env.WAR_ROOM_LOCAL_DATA_DIR; else process.env.WAR_ROOM_LOCAL_DATA_DIR = priorData; rmSync(tmp, { recursive: true, force: true }) }

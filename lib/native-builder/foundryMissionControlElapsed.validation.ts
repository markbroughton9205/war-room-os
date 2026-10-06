/** Mission Control elapsed time: a COMPLETE mission's elapsed freezes at its persisted completion time; an active or blocked mission keeps counting. Real record reads from an isolated base root. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { missionRecordPaths, readMissionControlSource } from './foundryMissionExecutiveRuntime'
import { buildMissionControlInput } from './foundryMissionControlData'
import { buildMissionControlView } from './foundryMissionControlView'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'mc-elapsed-'))
const priorRoot = process.env.REPO_ROOT
process.env.REPO_ROOT = tmp
const T0 = '2026-10-03T18:00:00.000Z'
const DONE = '2026-10-03T18:02:30.000Z'      // the transition into COMPLETE: 2m 30 after start
const LATER_SAVE = '2026-10-03T19:40:00.000Z' // a later save of the record (updatedAt must not become the end time)
const at = (iso: string, plusMs = 0) => Date.parse(iso) + plusMs

function writeRecord(id: string, overrides: Record<string, unknown>) {
  const [, mirror] = missionRecordPaths(id)
  mkdirSync(path.dirname(mirror), { recursive: true })
  writeFileSync(mirror, JSON.stringify({ title: 'elapsed', userRequest: 'o', status: 'COMPLETE', createdAt: T0, updatedAt: LATER_SAVE, journal: [], ...overrides }))
}
/** The real read path, viewed at a chosen wall-clock time (a reopened page / restarted runtime reads the same record again). */
function viewAt(id: string, nowMs: number) {
  const source = readMissionControlSource(id)!
  const input = buildMissionControlInput(source)
  return buildMissionControlView({ ...input, now: nowMs })
}
const transition = (atIso: string, text: string) => ({ at: atIso, kind: 'transition', text })

try {
  // 1. An active mission's elapsed keeps increasing.
  {
    const id = randomUUID()
    writeRecord(id, { status: 'EXECUTING', journal: [transition('2026-10-03T18:00:01.000Z', 'QUEUED → EXECUTING: start')] })
    assert.equal(viewAt(id, at(T0, 60_000)).header.elapsed, '1m 00')
    assert.equal(viewAt(id, at(T0, 5 * 60_000)).header.elapsed, '5m 00')
    assert.notEqual(viewAt(id, at(T0, 60_000)).header.elapsed, viewAt(id, at(T0, 5 * 60_000)).header.elapsed)
    ok('an active mission elapsed keeps increasing')
  }

  // 2. A completed mission's elapsed is frozen, however much later it is viewed.
  const doneId = randomUUID()
  const journal = [
    transition('2026-10-03T18:00:01.000Z', 'QUEUED → EXECUTING: start'),
    transition('2026-10-03T18:02:29.900Z', 'EXECUTING → VERIFYING: Gate complete; enter VERIFYING before COMPLETE'),
    transition(DONE, 'VERIFYING → COMPLETE: gates satisfied'),
  ]
  {
    writeRecord(doneId, { journal })
    const soon = viewAt(doneId, at(DONE, 1_000)).header.elapsed
    const hourLater = viewAt(doneId, at(DONE, 3_600_000)).header.elapsed
    const dayLater = viewAt(doneId, at(DONE, 86_400_000)).header.elapsed
    assert.equal(soon, '2m 30')
    assert.equal(hourLater, soon)
    assert.equal(dayLater, soon)
    ok('a completed mission elapsed is frozen')
  }

  // 3. It uses the persisted completion timestamp (the transition into COMPLETE), not updatedAt or the current time.
  {
    const source = readMissionControlSource(doneId)!
    assert.equal(source.mission.completedAt, DONE)
    assert.equal(source.mission.updatedAt, LATER_SAVE, 'the record was saved again later; that must not move the end time')
    const input = buildMissionControlInput(source)
    assert.equal(input.mission.endedAt, DONE)
    assert.equal(viewAt(doneId, at(LATER_SAVE, 1)).header.elapsed, '2m 30', 'not updatedAt − start (1h 40m)')
    // reopened once: the LAST transition into COMPLETE wins
    const reopenedId = randomUUID()
    writeRecord(reopenedId, { journal: [...journal, transition('2026-10-03T18:10:00.000Z', 'COMPLETE → EXECUTING: reopened'), transition('2026-10-03T18:15:00.000Z', 'VERIFYING → COMPLETE: gates satisfied again')] })
    assert.equal(viewAt(reopenedId, at(LATER_SAVE)).header.elapsed, '15m 00')
    // no journal entry at all: the record's own updatedAt is the persisted fallback (still frozen)
    const bareId = randomUUID()
    writeRecord(bareId, { journal: [], updatedAt: '2026-10-03T18:04:00.000Z' })
    assert.equal(viewAt(bareId, at(DONE, 1)).header.elapsed, '4m 00')
    assert.equal(viewAt(bareId, at(DONE, 86_400_000)).header.elapsed, '4m 00')
    ok('a completed mission uses its persisted completion timestamp (last COMPLETE transition, else updatedAt)')
  }

  // 4. Restart / reopen: the stored record read again gives the same frozen value, whatever the session or process.
  {
    const first = viewAt(doneId, at(DONE, 10_000)).header.elapsed
    const reopened = viewAt(doneId, at(DONE, 7 * 86_400_000)).header.elapsed // a runtime restarted a week later reads the same record from disk
    assert.equal(reopened, first)
    assert.equal(JSON.stringify(readMissionControlSource(doneId)!.mission.completedAt), JSON.stringify(DONE))
    ok('restart/reopen reads the persisted record and the frozen elapsed value does not change')
  }

  // 5. Everything else is unchanged: labels, blocked elapsed keeps counting, failure counts numeric, startedAt is the persisted createdAt, no NaN.
  {
    const view = viewAt(doneId, at(DONE, 5_000))
    assert.equal(view.header.stateLabel, 'Complete')
    assert.equal(view.header.phase, 'Done')
    assert.equal(buildMissionControlInput(readMissionControlSource(doneId)!).mission.startedAt, T0)
    const blockedId = randomUUID()
    writeRecord(blockedId, { status: 'BLOCKED', blocker: { blocker: 'MODEL UNAVAILABLE', evidence: 'x' }, journal: [transition('2026-10-03T18:01:00.000Z', 'EXECUTING → BLOCKED: x')] })
    const b1 = viewAt(blockedId, at(T0, 2 * 60_000)).header
    const b2 = viewAt(blockedId, at(T0, 20 * 60_000)).header
    assert.equal(b1.stateLabel, 'Needs the Commander')
    assert.equal(b1.elapsed, '2m 00')
    assert.equal(b2.elapsed, '20m 00', 'a blocked mission is not complete: its elapsed keeps counting')
    assert.equal(buildMissionControlInput(readMissionControlSource(blockedId)!).mission.endedAt, null, 'the data layer gives only a COMPLETE mission an end time')
    const synthetic = (status: string) => buildMissionControlView({ ...buildMissionControlInput(readMissionControlSource(doneId)!), now: at(DONE, 3_600_000), mission: { ...buildMissionControlInput(readMissionControlSource(doneId)!).mission, status, endedAt: DONE } }).header.elapsed
    assert.equal(synthetic('COMPLETE'), '2m 30')
    assert.equal(synthetic('EXECUTING'), '1h 2m', 'the view freezes only a COMPLETE mission, even if an end time is present')
    assert.equal(synthetic('BLOCKED'), '1h 2m')
    const withFailures = buildMissionControlInput({ ...readMissionControlSource(doneId)!, state: { graph: { tasks: [] }, evidence: [], failures: { a: { signature: 's', count: '3' } } } } as never)
    assert.deepEqual(withFailures.failures.map(item => item.count), [3])
    assert.ok(!JSON.stringify(view).includes('NaN') && !JSON.stringify(b2).includes('NaN'))
    ok('COMPLETE / BLOCKED labels, persisted startedAt, numeric failure counts and no-NaN behaviour are unchanged')
  }
} finally {
  if (priorRoot === undefined) delete process.env.REPO_ROOT; else process.env.REPO_ROOT = priorRoot
  rmSync(tmp, { recursive: true, force: true })
}
console.log(`MISSION_CONTROL_ELAPSED_VALIDATION ${passed}/5`)

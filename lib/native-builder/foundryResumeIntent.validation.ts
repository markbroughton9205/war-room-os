import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const tmp = mkdtempSync(path.join(os.tmpdir(), 'p8-resume-intent-'))
process.env.REPO_ROOT = tmp
process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'app-data')
try {
  const { startMissionInput } = await import('./foundryMissionController')
  const { saveMission, loadMission } = await import('./foundryMissionStore')
  const { resumeMissionRecord } = await import('./foundryOperationsManager')
  const m = startMissionInput('Fix add in calc.mjs and run npm test. Do not change tests or package.json. Do not install anything or spend money.')
  m.kind = 'application'; m.interpretation.kind = 'application'; m.status = 'BLOCKED'
  m.blocker = { blocker: 'old failure', evidence: 'original evidence', attempted: 'lint', why: 'missing tooling', unblock: 'restore tooling' }
  m.plan.push({ id: 'history', intent: 'BUILD', title: 'Historical build', status: 'failed', note: 'original failure' })
  const evidence = JSON.stringify({ plan: m.plan, permissions: m.permissions, maxLoops: m.maxLoops, loopCount: m.loopCount })
  await saveMission(m)
  const resumed = await resumeMissionRecord(m.missionId)
  assert.equal(resumed.kind, 'fixture')
  assert.equal(resumed.status, 'EXECUTING')
  assert.equal(resumed.blocker, null)
  assert.ok(resumed.journal.some(j=>j.text.includes('old failure') && j.text.includes('original evidence')))
  assert.equal(JSON.stringify({ plan: resumed.plan, permissions: resumed.permissions, maxLoops: resumed.maxLoops, loopCount: resumed.loopCount }), evidence)
  assert.equal((await loadMission(m.missionId))?.kind, 'fixture')
  const held = startMissionInput('Fix calc.mjs. Do not change package.json or install anything.')
  held.kind = 'application'; held.interpretation.kind = 'application'; held.status = 'BLOCKED'
  held.authorization = { waiting: true, action: 'review', reason: 'approval required', target: 'mission', impact: 'resume' }
  await saveMission(held)
  const heldResult = await resumeMissionRecord(held.missionId)
  assert.equal(heldResult.kind, 'application', 'correctable request cannot bypass authorization hold')
  assert.equal(heldResult.status, 'BLOCKED')
  assert.equal(heldResult.authorization?.waiting, true)
  for (const waiting of [true, false]) {
    const guarded = startMissionInput('Install the runtime. Do not spend money.')
    guarded.status = 'BLOCKED'
    if (waiting) guarded.authorization = { waiting: true, action: 'install', reason: 'approval required', target: 'app', impact: 'installation' }
    await saveMission(guarded)
    const result = await resumeMissionRecord(guarded.missionId)
    assert.equal(result.kind, 'application')
    if (waiting) assert.equal(result.status, 'BLOCKED')
  }
  console.log('PASS actual resume path corrects classification before EXECUTING, persists it, preserves evidence/ceilings and authorization guard')
} finally { rmSync(tmp, { recursive: true, force: true }) }

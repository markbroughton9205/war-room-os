/** Regression guards for the Phase 8 Mission Control review findings: wrong COMPLETE/BLOCKED attention, startedAt = now, failures built from agent events with NaN counts. Synthetic input only. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { foundryDataHierarchy } from './foundryPaths'
import { missionRecordPaths, readMissionControlSource } from './foundryMissionExecutiveRuntime'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { McInput } from './foundryMissionControlTypes'
import { describeAttention } from './foundryMissionControlAttention'
import { buildMissionControlInput, missionIdOf } from './foundryMissionControlData'
import { buildMissionControlView } from './foundryMissionControlView'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

type TaskState = McInput['tasks'][number]['state']
const attentionInput = (status: string, tasks: Array<{ state: TaskState; blockers?: Array<{ kind: string; detail: string }> }>): McInput => ({
  now: 0,
  mission: { missionId: 'm1', title: 't', objective: 'o', status, startedAt: '0', lastProgressAt: null, restarts: 0 },
  tasks: tasks.map((task, index) => ({ taskId: `t${index}`, description: 'd', state: task.state, dependencies: [], blockers: task.blockers ?? [], attempts: 0 })),
  jobs: [], leases: [], evidence: [], failures: [], timeline: [],
})

const createdAt = '2026-10-01T12:00:00.000Z'
const now = Date.parse('2026-10-03T00:00:00.000Z')
const source = (overrides: Record<string, unknown> = {}) => ({
  now,
  mission: { missionId: 'm1', title: 't', objective: 'o', status: 'COMPLETE', createdAt, updatedAt: '2026-10-02T12:00:00.000Z', sessionId: null, blocker: null, modelCalls: 0, toolCalls: 0 },
  state: null, jobs: [], leases: [], usage: {}, agentEvents: [],
  ...overrides,
}) as unknown as Parameters<typeof buildMissionControlInput>[0]
const emptyState = { graph: { tasks: [] }, evidence: [], failures: {} }

// 1. cancelled (superseded) tasks do not stop a finished mission from being complete
{
  const view = describeAttention(attentionInput('COMPLETE', [{ state: 'COMPLETED' }, { state: 'CANCELLED' }]))
  assert.equal(view.kind, 'COMPLETE')
  assert.equal(view.needsCommander, false)
  ok('COMPLETE mission with completed and cancelled tasks reports COMPLETE')
}

// 2. ...but a mission with nothing completed is not complete
{
  const view = describeAttention(attentionInput('COMPLETE', [{ state: 'CANCELLED' }]))
  assert.equal(view.kind, 'IDLE')
  ok('COMPLETE mission whose tasks are all cancelled is not reported complete')
}

// 3. BLOCKED with no blocker detail: fallback text, no throw, no "undefined"
{
  const view = describeAttention(attentionInput('BLOCKED', [{ state: 'BLOCKED', blockers: [] }]))
  assert.equal(view.kind, 'BLOCKED')
  assert.equal(view.needsCommander, true)
  assert.equal(view.message, 'Commander decision required: the mission is blocked')
  assert.ok(!/undefined/.test(view.message))
  ok('BLOCKED task with no blocker detail uses the fallback text and does not throw')
}

// 4. BLOCKED with a detail: the detail is used
{
  const view = describeAttention(attentionInput('BLOCKED', [{ state: 'BLOCKED', blockers: [{ kind: 'CREDENTIALS', detail: 'credentials missing' }] }]))
  assert.equal(view.message, 'Commander decision required: credentials missing')
  ok('BLOCKED task with a blocker detail reports that detail')
}

// 5. startedAt is when the mission was created (the persisted ISO time), not when the page is opened
{
  const input = buildMissionControlInput(source())
  assert.equal(input.mission.startedAt, createdAt)
  assert.notEqual(input.mission.startedAt, String(now))
  ok('startedAt is the mission createdAt, not now')
}

// 6. failures come from the failure book with numeric counts; only executive events enter the timeline
{
  const input = buildMissionControlInput(source({
    state: { ...emptyState, failures: { 't1::boom': { signature: 'boom', count: 3, lastAt: '2026-10-02T00:00:00.000Z' }, 't2::bad': { signature: 'bad', count: 1, lastAt: '2026-10-02T00:00:00.000Z' } } },
    agentEvents: [{ at: '2026-10-02T00:00:00.000Z', type: 'MISSION_EXECUTIVE', text: 'tick' }, { at: '2026-10-02T00:00:01.000Z', type: 'CONTENT', text: 'chatter' }],
  }))
  assert.equal(input.failures.length, 2)
  assert.deepEqual(input.failures.map(item => item.key), ['t1::boom', 't2::bad'])
  assert.deepEqual(input.failures.map(item => item.signature), ['boom', 'bad'])
  assert.deepEqual(input.failures.map(item => item.count), [3, 1])
  assert.ok(input.failures.every(item => typeof item.count === 'number' && !Number.isNaN(item.count)))
  assert.equal(input.timeline.length, 1)
  assert.equal(input.timeline[0].text, 'tick')
  ok('failures come from the failure book with numeric counts; the timeline holds only executive events')
}

// 7. The Panel is a client component (it uses hooks; without the directive the production build fails) and the route validates the mission id before it reaches a file path.
{
  const root = resolveRepoRoot()
  const panel = readFileSync(path.join(root, 'components/war-room/foundry/FoundryMissionControlPanel.tsx'), 'utf8')
  assert.ok(/^\s*['"]use client['"]/.test(panel), 'the Panel must start with the use client directive')
  const route = readFileSync(path.join(root, 'app/api/foundry/mission-control/route.ts'), 'utf8')
  const guard = route.indexOf('MISSION_ID.test(missionId)')
  const load = route.indexOf('loadMissionControlView(missionId)')
  assert.ok(guard >= 0 && load > guard, 'the mission id must be validated before the view is loaded')
  assert.ok(/status: 400/.test(route), 'an invalid id is a 400')
  ok('the Panel is a client component and the route validates the mission id before loading')
}

// 8. The mission list uses each entry's missionId (the entry itself stringified to "[object Object]" for every mission).
{
  assert.equal(missionIdOf({ missionId: 'abc-123', mtimeMs: 1 } as never), 'abc-123')
  assert.equal(missionIdOf('plain-id'), 'plain-id')
  assert.notEqual(missionIdOf({ missionId: 'abc-123' }), '[object Object]')
  ok('the mission list uses each entry missionId, never "[object Object]"')
}

// 9. A mission record is looked up in the store primary directory first and the repo mirror second, whatever the working directory or REPO_ROOT is (the installed UI runs inside the install tree, where the mirror does not exist).
{
  const priorRoot = process.env.REPO_ROOT
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'mc-root-'))
  try {
    process.env.REPO_ROOT = tmp
    const id = randomUUID()
    const [primary, mirror] = missionRecordPaths(id)
    assert.equal(primary, path.join(foundryDataHierarchy().missions, `${id}.json`), 'the store primary directory comes first')
    assert.equal(mirror, path.join(tmp, '.war-room', 'foundry-missions', `${id}.json`), 'the mirror under the base repo root comes second')
    assert.equal(readMissionControlSource(id), null, 'an unknown mission is null')
    mkdirSync(path.dirname(mirror), { recursive: true })
    writeFileSync(mirror, JSON.stringify({ title: 'only in the mirror', userRequest: 'o', status: 'COMPLETE', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }))
    assert.equal(readMissionControlSource(id)?.mission.title, 'only in the mirror', 'a record present only in the mirror is still found')
  } finally {
    if (priorRoot === undefined) delete process.env.REPO_ROOT; else process.env.REPO_ROOT = priorRoot
    rmSync(tmp, { recursive: true, force: true })
  }
  ok('mission records are read from the store primary directory first, then the repo mirror, independent of the working directory')
}

// 10. No duration ever renders as NaN: header times are ISO (the view parses ISO), job times are parsed whether ISO or epoch milliseconds, and an unusable time reads "unknown".
{
  const job = (startedAt: string, finishedAt: string | undefined) => ({ jobId: 'j', kind: 'test', taskId: 't', state: finishedAt ? 'SUCCEEDED' : 'RUNNING', startedAt, finishedAt, claims: [] })
  const input = buildMissionControlInput(source({ jobs: [job('2026-10-02T12:00:00.000Z', '2026-10-02T13:00:00.000Z'), job('2026-10-02T12:00:00.000Z', undefined), job(String(Date.parse('2026-10-02T12:00:00.000Z')), '2026-10-02T12:02:09.000Z'), job('not a date', undefined)] }))
  const view = buildMissionControlView(input)
  assert.equal(view.jobs[0].elapsed, '1h 0m', 'ISO start and finish')
  assert.ok(/^\d+h \d+m$/.test(view.jobs[1].elapsed), `a running job measures from its start to now: ${view.jobs[1].elapsed}`)
  assert.equal(view.jobs[2].elapsed, '2m 09', 'an epoch-millisecond start is accepted')
  assert.equal(view.jobs[3].elapsed, 'unknown', 'an unusable start time is unknown, not NaN')
  assert.ok(!JSON.stringify(view).includes('NaN'), 'no NaN anywhere in the rendered view')
  assert.ok(/^\d+h \d+m$/.test(view.header.elapsed), `header elapsed: ${view.header.elapsed}`)
  assert.ok(/ago$/.test(view.header.lastProgress) && !view.header.lastProgress.includes('NaN'), `last progress: ${view.header.lastProgress}`)
  ok('the rendered view never contains NaN: header and job durations are real or "unknown"')
}

console.log(`MISSION_CONTROL_FIXES_VALIDATION ${passed}/10`)

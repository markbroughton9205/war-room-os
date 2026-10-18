/**
 * Council -> Foundry: proposal, Commander approval, start through Foundry's service port, status ONLY from Foundry's records,
 * result returned once into the same conversation. Fake Foundry port for state control + the real conversation storage.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FoundryMissionView, FoundryPort, FoundryStartBody } from './foundryPort'
import { CouncilMissionError, createCouncilMissionService, statusFromFoundry, type CouncilMissionStorage } from './service'
import type { CouncilMissionProposal } from './types'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

function memoryStorage() {
  let rows: CouncilMissionProposal[] = []
  const messages: Array<{ role: string; family: string; content: string; metadata: Record<string, unknown> }> = []
  const storage: CouncilMissionStorage = {
    read: () => rows,
    write: next => { rows = JSON.parse(JSON.stringify(next)) },
    postMessage: m => { messages.push(m); return { id: `msg_${messages.length}` } },
  }
  return { storage, messages, rows: () => rows }
}

function fakeFoundry(opts: { available?: boolean } = {}) {
  const missions = new Map<string, FoundryMissionView>()
  const calls = { start: [] as Array<{ body: FoundryStartBody; actor: string }>, cancel: [] as string[] }
  let available = opts.available ?? true
  const port: FoundryPort = {
    availability: () => (available ? { ok: true } : { ok: false, reason: 'no engineering repository is configured' }),
    start: async (body, actor) => {
      calls.start.push({ body, actor })
      const id = `msn-fixture-${calls.start.length}`
      missions.set(id, { id, state: 'QUEUED', stateReason: 'queued', stateAt: new Date().toISOString() })
      return { missionId: id, state: 'QUEUED' }
    },
    get: id => missions.get(id) ?? null,
    cancel: (id, _actor, reason) => { calls.cancel.push(`${id}:${reason}`); const m = missions.get(id); if (m) missions.set(id, { ...m, state: 'CANCELLED', stateReason: reason }) },
  }
  return {
    port, calls, missions,
    setAvailable: (v: boolean) => { available = v },
    set: (id: string, patch: Partial<FoundryMissionView>) => missions.set(id, { ...missions.get(id)!, ...patch }),
  }
}

const GOOD_RECEIPT: NonNullable<FoundryMissionView['receipt']> = {
  receiptSha256: 'a'.repeat(64),
  verifier: { label: 'npm test', exitCode: 0, summary: '2 passed', at: new Date().toISOString() },
  integration: { state: 'APPLIED', branch: 'foundry/msn-1', commit: 'c0ffee1234567890', tree: 'deadbeef' },
  filesCreated: [],
  filesModified: [{ path: 'calc.mjs' }],
  testsAdded: [],
}
const INPUT = { conversationId: 'lcnv_fixture', request: 'Fix add() in calc.mjs so add(2, 3) is 5 and keep the tests passing.', acceptance: ['npm test passes'], targets: [{ path: 'calc.mjs', action: 'modify' }] }

// 1. proposing never contacts Foundry
{
  const m = memoryStorage(); const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  const p = svc.propose(INPUT)
  assert.equal(p.status, 'PROPOSED'); assert.equal(f.calls.start.length, 0)
  assert.equal(p.install, false); assert.deepEqual(p.scope.write, ['calc.mjs'])
  assert.equal(m.messages.length, 1); assert.match(m.messages[0].content, /Nothing has been started/)
  ok('1: a proposal is stored and announced in the conversation; Foundry is not contacted')
}

// 2. approval starts exactly one Foundry mission through the port, as the Commander
{
  const m = memoryStorage(); const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  const p = svc.propose(INPUT)
  const a = await svc.approve(p.proposalId, 'commander-1')
  assert.equal(a.status, 'RUNNING'); assert.equal(f.calls.start.length, 1)
  assert.equal(f.calls.start[0].actor, 'commander-1'); assert.equal(f.calls.start[0].body.install, false)
  assert.deepEqual(f.calls.start[0].body.targets, [{ path: 'calc.mjs', action: 'modify' }])
  assert.equal(a.foundry?.missionId, 'msn-fixture-1'); assert.equal(a.approval?.by, 'commander-1')
  await assert.rejects(() => svc.approve(p.proposalId, 'commander-1'), (e: unknown) => e instanceof CouncilMissionError && e.code === 'ILLEGAL')
  assert.equal(f.calls.start.length, 1, 'a second approve cannot start a second mission')
  ok('2: approval starts exactly one Foundry mission as the Commander; a second approve is refused')
}

// 3. Foundry unavailable is reported truthfully and recoverable
{
  const m = memoryStorage(); const f = fakeFoundry({ available: false })
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  const p = svc.propose(INPUT)
  const a = await svc.approve(p.proposalId, 'c')
  assert.equal(a.status, 'START_FAILED'); assert.match(a.statusReason, /not available/); assert.equal(f.calls.start.length, 0)
  f.setAvailable(true)
  const b = await svc.approve(p.proposalId, 'c')
  assert.equal(b.status, 'RUNNING')
  ok('3: an unavailable Foundry is START_FAILED with the reason, and the same proposal can be approved again')
}

// 4. completion only from Foundry's records; result returned exactly once
{
  const m = memoryStorage(); const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  const p = svc.propose(INPUT)
  await svc.approve(p.proposalId, 'c')
  f.set('msn-fixture-1', { state: 'RUNNING', stateReason: 'building', progress: { stepsDone: 1, stepsTotal: 4, modelCalls: 3, filesChanged: [], lastEvent: 'step 1' } })
  let rows = svc.sync()
  assert.equal(rows[0].status, 'RUNNING'); assert.equal(rows[0].foundry?.progress?.stepsDone, 1)
  assert.equal(m.messages.filter(x => x.family === 'FOUNDRY').length, 0, 'no result message while running')
  f.set('msn-fixture-1', { state: 'COMPLETED', stateReason: 'done', result: { status: 'COMPLETED', reason: 'ok', verifierExit: 0 }, receipt: GOOD_RECEIPT, receiptCheck: { ok: true, mismatches: [] } })
  rows = svc.sync(); rows = svc.sync(); rows = svc.sync()
  assert.equal(rows[0].status, 'COMPLETED'); assert.equal(rows[0].foundry?.receipt?.receiptVerified, true)
  const results = m.messages.filter(x => x.family === 'FOUNDRY')
  assert.equal(results.length, 1, 'result is returned into the conversation exactly once')
  assert.match(results[0].content, /npm test exit 0/); assert.match(results[0].content, /foundry\/msn-1/)
  assert.equal((results[0].metadata.councilMission as { missionId: string }).missionId, 'msn-fixture-1')
  ok('4: COMPLETED only with a passing verifier receipt that verifies; the result is written back once')
}

// 5. Foundry saying COMPLETED is not enough
{
  const bad = (patch: Partial<FoundryMissionView>) => statusFromFoundry({ id: 'x', state: 'COMPLETED', stateReason: 'done', stateAt: '', ...patch })
  assert.equal(bad({}).status, 'FAILED')
  assert.equal(bad({ result: { status: 'COMPLETED', reason: '', verifierExit: 0 }, receipt: { ...GOOD_RECEIPT, verifier: { ...GOOD_RECEIPT.verifier, exitCode: 1 } }, receiptCheck: { ok: true, mismatches: [] } }).status, 'FAILED')
  assert.equal(bad({ result: { status: 'COMPLETED', reason: '', verifierExit: 0 }, receipt: GOOD_RECEIPT, receiptCheck: { ok: false, mismatches: ['sha'] } }).status, 'FAILED')
  assert.equal(bad({ result: { status: 'FAILED', reason: '', verifierExit: 0 }, receipt: GOOD_RECEIPT, receiptCheck: { ok: true, mismatches: [] } }).status, 'FAILED')
  assert.equal(statusFromFoundry({ id: 'x', state: 'INTERRUPTED', stateReason: 'died', stateAt: '' }).status, 'INTERRUPTED')
  assert.equal(statusFromFoundry({ id: 'x', state: 'VERIFYING', stateReason: '', stateAt: '' }).status, 'RUNNING')
  ok('5: COMPLETED without a result, a passing verifier or a verified receipt is reported FAILED; interrupted/running map truthfully')
}

// 6. failure/cancel/unknown mission, reject, illegal transitions
{
  const m = memoryStorage(); const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  const a = svc.propose(INPUT); await svc.approve(a.proposalId, 'c')
  f.set('msn-fixture-1', { state: 'FAILED', stateReason: 'tests failed' })
  assert.equal(svc.sync()[0].status, 'FAILED')
  assert.match(m.messages.filter(x => x.family === 'FOUNDRY')[0].content, /ended FAILED/)
  const b = svc.propose({ ...INPUT, title: 'second' })
  const r = svc.reject(b.proposalId, 'c', 'not now')
  assert.equal(r.status, 'REJECTED'); assert.equal(f.calls.start.length, 1)
  assert.throws(() => svc.cancel(b.proposalId, 'c'), (e: unknown) => e instanceof CouncilMissionError)
  const c = svc.propose({ ...INPUT, title: 'third' }); await svc.approve(c.proposalId, 'c')
  svc.cancel(c.proposalId, 'c', 'changed my mind')
  assert.equal(f.calls.cancel.length, 1)
  f.missions.delete('msn-fixture-2')
  assert.equal(svc.sync().find(x => x.proposalId === c.proposalId)?.status, 'FAILED', 'a mission Foundry has no record of is not shown as running')
  ok('6: failed/cancelled/unknown Foundry missions and rejected proposals are reported as what they are')
}

// 7. unsafe paths are refused before anything is stored
{
  const m = memoryStorage(); const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  for (const bad of ['../etc/passwd', '/etc/passwd', 'a\\b', 'a/../../b', '', 'x'.repeat(300)]) {
    assert.throws(() => svc.propose({ ...INPUT, targets: [{ path: bad }] }), (e: unknown) => e instanceof CouncilMissionError && e.code === 'INVALID', `refused ${JSON.stringify(bad).slice(0, 30)}`)
  }
  assert.throws(() => svc.propose({ ...INPUT, request: 'too short' }))
  assert.equal(m.rows().length, 0)
  ok('7: unsafe or empty paths and trivial requests are refused and nothing is stored')
}

// 8. real conversation storage: proposals live in the owner's conversation and survive a client metadata replace
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'council-missions-'))
  Object.assign(process.env, { WAR_ROOM_LOCAL_DATA_DIR: tmp, REPO_ROOT: tmp })
  const { getLocalOwnershipStore } = await import('@/lib/sovereign-runtime/local-ownership/store')
  const { conversationMissionStorage } = await import('./conversationStorage')
  const gw = await import('@/lib/war-room/localConversationGateway')
  const store = getLocalOwnershipStore(tmp)
  store.bootstrapCommander({ password: 'validator-only-' + Math.random().toString(36).slice(2) + 'Aa1!', displayName: 'V' })
  const ownerId = store.getCommanderPublic()!.id
  const conv = store.createCouncilConversation(ownerId, 'Mission thread', { council: { source: 'live_council' } })
  const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: conversationMissionStorage(store, ownerId, conv.id), foundry: f.port })
  const p = svc.propose({ ...INPUT, conversationId: conv.id })
  await svc.approve(p.proposalId, 'c')
  f.set('msn-fixture-1', { state: 'COMPLETED', stateReason: 'done', result: { status: 'COMPLETED', reason: 'ok', verifierExit: 0 }, receipt: GOOD_RECEIPT, receiptCheck: { ok: true, mismatches: [] } })
  svc.sync()
  const patch = await gw.localConversationPatch(new Request('http://127.0.0.1:3001/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Renamed', metadata: { council: { source: 'live_council' }, councilMissions: [], evil: 1 } }) }), ownerId, conv.id)
  assert.equal(patch.status, 200)
  const after = store.getCouncilConversation(ownerId, conv.id)!
  const kept = after.metadata.councilMissions as CouncilMissionProposal[]
  assert.equal(kept.length, 1); assert.equal(kept[0].status, 'COMPLETED'); assert.equal(kept[0].foundry?.missionId, 'msn-fixture-1')
  const msgs = store.listCouncilMessages(ownerId, conv.id)!
  assert.ok(msgs.some(x => x.family === 'FOUNDRY' && (x.metadata.councilMission as { missionId?: string })?.missionId === 'msn-fixture-1'), 'result is in the same conversation')
  const trashed = store.trashCouncilConversations(ownerId, [conv.id]); assert.equal(trashed.trashed.length, 1)
  store.restoreCouncilConversations(ownerId, [conv.id])
  assert.equal((store.getCouncilConversation(ownerId, conv.id)!.metadata.councilMissions as unknown[]).length, 1, 'links survive Trash and Restore')
  ok('8: proposals persist in the conversation, ignore client overwrites, and survive Trash/Restore; the result sits in the same thread')
}

// 9. no acceptance criteria given -> an explicit default is stated, so Foundry (which requires one) can start
{
  const m = memoryStorage(); const f = fakeFoundry()
  const svc = createCouncilMissionService({ storage: m.storage, foundry: f.port })
  const p = svc.propose({ ...INPUT, acceptance: [] })
  assert.equal(p.acceptance.length, 1); assert.match(p.acceptance[0], /tests and checks pass/)
  ok('9: a proposal without acceptance criteria carries one explicit default criterion')
}

// 10. concurrent approvals start one mission; sensitive targets are refused
{
  const m = memoryStorage(); const f = fakeFoundry()
  const slow = { ...f.port, start: async (b: FoundryStartBody, a: string) => { await new Promise(r => setTimeout(r, 30)); return f.port.start(b, a) } }
  const svc = createCouncilMissionService({ storage: m.storage, foundry: slow })
  const p = svc.propose(INPUT)
  const results = await Promise.allSettled([svc.approve(p.proposalId, 'c'), svc.approve(p.proposalId, 'c')])
  assert.equal(f.calls.start.length, 1, 'exactly one Foundry mission is started')
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  for (const bad of ['.git/hooks/pre-commit', '.env.local', '.github/workflows/x.yml', 'node_modules/x/index.js', '-rf', 'keys/server.pem']) {
    assert.throws(() => svc.propose({ ...INPUT, targets: [{ path: bad }] }), /Unsafe/, bad)
  }
  ok('10: concurrent approvals start exactly one Foundry mission; VCS, secret, CI and dependency paths are refused as targets')
}

console.log(`\n${passed}/10 council mission validations passed`)
assert.equal(passed, 10)

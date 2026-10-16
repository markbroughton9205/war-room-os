/* eslint-disable @typescript-eslint/no-explicit-any -- validator inspects loosely typed JSON responses */
/**
 * Council session management: unused empty sessions are never accumulated, Trash is recoverable, restore returns the same rows with
 * their messages, permanent deletion only works from Trash with an explicit confirmation, and bulk archive/rename work.
 * Real local-ownership store + real gateway handlers on an isolated temp data directory (production data is never touched).
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }

const tmp = mkdtempSync(path.join(os.tmpdir(), 'council-sessions-'))
Object.assign(process.env, { WAR_ROOM_LOCAL_DATA_DIR: tmp, REPO_ROOT: tmp })

const { getLocalOwnershipStore } = await import('@/lib/sovereign-runtime/local-ownership/store')
const gw = await import('@/lib/war-room/localConversationGateway')
const ledger = await import('@/lib/council/commander-chat/sessionLedger')

const store = getLocalOwnershipStore(tmp)
const boot = store.bootstrapCommander({ password: 'validator-only-' + Math.random().toString(36).slice(2) + 'Aa1!', displayName: 'Validator' })
assert.ok((boot as { ok?: boolean }).ok !== false, 'commander bootstrapped')
const ownerId = store.getCommanderPublic()!.id

const req = (body: unknown, url = 'http://127.0.0.1:3001/api/conversations') => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3001' }, body: JSON.stringify(body) })
const json = async (r: Response) => (await r.json()) as Record<string, any>

// fixtures: a real conversation with messages + research/attribution + mission link, plus unused empties
const real = store.createCouncilConversation(ownerId, 'Real discussion', { council: { source: 'live_council', lastPreview: 'x' }, councilStage1: { turns: [{ turnId: 't1' }] }, councilMissions: [{ missionId: 'm1' }] })
store.addCouncilMessage(ownerId, real.id, { role: 'user', content: 'hello council' })
store.addCouncilMessage(ownerId, real.id, { role: 'assistant', content: 'a real reply', family: 'ORION', metadata: { providerModel: 'm', backendProvider: 'ollama' } })
const emptyA = store.createCouncilConversation(ownerId, 'New Council Session', { council: { source: 'live_council' } })
const emptyB = store.createCouncilConversation(ownerId, 'New Council Session', { council: { source: 'live_council' } })
const titledEmpty = store.createCouncilConversation(ownerId, 'Planning notes', { council: { source: 'live_council' } })
const linkedEmpty = store.createCouncilConversation(ownerId, 'New Council Session', { council: { source: 'live_council' }, councilMissions: [{ missionId: 'm2' }] })

// 1. empty finder is conservative
{
  const found = store.findUnusedEmptyCouncilConversations(ownerId)
  assert.deepEqual(new Set(found), new Set([emptyA.id, emptyB.id]), `only the two truly unused empties: ${found}`)
  assert.ok(!found.includes(real.id) && !found.includes(titledEmpty.id) && !found.includes(linkedEmpty.id))
  assert.deepEqual(store.findUnusedEmptyCouncilConversations(ownerId, { excludeIds: [emptyA.id] }), [emptyB.id], 'the active session can be excluded')
  ok('1: unused-empty finder never returns a session with messages, a custom title, Stage 1 turns or a mission link')
}

// 2. POST /api/conversations reuses an unused empty session instead of creating another
{
  const before = store.listCouncilConversations(ownerId).length
  const res = await gw.localConversationsPost(req({ title: 'New Council Session' }), ownerId)
  const j = await json(res)
  assert.equal(res.status, 200); assert.equal(j.reused, true)
  assert.ok([emptyA.id, emptyB.id].includes(j.conversation.id))
  assert.equal(store.listCouncilConversations(ownerId).length, before, 'no new row was created')
  const forced = await gw.localConversationsPost(req({ title: 'New Council Session', forceNew: true }), ownerId)
  assert.equal(forced.status, 201)
  const custom = await gw.localConversationsPost(req({ title: 'Something else' }), ownerId)
  assert.equal(custom.status, 201)
  ok('2: creating a default session reuses an unused empty one; forceNew and custom titles still create')
}

// 3. bulk cleanup: dry run lists, real run trashes (recoverable), never touches real/linked/titled
{
  const dry = await json(await gw.localConversationsBulk(req({ action: 'cleanup-empty', dryRun: true }), ownerId))
  assert.equal(dry.dryRun, true)
  assert.ok(!dry.candidates.includes(real.id) && !dry.candidates.includes(linkedEmpty.id) && !dry.candidates.includes(titledEmpty.id))
  const run = await json(await gw.localConversationsBulk(req({ action: 'cleanup-empty', excludeIds: [emptyA.id] }), ownerId))
  assert.ok(run.trashed.includes(emptyB.id) && !run.trashed.includes(emptyA.id))
  assert.equal(store.getCouncilConversation(ownerId, real.id)?.state, 'active')
  ok('3: cleanup-empty dry-runs, then moves only unused empties to Trash and honors the active-session exclusion')
}

// 4. trash -> visible only in Trash view; restore brings the same row back with all messages
{
  const t = await json(await gw.localConversationsBulk(req({ action: 'trash', ids: [real.id] }), ownerId))
  assert.deepEqual(t.trashed, [real.id])
  const active = await json(await gw.localConversationsGet(new Request('http://127.0.0.1:3001/api/conversations'), ownerId))
  assert.ok(!active.conversations.some((c: any) => c.id === real.id), 'not in the normal list')
  const trash = await json(await gw.localConversationsGet(new Request('http://127.0.0.1:3001/api/conversations?view=trash'), ownerId))
  assert.ok(trash.conversations.some((c: any) => c.id === real.id), 'in Trash view')
  assert.equal(trash.counts.trashed >= 1, true)
  const r = await json(await gw.localConversationsBulk(req({ action: 'restore', ids: [real.id] }), ownerId))
  assert.deepEqual(r.restored, [real.id])
  const back = store.getCouncilConversation(ownerId, real.id)!
  assert.equal(back.state, 'active')
  assert.ok((back.metadata as any).councilMissions?.length === 1 && (back.metadata as any).councilStage1?.turns?.length === 1, 'links and Stage 1 records preserved')
  assert.ok(!('trash' in back.metadata), 'trash marker removed')
  const msgs = store.listCouncilMessages(ownerId, real.id)!
  assert.equal(msgs.length, 2); assert.equal(msgs[1].family, 'ORION'); assert.equal(msgs[1].metadata.providerModel, 'm')
  ok('4: Trash is recoverable; Restore returns the same session with messages, attribution, research and mission links intact')
}

// 5. permanent deletion: only from Trash, only with explicit confirmation
{
  const noConfirm = await gw.localConversationsBulk(req({ action: 'purge', ids: [real.id] }), ownerId)
  assert.equal(noConfirm.status, 400)
  const notTrashed = await json(await gw.localConversationsBulk(req({ action: 'purge', ids: [real.id], confirm: 'DELETE_PERMANENTLY' }), ownerId))
  assert.deepEqual(notTrashed.purged, []); assert.deepEqual(notTrashed.skipped, [real.id])
  assert.ok(store.getCouncilConversation(ownerId, real.id), 'an active session survives a purge request')
  await gw.localConversationsBulk(req({ action: 'trash', ids: [titledEmpty.id] }), ownerId)
  const purged = await json(await gw.localConversationsBulk(req({ action: 'purge', ids: [titledEmpty.id], confirm: 'DELETE_PERMANENTLY' }), ownerId))
  assert.deepEqual(purged.purged, [titledEmpty.id])
  assert.equal(store.listCouncilConversationsByState(ownerId, ['trashed', 'active', 'archived', 'paused']).some(c => c.id === titledEmpty.id), false)
  ok('5: purge refuses without confirmation and for anything not in Trash; a confirmed purge removes only the trashed fixture')
}

// 6. bulk archive / unarchive / rename
{
  const other = store.createCouncilConversation(ownerId, 'Alpha', { council: { source: 'live_council' } })
  const other2 = store.createCouncilConversation(ownerId, 'Beta', { council: { source: 'live_council' } })
  const a = await json(await gw.localConversationsBulk(req({ action: 'archive', ids: [other.id, other2.id] }), ownerId))
  assert.equal(a.archived.length, 2)
  const archivedView = await json(await gw.localConversationsGet(new Request('http://127.0.0.1:3001/api/conversations?view=archived'), ownerId))
  assert.ok(archivedView.conversations.some((c: any) => c.id === other.id))
  const un = await json(await gw.localConversationsBulk(req({ action: 'unarchive', ids: [other.id, other2.id] }), ownerId))
  assert.equal(un.restored.length, 2)
  const prefix = await json(await gw.localConversationsBulk(req({ action: 'rename', ids: [other.id, other2.id], mode: 'prefix', text: 'P1' }), ownerId))
  assert.deepEqual(prefix.renamed.map((r: any) => r.title).sort(), ['P1 Alpha', 'P1 Beta'])
  const setAll = await json(await gw.localConversationsBulk(req({ action: 'rename', ids: [other.id, other2.id], mode: 'set', text: 'Batch' }), ownerId))
  assert.deepEqual(setAll.renamed.map((r: any) => r.title).sort(), ['Batch (1)', 'Batch (2)'])
  ok('6: bulk archive, unarchive and rename (prefix and numbered set) work')
}

// 7. owner scoping: another owner's ids are never touched
{
  const foreign = store.createCouncilConversation(ownerId, 'Foreign check', { council: { source: 'live_council' } })
  const res = await json(await gw.localConversationsBulk(req({ action: 'trash', ids: ['lcnv_does_not_exist', foreign.id] }), 'some-other-owner-id'))
  assert.deepEqual(res.trashed, [])
  assert.equal(store.getCouncilConversation(ownerId, foreign.id)?.state, 'active')
  ok('7: another owner id cannot trash or purge this owner\'s sessions')
}

// 8. survives a restart: a second store instance on the same directory sees the same state
{
  store.close()
  const again = getLocalOwnershipStore(tmp)
  void again
  const fresh = new (store.constructor as new (d: string) => typeof store)(tmp)
  const trashed = fresh.listCouncilConversationsByState(ownerId, ['trashed'])
  assert.ok(trashed.some(c => c.id === emptyB.id), 'trash persisted')
  assert.equal(fresh.getCouncilConversation(ownerId, real.id)?.state, 'active')
  fresh.close()
  ok('8: Trash and restored state persist across a store restart')
}

// 9. browser-ledger ghosts (local-only, never used) are pruned; used, remote and active rows are kept; trashed rows never come back
{
  const now = new Date().toISOString()
  const ghost = ledger.createLedgerSession('local-ghost', 'New Council Session', now)
  const used = { ...ledger.createLedgerSession('local-used', 'New Council Session', now), preview: 'asked something' }
  const titled = ledger.createLedgerSession('local-titled', 'Budget review', now)
  const active = ledger.createLedgerSession('local-active', 'New Council Session', now)
  const remote = ledger.createLedgerSession('remote-1', 'New Council Session', now)
  const rows = [ghost, used, titled, active, remote]
  const kept = ledger.pruneGhostLedgerRows(rows, new Set(['remote-1']), 'local-active').map(r => r.id)
  assert.deepEqual(kept.sort(), ['local-active', 'local-titled', 'local-used', 'remote-1'])
  assert.equal(ledger.mergeSessionLists([{ ...remote, state: 'trashed' }], []).length, 0, 'a trashed row is not merged back into the rail')
  assert.equal(ledger.upsertLedgerSession([], { ...ghost, state: 'trashed' }).length, 0)
  ok('9: ledger ghosts are pruned; used, titled, remote and active rows survive; trashed rows are not resurrected')
}

console.log(`\n${passed}/9 council session management validations passed`)
assert.equal(passed, 9)

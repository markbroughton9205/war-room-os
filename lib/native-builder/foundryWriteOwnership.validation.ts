/** Real process ownership and stale-generation cleanup regressions, isolated from live missions and locks. */
import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FoundryResourceClaim } from './foundryOperationsTypes'

if (process.argv[2] === 'owner-worker') {
  const { acquireResource, setResourceLockRootForTests } = await import('./foundryResourceLocks')
  setResourceLockRootForTests(process.argv[3])
  process.on('message', async message => {
    if (message === 'acquire') {
      const result = await acquireResource({ resource: 'REPO_WRITE', missionId: 'shared-mission', operation: 'ownership regression', workspaceRoot: process.argv[4], paths: ['same.txt'] })
      process.send?.(result.state === 'ACQUIRED' ? { state: result.state, claim: result.claim } : { state: result.state })
    } else if (message === 'exit') process.exit(0) // Deliberately leave the isolated claim for death/takeover proof.
  })
  process.send?.('ready')
} else {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'foundry-write-ownership-'))
  const base = path.join(tmp, 'base'), projects = path.join(tmp, 'projects'), a = path.join(projects, 'a'), b = path.join(projects, 'b'), lockRoot = path.join(tmp, 'locks')
  for (const dir of [base, a, b]) await mkdir(dir, { recursive: true })
  process.env.REPO_ROOT = base
  process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'data')
  process.env.WAR_ROOM_PROJECTS_ROOT = projects
  process.env.FOUNDRY_PROJECTS_ROOT = projects
  process.env.WAR_ROOM_ENGINEER_ALLOWED_ROOTS = projects
  const locks = await import('./foundryResourceLocks')
  const { releaseTerminalMissionClaims, reconcileTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
  const { cleanupOwnedResources } = await import('./foundryOperationsManager')
  const { startMissionInput } = await import('./foundryMissionController')
  locks.setResourceLockRootForTests(lockRoot)
  const children: ChildProcess[] = []
  let count = 0
  const test = async (name: string, fn: () => Promise<void>) => {
    if (process.env.OWNERSHIP_CASE && process.env.OWNERSHIP_CASE !== name) return
    await fn(); count++; console.log(`PASS ${name}`)
  }
  const acquire = (id: string, root = a) => locks.acquireResource({ resource: 'REPO_WRITE', missionId: id, operation: 'ownership test', workspaceRoot: root, paths: ['same.txt'] })
  const record = (claim: FoundryResourceClaim) => {
    const m = startMissionInput('ownership fixture', 'ownership fixture', {})
    m.missionId = claim.missionId; m.kind = 'fixture'; m.status = 'CANCELLED'; m.lockClaims = [structuredClone(claim)]
    m.workspaceBinding = { workspaceId: 'fixture', workspaceRoot: a, source: 'REQUEST', boundAt: new Date().toISOString() }
    return m
  }
  const current = async () => (await locks.listResourceClaims()).filter(c => c.resource === 'REPO_WRITE')
  const clean = async () => { for (const c of await current()) await locks.releaseResource('REPO_WRITE', c.missionId, c.callId) }
  const receive = <T>(child: ChildProcess) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { clear(); reject(new Error('ownership worker timeout')) }, 15000)
    const clear = () => { clearTimeout(timer); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit) }
    const onMessage = (message: unknown) => { clear(); resolve(message as T) }
    const onError = (error: Error) => { clear(); reject(error) }
    const onExit = (code: number | null) => { clear(); reject(new Error(`ownership worker exited early: ${code}`)) }
    child.once('message', onMessage); child.once('error', onError); child.once('exit', onExit)
  })
  const worker = async () => {
    const child = fork(fileURLToPath(import.meta.url), ['owner-worker', lockRoot, a], { execArgv: ['--loader', path.resolve('scripts/ts-extension-loader.mjs'), '--experimental-transform-types'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    children.push(child); assert.equal(await receive(child), 'ready'); return child
  }
  const request = async (child: ChildProcess) => { const reply = receive<{ state: string; claim?: FoundryResourceClaim }>(child); child.send('acquire'); return reply }
  const exit = async (child: ChildProcess) => { const ended = new Promise<void>(resolve => child.once('exit', () => resolve())); child.send('exit'); await ended }
  const replacements = async () => {
    const first = await acquire('cleanup-mission'); assert.equal(first.state, 'ACQUIRED')
    if (first.state !== 'ACQUIRED') throw new Error('first acquisition required')
    const old = record(first.claim)
    await first.release()
    const replacement = await acquire('cleanup-mission'), peer = await acquire('peer', b)
    assert.equal(replacement.state, 'ACQUIRED'); assert.equal(peer.state, 'ACQUIRED')
    if (replacement.state !== 'ACQUIRED' || peer.state !== 'ACQUIRED') throw new Error('replacement acquisitions required')
    assert.notEqual(replacement.claim.callId, first.claim.callId)
    return { old, replacement, peer }
  }
  try {
    await test('SAME_MISSION_PROCESS_OWNERSHIP', async () => {
      const first = await worker(), second = await worker()
      const original = await request(first); assert.equal(original.state, 'ACQUIRED')
      assert.ok(original.claim)
      const reentrant = await request(first)
      assert.equal(reentrant.state, 'ACQUIRED', 'SAME_PROCESS_REENTRY')
      assert.equal(reentrant.claim?.callId, original.claim.callId, 'SAME_PROCESS_TOKEN_PRESERVED')
      assert.equal((await request(second)).state, 'BUSY', 'LIVE_SAME_MISSION_OTHER_PROCESS_REFUSED')
      assert.equal((await current())[0]?.pid, first.pid, 'LIVE_OWNER_PID_UNCHANGED')
      await exit(first)
      const third = await worker(), takeover = await request(third)
      assert.equal(takeover.state, 'ACQUIRED', 'TAKEOVER_AFTER_OWNER_EXIT')
      assert.ok(takeover.claim)
      assert.notEqual(takeover.claim.callId, original.claim.callId, 'TAKEOVER_FRESH_GENERATION_TOKEN')
      assert.equal(takeover.claim.pid, third.pid, 'TAKEOVER_NEW_OWNER_PID')
      assert.equal((await request(second)).state, 'BUSY', 'THIRD_OWNER_EXCLUDES_SECOND_PROCESS')
      assert.equal((await request(third)).claim?.callId, takeover.claim.callId, 'TAKEOVER_SAME_PROCESS_REENTRY')
      const staleTerminal = record(original.claim)
      await releaseTerminalMissionClaims(staleTerminal)
      assert.equal((await current())[0]?.callId, takeover.claim.callId, 'DEAD_OWNER_TERMINAL_CANNOT_RELEASE_TAKEOVER')
      await locks.releaseResource('REPO_WRITE', original.claim.missionId, original.claim.callId)
      assert.equal((await current())[0]?.callId, takeover.claim.callId, 'DEAD_OWNER_TOKEN_CANNOT_RELEASE_TAKEOVER')
      const audit = await readFile(path.join(base, '.war-room/audit/code-operator.jsonl'), 'utf8')
      assert.match(audit, /resource.owner-generation-transferred/, 'TAKEOVER_TRANSFER_AUDITED')
      const transfer = audit.trim().split('\n').map(line => JSON.parse(line)).find(event => String(event.message).includes('resource.owner-generation-transferred'))
      assert.equal(transfer.metadata.previousCallId, original.claim.callId, 'TAKEOVER_AUDITS_PRIOR_TOKEN')
      assert.equal(transfer.metadata.callId, takeover.claim.callId, 'TAKEOVER_AUDITS_CURRENT_TOKEN')
      assert.equal(transfer.metadata.pid, third.pid, 'TAKEOVER_AUDITS_CURRENT_PID')
      await exit(second); await exit(third); await clean()
    })
    await test('STALE_TERMINAL_GENERATION', async () => {
      const { old, replacement, peer } = await replacements()
      const oldBefore = JSON.stringify(old.lockClaims)
      const result = await releaseTerminalMissionClaims(old)
      assert.equal((await current()).find(c => c.missionId === old.missionId)?.callId, replacement.claim.callId, 'STALE_TERMINAL_PRESERVES_REPLACEMENT')
      assert.equal(result.released.length, 0, 'STALE_TERMINAL_DOES_NOT_REPORT_RELEASE')
      assert.equal(JSON.stringify(old.lockClaims), oldBefore, 'STALE_TERMINAL_RECORD_NOT_REWRITTEN')
      await reconcileTerminalMissionClaims([old])
      assert.equal((await current()).find(c => c.missionId === old.missionId)?.callId, replacement.claim.callId, 'BOOT_RECONCILIATION_PRESERVES_REPLACEMENT')
      const missing = record(replacement.claim); missing.lockClaims = []
      await releaseTerminalMissionClaims(missing)
      assert.equal((await current()).find(c => c.missionId === old.missionId)?.callId, replacement.claim.callId, 'MISSING_GENERATION_CANNOT_ADOPT_LIVE_CLAIM')
      await releaseTerminalMissionClaims(record(replacement.claim))
      assert.equal((await current()).some(c => c.missionId === old.missionId), false, 'CURRENT_TERMINAL_RELEASES_OWN_TOKEN')
      assert.equal((await current())[0]?.callId, peer.claim.callId, 'TERMINAL_PRESERVES_PEER')
      await clean()
    })
    await test('STALE_OPERATIONS_CLEANUP', async () => {
      const { old, replacement, peer } = await replacements(); old.status = 'EXECUTING'
      const before = JSON.stringify(old.lockClaims)
      await cleanupOwnedResources(old)
      assert.equal((await current()).find(c => c.missionId === old.missionId)?.callId, replacement.claim.callId, 'STALE_OPERATIONS_PRESERVES_REPLACEMENT')
      assert.equal(JSON.stringify(old.lockClaims), before, 'STALE_OPERATIONS_RECORD_NOT_REWRITTEN')
      const active = record(replacement.claim); active.status = 'EXECUTING'
      await cleanupOwnedResources(active)
      assert.equal((await current()).some(c => c.missionId === active.missionId), false, 'CURRENT_OPERATIONS_RELEASES_OWN_TOKEN')
      assert.equal((await current())[0]?.callId, peer.claim.callId, 'OPERATIONS_PRESERVES_PEER')
      await clean()
    })
    await test('RECORDED_OWNER_PID_FENCE', async () => {
      const owned = await acquire('pid-fence'); assert.equal(owned.state, 'ACQUIRED')
      if (owned.state !== 'ACQUIRED') throw new Error('acquisition required')
      const stale = record({ ...owned.claim, pid: 2147483647 })
      const before = JSON.stringify(stale.lockClaims)
      await releaseTerminalMissionClaims(stale)
      assert.equal((await current())[0]?.callId, owned.claim.callId, 'RECORDED_OWNER_PID_FENCE')
      assert.equal(JSON.stringify(stale.lockClaims), before, 'RECORDED_PID_RECORD_NOT_REWRITTEN')
      await clean()
    })
    await test('MISSION_WIDE_TOKEN_FENCE', async () => {
      const { old, replacement } = await replacements()
      await locks.releaseMissionResources(old.missionId, undefined, old.lockClaims)
      assert.equal((await current()).find(c => c.missionId === old.missionId)?.callId, replacement.claim.callId, 'STALE_MISSION_WIDE_PRESERVES_REPLACEMENT')
      await locks.releaseMissionResources(old.missionId, undefined, [replacement.claim])
      assert.equal((await current()).some(c => c.missionId === old.missionId), false, 'CURRENT_MISSION_WIDE_RELEASES_OWN_TOKEN')
      await clean()
    })
    await test('UNFENCED_RELEASE_REFUSED', async () => {
      const owned = await acquire('unfenced'); assert.equal(owned.state, 'ACQUIRED')
      if (owned.state !== 'ACQUIRED') throw new Error('acquisition required')
      await locks.releaseResource('REPO_WRITE', owned.claim.missionId)
      assert.equal((await current())[0]?.callId, owned.claim.callId, 'UNFENCED_RESOURCE_RELEASE_REFUSED')
      await locks.releaseMissionResources(owned.claim.missionId)
      assert.equal((await current())[0]?.callId, owned.claim.callId, 'UNFENCED_MISSION_RELEASE_REFUSED')
      await clean()
    })
    console.log(`FOUNDRY_WRITE_OWNERSHIP_VALIDATION ${count}/${process.env.OWNERSHIP_CASE ? 1 : 6}`)
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGTERM'); await ended
    }
    locks.setResourceLockRootForTests(null)
    await rm(tmp, { recursive: true, force: true })
  }
}

import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// IPC barrier makes separate processes race real acquisition, and keeps every winner alive until both results arrive.
if (process.argv[2] === 'worker') {
  const locks = await import('./foundryResourceLocks')
  locks.setResourceLockRootForTests(process.argv[3])
  process.send?.('ready')
  process.on('message', async message => {
    if (message === 'go') {
      const result = await locks.acquireResource({ resource: 'REPO_WRITE', missionId: process.argv[5], operation: 'race', workspaceRoot: process.argv[4], paths: ['calc.mjs'] })
      process.send?.(result.state)
    } else if (message === 'end') process.exit(0)
  })
} else {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'foundry-write-scope-'))
  const projects = path.join(tmp, 'projects')
  const a = path.join(projects, 'a'), b = path.join(projects, 'b'), nested = path.join(a, 'nested')
  const base = path.join(tmp, 'base'), lockRoot = path.join(tmp, 'locks')
  for (const dir of [a, b, nested, base]) await mkdir(dir, { recursive: true })
  process.env.REPO_ROOT = base
  process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'data')
  process.env.WAR_ROOM_PROJECTS_ROOT = projects
  process.env.WAR_ROOM_ENGINEER_ALLOWED_ROOTS = projects
  process.env.FOUNDRY_PROJECTS_ROOT = projects
  const locks = await import('./foundryResourceLocks')
  const scopes = await import('./foundryRepoWriteScope')
  const { detectWriteConflict } = await import('./foundryWriteIsolation')
  const { startMissionInput } = await import('./foundryMissionController')
  const { claimToolResources, heartbeatMission } = await import('./foundryOperationsManager')
  const { establishMissionWriteSet } = await import('./foundryMissionWriteSet')
  const { saveMission } = await import('./foundryMissionStore')
  const { runWithWorkspaceRoot } = await import('@/lib/repo/workspaceContext')
  locks.setResourceLockRootForTests(lockRoot)
  let count = 0
  const test = async (name: string, action: () => Promise<void>) => {
    if (process.env.SCOPE_CASE && process.env.SCOPE_CASE !== name) return
    await action(); count++; console.log(`PASS ${name}`)
  }
  const acquire = (id: string, root: string | undefined, paths = ['calc.mjs']) => locks.acquireResource({ resource: 'REPO_WRITE', missionId: id, operation: 'test', paths, workspaceRoot: root })
  const mission = (id: string, root: string) => {
    const m = startMissionInput('repair scoped fixture', 'scope test', {})
    m.missionId = id
    m.permissions.filesystem = true
    m.status = 'EXECUTING'
    m.workspaceBinding = { workspaceId: id, workspaceRoot: root, boundAt: new Date().toISOString(), source: 'REQUEST' }
    establishMissionWriteSet(m, { paths: ['calc.mjs'], sourceStep: 'TEST' })
    return m
  }
  const cleanClaims = async () => {
    for (const c of await locks.listResourceClaims()) await locks.releaseResource(c.resource, c.missionId, c.callId)
  }
  const registry = path.join(lockRoot, 'REPO_WRITE.json')
  try {
    await test('DISJOINT_ROOTS_SAME_FILENAME', async () => {
      assert.equal((await acquire('a', a)).state, 'ACQUIRED', 'FIRST_ACQUIRED')
      assert.equal((await acquire('b', b)).state, 'ACQUIRED', 'DISJOINT_ROOTS_SAME_FILENAME')
      assert.equal((await locks.listResourceClaims()).length, 2)
      await cleanClaims()
    })
    await test('PHYSICAL_OVERLAP', async () => {
      const alias = path.join(projects, 'alias'); await symlink(a, alias)
      const first = await acquire('a', a)
      assert.equal(first.state, 'ACQUIRED')
      assert.equal((await acquire('a', alias)).state, 'ACQUIRED', 'ALIAS_CANONICAL_ROOT')
      assert.equal((await acquire('same', a)).state, 'BUSY', 'SAME_PHYSICAL_TARGET')
      assert.equal((await acquire('alias', alias)).state, 'BUSY', 'SYMLINK_ALIAS_EXCLUDED')
      assert.equal((await acquire('nested', nested, ['different.txt'])).state, 'BUSY', 'NESTED_ROOT_EXCLUDED')
      await cleanClaims()
      assert.equal((await acquire('nested', nested)).state, 'ACQUIRED')
      assert.equal((await acquire('ancestor', a, ['different.txt'])).state, 'BUSY', 'ANCESTOR_ROOT_EXCLUDED')
      await cleanClaims()
    })
    await test('CONTAINMENT_AND_FUTURE_PATHS', async () => {
      await writeFile(path.join(a, 'real.txt'), 'x')
      await symlink(path.join(a, 'real.txt'), path.join(a, 'alias.txt'))
      assert.deepEqual((await scopes.repoWriteScope(a, ['real.txt'])).targets, (await scopes.repoWriteScope(a, ['alias.txt'])).targets)
      assert.deepEqual((await scopes.repoWriteScope(a, ['future/sub/new.txt'])).targets, [path.join(a, 'future/sub/new.txt')], 'FUTURE_PATH_ANCESTOR')
      await symlink(b, path.join(a, 'escape'))
      await symlink(path.join(a, 'missing'), path.join(a, 'dangling'))
      for (const target of ['../b/calc.mjs', '/absolute', 'escape/future.txt', 'dangling/future.txt']) {
        assert.equal((await acquire('bad', a, [target])).state, 'DEADLOCK_REFUSED', `CONTAINMENT_REFUSED ${target}`)
      }
    })
    await test('HARDLINK_AND_RETARGETED_ROOT', async () => {
      await writeFile(path.join(a, 'linked.txt'), 'physical fixture')
      await link(path.join(a, 'linked.txt'), path.join(b, 'linked.txt'))
      assert.equal((await acquire('a', a, ['linked.txt'])).state, 'ACQUIRED')
      assert.equal((await acquire('b', b, ['linked.txt'])).state, 'BUSY', 'HARDLINK_SAME_PHYSICAL_FILE')
      await cleanClaims()
      const changed = path.join(projects, 'changed')
      await mkdir(changed)
      assert.equal((await acquire('changed', changed)).state, 'ACQUIRED')
      await rename(changed, `${changed}.old`)
      await symlink(b, changed)
      assert.equal((await acquire('b', b)).state, 'BUSY', 'RETARGETED_CLAIM_ROOT_EXCLUDED')
      await cleanClaims()
    })
    await test('TRANSACTION_GUARD_AND_TIMEOUT', async () => {
      await mkdir(lockRoot, { recursive: true })
      await mkdir(`${registry}.guard`)
      await assert.rejects(() => acquire('a', a), /REPO_WRITE_REGISTRY_BUSY/, 'ORPHAN_GUARD_FAILS_CLOSED')
      // Remove only this validator's deliberately-created orphan fixture.
      await rm(`${registry}.guard`, { recursive: true })
      assert.equal((await acquire('a', a)).state, 'ACQUIRED')
      assert.equal((await locks.acquireResource({ resource: 'REPO_WRITE', missionId: 'wait', operation: 'test', workspaceRoot: a, waitMs: 30 })).state, 'TIMEOUT', 'OVERLAPPING_WAIT_TIMES_OUT')
      await cleanClaims()
    })
    await test('MISSING_INVALID_SCOPE' , async () => {
      for (const root of [undefined, '', 'relative', `${a}/../b`, path.join(projects, 'missing'), '/etc']) {
        const result = await acquire('bad', root)
        assert.equal(result.state, 'DEADLOCK_REFUSED', `INVALID_SCOPE_REFUSED ${root}`)
        if (result.state === 'DEADLOCK_REFUSED') assert.match(result.error, /REPO_WRITE_SCOPE_/)
      }
      assert.equal((await locks.listResourceClaims()).length, 0)
    })
    await test('OWNERSHIP_HEARTBEAT_RELEASE', async () => {
      const first = await acquire('a', a), second = await acquire('b', b)
      assert.equal(first.state, 'ACQUIRED'); assert.equal(second.state, 'ACQUIRED')
      if (first.state !== 'ACQUIRED' || second.state !== 'ACQUIRED') throw new Error('acquisition required')
      const before = await readFile(registry, 'utf8')
      const staleRecord = mission('a', a)
      staleRecord.lockClaims = [{ ...first.claim, callId: second.claim.callId }]
      await new Promise(resolve => setTimeout(resolve, 10))
      await heartbeatMission(staleRecord)
      assert.equal(await readFile(registry, 'utf8'), before, 'STALE_RECORD_HEARTBEAT_NO_MUTATION')
      await locks.releaseResource('REPO_WRITE', 'b', first.claim.callId)
      await locks.heartbeatResourceClaim('REPO_WRITE', 'a', second.claim.callId)
      assert.equal(await readFile(registry, 'utf8'), before, 'WRONG_CALL_NO_MUTATION')
      await new Promise(resolve => setTimeout(resolve, 10))
      await locks.heartbeatResourceClaim('REPO_WRITE', 'a', first.claim.callId)
      const claims = await locks.listResourceClaims()
      assert.notEqual(claims.find(c => c.missionId === 'a')?.heartbeatAt, first.claim.heartbeatAt, 'OWN_HEARTBEAT_UPDATED')
      assert.equal(claims.find(c => c.missionId === 'b')?.heartbeatAt, second.claim.heartbeatAt, 'PEER_HEARTBEAT_UNCHANGED')
      await first.release()
      assert.deepEqual((await locks.listResourceClaims()).map(c => c.missionId), ['b'], 'PEER_RELEASE_UNCHANGED')
      const replacement = await acquire('a', a)
      assert.equal(replacement.state, 'ACQUIRED')
      await first.release()
      assert.equal((await locks.listResourceClaims()).length, 2, 'OLD_CALLBACK_CANNOT_RELEASE_REPLACEMENT')
      await locks.releaseMissionResources('a', undefined, [replacement.state === 'ACQUIRED' ? replacement.claim : first.claim])
      assert.deepEqual((await locks.listResourceClaims()).map(c => c.missionId), ['b'], 'MISSION_CANCELLATION_OWNERSHIP')
      await cleanClaims()
    })
    await test('RESUMED_SCOPE', async () => {
      const first = await acquire('a', a)
      assert.equal(first.state, 'ACQUIRED')
      const resumed = JSON.parse(JSON.stringify(mission('a', a)))
      const root = await scopes.missionRepoWriteRoot(resumed)
      const again = await acquire(resumed.missionId, root, ['other.txt'])
      assert.equal(again.state, 'ACQUIRED', 'RESUME_SAME_SCOPE')
      if (again.state === 'ACQUIRED' && first.state === 'ACQUIRED') assert.equal(again.claim.callId, first.claim.callId, 'RESUME_CALL_ID_PRESERVED')
      assert.equal((await acquire('a', b)).state, 'DEADLOCK_REFUSED', 'RESUME_SCOPE_CHANGE_REFUSED')
      const alias = path.join(projects, 'resume-alias'); await symlink(a, alias)
      resumed.workspaceBinding.workspaceRoot = alias
      await assert.rejects(() => scopes.missionRepoWriteRoot(resumed), /WORKSPACE_ROOT_CHANGED/, 'RESUME_RETARGET_REFUSED')
      await cleanClaims()
    })
    await test('LEGACY_AND_MALFORMED_CLAIMS', async () => {
      await mkdir(lockRoot, { recursive: true })
      const legacy = { resource: 'REPO_WRITE', missionId: 'legacy', callId: 'legacy-call', pid: 2147483647, acquiredAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString(), exclusive: true, operation: 'legacy', paths: ['unrelated.txt'] }
      await writeFile(registry, JSON.stringify(legacy))
      assert.equal((await acquire('a', a)).state, 'BUSY', 'LEGACY_GLOBAL_EXCLUSION')
      assert.equal((await acquire('legacy', b)).state, 'BUSY', 'LEGACY_OWNER_CANNOT_BORROW_SCOPE')
      await locks.reclaimStaleResources()
      assert.equal((await locks.listResourceClaims()).length, 1, 'LEGACY_NOT_AUTOMATICALLY_RECLAIMED')
      await locks.releaseResource('REPO_WRITE', 'legacy', 'legacy-call')
      for (const invalid of ['{', JSON.stringify({ ...legacy, repoWriteScope: { version: 1, workspaceRoot: 'relative', targets: [] } }), JSON.stringify({ version: 1, claims: [{}] })]) {
        await writeFile(registry, invalid)
        await assert.rejects(() => acquire('a', a), /REPO_WRITE_REGISTRY_INVALID/, 'MALFORMED_REGISTRY_FAILS_CLOSED')
        assert.equal(await readFile(registry, 'utf8'), invalid, 'MALFORMED_REGISTRY_PRESERVED')
      }
      // Only this isolated fixture is reset after the malformed-claim assertions.
      await writeFile(registry, JSON.stringify({ version: 1, claims: [] }))
    })
    await test('STALE_SCOPED_RECLAIM', async () => {
      const scope = await scopes.repoWriteScope(a)
      const dead = { resource: 'REPO_WRITE', missionId: 'dead', callId: 'dead-call', pid: 2147483647, acquiredAt: new Date().toISOString(), exclusive: true, operation: 'test', repoWriteScope: scope }
      await mkdir(lockRoot, { recursive: true })
      await writeFile(registry, JSON.stringify({ version: 1, claims: [dead] }))
      assert.equal((await acquire('a', a)).state, 'ACQUIRED', 'DEAD_SCOPED_OWNER_RECLAIMED')
      await cleanClaims()
      dead.pid = process.pid
      dead.acquiredAt = new Date(0).toISOString()
      await writeFile(registry, JSON.stringify({ version: 1, claims: [dead] }))
      assert.equal((await acquire('a', a)).state, 'BUSY', 'LIVE_OWNER_NOT_EVICTED_BY_AGE')
      await locks.reclaimStaleResources()
      assert.equal((await locks.listResourceClaims()).length, 1, 'LIVE_STALE_HEARTBEAT_RETAINED')
      await cleanClaims()
    })
    await test('TERMINAL_CANCELLATION_AND_STALE_OWNERSHIP', async () => {
      const { releaseTerminalMissionClaims } = await import('./foundryTerminalResourceRelease')
      const ca = mission('cancel-a', a), cb = mission('cancel-b', b)
      const ra = await acquire(ca.missionId, a), rb = await acquire(cb.missionId, b)
      assert.equal(ra.state, 'ACQUIRED'); assert.equal(rb.state, 'ACQUIRED')
      if (ra.state !== 'ACQUIRED' || rb.state !== 'ACQUIRED') throw new Error('acquisition required')
      ca.lockClaims = [ra.claim]; cb.lockClaims = [rb.claim]
      ca.status = 'CANCELLED'
      const release = await releaseTerminalMissionClaims(ca)
      assert.equal(release.released.length, 1, 'TERMINAL_CANCEL_RELEASES_OWN')
      assert.deepEqual((await locks.listResourceClaims()).map(c => c.missionId), [cb.missionId], 'TERMINAL_CANCEL_PRESERVES_PEER')
      assert.deepEqual(await locks.releaseMissionResourcesIfStale(cb.missionId), [], 'STALE_CLEANUP_PRESERVES_LIVE')
      const saved = JSON.parse(await readFile(registry, 'utf8'))
      saved.claims[0].pid = 2147483647
      await writeFile(registry, JSON.stringify(saved))
      assert.deepEqual(await locks.releaseMissionResourcesIfStale(ca.missionId), [], 'STALE_CLEANUP_PRESERVES_OTHER_OWNER')
      assert.equal((await locks.releaseMissionResourcesIfStale(cb.missionId)).length, 1, 'STALE_CLEANUP_RELEASES_OWN_DEAD')
      assert.equal((await locks.listResourceClaims()).length, 0)
    })
    await test('REAL_TOOL_ACQUISITION_AND_PEERS'  , async () => {
      const ma = mission('tool-a', a), mb = mission('tool-b', b)
      const call = (m: typeof ma) => runWithWorkspaceRoot(m.workspaceBinding!.workspaceRoot, () => claimToolResources(m, 'file.write', { path: 'calc.mjs', content: 'fixture' }), m.workspaceBinding!.workspaceId)
      assert.equal((await call(ma)).ok, true, 'REAL_TOOL_A_ACQUIRED')
      assert.equal((await call(mb)).ok, true, 'REAL_TOOL_B_ACQUIRED')
      assert.equal(ma.lockClaims?.[0]?.repoWriteScope?.workspaceRoot, a, 'REAL_TOOL_SCOPE_PERSISTED')
      await cleanClaims()
      ma.sourceState.changedFiles = ['calc.mjs']; await saveMission(ma)
      assert.equal((await detectWriteConflict(mb, ['calc.mjs'])).conflict, false, 'DISJOINT_PEER_SCOPE')
      const same = mission('same-peer', a)
      assert.equal((await detectWriteConflict(same, ['different.txt'])).conflict, true, 'OVERLAPPING_PEER_EXCLUDED')
      const invalidPeer = mission('invalid-peer', b); delete invalidPeer.workspaceBinding
      invalidPeer.sourceState.changedFiles = ['calc.mjs']; await saveMission(invalidPeer)
      assert.equal((await detectWriteConflict(mission('third', b), ['other.txt'])).conflict, true, 'UNKNOWN_PEER_SCOPE_CONSERVATIVE')
      // Heartbeat uses the persisted claim callId, even if the mission record contains a stale callback identity.
      ma.status = 'EXECUTING'
      await heartbeatMission(ma)
    })
    await test('MACHINE_WIDE_RESOURCES', async () => {
      const first = await locks.acquireResource({ resource: 'PORT_3847', missionId: 'port-a', operation: 'test', workspaceRoot: a })
      assert.equal(first.state, 'ACQUIRED')
      assert.equal((await locks.acquireResource({ resource: 'PORT_3847', missionId: 'port-b', operation: 'test', workspaceRoot: b })).state, 'BUSY', 'PORT_REMAINS_GLOBAL')
      await cleanClaims()
    })
    await test('REAL_PROCESS_RACES', async () => {
      const race = async (roots: string[], expected: string[]) => {
        const children = roots.map((root, i) => fork(fileURLToPath(import.meta.url), ['worker', lockRoot, root, `race-${i}`], { execArgv: ['--loader', path.resolve('scripts/ts-extension-loader.mjs'), '--experimental-transform-types'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }))
        try {
          const results = children.map(child => new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('child acquisition timeout')), 15000)
            child.on('error', reject)
            child.on('exit', code => { if (code) reject(new Error(`child exit ${code}`)) })
            child.on('message', message => {
              if (message === 'ready') { ready++; if (ready === children.length) for (const c of children) c.send('go') }
              else { clearTimeout(timer); resolve(String(message)) }
            })
          }))
          let ready = 0
          assert.deepEqual((await Promise.all(results)).sort(), expected.sort(), 'CONCURRENT_EXCLUSION')
          assert.equal((await locks.listResourceClaims()).length, expected.filter(s => s === 'ACQUIRED').length, 'CONCURRENT_CLAIM_COUNT')
        } finally {
          await Promise.all(children.map(child => new Promise<void>(resolve => { child.once('exit', () => resolve()); child.send('end') })))
          await cleanClaims()
        }
      }
      await race([a, b], ['ACQUIRED', 'ACQUIRED'])
      await race([a, a], ['ACQUIRED', 'BUSY'])
      await race([a, nested], ['ACQUIRED', 'BUSY'])
      const alias = path.join(projects, 'race-alias'); await symlink(a, alias)
      await race([a, alias], ['ACQUIRED', 'BUSY'])
    })
    console.log(`FOUNDRY_WRITE_SCOPE_VALIDATION ${count}/${process.env.SCOPE_CASE ? 1 : 14}`)
  } finally {
    locks.setResourceLockRootForTests(null)
    await rm(tmp, { recursive: true, force: true })
  }
}

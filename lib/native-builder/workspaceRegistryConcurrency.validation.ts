/** Real route/functions against isolated storage. Child processes share the same canonical registry. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { POST } from '../../app/api/mission-runtime/engineering/workspaces/route'
import { openExistingProjectWorkspace, getWorkspace, touchWorkspace, archiveConfirmedTestProjects } from './workspaceRegistry'

const child = process.env.P8_REGISTRY_CHILD
if (child) {
  process.send?.({ ready: true })
  process.once('message', async () => {
    try {
      const result = process.env.P8_REGISTRY_ACTION === 'archive' ? await archiveConfirmedTestProjects()
        : process.env.P8_REGISTRY_ACTION === 'touch' ? await touchWorkspace(child)
          : await openExistingProjectWorkspace(child)
      process.send?.({ result })
      process.disconnect?.()
    } catch (error) { process.send?.({ error: String(error) }); process.disconnect?.(); process.exitCode = 1 }
  })
} else {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'p8-registry-'))
  const prior = { ...process.env }
  process.env.REPO_ROOT = path.join(tmp, 'base')
  process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'app-data')
  process.env.WAR_ROOM_PROJECTS_ROOT = path.join(tmp, 'projects')
  process.env.FOUNDRY_PROJECTS_ROOT = path.join(tmp, 'foundry-projects')
  await mkdir(process.env.REPO_ROOT, { recursive: true })
  await mkdir(process.env.WAR_ROOM_PROJECTS_ROOT, { recursive: true })
  const registry = path.join(process.env.REPO_ROOT, '.war-room/workspaces/registry.json')
  const project = async (name: string) => { const p = path.join(process.env.WAR_ROOM_PROJECTS_ROOT!, name); await mkdir(p); return p }
  try {
    const roots = await Promise.all(Array.from({ length: 2 }, (_, i) => project(`root-${i}`)))
    console.log(JSON.stringify({ baseRoot: process.env.REPO_ROOT, registry, roots }))
    const responses = await Promise.all(roots.map(root => POST(new Request('http://fixture/workspaces', { method: 'POST', body: JSON.stringify({ path: root }) }))))
    assert.ok(responses.every(r => r.status === 200))
    const records = await Promise.all(responses.map(async r => (await r.json()).workspace))
    const stored = JSON.parse(await readFile(registry, 'utf8'))
    assert.equal(stored.length, roots.length, 'concurrent real POST registrations must all survive')
    for (const record of records) assert.equal((await getWorkspace(record.id))?.root, record.root)
    console.log('PASS actual POST concurrent roots survive and resolve')
    const alias = path.join(process.env.WAR_ROOM_PROJECTS_ROOT, 'alias')
    await symlink(roots[0], alias)
    const reopened = await Promise.all(Array.from({ length: 8 }, (_, i) => openExistingProjectWorkspace(i % 2 ? alias : roots[0])))
    assert.ok(reopened.every(r => r.id === records[0].id && r.createdAt === records[0].createdAt))
    assert.equal(JSON.parse(await readFile(registry, 'utf8')).filter((r: { root: string }) => r.root === roots[0]).length, 1)
    console.log('PASS canonical alias stable ID and createdAt')
    const raw = JSON.parse(await readFile(registry, 'utf8')); raw[0].missionHistory = ['preserved']; raw[0].customMetadata = { proof: true }; await writeFile(registry, JSON.stringify(raw))
    await openExistingProjectWorkspace(raw[0].root)
    assert.deepEqual(JSON.parse(await readFile(registry, 'utf8'))[0].customMetadata, { proof: true })
    const mixedRoots = await Promise.all([project('mixed-a'), project('mixed-b')])
    await Promise.all([touchWorkspace(raw[0].id), archiveConfirmedTestProjects(), ...mixedRoots.map(r => openExistingProjectWorkspace(r))])
    const mixed = JSON.parse(await readFile(registry, 'utf8'))
    for (const root of mixedRoots) assert.ok(mixed.some((r: { root: string }) => r.root === root))
    assert.deepEqual(mixed.find((r: { id: string }) => r.id === raw[0].id).missionHistory, ['preserved'])
    console.log('PASS touch/archive/register merge metadata')
    const crossRoots = await Promise.all(Array.from({ length: 4 }, (_, i) => project(`cross-${i}`)))
    const baseAlias = path.join(tmp, 'base-alias'); await symlink(process.env.REPO_ROOT, baseAlias)
    const childRoots = [...crossRoots.map(root => ({ root, action: 'register' })), { root: roots[0], action: 'register' }, { root: alias, action: 'register' }, { root: raw[0].id, action: 'touch' }, { root: roots[0], action: 'archive' }]
    const children = childRoots.map(({ root, action }, i) => fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, P8_REGISTRY_CHILD: root, P8_REGISTRY_ACTION: action, REPO_ROOT: i % 2 ? baseAlias : process.env.REPO_ROOT }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }))
    const results = children.map(c => new Promise<unknown>((resolve, reject) => { c.on('message', (m: { result?: unknown; error?: string }) => { if (m.result) resolve(m.result); if (m.error) reject(new Error(m.error)) }); c.on('error', reject); c.on('exit', code => { if (code) reject(new Error(`child exit ${code}`)) }) }))
    await Promise.all(children.map(c => new Promise<void>(resolve => c.once('message', () => resolve()))))
    children.forEach(c => c.send('go'))
    await Promise.all(results)
    await Promise.all(children.map(c => c.exitCode !== null ? Promise.resolve() : new Promise<void>(resolve => c.once('exit', () => resolve()))))
    for (const root of crossRoots) assert.ok(JSON.parse(await readFile(registry, 'utf8')).some((r: { root: string }) => r.root === root))
    assert.equal(JSON.parse(await readFile(registry, 'utf8')).filter((r: { root: string }) => r.root === roots[0]).length, 1)
    assert.deepEqual(JSON.parse(await readFile(registry, 'utf8')).find((r: { id: string }) => r.id === raw[0].id).missionHistory, ['preserved'])
    console.log('PASS barrier separate-process registrations/touch/archive, base aliases and same-root stable identity')
    const createdResponse = await POST(new Request('http://fixture/workspaces', { method: 'POST', body: JSON.stringify({ action: 'create', name: 'created-project' }) }))
    assert.equal(createdResponse.status, 200)
    const createdRecord = (await createdResponse.json()).workspace
    assert.equal((await getWorkspace(createdRecord.id))?.root, createdRecord.root)
    await mkdir(path.join(roots[0], '.git'))
    const gitResponse = await POST(new Request('http://fixture/workspaces', { method: 'POST', body: JSON.stringify({ action: 'open-git', path: roots[0] }) }))
    assert.equal(gitResponse.status, 200); assert.equal((await gitResponse.json()).workspace.id, records[0].id)
    const baseRoot = process.env.REPO_ROOT!, beforeOtherBase = await readFile(registry)
    process.env.REPO_ROOT = path.join(tmp, 'separate-installed-base'); await mkdir(process.env.REPO_ROOT)
    const separate = await openExistingProjectWorkspace(roots[0])
    assert.notEqual(separate.id, records[0].id)
    assert.deepEqual(await readFile(registry), beforeOtherBase)
    process.env.REPO_ROOT = baseRoot
    assert.equal((await getWorkspace(records[0].id))?.root, roots[0])
    console.log('PASS create/open-git paths and separate base registries stay independent')
    let reading = true
    const reader = (async () => { while (reading) { const value = JSON.parse(await readFile(registry, 'utf8')); assert.ok(Array.isArray(value)) } })()
    try { await Promise.all(Array.from({ length: 20 }, () => touchWorkspace(records[0].id))) } finally { reading = false; await reader }
    console.log('PASS concurrent readers only see valid complete JSON')
    const valid = await readFile(registry)
    for (const invalid of ['{bad', '{}', '[{"id":"bad"}]']) {
      await writeFile(registry, invalid)
      const response = await POST(new Request('http://fixture/workspaces', { method: 'POST', body: JSON.stringify({ path: roots[0] }) }))
      assert.notEqual(response.status, 200, 'invalid registry must fail registration')
      assert.equal(await readFile(registry, 'utf8'), invalid)
    }
    await writeFile(registry, valid)
    // Unreadable target shape works even under a privileged test runner, without chmod.
    await rm(registry); await mkdir(registry)
    await assert.rejects(openExistingProjectWorkspace(roots[0]))
    await rm(registry, { recursive: true }); await writeFile(registry, valid)
    console.log('PASS invalid/unreadable data fail explicitly without replacement')
    const lock = `${registry}.transaction-lock`
    await mkdir(lock); await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, note: 'fixture potentially live owner' }))
    const start = Date.now()
    await assert.rejects(openExistingProjectWorkspace(roots[0]), /contention/)
    assert.ok(Date.now() - start < 10_000)
    assert.deepEqual(await readFile(registry), valid)
    assert.ok((await readdir(lock)).includes('owner.json'))
    // A malformed/orphan lock is conservatively left for an operator; never steal based on PID/age.
    await writeFile(path.join(lock, 'owner.json'), 'interrupted owner publication')
    await assert.rejects(openExistingProjectWorkspace(roots[0]), /contention/)
    assert.deepEqual(await readFile(registry), valid)
    await rm(lock, { recursive: true }) // fixture owner relinquishes, not production recovery
    assert.equal((await openExistingProjectWorkspace(roots[0])).id, records[0].id)
    console.log('PASS bounded live/unknown-owner contention; owner release restores access')
  } finally {
    for (const key of ['REPO_ROOT', 'WAR_ROOM_PROJECTS_ROOT', 'FOUNDRY_PROJECTS_ROOT', 'WAR_ROOM_LOCAL_DATA_DIR']) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
    await rm(tmp, { recursive: true, force: true })
  }
}

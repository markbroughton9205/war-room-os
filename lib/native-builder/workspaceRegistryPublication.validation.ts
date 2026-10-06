/** Fault overlays inject only IO-stage failures into the actual atomic writer. Real registrations and process interruption. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openExistingProjectWorkspace } from './workspaceRegistry'
const worker = process.env.P8_PUBLICATION_WORKER
if (worker) {
  try { const record = await openExistingProjectWorkspace(worker); process.send?.({ record }); process.disconnect?.() }
  catch (error) { process.send?.({ error: String(error) }); process.disconnect?.(); process.exitCode = 1 }
} else {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'p8-publication-'))
  const prior = { ...process.env }
  process.env.REPO_ROOT = path.join(tmp, 'base')
  process.env.WAR_ROOM_LOCAL_DATA_DIR = path.join(tmp, 'data')
  process.env.WAR_ROOM_PROJECTS_ROOT = path.join(tmp, 'projects')
  process.env.FOUNDRY_PROJECTS_ROOT = path.join(tmp, 'foundry')
  const a = path.join(process.env.WAR_ROOM_PROJECTS_ROOT, 'a'), b = path.join(process.env.WAR_ROOM_PROJECTS_ROOT, 'b')
  await mkdir(a, { recursive: true }); await mkdir(b)
  const file = path.join(process.env.REPO_ROOT, '.war-room/workspaces/registry.json')
  const atomic = fileURLToPath(new URL('./foundryAtomicJson.ts', import.meta.url))
  const overlay = path.join(tmp, 'atomic.ts')
  const registrySource = fileURLToPath(new URL('./workspaceRegistry.ts', import.meta.url))
  const accessOverlay = path.join(tmp, 'registry.ts')
  const registryText = await readFile(registrySource, 'utf8')
  const accessText = registryText.replace("try { raw = await readFile(target, 'utf8') } catch (error) {", "try { if (process.env.P8_INJECT_MODE === 'access') throw Object.assign(new Error('injected EACCES'), { code: 'EACCES' }); raw = await readFile(target, 'utf8') } catch (error) {")
    .replace(/from '([.][^']+)'/g, (_match, relative: string) => { const url = new URL(relative + (path.extname(relative) ? '' : '.ts'), new URL('./workspaceRegistry.ts', import.meta.url)); return `from '${fileURLToPath(url)}'` })
  await writeFile(accessOverlay, accessText)
  const source = await readFile(atomic, 'utf8')
  await writeFile(overlay, source.replace('await hooks.beforeRename?.(temp)', `await hooks.beforeRename?.(temp)
    if (process.env.P8_INJECT_MODE === 'throw') throw new Error('injected EIO before rename')
    if (process.env.P8_INJECT_MODE === 'interrupt') {
      process.send?.({ publicationReady: temp })
      await new Promise(() => { setInterval(() => undefined, 1000) })
    }`))
  function run(mode: string) {
    const c = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, P8_PUBLICATION_WORKER: b, P8_INJECT_MODE: mode, FOUNDRY_OVERLAY: JSON.stringify(mode === 'access' ? { [registrySource]: accessOverlay } : { [atomic]: overlay }) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    return c
  }
  try {
    const first = await openExistingProjectWorkspace(a)
    const bytes = await readFile(file)
    const access = run('access')
    const denied = await new Promise<{ error?: string }>((resolve, reject) => { access.once('message', resolve); access.once('error', reject) })
    await new Promise<void>(resolve => access.once('exit', () => resolve()))
    assert.match(denied.error ?? '', /EACCES/)
    assert.deepEqual(await readFile(file), bytes)
    console.log('PASS actual registration access failure is explicit and preserves existing bytes')
    const failed = run('throw')
    const result = await new Promise<{ error?: string }>((resolve, reject) => { failed.once('message', resolve); failed.once('error', reject) })
    await new Promise<void>(resolve => failed.once('exit', () => resolve()))
    assert.match(result.error ?? '', /injected EIO/)
    assert.deepEqual(await readFile(file), bytes, 'failed publication must preserve previous bytes')
    assert.ok(!(await readdir(path.dirname(file))).includes('registry.json.transaction-lock'))
    console.log('PASS actual registration write failure returns error, preserves bytes and releases owner')
    const interrupted = run('interrupt')
    const signal = await new Promise<{ publicationReady?: string }>((resolve, reject) => { interrupted.once('message', resolve); interrupted.once('error', reject) })
    assert.ok(signal.publicationReady)
    assert.ok(Array.isArray(JSON.parse(await readFile(signal.publicationReady, 'utf8'))))
    interrupted.kill('SIGKILL')
    await new Promise<void>(resolve => interrupted.once('exit', () => resolve()))
    assert.deepEqual(await readFile(file), bytes)
    await assert.rejects(openExistingProjectWorkspace(b), /contention/)
    assert.deepEqual(await readFile(file), bytes)
    assert.ok((await readdir(path.dirname(file))).some(name => name.endsWith('.tmp')))
    console.log('PASS interrupted process cannot publish partial JSON or steal orphan; evidence retained')
    // Explicit fixture-owner reconciliation only after this test witnessed child exit.
    await rm(`${file}.transaction-lock`, { recursive: true })
    const second = await openExistingProjectWorkspace(b)
    const records = JSON.parse(await readFile(file, 'utf8'))
    assert.ok(records.some((r: { id: string }) => r.id === first.id))
    assert.ok(records.some((r: { id: string }) => r.id === second.id))
    console.log('PASS explicit reconciliation after witnessed exit resumes without losing old records')
    // Real filesystem write error at lock acquisition, not mocked permissions.
    const bytesAfter = await readFile(file)
    await writeFile(`${file}.transaction-lock`, 'not a directory')
    await assert.rejects(openExistingProjectWorkspace(a), /contention/)
    assert.deepEqual(await readFile(file), bytesAfter)
    assert.equal(await readFile(`${file}.transaction-lock`, 'utf8'), 'not a directory')
    console.log('PASS unknown lock shape returns bounded failure without erasing evidence')
  } finally {
    for (const key of ['REPO_ROOT', 'WAR_ROOM_LOCAL_DATA_DIR', 'WAR_ROOM_PROJECTS_ROOT', 'FOUNDRY_PROJECTS_ROOT']) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
    await rm(tmp, { recursive: true, force: true })
  }
}

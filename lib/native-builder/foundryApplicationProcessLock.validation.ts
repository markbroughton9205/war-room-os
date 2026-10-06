/** Actual kernel ownership and crash recovery, using real independent Node processes. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { acquireApplicationProcessLock } from './foundryApplicationProcessLock'
import { runWithWorkspaceRoot } from '../repo/workspaceContext'

const root = await mkdtemp(path.join(os.tmpdir(), 'foundry-process-lock-'))
const loader = path.resolve('scripts/ts-extension-loader.mjs')
const moduleUrl = new URL('./foundryApplicationProcessLock.ts', import.meta.url).href
const contextUrl = new URL('../repo/workspaceContext.ts', import.meta.url).href
const child = spawn(process.execPath, ['--loader', loader, '--experimental-transform-types', '--input-type=module', '-e', `
import { acquireApplicationProcessLock } from ${JSON.stringify(moduleUrl)};
import { runWithWorkspaceRoot } from ${JSON.stringify(contextUrl)};
await runWithWorkspaceRoot(${JSON.stringify(root)}, async () => {
 const lock = await acquireApplicationProcessLock('real-lock-validation');
 if (!lock) process.exit(2);
 process.stdout.write('OWNED\\n');
 await new Promise(resolve => process.stdin.once('end', resolve));
});`], { stdio: ['pipe', 'pipe', 'pipe'] })
const childClosed = once(child, 'close')
let errors = ''
child.stderr.on('data', data => { errors += String(data) })
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Owner did not start: ' + errors)), 10000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Owner exited ${code}: ${errors}`)) })
    child.stdout.on('data', data => { if (String(data).includes('OWNED')) { clearTimeout(timeout); resolve() } })
  })
  await runWithWorkspaceRoot(root, async () => {
    const duplicate = await acquireApplicationProcessLock('real-lock-validation')
    if (duplicate) await duplicate.release()
    assert.equal(duplicate, null)
    console.log('PASS second real process cannot acquire the active mission')
    child.kill('SIGKILL')
    await childClosed
    // The holder sees EOF when the actual executor dies; no synthetic lock reset.
    let resumed = null
    for (let i = 0; i < 140 && !resumed; i++) {
      resumed = await acquireApplicationProcessLock('real-lock-validation')
      if (!resumed) await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(resumed)
    console.log('PASS actual executor death releases ownership for resume')
    await resumed.release()
    const released = await acquireApplicationProcessLock('real-lock-validation')
    assert.ok(released)
    await released.release()
    console.log('PASS graceful release permits the next real owner')
  })
  console.log('APPLICATION_PROCESS_OWNERSHIP_VALIDATION 3/3 PASS')
} finally { child.kill('SIGKILL'); await childClosed; await rm(root, { recursive: true, force: true }) }

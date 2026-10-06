/** GPU / MODEL claim leases with real, separate processes. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireLease, heldLeaseHolders, listLeases } from './foundryClaimLeases'
import { reconcileJobs, startBackgroundJob } from './foundryBackgroundJobs'

const root = mkdtempSync(path.join(os.tmpdir(), 'foundry-leases-'))
let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const loader = ['--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', '--input-type=module', '-e']
const mod = new URL('./foundryClaimLeases.ts', import.meta.url).href

/** A real separate process that holds the GPU lease until told to stop. */
function holder(tag: string, holdMs: number) {
  const child = spawn(process.execPath, [...loader, `
    import { acquireLease } from ${JSON.stringify(mod)};
    const t0 = Date.now();
    const lease = await acquireLease({ root: ${JSON.stringify(root)}, missionId: ${JSON.stringify(tag)}, purpose: 'generate', claims: ['GPU', 'MODEL:ollama/qwen'] });
    console.log('HELD ' + (Date.now() - t0));
    await new Promise(r => setTimeout(r, ${holdMs}));
    lease.release(); console.log('RELEASED');
  `], { stdio: ['ignore', 'pipe', 'ignore'] })
  const lines: string[] = []
  child.stdout.on('data', data => lines.push(...String(data).split('\n').filter(Boolean)))
  return { child, lines }
}
async function until(fn: () => boolean, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(50) } throw new Error('timeout') }

try {
  const a = holder('mission-a', 1500)
  await until(() => a.lines.some(l => l.startsWith('HELD')))
  const b = holder('mission-b', 300)
  const c = holder('mission-c', 300)
  await sleep(500)
  assert.ok(!b.lines.some(l => l.startsWith('HELD')) && !c.lines.some(l => l.startsWith('HELD')))
  assert.equal(listLeases(root).filter(l => l.state === 'HELD').length, 1)
  ok('two more heavy local generations cannot hold the GPU while one does (separate processes)')

  // non-conflicting work proceeds meanwhile
  const job = startBackgroundJob({ root, missionId: 'm', taskId: 'light', kind: 'lint', command: 'true', cwd: root, claims: ['CPU_HEAVY'] })
  assert.equal(job.status, 'STARTED')
  const gpuJob = startBackgroundJob({ root, missionId: 'm', taskId: 'gpu', kind: 'gen', command: 'sleep', args: ['1'], cwd: root, claims: ['GPU'], queueIfBlocked: true })
  assert.equal(gpuJob.status, 'QUEUED')
  ok('a CPU job runs while the GPU is leased; a GPU job queues behind the lease')

  await until(() => b.lines.includes('RELEASED') && c.lines.includes('RELEASED'), 20000)
  const order = [b, c].map(x => x.lines.find(l => l.startsWith('HELD')))
  assert.ok(order[0] && order[1])
  ok('queued generations woke automatically after release, one at a time')
  await until(() => reconcileJobs(root).length === 0, 20000)
  ok('queued GPU job woke and ran once the lease cleared')

  const dead = holder('mission-dead', 60000)
  await until(() => dead.lines.some(l => l.startsWith('HELD')))
  const waiter = acquireLease({ root, missionId: 'waiter', purpose: 'g', claims: ['GPU'] })
  await sleep(400)
  dead.child.kill('SIGKILL')
  const got = await Promise.race([waiter, sleep(8000).then(() => null)])
  assert.ok(got, 'waiter must wake when the holder is SIGKILLed')
  got!.release()
  assert.equal(heldLeaseHolders(root).length, 0)
  ok('SIGKILLed holder: its lease is reclaimed and the queued turn wakes')
  console.log(`\nFOUNDRY_CLAIM_LEASES_VALIDATION ${passed}/${passed}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

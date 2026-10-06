/** Cross-process application ownership. Kernel locks survive wrapper loss and release on owner exit. */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '../repo/paths'

export type ApplicationProcessLock = { release: () => Promise<void>; onLost: (callback: () => void) => void }
// A pipe can remain open briefly when an outer sandbox/wrapper is interrupted. Require an active lease heartbeat as well as
// the kernel flock so an orphaned holder releases ownership even when EOF propagation is delayed or suppressed.
const HOLDER = "let lease; const arm=()=>{clearTimeout(lease); lease=setTimeout(()=>process.exit(74),5000)}; process.stdout.write('LOCKED\\n'); process.stdin.on('data',arm); process.stdin.on('end',()=>process.exit(0)); process.stdin.resume(); arm();"

export async function acquireApplicationProcessLock(missionId: string): Promise<ApplicationProcessLock | null> {
  if (process.platform !== 'linux') throw new Error('BUILD_ENVIRONMENT_MISSING: application process ownership requires Linux flock.')
  if (!/^[A-Za-z0-9_-]+$/.test(missionId)) throw new Error('Invalid mission identity for process lock.')
  const dir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'executors')
  await mkdir(dir, { recursive: true })
  const lockPath = path.join(dir, `${missionId}.lock`)
  // Keep the lock file: unlinking it would let different processes lock different inodes.
  const node = /(?:^|\/)node$/.test(process.execPath) ? process.execPath : '/usr/bin/node'
  const child = spawn('flock', ['--exclusive', '--nonblock', '--no-fork', '--conflict-exit-code', '73', lockPath, node, '-e', HOLDER], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.on('error', () => { /* The lock holder may exit before release closes its input. */ })
  let failure = '', ready = false, releasing = false, exited = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lost: (() => void) | undefined
  const closed = new Promise<void>(resolve => child.once('close', () => { exited = true; if (heartbeat) clearInterval(heartbeat); if (!releasing) lost?.(); resolve() }))
  const acquired = await new Promise<boolean>((resolve, reject) => {
    child.once('error', error => reject(new Error(`BUILD_ENVIRONMENT_MISSING: ${error.message}`)))
    child.stderr.on('data', data => { failure = (failure + String(data)).slice(-2000) })
    let output = ''
    child.stdout.on('data', data => {
      output += String(data)
      if (output.includes('LOCKED\n') && !ready) {
        ready = true
        heartbeat = setInterval(() => {
          if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write('.')
        }, 1000)
        heartbeat.unref()
        resolve(true)
      }
    })
    child.once('close', code => {
      if (ready) return
      if (code === 73) resolve(false)
      else reject(new Error(`Application process lock exited ${code}: ${failure}`))
    })
  })
  if (!acquired) return null
  return {
    onLost: callback => { lost = callback; if (exited && !releasing) callback() },
    release: async () => { releasing = true; if (heartbeat) clearInterval(heartbeat); child.stdin.end(); await closed },
  }
}

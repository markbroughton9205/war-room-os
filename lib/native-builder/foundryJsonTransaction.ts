/** Cross-process read/modify/publish for one JSON file. No PID/age-based lock stealing:
 * an interrupted or unknown owner requires explicit operator reconciliation. */
import { mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { writeFileAtomic } from './foundryAtomicJson'

export async function transactJsonFile<T, R>(
  target: string,
  read: (canonicalTarget: string) => Promise<T>,
  change: (current: T) => { value: T; result: R },
): Promise<R> {
  await mkdir(path.dirname(target), { recursive: true })
  // Canonical parent closes aliases of the same base-root path, including bundled copies.
  let canonical = path.join(await realpath(path.dirname(target)), path.basename(target))
  try { canonical = await realpath(canonical) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const lock = `${canonical}.transaction-lock`
  const deadline = performance.now() + 5_000
  for (;;) {
    try { await mkdir(lock); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (performance.now() >= deadline) {
        throw new Error(`JSON transaction contention at ${canonical}; owner evidence retained at ${lock}. Reconcile an interrupted owner before retrying.`)
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ token: randomUUID(), pid: process.pid, at: new Date().toISOString(), target: canonical }), { flag: 'wx' })
    const { value, result } = change(await read(canonical))
    await writeFileAtomic(canonical, JSON.stringify(value, null, 2))
    return result
  } finally {
    // Only this successful mkdir owner releases; no other code reclaims a live/unknown lock.
    await rm(lock, { recursive: true })
  }
}

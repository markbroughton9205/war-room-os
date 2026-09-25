/**
 * Atomic JSON persistence primitives for authoritative mission records.
 *
 * writeFileAtomic: the complete new content is written to a temp file in the SAME directory (same filesystem), flushed with
 * fsync, then renamed over the target. rename(2) is atomic, so a reader (or a crash, or a SIGTERM) sees either the whole
 * previous record or the whole new one — never a partial JSON. Temp files end in `.tmp`, which the record listings ignore.
 *
 * recoverJsonPrefix: records written by the pre-atomic writer could be torn when two writers overlapped (a complete record
 * followed by leftover bytes of a longer earlier write). The first balanced top-level value in such a file is a complete
 * record that one writer finished, so it can be recovered safely. Anything that does not parse is NOT guessed at.
 */
import { randomBytes } from 'node:crypto'
import { open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type AtomicWriteHooks = {
  /** Test seam: called after the temp file is durable and before the rename. Throwing here simulates a crash during save. */
  beforeRename?: (tempPath: string) => Promise<void> | void
}

let writesSinceSweep = 0

/** A process killed between creating and renaming a temp file leaves it behind. Sweep such orphans (older than a minute) now and then. */
async function sweepStaleTemps(dir: string, baseName: string): Promise<void> {
  try {
    const prefix = `.${baseName}.`
    for (const name of await readdir(dir)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
      const full = path.join(dir, name)
      const age = Date.now() - (await stat(full)).mtimeMs
      if (age > 60_000) await rm(full, { force: true })
    }
  } catch { /* best effort */ }
}

export async function writeFileAtomic(target: string, data: string, hooks: AtomicWriteHooks = {}): Promise<void> {
  const dir = path.dirname(target)
  writesSinceSweep += 1
  if (writesSinceSweep >= 25) { writesSinceSweep = 0; void sweepStaleTemps(dir, path.basename(target)) }
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  try {
    await hooks.beforeRename?.(temp)
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  // Best effort: make the rename itself durable.
  try {
    const dirHandle = await open(dir, 'r')
    await dirHandle.sync().catch(() => undefined)
    await dirHandle.close()
  } catch { /* directory fsync is not supported everywhere */ }
}

/** Returns the end index (exclusive) of the first balanced top-level JSON object/array in `raw`, or -1. */
export function firstBalancedValueEnd(raw: string): number {
  let i = 0
  while (i < raw.length && /\s/.test(raw[i])) i += 1
  if (raw[i] !== '{' && raw[i] !== '[') return -1
  let depth = 0
  let inString = false
  let escaped = false
  for (; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

export type RecoveredJson<T> = { ok: true; value: T; recovered: boolean; discardedBytes: number } | { ok: false; error: string }

export function parseJsonRecovering<T = unknown>(raw: string): RecoveredJson<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T, recovered: false, discardedBytes: 0 }
  } catch (error) {
    const end = firstBalancedValueEnd(raw)
    if (end > 0) {
      try {
        const value = JSON.parse(raw.slice(0, end)) as T
        return { ok: true, value, recovered: true, discardedBytes: raw.length - end }
      } catch { /* fall through */ }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Writes a quarantine copy of a damaged file. The name does not end in `.json`, so listings never pick it up. */
export async function quarantineCopy(target: string, raw: string): Promise<string> {
  const copy = `${target}.torn-${Date.now()}`
  await writeFile(copy, raw, 'utf8')
  return copy
}

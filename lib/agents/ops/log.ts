import { randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import { valueContainsSecret } from '@/lib/recursive-learning/ingestion/redact'
import type { AgentOpsRecord } from './types'

export function agentFoundryDir(): string {
  const raw = process.env.WAR_ROOM_AGENT_FOUNDRY_DIR?.trim()
  return raw ? path.resolve(raw) : path.join(resolveLocalAppDataPaths().data, 'agent-foundry')
}

export const MAX_RECORD_BYTES = 128 * 1024
export type OpsView = { records: AgentOpsRecord[]; corruptLines: number; duplicateLines: number }
type Draft = AgentOpsRecord extends infer R ? (R extends { rid: string } ? Omit<R, 'rid'> & { rid?: string } : never) : never

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Append-only JSONL. Torn lines are skipped and counted, duplicate record ids are ignored (first wins), a missing
 * trailing newline is repaired on the next append, records containing credential-like strings or exceeding the size
 * cap are refused. `withLock` is a cross-process critical section (O_EXCL lock file with stale-lock recovery), so a
 * check-then-append (e.g. "no run in flight" then "record run start") is atomic between processes on this machine.
 * TRUST MODEL: the file is trusted-local state; anyone who can write it can append records. Replay enforces state-machine
 * legality and structural validity, not authenticity.
 */
export class AgentOpsLog {
  readonly file: string
  readonly readOnly: boolean
  private lockDepth = 0
  private cache: { size: number; mtimeMs: number; view: OpsView } | null = null
  constructor(dir: string = agentFoundryDir(), opts: { readOnly?: boolean } = {}) {
    this.readOnly = opts.readOnly ?? false
    if (!this.readOnly) mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'agent-foundry.jsonl')
  }

  withLock<T>(fn: () => T): T {
    if (this.readOnly) throw new Error('agent foundry log opened read-only')
    if (this.lockDepth > 0) { this.lockDepth += 1; try { return fn() } finally { this.lockDepth -= 1 } }
    const lock = this.file + '.lock'
    const started = Date.now()
    let fd = -1
    for (;;) {
      try { fd = openSync(lock, 'wx'); break } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        try { if (Date.now() - statSync(lock).mtimeMs > 10_000) unlinkSync(lock) } catch { /* raced */ }
        if (Date.now() - started > 5_000) throw new Error('agent foundry log lock timeout')
        sleepSync(5)
      }
    }
    this.lockDepth = 1
    try { return fn() } finally { this.lockDepth = 0; closeSync(fd); try { unlinkSync(lock) } catch { /* already gone */ } }
  }

  append(draft: Draft): AgentOpsRecord {
    if (this.readOnly) throw new Error('agent foundry log opened read-only')
    const rec = { ...draft, rid: draft.rid ?? randomUUID() } as AgentOpsRecord
    if (valueContainsSecret(rec)) throw new Error('record refused: credential-like content')
    const line = JSON.stringify(rec)
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error('record refused: too large')
    return this.withLock(() => {
      if (this.view().records.some((r) => r.rid === rec.rid)) throw new Error(`record id already exists: ${rec.rid}`)
      const torn = existsSync(this.file) && statSync(this.file).size > 0 && !readFileSync(this.file, 'utf8').endsWith('\n')
      appendFileSync(this.file, (torn ? '\n' : '') + line + '\n', 'utf8')
      return rec
    })
  }

  has(rid: string): boolean { return this.view().records.some((r) => r.rid === rid) }

  view(): OpsView {
    const st = existsSync(this.file) ? statSync(this.file) : null
    if (st && this.cache && this.cache.size === st.size && this.cache.mtimeMs === st.mtimeMs) return this.cache.view
    const records: AgentOpsRecord[] = []
    const seen = new Set<string>()
    let corruptLines = 0
    let duplicateLines = 0
    if (st) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        let rec: AgentOpsRecord
        try { rec = JSON.parse(line) as AgentOpsRecord } catch { corruptLines += 1; continue }
        if (!rec || typeof rec.rid !== 'string' || typeof rec.t !== 'string') { corruptLines += 1; continue }
        if (seen.has(rec.rid)) { duplicateLines += 1; continue }
        seen.add(rec.rid)
        records.push(rec)
      }
    }
    const view = { records, corruptLines, duplicateLines }
    if (st) this.cache = { size: st.size, mtimeMs: st.mtimeMs, view }
    return view
  }
}

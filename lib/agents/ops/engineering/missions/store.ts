import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentOpsLog } from '../../log'
import type { Lease, MissionEvent, MissionRecord } from './types'

const SAFE_ID = /^msn-[0-9]{8}T[0-9]{6}-[0-9a-f]{8}$/
export const isMissionId = (s: unknown): s is string => typeof s === 'string' && SAFE_ID.test(s)

/**
 * Durable mission records. One directory per mission: mission.json (atomic replace) and events.jsonl (append-only). Mutation is read-modify-write under the Agent Ops
 * cross-process lock, so the API process, the runner and a recovery pass can never overwrite each other. Ids are never reused: creation refuses an existing directory,
 * and receipts are written once per attempt number into receipts/ (an earlier receipt is never overwritten).
 */
export class MissionStore {
  readonly root: string
  constructor(private readonly log: AgentOpsLog, root?: string) {
    this.root = root ?? path.join(path.dirname(log.file), 'engineering-missions')
    if (!log.readOnly) mkdirSync(this.root, { recursive: true })
  }
  newId(now: Date = new Date()): string {
    for (let i = 0; i < 5; i++) {
      const id = `msn-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-${randomUUID().slice(0, 8)}`
      if (!existsSync(path.join(this.root, id))) return id
    }
    throw new Error('could not allocate a unique mission id')
  }
  dir(id: string): string { if (!isMissionId(id)) throw new Error('invalid mission id'); return path.join(this.root, id) }
  private file(id: string) { return path.join(this.dir(id), 'mission.json') }
  create(rec: MissionRecord): MissionRecord {
    return this.log.withLock(() => {
      const d = this.dir(rec.id)
      if (existsSync(d)) throw new Error(`mission ${rec.id} already exists (ids are never reused)`)
      mkdirSync(d, { recursive: true })
      this.write(rec)
      return rec
    })
  }
  private write(rec: MissionRecord) {
    const f = this.file(rec.id); const tmp = `${f}.${process.pid}.tmp`
    // the lease lives in its own file (renewed every few seconds without taking the lock); the record on disk never carries a copy that could go stale
    writeFileSync(tmp, JSON.stringify({ ...rec, lease: null }, null, 1), 'utf8'); renameSync(tmp, f)
  }
  read(id: string): MissionRecord | null {
    try { const r = JSON.parse(readFileSync(this.file(id), 'utf8')) as MissionRecord; r.lease = this.readLease(id); return r } catch { return null }
  }
  private leaseFile(id: string) { return path.join(this.dir(id), 'lease.json') }
  readLease(id: string): Lease | null { try { return JSON.parse(readFileSync(this.leaseFile(id), 'utf8')) as Lease } catch { return null } }
  /** Written only by the worker that holds the mission (atomic replace, no lock). */
  writeLease(id: string, l: Lease): void { const f = this.leaseFile(id); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(l), 'utf8'); renameSync(tmp, f) }
  /** Retires a lease: the file is renamed (kept as evidence of who held the mission and when it last beat), never deleted. */
  retireLease(id: string, tag: string): void { const f = this.leaseFile(id); if (existsSync(f)) renameSync(f, path.join(this.dir(id), `lease.${tag}.${Date.now()}.json`)) }
  list(): MissionRecord[] {
    if (!existsSync(this.root)) return []
    const out: MissionRecord[] = []
    for (const n of readdirSync(this.root)) { if (!isMissionId(n)) continue; const r = this.read(n); if (r) out.push(r) }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  /** Read-modify-write under the cross-process lock. The mutator returns the new record, or null to leave it unchanged. */
  update(id: string, fn: (cur: MissionRecord) => MissionRecord | null): MissionRecord {
    return this.log.withLock(() => {
      const cur = this.read(id)
      if (!cur) throw new Error(`unknown mission ${id}`)
      const next = fn(structuredClone(cur))
      if (!next) return cur
      this.write(next)
      return next
    })
  }
  event(id: string, e: Omit<MissionEvent, 'at'> & { at?: string }): void {
    const line = JSON.stringify({ at: e.at ?? new Date().toISOString(), kind: e.kind, detail: String(e.detail).slice(0, 600), attempt: e.attempt })
    appendFileSync(path.join(this.dir(id), 'events.jsonl'), line + '\n', 'utf8')
  }
  events(id: string, limit = 200): MissionEvent[] {
    try {
      const lines = readFileSync(path.join(this.dir(id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
      return lines.slice(-limit).flatMap((l) => { try { return [JSON.parse(l) as MissionEvent] } catch { return [] } })
    } catch { return [] }
  }
  /** Receipts are write-once per name: an existing file is never replaced. Returns the path written, or null when that receipt already exists. */
  writeReceipt(id: string, name: string, body: unknown): string | null {
    const d = path.join(this.dir(id), 'receipts'); mkdirSync(d, { recursive: true })
    const f = path.join(d, name)
    if (existsSync(f)) return null
    writeFileSync(f, JSON.stringify(body, null, 1), { encoding: 'utf8', flag: 'wx' })
    return f
  }
  /** Provenance ledger lines (one per write/delivery), append-only. */
  ledgerAppend(id: string, entry: unknown): void { appendFileSync(path.join(this.dir(id), 'ledger.jsonl'), JSON.stringify(entry) + '\n', 'utf8') }
  ledger(id: string): Record<string, unknown>[] {
    try { return readFileSync(path.join(this.dir(id), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } }) } catch { return [] }
  }
}

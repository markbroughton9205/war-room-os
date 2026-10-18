import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentOpsLog } from '../../log'
import type { AnalysisRecord } from './types'

const SAFE_ID = /^rev-[0-9]{8}T[0-9]{6}-[0-9a-f]{8}$/
export const isAnalysisId = (s: unknown): s is string => typeof s === 'string' && SAFE_ID.test(s)

/**
 * Durable analysis records: one directory per analysis (analysis.json written once, events.jsonl append-only) beside the engineering missions, under the same Agent Ops
 * directory and cross-process lock. Ids are never reused and a record is never rewritten; a re-run is a new record.
 */
export class AnalysisStore {
  readonly root: string
  constructor(private readonly log: AgentOpsLog, root?: string) {
    this.root = root ?? path.join(path.dirname(log.file), 'engineering-analyses')
    if (!log.readOnly) mkdirSync(this.root, { recursive: true })
  }
  newId(now: Date = new Date()): string {
    for (let i = 0; i < 5; i++) {
      const id = `rev-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-${randomUUID().slice(0, 8)}`
      if (!existsSync(path.join(this.root, id))) return id
    }
    throw new Error('could not allocate a unique analysis id')
  }
  dir(id: string): string { if (!isAnalysisId(id)) throw new Error('invalid analysis id'); return path.join(this.root, id) }
  /** Written exactly once (flag wx inside a fresh directory); returns the record. */
  create(rec: AnalysisRecord): AnalysisRecord {
    return this.log.withLock(() => {
      const d = this.dir(rec.id)
      if (existsSync(d)) throw new Error(`analysis ${rec.id} already exists (ids are never reused)`)
      mkdirSync(d, { recursive: true })
      const f = path.join(d, 'analysis.json'), tmp = `${f}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(rec, null, 1), { encoding: 'utf8', flag: 'wx' }); renameSync(tmp, f)
      appendFileSync(path.join(d, 'events.jsonl'), JSON.stringify({ at: rec.createdAt, kind: 'ANALYSIS_RECORDED', detail: `${rec.target.kind} ${rec.target.owners.length} owner(s), ${rec.evidence.length} evidence item(s)` }) + '\n', 'utf8')
      return rec
    })
  }
  event(id: string, kind: string, detail: string): void {
    appendFileSync(path.join(this.dir(id), 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, detail: String(detail).slice(0, 400) }) + '\n', 'utf8')
  }
  events(id: string): { at: string; kind: string; detail: string }[] {
    try { return readFileSync(path.join(this.dir(id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } }) } catch { return [] }
  }
  read(id: string): AnalysisRecord | null {
    try { return JSON.parse(readFileSync(path.join(this.dir(id), 'analysis.json'), 'utf8')) as AnalysisRecord } catch { return null }
  }
  list(limit = 30): AnalysisRecord[] {
    if (!existsSync(this.root)) return []
    const out: AnalysisRecord[] = []
    for (const n of readdirSync(this.root)) { if (!isAnalysisId(n)) continue; const r = this.read(n); if (r) out.push(r) }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
  }
}

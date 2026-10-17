import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AgentOpsLog } from '../../log'
import type { CommandRecord } from './types'

export const isCommandId = (s: unknown): s is string => typeof s === 'string' && /^cmd-[0-9]{8}T[0-9]{6}-[0-9a-f]{8}$/.test(s)

/** Durable command records, one JSON file each (atomic replace), mutated under the Agent Ops cross-process lock. The mission store stays the source of truth for missions; this records what the Commander asked and how it was carried out. */
export class CommandStore {
  readonly root: string
  constructor(private readonly log: AgentOpsLog, adir: string) {
    this.root = path.join(adir, 'commands')
    if (!log.readOnly) mkdirSync(this.root, { recursive: true })
  }
  newId(now: Date = new Date()): string { return `cmd-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-${randomUUID().slice(0, 8)}` }
  private file(id: string) { if (!isCommandId(id)) throw new Error('invalid command id'); return path.join(this.root, `${id}.json`) }
  dir(id: string) { if (!isCommandId(id)) throw new Error('invalid command id'); const d = path.join(this.root, id); mkdirSync(d, { recursive: true }); return d }
  private write(rec: CommandRecord) { const f = this.file(rec.id); const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(rec, null, 1), 'utf8'); renameSync(tmp, f) }
  create(rec: CommandRecord): CommandRecord { return this.log.withLock(() => { if (existsSync(this.file(rec.id))) throw new Error('command id exists'); this.write(rec); return rec }) }
  read(id: string): CommandRecord | null { try { return JSON.parse(readFileSync(this.file(id), 'utf8')) as CommandRecord } catch { return null } }
  list(): CommandRecord[] {
    if (!existsSync(this.root)) return []
    const out: CommandRecord[] = []
    for (const n of readdirSync(this.root)) { if (!n.endsWith('.json')) continue; const r = this.read(n.slice(0, -5)); if (r) out.push(r) }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  update(id: string, fn: (cur: CommandRecord) => CommandRecord | null): CommandRecord {
    return this.log.withLock(() => {
      const cur = this.read(id)
      if (!cur) throw new Error(`unknown command ${id}`)
      const next = fn(structuredClone(cur))
      if (!next) return cur
      this.write(next)
      return next
    })
  }
  note(id: string, kind: string, detail: string): CommandRecord {
    return this.update(id, (c) => { c.timeline.push({ at: new Date().toISOString(), kind, detail: detail.slice(0, 500) }); if (c.timeline.length > 400) c.timeline.splice(0, c.timeline.length - 400); return c })
  }
  writeVerify(id: string, n: number, script: string) { writeFileSync(path.join(this.dir(id), `verify-${n}.mjs`), script, 'utf8') }
  readVerify(id: string, n: number): string | undefined { try { return readFileSync(path.join(this.dir(id), `verify-${n}.mjs`), 'utf8') } catch { return undefined } }
}

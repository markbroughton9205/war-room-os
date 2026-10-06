import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import { valueContainsSecret } from '@/lib/recursive-learning/ingestion/redact'
import type { AgentOpsRecord } from './types'

export function agentFoundryDir(): string {
  const raw = process.env.WAR_ROOM_AGENT_FOUNDRY_DIR?.trim()
  return raw ? path.resolve(raw) : path.join(resolveLocalAppDataPaths().data, 'agent-foundry')
}

export type OpsView = { records: AgentOpsRecord[]; corruptLines: number; duplicateLines: number }
type Draft = AgentOpsRecord extends infer R ? (R extends { rid: string } ? Omit<R, 'rid'> & { rid?: string } : never) : never

/**
 * Append-only JSONL. Torn lines are skipped and counted, duplicate record ids are ignored (first wins), a missing
 * trailing newline is repaired on the next append, and records containing credential-like strings are refused.
 */
export class AgentOpsLog {
  readonly file: string
  readonly readOnly: boolean
  constructor(dir: string = agentFoundryDir(), opts: { readOnly?: boolean } = {}) {
    this.readOnly = opts.readOnly ?? false
    if (!this.readOnly) mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'agent-foundry.jsonl')
  }

  append(draft: Draft): AgentOpsRecord {
    if (this.readOnly) throw new Error('agent foundry log opened read-only')
    const rec = { ...draft, rid: draft.rid ?? randomUUID() } as AgentOpsRecord
    if (valueContainsSecret(rec)) throw new Error('record refused: credential-like content')
    if (this.view().records.some((r) => r.rid === rec.rid)) return rec // idempotent
    const torn = existsSync(this.file) && statSync(this.file).size > 0 && !readFileSync(this.file, 'utf8').endsWith('\n')
    appendFileSync(this.file, (torn ? '\n' : '') + JSON.stringify(rec) + '\n', 'utf8')
    return rec
  }

  view(): OpsView {
    const records: AgentOpsRecord[] = []
    const seen = new Set<string>()
    let corruptLines = 0
    let duplicateLines = 0
    if (existsSync(this.file)) {
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
    return { records, corruptLines, duplicateLines }
  }
}

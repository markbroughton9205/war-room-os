import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { agentFoundryDir } from '@/lib/agents/ops/log'
import { valueContainsSecret } from '@/lib/recursive-learning/ingestion/redact'
import type { BenchmarkRecord, ForgeRecord, ModelEntry, ResourceProfile, SmokeResult } from './types'

type Draft<T> = T extends { rid: string } ? Omit<T, 'rid'> : never
/** Append-only JSONL beside the Foundry log. Torn lines are skipped; credential-like content is refused; later records of the same type supersede earlier ones. */
export class ForgeStore {
  readonly file: string
  constructor(dir: string = agentFoundryDir()) { mkdirSync(dir, { recursive: true }); this.file = path.join(dir, 'model-forge.jsonl') }
  records(): ForgeRecord[] {
    if (!existsSync(this.file)) return []
    const out: ForgeRecord[] = []; const seen = new Set<string>()
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { const r = JSON.parse(line) as ForgeRecord; if (r && typeof r.rid === 'string' && !seen.has(r.rid)) { seen.add(r.rid); out.push(r) } } catch { /* torn line */ }
    }
    return out
  }
  private append<T extends ForgeRecord>(draft: Draft<T>): T {
    const rec = { ...draft, rid: randomUUID() } as unknown as T
    if (valueContainsSecret(rec)) throw new Error('forge record refused: credential-like content')
    appendFileSync(this.file, JSON.stringify(rec) + '\n')
    return rec
  }
  registerModel(m: ModelEntry): void { this.append({ type: 'model', at: new Date().toISOString(), ...m } as never) }
  recordProfile(p: ResourceProfile): void { this.append({ type: 'profile', ...p } as never) }
  recordSmoke(s: SmokeResult): void { this.append({ type: 'smoke', ...s } as never) }
  recordBenchmark(b: BenchmarkRecord): void { this.append({ type: 'benchmark', ...b } as never) }
  models(): ModelEntry[] { const m = new Map<string, ModelEntry>(); for (const r of this.records()) if (r.type === 'model') { const { type: _t, rid: _r, at: _a, ...e } = r; m.set(e.ref, e) } return [...m.values()] }
  profiles(ref?: string): ResourceProfile[] { return this.records().flatMap((r) => (r.type === 'profile' && (!ref || r.modelRef === ref) ? [(({ type: _t, rid: _r, ...p }) => p)(r)] : [])) }
  smokes(ref?: string): SmokeResult[] { return this.records().flatMap((r) => (r.type === 'smoke' && (!ref || r.modelRef === ref) ? [(({ type: _t, rid: _r, ...s }) => s)(r)] : [])) }
  benchmarks(ref?: string): BenchmarkRecord[] { return this.records().flatMap((r) => (r.type === 'benchmark' && (!ref || r.modelRef === ref) ? [(({ type: _t, rid: _r, ...b }) => b)(r)] : [])) }
}

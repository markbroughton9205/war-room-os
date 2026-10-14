import type { Attempt, FileProvenance, MissionRecord, ProvenanceRole } from './types'

/** Maps a delivery's executor to the role it played in THIS mission, from the configuration recorded at start (never from the last file written). */
export function roleOf(author: string, cfg: MissionRecord['config']): ProvenanceRole {
  if (author.startsWith('foundry:')) return 'deterministic_tool'
  const model = author.includes('/') ? author.slice(author.indexOf('/') + 1) : author
  if (model === cfg.builder) return 'implementation_model'
  if (cfg.testReviewer && model === cfg.testReviewer) return 'test_reviewer'
  if (cfg.testCandidates.includes(model)) return 'test_candidate'
  if (cfg.escalation && model === cfg.escalation) return 'escalation_model'
  return 'unknown'
}

export type LedgerWrite = { type: 'write'; path: string; stepId: string; tag: string; author: string; role: ProvenanceRole; deterministic: boolean; autofixed: boolean; attempt: number; recovered: boolean; workerId: string; beforeHash: string | null; afterHash: string; at: string }
export type LedgerDelivery = { type: 'delivery'; model: string; provider: string; role: ProvenanceRole; attempt: number; recovered: boolean; latencyMs: number | 'UNKNOWN'; outputTokens: number | 'UNKNOWN'; at: string }

/** Final authorship per path = the LAST ledger write of that path whose content hash still matches the file on disk; anything else is reported as UNATTRIBUTED. */
export function fileProvenance(writes: LedgerWrite[], finalHashes: Record<string, string>): FileProvenance[] {
  const last = new Map<string, LedgerWrite>()
  for (const w of writes) last.set(w.path, w)
  const out: FileProvenance[] = []
  for (const [p, h] of Object.entries(finalHashes)) {
    const w = last.get(p)
    if (!w) continue
    if (w.afterHash === h) out.push({ path: p, author: w.author, role: w.role, deterministic: w.deterministic, autofixed: w.autofixed, attempt: w.attempt, recovered: w.recovered, stepId: w.stepId, afterHash: h, at: w.at })
    else out.push({ path: p, author: 'UNATTRIBUTED (file changed after Foundry last wrote it)', role: 'unknown', deterministic: false, autofixed: false, attempt: w.attempt, recovered: w.recovered, stepId: w.stepId, afterHash: h, at: w.at })
  }
  return out
}

export function roleSummary(deliveries: LedgerDelivery[]): Record<string, { model: string; calls: number }[]> {
  const out: Record<string, Map<string, number>> = {}
  for (const d of deliveries) { const m = (out[d.role] ??= new Map()); const k = d.provider === 'foundry' ? `foundry:${d.model}` : d.model; m.set(k, (m.get(k) ?? 0) + 1) }
  return Object.fromEntries(Object.entries(out).map(([r, m]) => [r, [...m.entries()].map(([model, calls]) => ({ model, calls }))]))
}

export const recoveryWorkers = (attempts: Attempt[]) => attempts.filter((a) => a.kind === 'RESUME').map((a) => ({ attempt: a.n, workerId: a.workerId }))

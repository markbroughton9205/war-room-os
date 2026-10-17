import { qualification } from '../../../forge/rank'
import type { BenchmarkRecord } from '../../../forge/types'
import type { ModelRole } from '../../../forge/roles'

/**
 * Local specialist escalation. When the current worker has failed to repair a problem, the next attempt goes to a DIFFERENT local model, but only one that the Forge's recorded benchmark
 * runs have qualified for the role (never by name, size or reputation), that is installed, and that fits the machine right now. Every rejected candidate is returned with its reason, so
 * the decision can be shown to the Commander. Nothing here calls a model or a network.
 */
export type InstalledModel = { name: string; sizeBytes: number }
export type EscalationChoice = {
  model: string; role: ModelRole; evidence: string
  rejected: { model: string; why: string }[]
}
export type EscalationInput = {
  benchmarks: BenchmarkRecord[]
  installed: InstalledModel[]
  current: string
  /** models already tried on this step */
  tried: string[]
  /** can a model of this size be loaded now? (GPU + RAM budget); undefined = unknown, assume yes */
  fits?: (m: InstalledModel) => boolean
  /** roles whose evidence qualifies a model to take over a bounded repair, in order of preference */
  roles?: ModelRole[]
}

export function chooseEscalation(i: EscalationInput): EscalationChoice | { model: null; rejected: { model: string; why: string }[]; reason: string } {
  const roles = i.roles ?? ['FAST_REPAIR_WORKER']
  const rejected: { model: string; why: string }[] = []
  const pool: { m: InstalledModel; role: ModelRole; evidence: string; size: number }[] = []
  for (const m of i.installed) {
    if (m.name === i.current) { rejected.push({ model: m.name, why: 'it is the worker that just failed' }); continue }
    if (i.tried.includes(m.name)) { rejected.push({ model: m.name, why: 'already tried on this step' }); continue }
    let best: { role: ModelRole; evidence: string } | null = null
    const why: string[] = []
    for (const role of roles) {
      const q = qualification(m.name, role, i.benchmarks)
      if (q.qualified) { best = { role, evidence: `${role}: ${q.evidence.ok}/${q.evidence.n} (${Math.round(q.evidence.rate * 100)}%) on recorded benchmark runs` }; break }
      why.push(`${role}: ${q.evidence.n ? q.problems.join('; ') : 'no benchmark evidence'}`)
    }
    if (!best) { if (!/embed|rerank/i.test(m.name)) rejected.push({ model: m.name, why: `not qualified (${why.join(' | ')})` }); continue }
    if (i.fits && !i.fits(m)) { rejected.push({ model: m.name, why: `qualified (${best.evidence}) but does not fit the free GPU/RAM right now` }); continue }
    pool.push({ m, ...best, size: m.sizeBytes })
  }
  // among the qualified: the larger coder first (more capacity for a repair the current worker could not do), ties by name for determinism
  pool.sort((a, b) => b.size - a.size || a.m.name.localeCompare(b.m.name))
  const top = pool[0]
  if (!top) return { model: null, rejected, reason: 'no installed local model is qualified for a bounded repair and fits right now' }
  for (const p of pool.slice(1)) rejected.push({ model: p.m.name, why: `qualified (${p.evidence}) but smaller than the chosen ${top.m.name}; kept as the next fallback` })
  return { model: top.m.name, role: top.role, evidence: top.evidence, rejected }
}

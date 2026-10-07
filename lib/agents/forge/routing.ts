import type { BenchmarkRecord, ModelEntry, TaskClass } from './types'

export type RouteDecision = { taskClass: TaskClass; model: string | null; basis: 'EVIDENCE' | 'NO_EVIDENCE'; /** LOW when fewer than 3 completed full-score runs back the choice; the route is then provisional. */ confidence?: 'LOW' | 'MODERATE'; reason: string; considered: { model: string; best: string; runs: number }[] }
const score = (b: BenchmarkRecord) => (b.verifierScore === 'UNKNOWN' ? -1 : b.verifierScore.pass / Math.max(1, b.verifierScore.total))
const isReal = (b: BenchmarkRecord) => !/test-double|scripted/i.test(b.executor)

/**
 * Evidence-only routing per task class. No model is preferred by size or name. BASELINE / FUTURE_HEAVY / non-eligible models are
 * never routed implicitly. A model must have a COMPLETED, full-score real run to be chosen for a class; otherwise NO_EVIDENCE.
 * Among qualifying models: fewer repairs, then lower elapsed time.
 */
export function routeFor(taskClass: TaskClass, models: ModelEntry[], benchmarks: BenchmarkRecord[]): RouteDecision {
  const eligible = new Set(models.filter((m) => m.routing.eligible && m.status === 'ACTIVE').map((m) => m.ref))
  const considered: RouteDecision['considered'] = []
  const winners: BenchmarkRecord[] = []
  for (const ref of eligible) {
    const runs = benchmarks.filter((b) => b.modelRef === ref && b.taskClass === taskClass && isReal(b) && !b.historicalBaseline)
    if (!runs.length) { considered.push({ model: ref, best: 'no real runs', runs: 0 }); continue }
    const best = [...runs].sort((a, b) => score(b) - score(a))[0]
    considered.push({ model: ref, best: best.verifierScore === 'UNKNOWN' ? 'UNKNOWN' : `${best.verifierScore.pass}/${best.verifierScore.total} ${best.completion}`, runs: runs.length })
    const full = runs.filter((r) => r.completion === 'COMPLETED' && score(r) === 1 && !r.manualIntervention)
    if (full.length) winners.push([...full].sort((a, b) => a.repairs - b.repairs || a.elapsedMs - b.elapsedMs)[0])
  }
  if (!winners.length) return { taskClass, model: null, basis: 'NO_EVIDENCE', reason: 'no eligible model has a completed full-score real run for this task class; do not assume a default', considered }
  const w = [...winners].sort((a, b) => a.repairs - b.repairs || a.elapsedMs - b.elapsedMs)[0]
  const completedRuns = benchmarks.filter((b) => b.modelRef === w.modelRef && b.taskClass === taskClass && isReal(b) && !b.historicalBaseline && b.completion === 'COMPLETED' && b.verifierScore !== 'UNKNOWN' && b.verifierScore.pass === b.verifierScore.total && !b.manualIntervention).length
  return { taskClass, model: w.modelRef, basis: 'EVIDENCE', confidence: completedRuns >= 3 ? 'MODERATE' : 'LOW', reason: `${completedRuns} completed full-score run(s); completed ${taskClass} with full verifier score using ${w.repairs} repair(s) in ${Math.round(w.elapsedMs / 1000)}s`, considered }
}

import { CLASS_GATES, LEGACY_TASK_EVIDENCE, ROLE_GATES, type ModelRole } from './roles'
import type { BenchmarkRecord, ModelEntry } from './types'

/**
 * Per-role ranking. Evidence for one role never lends credit to another; there is no global leaderboard.
 * A run counts for a role when it is tagged with that role, or (pre-compute records only) carries the task class explicitly mapped to the role.
 * Test doubles, scripted/simulated executors, historical baselines, manual interventions and frontier-assisted runs are never evidence.
 */
export type RoleEvidence = { ok: number; n: number; rate: number; repairs: number; elapsedMs: number }
export type RoleRankEntry = { ref: string; evidence: RoleEvidence; qualified: boolean; provisional: boolean; reason: string }
export type RoleRanking = { role: ModelRole; ranked: RoleRankEntry[]; noEvidence: string[]; basis: 'EVIDENCE' | 'NO_EVIDENCE' }

const isReal = (b: BenchmarkRecord) => !/test-double|scripted|simulated|sim-node/i.test(b.executor) && !b.historicalBaseline
const fullScore = (b: BenchmarkRecord) => b.verifierScore !== 'UNKNOWN' && b.verifierScore.total > 0 && b.verifierScore.pass === b.verifierScore.total
export const isSuccess = (b: BenchmarkRecord) => b.completion === 'COMPLETED' && fullScore(b) && !b.manualIntervention && b.cleanKind !== 'CLEAN_WITH_FRONTIER_ASSIST'

export function countsForRole(b: BenchmarkRecord, role: ModelRole): boolean {
  if (!isReal(b)) return false
  if (b.role) return b.role === role
  const legacy = LEGACY_TASK_EVIDENCE[role]
  return legacy !== undefined && b.taskClass === legacy
}

export function roleEvidence(ref: string, role: ModelRole, benchmarks: BenchmarkRecord[]): RoleEvidence {
  const runs = benchmarks.filter((b) => b.modelRef === ref && countsForRole(b, role))
  const wins = runs.filter(isSuccess)
  const avg = (f: (b: BenchmarkRecord) => number) => (wins.length ? wins.reduce((a, b) => a + f(b), 0) / wins.length : 0)
  return { ok: wins.length, n: runs.length, rate: runs.length ? wins.length / runs.length : 0, repairs: avg((b) => b.repairs), elapsedMs: avg((b) => b.elapsedMs) }
}

/** Success rate per fixture class for a role (only records that carry a class). */
export function classRates(ref: string, role: ModelRole, benchmarks: BenchmarkRecord[]): Record<string, { ok: number; n: number; rate: number }> {
  const out: Record<string, { ok: number; n: number; rate: number }> = {}
  for (const b of benchmarks) {
    if (b.modelRef !== ref || !b.fixtureClass || !countsForRole(b, role)) continue
    const c = (out[b.fixtureClass] ??= { ok: 0, n: 0, rate: 0 }); c.n++; if (isSuccess(b)) c.ok++
  }
  for (const c of Object.values(out)) c.rate = c.n ? c.ok / c.n : 0
  return out
}

/** The one definition of "qualified": overall gate AND every class gate (a missing class counts against the model). */
export function qualification(ref: string, role: ModelRole, benchmarks: BenchmarkRecord[]): { qualified: boolean; evidence: RoleEvidence; problems: string[] } {
  const ev = roleEvidence(ref, role, benchmarks); const g = ROLE_GATES[role]; const problems: string[] = []
  if (ev.n < g.minRuns) problems.push(`${ev.ok}/${ev.n}: below the ${g.minRuns}-run gate`)
  else if (ev.rate < g.minRate) problems.push(`${ev.ok}/${ev.n} = ${Math.round(ev.rate * 100)}% is below the ${g.minRate * 100}% gate`)
  const classes = classRates(ref, role, benchmarks)
  for (const [k, min] of Object.entries(CLASS_GATES[role] ?? {})) {
    const c = classes[k]
    if (!c || !c.n) problems.push(`no ${k} runs`)
    else if (c.rate < min) problems.push(`${k} ${c.ok}/${c.n} = ${Math.round(c.rate * 100)}% is below the ${min * 100}% class gate`)
  }
  return { qualified: problems.length === 0, evidence: ev, problems }
}

/** Only ACTIVE, routing-eligible models are ranked; BASELINE / FUTURE_HEAVY / CANDIDATE / RETIRED never are. */
export function rankForRole(role: ModelRole, models: ModelEntry[], benchmarks: BenchmarkRecord[]): RoleRanking {
  const gate = ROLE_GATES[role]
  const ranked: RoleRankEntry[] = []
  const noEvidence: string[] = []
  for (const m of models) {
    if (m.status !== 'ACTIVE' || !m.routing.eligible) continue
    const ev = roleEvidence(m.ref, role, benchmarks)
    if (ev.n === 0) { noEvidence.push(m.ref); continue }
    const q = qualification(m.ref, role, benchmarks)
    const qualified = q.qualified
    const provisional = !qualified && ev.n < gate.minRuns && ev.ok === ev.n
    const reason = qualified ? `${ev.ok}/${ev.n} (gate ${gate.minRate * 100}% over >= ${gate.minRuns} runs${Object.keys(CLASS_GATES[role] ?? {}).length ? ', class gates met' : ''})`
      : provisional ? `${ev.ok}/${ev.n} all successful but below the ${gate.minRuns}-run gate: provisional only`
      : q.problems.join('; ')
    ranked.push({ ref: m.ref, evidence: ev, qualified, provisional, reason })
  }
  ranked.sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.provisional) - Number(a.provisional) || b.evidence.rate - a.evidence.rate || b.evidence.n - a.evidence.n || a.evidence.repairs - b.evidence.repairs || a.evidence.elapsedMs - b.evidence.elapsedMs || (a.ref < b.ref ? -1 : 1))
  noEvidence.sort()
  return { role, ranked, noEvidence, basis: ranked.some((r) => r.qualified || r.provisional) ? 'EVIDENCE' : 'NO_EVIDENCE' }
}

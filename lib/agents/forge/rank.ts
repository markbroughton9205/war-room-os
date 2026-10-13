import { LEGACY_TASK_EVIDENCE, ROLE_GATES, type ModelRole } from './roles'
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

/** Only ACTIVE, routing-eligible models are ranked; BASELINE / FUTURE_HEAVY / CANDIDATE / RETIRED never are. */
export function rankForRole(role: ModelRole, models: ModelEntry[], benchmarks: BenchmarkRecord[]): RoleRanking {
  const gate = ROLE_GATES[role]
  const ranked: RoleRankEntry[] = []
  const noEvidence: string[] = []
  for (const m of models) {
    if (m.status !== 'ACTIVE' || !m.routing.eligible) continue
    const ev = roleEvidence(m.ref, role, benchmarks)
    if (ev.n === 0) { noEvidence.push(m.ref); continue }
    const qualified = ev.n >= gate.minRuns && ev.rate >= gate.minRate
    const provisional = !qualified && ev.n < gate.minRuns && ev.ok === ev.n
    const reason = qualified ? `${ev.ok}/${ev.n} (gate ${gate.minRate * 100}% over >= ${gate.minRuns} runs)`
      : provisional ? `${ev.ok}/${ev.n} all successful but below the ${gate.minRuns}-run gate: provisional only`
      : ev.n < gate.minRuns ? `${ev.ok}/${ev.n}: below the ${gate.minRuns}-run gate and not all successful`
      : `${ev.ok}/${ev.n} = ${Math.round(ev.rate * 100)}% is below the ${gate.minRate * 100}% gate`
    ranked.push({ ref: m.ref, evidence: ev, qualified, provisional, reason })
  }
  ranked.sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.provisional) - Number(a.provisional) || b.evidence.rate - a.evidence.rate || b.evidence.n - a.evidence.n || a.evidence.repairs - b.evidence.repairs || a.evidence.elapsedMs - b.evidence.elapsedMs || (a.ref < b.ref ? -1 : 1))
  noEvidence.sort()
  return { role, ranked, noEvidence, basis: ranked.some((r) => r.qualified || r.provisional) ? 'EVIDENCE' : 'NO_EVIDENCE' }
}

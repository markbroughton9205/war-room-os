import type { BenchmarkRecord, TaskClass } from './types'

/** One row per (model, task class, fixture). Deliberately NO global rank: rows are only comparable on the same fixture and engine. */
export type ScorecardRow = {
  model: string
  taskClass: TaskClass
  fixture: string
  engines: string[]
  baseline: boolean
  attempts: number
  scores: (number | 'UNKNOWN')[]
  avgVerifierScore: number | 'UNKNOWN' // mean pass fraction over attempts with a known score
  bestVerifierScore: number | 'UNKNOWN'
  completionRate: number // COMPLETED with full score and no manual intervention
  /** PRIMARY: share of runs whose workflow itself finished and validated (records predating the field: workflow COMPLETED inferred from completion). */
  workflowCompletionRate: number
  /** share of runs whose left-behind workspace scored full marks on the independent verifier, whether or not the workflow finished */
  verifierPassRate: number
  failureClasses: Record<string, number>
  firstPassRate: number // completed with 0 repairs
  avgRepairs: number
  retryRate: number // share of attempts needing >=1 repair round
  regressions: number | 'UNKNOWN'
  avgElapsedMs: number
  interventions: number
  peakVramMiB: number | 'UNKNOWN'
  confidence: 'NONE' | 'LOW' | 'MODERATE'
  confidenceNote: string
}

const frac = (b: BenchmarkRecord) => (b.verifierScore === 'UNKNOWN' ? 'UNKNOWN' as const : b.verifierScore.pass / Math.max(1, b.verifierScore.total))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : NaN)
const fixtureName = (f: string) => f.split(' ')[0]

export function buildScorecard(records: BenchmarkRecord[], opts: { sinceIso?: string; includeScripted?: boolean } = {}): ScorecardRow[] {
  const rows = new Map<string, BenchmarkRecord[]>()
  for (const r of records) {
    if (!opts.includeScripted && /test-double|scripted/i.test(r.executor)) continue
    if (opts.sinceIso && r.at < opts.sinceIso) continue
    const k = `${r.modelRef}|${r.taskClass}|${fixtureName(r.fixture)}`
    rows.set(k, [...(rows.get(k) ?? []), r])
  }
  return [...rows.entries()].map(([k, rs]) => {
    const [model, taskClass, fixture] = k.split('|')
    const known = rs.map(frac).filter((x): x is number => x !== 'UNKNOWN')
    const completed = rs.filter((r) => r.completion === 'COMPLETED' && r.verifierScore !== 'UNKNOWN' && r.verifierScore.pass === r.verifierScore.total && !r.manualIntervention)
    const regs = rs.map((r) => r.regressions)
    const vr = rs.map((r) => r.vramMiB).filter((x): x is number => typeof x === 'number')
    const n = rs.length
    return {
      model, taskClass: taskClass as TaskClass, fixture, engines: [...new Set(rs.map((r) => r.engineSha ?? 'UNKNOWN'))], baseline: rs.every((r) => !!r.historicalBaseline), attempts: n,
      scores: rs.map(frac), avgVerifierScore: known.length ? mean(known) : ('UNKNOWN' as const), bestVerifierScore: known.length ? Math.max(...known) : ('UNKNOWN' as const),
      completionRate: completed.length / n,
      workflowCompletionRate: rs.filter((r) => r.workflowCompleted ?? r.completion === 'COMPLETED').length / n,
      verifierPassRate: rs.filter((r) => r.verifierPass ?? (r.verifierScore !== 'UNKNOWN' && r.verifierScore.pass === r.verifierScore.total)).length / n,
      failureClasses: rs.reduce<Record<string, number>>((m, r) => { const k = r.failureClass ?? (r.completion === 'COMPLETED' ? 'NONE' : 'UNCLASSIFIED'); m[k] = (m[k] ?? 0) + 1; return m }, {}), firstPassRate: completed.filter((r) => r.repairs === 0).length / n, avgRepairs: mean(rs.map((r) => r.repairs)), retryRate: rs.filter((r) => r.repairs > 0).length / n,
      regressions: regs.every((x) => typeof x === 'number') ? (regs as number[]).reduce((a, c) => a + c, 0) : ('UNKNOWN' as const),
      avgElapsedMs: mean(rs.map((r) => r.elapsedMs)), interventions: rs.filter((r) => r.manualIntervention).length, peakVramMiB: vr.length ? Math.max(...vr) : ('UNKNOWN' as const),
      confidence: (n >= 5 ? 'MODERATE' : n >= 3 ? 'LOW' : 'NONE') as ScorecardRow['confidence'], confidenceNote: `${n} attempt(s) on one fixture${n < 5 ? '; too few to separate skill from sampling variance' : ''}`,
    }
  }).sort((a, b) => a.fixture.localeCompare(b.fixture) || a.model.localeCompare(b.model))
}

export function renderScorecard(rows: ScorecardRow[]): string {
  const pct = (v: number | 'UNKNOWN') => (v === 'UNKNOWN' ? 'UNKNOWN' : `${Math.round(v * 100)}%`)
  const head = '| model | class | fixture | n | avg score | best | WORKFLOW_COMPLETED | VERIFIER_PASS | first-pass | retry | regressions | avg time | interventions | peak VRAM | confidence |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  return [head, ...rows.map((r) => `| ${r.model}${r.baseline ? ' (BASELINE)' : ''} | ${r.taskClass} | ${r.fixture} | ${r.attempts} | ${pct(r.avgVerifierScore)} | ${pct(r.bestVerifierScore)} | ${pct(r.workflowCompletionRate)} | ${pct(r.verifierPassRate)} | ${pct(r.firstPassRate)} | ${pct(r.retryRate)} | ${r.regressions} | ${Math.round(r.avgElapsedMs / 1000)}s | ${r.interventions} | ${r.peakVramMiB === 'UNKNOWN' ? 'UNKNOWN' : `${r.peakVramMiB} MiB`} | ${r.confidence} |`)].join('\n')
}

/** Phase 9 acceptance validation. Run: pnpm run validate:recursive-learning */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LearningLog } from './store'
import { rankWorkflows, scoreSubject } from './scoring'
import type { EvaluationEventInput, TaskClass } from './types'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
function check(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail })
}

export const NOW = new Date('2026-10-06T00:00:00.000Z')
export const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
let seq = 0
export function ev(
  provider: string,
  taskClass: TaskClass,
  outcome: EvaluationEventInput['outcome'],
  ageDays: number,
  extra: Partial<EvaluationEventInput> = {},
): EvaluationEventInput {
  seq += 1
  return {
    id: `e${seq}`,
    subject: { kind: 'provider', id: provider },
    taskClass,
    outcome,
    occurredAt: day(ageDays),
    source: { kind: 'test', ref: `fixture-${seq}` },
    ...extra,
  }
}
export const freshLog = () => new LearningLog(mkdtempSync(path.join(tmpdir(), 'p9-')))

// ---- S2: event model + store (tests 14, 15, 17, 18)
{
  const log = freshLog()
  const noMetrics = log.recordEvent(ev('claude', 'risk_review', 'SUCCESS', 1), NOW)
  check('14_missing_metrics_stay_unknown', !('latencyMs' in noMetrics.metrics) && !('costUsd' in noMetrics.metrics), JSON.stringify(noMetrics.metrics))
  const zero = log.recordEvent(ev('claude', 'risk_review', 'SUCCESS', 1, { metrics: { costUsd: 0, latencyMs: -5, tokensIn: NaN } }), NOW)
  check('14b_explicit_zero_kept_invalid_dropped', zero.metrics.costUsd === 0 && zero.metrics.latencyMs === undefined && zero.metrics.tokensIn === undefined, JSON.stringify(zero.metrics))

  const failed = log.recordEvent(ev('gpt', 'code_modification', 'SUCCESS', 1, { validation: 'FAILED' }), NOW)
  check('18_failed_validation_cannot_be_success', failed.outcome === 'FAILURE' && failed.reportedOutcome === 'SUCCESS' && failed.coercions.length === 1, JSON.stringify(failed.coercions))

  const old = log.recordEvent(ev('grok', 'summarization', 'FAILURE', 40), NOW)
  const repl = log.recordEvent(ev('grok', 'summarization', 'SUCCESS', 1), NOW)
  const bytesBefore = readFileSync(log.file, 'utf8')
  log.supersede(old.id, 'misattributed run', repl.id, NOW)
  const v = log.view()
  check(
    '17_supersede_without_deletion',
    v.events.some((e) => e.id === old.id) && !v.activeEvents.some((e) => e.id === old.id) && v.supersessions.length === 1 && readFileSync(log.file, 'utf8').startsWith(bytesBefore),
    `events=${v.events.length} active=${v.activeEvents.length}`,
  )

  const restarted = new LearningLog(path.dirname(log.file))
  const rv = restarted.view()
  check('15_survives_restart', rv.events.length === v.events.length && rv.activeEvents.length === v.activeEvents.length && rv.events[0].id === v.events[0].id, `events=${rv.events.length}`)

  let threw = false
  try { log.supersede('nope', 'x') } catch { threw = true }
  let dup = false
  try { log.recordEvent(ev('x', 'risk_review', 'SUCCESS', 1, { id: old.id }), NOW) } catch { dup = true }
  check('store_rejects_unknown_supersede_and_duplicate_ids', threw && dup)
}

// ---- S3: scoring + workflows (tests 1, 2, 3, 5, 6, 11, 12, 14)
{
  const E = (items: EvaluationEventInput[]) => items.map((i) => freshLog().recordEvent(i, NOW))
  const P = (id: string) => ({ kind: 'provider' as const, id })
  const card = (events: ReturnType<typeof E>, id: string, tc: TaskClass) => scoreSubject(events, P(id), tc, NOW)

  // 1: differing task classes
  const t1 = E([
    ...[1, 2, 3, 4].map((d) => ev('claude', 'architecture_analysis', 'SUCCESS', d)),
    ...[1, 2, 3, 4].map((d) => ev('claude', 'realtime_research', 'FAILURE', d)),
  ])
  const a = card(t1, 'claude', 'architecture_analysis').score as number
  const b = card(t1, 'claude', 'realtime_research').score as number
  check('01_scores_differ_by_task_class', a > 0.7 && b < 0.3, `arch=${a.toFixed(3)} rt=${b.toFixed(3)}`)
  check('01b_unobserved_class_is_unknown', card(t1, 'claude', 'summarization').score === 'UNKNOWN')

  // 2: one bad run does not destroy ranking
  const good = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => ev('gpt', 'code_modification', 'SUCCESS', d))
  const t2 = E([...good, ev('gpt', 'code_modification', 'FAILURE', 0.5)])
  const t2base = E(good)
  const s2 = card(t2, 'gpt', 'code_modification').score as number
  const s2b = card(t2base, 'gpt', 'code_modification').score as number
  const lone = card(E([ev('gpt', 'summarization', 'FAILURE', 0.5)]), 'gpt', 'summarization').score as number
  check('02_one_bad_run_not_fatal', s2 > 0.6 && s2b - s2 < 0.15 && lone > 0.2, `with=${s2.toFixed(3)} base=${s2b.toFixed(3)} lone=${lone.toFixed(3)}`)

  // 3: stale evidence decays
  const fresh = card(E([...[1, 2, 3, 4].map((d) => ev('grok', 'summarization', 'SUCCESS', d))]), 'grok', 'summarization')
  const stale = card(E([...[1, 2, 3, 4].map((d) => ev('grok', 'summarization', 'SUCCESS', d + 240))]), 'grok', 'summarization')
  check('03_stale_evidence_decays', (stale.score as number) < (fresh.score as number) && stale.confidence < fresh.confidence * 0.2 && (stale.score as number) < 0.6, `fresh=${(fresh.score as number).toFixed(3)}/${fresh.confidence.toFixed(3)} stale=${(stale.score as number).toFixed(3)}/${stale.confidence.toFixed(3)}`)

  // 5: contradictory evidence lowers confidence (same counts, same recency)
  const agree = card(E(Array.from({ length: 6 }, (_, i) => ev('gemini', 'risk_review', 'SUCCESS', i + 1))), 'gemini', 'risk_review')
  const mixed = card(E(Array.from({ length: 6 }, (_, i) => ev('gemini', 'risk_review', i % 2 ? 'SUCCESS' : 'FAILURE', i + 1))), 'gemini', 'risk_review')
  check('05_contradiction_lowers_confidence', mixed.confidence < agree.confidence * 0.7 && mixed.contradiction > 0.9 && mixed.contradictoryEventIds.length > 0, `agree=${agree.confidence.toFixed(3)} mixed=${mixed.confidence.toFixed(3)} contradictory=${mixed.contradictoryEventIds.length}`)

  // 6: workflows rank from measured outcomes
  const wf = (id: string, outcome: EvaluationEventInput['outcome'], d: number) => ev(id, 'implementation_planning', outcome, d, { subject: { kind: 'workflow', id } })
  const t6 = E([
    ...[1, 2, 3, 4, 5].map((d) => wf('wf-validate-first', 'SUCCESS', d)),
    ...[1, 2, 3, 4, 5].map((d) => wf('wf-yolo', d % 2 ? 'FAILURE' : 'SUCCESS', d)),
    wf('wf-new', 'SUCCESS', 1),
  ])
  const ranking = rankWorkflows(t6, 'implementation_planning', NOW)
  check('06_workflows_rank_from_outcomes', ranking[0].card.subject.id === 'wf-validate-first' && ranking.map((r) => r.card.subject.id).indexOf('wf-yolo') > 0 && ranking.length === 3, ranking.map((r) => `${r.card.subject.id}=${(r.card.score as number).toFixed(2)}`).join(' '))

  // 11: rollback hits the relevant evaluation, not unrelated ones
  const base11 = [1, 2, 3, 4].map((d) => ev('claude', 'code_modification', 'SUCCESS', d))
  const other = [1, 2, 3, 4].map((d) => ev('claude', 'summarization', 'SUCCESS', d))
  const before = E([...base11, ...other])
  const after = E([...base11, ...other, ev('claude', 'code_modification', 'ROLLED_BACK', 0.2)])
  const cmB = card(before, 'claude', 'code_modification').score as number
  const cmA = card(after, 'claude', 'code_modification')
  check('11_rollback_negatively_affects_relevant_evaluation', (cmA.score as number) < cmB - 0.1 && cmA.rollbackCount === 1 && card(after, 'claude', 'summarization').score === card(before, 'claude', 'summarization').score, `before=${cmB.toFixed(3)} after=${(cmA.score as number).toFixed(3)}`)

  // 12: Commander correction affects evaluation
  const base12 = [1, 2, 3, 4].map((d) => ev('gpt', 'architecture_analysis', 'SUCCESS', d))
  const c12 = E([...base12, ...[0.5, 0.6, 0.7].map((d) => ev('gpt', 'architecture_analysis', 'PARTIAL', d, { signal: 'COMMANDER_CORRECTION' }))])
  const c12b = E(base12)
  check('12_commander_correction_affects_evaluation', (card(c12, 'gpt', 'architecture_analysis').score as number) < (card(c12b, 'gpt', 'architecture_analysis').score as number) - 0.1)

  // 14: missing metrics UNKNOWN in scorecards; known ones averaged only over reporters
  const t14 = E([ev('claude', 'summarization', 'SUCCESS', 1), ev('claude', 'summarization', 'SUCCESS', 1, { metrics: { latencyMs: 800 } })])
  const k = card(t14, 'claude', 'summarization')
  check('14c_scorecard_metrics_unknown_not_zero', k.costUsd === 'UNKNOWN' && k.latencyMs !== 'UNKNOWN' && Math.abs((k.latencyMs as number) - 800) < 1e-9, `lat=${k.latencyMs} cost=${k.costUsd}`)
}

export function finish(extra: Result[] = []) {
  const all = [...results, ...extra]
  for (const r of all) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' ' + r.detail : ''}`)
  const failed = all.filter((r) => !r.pass).length
  console.log(failed === 0 ? 'RECURSIVE_LEARNING_VALIDATION PASS' : `RECURSIVE_LEARNING_VALIDATION FAIL (${failed})`)
  process.exit(failed === 0 ? 0 : 1)
}
finish()

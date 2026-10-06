/** Phase 9 acceptance validation. Run: pnpm run validate:recursive-learning */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LearningLog } from './store'
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

export function finish(extra: Result[] = []) {
  const all = [...results, ...extra]
  for (const r of all) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' ' + r.detail : ''}`)
  const failed = all.filter((r) => !r.pass).length
  console.log(failed === 0 ? 'RECURSIVE_LEARNING_VALIDATION PASS' : `RECURSIVE_LEARNING_VALIDATION FAIL (${failed})`)
  process.exit(failed === 0 ? 0 : 1)
}
finish()

/** Phase 9 acceptance validation. Run: pnpm run validate:recursive-learning */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import * as api from './index'
import { LearningLog } from './store'
import { drillDown, listProposals } from './evidence'
import { recommendRouting, routingProposalDraft } from './recommendations'
import { rankWorkflows, scoreMatrix, scoreSubject } from './scoring'
import { detectRecurringFailures } from './analysis'
import { buildDoctrineProposals, buildMemoryCandidates, decideProposal, promoteMemoryCandidate, proposalStatus, submitProposal } from './proposals'
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

// ---- S4: failure analysis + proposals (tests 4, 9)
{
  const log = freshLog()
  for (const d of [1, 3, 5]) log.recordEvent(ev('gpt', 'code_modification', 'FAILURE', d, { errorClass: 'tool_timeout' }), NOW)
  for (const d of [2, 4]) log.recordEvent(ev('claude', 'code_modification', 'FAILURE', d, { errorClass: 'tool_timeout' }), NOW)
  log.recordEvent(ev('gpt', 'code_modification', 'SUCCESS', 2), NOW)
  log.recordEvent(ev('gpt', 'code_modification', 'FAILURE', 90, { errorClass: 'tool_timeout' }), NOW) // outside window
  const active = log.view().activeEvents
  const findings = detectRecurringFailures(active, NOW)
  check('04_recurring_failures_detected', findings.length === 1 && findings[0].subject.id === 'gpt' && findings[0].count === 3 && findings[0].contradictingSuccessIds.length === 1, JSON.stringify(findings.map((f) => [f.signature, f.count])))

  const drafts = buildMemoryCandidates(findings, scoreMatrix(active, NOW), NOW)
  const p = submitProposal(log, drafts[0], NOW)
  let autoPromoted = true
  try { promoteMemoryCandidate(log, p.id, NOW) } catch { autoPromoted = false }
  let nonCommander = true
  try { decideProposal(log, p.id, 'APPROVED', 'agent:claude', 'self approve', NOW) } catch { nonCommander = false }
  const stillProposed = proposalStatus(log.view(), p.id) === 'PROPOSED' && log.view().promotions.length === 0
  decideProposal(log, p.id, 'APPROVED', 'commander:mark', 'evidence reviewed', NOW)
  const rec = promoteMemoryCandidate(log, p.id, NOW)
  check('09_memory_candidates_cannot_auto_promote', !autoPromoted && !nonCommander && stillProposed && rec.approvedBy === 'commander:mark' && p.applied === false && !!p.reviewBy && p.evidenceEventIds.length === 3)

  const bigLog = freshLog()
  for (const d of [1, 2, 3, 4, 5]) bigLog.recordEvent(ev('gpt', 'risk_review', 'FAILURE', d, { errorClass: 'ignored_approval_gate' }), NOW)
  const doctrine = buildDoctrineProposals(detectRecurringFailures(bigLog.view().activeEvents, NOW))
  check('09b_doctrine_proposals_protected_and_unapplied', doctrine.length === 1 && submitProposal(bigLog, doctrine[0], NOW).targetsProtectedPolicy === true)
}

// ---- S5: recommendations + evidence (tests 7, 8, 10, 13, 16)
{
  const log = freshLog()
  const runs = (id: string, n: number, outcome: EvaluationEventInput['outcome'], metrics: EvaluationEventInput['metrics']) =>
    Array.from({ length: n }, (_, i) => log.recordEvent(ev(id, 'architecture_analysis', outcome, i + 1, { metrics }), NOW))
  const claude = runs('claude', 6, 'SUCCESS', { costUsd: 0.5, latencyMs: 9000 })
  const gpt = runs('gpt', 6, 'SUCCESS', { costUsd: 0.05, latencyMs: 1000 })
  const active = log.view().activeEvents
  const quality = recommendRouting(active, 'architecture_analysis', NOW)
  const priced = recommendRouting(active, 'architecture_analysis', NOW, { weights: { cost: 0.5, latency: 0.2 } })
  const cited = new Set(priced.citedEventIds)
  check('07_routing_recommendation_cites_evidence', priced.reason === 'RECOMMENDED' && priced.citedEventIds.length >= 6 && [...gpt, ...claude].every((e) => cited.has(e.id)) && priced.applied === false)
  check('13_cost_latency_influence_recommendation', priced.recommended?.id === 'gpt' && quality.ranking.length === 2 && quality.recommended !== null, `quality->${quality.recommended?.id} priced->${priced.recommended?.id}`)

  const sparse = freshLog()
  sparse.recordEvent(ev('claude', 'risk_review', 'SUCCESS', 1), NOW)
  const thin = recommendRouting(sparse.view().activeEvents, 'risk_review', NOW)
  check('07b_thin_evidence_abstains', thin.recommended === null && thin.reason === 'INSUFFICIENT_EVIDENCE')
  const unk = freshLog()
  for (let i = 1; i <= 6; i++) { unk.recordEvent(ev('a', 'risk_review', 'SUCCESS', i, { metrics: { costUsd: 0.01 } }), NOW); unk.recordEvent(ev('b', 'risk_review', 'SUCCESS', i), NOW) }
  const ur = recommendRouting(unk.view().activeEvents, 'risk_review', NOW, { weights: { cost: 0.5 } })
  check('14d_unknown_cost_not_treated_as_free', (() => { const b = ur.ranking.find((r) => r.card.subject.id === 'b')!; const a = ur.ranking.find((r) => r.card.subject.id === 'a')!; return b.unknownMetrics.includes('cost') && b.utility <= a.utility + 1e-12 })(), JSON.stringify(ur.ranking.map((r) => [r.card.subject.id, r.utility.toFixed(3), r.unknownMetrics])))

  // 16 + 10: drill-down, supersession visible, rejection auditable
  const p = submitProposal(log, routingProposalDraft(priced), NOW)
  log.supersede(gpt[0].id, 'duplicate run record', gpt[1].id, NOW)
  const dd = drillDown(log, p.id)
  check('16_drill_down_to_source_evidence', dd.supporting.length === p.evidenceEventIds.length && dd.missingEventIds.length === 0 && dd.supporting.some((i) => i.superseded && i.supersededReason === 'duplicate run record') && dd.supporting.every((i) => i.event.source.ref.startsWith('fixture-')))
  decideProposal(log, p.id, 'REJECTED', 'commander:mark', 'prefer claude for architecture regardless of cost', NOW)
  const row = listProposals(log).find((r) => r.proposal.id === p.id)
  const dd2 = drillDown(log, p.id)
  check('10_rejected_recommendation_stays_auditable', row?.status === 'REJECTED' && dd2.decisions.length === 1 && dd2.decisions[0].reason.includes('prefer claude') && dd2.proposal.evidenceEventIds.length > 0)

  // 8: hard policy never silently mutated
  const protectedFiles = ['docs/war-room-constitution.md', 'CLAUDE.md', 'docs/phases/phase-9.md', 'lib/auth', 'middleware.ts'].filter((f) => existsSync(f) && !f.endsWith('auth'))
  const hash = () => protectedFiles.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex')).join()
  const h0 = hash()
  const dl = freshLog()
  for (const d of [1, 2, 3, 4, 5]) dl.recordEvent(ev('gpt', 'risk_review', 'FAILURE', d, { errorClass: 'skipped_deploy_gate' }), NOW)
  const dp = submitProposal(dl, buildDoctrineProposals(detectRecurringFailures(dl.view().activeEvents, NOW))[0], NOW)
  decideProposal(dl, dp.id, 'APPROVED', 'commander:mark', 'approved for review', NOW)
  const surface = Object.keys(api).filter((k) => /^(apply|mutate|rewrite|deploy|push|merge|spend|execute|write)/i.test(k))
  check('08_hard_policy_never_silently_mutated', h0 === hash() && protectedFiles.length >= 2 && dp.targetsProtectedPolicy && dp.applied === false && surface.length === 0, `files=${protectedFiles.length} mutatingExports=${surface.join(',') || 'none'}`)
  check('08b_protected_targets_flagged', api.touchesProtectedPolicy('ROUTING_RECOMMENDATION', ['lib/auth/session.ts']) && api.touchesProtectedPolicy('ROUTING_RECOMMENDATION', ['deploy rules']) && !api.touchesProtectedPolicy('ROUTING_RECOMMENDATION', ['routing/summarization']))
}

export function finish(extra: Result[] = []) {
  const all = [...results, ...extra]
  for (const r of all) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' ' + r.detail : ''}`)
  const failed = all.filter((r) => !r.pass).length
  console.log(failed === 0 ? 'RECURSIVE_LEARNING_VALIDATION PASS' : `RECURSIVE_LEARNING_VALIDATION FAIL (${failed})`)
  process.exit(failed === 0 ? 0 : 1)
}
finish()

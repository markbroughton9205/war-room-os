import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ForgeStore } from './store'
import { FIRST_POOL } from './registry'
import { routeFor } from './routing'
import { classifyResidency, estimateFeasibility } from './profile'
import type { BenchmarkRecord } from './types'
import { ENGINEERING_WORKFLOW_ID, emitEngineeringRun, engineeringRunToEvents, failureClassOf } from './phase9'
import { LearningLog } from '@/lib/recursive-learning/store'
import { scoreMatrix } from '@/lib/recursive-learning/scoring'
import { detectRecurringFailures } from '@/lib/recursive-learning/analysis'

let fails = 0
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + d}`); if (!ok) fails++ }
const dir = mkdtempSync(path.join(tmpdir(), 'forge-'))
const bench = (o: Partial<BenchmarkRecord>): BenchmarkRecord => ({ modelRef: 'huihui_ai/devstral-abliterated:24b', executor: 'ollama:x', fixture: 'f', at: 'now', taskClass: 'complete_feature', verifierScore: { pass: 12, total: 12 }, completion: 'COMPLETED', modelCalls: 5, repairs: 1, retries: 'UNKNOWN', regressions: 'UNKNOWN', elapsedMs: 60000, manualIntervention: false, contextTokens: 8192, ramMiB: 'UNKNOWN', vramMiB: 'UNKNOWN', ...o })
try {
  const s = new ForgeStore(dir)
  for (const m of FIRST_POOL) s.registerModel(m)
  check('F01_pool_registered_with_exact_refs', s.models().length === 4 && s.models().some((m) => m.ref === 'huihui_ai/devstral-abliterated:24b'))
  check('F02_qwen25_is_baseline_and_not_routable_and_123b_future_not_routable', s.models().find((m) => m.ref === 'qwen2.5-coder:14b')!.status === 'BASELINE' && s.models().filter((m) => m.status !== 'ACTIVE').every((m) => !m.routing.eligible))
  check('F03_abliterated_derivatives_do_not_claim_a_verified_license', FIRST_POOL.filter((m) => /abliterated/.test(m.ref)).every((m) => m.license.permissive === 'UNKNOWN'))
  check('F04_no_evidence_means_no_route_not_a_default', routeFor('complete_feature', s.models(), []).model === null && routeFor('complete_feature', s.models(), []).basis === 'NO_EVIDENCE')
  s.recordBenchmark(bench({ modelRef: 'qwen2.5-coder:14b', verifierScore: { pass: 12, total: 12 } }))
  check('F05_baseline_model_is_never_routed_even_with_a_perfect_run', routeFor('complete_feature', s.models(), s.benchmarks()).model === null)
  s.recordBenchmark(bench({ verifierScore: { pass: 11, total: 12 }, completion: 'PARTIAL' }))
  check('F06_partial_score_does_not_win', routeFor('complete_feature', s.models(), s.benchmarks()).model === null)
  s.recordBenchmark(bench({ executor: 'test-double', verifierScore: { pass: 12, total: 12 } }))
  check('F07_scripted_double_evidence_is_excluded', routeFor('complete_feature', s.models(), s.benchmarks()).model === null)
  s.recordBenchmark(bench({ manualIntervention: true }))
  check('F08_manually_repaired_run_does_not_win', routeFor('complete_feature', s.models(), s.benchmarks()).model === null)
  s.recordBenchmark(bench({ modelRef: 'huihui_ai/qwen3-abliterated:14b', repairs: 3 }))
  s.recordBenchmark(bench({ repairs: 1 }))
  const r = routeFor('complete_feature', s.models(), s.benchmarks())
  check('F09_winner_chosen_by_evidence_fewer_repairs_per_task_class', r.model === 'huihui_ai/devstral-abliterated:24b' && r.basis === 'EVIDENCE')
  check('F10_other_task_classes_stay_undecided', routeFor('review', s.models(), s.benchmarks()).model === null)
  check('F11_residency_classified_from_runtime_bytes', classifyResidency(100, 100).residency === 'FULL_GPU' && classifyResidency(100, 60).residency === 'PARTIAL_OFFLOAD' && classifyResidency(100, 0).residency === 'CPU_ASSISTED' && classifyResidency(null, null).residency === 'UNKNOWN')
  const GiB = 1024 ** 3
  const e123 = estimateFeasibility(70 * GiB, 16 * GiB, 30 * GiB), e24 = estimateFeasibility(14 * GiB, 16 * GiB, 30 * GiB)
  check('F12_123b_estimated_requires_offload_and_24b_not_called_full_gpu_before_measurement', e123.residency === 'REQUIRES_OFFLOAD' && e123.basis === 'ESTIMATED' && e24.residency === 'UNKNOWN' && e24.basis === 'ESTIMATED')
  appendFileSync(s.file, '{"type":"smoke","rid":"torn')
  check('F13_torn_line_tolerated', new ForgeStore(dir).models().length === 4)
  let refused = false; try { s.registerModel({ ...FIRST_POOL[0], lineage: { note: 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF' } }) } catch { refused = true }
  check('F14_credential_like_content_refused', refused)
} finally { rmSync(dir, { recursive: true, force: true }) }
{
  const { buildScorecard } = await import('./scorecard')
  const A = (o: Partial<BenchmarkRecord>) => bench({ fixture: 'chat-sessions (x)', engineSha: 'e1', ...o })
  const B = (o: Partial<BenchmarkRecord>) => bench({ fixture: 'task-board (x)', engineSha: 'e1', ...o })
  const rows = buildScorecard([A({ verifierScore: { pass: 6, total: 12 }, completion: 'PARTIAL', repairs: 2 }), A({ verifierScore: { pass: 12, total: 12 }, repairs: 0 }), A({ verifierScore: { pass: 0, total: 12 }, completion: 'FAILED', repairs: 3, manualIntervention: true }), B({ verifierScore: { pass: 12, total: 12 } }), B({ modelRef: 'qwen2.5-coder:14b', historicalBaseline: true, verifierScore: 'UNKNOWN', completion: 'FAILED' }), B({ executor: 'test-double' })])
  const a = rows.find((r) => r.fixture === 'chat-sessions')!, b = rows.find((r) => r.fixture === 'task-board' && r.model.includes('devstral'))!, q = rows.find((r) => r.model === 'qwen2.5-coder:14b')!
  check('F23_scorecard_has_one_row_per_model_class_fixture_and_never_merges_fixtures_or_ranks_globally', rows.length === 3 && a.attempts === 3 && b.attempts === 1 && !('rank' in a))
  check('F24_scorecard_numbers_are_computed_from_runs_completion_first_pass_retry_and_interventions', Math.abs((a.avgVerifierScore as number) - 0.5) < 1e-9 && a.completionRate === 1 / 3 && a.firstPassRate === 1 / 3 && a.retryRate === 2 / 3 && a.interventions === 1 && a.confidence === 'LOW')
  check('F25_unknowns_stay_unknown_regressions_unmeasured_and_unknown_scores', a.regressions === 'UNKNOWN' && q.avgVerifierScore === 'UNKNOWN' && q.baseline && b.confidence === 'NONE')
  check('F26_scripted_double_runs_are_excluded_from_the_scorecard', rows.every((r) => r.attempts >= 1) && !rows.some((r) => r.fixture === 'task-board' && r.model.includes('devstral') && r.attempts === 2))
}
await (async () => {
// ---- Phase 9 wiring: real engineering runs become attributable evaluation events
{
  const learnDir = mkdtempSync(path.join(tmpdir(), 'forge-p9-'))
  try {
    const log = new LearningLog(learnDir)
    const real = (o: Partial<BenchmarkRecord>) => bench({ at: new Date(Date.now() - 3600_000).toISOString(), fixture: 'task-board (TASK_FEATURE, independent 12-check verifier)', engineSha: 'abc123def456', executor: 'ollama:huihui_ai/devstral-abliterated:24b', ...o })
    const ok = engineeringRunToEvents(real({}))
    check('F15_a_real_run_yields_a_model_event_and_a_workflow_event_with_attribution_in_source_and_note', ok.events.length === 2 && ok.events.some((e) => e.subject.kind === 'model' && e.subject.id === 'huihui_ai/devstral-abliterated:24b') && ok.events.some((e) => e.subject.kind === 'workflow' && e.subject.id === ENGINEERING_WORKFLOW_ID) && ok.events.every((e) => e.taskClass === 'code_modification' && /fixture=task-board/.test(e.note ?? '') && /engine=abc123def456/.test(e.note ?? '') && /verifier=12\/12/.test(e.note ?? '') && /executor=ollama:/.test(e.note ?? '') && /intervention=none/.test(e.note ?? '') && e.source.ref.includes('abc123def456')))
    check('F16_cost_and_tokens_are_never_invented_only_latency_and_retries_are_reported', ok.events.every((e) => e.metrics && !('costUsd' in e.metrics) && !('tokensIn' in e.metrics) && !('tokensOut' in e.metrics) && e.metrics.latencyMs === 60000 && e.metrics.retries === 1))
    check('F17_scripted_double_runs_are_refused_as_evidence', engineeringRunToEvents(real({ executor: 'test-double' })).events.length === 0)
    const partial = engineeringRunToEvents(real({ verifierScore: { pass: 9, total: 12 }, completion: 'PARTIAL', rootCause: 'independent verification: UNDETERMINED' }))
    check('F18_a_partial_run_is_PARTIAL_with_validation_FAILED_and_carries_a_failure_class', partial.events[0].outcome === 'PARTIAL' && partial.events[0].validation === 'FAILED' && partial.events[0].errorClass === 'repair_unresolved' && failureClassOf('src/x.mjs: incompatible rewrite after 2 rejections') === 'edit_rejected_repeatedly')
    check('F19_a_run_that_reports_COMPLETED_but_not_full_score_is_not_a_SUCCESS', engineeringRunToEvents(real({ verifierScore: { pass: 11, total: 12 }, completion: 'COMPLETED' })).events[0].outcome !== 'SUCCESS')
    const r1 = emitEngineeringRun(log, real({}), { trial: 't1' }); const r2 = emitEngineeringRun(log, real({}), { trial: 't1' })
    check('F20_ingestion_is_idempotent_by_stable_event_id', r1.inserted === 2 && r2.inserted === 0 && r2.duplicates === 2 && r1.rejected.length === 0, JSON.stringify([r1, r2]))
    for (let i = 0; i < 3; i++) emitEngineeringRun(log, real({ modelRef: 'huihui_ai/qwen3-abliterated:14b', verifierScore: { pass: 0, total: 12 }, completion: 'FAILED', rootCause: 'src/chatService.mjs: incompatible rewrite after 2 rejections' }), { trial: `q${i}` })
    const events = log.view().events
    const cards = scoreMatrix(events, new Date(), undefined, 'model').filter((c) => c.taskClass === 'code_modification')
    const dev = cards.find((c) => c.subject.id === 'huihui_ai/devstral-abliterated:24b'), qw = cards.find((c) => c.subject.id === 'huihui_ai/qwen3-abliterated:14b')
    check('F21_phase9_scores_models_by_task_class_from_these_events', !!dev && !!qw && typeof dev.score === 'number' && typeof qw.score === 'number' && dev.score > qw.score && dev.costUsd === 'UNKNOWN', JSON.stringify([dev?.score, qw?.score]))
    const wf = scoreMatrix(events, new Date(), undefined, 'workflow').find((c) => c.subject.id === ENGINEERING_WORKFLOW_ID)
    check('F22_phase9_scores_the_engineering_workflow_and_detects_the_repeated_failure_class', !!wf && wf.rawSamples >= 4 && detectRecurringFailures(events, new Date(), { minCount: 3 }).some((f) => f.signature.includes('qwen3') && f.signature.includes('edit_rejected_repeatedly')))
  } finally { rmSync(learnDir, { recursive: true, force: true }) }
}
})()
console.log(`FORGE_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)

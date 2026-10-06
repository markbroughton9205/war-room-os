import { mkdtempSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ForgeStore } from './store'
import { FIRST_POOL } from './registry'
import { routeFor } from './routing'
import { classifyResidency, estimateFeasibility } from './profile'
import type { BenchmarkRecord } from './types'

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
console.log(`FORGE_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)

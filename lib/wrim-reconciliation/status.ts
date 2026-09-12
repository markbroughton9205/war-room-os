import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import { CURRENT_WR_TOKENIZER, WR_CORPUS_STATUS, WR_TOKENIZER_RECONCILIATION } from '@/lib/wr-corpus/identity'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  DENSE_BASELINE_REQUIRED,
  HISTORICAL_WRIM_0_STATUS,
  HISTORICAL_WRIM_1_RUN_000001_STATUS,
  HISTORICAL_WRIM_1_RUN_000002_STATUS,
  HISTORICAL_WRIM_1_STATUS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  TRAINING_AUTHORIZATION,
  WRIM_CONTINUATION_RECOMMENDATION,
  WRIM_RECONCILIATION,
  wrimReconciliationTruthNotes,
} from './identity'
import { resolveWrimReconciliationPaths } from './paths'
import fs from 'node:fs'

export function wrimReconciliationStatusPayload(dataDirOverride?: string | null) {
  const paths = resolveWrimReconciliationPaths(dataDirOverride)
  const truth = getSovereignRuntimeTruth()
  let report: Record<string, unknown> | null = null
  if (fs.existsSync(paths.reportPath)) {
    report = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8')) as Record<string, unknown>
  }
  return {
    ok: true,
    WRIM_RECONCILIATION,
    historical_wrim0: HISTORICAL_WRIM_0_STATUS,
    historical_wrim1: HISTORICAL_WRIM_1_STATUS,
    wrim1_run_000001: HISTORICAL_WRIM_1_RUN_000001_STATUS,
    wrim1_run_000002: HISTORICAL_WRIM_1_RUN_000002_STATUS,
    recovery: 'TEST_ONLY',
    continuation: WRIM_CONTINUATION_RECOMMENDATION,
    dense_baseline_required: DENSE_BASELINE_REQUIRED,
    nebula_readiness: report?.hardware ?? 'probe via reconcile',
    training_authorization: TRAINING_AUTHORIZATION,
    train_button: false,
    current_production_wrim: CURRENT_PRODUCTION_WRIM,
    current_training: CURRENT_WRIM_TRAINING,
    tokenizer: CURRENT_WR_TOKENIZER,
    tokenizer_reconciliation: WR_TOKENIZER_RECONCILIATION,
    wr_corpus: WR_CORPUS_STATUS,
    rael: RAEL_STATUS,
    qwen: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    roadmap_22: ROADMAP_22_STATUS,
    roadmap_23: ROADMAP_23_STATUS,
    autonomy: truth.ASCENSION_AUTONOMY,
    native_wrim: truth.NATIVE_WRIM,
    notes: wrimReconciliationTruthNotes(),
    report_present: Boolean(report),
  }
}

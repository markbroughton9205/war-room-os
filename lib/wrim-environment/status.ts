import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  NEXT_AUTHORIZED_PASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  STAGE1_AUTHORIZED,
  STAGE1_RUN_ID,
  STAGE1_STATUS,
  STAGE2_RUN_ID,
  STAGE2_STATUS,
  CONTROLLED_STABILITY_EXPERIMENT_ID,
  PHASE0_STATUS,
  PHASE1_STATUS,
  PHASE2_STATUS,
  PHASE2_EXPERIMENT_ID,
  PHASE3A_STATUS,
  STAGE3_AUTHORIZATION,
  STAGE3_DESIGN_STATUS,
  STAGE3_EXECUTION_READINESS,
  STAGE3_EXECUTION_REVIEW,
  STAGE3_RUN_ID,
  STAGE3_TRAINER_STATUS,
  STAGE3A_EXECUTION_READINESS,
  STAGE3B_EXECUTION_READINESS,
  TRAINING_AUTHORIZATION,
} from './identity'
import {
  STAGE3_EVAL_SUITE_ID,
  STAGE3_EVAL_SUITE_STATUS,
  STAGE3B_LR_FORMULA,
} from './stage3Design'
import { resolveWrimEnvironmentPaths } from './paths'
import fs from 'node:fs'

export function wrimEnvironmentStatusPayload(dataDirOverride?: string | null) {
  const paths = resolveWrimEnvironmentPaths(dataDirOverride)
  const truth = getSovereignRuntimeTruth()
  let report: Record<string, unknown> | null = null
  let stage1: Record<string, unknown> | null = null
  let stage2: Record<string, unknown> | null = null
  let experiment: Record<string, unknown> | null = null
  let manifest: Record<string, unknown> | null = null
  if (fs.existsSync(paths.reportPath)) {
    report = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8')) as Record<string, unknown>
  }
  if (fs.existsSync(paths.stage1ReportPath)) {
    stage1 = JSON.parse(fs.readFileSync(paths.stage1ReportPath, 'utf8')) as Record<string, unknown>
  }
  if (fs.existsSync(paths.stage2ReportPath)) {
    stage2 = JSON.parse(fs.readFileSync(paths.stage2ReportPath, 'utf8')) as Record<string, unknown>
  }
  if (fs.existsSync(paths.controlledStabilityReportPath)) {
    experiment = JSON.parse(fs.readFileSync(paths.controlledStabilityReportPath, 'utf8')) as Record<string, unknown>
  }
  if (fs.existsSync(paths.manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8')) as Record<string, unknown>
  }
  const cuda = (report?.cuda ?? {}) as { name?: string; available?: boolean }
  const precision = (report?.precision ?? {}) as Record<string, string>
  return {
    ok: true,
    WRIM_ENVIRONMENT: report?.WRIM_ENVIRONMENT ?? 'UNKNOWN',
    WRIM_PYTORCH_PORT: report?.WRIM_PYTORCH_PORT ?? 'UNKNOWN',
    pytorch: (manifest?.torch as string | undefined) ?? (report?.software as { torch?: string } | undefined)?.torch,
    cuda_detected: Boolean(cuda.available),
    gpu: cuda.name ?? null,
    precision,
    stage0: report?.WRIM_PYTORCH_PORT ?? 'UNKNOWN',
    stage1: (stage1?.WRIM_STAGE1 as string | undefined) ?? STAGE1_STATUS,
    stage1_run_id: STAGE1_RUN_ID,
    stage2: (stage2?.WRIM_STAGE2 as string | undefined) ?? STAGE2_STATUS,
    stage2_run_id: STAGE2_RUN_ID,
    controlled_stability_experiment_id: CONTROLLED_STABILITY_EXPERIMENT_ID,
    phase0_status: PHASE0_STATUS,
    phase1_status: PHASE1_STATUS,
    phase2_status: PHASE2_STATUS,
    phase3a_status: PHASE3A_STATUS,
    phase2_experiment_id: PHASE2_EXPERIMENT_ID,
    stage3_run_id: STAGE3_RUN_ID,
    stage3_design_status: STAGE3_DESIGN_STATUS,
    stage3_authorization: STAGE3_AUTHORIZATION,
    stage3_execution_readiness: STAGE3_EXECUTION_READINESS,
    stage3_execution_review: STAGE3_EXECUTION_REVIEW,
    stage3_trainer_status: STAGE3_TRAINER_STATUS,
    stage3a_execution_readiness: STAGE3A_EXECUTION_READINESS,
    stage3b_execution_readiness: STAGE3B_EXECUTION_READINESS,
    stage3_eval_suite_id: STAGE3_EVAL_SUITE_ID,
    stage3_eval_suite_status: STAGE3_EVAL_SUITE_STATUS,
    stage3b_lr_formula: STAGE3B_LR_FORMULA,
    controlled_stability_decision: experiment?.decision ?? null,
    ready_for_stage3_design: experiment?.READY_FOR_STAGE3_DESIGN ?? 'NO',
    ready_for_stage3_training_authorization: false,
    train_button: false,
    training_authorization: TRAINING_AUTHORIZATION,
    current_training: CURRENT_WRIM_TRAINING,
    current_production_wrim: CURRENT_PRODUCTION_WRIM,
    rael: RAEL_STATUS,
    qwen: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    next_authorized_pass: NEXT_AUTHORIZED_PASS,
    stage1_authorized: STAGE1_AUTHORIZED,
    stopped: true,
    roadmap_22: ROADMAP_22_STATUS,
    roadmap_23: ROADMAP_23_STATUS,
    autonomy: truth.ASCENSION_AUTONOMY,
    report_present: Boolean(report),
    stage1_report_present: Boolean(stage1),
    stage2_report_present: Boolean(stage2),
    experiment_report_present: Boolean(experiment),
    phase0_report_present: fs.existsSync(paths.phase0ReportPath),
    manifest_present: Boolean(manifest),
  }
}

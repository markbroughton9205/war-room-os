import { getSovereignRuntimeTruth } from '@/lib/sovereign-runtime/runtimeTruth'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  NEXT_AUTHORIZED_PASS,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  TRAINING_AUTHORIZATION,
} from './identity'
import { resolveWrimEnvironmentPaths } from './paths'
import fs from 'node:fs'

export function wrimEnvironmentStatusPayload(dataDirOverride?: string | null) {
  const paths = resolveWrimEnvironmentPaths(dataDirOverride)
  const truth = getSovereignRuntimeTruth()
  let report: Record<string, unknown> | null = null
  let manifest: Record<string, unknown> | null = null
  if (fs.existsSync(paths.reportPath)) {
    report = JSON.parse(fs.readFileSync(paths.reportPath, 'utf8')) as Record<string, unknown>
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
    train_button: false,
    training_authorization: TRAINING_AUTHORIZATION,
    current_training: CURRENT_WRIM_TRAINING,
    current_production_wrim: CURRENT_PRODUCTION_WRIM,
    rael: RAEL_STATUS,
    qwen: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY',
    next_authorized_pass: NEXT_AUTHORIZED_PASS,
    stage1_authorized: false,
    roadmap_22: ROADMAP_22_STATUS,
    roadmap_23: ROADMAP_23_STATUS,
    autonomy: truth.ASCENSION_AUTONOMY,
    report_present: Boolean(report),
    manifest_present: Boolean(manifest),
  }
}

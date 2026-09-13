import fs from 'node:fs'
import path from 'node:path'
import {
  ensureLocalAppDataDirs,
  resolveLocalAppDataPaths,
} from '@/lib/sovereign-runtime/local-ownership/paths'

export type WrimEnvironmentPaths = {
  appRoot: string
  data: string
  root: string
  reportPath: string
  stage1ReportPath: string
  stage2ReportPath: string
  controlledStabilityReportPath: string
  phase0ReportPath: string
  phase1HarnessPath: string
  phase2ReportPath: string
    phase3aReportPath: string
    stage3EvalBaselinePath: string
    stage3DryRunReportPath: string
    stage3TrainDeniedPath: string
    stage3aReportPath: string
    stage3aReviewReportPath: string
    stage3aSelectionReportPath: string
    stage3aAdjudicationReportPath: string
    checkpointTestOnlyDir: string
    stage2CheckpointDir: string
    controlledStabilityCheckpointDir: string
    phase2GridCheckpointDir: string
    stage3DryRunCheckpointDir: string
    stage3aCheckpointDir: string
  manifestPath: string
  venvPython: string
  venvRoot: string
}

export function resolveWrimEnvironmentPaths(dataDirOverride?: string | null): WrimEnvironmentPaths {
  const app = resolveLocalAppDataPaths(dataDirOverride)
  ensureLocalAppDataDirs(app)
  const root = path.join(app.data, 'wrim-environment')
  const venvRoot = path.join(app.root, 'venvs', 'wrim-pytorch')
  return {
    appRoot: app.root,
    data: app.data,
    root,
    reportPath: path.join(root, 'stage0-report.json'),
    stage1ReportPath: path.join(root, 'stage1-report.json'),
    stage2ReportPath: path.join(root, 'stage2-report.json'),
    controlledStabilityReportPath: path.join(root, 'controlled-stability-report.json'),
    phase0ReportPath: path.join(root, 'phase0-report.json'),
    phase1HarnessPath: path.join(root, 'harness-determinism.json'),
    phase2ReportPath: path.join(root, 'phase2-report.json'),
    phase3aReportPath: path.join(root, 'phase3a-report.json'),
    stage3EvalBaselinePath: path.join(root, 'wrim-eval-s3-000001-wrim0-baseline.json'),
    stage3DryRunReportPath: path.join(root, 'stage3-dry-run.json'),
    stage3TrainDeniedPath: path.join(root, 'stage3-train-denied.json'),
    stage3aReportPath: path.join(root, 'stage3a-report.json'),
    stage3aReviewReportPath: path.join(root, 'stage3a-review.json'),
    stage3aSelectionReportPath: path.join(root, 'stage3a-candidate-selection.json'),
    stage3aAdjudicationReportPath: path.join(root, 'stage3a-candidate-adjudication.json'),
    checkpointTestOnlyDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-NEBULA-DIAG-000001'),
    stage2CheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-NEBULA-STAB-000001'),
    controlledStabilityCheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'controlled-stability'),
    phase2GridCheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'stability-grid-000001'),
    stage3DryRunCheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-RUN-000003', 'dry-run'),
    stage3aCheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-RUN-000003', 'STAGE3A'),
    manifestPath: path.join(root, 'environment-manifest.json'),
    venvRoot,
    venvPython: path.join(venvRoot, 'Scripts', 'python.exe'),
  }
}

export function ensureWrimEnvironmentDirs(paths: WrimEnvironmentPaths): void {
  fs.mkdirSync(paths.root, { recursive: true })
  fs.mkdirSync(path.dirname(paths.checkpointTestOnlyDir), { recursive: true })
}

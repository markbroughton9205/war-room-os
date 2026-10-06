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
    run000006PreflightReportPath: string
    run000006ConfigPath: string
    run000006UnsignedConfigPath: string
    run000006CheckpointDir: string
    run000007PreflightReportPath: string
    run000007ConfigPath: string
    run000007UnsignedConfigPath: string
    run000007FilterManifestPath: string
    run000007CheckpointDir: string
    linuxVenvRoot: string
    linuxVenvPython: string
  /**
   * Foundational remediation pass (Stage 3A corrective, foundational P1/P2, retention forensics, sovereign lab).
   * These locations were referenced by status.ts, the run-wrim-*.mjs runners and their validations but never defined here.
   * Verified against their consumers: the runners hand every report/output path to the Python scripts as an argument (so the name is
   * chosen here and nothing else hardcodes it), sovereign-lab-report.json and foundational-root-cause.json match names the Python
   * scripts and docs already use, and the two checkpoint directories are the runs the code names (WRIM1-RUN-000004 corrective,
   * WRIM1-RUN-000005 P2). Layout follows the existing fields: reports and output directories under `root`, checkpoints under
   * wrim-checkpoints/test-only.
   */
  stage3aCorrectiveCheckpointDir: string
  stage3aCorrectiveDesignReportPath: string
  stage3aCorrectiveReportPath: string
  foundationalRootCauseReportPath: string
  foundationalRemediationDesignReportPath: string
  foundationalP1Dir: string
  foundationalP1ReportPath: string
  foundationalP1RefineDir: string
  foundationalP1RefineReportPath: string
  foundationalP1SovereignDir: string
  foundationalP1SovereignReportPath: string
  foundationalP2Dir: string
  foundationalP2ReportPath: string
  foundationalP2RecipeDir: string
  foundationalP2RecipeReportPath: string
  foundationalP2RootCauseDir: string
  foundationalP2RootCauseReportPath: string
  /** Checkpoint directory of the frozen P2 recipe run (WRIM1-RUN-000005). Never the recipe directory itself. */
  foundationalP2TrainDir: string
  foundationalP2TrainReportPath: string
  p2NextARecipeDir: string
  p2NextARecipeReportPath: string
  retentionBreakForensicDir: string
  retentionBreakForensicReportPath: string
  retentionRepairExperimentsDir: string
  retentionRepairExperimentsReportPath: string
  sovereignLabReportPath: string
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
    run000006PreflightReportPath: path.join(root, 'wrim1-run-000006-pretraining-gate.json'),
    run000006ConfigPath: path.join(root, 'WRIM1-RUN-000006-TRAINING-CONFIG-000001.json'),
    run000006UnsignedConfigPath: path.join(root, 'WRIM1-RUN-000006-TRAINING-CONFIG-000001.unsigned.json'),
    run000006CheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-RUN-000006'),
    run000007PreflightReportPath: path.join(root, 'wrim1-run-000007-pretraining-gate.json'),
    run000007ConfigPath: path.join(root, 'WRIM1-RUN-000007-TRAINING-CONFIG-000001.json'),
    run000007UnsignedConfigPath: path.join(root, 'WRIM1-RUN-000007-TRAINING-CONFIG-000001.unsigned.json'),
    run000007FilterManifestPath: path.join(root, 'WRIM1-RUN-000007-FILTER-MANIFEST-000001.json'),
    run000007CheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-RUN-000007'),
    linuxVenvRoot: path.join(app.root, 'venvs', 'wrim-pytorch-linux'),
    linuxVenvPython: path.join(app.root, 'venvs', 'wrim-pytorch-linux', 'bin', 'python'),
    stage3aCorrectiveCheckpointDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-RUN-000004'),
    stage3aCorrectiveDesignReportPath: path.join(root, 'stage3a-corrective-design.json'),
    stage3aCorrectiveReportPath: path.join(root, 'stage3a-corrective-report.json'),
    foundationalRootCauseReportPath: path.join(root, 'foundational-root-cause.json'),
    foundationalRemediationDesignReportPath: path.join(root, 'foundational-remediation-design.json'),
    foundationalP1Dir: path.join(root, 'foundational-p1'),
    foundationalP1ReportPath: path.join(root, 'foundational-p1-report.json'),
    foundationalP1RefineDir: path.join(root, 'foundational-p1-refine'),
    foundationalP1RefineReportPath: path.join(root, 'foundational-p1-refine-report.json'),
    foundationalP1SovereignDir: path.join(root, 'foundational-p1-sovereign'),
    foundationalP1SovereignReportPath: path.join(root, 'foundational-p1-sovereign-report.json'),
    foundationalP2Dir: path.join(root, 'foundational-p2'),
    foundationalP2ReportPath: path.join(root, 'foundational-p2-report.json'),
    foundationalP2RecipeDir: path.join(root, 'foundational-p2-recipe'),
    foundationalP2RecipeReportPath: path.join(root, 'foundational-p2-recipe-report.json'),
    foundationalP2RootCauseDir: path.join(root, 'foundational-p2-root-cause'),
    foundationalP2RootCauseReportPath: path.join(root, 'foundational-p2-root-cause-report.json'),
    foundationalP2TrainDir: path.join(app.data, 'wrim-checkpoints', 'test-only', 'WRIM1-RUN-000005'),
    foundationalP2TrainReportPath: path.join(root, 'foundational-p2-train-report.json'),
    p2NextARecipeDir: path.join(root, 'p2-next-a-recipe'),
    p2NextARecipeReportPath: path.join(root, 'p2-next-a-recipe-report.json'),
    retentionBreakForensicDir: path.join(root, 'retention-break-forensic'),
    retentionBreakForensicReportPath: path.join(root, 'retention-break-forensic-report.json'),
    retentionRepairExperimentsDir: path.join(root, 'retention-repair-experiments'),
    retentionRepairExperimentsReportPath: path.join(root, 'retention-repair-experiments-report.json'),
    sovereignLabReportPath: path.join(root, 'sovereign-lab-report.json'),
    manifestPath: path.join(root, 'environment-manifest.json'),
    venvRoot,
    // The interpreter of the environment this machine builds: the Windows venv layout on Windows, the Linux venv (linuxVenvPython) elsewhere.
    venvPython: process.platform === 'win32' ? path.join(venvRoot, 'Scripts', 'python.exe') : path.join(app.root, 'venvs', 'wrim-pytorch-linux', 'bin', 'python'),
  }
}

export function ensureWrimEnvironmentDirs(paths: WrimEnvironmentPaths): void {
  fs.mkdirSync(paths.root, { recursive: true })
  fs.mkdirSync(path.dirname(paths.checkpointTestOnlyDir), { recursive: true })
}

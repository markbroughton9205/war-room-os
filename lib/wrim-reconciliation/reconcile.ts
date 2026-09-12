import fs from 'node:fs'
import path from 'node:path'
import { sha256File } from '@/lib/wr-corpus/hashes'
import { defaultRecoveryDumpRoot, readDumpVerification } from '@/lib/wr-corpus/recoverySource'
import { recoverWrim0Architecture, tokenizerBindingOk } from './architecture'
import { estimateTrainingBudget } from './budget'
import { classifyCheckpointCompatibility, MLX_MAC_DEPENDENCIES } from './compatibility'
import { collapseRootCauseTree } from './collapse'
import { inventoryEvalSuites } from './evalSuites'
import {
  AUTONOMY_POLICY,
  CHECKPOINT_STORAGE_PLAN,
  EXPERIMENT_GOVERNANCE,
  FAILURE_STOP_CONDITIONS,
  PROMOTION_POLICY,
} from './governance'
import { probeNebulaHardware } from './hardware'
import {
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  DENSE_BASELINE_REQUIRED,
  HISTORICAL_WRIM_0_SHA256,
  HISTORICAL_WRIM_0_STATUS,
  HISTORICAL_WRIM_1_RUN_000001_STATUS,
  HISTORICAL_WRIM_1_RUN_000002_STATUS,
  HISTORICAL_WRIM_1_STATUS,
  RAEL_STATUS,
  TRAINING_AUTHORIZATION,
  WRIM_CONTINUATION_RECOMMENDATION,
  WRIM_RECONCILIATION,
} from './identity'
import { isolatedWrim0InferenceSmoke } from './inference'
import { inventoryHistoricalWrim } from './inventory'
import { checkDataLeakage } from './leakage'
import { mapTrainingDataLineage } from './lineage'
import { dumpWrim0EvalResults, dumpWrim0FinalSidecar, dumpWrim0FinalWeights, dumpWrim1FinalModel, dumpWrim1OfficialDir, ensureWrimReconciliationDirs, resolveWrimReconciliationPaths } from './paths'
import { liveRecoveryListing, RECOVERY_EXPERIMENTS, reusableRecoveryMechanisms } from './recovery'
import { inspectSafetensorsHeader } from './safetensors'
import { openSourceMechanismState, sparseExpertEvolutionAudit } from './sparse'
import { probeNebulaMlStack } from './stack'

export async function runWrimReconciliation(opts?: {
  dumpRoot?: string | null
  dataDirOverride?: string | null
  skipInference?: boolean
}) {
  const dumpRoot = defaultRecoveryDumpRoot(opts?.dumpRoot)
  const dumpVerify = await readDumpVerification(dumpRoot)
  const wrim0Path = dumpWrim0FinalWeights(dumpRoot)
  const wrim0Hash = await sha256File(wrim0Path)
  const wrim0Inspect = inspectSafetensorsHeader(wrim0Path)
  const wrim0Sidecar = JSON.parse(fs.readFileSync(dumpWrim0FinalSidecar(dumpRoot), 'utf8')) as {
    step?: number
    tokensSeen?: number
    parameterCount?: number
    peakLr?: number
    weightsSha256?: string
  }
  const arch = recoverWrim0Architecture(dumpRoot)
  let wrim0Eval: Record<string, unknown> | null = null
  const evalPath = dumpWrim0EvalResults(dumpRoot)
  if (fs.existsSync(evalPath)) wrim0Eval = JSON.parse(fs.readFileSync(evalPath, 'utf8')) as Record<string, unknown>
  const wrim1Path = dumpWrim1FinalModel(dumpRoot)
  const wrim1Inspect = fs.existsSync(wrim1Path) ? inspectSafetensorsHeader(wrim1Path) : null
  const wrim1_000002_model = path.join(
    dumpWrim1OfficialDir(dumpRoot),
    'checkpoint-step-000100',
    'model.safetensors',
  )
  const wrim1bInspect = fs.existsSync(wrim1_000002_model) ? inspectSafetensorsHeader(wrim1_000002_model) : null
  const hardware = probeNebulaHardware()
  const stack = probeNebulaMlStack()
  const inventory = inventoryHistoricalWrim(dumpRoot)
  const lineage = mapTrainingDataLineage(dumpRoot)
  const evalSuites = inventoryEvalSuites(dumpRoot)
  const leakage = checkDataLeakage(dumpRoot)
  const inference = opts?.skipInference
    ? {
        attempted: false,
        feasibleWithoutConversion: false,
        conversionRequired: 'skipped',
        ok: false,
        detail: 'skipped',
        wroteWeights: false as const,
      }
    : isolatedWrim0InferenceSmoke({ dumpRoot, dataDirOverride: opts?.dataDirOverride })
  const compatibility = classifyCheckpointCompatibility({
    wrim0HashMatch: wrim0Hash === HISTORICAL_WRIM_0_SHA256,
    wrim0Embedding: wrim0Inspect.embedding?.shape ?? null,
    wrim1Embedding: wrim1Inspect?.embedding?.shape ?? null,
    wrim0HasLmHead: Boolean(wrim0Inspect.lmHead),
    wrim1HasLmHead: Boolean(wrim1Inspect?.lmHead),
    mlxPresent: stack.packages.mlx !== 'NOT_PRESENT',
    torchPresent: stack.packages.torch !== 'NOT_PRESENT',
  })
  const report = {
    WRIM_RECONCILIATION,
    recommendation: WRIM_CONTINUATION_RECOMMENDATION,
    recommendationReasons: [
      'WRIM-0 checkpoint identity and SHA-256 are intact. Lineage is usable — D is not justified.',
      'Collapse of WRIM-1 RUN-000001 is packing/data, not architecture. Do not start a new native family.',
      'WRIM-1 RUN-000002 already rebuilt from WRIM-0 with contiguous packing and still FAIL vs WRIM-0 due to capability/tool mix — so the next official run must rebuild WRIM-1 training correctly, not merely resume WRIM-0 genesis smoke.',
      'Recovery-006/007/010 show reusable LR=3e-5 + interleaved rehearsal + tool-use isolation. Those belong in a WRIM-1 rebuild from WRIM-0, not a WRIM-2 architecture jump.',
      'Sparse-expert streaming is future work. Dense baseline must be reproduced on Nebula CUDA first.',
    ],
    dump: { status: dumpVerify.status, files: dumpVerify.files, bytes: dumpVerify.bytes, productionModified: dumpVerify.productionModified },
    wrim0: {
      id: 'WRIM-0',
      status: HISTORICAL_WRIM_0_STATUS,
      hash: wrim0Hash,
      hashMatch: wrim0Hash === HISTORICAL_WRIM_0_SHA256,
      sidecarHash: wrim0Sidecar.weightsSha256,
      step: wrim0Sidecar.step,
      tokensSeen: wrim0Sidecar.tokensSeen,
      parameterCount: wrim0Sidecar.parameterCount,
      peakLr: wrim0Sidecar.peakLr,
      inspect: {
        tensorCount: wrim0Inspect.tensorCount,
        modelTensorCount: wrim0Inspect.modelTensorCount,
        optTensorCount: wrim0Inspect.optTensorCount,
        dtypes: wrim0Inspect.dtypes,
        embedding: wrim0Inspect.embedding,
        lmHead: wrim0Inspect.lmHead,
        pickleKeys: wrim0Inspect.pickleKeys,
      },
      architecture: arch,
      tokenizerBound: tokenizerBindingOk(arch),
      historicalEval: wrim0Eval
        ? {
            trainLossFinalEma: 4.5181,
            trainLossLastRaw: 4.8331,
            valLoss: 8.7304,
            valPerplexity: 6188,
            greedyRepetitionCollapsed: true,
            jsonValid: false,
            toolBehavior: 'not acquired; special-token probes often tokenizer-loop',
            reasoningBehavior: 'not measured (MMLU not run)',
            knownLimitations: 'Genesis-weak LM; train/val gap; greedy tokenizer-run; not a production model',
            source: 'GENESIS_REPORT.md + wrim0_eval_results.json',
          }
        : 'INCOMPLETE',
    },
    wrim1_run_000001: {
      runId: 'WRIM1-RUN-000001',
      status: HISTORICAL_WRIM_1_RUN_000001_STATUS,
      architecture: 'WRIM-G-20M-v1-option-A',
      parameterCount: 19217152,
      hiddenSize: 256,
      layerCount: 18,
      attentionHeads: 4,
      ffnSize: 768,
      contextLength: 512,
      tokenizer: 'WR-TOKENIZER-0',
      corpus: 'WR-CORPUS-1-HARDENED',
      optimizer: 'AdamW',
      learningRate: 'peak 0.003, warmup 50, cosine to 10% floor',
      batchSize: 8,
      gradientAccumulation: 1,
      precision: 'fp32',
      trainingFramework: 'MLX',
      hardware: 'MacBookPro17,1 arm64 8GB Metal',
      stepsCompleted: 1893,
      tokensSeen: 7753728,
      checkpointCount: 10,
      bestCheckpoint: 'checkpoint-step-001893',
      finalCheckpoint: 'checkpoint-step-001893',
      evaluation: 'PROMOTION_REJECTED; greedy period collapse; held-out contaminated',
      promotionStatus: 'REJECTED',
      inspect: wrim1Inspect
        ? {
            tensorCount: wrim1Inspect.tensorCount,
            dtypes: wrim1Inspect.dtypes,
            embedding: wrim1Inspect.embedding,
            lmHead: wrim1Inspect.lmHead,
          }
        : null,
    },
    wrim1_run_000002: {
      runId: 'WRIM1-RUN-000002',
      status: HISTORICAL_WRIM_1_RUN_000002_STATUS,
      stepsCompleted: 100,
      stepsPlanned: 502,
      tokensSeen: 409600,
      peakLr: 3e-5,
      corpus: 'WR-CORPUS-1.1-CAPABILITY-CANDIDATE',
      promotionStatus: 'REJECTED',
      whyUnderperformed:
        'Not the 000001 shuffle bug. Contiguous packing held. Stopped at 4/13 collapse vs WRIM-0 2/13; CAP-EVAL-0 19/86 vs 18/86 with RETENTION 6/6→5/6. Tool-use isolation (Recovery-010) later showed the capability mix as the stronger suspect.',
      inspect: wrim1bInspect
        ? { tensorCount: wrim1bInspect.tensorCount, embedding: wrim1bInspect.embedding }
        : null,
    },
    historicalWrim1Status: HISTORICAL_WRIM_1_STATUS,
    recovery: {
      lane: 'TEST_ONLY',
      listing: liveRecoveryListing(dumpRoot),
      experiments: RECOVERY_EXPERIMENTS,
      reusable: reusableRecoveryMechanisms().map(e => e.id),
    },
    lineage,
    compatibility,
    mlxMac: MLX_MAC_DEPENDENCIES,
    hardware,
    stack,
    inference,
    collapse: collapseRootCauseTree(),
    sparse: sparseExpertEvolutionAudit(),
    mechanisms: openSourceMechanismState(),
    evalSuites,
    leakage,
    budget: estimateTrainingBudget(hardware),
    denseBaselineRequired: DENSE_BASELINE_REQUIRED,
    promotion: PROMOTION_POLICY,
    storage: CHECKPOINT_STORAGE_PLAN,
    governance: EXPERIMENT_GOVERNANCE,
    stopConditions: FAILURE_STOP_CONDITIONS,
    autonomy: AUTONOMY_POLICY,
    runtime: {
      CURRENT_PRODUCTION_WRIM,
      CURRENT_WRIM_TRAINING,
      RAEL: RAEL_STATUS,
      TRAINING_AUTHORIZATION,
    },
    inventory,
  }
  const paths = resolveWrimReconciliationPaths(opts?.dataDirOverride)
  ensureWrimReconciliationDirs(paths)
  fs.writeFileSync(paths.reportPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(
    paths.inspectPath,
    JSON.stringify(
      { wrim0: wrim0Inspect, wrim1: wrim1Inspect, wrim1_000002: wrim1bInspect, pickleUsed: false },
      null,
      2,
    ),
  )
  fs.writeFileSync(paths.inferenceSmokePath, JSON.stringify(inference, null, 2))
  return { report, paths, wrim0Hash }
}

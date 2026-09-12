import fs from 'node:fs'
import { sha256File } from '@/lib/wr-corpus/hashes'
import { HARDENED_EXPECTED_SHARD_HASHES, WRM001_EXPECTED_HASHES } from '@/lib/wr-corpus/recoverySource'
import { dumpTokenizerPath, rehashDumpTokenizer } from '@/lib/wr-tokenizer/inspect'
import { recoverWrim0Architecture, tokenizerBindingOk } from '@/lib/wrim-reconciliation/architecture'
import { inspectSafetensorsHeader } from '@/lib/wrim-reconciliation/safetensors'
import { dumpWrim0FinalWeights } from '@/lib/wrim-reconciliation/paths'
import { CHECKPOINT_POLICY, DISK_QUOTA, EXPERIMENT_MANIFEST_FIELDS, RETENTION_POLICY, SECURITY_GOVERNANCE } from './checkpoints'
import { CORPUS_MIX, EVAL_SUITE_PLAN, TRAIN_VAL_SPLIT } from './corpusMix'
import { COLLAPSE_MONITORING, PERIOD_COLLAPSE_SENTINEL, PROMOTION_GATES, RETENTION_GATE } from './gates'
import {
  ARCHITECTURE_FAMILY,
  CURRENT_PRODUCTION_WRIM,
  CURRENT_WRIM_TRAINING,
  MOE_THIS_PASS,
  NEXT_AUTHORIZED_PASS,
  PARENT_MODEL_ID,
  PARENT_SHA256,
  RAEL_STATUS,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  SPARSE_STREAMING_THIS_PASS,
  STAGE3_OFFICIAL_RUN_ID,
  TOKENIZER_ID,
  TOKENIZER_SHA256,
  TRAINING_AUTHORIZATION,
  WRIM_REBUILD_DESIGN,
  WRIM_REBUILD_DESIGN_DECISION,
  WRIM_RECONCILIATION,
  wrimRebuildDesignTruthNotes,
} from './identity'
import { BENCHMARK_PLAN, INITIALIZATION, SOFTWARE_INSTALL_PLAN } from './installPlan'
import { LR_SCHEDULE, OPTIMIZER_DESIGN } from './optimizer'
import { PACKING_ALGORITHM } from './packing'
import { NUMERICAL_EQUIVALENCE, PLANNED_STACK, PYTORCH_PORT } from './pytorchPort'
import { ensureWrimRebuildDesignDirs, resolveWrimRebuildDesignPaths } from './paths'
import { BATCH_PLAN, PRECISION_PLAN, REPRODUCIBILITY, STAGE_PLAN } from './stages'
import { expectedModelTensorCount, lmHeadPolicy, optimizerKeysPolicy, plannedWeightMap, verifyInspectedShapes } from './weightMapping'

export async function runWrimRebuildDesign(opts?: { dumpRoot?: string | null; dataDirOverride?: string | null }) {
  const paths = resolveWrimRebuildDesignPaths(opts?.dataDirOverride)
  ensureWrimRebuildDesignDirs(paths)
  const wrim0Path = dumpWrim0FinalWeights(opts?.dumpRoot)
  const wrim0MtimeBefore = fs.statSync(wrim0Path).mtimeMs
  const parentSha = await sha256File(wrim0Path)
  const tokenizer = await rehashDumpTokenizer(opts?.dumpRoot)
  const inspect = inspectSafetensorsHeader(wrim0Path)
  const shapeCheck = verifyInspectedShapes(inspect.tensors)
  const arch = recoverWrim0Architecture(opts?.dumpRoot)
  const parentOk = parentSha === PARENT_SHA256
  const tokenizerOk = tokenizer.sha256 === TOKENIZER_SHA256 && tokenizer.match
  const decision = parentOk && tokenizerOk && shapeCheck.ok ? WRIM_REBUILD_DESIGN_DECISION : 'DESIGN_BLOCKED'
  const blockers: string[] = []
  if (!parentOk) blockers.push(`parent SHA mismatch expected ${PARENT_SHA256} got ${parentSha}`)
  if (!tokenizerOk) blockers.push(`tokenizer SHA mismatch expected ${TOKENIZER_SHA256} got ${tokenizer.sha256}`)
  if (!shapeCheck.ok) blockers.push(`weight mapping shape mismatch: ${shapeCheck.mismatches.slice(0, 8).join('; ')}`)

  const report = {
    WRIM_REBUILD_DESIGN,
    decision,
    nextAuthorizedPass: decision === WRIM_REBUILD_DESIGN_DECISION ? NEXT_AUTHORIZED_PASS : 'RESOLVE_DESIGN_BLOCKER',
    executed: {
      installation: false,
      conversion: false,
      training: false,
      promotion: false,
      rael: false,
      push: false,
      deploy: false,
    },
    parent: {
      id: PARENT_MODEL_ID,
      file: wrim0Path,
      sha256: parentSha,
      expected: PARENT_SHA256,
      match: parentOk,
      readOnly: true,
      mtimeUnchanged: fs.statSync(wrim0Path).mtimeMs === wrim0MtimeBefore,
      tensors: inspect.modelTensorCount,
      optTensorsIgnored: inspect.optTensorCount,
    },
    tokenizer: {
      id: TOKENIZER_ID,
      path: dumpTokenizerPath(opts?.dumpRoot),
      sha256: tokenizer.sha256,
      expected: TOKENIZER_SHA256,
      match: tokenizerOk,
      frozen: true,
      trainTokenizer1: false,
    },
    architecture: {
      family: ARCHITECTURE_FAMILY,
      dense: true,
      moe: MOE_THIS_PASS,
      sparseStreaming: SPARSE_STREAMING_THIS_PASS,
      bindingOk: tokenizerBindingOk(arch),
      details: arch,
    },
    pytorchPort: PYTORCH_PORT,
    plannedStack: PLANNED_STACK,
    weightMapping: {
      count: expectedModelTensorCount(),
      lmHead: lmHeadPolicy(),
      optimizerKeys: optimizerKeysPolicy(),
      shapeCheck,
      sample: plannedWeightMap().slice(0, 6),
    },
    optimizer: OPTIMIZER_DESIGN,
    lrSchedule: LR_SCHEDULE,
    packing: PACKING_ALGORITHM,
    corpusMix: CORPUS_MIX,
    trainVal: TRAIN_VAL_SPLIT,
    evalSuites: EVAL_SUITE_PLAN,
    corpusHashes: {
      wrCorpus0Jsonl: WRM001_EXPECTED_HASHES['corpus.jsonl'],
      wrCorpus1Train: HARDENED_EXPECTED_SHARD_HASHES['train/shard-00000.jsonl'],
      wrCorpus1Val: HARDENED_EXPECTED_SHARD_HASHES['validation/shard-00000.jsonl'],
    },
    runIds: STAGE_PLAN,
    initialization: INITIALIZATION,
    precision: PRECISION_PLAN,
    batch: BATCH_PLAN,
    equivalence: NUMERICAL_EQUIVALENCE,
    stages: STAGE_PLAN,
    collapseMonitoring: COLLAPSE_MONITORING,
    periodCollapseSentinel: PERIOD_COLLAPSE_SENTINEL,
    retentionGate: RETENTION_GATE,
    checkpoints: CHECKPOINT_POLICY,
    retentionPolicy: RETENTION_POLICY,
    diskQuota: DISK_QUOTA,
    experimentManifest: EXPERIMENT_MANIFEST_FIELDS,
    reproducibility: REPRODUCIBILITY,
    promotionGates: PROMOTION_GATES,
    installPlan: SOFTWARE_INSTALL_PLAN,
    benchmarkPlan: BENCHMARK_PLAN,
    security: SECURITY_GOVERNANCE,
    officialRunId: STAGE3_OFFICIAL_RUN_ID,
    currentProductionWrim: CURRENT_PRODUCTION_WRIM,
    currentTraining: CURRENT_WRIM_TRAINING,
    trainingAuthorization: TRAINING_AUTHORIZATION,
    rael: RAEL_STATUS,
    wrimReconciliation: WRIM_RECONCILIATION,
    roadmap22: ROADMAP_22_STATUS,
    roadmap23: ROADMAP_23_STATUS,
    notes: wrimRebuildDesignTruthNotes(),
    blockers,
  }

  fs.writeFileSync(paths.reportPath, JSON.stringify(report, null, 2), 'utf8')
  return { paths, report, parentSha, tokenizerSha: tokenizer.sha256, wrim0MtimeBefore }
}

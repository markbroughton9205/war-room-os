import { TOOL_USE_POLICY } from './identity'

/**
 * Rebuild mix from canonical WR-CORPUS lineage.
 * WR-CORPUS-ACTIVE is not auto-included. TOOL_USE is excluded.
 * Percentages copy the first stable Recovery-006/007 recipe (TEST_ONLY evidence).
 */
export const CORPUS_MIX = {
  mainCorpus: 'WR-CORPUS-1 (canonical lineage of WR-CORPUS-1-HARDENED train shard, eval-infra stripped)',
  rehearsalCorpus: 'WR-CORPUS-0 (canonical lineage of WRM-001 / corpus.jsonl train split)',
  activeCorpus: 'WR-CORPUS-ACTIVE excluded unless a record has training_eligibility === ELIGIBLE',
  rightsGate:
    'Historical records are HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT, not modern ELIGIBLE. Stage 3 official training requires an explicit Commander grant naming WR-CORPUS-0 rehearsal + WR-CORPUS-1 main for WRIM1-RUN-000003. Stages 0–2 do not consume ACTIVE. Stage 0 uses no corpus.',
  percentages: {
    wrCorpus0Rehearsal: 30.0,
    wrCorpus1Prose: 34.1,
    wrCorpus1Code: 25.6,
    wrCorpus1Json: 8.6,
    wrCorpus1BehaviorNonTool: 1.7,
    capabilitySupervised: 0,
    toolUse: 0,
    wrCorpusActive: 0,
  },
  rehearsal: {
    fraction: 0.3,
    frequency: 'Every packed stream, interleaved by deficit windows — not a binge-then-rehearse epoch.',
    goal: 'Retain WRIM-0 genesis capabilities while learning WR-CORPUS-1.',
    evidence: 'Recovery-006/007 PASS with ~30% WR-CORPUS-0. RUN-000001 had no rehearsal (POSSIBLE_CAUSE).',
  },
  toolUse: {
    policy: TOOL_USE_POLICY,
    reason:
      'Recovery-010 PASS replaced TOOL_USE windows with rehearsal and held DIAGNOSTIC-0. Recovery-011 compact TOOL_USE V2 from WRIM-0 failed at step 120. First dense baseline excludes tool curriculum. A later isolated tool phase would need its own run ID after the dense baseline is stable.',
    isolatedPhaseThisPass: false,
  },
  capabilityData: {
    include: false,
    reason: 'WRIM1-RUN-000002 mixed capability/tool curriculum and failed vs WRIM-0 (stop 4/13 vs 2/13, retention 6/6→5/6). Recovery-008 (same capability stream) failed. Keep capability data out of the first stable baseline.',
  },
  exclusions: [
    'WRIM-0 genesis eval prompts as training rows',
    'DIAGNOSTIC-0',
    'CAP-EVAL-0',
    'TOOL-EVAL-1 / WR-TOOL-EVAL-2 / WR-TOOL-EVAL-3',
    'Wave 8.1 leakage-contaminated held-out',
    'WR-CORPUS-1-HARDENED test shard',
    'eval-infra source files (heldOut.ts / eval.ts / behavior.ts / GENESIS_REPORT class)',
    'TOOL_USE supervised windows',
    'WR-CORPUS-ACTIVE REQUIRES_REVIEW records',
  ],
}

export const TRAIN_VAL_SPLIT = {
  train: [
    'WR-CORPUS-1-HARDENED train/shard-00000.jsonl (8477 records) after eval-infra + tool + eval-only exclusion',
    'WR-CORPUS-0 / WRM-001 corpus.jsonl train split (documentId-sorted, same 5% val cut as prepare_wrim0_shards.py)',
  ],
  validation: [
    'WR-CORPUS-1-HARDENED validation/shard-00000.jsonl (1853 records) — contiguous packed windows, not shuffled',
    'WR-CORPUS-0 val documents from the same deterministic split',
  ],
  neverTrain: [
    'WR-CORPUS-1-HARDENED test/shard-00000.jsonl',
    'model-lab/eval-only/**',
    'Wave 8.1 held-out',
    'DIAGNOSTIC-0 / CAP-EVAL-0 / tool evals',
  ],
  leakageScanRequired: true,
  leakageScanWhen: 'After packing materialization, before Stage 1 step 1. Substring + token-window scan vs eval-only suites. Hidden eval contamination = STOP.',
}

export const EVAL_SUITE_PLAN = {
  keepOutOfTraining: true,
  suites: [
    { id: 'WRIM-0-GENESIS-EVAL', role: 'retention / calibration; disclosed WR-CORPUS-0 literary overlap' },
    { id: 'DIAGNOSTIC-0', role: 'collapse probes every eval interval; not a capability claim' },
    { id: 'CAP-EVAL-0', role: 'held-out capability; EXCLUDE_FROM_TRAINING' },
    { id: 'TOOL-EVAL-1', role: 'tool held-out; expect ~0/10 on dense baseline; do not train on it' },
    { id: 'WR-TOOL-EVAL-2', role: 'modular tool-head eval; not dense LM training' },
    { id: 'WR-TOOL-EVAL-3', role: 'modular tool eval; not dense LM training' },
  ],
  wave81: 'INCOMPATIBLE for clean held-out. Leakage-contaminated. Do not use as a promotion metric.',
}

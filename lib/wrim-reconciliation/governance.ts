export const PROMOTION_POLICY = {
  parentFloor: 'WRIM-0 checkpoint-final remains the historical baseline. Training longer does not promote.',
  requiredDimensions: [
    'no collapse vs WRIM-0 diagnostic probes',
    'validation loss on contiguous (non-shuffled) windows',
    'perplexity on held-out that is not train-contaminated',
    'generation diversity (unique-token ratio)',
    'repetition / max-run',
    'held-out evaluation (CAP-EVAL-0 or successor)',
    'factual retrieval use',
    'tool-format handling',
    'reasoning probes',
    'memory/runtime efficiency on Nebula',
    'stability across reload',
  ],
  rule: 'No single metric determines promotion. A candidate must beat WRIM-0 on several dimensions without violating collapse/retention gates.',
  forbidden: [
    'Promote because parameter count or step count is larger',
    'Promote collapsed or FAIL official runs',
    'Promote TEST_ONLY recovery checkpoints',
    'Replace WRIM-0 in-place',
  ],
}

export const CHECKPOINT_STORAGE_PLAN = {
  root: '%LOCALAPPDATA%\\War Room OS\\data\\wrim-checkpoints\\',
  lanes: ['official/', 'experiments/', 'test-only/', 'rejected/', 'promoted/'],
  rules: [
    'Never store checkpoints in git or the install directory.',
    'Never copy the 19.5GB Mac recovery dump into active runtime.',
    'Never delete historical Mac dump artifacts.',
    'official/: Commander-authorized named runs only.',
    'experiments/: bounded TEST_ONLY with quota.',
    'test-only/: recovery/diagnostic; not promotable.',
    'rejected/: FAIL/COLLAPSED preserved for forensics with retention cap.',
    'promoted/: only after multi-dimension promotion policy; at most one current + previous.',
  ],
  retention: {
    officialComplete: 'keep final + best + step-0 parent proof',
    experiments: 'keep summaries + at most 2 weight snapshots per run; delete extras after report',
    testOnly: 'summaries always; weights optional and quota-capped (e.g. 4 GB total)',
    rejected: 'keep one collapsed snapshot + metrics; do not keep full cadence trees',
    promoted: 'immutable until Commander replaces',
    quotaStop: 'STOP training if free disk on checkpoint volume < 32 GB or lane quota exceeded',
  },
}

export const EXPERIMENT_GOVERNANCE = {
  kinds: ['OFFICIAL_RUN', 'TEST_ONLY', 'DIAGNOSTIC', 'RECOVERY', 'PROMOTED'],
  requiredRecord: [
    'run ID',
    'parent checkpoint',
    'corpus',
    'tokenizer',
    'architecture',
    'hyperparameters',
    'seed',
    'environment',
    'hardware',
    'start/end',
    'tokens seen',
    'metrics',
    'verdict',
    'promotion status',
  ],
  materialChangeRequiresNewRunId: true,
}

export const FAILURE_STOP_CONDITIONS = {
  stopTraining: [
    'loss NaN/Inf',
    'severe repetition collapse (diagnostic collapsed probes materially exceed WRIM-0 floor)',
    'entropy collapse to near-dirac',
    'gradient explosion / clip storm beyond recorded threshold',
    'checkpoint corruption / hash mismatch',
    'validation deterioration beyond threshold vs step-0 parent',
    'disk quota risk',
  ],
  afterStop: 'STOP only. Do not auto-start another run. Do not auto-resume. Await Commander authorization.',
}

export const AUTONOMY_POLICY = {
  trainingBegins: 'only with explicit Commander authorization',
  backgroundRetraining: false,
  autoResume: false,
  selfDirectedExperiments: false,
  trainButton: false,
}

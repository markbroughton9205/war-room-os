import { CHECKPOINT_LANES, CHECKPOINT_ROOT, DISK_STOP_GB, DISK_WARN_GB } from './identity'

export const CHECKPOINT_POLICY = {
  root: CHECKPOINT_ROOT,
  lanes: CHECKPOINT_LANES,
  git: false,
  copyMacRecoveryTree: false,
  parentReadOnly: 'Historical WRIM-0 checkpoint-final.safetensors stays in the Mac dump. Load by path; do not copy the 19.5GB tree; do not overwrite the parent file.',
  write: {
    official: 'WRIM1-RUN-000003 only after Stage 0–2 PASS + Commander authorization',
    experiments: 'unused in this baseline unless Commander opens a named experiment',
    testOnly: 'Stage 0–2 run artifacts',
    rejected: 'any STOP/FAIL snapshot + metrics',
    promoted: 'empty until multi-dimension promotion; at most current + previous',
  },
}

export const RETENTION_POLICY = {
  stage1: 'Keep latest diagnostic checkpoint after verdict. Delete other Stage 1 intermediates.',
  stage2: 'Keep latest + best-validation. Delete other intermediates after Stage 2 verdict.',
  stage3: 'Keep step-0 parent-load proof, milestones 150/500/1000/1500 if reached, best-validation, final. Delete disposable in-between after the run verdict.',
  neverDelete: [
    'Mac recovery dump',
    'historical WRIM-0 / WRIM-1 dump checkpoints',
    'promoted/ weights',
    'best-validation of an official run until Commander replaces policy',
  ],
  autoDeletePromoted: false,
}

export const DISK_QUOTA = {
  lastMeasuredFreeGb: 459,
  warnBelowGb: DISK_WARN_GB,
  stopBelowGb: DISK_STOP_GB,
  expandAutomatically: false,
  note: 'Keep the historical 32 GB hard STOP. Add a 64 GB WARN so a 16 GB GPU run cannot fill the volume with logs/checkpoints unnoticed. No automatic storage expansion.',
}

export const EXPERIMENT_MANIFEST_FIELDS = [
  'run ID',
  'parent model SHA',
  'architecture ID',
  'tokenizer ID + SHA',
  'corpus versions + hashes',
  'data-mix percentages',
  'packing method',
  'EOS policy',
  'BOS policy',
  'optimizer',
  'LR (initial/peak/min/warmup/schedule)',
  'batch',
  'accumulation',
  'precision',
  'seed (runtime/data/packing/eval)',
  'hardware',
  'software versions',
  'start/end timestamps',
  'steps',
  'tokens',
  'evaluation metrics',
  'verdict',
  'promotion status',
] as const

export const SECURITY_GOVERNANCE = {
  telemetry: 'No external telemetry unless explicitly known/approved. Default OFF.',
  cloudTraining: false,
  modelUpload: false,
  corpusUpload: false,
  experimentTracker: 'Local AppData manifests only. No W&B/Comet/HF by default.',
  locale: 'Training remains local to Nebula.',
  qwen: 'THIRD_PARTY_MODEL_RUNNING_LOCALLY. Do not replace during this design or later environment setup.',
  sparseFuture: 'MoE router, NVMe expert streaming, hot/cold cache, expert offload, quantized KV — later architecture lane. Not this baseline.',
  rael: 'NOT_IMPLEMENTED. Do not create.',
  autonomy: 'OFF',
}

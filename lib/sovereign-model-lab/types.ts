/**
 * War Room Sovereign Model Lab — Phase 1 + Phase 2A types.
 *
 * Pipeline: hardware audit -> source registration -> document ingest -> provenance ->
 * dataset candidates -> Commander dataset approval -> real local tokenizer training (Phase 2A,
 * environment probe -> plan -> Commander approval -> bounded subprocess -> verification) ->
 * training PLANNING. Nothing in this domain trains a real *model* or downloads third-party
 * weights. The state machine in runtime.ts is structurally incapable of reaching a model-training
 * state this phase — tokenizer_training is the only real local process it can start.
 */

// ---------------------------------------------------------------------------
// Dataset source / document / provenance
// ---------------------------------------------------------------------------

export type SovereignDatasetSourceFamily =
  | 'government'
  | 'international_organization'
  | 'university'
  | 'scientific_archive'
  | 'legal_archive'
  | 'historical_archive'
  | 'encyclopedia'
  | 'news_rss'
  | 'public_api'
  | 'direct_web'
  | 'commander_library'

export type SovereignDatasetSource = {
  id: string
  family: SovereignDatasetSourceFamily
  label: string
  acquisitionMethod: string
  licenseOrTermsLocation: string
  updateFrequency: string
  supportedLanguages: string[]
  expectedContentFormat: string
  trainingEligibleByDefault: boolean
  citationRequirements: string
  healthStatus: 'unknown' | 'reachable' | 'unreachable' | 'not_checked'
  lastSuccessfulRetrievalAt: string | null
  registeredAt: string
}

export type DatasetAccessStatus =
  | 'public'
  | 'public_domain'
  | 'open_license'
  | 'commander_owned'
  | 'commander_licensed'
  | 'restricted'
  | 'paywalled'
  | 'authentication_required'
  | 'robots_restricted'
  | 'unknown'
  | 'unavailable'

export const DATASET_ACCESS_STATUSES: readonly DatasetAccessStatus[] = [
  'public',
  'public_domain',
  'open_license',
  'commander_owned',
  'commander_licensed',
  'restricted',
  'paywalled',
  'authentication_required',
  'robots_restricted',
  'unknown',
  'unavailable',
]

/** Access statuses that may never automatically enter a training dataset — enforced structurally
 * in sourcePolicy.ts, not just documented here. */
export const NEVER_AUTO_TRAINING_ACCESS_STATUSES: readonly DatasetAccessStatus[] = [
  'restricted',
  'paywalled',
  'authentication_required',
  'robots_restricted',
  'unknown',
  'unavailable',
]

export type DatasetLicenseRecord = {
  licenseId: string | null
  licenseName: string | null
  licenseUrl: string | null
  permitsTrainingUse: boolean | null
  recordedBy: 'auto_detected' | 'commander_declared' | 'unknown'
  recordedAt: string
  notes: string
}

export type DatasetProvenanceChainLink = {
  step: string
  at: string
  actor: 'system' | 'commander'
  detail: string
}

export type DatasetProvenanceRecord = {
  documentId: string
  chain: DatasetProvenanceChainLink[]
}

export type SovereignDocumentRecord = {
  id: string
  sourceUrl?: string
  localPath?: string
  sourceType: SovereignDatasetSourceFamily | 'local_upload'
  publisher: string
  title: string
  retrievedAt: string
  contentHash: string
  licenseStatus: DatasetLicenseRecord
  accessStatus: DatasetAccessStatus
  language: string | 'unknown'
  contentType: string
  byteCount: number
  provenanceChain: DatasetProvenanceChainLink[]
  allowedForTraining: boolean
  exclusionReason: string | null
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Source admission policy
// ---------------------------------------------------------------------------

export type AcquisitionPolicyDecisionKind = 'auto_admit' | 'commander_review_required' | 'auto_reject'

export type AcquisitionPolicyDecision = {
  decision: AcquisitionPolicyDecisionKind
  reasons: string[]
  /** Never true for a rejection driven by subject matter — only rights/access/authenticity. */
  isRightsOrAccessBased: boolean
  evaluatedAt: string
}

// ---------------------------------------------------------------------------
// Dataset manifest
// ---------------------------------------------------------------------------

export type DatasetExclusionEntry = {
  documentId: string
  reason: string
  accessStatus: DatasetAccessStatus
}

export type DatasetManifest = {
  manifestId: string
  checksum: string
  createdAt: string
  documentIds: string[]
  documentCount: number
  estimatedTokens: number
  languageDistribution: Record<string, number>
  sourceDistribution: Record<string, number>
  licenseDistribution: Record<string, number>
  duplicateCount: number
  excluded: DatasetExclusionEntry[]
  commanderApproved: boolean
  commanderApprovedAt: string | null
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export type HardwareCapabilityClass =
  | 'metadata_only'
  | 'dataset_preparation'
  | 'tiny_model_training'
  | 'small_model_training'
  | 'inference_only'
  | 'distributed_command_node'

export type HardwareCapabilityReport = {
  generatedAt: string
  operatingSystem: string | null
  cpuModel: string | null
  logicalCpuCount: number | null
  totalRamBytes: number | null
  availableRamBytes: number | null
  gpuName: string | null
  gpuMemoryBytes: number | null
  cudaAvailable: boolean | null
  directMlAvailable: boolean | null
  freeDiskBytes: number | null
  pythonAvailable: boolean | null
  pythonVersion: string | null
  nodeVersion: string | null
  gitVersion: string | null
  wslAvailable: boolean | null
  capabilityClasses: HardwareCapabilityClass[]
  honestyNote: string
}

// ---------------------------------------------------------------------------
// Tokenizer — Phase 2A: real environment probe, real plan/approval binding,
// real bounded execution, real verification. tokenizer_ready (see
// SovereignModelLabState below) is only reachable through this whole chain —
// never from a dry run, a dependency probe, or a config file alone.
// ---------------------------------------------------------------------------

export type TokenizerAlgorithm = 'bpe' | 'unigram' | 'wordpiece'

export const REQUIRED_TOKENIZER_SPECIAL_TOKENS: readonly string[] = [
  '<|pad|>',
  '<|bos|>',
  '<|eos|>',
  '<|unk|>',
  '<|system|>',
  '<|commander|>',
  '<|assistant|>',
  '<|tool|>',
  '<|evidence|>',
]

export type TokenizerSpecialToken = {
  token: string
  id: number
}

export type CorpusClassification = 'validation_only' | 'experimental' | 'development' | 'production_candidate'

export type TokenizerExecutionPlan = {
  planId: string
  createdAt: string
  corpusVersion: string
  corpusManifestId: string
  corpusClassification: CorpusClassification
  corpusDocumentCount: number
  corpusByteCount: number
  estimatedTokens: number
  algorithm: TokenizerAlgorithm
  requestedVocabSize: number
  recommendedVocabSize: number
  vocabSizeAdjustedReason: string | null
  minimumFrequency: number
  seed: number
  executablePath: string
  argv: string[]
  outputDir: string
  manifestOutputPath: string
  maxRuntimeMs: number
  cpuLimit: number | null
  ramCeilingBytes: number | null
  networkPolicy: 'no_network_allowed'
  expectedArtifacts: string[]
  planHash: string
}

export type TokenizerTrainingApproval = {
  approvalId: string
  planId: string
  planHash: string
  /** SHA-256 of the corpus manifest.json bytes at approval time — rechecked fresh immediately
   * before spawning, not just trusted from the plan object in memory. */
  corpusManifestChecksumAtApproval: string
  approvedAt: string
  approvedBy: 'commander'
  singleUse: true
  consumedAt: string | null
}

export type PreflightRejectionReason =
  | 'plan_hash_mismatch'
  | 'approval_plan_hash_mismatch'
  | 'corpus_manifest_hash_mismatch'
  | 'approval_already_consumed'
  | 'approval_plan_mismatch'

export type PreflightCheckResult =
  | { ok: true }
  | { ok: false; reason: PreflightRejectionReason; detail: string }

export type TokenizerJobStatus = {
  jobId: string
  planId: string
  approvalId: string
  startedAt: string
  endedAt: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
  exitCode: number | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdoutTail: string
  stderrTail: string
  lastProgressAt: string
}

export type TokenizerArtifactFile = {
  fileName: string
  byteCount: number
  sha256: string
}

export type TokenizerVerificationCheck = {
  id: string
  label: string
  passed: boolean
  detail: string
}

export type TokenizerVerificationResult = {
  verifiedAt: string
  allMandatoryChecksPassed: boolean
  checks: TokenizerVerificationCheck[]
}

export type TokenizerExperiment = {
  experimentId: string
  createdAt: string
  updatedAt: string
  datasetManifestId: string
  corpusVersion: string | null
  plan: TokenizerExecutionPlan | null
  approval: TokenizerTrainingApproval | null
  jobId: string | null
  jobStatus: TokenizerJobStatus | null
  artifactDir: string | null
  artifactFiles: TokenizerArtifactFile[]
  specialTokens: TokenizerSpecialToken[]
  verification: TokenizerVerificationResult | null
}

// ---------------------------------------------------------------------------
// Corpus artifact (Part 5) — a real, immutable, versioned file bundle built
// from admitted documents only. Distinct from DatasetManifest above, which is
// just the lightweight admission/exclusion accounting; this is the literal
// corpus.jsonl + manifest.json + exclusions.json + quality-report.json +
// checksums.json bundle a tokenizer is actually trained from.
// ---------------------------------------------------------------------------

export type CorpusRecordRef = {
  documentId: string
  sourceId: string
  provenanceEntryId: string
  contentHash: string
}

export type CorpusExclusionEntry = {
  documentId: string
  reason: string
}

export type CorpusManifest = {
  corpusId: string
  version: string
  createdAt: string
  classification: CorpusClassification
  documentCount: number
  excludedCount: number
  duplicateCount: number
  byteCount: number
  estimatedCharacterCount: number
  estimatedTokenCount: number
  recordChecksum: string
  manifestChecksum: string
  sourceDatasetManifestId: string
}

export type CorpusQualityReport = {
  emptyRecordsRemoved: number
  exactDuplicatesRemoved: number
  languageDistribution: Record<string, number>
}

export type CorpusBuildResult = {
  corpusDir: string
  manifest: CorpusManifest
  exclusions: CorpusExclusionEntry[]
  qualityReport: CorpusQualityReport
  files: {
    corpusJsonl: string
    manifestJson: string
    exclusionsJson: string
    qualityReportJson: string
    checksumsJson: string
  }
}

// ---------------------------------------------------------------------------
// Tokenizer environment truth (Part 6)
// ---------------------------------------------------------------------------

export type TokenizerLibraryName = 'tokenizers' | 'sentencepiece'

export type TokenizerLibraryProbeResult = {
  library: TokenizerLibraryName
  importable: boolean
  version: string | null
  python314Support: 'supported' | 'unsupported' | 'unknown'
}

export type TokenizerEnvironmentStatus = 'compatible' | 'incompatible' | 'missing_dependency' | 'probe_failed'

export type TokenizerEnvironmentReport = {
  generatedAt: string
  pythonExecutablePath: string | null
  pythonVersion: string | null
  architecture: string | null
  libraries: TokenizerLibraryProbeResult[]
  cpuCount: number | null
  availableRamBytes: number | null
  freeDiskBytes: number | null
  writableOutputDir: boolean | null
  proposedExecutablePath: string | null
  proposedArgv: string[] | null
  environmentVariablesPassed: string[]
  networkIsolationEnforceable: boolean
  networkIsolationNote: string
  status: TokenizerEnvironmentStatus
  honestyNote: string
}

// ---------------------------------------------------------------------------
// Canonical program read model (Part 3)
// ---------------------------------------------------------------------------

export type ProgramIntegrityContradictionKind =
  | 'dataset_approved_without_manifest'
  | 'dataset_approved_zero_admitted'
  | 'tokenizer_ready_without_verified_artifact'
  | 'checkpoint_created_without_files'
  | 'model_registered_without_verified_checkpoint'
  | 'training_ready_without_compatible_framework'

export type ProgramIntegrityContradiction = {
  kind: ProgramIntegrityContradictionKind
  detail: string
}

export type ProgramProjection = {
  programId: string
  /** The raw, persisted program.state — exactly what's on disk, never silently corrected here. */
  reportedState: SovereignModelLabState
  /** What the state truthfully is once cross-checked against linked records (e.g. reportedState
   * is tokenizer_ready but no verified tokenizer artifact exists -> effectiveState reflects the
   * honest, lesser state). Computed by this same pure projection — never written back to storage. */
  effectiveState: SovereignModelLabState
  /** True whenever reportedState !== effectiveState. Migration is never performed here — only an
   * explicit Commander action (RECHECK PROGRAM TRUTH) may persist a correction. */
  migrationRequired: boolean
  sourceCount: number
  linkedSourceCount: number
  documentCount: number
  admittedDocumentCount: number
  excludedDocumentCount: number
  datasetState: 'none' | 'candidate' | 'awaiting_approval' | 'approved'
  datasetDocumentCount: number
  corpusState: 'none' | 'built'
  corpusClassification: CorpusClassification | null
  tokenizerState: SovereignModelLabState
  tokenizerArtifactCount: number
  trainingPlanState: 'none' | 'ready' | 'awaiting_approval'
  checkpointCount: number
  modelCount: number
  missingRequirements: string[]
  blockingRequirements: string[]
  availableCommanderActions: string[]
  integrityContradictions: ProgramIntegrityContradiction[]
}

// ---------------------------------------------------------------------------
// Training memory estimator (Part 11)
// ---------------------------------------------------------------------------

export type TrainingPrecision = 'fp32_inference' | 'fp32_training' | 'bf16_training' | 'fp16_training'
export type OptimizerKind = 'adamw' | 'sgd'
export type TrainingMemoryUncertaintyClass = 'low' | 'medium' | 'high'

export type TrainingMemoryLineItem = {
  label: string
  bytes: number
  formula: string
  assumptions: string
}

export type TrainingMemoryEstimate = {
  paramCount: number
  precision: TrainingPrecision
  optimizer: OptimizerKind | null
  activationCheckpointing: boolean
  lineItems: TrainingMemoryLineItem[]
  totalBytes: number
  minimumEstimateBytes: number
  recommendedSafeEstimateBytes: number
  knownOmissions: string[]
  uncertaintyClass: TrainingMemoryUncertaintyClass
  osReserveBytes: number
  serverReserveBytes: number
  uncertaintyMarginBytes: number
}

// ---------------------------------------------------------------------------
// Training planning (planning only — no execution)
// ---------------------------------------------------------------------------

export type TrainingScaleClass = 'micro' | 'tiny' | 'small' | 'research'

export const TRAINING_SCALE_PARAMETER_RANGES: Record<TrainingScaleClass, { minParams: number; maxParams: number }> = {
  micro: { minParams: 1_000_000, maxParams: 10_000_000 },
  tiny: { minParams: 10_000_000, maxParams: 100_000_000 },
  small: { minParams: 100_000_000, maxParams: 1_000_000_000 },
  research: { minParams: 1_000_000_000, maxParams: 50_000_000_000 },
}

export type TrainingExperiment = {
  experimentId: string
  createdAt: string
  scaleClass: TrainingScaleClass
  estimatedParameterCount: number
  estimatedTrainingTokens: number
  estimatedCheckpointBytes: number
  estimatedRamBytesRequired: number
  estimatedVramBytesRequired: number
  estimatedRuntimeClass: 'minutes' | 'hours' | 'days' | 'weeks' | 'requires_distributed_compute'
  currentHardwareCanExecute: boolean | null
  externalComputeRequired: boolean
  purpose: string
  tokenizerExperimentId: string | null
  datasetManifestId: string | null
  memoryEstimate?: TrainingMemoryEstimate
}

export type TrainingCheckpoint = {
  checkpointId: string
  createdAt: string
  contentHash: string
  trainingExperimentId: string
  datasetManifestId: string
  tokenizerExperimentId: string | null
  architectureConfig: Record<string, unknown>
  trainingCodeVersion: string
  parentCheckpointId: string | null
  verificationStatus: 'unverified' | 'hash_verified' | 'failed'
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type EvaluationKind =
  | 'language_modeling_loss'
  | 'memorization_check'
  | 'training_data_contamination_check'
  | 'basic_reasoning'
  | 'factual_retrieval'
  | 'source_attribution'
  | 'coding'
  | 'tool_use_formatting'
  | 'refusal_independent_topic_coverage'
  | 'privacy_leakage'
  | 'prompt_injection_resistance'

export type EvaluationDefinition = {
  kind: EvaluationKind
  label: string
  description: string
  /** True only for refusal_independent_topic_coverage — documents the boundary explicitly so
   * this can never be read as authorizing private/illegal data access. */
  measuresPolicyIndependenceNotDataAccess: boolean
}

export type EvaluationResult = {
  resultId: string
  evaluationKind: EvaluationKind
  checkpointId: string
  ranAt: string
  score: number | null
  passed: boolean | null
  notes: string
}

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

export type ModelOwnershipClass = 'war_room_native' | 'third_party'

export type ModelLineageKind =
  | 'war_room_trained_from_scratch'
  | 'war_room_continued_pretraining'
  | 'war_room_finetune'
  | 'third_party_reference'
  | 'external_api'

export type ModelManifest = {
  modelId: string
  createdAt: string
  lineageKind: ModelLineageKind
  ownershipClass: ModelOwnershipClass
  checkpointId: string | null
  parentModelId: string | null
  description: string
}

// ---------------------------------------------------------------------------
// Program state machine
// ---------------------------------------------------------------------------

export type SovereignModelLabState =
  | 'hardware_audit'
  | 'source_registered'
  | 'documents_ingested'
  | 'provenance_verified'
  | 'dataset_candidate'
  | 'awaiting_commander_dataset_approval'
  | 'dataset_approved'
  | 'tokenizer_not_planned'
  | 'tokenizer_environment_unverified'
  | 'tokenizer_environment_blocked'
  | 'tokenizer_plan_ready'
  | 'awaiting_commander_tokenizer_approval'
  | 'tokenizer_training'
  | 'tokenizer_verification'
  | 'tokenizer_ready'
  | 'tokenizer_failed'
  | 'tokenizer_cancelled'
  | 'training_plan_ready'
  | 'awaiting_commander_training_approval'
  | 'blocked'
  | 'cancelled'

export const SOVEREIGN_MODEL_LAB_STATES: readonly SovereignModelLabState[] = [
  'hardware_audit',
  'source_registered',
  'documents_ingested',
  'provenance_verified',
  'dataset_candidate',
  'awaiting_commander_dataset_approval',
  'dataset_approved',
  'tokenizer_not_planned',
  'tokenizer_environment_unverified',
  'tokenizer_environment_blocked',
  'tokenizer_plan_ready',
  'awaiting_commander_tokenizer_approval',
  'tokenizer_training',
  'tokenizer_verification',
  'tokenizer_ready',
  'tokenizer_failed',
  'tokenizer_cancelled',
  'training_plan_ready',
  'awaiting_commander_training_approval',
  'blocked',
  'cancelled',
]

/** Phase 2A boundary: tokenizer_training is a real, bounded, explicitly-scoped local-tokenizer
 * state — but training_plan_ready and awaiting_commander_training_approval still have no outgoing
 * transition into any *model*-training-in-progress state, because no such state exists in this
 * union at all. The state machine remains structurally incapable of training a model.
 *
 * tokenizer_ready is reachable only via tokenizer_verification, which is itself reachable only via
 * tokenizer_training, which is itself reachable only via an explicit Commander approval. A dry
 * run, a dependency probe, or a config file alone can advance the program no further than
 * tokenizer_plan_ready. */
export const SOVEREIGN_MODEL_LAB_TRANSITIONS: Record<SovereignModelLabState, readonly SovereignModelLabState[]> = {
  hardware_audit: ['source_registered', 'blocked', 'cancelled'],
  source_registered: ['documents_ingested', 'blocked', 'cancelled'],
  documents_ingested: ['provenance_verified', 'blocked', 'cancelled'],
  provenance_verified: ['dataset_candidate', 'blocked', 'cancelled'],
  dataset_candidate: ['awaiting_commander_dataset_approval', 'blocked', 'cancelled'],
  awaiting_commander_dataset_approval: ['dataset_approved', 'dataset_candidate', 'blocked', 'cancelled'],
  dataset_approved: ['tokenizer_not_planned', 'blocked', 'cancelled'],
  tokenizer_not_planned: ['tokenizer_environment_unverified', 'blocked', 'cancelled'],
  tokenizer_environment_unverified: ['tokenizer_plan_ready', 'tokenizer_environment_blocked', 'blocked', 'cancelled'],
  tokenizer_environment_blocked: ['tokenizer_environment_unverified', 'blocked', 'cancelled'],
  tokenizer_plan_ready: ['awaiting_commander_tokenizer_approval', 'tokenizer_not_planned', 'blocked', 'cancelled'],
  awaiting_commander_tokenizer_approval: ['tokenizer_training', 'tokenizer_plan_ready', 'blocked', 'cancelled'],
  tokenizer_training: ['tokenizer_verification', 'tokenizer_failed', 'tokenizer_cancelled', 'blocked'],
  tokenizer_verification: ['tokenizer_ready', 'tokenizer_failed', 'blocked', 'cancelled'],
  tokenizer_ready: ['training_plan_ready', 'blocked', 'cancelled'],
  tokenizer_failed: ['tokenizer_not_planned', 'blocked', 'cancelled'],
  tokenizer_cancelled: ['tokenizer_not_planned', 'blocked', 'cancelled'],
  training_plan_ready: ['awaiting_commander_training_approval', 'blocked', 'cancelled'],
  awaiting_commander_training_approval: ['blocked', 'cancelled'],
  blocked: [
    'hardware_audit',
    'source_registered',
    'documents_ingested',
    'dataset_candidate',
    'tokenizer_not_planned',
    'cancelled',
  ],
  cancelled: [],
}

/** Explicit corrective transitions. Kept separate from forward lifecycle transitions so truth
 * repair is narrow, reviewable, and cannot become a general state-machine escape hatch. */
export const SOVEREIGN_MODEL_LAB_RECOVERY_TRANSITIONS: Partial<Record<SovereignModelLabState, readonly SovereignModelLabState[]>> = {
  tokenizer_ready: ['tokenizer_plan_ready', 'tokenizer_not_planned'],
}

export type SovereignModelLabHistoryEntry = {
  state: SovereignModelLabState
  at: string
  note?: string
}

export type SovereignModelLabProgram = {
  programId: string
  name: string
  state: SovereignModelLabState
  history: SovereignModelLabHistoryEntry[]
  hardwareReportId: string | null
  registeredSourceIds: string[]
  ingestedDocumentIds: string[]
  datasetManifestId: string | null
  tokenizerExperimentId: string | null
  trainingExperimentId: string | null
  createdAt: string
  updatedAt: string
}

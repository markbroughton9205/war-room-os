export type Wave4ExclusionReason =
  | 'wave3_not_eligible' | 'missing_provenance' | 'provenance_poor' | 'hidden_cot'
  | 'secret_detected' | 'stale' | 'retracted' | 'contested' | 'poisoned'
  | 'correction_not_applied' | 'duplicate_content' | 'source_lineage_leakage'

export type Wave4DatasetRecord = {
  recordId: string
  recordType: 'claim' | 'experience' | 'correction' | 'code_operator_evidence' | 'prediction'
  content: string
  verificationState: 'candidate' | 'supported' | 'verified' | 'contested' | 'retracted'
  wave3Eligible: boolean
  observedAt: string
  validUntil: string | null
  provenanceRefs: string[]
  sourceLineageIds: string[]
  evidenceIds: string[]
  poisoned: boolean
  containsHiddenCot: boolean
  containsSecret: boolean
  commanderCorrection: null | { correctionId: string; applied: boolean; correctedBy: string; correctedAt: string; supersedesRecordId: string | null }
  curriculumTags: string[]
  capabilityTags: string[]
}

export type DatasetSplit = 'train' | 'validation' | 'test'
export type Wave4AdmittedRecord = Wave4DatasetRecord & { contentHash: string; split: DatasetSplit }

export type Wave4DatasetManifest = {
  manifestId: string
  policyVersion: 'wave4-v1'
  createdAt: string
  parentCandidateManifestIds: string[]
  records: Wave4AdmittedRecord[]
  exclusions: { recordId: string; reasons: Wave4ExclusionReason[] }[]
  splitCounts: Record<DatasetSplit, number>
  datasetHash: string
  immutable: true
  trainingStarted: false
}

export type CheckpointCandidate = {
  checkpointCandidateId: string
  modelId: 'WRIM-1-candidate'
  parentCheckpointId: string
  parentCheckpointHash: string
  datasetManifestId: string
  datasetHash: string
  tokenizerArtifactHash: string
  createdAt: string
  status: 'registered' | 'evaluated' | 'rejected' | 'recommended'
  rollbackCheckpointId: string
  trainingStarted: false
}

export type EvalMetric = { capabilityKey: string; baselineScore: number; candidateScore: number; minimumScore: number; maximumRegression: number }
export type EvalManifest = { evalManifestId: string; checkpointCandidateId: string; benchmarkRefs: string[]; metrics: EvalMetric[]; contentHash: string }
export type PromotionRecommendation = { recommendation: 'recommend' | 'reject'; reasons: string[]; commanderAuthorization: 'not_requested'; promotionExecuted: false }

export type M1TrainingEstimate = {
  hardware: { chip: string; unifiedMemoryBytes: number; availableMemoryBytes: number; freeDiskBytes: number }
  parameterCount: number
  datasetTokens: number
  epochs: number
  estimatedSteps: number
  estimatedWallClockHours: { low: number; high: number } | null
  peakMemoryBytes: { low: number; high: number }
  checkpointDiskBytes: number
  locallyFeasible: boolean
  confidence: 'low'
  assumptions: string[]
  trainingStarted: false
}

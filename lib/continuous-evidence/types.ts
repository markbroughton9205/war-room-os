import type { LearningEvidence, LearningEvidenceKind } from '@/lib/active-learning/types'
import type { VerificationState } from '@/lib/world-learning/types'

export type ContinuousEvidenceSource =
  | 'code_operator' | 'research_engine' | 'world_learning' | 'terra' | 'commander_correction' | 'tool_use'
export type ObjectiveOutcome = 'pass' | 'fail' | 'inconclusive' | 'corrected'

export type ContinuousEvidenceInput = {
  source: ContinuousEvidenceSource
  subjectRef: string
  outcome: ObjectiveOutcome
  observedAt: string
  validUntil: string | null
  validFrom?: string | null
  verificationAt?: string | null
  provenanceRefs: string[]
  sourceLineageIds: string[]
  capabilityTags: string[]
  curriculumTags: string[]
  validatorTypes: string[]
  verifierId: string | null
  evaluatorId: string | null
  /** True when an independent evaluator finished judging the objective, including verified failures. */
  objectiveEvaluated?: boolean
  /** True only when the mission objective was successfully achieved. */
  objectiveSatisfied?: boolean
  /**
   * Compatibility alias for successful satisfaction. Must not be true merely because evaluation ran.
   * Admission of fail records requires objectiveEvaluated, not this flag.
   */
  objectiveVerified?: boolean
  claimStatus?: VerificationState
  retryOfEvidenceId?: string | null
  location?: { latitude: number; longitude: number } | null
  predictionRef?: string | null
  observationRef?: string | null
  sourceRef?: string | null
  sourceVersion?: string | null
  containsSecret?: boolean
  containsHiddenCot?: boolean
  metadata?: Record<string, unknown>
}

export type ContinuousEvidenceRecord = {
  evidence: LearningEvidence
  source: ContinuousEvidenceSource
  sourceLineageIds: string[]
  capabilityTags: string[]
  curriculumTags: string[]
  validatorTypes: string[]
  quality: EvidenceQualityMetrics
  contentHash: string
  retryOfEvidenceId: string | null
}

export type EvidenceRejection = { subjectRef: string; evidenceId: string; reasons: string[] }

export type EvidenceQualityMetrics = {
  objectiveValidatorCount: number
  provenanceCount: number
  distinctLineageCount: number
  sourceDiversity: number
  temporalBoundedness: boolean
  qualityScore: number
}

export type CapabilityEvidenceMetrics = {
  capabilityKey: string
  successes: number
  failures: number
  validatorTypes: string[]
  distinctMissionLineages: number
  lastObservedAt: string | null
  heldOutPasses: number
  heldOutFailures: number
  evidenceDensity: number
  averageEvidenceQuality: number
  confidence: number
  strength: 'unobserved' | 'isolated' | 'emerging' | 'repeated'
  evidenceIds: string[]
}

export type CurriculumSignal = {
  id: string
  kind: 'observed_failure' | 'knowledge_gap' | 'low_confidence' | 'regression' | 'commander_correction'
  capabilityKey: string
  severity: number
  observedAt: string
  sourceRef: string
}

export type CurriculumPriority = {
  capabilityKey: string
  priority: number
  reasons: string[]
  nextMission: { kind: 'research' | 'targeted_verification' | 'code_skill'; objective: string; requiredValidator: string }
}

export type IncrementalDatasetManifest = {
  datasetId: string
  version: string
  createdAt: string
  predecessor: { datasetId: string; manifestHash: string }
  admissionRuleVersion: 'wave5-real-v1'
  splitSeed: number
  splitVersion: 'lineage-stable-v1'
  sourceEvidenceIds: string[]
  addedEvidenceIds: string[]
  removedEvidenceIds: string[]
  rejectedEvidence: EvidenceRejection[]
  trainIds: string[]
  validationIds: string[]
  testIds: string[]
  lineageGroups: Record<string, string[]>
  capabilityDistribution: Record<string, { total: number; successes: number; failures: number }>
  evidenceQuality: { average: number; minimum: number; byEvidenceId: Record<string, EvidenceQualityMetrics> }
  heldOutIsolationProof: { passed: boolean; collisions: string[]; inheritedHeldOutIds: string[]; checkedGenerations: string[] }
  parentCheckpoint: 'WRIM-0:checkpoint-final'
  parentCheckpointHash: string
  tokenizerId: 'WR-TOKENIZER-0'
  tokenizerHash: string
  contentHash: string
  trainingStarted: false
}

export type PriorDatasetRoot = {
  datasetId: string
  manifestHash: string
  sourceEvidenceIds: string[]
  trainIds: string[]
  validationIds: string[]
  testIds: string[]
  evidenceLineages: Record<string, string[]>
}

export const EVIDENCE_KIND_BY_SOURCE: Record<ContinuousEvidenceSource, LearningEvidenceKind> = {
  code_operator: 'code_operator_result', research_engine: 'research_result', world_learning: 'verification',
  terra: 'prediction_outcome', commander_correction: 'commander_correction', tool_use: 'tool_use_result',
}

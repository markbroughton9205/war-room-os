export type LearningEvidenceKind =
  | 'research_result' | 'verification' | 'evaluation' | 'code_operator_result'
  | 'commander_correction' | 'failure' | 'terra_observation' | 'prediction_outcome'
  | 'tool_use_result'

export type LearningEvidence = {
  id: string
  projectId: string | null
  userId: string | null
  kind: LearningEvidenceKind
  subjectRef: string
  outcome: 'pass' | 'fail' | 'inconclusive' | 'corrected'
  observedAt: string
  validUntil: string | null
  provenanceRefs: string[]
  verifierId: string | null
  evaluatorId: string | null
  poisoned: boolean
  metadata: Record<string, unknown>
}

export type StudyMission = {
  id: string
  projectId: string | null
  userId: string | null
  gapId: string
  objective: string
  questions: string[]
  missionKind: 'research' | 'targeted_verification' | 'code_skill'
  generatorId: string
  verifierId: string
  evaluatorId: string
  status: 'planned' | 'running' | 'completed' | 'blocked'
  evidenceIds: string[]
}

export type CapabilityNode = {
  capabilityKey: string
  projectId: string | null
  userId: string | null
  level: number
  confidence: number
  passCount: number
  failCount: number
  evidenceIds: string[]
}

export type TrainingCandidate = {
  recordType: 'claim' | 'experience' | 'correction' | 'code_operator_evidence' | 'prediction'
  recordId: string
  projectId: string | null
  userId: string | null
  verificationState: 'candidate' | 'supported' | 'verified' | 'contested' | 'retracted'
  observedAt: string
  validUntil: string | null
  provenanceRefs: string[]
  evidenceIds: string[]
  poisoned: boolean
  commanderCorrectionApplied: boolean
}

export type TrainingCandidateManifest = {
  id: string
  createdAt: string
  policyVersion: 'wave3-v1'
  modelLineage: 'wrim-1-candidate'
  eligibilityState: 'not_eligible' | 'eligible'
  authorizationState: 'not_requested' | 'awaiting_commander_authorization' | 'authorized'
  trainingState: 'not_started' | 'training' | 'completed' | 'failed'
  trainingAuthorized: boolean
  commanderAuthorizedBy: string | null
  commanderAuthorizedAt: string | null
  candidates: TrainingCandidate[]
  excluded: { recordId: string; reasons: string[] }[]
}

export type PredictionRecord = {
  id: string
  projectId: string | null
  userId: string | null
  statement: string
  predictedAt: string
  verifyAfter: string
  validUntil: string | null
  provenanceRefs: string[]
  status: 'pending' | 'verified' | 'falsified' | 'expired'
  verificationEvidenceIds: string[]
}

export type GymType = 'code_operator' | 'research_engine' | 'terra_world_state' | 'tool_use'

export type ObservableStep = {
  at: string
  action: string
  arguments: Record<string, unknown>
  resultSummary: string
  exitCode: number | null
}

export type GymSuccessCriterion = {
  id: string
  description: string
  passed: boolean
}

export type GymMissionSpec = {
  missionId: string
  gym: GymType
  objective: string
  capabilityTags: string[]
  curriculumTags: string[]
  sourceLineageIds: string[]
}

export type GymTemporalProvenance = {
  observedAt: string
  validFrom: string | null
  validUntil: string
  verificationAt: string
  predictionRef: string
  observationRef: string
  sourceRef: string
  sourceVersion: string
  location: { latitude: number; longitude: number }
}

export type GymRunRecord = {
  mission: GymMissionSpec
  startedAt: string
  completedAt: string
  trajectory: ObservableStep[]
  criteria: GymSuccessCriterion[]
  outcome: 'pass' | 'fail'
  hiddenCotDetected: boolean
  secretDetected: boolean
  objectiveEvaluated: true
  objectiveSatisfied: boolean
  claimStatus?: import('@/lib/world-learning/types').VerificationState
  terraTemporal?: GymTemporalProvenance
}

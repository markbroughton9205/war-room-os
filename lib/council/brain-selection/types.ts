import type { RoutingNote } from '../routing'

export type BrainReasoningStyle =
  | 'architectural'
  | 'strategic'
  | 'research'
  | 'coding'
  | 'risk'
  | 'synthesis'

export type BrainNeedLevel = 'low' | 'medium' | 'high'

export type BrainLatencyTolerance = 'fast' | 'normal' | 'slow'

export type BrainProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'moonshot'
  | 'local'
  | 'static'

export type BrainCandidateRiskLevel = 'low' | 'medium' | 'high'

export type RequiredBrainProfile = {
  reasoningStyle: BrainReasoningStyle
  contextWindowNeed: BrainNeedLevel
  latencyTolerance: BrainLatencyTolerance
  costSensitivity: BrainNeedLevel
  privacySensitivity: BrainNeedLevel
  liveResearchNeed: boolean
  toolUseNeed: boolean
}

export type BrainCandidate = {
  candidateId: string
  providerId: string
  modelId: string | null
  providerFamily: BrainProviderFamily
  fitScore: number
  costScore: number
  latencyScore: number
  reliabilityScore: number
  privacyScore: number
  capabilityScore: number
  totalScore: number
  strengths: string[]
  weaknesses: string[]
  riskLevel: BrainCandidateRiskLevel
  approvalRequired: boolean
  unavailableReason?: string
}

export type BrainRecommendation = {
  recommendationId: string
  routingId: string
  requiredBrainProfile: RequiredBrainProfile
  rankedCandidates: BrainCandidate[]
  selectedCandidateId: string | null
  approvalRequired: boolean
  reason: string
  decisionPath: string[]
  executionAllowed: false
  createdAt: string
}

export type BrainCandidateMetadata = Omit<
  BrainCandidate,
  | 'fitScore'
  | 'costScore'
  | 'latencyScore'
  | 'reliabilityScore'
  | 'privacyScore'
  | 'capabilityScore'
  | 'totalScore'
  | 'strengths'
  | 'weaknesses'
  | 'approvalRequired'
> & {
  registryOrder: number
  baseFitScore: number
  baseCostScore: number
  baseLatencyScore: number
  baseReliabilityScore: number
  basePrivacyScore: number
  baseCapabilityScore: number
  reasoningStyles: BrainReasoningStyle[]
  supportsLargeContext: boolean
  supportsLiveResearch: boolean
  supportsToolUse: boolean
  hasCachedLocalResearch: boolean
  isPremium: boolean
  isExternal: boolean
  isCostly: boolean
  baseStrengths: string[]
  baseWeaknesses: string[]
}

export type BrainScoreWeights = {
  fitScore: number
  capabilityScore: number
  reliabilityScore: number
  costScore: number
  latencyScore: number
  privacyScore: number
}

export type BrainSelectionInput = {
  routingNote: RoutingNote
  createdAt?: string
  recommendationId?: string
}

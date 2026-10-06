/**
 * HVS-owned creative intelligence types.
 * Session-side only. Never serialized into .hvsproj.
 * Model output is proposal/analysis, not project truth.
 */

export const HVS_CREATIVE_INTENT_SCHEMA = 'hvs.creative-intent.v1' as const
export const HVS_CREATIVE_ANALYSIS_SCHEMA = 'hvs.creative-analysis.v1' as const
export const HVS_CREATIVE_APPROACH_SCHEMA = 'hvs.creative-approach.v1' as const
export const HVS_CREATIVE_REVIEW_SCHEMA = 'hvs.creative-review.v1' as const
export const HVS_CREATIVE_RECEIPT_SCHEMA = 'hvs.creative-receipt.v1' as const

export const HVS_CREATIVE_OWNER = 'HVS' as const
export const FOUNDRY_OWNS_CREATIVE_INTELLIGENCE = false as const

export const HVS_CREATIVE_RISK_CLASSES = [
  'PACING',
  'FRAMING',
  'TYPOGRAPHY',
  'COLOR',
  'AUDIO',
  'STORY_STRUCTURE',
  'VISUAL_IDENTITY',
  'SHOT_CONTINUITY',
  'COMPOSITION',
  'CLARITY',
  'BRAND_ALIGNMENT',
  'PLATFORM_FIT',
  'RIGHTS_DEPENDENCY',
  'ASSET_DEPENDENCY',
] as const
export type HvsCreativeRiskClass = (typeof HVS_CREATIVE_RISK_CLASSES)[number]

export const HVS_CREATIVE_CRITERIA = [
  'intentFit',
  'audienceFit',
  'productionFeasibility',
  'assetAvailability',
  'rightsFeasibility',
  'visualCoherence',
  'pacingFit',
  'platformFit',
  'lessonCompatibility',
] as const
export type HvsCreativeCriterion = (typeof HVS_CREATIVE_CRITERIA)[number]

export const HVS_CREATIVE_JUDGMENTS = ['STRONG', 'ADEQUATE', 'WEAK', 'UNKNOWN'] as const
export type HvsCreativeJudgment = (typeof HVS_CREATIVE_JUDGMENTS)[number]

export const HVS_CREATIVE_HONESTY = ['OBSERVED', 'INFERRED', 'HUMAN_REQUIRED'] as const
export type HvsCreativeHonesty = (typeof HVS_CREATIVE_HONESTY)[number]

export const HVS_CREATIVE_SEVERITIES = ['info', 'warn', 'blocking'] as const
export type HvsCreativeSeverity = (typeof HVS_CREATIVE_SEVERITIES)[number]

export const HVS_CREATIVE_REVIEW_VERDICTS = [
  'ACCEPT_FOR_QC',
  'REFINE_REQUIRED',
  'REPLAN_REQUIRED',
  'NEEDS_HUMAN',
] as const
export type HvsCreativeReviewVerdict = (typeof HVS_CREATIVE_REVIEW_VERDICTS)[number]

export const HVS_CREATIVE_REFINEMENT_KINDS = [
  'SHORTEN_OPENING',
  'EXTEND_SHOT',
  'REORDER_BEAT',
  'CHANGE_TITLE_HIERARCHY',
  'ADJUST_TITLE_SAFE_AREA',
  'REDUCE_MUSIC_LEVEL',
  'INCREASE_VOICE_PRIORITY',
  'CHANGE_COLOR_DIRECTION',
  'CHANGE_SHOT_TYPE',
  'ADD_ESTABLISHING_SHOT',
  'REMOVE_REDUNDANT_BEAT',
] as const
export type HvsCreativeRefinementKind = (typeof HVS_CREATIVE_REFINEMENT_KINDS)[number]

export const HVS_SEMANTIC_REASONING = ['AVAILABLE', 'UNAVAILABLE', 'MALFORMED', 'SKIPPED'] as const
export type HvsSemanticReasoning = (typeof HVS_SEMANTIC_REASONING)[number]

export type HvsCreativeIntentAnalysis = {
  schema: typeof HVS_CREATIVE_INTENT_SCHEMA
  objective: string
  audience?: string | null
  emotionalGoal?: string | null
  narrativeGoal?: string | null
  visualGoal?: string | null
  pacingGoal?: string | null
  audioGoal?: string | null
  typographyGoal?: string | null
  colorGoal?: string | null
  framingGoal?: string | null
  platformContext?: string | null
  durationIntent?: string | null
  aspectIntent?: string | null
  requiredElements: string[]
  avoidElements: string[]
  constraints: string[]
  uncertainties: string[]
}

export type HvsCreativeRisk = {
  class: HvsCreativeRiskClass
  note: string
  honesty: HvsCreativeHonesty
}

export type HvsCreativeAnalysis = {
  schema: typeof HVS_CREATIVE_ANALYSIS_SCHEMA
  id: string
  intent: HvsCreativeIntentAnalysis
  strengthsToPreserve: string[]
  risks: HvsCreativeRisk[]
  opportunities: string[]
  unknowns: string[]
  lessonIdsConsidered: string[]
  lessonConflicts: Array<{ lessonIds: string[]; reason: string }>
  semanticReasoning: HvsSemanticReasoning
}

export type HvsCreativeApproach = {
  schema: typeof HVS_CREATIVE_APPROACH_SCHEMA
  id: string
  title: string
  concept: string
  narrativeShape?: string
  pacingStrategy?: string
  visualLanguage?: string
  shotStrategy?: string
  typographyStrategy?: string
  colorStrategy?: string
  audioStrategy?: string
  strengths: string[]
  risks: string[]
  lessonIdsUsed: string[]
  requiredAssetIds?: string[]
  rightsRisk?: boolean
}

export type HvsCreativeCriterionJudgment = {
  criterion: HvsCreativeCriterion
  judgment: HvsCreativeJudgment
  note: string
}

export type HvsCreativeApproachComparison = {
  approachId: string
  judgments: HvsCreativeCriterionJudgment[]
}

export type HvsCreativeRecommendation = {
  approachId: string
  whyItFits: string
  tradeoffs: string[]
  uncertainties: string[]
  commanderFinalAuthority: true
  objectiveTruth: false
}

export type HvsCreativeFinding = {
  class: HvsCreativeRiskClass
  observation: string
  intentReference: string
  evidence: string
  severity: HvsCreativeSeverity
  confidence: number
  suggestedCorrection: string
  honesty: HvsCreativeHonesty
}

export type HvsCreativeRefinement = {
  kind: HvsCreativeRefinementKind
  summary: string
  mapsToPatchKind: string | null
  mapsToCommandKinds: string[]
  automaticEditOp: false
}

export type HvsCreativeSelfChallenge = {
  asked: true
  moreElegant: string
  moreCinematic: string
  clearer: string
  moreEfficient: string
  overcomplicated: string
  tooGeneric: string
  servesIntent: string
}

export type HvsCreativeReview = {
  schema: typeof HVS_CREATIVE_REVIEW_SCHEMA
  id: string
  verdict: HvsCreativeReviewVerdict
  findings: HvsCreativeFinding[]
  strengths: string[]
  weaknesses: string[]
  proposedRefinements: HvsCreativeRefinement[]
  requiresStructuralReplan: boolean
  confidence: number
  intentAlignment: HvsCreativeJudgment
  selfChallenge: HvsCreativeSelfChallenge | null
  visualAnalysisRan: false | true
  semanticReasoning: HvsSemanticReasoning
  creativeScore: undefined
  cinematicScore: undefined
  qualityScore: undefined
  tasteScore: undefined
}

export type HvsCreativeProviderStatus = 'CONNECTED' | 'FALLBACK' | 'UNAVAILABLE'

export type HvsCreativeReceiptStatus =
  | 'ok'
  | 'invalid'
  | 'unavailable'
  | 'timeout'
  | 'fallback'

export type HvsCreativeRequestType =
  | 'INTENT_ANALYSIS'
  | 'ALTERNATIVE_GENERATION'
  | 'CREATIVE_REVIEW'
  | 'VISUAL_REVIEW'

export type HvsCreativeTokenUsage = {
  inputTokens?: number
  outputTokens?: number
}

export type HvsVisualReviewStatus = 'ACTIVE' | 'NOT_RUN' | 'STALE' | 'NEEDS_AUTHORIZATION'

export type HvsCreativeReceipt = {
  schema: typeof HVS_CREATIVE_RECEIPT_SCHEMA
  analysisId: string
  reviewId: string | null
  provider: string
  providerKind: 'deterministic' | 'live' | 'unavailable'
  createdAt: string
  intentSummary: string
  selectedApproachId: string | null
  lessonIdsConsidered: string[]
  findingCounts: { observed: number; inferred: number; humanRequired: number }
  callCounts: { intent: number; alternatives: number; review: number; visual?: number }
  semanticReasoning: HvsSemanticReasoning
  skipped: boolean
  skipReason: string | null
  hiddenReasoningStored: false
  model?: string | null
  requestType?: HvsCreativeRequestType | null
  requestId?: string | null
  startedAt?: string | null
  completedAt?: string | null
  status?: HvsCreativeReceiptStatus
  schemaValid?: boolean
  fallbackUsed?: boolean
  visualFramesUsed?: number
  visualReviewStatus?: HvsVisualReviewStatus
  providerStatus?: HvsCreativeProviderStatus
  usage?: HvsCreativeTokenUsage | null
  previousAnalysisIds?: string[]
}

export type HvsRenderIdentity = {
  projectId?: string | null
  path?: string | null
  hash?: string | null
  jobId?: string | null
  versionId?: string | null
}

export type HvsIdentifiedVisualFrame = {
  frameId: string
  timestampSec: number
  index: number
  role: HvsVisualFrame['role']
  sourcePath: string
  sourceHash?: string | null
  renderIdentity: HvsRenderIdentity
  provenance: string
}

export type HvsVisualReviewRecord = {
  status: HvsVisualReviewStatus
  renderIdentity: HvsRenderIdentity
  frames: HvsIdentifiedVisualFrame[]
  findings: HvsCreativeFinding[]
  inspected: boolean
  skipReason?: string | null
}

export type HvsCreativeSessionState = {
  skipped: boolean
  skipReason?: string | null
  analysisId?: string | null
  reviewId?: string | null
  selectedApproachId?: string | null
  semanticReasoning?: HvsSemanticReasoning
  receipt?: HvsCreativeReceipt | null
  analysis?: HvsCreativeAnalysis | null
  approaches?: HvsCreativeApproach[]
  comparison?: HvsCreativeApproachComparison[]
  recommendation?: HvsCreativeRecommendation | null
  review?: HvsCreativeReview | null
  preCreate?: HvsCreativePreCreateCheck | null
  visualReview?: HvsVisualReviewRecord | null
  providerStatus?: HvsCreativeProviderStatus
  previousAnalysisIds?: string[]
}

export type HvsCreativePreCreateCheck = {
  approachPresentOrSkipped: boolean
  criticalUnknowns: string[]
  rightsContradicted: boolean
  platformFit: HvsCreativeJudgment
  durationFit: HvsCreativeJudgment
  aspectFit: HvsCreativeJudgment
  mayProceed: boolean
  blockReason: string | null
}

export type HvsVisualFrame = {
  index: number
  role: 'opening' | 'early-middle' | 'midpoint' | 'late-middle' | 'ending' | 'shot-boundary'
  renderIdentity: { path?: string | null; hash?: string | null; jobId?: string | null; versionId?: string | null }
  provenance: string
}

export type HvsVisualReviewAdapter = {
  didInspect?: boolean
  sampleFrames: (input: {
    renderIdentity: HvsVisualFrame['renderIdentity']
    maxFrames: number
  }) => Promise<HvsVisualFrame[]>
}

export const HVS_CREATIVE_MAX_APPROACHES = 4
export const HVS_CREATIVE_MIN_APPROACHES = 2
export const HVS_CREATIVE_MAX_FRAMES = 12
export const HVS_CREATIVE_PREFERRED_FRAMES = 8
export const HVS_CREATIVE_MAX_CALLS = { intent: 1, alternatives: 1, review: 1, visual: 1 } as const
export const HVS_CREATIVE_MAX_PROMPT_CHARS = 8_000
export const HVS_CREATIVE_TIMEOUT_MS = {
  intent: 45_000,
  alternatives: 60_000,
  review: 60_000,
  vision: 90_000,
} as const
export const HVS_CREATIVE_MAX_RETRIES = 1

export type HvsCreativeImagePart = {
  frameId: string
  mimeType: 'image/jpeg' | 'image/png'
  dataBase64: string
}

export type HvsCreativeCompletionRequest<T = unknown> = {
  requestType: HvsCreativeRequestType
  schemaHint: string
  timeoutMs: number
  system: string
  user: string
  images?: HvsCreativeImagePart[]
  expected?: T
}

export type HvsCreativeCompletionResult<T = unknown> = {
  ok: boolean
  value: T | null
  status: 'ok' | 'invalid' | 'unavailable' | 'timeout' | 'unauthorized'
  schemaValid: boolean
  provider: string
  model: string
  requestId?: string | null
  startedAt: string
  completedAt: string
  usage?: HvsCreativeTokenUsage | null
  rawStored: false
  hiddenReasoningStored: false
  error?: string
}

export type HvsCreativeCompleter = {
  complete<T>(request: HvsCreativeCompletionRequest<T>): Promise<HvsCreativeCompletionResult<T>>
}

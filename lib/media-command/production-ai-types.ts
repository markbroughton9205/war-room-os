/**
 * Prompt-first Higher Vision Studios production types.
 * These describe Commander intent and AI plans. They are not a second .hvsproj.
 * Every executable step must map to an existing typed HVS system.
 */

import type { OutputAspect } from './types'
import type { EditCommand } from './edit-commands'

export const HVS_AI_FIRST_SLICE = 'HVS-AI-FIRST-UX' as const
export const HVS_AI_PRODUCER_SLICE = 'HVS-AI-PRODUCER-S2' as const
export const HVS_AI_PRODUCER_SLICE3 = 'HVS-AI-PRODUCER-S3' as const
export const HVS_AI_PRODUCER_SLICE4 = 'HVS-AI-PRODUCER-S4' as const
export const HVS_PRODUCTION_SESSION_SCHEMA = 1 as const
export const HVS_SELECTOR_ENGINE = 'HVS_SELECTOR' as const

export const HVS_CAPTION_STYLES = ['CLEAN', 'BOLD', 'MINIMAL', 'SOCIAL'] as const
export type HvsCaptionStyleId = (typeof HVS_CAPTION_STYLES)[number]

export const HVS_VARIANT_STATUSES = ['planned', 'reframed', 'queued', 'ready', 'failed'] as const
export type HvsProductionVariantStatus = (typeof HVS_VARIANT_STATUSES)[number]

export type HvsDurationReport = {
  requestedSec: number
  createdSec: number
  exact: boolean
  withinWindow: boolean
  underfilled: boolean
  underfillReason: string | null
}

export type HvsProductionVariant = {
  id: string
  name: string
  aspect: OutputAspect
  targetDuration: number | null
  platformIntent: string | null
  reframeMode: 'CINEMATIC_FOLLOW' | 'RULE_OF_THIRDS'
  captionStyle: HvsCaptionStyleId | null
  outputSpec: { aspect: OutputAspect; width: number; height: number; format: 'mp4' }
  derivedFromVersionId: string | null
  status: HvsProductionVariantStatus
  renderJobId: string | null
  outputAssetId: string | null
  outputPath: string | null
}

export const HVS_PRODUCTION_GOALS = [
  'SHORT_FROM_CLIPS',
  'PROMO',
  'TRAILER',
  'CLEANUP',
  'SOCIAL_VARIANT',
  'CUSTOM',
] as const
export type HvsProductionGoal = (typeof HVS_PRODUCTION_GOALS)[number]

export const HVS_PRODUCTION_STYLES = [
  'CINEMATIC',
  'ENERGETIC',
  'CLEAN',
  'DOCUMENTARY',
  'SOCIAL',
  'DRAMATIC',
  'WARM',
  'COOL',
  'BRIGHT',
  'DARK',
  'LUXURY',
] as const
export type HvsProductionStyleId = (typeof HVS_PRODUCTION_STYLES)[number]

export const HVS_PRODUCTION_STEP_KINDS = [
  'ANALYZE_MEDIA',
  'SELECT_MOMENTS',
  'BUILD_ROUGH_CUT',
  'TRIM_DEAD_SPACE',
  'APPLY_TRANSITIONS',
  'APPLY_LOOK',
  'CLEAN_AUDIO',
  'BALANCE_AUDIO',
  'ADD_CAPTIONS',
  'ADD_TITLE',
  'ADD_LOGO',
  'ADD_VISUAL_EFFECT',
  'CREATE_VARIANT',
  'FINALIZE_VIDEO',
] as const
export type HvsProductionStepKind = (typeof HVS_PRODUCTION_STEP_KINDS)[number]

export const HVS_PRODUCTION_SYSTEMS = [
  'VideoIntelligence',
  'EditOps',
  'EffectGraph',
  'ColorPipeline',
  'AudioGraph',
  'Captions',
  'UnifiedRenderEngine',
  'VersionBrowser',
] as const
export type HvsProductionSystem = (typeof HVS_PRODUCTION_SYSTEMS)[number]

export type HvsProductionIntent = {
  id: string
  projectId: string
  prompt: string
  sourceAssetIds: string[]
  goal: HvsProductionGoal
  durationSec: number | null
  aspect: OutputAspect | null
  style: HvsProductionStyleId | null
  tone: string | null
  platform: string | null
  captions: boolean
  music: 'keep' | 'louder' | 'quieter' | 'none' | null
  voice: 'keep' | 'clearer' | 'none' | null
  constraints: string[]
  createdAt: string
}

export type HvsProductionStep = {
  id: string
  kind: HvsProductionStepKind
  label: string
  detail: string
  system: HvsProductionSystem
  optional: boolean
  skippedReason: string | null
}

export type HvsAuthorityRequirement = {
  action: 'publish' | 'spend' | 'upload' | 'delete_originals' | 'install_models' | 'generate'
  allowed: false
  reason: string
}

export type HvsProductionPlan = {
  id: string
  intentId: string
  projectId: string
  objective: string
  summaryLines: string[]
  lengthLabel: string
  formatLabel: string
  styleLabel: string
  analysisSteps: HvsProductionStep[]
  storySteps: HvsProductionStep[]
  editSteps: HvsProductionStep[]
  visualSteps: HvsProductionStep[]
  audioSteps: HvsProductionStep[]
  captionSteps: HvsProductionStep[]
  deliverables: Array<{ aspect: OutputAspect; label: string }>
  authorityRequirements: HvsAuthorityRequirement[]
  estimatedWork: { steps: number; note: string }
  explanation: {
    foundCount: number
    using: string[]
    leavingOut: string[]
  }
  status: 'proposed' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled'
  createdAt: string
  /** Session-only. Read-only lesson constraints considered by this plan. Never EditOps. */
  planningConstraints?: import('./lessons/types').HvsPlanningConstraint[]
  lessonConstraintCount?: number
  automaticEditOp?: false
  /** Session-only selected creative approach id. Never .hvsproj truth. */
  creativeApproachId?: string
  creativeAnalysisId?: string
}

export type HvsRevisionRequest = {
  id: string
  projectId: string
  planId: string
  utterance: string
  createdAt: string
  status: 'proposed' | 'approved' | 'rejected'
}

export const HVS_PLAN_PATCH_KINDS = [
  'REPLACE_SHOT',
  'REMOVE_SHOT',
  'SHORTEN_SHOT',
  'EXTEND_SHOT',
  'MOVE_SHOT',
  'CHANGE_OPENING',
  'CHANGE_ENDING',
  'CHANGE_LOOK',
  'CHANGE_AUDIO',
  'CHANGE_DURATION',
  'CHANGE_ASPECT',
  'CHANGE_CAPTIONS',
] as const
export type HvsProductionPlanPatchKind = (typeof HVS_PLAN_PATCH_KINDS)[number]

export type HvsShotRole = 'open' | 'body' | 'close'

export type HvsShotReference = {
  label: string
  index: number
  clipId: string | null
  sourceAssetId: string | null
  sourceStartSec: number | null
  sourceEndSec: number | null
  timelineStartSec: number | null
  timelineEndSec: number | null
  role: HvsShotRole | null
}

export type HvsMomentCandidate = {
  assetId: string
  start: number
  end: number
  duration: number
  score: number
  evidence: string[]
  reason: string
  shotId?: string
  role?: HvsShotRole
  motionScore?: number
  audioActivity?: number
  silencePenalty?: number
  duplicatePenalty?: number
}

export type HvsSelectorResult = {
  engine: typeof HVS_SELECTOR_ENGINE
  candidates: HvsMomentCandidate[]
  selected: HvsMomentCandidate[]
  targetSec: number
  actualSec: number
  tolerance: { min: number; max: number; exact: boolean }
  fillPass: 1 | 2
  durationReport: HvsDurationReport
  explanation: {
    foundCount: number
    using: string[]
    leavingOut: string[]
  }
}

export type HvsProductionPlanPatch = {
  id: string
  revisionId: string
  kind: HvsProductionPlanPatchKind
  summary: string
  steps: HvsProductionStep[]
  commandKinds: Array<EditCommand['kind']>
  shotRef: HvsShotReference | null
  durationSec?: number | null
  aspect?: OutputAspect | null
  captionStyle?: HvsCaptionStyleId | null
  variantAspects?: OutputAspect[]
}

export type HvsProductionProgressStage =
  | 'idle'
  | 'analyzing'
  | 'selecting'
  | 'building'
  | 'improving_picture'
  | 'cleaning_sound'
  | 'adding_captions'
  | 'preparing'
  | 'finalizing'
  | 'ready'
  | 'failed'

export type HvsProductionProgress = {
  stage: HvsProductionProgressStage
  headline: string
  detail: string
  completed: string[]
  advancedDetail: string | null
  error: string | null
  advancedError: string | null
}

export type HvsProductionResult = {
  projectId: string
  planId: string
  versionId: string | null
  clipCount: number
  durationSec: number
  aspect: OutputAspect
  previewAssetId: string | null
  renderJobId: string | null
  renderOutputAssetId: string | null
  completedSteps: HvsProductionStepKind[]
  skippedSteps: Array<{ kind: HvsProductionStepKind; reason: string }>
  captionsAvailable: boolean
  outputPath: string | null
  variantVersionIds: string[]
  durationReport: HvsDurationReport | null
  variants: HvsProductionVariant[]
}

export type HvsNormalizedPromptContext = {
  projectId: string
  projectName: string
  assetSummaries: Array<{
    id: string
    kind: string
    name: string
    durationSec: number
    width: number | null
    height: number | null
  }>
  clipCount: number
  timelineDurationSec: number
  aspect: OutputAspect
  currentVersionLabel: string | null
  captionCueCount: number
  hasTranscript: boolean
  observationCount: number
  renderReady: boolean
}

export type HvsProductionSession = {
  schemaVersion: typeof HVS_PRODUCTION_SESSION_SCHEMA
  projectId: string
  intent: HvsProductionIntent
  plan: HvsProductionPlan | null
  progress: HvsProductionProgress
  result: HvsProductionResult | null
  pendingRevision: HvsRevisionRequest | null
  pendingPatch: HvsProductionPlanPatch | null
  approvedAt: string | null
  executedAt: string | null
  updatedAt: string
  currentStep: string | null
  completedSteps: string[]
  failedStep: string | null
  lastSafeVersion: string | null
  jobIds: string[]
  selector: HvsSelectorResult | null
  previewShots: HvsShotReference[]
  variants: HvsProductionVariant[]
  warRoomConversationId: string | null
  captionStyle: HvsCaptionStyleId | null
  asrStatus: 'ASR_RUNTIME_READY' | 'ASR_MODEL_MISSING' | 'ASR_RUNTIME_MISSING' | 'ASR_FAILED' | 'READY' | 'ASR_RUNTIME_NOT_READY' | 'ASR_MODEL_APPROVAL_REQUIRED' | null
  transcriptAssetIds: string[]
  asrWordLevel: boolean
  /** Session-only. Never written into .hvsproj. Absent on older sessions. */
  workflow?: import('./workflow-discipline').HvsWorkflowState
  lessonConstraintIds?: string[]
  lessonConstraintCount?: number
  /** Session-only creative intelligence. Absent on older sessions. */
  creativeIntelligence?: import('./creative-intelligence/types').HvsCreativeSessionState
}

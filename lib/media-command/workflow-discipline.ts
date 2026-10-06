/**
 * HVS workflow discipline. Additive. Does not own .hvsproj, EditOps, rights, or FFmpeg.
 * Workflow state lives on the production session, never inside HvsProject.
 */
import type { AssetRecord, HvsProject } from './types'
import { commercialOkForAsset } from './rights'
import { mayPublishAutomatically } from './policy'
import type { EditCommand } from './edit-commands'
import { EDIT_COMMAND_KINDS } from './edit-commands'
import type { HvsProductionIntent, HvsProductionPlan } from './production-ai-types'

export const HVS_WORKFLOW_STAGES = [
  'PLAN',
  'RESEARCH_PREPARE',
  'CREATE',
  'REVIEW',
  'REFINE',
  'QC',
  'DELIVER',
  'STOPPED',
  'REPLAN',
] as const
export type HvsWorkflowStage = (typeof HVS_WORKFLOW_STAGES)[number]

export const HVS_DEFAULT_MAX_REPLANS = 3

const LINEAR: HvsWorkflowStage[] = ['PLAN', 'RESEARCH_PREPARE', 'CREATE', 'REVIEW', 'REFINE', 'QC', 'DELIVER']

const SUBSTANTIAL = [
  /\bmake video\b/i,
  /\bmulti[- ]step\b/i,
  /\bmulti[- ]track\b/i,
  /\bdirector plan\b/i,
  /\bcinema plan\b/i,
  /\b3d scene\b/i,
  /\brender\b/i,
  /\bdeliver(y)?\b/i,
  /\bmulti[- ]asset\b/i,
  /\brights[- ]sensitive\b/i,
  /\b(review|qc)[- ]driven\b/i,
  /\bproduction\b/i,
]

const TRIVIAL = [
  /\bripple trim\b/i,
  /\b(single )?caption (correction|fix)\b/i,
  /\bfix (the )?caption\b/i,
  /\b(single )?volume( adjustment)?\b/i,
  /\b(lower|raise) volume\b/i,
  /\b(single )?title (correction|fix)\b/i,
  /\bfix (the )?title\b/i,
  /\b(single )?(timeline )?(insert|remove)( clip)?\b/i,
  /\bsingle (low-risk )?edit\b/i,
]

export type HvsProductionClass = {
  substantial: boolean
  trivial: boolean
  reason: string
}

export function isSubstantialProduction(text: string, hints?: { multiTrack?: boolean; rightsSensitive?: boolean }): boolean {
  if (hints?.multiTrack || hints?.rightsSensitive) return true
  return SUBSTANTIAL.some(pattern => pattern.test(text))
}

export function isTrivialEdit(text: string): boolean {
  if (isSubstantialProduction(text)) return false
  return TRIVIAL.some(pattern => pattern.test(text))
}

export function shouldUseWorkflowDiscipline(text: string, hints?: { multiTrack?: boolean; rightsSensitive?: boolean }): boolean {
  if (isTrivialEdit(text)) return false
  return isSubstantialProduction(text, hints)
}

export function classifyProduction(text: string, hints?: { multiTrack?: boolean; rightsSensitive?: boolean }): HvsProductionClass {
  const substantial = shouldUseWorkflowDiscipline(text, hints)
  const trivial = !substantial && (isTrivialEdit(text) || text.trim().length > 0)
  return {
    substantial,
    trivial: substantial ? false : trivial,
    reason: substantial ? 'substantial production enters PLAN→DELIVER' : 'trivial edit bypasses the full loop',
  }
}

export function nextWorkflowStage(stage: HvsWorkflowStage): HvsWorkflowStage | null {
  if (stage === 'STOPPED') return 'REPLAN'
  if (stage === 'REPLAN') return 'REFINE'
  const index = LINEAR.indexOf(stage)
  if (index < 0 || index === LINEAR.length - 1) return null
  return LINEAR[index + 1]
}

export function canEnterWorkflowStage(current: HvsWorkflowStage, next: HvsWorkflowStage): boolean {
  if (next === current) return true
  if (current === 'STOPPED' && next === 'REPLAN') return true
  if (current === 'REPLAN' && (next === 'REFINE' || next === 'CREATE' || next === 'PLAN')) return true
  if (current === 'REVIEW' && (next === 'REFINE' || next === 'REPLAN' || next === 'STOPPED' || next === 'QC')) return true
  const from = LINEAR.indexOf(current)
  const to = LINEAR.indexOf(next)
  return from >= 0 && to === from + 1
}

export type HvsReplanTrigger =
  | 'COMMANDER_WRONG'
  | 'INTENT_MISMATCH'
  | 'RIGHTS_CHANGED'
  | 'ASSET_CHANGED'
  | 'STRUCTURAL_REVIEW'
  | 'EVIDENCE_INVALID'

export function requiresReplan(trigger: HvsReplanTrigger | null): boolean {
  return trigger !== null
}

export type HvsWorkflowState = {
  enabled: boolean
  substantial: boolean
  currentStage: HvsWorkflowStage
  previousStage?: HvsWorkflowStage | null
  replanCount: number
  maxReplans: number
  stopReason?: string | null
  activeLessonIds?: string[]
  lessonConstraintIds?: string[]
  lessonConstraintCount?: number
  planningConstraints?: import('./lessons/types').HvsPlanningConstraint[]
  lessonConflicts?: import('./lessons/types').HvsLessonConflict[]
  verificationReportId?: string | null
  preparation?: HvsPreparationEvidence | null
  review?: HvsReviewResult | null
  completion?: HvsCompletionTruth | null
  elegance?: { asked: true; note: string } | null
  specialistTasks?: HvsSpecialistTask[]
  needsHuman?: boolean
  creativeAnalysisId?: string | null
  selectedApproachId?: string | null
  creativeReviewId?: string | null
}

export function initialWorkflow(substantial: boolean): HvsWorkflowState {
  return {
    enabled: substantial,
    substantial,
    currentStage: substantial ? 'PLAN' : 'DELIVER',
    previousStage: null,
    replanCount: 0,
    maxReplans: HVS_DEFAULT_MAX_REPLANS,
    stopReason: null,
    activeLessonIds: [],
    lessonConstraintIds: [],
    lessonConstraintCount: 0,
    planningConstraints: [],
    lessonConflicts: [],
    verificationReportId: null,
    preparation: null,
    review: null,
    completion: emptyCompletion(substantial),
    elegance: null,
    specialistTasks: [],
    needsHuman: false,
    creativeAnalysisId: null,
    selectedApproachId: null,
    creativeReviewId: null,
  }
}

export function advanceWorkflow(state: HvsWorkflowState, to: HvsWorkflowStage): HvsWorkflowState {
  if (!state.enabled) return state
  if (!canEnterWorkflowStage(state.currentStage, to)) return state
  return { ...state, previousStage: state.currentStage, currentStage: to }
}

export type HvsAssetGapStatus = 'AVAILABLE' | 'MISSING' | 'RIGHTS_BLOCKED' | 'UNKNOWN'

export type HvsAssetGap = {
  assetId: string
  status: HvsAssetGapStatus
  reason: string
}

export type HvsPreparationEvidence = {
  projectId: string
  productionMode: string | null
  mediaCount: number
  assetGaps: HvsAssetGap[]
  rightsFailClosed: true
  provenanceNoted: boolean
  themeId: string | null
  styleId: string | null
  renderRequired: boolean
  lessonIds: string[]
  mutatedProject: false
}

export function inspectAssetGap(asset: Pick<AssetRecord, 'id' | 'rights' | 'role'> | null, assetId: string): HvsAssetGap {
  if (!asset) return { assetId, status: 'MISSING', reason: 'Asset is not in the project. No substitute was chosen.' }
  const rights = commercialOkForAsset(asset)
  if (!asset.rights || asset.rights.state === 'UNKNOWN') {
    return { assetId, status: 'UNKNOWN', reason: rights.reason }
  }
  if (!rights.ok) return { assetId, status: 'RIGHTS_BLOCKED', reason: rights.reason }
  return { assetId, status: 'AVAILABLE', reason: rights.reason }
}

export function prepareProduction(input: {
  project: HvsProject
  intent: HvsProductionIntent
  lessonIds?: string[]
  renderRequired?: boolean
}): HvsPreparationEvidence {
  const wanted = input.intent.sourceAssetIds.length
    ? input.intent.sourceAssetIds
    : input.project.assets.map(asset => asset.id)
  const gaps = wanted.map(id => inspectAssetGap(input.project.assets.find(asset => asset.id === id) ?? null, id))
  return {
    projectId: input.project.id,
    productionMode: input.intent.goal,
    mediaCount: input.project.assets.length,
    assetGaps: gaps,
    rightsFailClosed: true,
    provenanceNoted: input.project.assets.some(asset => Boolean(asset.rights?.source) || asset.rights?.state === 'UNKNOWN'),
    themeId: input.project.timeline?.themeId ?? null,
    styleId: input.intent.style,
    renderRequired: input.renderRequired === true || /\brender|deliver/i.test(input.intent.prompt),
    lessonIds: input.lessonIds ?? [],
    mutatedProject: false,
  }
}

export const HVS_SPECIALIST_KINDS = [
  'CONCEPT',
  'WRITING',
  'STORY_STRUCTURE',
  'VISUAL_RESEARCH',
  'EDITING',
  'AUDIO',
  'GRAPHICS',
  'TYPOGRAPHY',
  'ANIMATION',
  'RENDERING',
  'RIGHTS_REVIEW',
  'QC',
] as const
export type HvsSpecialistKind = (typeof HVS_SPECIALIST_KINDS)[number]

const SPECIALIST_SYSTEM: Record<HvsSpecialistKind, string> = {
  CONCEPT: 'VideoIntelligence',
  WRITING: 'VideoIntelligence',
  STORY_STRUCTURE: 'VideoIntelligence',
  VISUAL_RESEARCH: 'VideoIntelligence',
  EDITING: 'EditOps',
  AUDIO: 'AudioGraph',
  GRAPHICS: 'EffectGraph',
  TYPOGRAPHY: 'Captions',
  ANIMATION: 'EffectGraph',
  RENDERING: 'UnifiedRenderEngine',
  RIGHTS_REVIEW: 'rights.ts',
  QC: 'qc-job',
}

export type HvsSpecialistTask = {
  id: string
  kind: HvsSpecialistKind
  system: string
  owner: 'HVS'
  foundryMission: false
  canPublish: false
  canSpend: false
  canDeclareCompletion: false
  commandKinds: Array<EditCommand['kind']>
}

export function specialistTasksFor(prompt: string): HvsSpecialistTask[] {
  const kinds: HvsSpecialistKind[] = ['EDITING', 'QC']
  if (/caption|typograph|title/i.test(prompt)) kinds.push('TYPOGRAPHY')
  if (/audio|volume|music/i.test(prompt)) kinds.push('AUDIO')
  if (/color|look/i.test(prompt)) kinds.push('GRAPHICS')
  if (/anim/i.test(prompt)) kinds.push('ANIMATION')
  if (/render|deliver/i.test(prompt)) kinds.push('RENDERING')
  if (/rights|provenance/i.test(prompt)) kinds.push('RIGHTS_REVIEW')
  if (/story|beat/i.test(prompt)) kinds.push('STORY_STRUCTURE')
  if (/cinematic|luxury|film|director plan|make video/i.test(prompt)) kinds.push('CONCEPT')
  if (/script|writing|copy|voiceover/i.test(prompt)) kinds.push('WRITING')
  if (/moodboard|reference|visual research/i.test(prompt)) kinds.push('VISUAL_RESEARCH')
  return [...new Set(kinds)].map(kind => ({
    id: `task-${kind.toLowerCase()}`,
    kind,
    system: SPECIALIST_SYSTEM[kind],
    owner: 'HVS' as const,
    foundryMission: false as const,
    canPublish: false as const,
    canSpend: false as const,
    canDeclareCompletion: false as const,
    commandKinds: kind === 'EDITING' ? ['trimClip', 'insertClip'] : kind === 'TYPOGRAPHY' ? ['updateCaption', 'updateTitle'] : [],
  }))
}

export function createUsesEditOps(): { system: 'EditOps'; kinds: readonly string[] } {
  return { system: 'EditOps', kinds: EDIT_COMMAND_KINDS }
}

export type HvsReviewOutcome = 'ACCEPT_FOR_QC' | 'REFINE_REQUIRED' | 'REPLAN_REQUIRED' | 'NEEDS_HUMAN'

export type HvsReviewResult = {
  outcome: HvsReviewOutcome
  elegance: { asked: boolean; note: string | null }
  creativePass: undefined
}

export function reviewProduction(input: {
  substantial: boolean
  structuralIssue?: boolean
  weakOutput?: boolean
  needsHuman?: boolean
}): HvsReviewResult {
  let outcome: HvsReviewOutcome = 'ACCEPT_FOR_QC'
  if (input.needsHuman) outcome = 'NEEDS_HUMAN'
  else if (input.structuralIssue) outcome = 'REPLAN_REQUIRED'
  else if (input.weakOutput) outcome = 'REFINE_REQUIRED'
  return {
    outcome,
    elegance: input.substantial
      ? { asked: true, note: 'Is there a more elegant, cinematic, effective solution?' }
      : { asked: false, note: null },
    creativePass: undefined,
  }
}

export function applyReplan(state: HvsWorkflowState, reason: string): HvsWorkflowState {
  const nextCount = state.replanCount + 1
  if (nextCount > state.maxReplans) {
    return {
      ...state,
      previousStage: state.currentStage,
      currentStage: 'STOPPED',
      replanCount: nextCount,
      stopReason: `Replan bound ${state.maxReplans} reached. ${reason}`,
      needsHuman: true,
    }
  }
  return {
    ...state,
    previousStage: state.currentStage,
    currentStage: 'REPLAN',
    replanCount: nextCount,
    stopReason: reason,
    needsHuman: false,
  }
}

export type HvsCompletionTruth = {
  PLAN_COMPLETED: boolean
  CREATE_COMPLETED: boolean
  REVIEW_COMPLETED: boolean
  QC_COMPLETED: boolean
  DELIVERY_READY: boolean
  DELIVERED: boolean
}

export function emptyCompletion(substantial: boolean): HvsCompletionTruth {
  return {
    PLAN_COMPLETED: false,
    CREATE_COMPLETED: false,
    REVIEW_COMPLETED: false,
    QC_COMPLETED: false,
    DELIVERY_READY: false,
    DELIVERED: false,
  }
}

export function markCompletion(state: HvsCompletionTruth, stage: HvsWorkflowStage): HvsCompletionTruth {
  const next = { ...state }
  if (stage === 'RESEARCH_PREPARE' || stage === 'CREATE') next.PLAN_COMPLETED = true
  if (stage === 'REVIEW') next.CREATE_COMPLETED = true
  if (stage === 'REFINE' || stage === 'QC') next.REVIEW_COMPLETED = true
  if (stage === 'DELIVER') next.QC_COMPLETED = true
  return next
}

export function deliveryReady(input: { completion: HvsCompletionTruth; blockingFail: boolean; commanderApproved: boolean }): boolean {
  if (input.blockingFail || !input.commanderApproved) return false
  return input.completion.QC_COMPLETED && !input.completion.DELIVERED
}

export function commanderRetainsDeliveryAuthority(): { mayPublishAutomatically: false; finalAuthority: 'COMMANDER' } {
  return { mayPublishAutomatically: mayPublishAutomatically(), finalAuthority: 'COMMANDER' }
}

export function planDoesNotMutateProject(beforeJson: string, afterJson: string): boolean {
  return beforeJson === afterJson
}

export function wrapExistingPlan(plan: HvsProductionPlan | null): { planner: 'HvsProductionPlan'; secondEngine: false; planId: string | null } {
  return { planner: 'HvsProductionPlan', secondEngine: false, planId: plan?.id ?? null }
}

export function retryIsNotReplan(): { retry: 're-execute current approved plan'; replan: 'alter plan because evidence changed' } {
  return {
    retry: 're-execute current approved plan',
    replan: 'alter plan because evidence changed',
  }
}

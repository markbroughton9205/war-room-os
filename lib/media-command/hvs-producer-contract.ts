/**
 * War Room → Higher Vision Studios producer entry contract.
 * Call HVS.createFromPrompt(...) from anywhere in War Room.
 * Does not mutate .hvsproj. MAKE VIDEO remains the local production approval.
 */
import { cloneProject, type HvsProject } from './types'
import { parseProductionIntent } from './production-intent'
import { buildProductionPlan, proveNoMutation } from './production-ai'
import type { HvsProductionIntent, HvsProductionPlan } from './production-ai-types'
import type { HvsPlanningConstraint } from './lessons/types'
import type { HvsCreativeApproach, HvsCreativeIntentAnalysis } from './creative-intelligence/types'
import { direct3DFromPrompt, build3DScene } from './director3d/contract'
import { planDestruction, simulateApprovedDestruction } from './destruction/contract'
import { directScene, buildScenePrevis, prepareShotConditioning } from './director/contract'
import { directCinemaFromPrompt, previewCinemaPlan } from './cinema-director/contract'
import { DigitalHumanHVS } from './digital-human/contract'
import { classifyProduction, commanderRetainsDeliveryAuthority, type HvsProductionClass } from './workflow-discipline'

export type HvsCreateFromPromptInput = {
  prompt: string
  projectId: string
  sourceAssetIds?: string[]
  planningConstraints?: HvsPlanningConstraint[]
  creativeApproach?: HvsCreativeApproach | null
  creativeIntent?: HvsCreativeIntentAnalysis | null
  creativeAnalysisId?: string | null
  projectContext?: {
    projectName?: string
  }
}

export type HvsCreateFromPromptResult = {
  intent: HvsProductionIntent
  plan: HvsProductionPlan
  approvalRequired: true
  approvalAction: 'MAKE_VIDEO'
  mutated: false
  projectId: string
  workflowClass?: HvsProductionClass
  deliveryAuthority?: ReturnType<typeof commanderRetainsDeliveryAuthority>
  lessonConstraintCount?: number
  lessonConstraintIds?: string[]
  automaticEditOp?: false
  creativeApproachId?: string
}

export function createFromPrompt(project: HvsProject, input: HvsCreateFromPromptInput): HvsCreateFromPromptResult {
  const before = cloneProject(project)
  const intent = parseProductionIntent({
    projectId: project.id,
    prompt: input.prompt,
    sourceAssetIds: input.sourceAssetIds,
  })
  const plan = buildProductionPlan(project, intent, { planningConstraints: input.planningConstraints,
    creativeApproach: input.creativeApproach,
    creativeIntent: input.creativeIntent,
    creativeAnalysisId: input.creativeAnalysisId,
  })
  const mutated = !proveNoMutation(before, project)
  if (mutated) {
    throw new Error('HVS.createFromPrompt must not mutate project truth.')
  }
  const constraints = plan.planningConstraints ?? []
  return {
    intent,
    plan,
    approvalRequired: true,
    approvalAction: 'MAKE_VIDEO',
    mutated: false,
    projectId: project.id,
    workflowClass: classifyProduction(input.prompt),
    deliveryAuthority: commanderRetainsDeliveryAuthority(),
    lessonConstraintCount: constraints.length,
    lessonConstraintIds: constraints.map(row => row.lessonId),
    automaticEditOp: false,
    creativeApproachId: plan.creativeApproachId,
  }
}

export const HVS = {
  createFromPrompt,
  direct3DFromPrompt,
  build3DScene,
  directCinemaFromPrompt,
  previewCinemaPlan,
  directScene,
  buildScenePrevis,
  planDestruction,
  simulateDestruction: simulateApprovedDestruction,
  prepareShotConditioning,
  castCharacter: DigitalHumanHVS.castCharacter,
  createFictionalActor: DigitalHumanHVS.createFictionalActor,
  createBackgroundPopulation: DigitalHumanHVS.createBackgroundPopulation,
  startPerformanceCapture: DigitalHumanHVS.startPerformanceCapture,
  stopPerformanceCapture: DigitalHumanHVS.stopPerformanceCapture,
  capturePerformance: DigitalHumanHVS.capturePerformance,
  recordPerformanceTake: DigitalHumanHVS.recordPerformanceTake,
  previewPerformance: DigitalHumanHVS.previewPerformance,
  bindHumanoidRig: DigitalHumanHVS.bindHumanoidRig,
  resolveCharacterBody: DigitalHumanHVS.resolveCharacterBody,
  previewHumanoidBody: DigitalHumanHVS.previewHumanoidBody,
  attachDirectorPerformance: DigitalHumanHVS.attachDirectorPerformance,
  assignPerformanceReference: DigitalHumanHVS.assignPerformanceReference,
  directPerformance: DigitalHumanHVS.directPerformance,
  getCharacter: DigitalHumanHVS.getCharacter,
  runCharacterQc: DigitalHumanHVS.runCharacterQc,
}

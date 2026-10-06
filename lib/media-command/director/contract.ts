import { cloneProject, type CharacterRecord, type HvsProject, type StoryboardFrame } from '../types'
import { apply3DOps } from '../director3d/ops'
import { attachDirector3D, pushSceneRevision, activeScene } from '../director3d/persist'
import { productionAuthorityOk } from '../production-ai'
import type { Hvs3DScene } from '../director3d/types'
import { authorizeRael } from '../digital-human/rael'
import { buildBackgroundPopulation } from '../digital-human/direction'
import { emptyDigitalHumanStore, type HvsBlockingPlan as HvsDigitalBlockingPlan } from '../digital-human/types'
import { buildDirectorPlan, resolveRaelIdentity } from './plan'
import { compileDirectorPlan } from './compile'
import { compileDirectorPlanToPrevis } from './previs'
import { compileProductionBlueprint } from './blueprint'
import { applyDirectorPlanPatch, parseDirectorPlanPatch } from './patch'
import { runDirectorQc } from './qc'
import { attachDirectorPlan } from './persist'
import { HVS_RAEL_CHARACTER_ID, type HvsDirectorPlan, type HvsDirectorPlanPatch, type HvsDirectorPrevis, type HvsDirectorQcReport, type HvsProductionBlueprint } from './types'
import { isDirectorOrchestrationPrompt } from './parse'
import { sceneTime } from './clock'

/** Director plans stay subordinate. They do not own workflow stages, lessons, or delivery. */
export const DIRECTOR_OWNS_HVS_WORKFLOW = false as const
import { attachAlleyDestruction, prepareShotConditioning, readShotStoryboard, writeShotStoryboard } from './real-destruction'

export type DirectSceneInput = {
  prompt: string
  projectId?: string
  assetRefs?: string[]
  elementRefs?: string[]
  castRefs?: string[]
  planningConstraints?: import('../lessons/types').HvsPlanningConstraint[]
  creativeApproach?: import('../creative-intelligence/types').HvsCreativeApproach | null
}

export type DirectSceneResult = {
  directorPlan: HvsDirectorPlan
  approvalRequired: true
  mutated: false
  projectId: string
  planningConstraints?: import('../lessons/types').HvsPlanningConstraint[]
  creativeApproachId?: string | null
  directorOwnsWorkflow: false
}

function raelRecord(identityRef: string): CharacterRecord {
  return {
    id: identityRef,
    name: "Ra'el",
    role: 'hero',
    notes: "Canonical Ra'el identity. Placeholder visual until a digital-human bind exists. Do not duplicate.",
    referenceAssetIds: [],
    identityMorphing: 'off',
  }
}

function bindRael(project: HvsProject, plan: HvsDirectorPlan): HvsProject {
  const next = cloneProject(project)
  next.digitalHumans = next.digitalHumans ?? emptyDigitalHumanStore()
  const identityRef = plan.characters[0]?.identityRef ?? HVS_RAEL_CHARACTER_ID
  authorizeRael(next.digitalHumans, 'commander')
  const existing = next.characters.find(item => item.id === identityRef || /^ra'?el$/i.test(item.name))
  if (!existing) next.characters.push(raelRecord(identityRef))
  const dhBlock: HvsDigitalBlockingPlan = {
    id: plan.blockingPlan.id,
    characterId: identityRef,
    startTransform: { position: { x: 1.7, y: 0, z: 0.35 }, yaw: Math.PI },
    endTransform: { position: { x: 0.55, y: 0, z: -11.5 }, yaw: plan.timing.lookBack ? 0 : Math.PI },
    motionPathId: plan.blockingPlan.pathId,
    marks: [
      { id: 'mark-car', code: 'MARK_A', name: 'beside car', position: { x: 1.7, y: 0, z: 0.35 } },
      { id: 'mark-door', code: 'MARK_B', name: 'doorway', position: { x: 0.55, y: 0, z: -11.5 } },
    ],
    actions: plan.blockingPlan.actions.map(item => item.description),
    shotIds: plan.shots.map(item => item.id),
  }
  next.digitalHumans.blockingPlans = [
    dhBlock,
    ...next.digitalHumans.blockingPlans.filter(item => item.id !== dhBlock.id && item.characterId !== identityRef),
  ]
  const crowd = buildBackgroundPopulation({
    count: plan.backgroundPopulation.count,
    profile: 'night alley extras',
    walking: plan.backgroundPopulation.actors.filter(item => item.role === 'WALKING').length,
    standing: plan.backgroundPopulation.actors.filter(item => item.role === 'STOREFRONT').length,
    seed: 12,
    collapseAtSec: plan.timing.crowdReactSec,
  })
  crowd.id = plan.backgroundPopulation.id
  if (crowd.reaction) crowd.reaction.triggerTime = sceneTime(plan.timing.crowdReactSec)
  next.digitalHumans.populations = [crowd, ...next.digitalHumans.populations.filter(item => item.id !== crowd.id)]
  next.digitalHumans.activeCharacterId = identityRef
  return next
}

function storyboardFrames(previs: HvsDirectorPrevis): StoryboardFrame[] {
  return previs.storyboard.map((frame): StoryboardFrame => ({
    id: frame.id,
    index: frame.index,
    title: frame.title,
    description: frame.description,
    assetId: frame.derivedAssetId,
    duration: frame.time,
    shotId: frame.shotId,
    backgroundPopulationId: 'crowd-alley',
    castRoleIds: [HVS_RAEL_CHARACTER_ID],
  }))
}

function ensureDirectorSafetyVersion(project: HvsProject, plan: HvsDirectorPlan): HvsProject {
  const label = `Director orchestration safety — ${plan.id}`
  if (project.versions.some(item => item.label === label)) return project
  const next = cloneProject(project)
  const index = next.versions.length + 1
  next.versions.push({
    id: `ver-director-${plan.id}`,
    projectId: next.id,
    index,
    label,
    createdAt: new Date().toISOString(),
    createdBy: 'system',
    parentVersionId: next.currentVersionId,
    snapshotPath: '',
    aspect: next.timeline.aspect,
    role: 'master',
    derivedFromVersionId: next.currentVersionId,
    description: 'Safety version before an accepted Director revision.',
  })
  return next
}

export function directScene(project: HvsProject, input: DirectSceneInput): DirectSceneResult {
  const before = cloneProject(project)
  const identityRef = input.castRefs?.[0] ?? resolveRaelIdentity(project.characters, project.digitalHumans?.characters)
  const directorPlan = buildDirectorPlan({ prompt: input.prompt, projectId: project.id, identityRef })
  if (JSON.stringify(before.timeline) !== JSON.stringify(project.timeline)) {
    throw new Error('HVS.directScene must not mutate timeline truth.')
  }
  if (JSON.stringify(before.director3d ?? null) !== JSON.stringify(project.director3d ?? null)) {
    throw new Error('HVS.directScene must not mutate 3D scene truth.')
  }
  return {
    directorPlan,
    approvalRequired: true,
    mutated: false,
    projectId: project.id,
    planningConstraints: input.planningConstraints ?? [],
    creativeApproachId: input.creativeApproach?.id ?? null,
    directorOwnsWorkflow: DIRECTOR_OWNS_HVS_WORKFLOW,
  }
}

export function buildScenePrevis(project: HvsProject, plan: HvsDirectorPlan, opts?: { approved?: boolean }): {
  project: HvsProject
  scene: Hvs3DScene
  previs: HvsDirectorPrevis
  qc: HvsDirectorQcReport
  opsCount: number
  plan: HvsDirectorPlan
} {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (!opts?.approved && plan.status === 'proposed') {
    throw new Error('BUILD PREVIS approval is required before the scene can mutate.')
  }
  const compiled = compileDirectorPlan(plan)
  const scene = apply3DOps(compiled.scene, compiled.ops)
  const nextPlan: HvsDirectorPlan = { ...plan, sceneId: scene.id, status: 'previs', updatedAt: new Date().toISOString() }
  let next = bindRael(project, nextPlan)
  if (nextPlan.destructionPlan?.performanceTier === 'SMALL') {
    attachAlleyDestruction(next, nextPlan, scene)
  }
  const previs = compileDirectorPlanToPrevis(nextPlan, scene)
  writeShotStoryboard(next.destruction?.alleyBinding ?? null, previs)
  const qc = runDirectorQc(nextPlan, scene)
  next = attachDirector3D(next, scene)
  next = attachDirectorPlan(next, nextPlan)
  next = pushSceneRevision(next, scene, 'BUILD PREVIS')
  next.storyboard = storyboardFrames(previs)
  next.updatedAt = new Date().toISOString()
  return { project: next, scene, previs, qc, opsCount: compiled.ops.length, plan: nextPlan }
}

export function applyDirectorRevision(project: HvsProject, currentPlan: HvsDirectorPlan, patch: HvsDirectorPlanPatch, opts?: { approved?: boolean }): {
  project: HvsProject
  scene: Hvs3DScene
  plan: HvsDirectorPlan
  previs: HvsDirectorPrevis
  qc: HvsDirectorQcReport
} {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (!opts?.approved && patch.status === 'proposed') {
    throw new Error('Revision approval is required before the Director plan can mutate.')
  }
  const nextPlan = applyDirectorPlanPatch(currentPlan, { ...patch, status: 'applied' })
  const compiled = compileDirectorPlan(nextPlan)
  const scene = apply3DOps(compiled.scene, compiled.ops)
  const plan = { ...nextPlan, sceneId: scene.id, status: 'previs' as const }
  let next = ensureDirectorSafetyVersion(project, currentPlan)
  next = bindRael(next, plan)
  const cameraOnly = patch.kinds.every(kind => kind === 'CHANGE_CAMERA' || kind === 'CHANGE_LENS' || kind === 'CHANGE_FRAMING' || kind === 'CHANGE_FOCUS')
  if (plan.destructionPlan?.performanceTier === 'SMALL') {
    attachAlleyDestruction(next, plan, scene, cameraOnly ? undefined : patch.prompt)
  }
  const previousBoards = readShotStoryboard(project.destruction?.alleyBinding ?? null)
  const previs = compileDirectorPlanToPrevis(plan, scene)
  if (cameraOnly && previousBoards.size) {
    previs.storyboard = previs.storyboard.map(frame => {
      if (frame.shotId === 'shot-5') return { ...frame, description: `${frame.description} · refreshed` }
      const svg = previousBoards.get(frame.shotId)
      return svg ? { ...frame, svg } : frame
    })
    previs.artifactRefs = [`refreshed:shot-5`, ...previs.artifactRefs.filter(item => item !== 'refreshed:shot-5')]
  }
  writeShotStoryboard(next.destruction?.alleyBinding ?? null, previs)
  const qc = runDirectorQc(plan, scene)
  next = attachDirector3D(next, scene)
  next = attachDirectorPlan(next, plan)
  next = pushSceneRevision(next, scene, patch.prompt.slice(0, 80))
  next.storyboard = storyboardFrames(previs)
  return { project: next, scene, plan, previs, qc }
}

export function useDirectorScene(project: HvsProject, plan: HvsDirectorPlan, previs: HvsDirectorPrevis): {
  project: HvsProject
  blueprint: HvsProductionBlueprint
  generatorAuthorized: false
} {
  const scene = activeScene(project)
  if (!scene) throw new Error('No scene to approve.')
  const blueprint = compileProductionBlueprint(plan, scene, previs)
  const next = attachDirectorPlan(cloneProject(project), { ...plan, status: 'approved' })
  const store = next.director3d
  if (store) next.director3d = { ...store, approvedBlueprintId: blueprint.id, activeSceneId: scene.id }
  next.updatedAt = new Date().toISOString()
  return { project: next, blueprint, generatorAuthorized: false }
}

export { parseDirectorPlanPatch, isDirectorOrchestrationPrompt, prepareShotConditioning }

import { cloneProject, emptyProject, type HvsProject } from '../types'
import { parse3DIntent } from './intent'
import { buildScenePlan } from './plan'
import { compileApprovedPlan } from './compile'
import { apply3DOps } from './ops'
import { applyPatch } from './patch'
import { attachDirector3D, pushSceneRevision, activeScene } from './persist'
import { compile3DProductionBlueprint } from './blueprint'
import type { Hvs3DIntent, Hvs3DPlanPatch, Hvs3DScene, HvsProductionBlueprint3D, HvsScenePlan } from './types'
import { productionAuthorityOk } from '../production-ai'

export type Direct3DFromPromptInput = {
  prompt: string
  projectId?: string
  assetRefs?: string[]
}

export type Direct3DFromPromptResult = {
  intent: Hvs3DIntent
  scenePlan: HvsScenePlan
  approvalRequired: true
  mutated: false
  projectId: string
}

export function direct3DFromPrompt(project: HvsProject, input: Direct3DFromPromptInput): Direct3DFromPromptResult {
  const before = cloneProject(project)
  const intent = parse3DIntent({ prompt: input.prompt, projectId: project.id })
  const scenePlan = buildScenePlan(intent)
  if (JSON.stringify(before.timeline) !== JSON.stringify(project.timeline)) {
    throw new Error('HVS.direct3DFromPrompt must not mutate timeline truth.')
  }
  if (JSON.stringify(before.director3d ?? null) !== JSON.stringify(project.director3d ?? null)) {
    throw new Error('HVS.direct3DFromPrompt must not mutate 3D scene truth.')
  }
  return {
    intent,
    scenePlan,
    approvalRequired: true,
    mutated: false,
    projectId: project.id,
  }
}

export function build3DScene(project: HvsProject, intent: Hvs3DIntent, plan: HvsScenePlan, opts?: { approved?: boolean }): {
  project: HvsProject
  scene: Hvs3DScene
  opsCount: number
} {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (!opts?.approved && plan.status === 'proposed') {
    throw new Error('BUILD SCENE approval is required before the 3D scene can mutate.')
  }
  const compiled = compileApprovedPlan(intent, { ...plan, status: 'approved' })
  const scene = apply3DOps(compiled.scene, compiled.ops)
  let next = attachDirector3D(project, scene)
  next = pushSceneRevision(next, scene, 'BUILD SCENE')
  return { project: next, scene, opsCount: compiled.ops.length }
}

export function apply3DRevision(project: HvsProject, patch: Hvs3DPlanPatch, opts?: { approved?: boolean }): {
  project: HvsProject
  scene: Hvs3DScene
} {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (!opts?.approved && patch.status === 'proposed') {
    throw new Error('Revision approval is required before the 3D scene can mutate.')
  }
  const scene = activeScene(project)
  if (!scene) throw new Error('No 3D scene to revise.')
  const nextScene = applyPatch(scene, { ...patch, status: 'applied' })
  let next = attachDirector3D(project, nextScene)
  next = pushSceneRevision(next, nextScene, patch.prompt.slice(0, 80))
  return { project: next, scene: nextScene }
}

export function useThisScene(project: HvsProject): {
  project: HvsProject
  blueprint: HvsProductionBlueprint3D
  generatorAuthorized: false
} {
  const scene = activeScene(project)
  if (!scene) throw new Error('No 3D scene to use.')
  const blueprint = compile3DProductionBlueprint(scene)
  const next = cloneProject(project)
  const store = next.director3d ?? { activeSceneId: scene.id, scenes: [scene], revisions: [], approvedBlueprintId: null }
  next.director3d = { ...store, approvedBlueprintId: blueprint.id, activeSceneId: scene.id }
  next.updatedAt = new Date().toISOString()
  return { project: next, blueprint, generatorAuthorized: false }
}

export function ensureProjectForDirector(project: HvsProject | null, prompt: string): HvsProject {
  if (project) return project
  return emptyProject({
    id: `hvs3d-${Date.now().toString(36)}`,
    name: prompt.slice(0, 48) || '3D Director scene',
  })
}

export const HVS_3D = {
  direct3DFromPrompt,
  build3DScene,
  apply3DRevision,
  useThisScene,
}

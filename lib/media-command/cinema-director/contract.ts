import { cloneProject, emptyProject, type HvsProject } from '../types'
import { parseCinemaIntent } from './parse'
import { buildCinemaPlan } from './plan'
import { compileCinemaScene } from './compile'
import { apply3DOps } from '../director3d/ops'
import { applyCameraPlanPatch, parseCameraPlanPatch } from './patch'
import { attachCinemaPrevis } from './persist'
import type { HvsCameraPlanPatch, HvsCinemaIntent, HvsCinemaPlan } from './types'
import { productionAuthorityOk } from '../production-ai'
import type { Hvs3DScene } from '../director3d/types'

export type DirectCinemaFromPromptInput = {
  prompt: string
  projectId?: string
}

export type DirectCinemaFromPromptResult = {
  intent: HvsCinemaIntent
  plan: HvsCinemaPlan
  approvalRequired: true
  mutated: false
  projectId: string
}

export function directCinemaFromPrompt(project: HvsProject, input: DirectCinemaFromPromptInput): DirectCinemaFromPromptResult {
  const before = cloneProject(project)
  const intent = parseCinemaIntent({ prompt: input.prompt, projectId: project.id })
  const plan = buildCinemaPlan(intent)
  if (JSON.stringify(before.timeline) !== JSON.stringify(project.timeline)) {
    throw new Error('HVS.directCinemaFromPrompt must not mutate timeline truth.')
  }
  if (JSON.stringify(before.cinemaDirector ?? null) !== JSON.stringify(project.cinemaDirector ?? null)) {
    throw new Error('HVS.directCinemaFromPrompt must not mutate cinema plan truth.')
  }
  if (JSON.stringify(before.director3d ?? null) !== JSON.stringify(project.director3d ?? null)) {
    throw new Error('HVS.directCinemaFromPrompt must not mutate 3D scene truth.')
  }
  return {
    intent,
    plan,
    approvalRequired: true,
    mutated: false,
    projectId: project.id,
  }
}

export function previewCinemaPlan(project: HvsProject, intent: HvsCinemaIntent, plan: HvsCinemaPlan, opts?: { approved?: boolean }): {
  project: HvsProject
  scene: Hvs3DScene
  plan: HvsCinemaPlan
} {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (!opts?.approved && plan.status === 'proposed') {
    throw new Error('PREVIEW approval is required before the cinema scene can mutate.')
  }
  const compiled = compileCinemaScene(intent, { ...plan, status: 'approved' })
  const scene = apply3DOps(compiled.scene, compiled.ops)
  const built: HvsCinemaPlan = { ...plan, status: 'built', shots: plan.shots.map(shot => ({ ...shot, status: 'built' })) }
  const next = attachCinemaPrevis(project, built, scene)
  return { project: next, scene, plan: built }
}

export function applyCinemaRevision(project: HvsProject, intent: HvsCinemaIntent, plan: HvsCinemaPlan, patch: HvsCameraPlanPatch, opts?: { approved?: boolean }): {
  project: HvsProject
  scene: Hvs3DScene
  plan: HvsCinemaPlan
} {
  const authority = productionAuthorityOk()
  if (!authority.ok) throw new Error(authority.error)
  if (!opts?.approved && patch.status === 'proposed') {
    throw new Error('Revision approval is required before the cinema scene can mutate.')
  }
  const revised = applyCameraPlanPatch(plan, { ...patch, status: 'applied' })
  revised.status = 'built'
  const compiled = compileCinemaScene(intent, revised)
  compiled.scene.id = plan.sceneId
  const scene = apply3DOps(compiled.scene, compiled.ops)
  const next = attachCinemaPrevis(project, revised, scene)
  return { project: next, scene, plan: revised }
}

export function proposeCinemaRevision(plan: HvsCinemaPlan, prompt: string): HvsCameraPlanPatch {
  return parseCameraPlanPatch(plan, prompt)
}

export function ensureProjectForCinema(project: HvsProject | null, prompt: string): HvsProject {
  if (project) return project
  return emptyProject({
    id: `hvscin-${Date.now().toString(36)}`,
    name: prompt.slice(0, 48) || 'Cinema Director sequence',
  })
}

export const HVS_CINEMA = {
  directCinemaFromPrompt,
  previewCinemaPlan,
  applyCinemaRevision,
}

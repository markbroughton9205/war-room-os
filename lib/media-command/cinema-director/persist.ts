import { cloneProject, type HvsProject } from '../types'
import { attachDirector3D } from '../director3d/persist'
import type { Hvs3DScene } from '../director3d/types'
import { emptyCinemaDirectorStore, type HvsCinemaPlan } from './types'

export function cinemaStore(project: HvsProject) {
  return project.cinemaDirector ?? emptyCinemaDirectorStore()
}

export function activeCinemaPlan(project: HvsProject): HvsCinemaPlan | null {
  const store = cinemaStore(project)
  if (!store.activePlanId) return store.plans[0] ?? null
  return store.plans.find(item => item.id === store.activePlanId) ?? store.plans[0] ?? null
}

export function attachCinemaPlan(project: HvsProject, plan: HvsCinemaPlan): HvsProject {
  const next = cloneProject(project)
  const store = cinemaStore(next)
  const plans = store.plans.filter(item => item.id !== plan.id)
  plans.unshift(plan)
  next.cinemaDirector = {
    schemaVersion: 1,
    activePlanId: plan.id,
    plans,
  }
  next.timeline = {
    ...next.timeline,
    cameraSpecs: plan.specs,
  }
  next.updatedAt = new Date().toISOString()
  return next
}

export function attachCinemaPrevis(project: HvsProject, plan: HvsCinemaPlan, scene: Hvs3DScene): HvsProject {
  let next = attachCinemaPlan(project, plan)
  next = attachDirector3D(next, scene)
  return next
}

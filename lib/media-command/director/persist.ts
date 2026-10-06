import { cloneProject, type HvsProject } from '../types'
import { emptyDirectorOrchestrationStore, type HvsDirectorPlan } from './types'

export function directorOrchestrationStore(project: HvsProject) {
  return project.directorOrchestration ?? emptyDirectorOrchestrationStore()
}

export function activeDirectorPlan(project: HvsProject): HvsDirectorPlan | null {
  const store = directorOrchestrationStore(project)
  if (!store.activePlanId) return store.plans[0] ?? null
  return store.plans.find(item => item.id === store.activePlanId) ?? store.plans[0] ?? null
}

export function attachDirectorPlan(project: HvsProject, plan: HvsDirectorPlan): HvsProject {
  const next = cloneProject(project)
  const store = directorOrchestrationStore(next)
  const plans = store.plans.filter(item => item.id !== plan.id)
  plans.unshift(plan)
  next.directorOrchestration = {
    schemaVersion: 1,
    activePlanId: plan.id,
    plans,
  }
  next.updatedAt = new Date().toISOString()
  return next
}

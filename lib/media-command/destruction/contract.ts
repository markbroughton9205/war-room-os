import type { HvsProject } from '../types'
import { parseDestructionIntent } from './intent'
import { buildDestructionPlan } from './plan'
import { simulateDestruction, type DestructionRunReport } from './execute'
import type { HvsDestructionIntent, HvsDestructionPlan } from './types'

export function planDestruction(project: HvsProject, input: {
  prompt: string
  projectId?: string
  sceneId?: string
  targetRefs?: string[]
}): {
  intent: HvsDestructionIntent
  plan: HvsDestructionPlan
  approvalRequired: true
  mutated: false
} {
  const before = JSON.stringify(project)
  const intent = parseDestructionIntent({
    prompt: input.prompt,
    projectId: input.projectId ?? project.id,
    sceneId: input.sceneId,
    targetRefs: input.targetRefs,
  })
  const plan = buildDestructionPlan(intent)
  if (JSON.stringify(project) !== before) {
    throw new Error('HVS.planDestruction must not mutate project truth.')
  }
  return { intent, plan, approvalRequired: true, mutated: false }
}

export async function simulateApprovedDestruction(project: HvsProject, input: {
  planId: string
  plan: HvsDestructionPlan
  intent: HvsDestructionIntent
  approval: boolean
}): Promise<DestructionRunReport> {
  if (input.plan.id !== input.planId) throw new Error('planId does not match the plan.')
  return simulateDestruction(project, {
    plan: input.plan,
    intent: input.intent,
    approval: input.approval,
  })
}

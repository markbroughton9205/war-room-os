import type { SkillAcquisitionPlan, SkillGap } from './types'

export const SKILL_ACQUISITION_STEPS = [
  'identify required skills',
  'find missing skill',
  'inspect authoritative sources',
  'build temporary knowledge context',
  'perform sandbox evaluation',
  'record EVALUATED or FAILED from evidence only',
  'use skill in mission only after evaluation policy allows',
  'mark PRODUCTION_PROVEN only after a real production mission succeeds',
  'save repo-specific lessons into Engineering Memory, not the Atlas general record',
] as const

export function planSkillAcquisition(gap: SkillGap): SkillAcquisitionPlan {
  return {
    skillId: gap.skillId,
    requiredForMission: gap.requiredForMission,
    steps: [...SKILL_ACQUISITION_STEPS],
    autoTrustResearch: false,
    wrimTraining: false,
    terraMutation: false,
    commit: false,
    push: false,
    sandboxEvaluationRequired: true,
  }
}

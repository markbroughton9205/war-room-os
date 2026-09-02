import type { CurriculumStage } from './types'

/** Design only. Phase 1 does not run autonomous adapter training. */
export const FUTURE_CAPABILITY_CURRICULUM_PATH: readonly CurriculumStage[] = [
  'runtime_experience',
  'evidence_validation',
  'capability_curriculum_candidate',
  'adapter_training_dataset',
  'clean_heldout_eval',
  'shadow_adapter_training',
  'evaluation',
  'candidate',
  'commander_promotion_decision',
] as const

export function nextCurriculumStage(current: CurriculumStage): CurriculumStage | null {
  const i = FUTURE_CAPABILITY_CURRICULUM_PATH.indexOf(current)
  if (i < 0 || i === FUTURE_CAPABILITY_CURRICULUM_PATH.length - 1) return null
  return FUTURE_CAPABILITY_CURRICULUM_PATH[i + 1]
}

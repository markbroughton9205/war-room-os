/**
 * External EleutherAI LM Evaluation Harness lane.
 * Does not replace sovereign WRIM evals. Cannot promote a model.
 */
import { LM_HARNESS_EXCLUDED_THIS_PASS, LM_HARNESS_STARTER_TASKS } from './labIdentity'

export const LM_HARNESS_PROMOTION = 'DENIED' as const

export function lmHarnessMayPromote(): false {
  return false
}

export function starterTasks() {
  return LM_HARNESS_STARTER_TASKS
}

export function excludedGiantSuites() {
  return LM_HARNESS_EXCLUDED_THIS_PASS
}

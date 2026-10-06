/**
 * Two-stage JUMP/GO refinement.
 * Stage 1 may be STREET — APPROXIMATE. Stage 2 flies only if precision improves.
 * Commander camera grab cancels automatic Stage 2.
 */

import { precisionImproves, type TerraPlaceMatchClass } from './matchClass'

export type RefinementStage = 'idle' | 'stage1' | 'refining' | 'stage2' | 'held_for_user' | 'complete' | 'unavailable'

export type RefinementDecision =
  | { action: 'fly_stage1_only'; reason: string }
  | { action: 'fly_stage2'; reason: string }
  | { action: 'skip_stage2_interrupt'; reason: string }
  | { action: 'skip_stage2_no_improve'; reason: string }
  | { action: 'wait_then_stage2'; reason: string }

export function decideRefinementFlight(input: {
  interrupted: boolean
  stage1Class: TerraPlaceMatchClass | null | undefined
  stage2Class: TerraPlaceMatchClass | null | undefined
  enrichmentState: string | null | undefined
}): RefinementDecision {
  if (input.interrupted) {
    return { action: 'skip_stage2_interrupt', reason: 'Commander moved the camera — automatic refinement cancelled.' }
  }
  if (!input.stage2Class || input.enrichmentState === 'unavailable' || input.enrichmentState === 'no_coverage') {
    return { action: 'fly_stage1_only', reason: 'Precision enrichment unavailable — keep honest Stage 1 class.' }
  }
  if (!precisionImproves(input.stage1Class, input.stage2Class)) {
    return { action: 'skip_stage2_no_improve', reason: 'Enrichment did not improve precision — no camera steal.' }
  }
  return { action: 'fly_stage2', reason: 'Precision improved — replace Stage 1 with authoritative geometry.' }
}

export function shouldWaitForFastEnrichment(elapsedMs: number, enriched: boolean): boolean {
  return !enriched && elapsedMs < 400
}

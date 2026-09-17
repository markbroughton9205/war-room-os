/**
 * Honest coverage vocabulary for every God's Eye layer.
 * STATIC infrastructure is never reported as LIVE. Empty coverage is never "all clear."
 */
export const GODS_EYE_LAYER_TRUTH_STATES = [
  'LIVE',
  'CACHED',
  'STALE',
  'PARTIAL',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'UNAVAILABLE',
] as const
export type GodsEyeLayerTruthState = (typeof GODS_EYE_LAYER_TRUTH_STATES)[number]

export const GODS_EYE_EVALUATION_STATES = [
  'ACTIVE',
  'EVALUATION_ACTIVE',
  'PARTIAL',
  'NO_COVERAGE',
  'BLOCKED',
  'UNAVAILABLE',
  'DISABLED',
] as const
export type GodsEyeEvaluationState = (typeof GODS_EYE_EVALUATION_STATES)[number]

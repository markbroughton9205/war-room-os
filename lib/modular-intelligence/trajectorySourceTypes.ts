export const SOURCE_TYPES = [
  'REAL_RUNTIME',
  'REAL_TEST',
  'TEST_FIXTURE',
  'GYM_FIXTURE',
  'REPLAY',
  'SYNTHETIC',
  'HARD_NEGATIVE',
  'COUNTERFACTUAL',
  'UNKNOWN',
] as const

export type TrajectorySourceType = (typeof SOURCE_TYPES)[number]

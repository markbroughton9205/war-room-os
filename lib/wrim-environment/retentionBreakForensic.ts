/**
 * WRIM1-RUN-000005 retention-break forensic audit identity.
 * Analysis only. Zero optimizer steps. Does not authorize P3 or STAGE3B.
 */
export const RETENTION_BREAK_FORENSIC_KIND = 'WRIM_RETENTION_BREAK_FORENSIC' as const
export const RETENTION_BREAK_FORENSIC_RUN_ID = 'WRIM1-RUN-000005' as const
export const RETENTION_BREAK_FORENSIC_CLASSIFICATIONS = [
  'RETENTION_BREAK_ROOT_CAUSE_IDENTIFIED',
  'RETENTION_BREAK_MULTI_CAUSAL',
  'RETENTION_BREAK_INCONCLUSIVE',
] as const
export type RetentionBreakForensicClassification =
  (typeof RETENTION_BREAK_FORENSIC_CLASSIFICATIONS)[number]
export const RETENTION_BREAK_HARD_ABORT_DNLL = 0.105 as const
export const RETENTION_BREAK_TOKENS = 204_800 as const
export const RETENTION_BREAK_HALT_STEP = 50 as const

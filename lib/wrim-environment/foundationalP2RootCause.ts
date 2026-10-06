/**
 * WRIM1-RUN-000005 P2 post-mortem / retention-break root-cause audit.
 * Analysis only. Zero optimizer steps. STAGE3B remains NO.
 */
export const P2_ROOT_CAUSE_KIND = 'WRIM_FOUNDATIONAL_P2_ROOT_CAUSE' as const
export const P2_ROOT_CAUSE_CLASSIFICATIONS = [
  'P2_ROOT_CAUSE_IDENTIFIED',
  'P2_ROOT_CAUSE_PARTIAL',
  'P2_ROOT_CAUSE_INCONCLUSIVE',
] as const

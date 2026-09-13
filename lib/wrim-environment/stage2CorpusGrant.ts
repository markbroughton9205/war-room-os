/**
 * Bounded Stage 2 historical-corpus authorization.
 * Applies ONLY to WRIM1-NEBULA-STAB-000001. Does not promote global eligibility.
 * Does not authorize Stage 3 / WRIM1-RUN-000003.
 */
export const STAGE2_CORPUS_GRANT = {
  id: 'STAGE2_HISTORICAL_CORPUS_AUTHORIZATION',
  runId: 'WRIM1-NEBULA-STAB-000001',
  classification: 'TEST_ONLY',
  appliesOnlyTo: 'WRIM1-NEBULA-STAB-000001',
  authorizedCorpora: [
    'WR-CORPUS-0 rehearsal (WRM-001 train split lineage)',
    'WR-CORPUS-1-HARDENED train shard after eval-infra + TOOL_USE exclusion',
  ],
  notAuthorized: [
    'WRIM1-RUN-000003',
    'Stage 3',
    'WR-CORPUS-ACTIVE',
    'global ELIGIBLE promotion of historical records',
    'test shard',
    'eval-only suites',
  ],
  globalHistoricalEligibilityPromoted: false,
} as const

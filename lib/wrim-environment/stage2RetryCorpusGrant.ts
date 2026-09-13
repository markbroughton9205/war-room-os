/**
 * Bounded STAB-000002 historical-corpus authorization.
 * Applies ONLY to WRIM1-NEBULA-STAB-000002. Does not promote global eligibility.
 * Does not authorize Stage 3 / WRIM1-RUN-000003. Does not continue STAB-000001.
 */
export const STAGE2_RETRY_CORPUS_GRANT = {
  id: 'STAGE2_RETRY_HISTORICAL_CORPUS_AUTHORIZATION',
  runId: 'WRIM1-NEBULA-STAB-000002',
  classification: 'TEST_ONLY',
  appliesOnlyTo: 'WRIM1-NEBULA-STAB-000002',
  authorizedCorpora: [
    'WR-CORPUS-0 rehearsal (document-balanced across all 5 genesis documents)',
    'WR-CORPUS-1-HARDENED train shard after eval-infra + TOOL_USE exclusion; code <= 18% of total tokens',
  ],
  notAuthorized: [
    'WRIM1-RUN-000003',
    'Stage 3',
    'WR-CORPUS-ACTIVE',
    'global ELIGIBLE promotion of historical records',
    'test shard',
    'eval-only suites',
    'retention prompts',
    'STAB-000001 continuation',
  ],
  globalHistoricalEligibilityPromoted: false,
} as const

/**
 * Bounded controlled-stability historical-corpus authorization.
 * Applies ONLY to WRIM1-NEBULA-CTRL-STAB-000001. Does not promote global eligibility.
 * Does not authorize Stage 3 / WRIM1-RUN-000003.
 */
export const CONTROLLED_STABILITY_CORPUS_GRANT = {
  id: 'CONTROLLED_STABILITY_HISTORICAL_CORPUS_AUTHORIZATION',
  runId: 'WRIM1-NEBULA-CTRL-STAB-000001',
  classification: 'TEST_ONLY / CONTROLLED_EXPERIMENT',
  appliesOnlyTo: 'WRIM1-NEBULA-CTRL-STAB-000001',
  authorizedCorpora: [
    'WR-CORPUS-0 rehearsal (WRM-001 train split lineage)',
    'WR-CORPUS-1-HARDENED train shard after eval-infra + TOOL_USE exclusion',
  ],
  lockedWrCorpus1Mix: {
    wr_corpus_0: 0.3,
    prose: 0.341,
    code: 0.256,
    json: 0.086,
    behavior: 0.017,
  },
  factorsOnly: ['rehearsal_strategy', 'peak_lr', 'seed'],
  notAuthorized: [
    'WRIM1-RUN-000003',
    'Stage 3',
    'WR-CORPUS-ACTIVE',
    'TOOL_USE',
    'changing code percentage between experimental cells',
    'global ELIGIBLE promotion of historical records',
    'test shard',
    'eval-only suites',
    'promotion',
    'Qwen replacement',
    "Ra'el",
    'sparse experts',
  ],
  globalHistoricalEligibilityPromoted: false,
} as const

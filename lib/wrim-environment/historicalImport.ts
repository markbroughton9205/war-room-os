/**
 * Historical WRIM run import catalog. Import what exists. Missing metrics stay UNKNOWN.
 * Imports are marked IMPORTED_HISTORICAL — instrumentation is not pretended to have existed live.
 */
export const HISTORICAL_RUN_IDS = [
  'WRIM-0',
  'WRIM1-RUN-000001',
  'WRIM1-RUN-000002',
  'WRIM1-RUN-000003',
  'WRIM1-RUN-000004',
  'WRIM1-RUN-000005',
] as const

export const RUN_000005_IMPORT = {
  run_id: 'WRIM1-RUN-000005',
  status: 'STOPPED_BY_POLICY',
  steps: 50,
  tokens: 204800,
  terminal_reason: 'dnll_gt_0.105',
  stream_sha: '5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5',
  recipe_sha: '5b6237dcad4321111510453c9bfcb6713a8f61a8218c487afd67952a42d18117',
  trajectory_steps: [0, 5, 10, 25, 50],
} as const

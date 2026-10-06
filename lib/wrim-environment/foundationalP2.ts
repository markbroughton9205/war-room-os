/**
 * WRIM1-RUN-000005 P2 sovereign foundational CLM diagnostic.
 * Commander authorized the seed-2303 run. Optimizer hyperparameters were not
 * frozen in the foundational remediation design. Do not invent them.
 */
export const P2_RUN_ID = 'WRIM1-RUN-000005' as const
export const P2_KIND = 'WRIM_FOUNDATIONAL_P2_DIAGNOSTIC' as const
export const P2_CLASSIFICATION_INCOMPLETE = 'P2_AUTHORIZED_BUT_CONFIGURATION_INCOMPLETE' as const
export const P2_SOVEREIGN_STREAM_SHA256 =
  '5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5' as const
export const P2_SOVEREIGN_PACKED_SOURCE_SHA256 =
  '83e9478376386fd2e1d02a26891fab0ec6714063445e5915bbb06376a7ca5011' as const
export const FORBIDDEN_P1_STREAM_SHA256 =
  '166139473acf7edc5d12210cfa3b456b3bcbc2b56efb0674671da7e8a09796ed' as const
export const FORBIDDEN_2302_STREAM_SHA256 =
  'a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0' as const
export const FORBIDDEN_2302_PACKED_SOURCE_SHA256 =
  '9844a37624de63b8da441dea8abe7582e274183632b151cced565e66d217c46f' as const
export const P2_COMPACT_CADENCE = [0, 5, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as const
export const P2_FULL_CADENCE = [0, 100, 500, 1000] as const
export const P2_MAX_STEPS = 1000 as const
export const P2_MAX_TOKENS = 4_096_000 as const
export const P2_EXCLUDED_DOCUMENTS = [
  'CLAUDE.md',
  'docs/ENGINEERING_COMPLETION_STANDARD.md',
  'docs/WAVE_3_ACTIVE_LEARNING_REPORT.md',
] as const

/**
 * LOCAL intel entry. The seed registry + matcher live in `lib/terra/localSources/`.
 * This file exists so `@/lib/terra/localSources` resolves to that implementation
 * (bundler moduleResolution prefers `localSources.ts` over `localSources/index.ts`).
 */
export type {
  TerraLocalAreaCoverage,
  TerraLocalContext,
  TerraLocalCoverageLevel,
  TerraLocalFetchedItem,
  TerraLocalIntelReport,
  TerraLocalMatchedSource,
  TerraLocalMixRow,
  TerraLocalSource,
  TerraLocalSourceHealth,
  TerraLocalSourceType,
} from './localSources/types'
export { TERRA_LOCAL_SOURCE_SEEDS } from './localSources/registry'
export { parseLocalContext, formatLocalShortLabel } from './localSources/context'
export { matchLocalSources, localSourceTouchesContext, classifyAreaCoverage, summarizeLocalRuntimeHealth } from './localSources/match'
export { qualifyLocalStory } from './localSources/qualify'
export { loadTerraLocalIntel, localTypeStatus } from './localSources/fetch'

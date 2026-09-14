import type { CoverageCellStatus, TerraInfoLayer } from './types'
import type { InMemorySourceFabric } from './sourceFabric'
import type { CoverageCell } from './types'

export type TerraCoverageCounts = {
  activeSources: number
  freshSources: number
  localSources: number
  primarySources: number
  languages: string[]
  sourceClasses: string[]
  independentOrigins: number
  recentStoryFlow: number
}

export type TerraLayerState = {
  layer: TerraInfoLayer
  status: CoverageCellStatus
  counts: Partial<TerraCoverageCounts>
  note: string
}

export type TerraCoverageState = {
  generatedAt: string
  counts: TerraCoverageCounts
  layers: TerraLayerState[]
  cells: CoverageCell[]
  inventedPercentages: false
}

export function buildTerraCoverageState(input: {
  fabric: InMemorySourceFabric
  coverage: CoverageCell[]
  independentOrigins: number
  recentStoryFlow: number
  nowIso?: string
}): TerraCoverageState {
  const sources = [...input.fabric.sources.values()]
  const active = sources.filter(source => source.status === 'LIVE')
  const counts: TerraCoverageCounts = {
    activeSources: active.length,
    freshSources: active.filter(source => source.lastSuccessfulFetch).length,
    localSources: sources.filter(source => source.sourceType === 'COMMUNITY_SOURCE' || source.city).length,
    primarySources: sources.filter(source => source.primaryOrSecondary === 'PRIMARY' || source.sourceType === 'OFFICIAL_RECORD' || source.sourceType === 'GOVERNMENT').length,
    languages: [...new Set(sources.map(source => source.primaryLanguage).filter(lang => lang && lang !== 'und'))],
    sourceClasses: [...new Set(sources.map(source => source.sourceType))],
    independentOrigins: input.independentOrigins,
    recentStoryFlow: input.recentStoryFlow,
  }
  const layers: TerraLayerState[] = [
    { layer: 'NEWS_COVERAGE', status: counts.activeSources ? 'COVERED' : 'NOT_ASSESSED', counts, note: 'Actual source counts, not a coverage percentage.' },
    { layer: 'LOCAL_JOURNALISM', status: counts.localSources ? 'WEAK' : 'NOT_ASSESSED', counts: { localSources: counts.localSources }, note: 'Local journalism is counted, not estimated.' },
    { layer: 'PUBLIC_SAFETY', status: sources.some(source => source.sourceType === 'PUBLIC_SAFETY' || source.sourceType === 'ALERT_FEED') ? 'COVERED' : 'NOT_ASSESSED', counts: {}, note: '' },
    { layer: 'OFFICIAL_GOVERNMENT', status: counts.primarySources ? 'COVERED' : 'NOT_ASSESSED', counts: { primarySources: counts.primarySources }, note: '' },
    { layer: 'SCIENCE', status: sources.some(source => source.sourceType === 'SCIENTIFIC_SOURCE') ? 'COVERED' : 'NOT_ASSESSED', counts: {}, note: '' },
    { layer: 'WEATHER', status: sources.some(source => source.sourceType === 'WEATHER' || source.sourceType === 'ALERT_FEED') ? 'COVERED' : 'NOT_ASSESSED', counts: {}, note: '' },
    { layer: 'TRANSPORT', status: sources.some(source => source.sourceType === 'TRANSPORT') ? 'WEAK' : 'NOT_ASSESSED', counts: {}, note: '' },
    { layer: 'INFRASTRUCTURE', status: 'NOT_ASSESSED', counts: {}, note: 'NOT_ASSESSED is not WEAK and not BLOCKED.' },
    { layer: 'LANGUAGE_COVERAGE', status: counts.languages.length ? 'WEAK' : 'NOT_ASSESSED', counts: { languages: counts.languages }, note: counts.languages.join(', ') },
    { layer: 'SOURCE_OWNERSHIP', status: 'NOT_ASSESSED', counts: {}, note: 'Ownership graph is incomplete at P0 seed scale.' },
    { layer: 'COVERAGE_GAPS', status: input.coverage.some(cell => cell.status === 'MISSING') ? 'MISSING' : 'WEAK', counts: {}, note: `${input.coverage.filter(cell => cell.status === 'MISSING' || cell.status === 'WEAK').length} gap cells` },
    { layer: 'LIVE_STORY_CLUSTERS', status: input.recentStoryFlow ? 'COVERED' : 'NOT_ASSESSED', counts: { recentStoryFlow: input.recentStoryFlow }, note: '' },
  ]
  return {
    generatedAt: input.nowIso ?? new Date().toISOString(),
    counts,
    layers,
    cells: input.coverage,
    inventedPercentages: false,
  }
}

export type DeepScanRequest = {
  regionLabel: string
  latitude?: number
  longitude?: number
}

export type DeepScanPlan = {
  regionLabel: string
  action: 'SOURCE_DISCOVERY_RESEARCH'
  grantsPhysicalAuthority: false
  searches: string[]
}

export function planDeepScan(request: DeepScanRequest): DeepScanPlan {
  const region = request.regionLabel.trim()
  return {
    regionLabel: region,
    action: 'SOURCE_DISCOVERY_RESEARCH',
    grantsPhysicalAuthority: false,
    searches: [
      `missing local journalism ${region}`,
      `regional-language reporting ${region}`,
      `government public safety ${region}`,
      `universities ${region}`,
      `weather ${region}`,
      `transport ${region}`,
      `local business press ${region}`,
      `nearby municipal sources ${region}`,
    ],
  }
}

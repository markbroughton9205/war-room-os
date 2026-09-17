import { TERRA_LOCAL_SOURCE_SEEDS } from './registry'
import { normalizePlaceToken } from './context'
import type { TerraLocalContext, TerraLocalCoverageLevel, TerraLocalMatchedSource, TerraLocalRuntimeUsability, TerraLocalSource, TerraLocalSourceHealth, TerraLocalSourceRuntime } from './types'

const LEVEL_RANK: Record<TerraLocalCoverageLevel, number> = {
  CITY: 1,
  COUNTY: 2,
  METRO: 3,
  REGIONAL: 4,
  STATE_PROVINCE: 5,
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePlaceToken(a)
  const right = normalizePlaceToken(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function sourceTouchesContext(source: TerraLocalSource, context: TerraLocalContext & { region?: string | null }): TerraLocalCoverageLevel | null {
  if (context.countryCode && source.countryCode !== context.countryCode) return null
  if (!context.countryCode && context.country && !sameName(source.country, context.country)) return null

  if (source.coverageLevel === 'CITY' && context.city && (sameName(source.city, context.city) || source.aliases.some(alias => sameName(alias, context.city)))) {
    return 'CITY'
  }
  if (context.county && (sameName(source.county, context.county) || source.aliases.some(alias => sameName(alias, context.county)))) {
    return source.coverageLevel === 'COUNTY' ? 'COUNTY' : source.coverageLevel
  }
  if (context.city && source.coverageLevel === 'METRO' && (sameName(source.metro, context.metro) || source.aliases.some(alias => sameName(alias, context.city)))) {
    return 'METRO'
  }
  if (context.city && source.aliases.some(alias => sameName(alias, context.city))) {
    return source.coverageLevel
  }
  if (source.coverageLevel === 'REGIONAL' && context.state && sameName(source.state, context.state) && source.aliases.some(alias => {
    const token = normalizePlaceToken(alias)
    return token.length > 4 && (
      sameName(alias, context.city)
      || sameName(alias, context.county)
      || sameName(alias, context.metro)
      || (context.region && sameName(alias, context.region))
    )
  })) {
    return 'REGIONAL'
  }
  if (source.type === 'WEATHER' && source.feedUrl === 'nws:point' && source.countryCode === 'US' && context.countryCode === 'US') {
    return 'CITY'
  }
  if (source.coverageLevel === 'STATE_PROVINCE' && context.state && sameName(source.state, context.state) && source.city == null) {
    return 'STATE_PROVINCE'
  }
  if (source.coverageLevel === 'REGIONAL' && context.state && sameName(source.state, context.state) && source.city == null && source.county == null) {
    if (source.countryCode === 'GB' && /england/i.test(source.region ?? '') && /london|england/i.test(`${context.city ?? ''} ${context.state ?? ''}`)) {
      return 'REGIONAL'
    }
    if (source.countryCode === 'AU' && /new south wales|nsw/i.test(`${source.state ?? ''} ${source.region ?? ''}`)) {
      return 'REGIONAL'
    }
  }
  return null
}

export function localSourceTouchesContext(source: TerraLocalSource, context: TerraLocalContext): TerraLocalCoverageLevel | null {
  return sourceTouchesContext(source, { ...context, region: context.metro })
}

export function matchLocalSources(context: TerraLocalContext, registry: TerraLocalSource[] = TERRA_LOCAL_SOURCE_SEEDS): TerraLocalMatchedSource[] {
  const matched: TerraLocalMatchedSource[] = []
  for (const source of registry) {
    const level = localSourceTouchesContext(source, context)
    if (!level) continue
    matched.push({
      ...source,
      matchLevel: level,
      matchReason: `${level} match for ${context.shortLabel}`,
    })
  }
  matched.sort((a, b) => LEVEL_RANK[a.matchLevel] - LEVEL_RANK[b.matchLevel] || a.name.localeCompare(b.name))
  return matched
}

export function localSourceUsability(health: TerraLocalSourceHealth): TerraLocalRuntimeUsability {
  if (health === 'ACTIVE') return 'CURRENTLY_HEALTHY'
  if (health === 'STALE') return 'STALE'
  if (health === 'BLOCKED') return 'BLOCKED'
  if (health === 'NO_FEED') return 'NO_FEED'
  return 'UNAVAILABLE'
}

function isCurrentlyUsable(usability: TerraLocalRuntimeUsability): boolean {
  return usability === 'CURRENTLY_HEALTHY' || usability === 'STALE' || usability === 'RETRIEVAL_VERIFIED'
}

export function classifyAreaCoverage(
  matched: TerraLocalMatchedSource[],
  runtime?: readonly TerraLocalSourceRuntime[],
): import('./types').TerraLocalAreaCoverage {
  const usable = runtime
    ? runtime.filter(row => isCurrentlyUsable(row.usability ?? localSourceUsability(row.health))).map(row => row.source)
    : []
  const levels = new Set(usable.map(source => source.coverageLevel))
  const types = new Set(usable.map(source => source.type))
  if (!usable.length) return 'NO_COVERAGE'
  const cityJournalism = usable.some(source => source.coverageLevel === 'CITY' && (source.type === 'TV' || source.type === 'NEWSPAPER' || source.type === 'RADIO'))
  if (cityJournalism && (types.has('PUBLIC_AGENCY') || types.has('WEATHER') || types.has('TRANSPORTATION') || types.has('EMERGENCY') || types.has('EVENTS'))) {
    return 'RICH_COVERAGE'
  }
  if (cityJournalism || levels.has('METRO')) return types.size >= 2 ? 'PARTIAL' : 'SPARSE'
  if (levels.has('COUNTY') || levels.has('REGIONAL')) return 'SPARSE'
  return 'SPARSE'
}

export function coverageLevelsPresent(matched: TerraLocalMatchedSource[]): TerraLocalCoverageLevel[] {
  return [...new Set(matched.map(source => source.matchLevel))]
}

export type TerraLocalRuntimeHealthSummary = {
  configured: number
  currentlyHealthy: number
  stale: number
  blocked: number
  unavailable: number
  noFeed: number
}

export function summarizeLocalRuntimeHealth(runtime: readonly TerraLocalSourceRuntime[]): TerraLocalRuntimeHealthSummary {
  const usabilityOf = (row: TerraLocalSourceRuntime) => row.usability ?? localSourceUsability(row.health)
  return {
    configured: runtime.length,
    currentlyHealthy: runtime.filter(row => usabilityOf(row) === 'CURRENTLY_HEALTHY').length,
    stale: runtime.filter(row => usabilityOf(row) === 'STALE').length,
    blocked: runtime.filter(row => usabilityOf(row) === 'BLOCKED').length,
    unavailable: runtime.filter(row => usabilityOf(row) === 'UNAVAILABLE').length,
    noFeed: runtime.filter(row => usabilityOf(row) === 'NO_FEED').length,
  }
}

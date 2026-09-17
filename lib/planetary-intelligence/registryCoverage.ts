import type { PlanetaryRegistryStore } from './registryStore'
import type { RegistrySource } from './registryTypes'
import { independentOwnershipGroups } from './registryVerify'

export type RegistryCoverageFacts = {
  generatedAt: string
  inventedPercentages: false
  sourceCount: number
  freshSourceCount: number
  localSourceCount: number
  languageCount: number
  languages: string[]
  sourceTypeCount: number
  sourceTypes: string[]
  independentOwnershipCount: number
  liveEndpointCount: number
  continents: string[]
  countries: string[]
  locality: Record<string, number>
  nativeLanguageSources: number
  officialSources: number
  scienceSources: number
  metadataOnlyCount: number
  fullTextLawfulCount: number
  byContinent: Record<string, number>
  byCountry: Record<string, number>
  byLanguage: Record<string, number>
  coverageGaps: Array<{
    cell: string
    before: 'MISSING'
    sourceLayer: 'PRESENT' | 'ABSENT'
    matchingSources: number
  }>
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export function sourceMatchesGap(source: RegistrySource, gap: string): boolean {
  if (gap === 'ja-infra') return source.primaryLanguage === 'ja' && (source.region === 'EAST_ASIA' || source.coverageGeography === 'EAST_ASIA')
  if (gap === 'sw-health') return source.primaryLanguage === 'sw'
  if (gap === 'id-infra') return source.primaryLanguage === 'id'
  if (gap === 'ar-safety') return source.primaryLanguage === 'ar'
  if (gap === 'de-energy') return source.primaryLanguage === 'de' && (source.region === 'EUROPE' || source.sourceRole === 'TRADE' || Boolean(source.gapPriority?.includes('de-energy')))
  if (gap === 'es-science') return (source.primaryLanguage === 'es' || (source.supportedLanguages ?? []).includes('es')) && (source.sourceRole === 'SCIENTIFIC' || source.sourceType === 'SCIENTIFIC_SOURCE' || source.sourceType === 'ACADEMIC_SOURCE' || Boolean(source.gapPriority?.includes('es-science')))
  if (gap === 'hi-econ') return source.primaryLanguage === 'hi'
  if (gap === 'oceania-weather') return source.region === 'OCEANIA' && (source.sourceRole === 'WEATHER' || source.sourceType === 'WEATHER' || source.sourceType === 'ALERT_FEED' || source.sourceRole === 'PUBLIC_SAFETY')
  return source.gapPriority === gap
}

export function buildRegistryCoverageFacts(store: PlanetaryRegistryStore, nowIso = new Date().toISOString()): RegistryCoverageFacts {
  const sources = store.listSources()
  const endpoints = store.listEndpoints()
  const byContinent: Record<string, number> = {}
  const byCountry: Record<string, number> = {}
  const byLanguage: Record<string, number> = {}
  const locality: Record<string, number> = {}
  for (const source of sources) {
    bump(byContinent, source.continent || 'UNKNOWN')
    bump(byCountry, source.country || 'UNKNOWN')
    bump(byLanguage, source.primaryLanguage)
    bump(locality, source.localityClass)
  }
  const gapMap: Array<{ key: string; cell: string }> = [
    { key: 'ja-infra', cell: 'EAST_ASIA × INFRASTRUCTURE × ja' },
    { key: 'sw-health', cell: 'EAST_AFRICA × HEALTH × sw' },
    { key: 'id-infra', cell: 'SOUTHEAST_ASIA × INFRASTRUCTURE × id' },
    { key: 'ar-safety', cell: 'MIDDLE_EAST × PUBLIC_SAFETY × ar' },
    { key: 'de-energy', cell: 'EUROPE × ENERGY × de' },
    { key: 'es-science', cell: 'LATIN_AMERICA × SCIENCE × es' },
    { key: 'hi-econ', cell: 'SOUTH_ASIA × ECONOMICS × hi' },
    { key: 'oceania-weather', cell: 'OCEANIA × WEATHER × en' },
  ]
  return {
    generatedAt: nowIso,
    inventedPercentages: false,
    sourceCount: sources.length,
    freshSourceCount: sources.filter(source => source.lastHealthyAt || source.status === 'LIVE').length,
    localSourceCount: sources.filter(source => source.localityClass === 'CITY_LOCAL' || source.localityClass === 'HYPERLOCAL' || source.localityClass === 'REGIONAL').length,
    languageCount: Object.keys(byLanguage).length,
    languages: Object.keys(byLanguage).sort(),
    sourceTypeCount: new Set(sources.map(source => source.sourceType)).size,
    sourceTypes: [...new Set(sources.map(source => source.sourceType))],
    independentOwnershipCount: independentOwnershipGroups(sources),
    liveEndpointCount: endpoints.filter(item => item.status === 'OK' || item.status === 'NOT_MODIFIED').length,
    continents: Object.keys(byContinent).sort(),
    countries: Object.keys(byCountry).sort(),
    locality,
    nativeLanguageSources: sources.filter(source => source.primaryLanguage !== 'en' && source.primaryLanguage !== 'und').length,
    officialSources: sources.filter(source => source.sourceRole === 'OFFICIAL' || source.sourceType === 'GOVERNMENT' || source.sourceType === 'OFFICIAL_RECORD').length,
    scienceSources: sources.filter(source => source.sourceRole === 'SCIENTIFIC' || source.sourceType === 'SCIENTIFIC_SOURCE' || source.sourceType === 'ACADEMIC_SOURCE').length,
    metadataOnlyCount: sources.filter(source => source.retentionPolicy === 'METADATA_ONLY').length,
    fullTextLawfulCount: sources.filter(source => source.retentionPolicy === 'FULL_TEXT_LAWFUL').length,
    byContinent,
    byCountry,
    byLanguage,
    coverageGaps: gapMap.map(item => {
      const matching = sources.filter(source => sourceMatchesGap(source, item.key)).length
      return { cell: item.cell, before: 'MISSING' as const, sourceLayer: matching > 0 ? 'PRESENT' as const : 'ABSENT' as const, matchingSources: matching }
    }),
  }
}

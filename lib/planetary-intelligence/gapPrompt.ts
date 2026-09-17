import { classifyGeneratedQuery } from './languageTruth'
import type { CoverageCell, EvidenceClass, PlanetaryGeography, PlanetaryTopic, SourceClass } from './types'
import type { LocalityClass } from './sourceGeography'

export const FALLBACK_LEVELS = [0, 1, 2, 3, 4] as const
export type FallbackLevel = (typeof FALLBACK_LEVELS)[number]

export type GapPrompt = {
  gapId: string
  coverageCell: string
  researchPrompt: string
  requestedLanguage: string
  actualQueryLanguage: string
  targetGeography: PlanetaryGeography
  targetTopic: PlanetaryTopic
  targetSourceClass: SourceClass
  targetLocality: LocalityClass | 'regional / city / official'
  targetEvidenceClass: EvidenceClass
  excluded: string[]
  fallbackLevel: FallbackLevel
  currentGap: string
  alreadyObserved: string[]
}

const LOCALITY_FOR: Record<string, GapPrompt['targetLocality']> = {
  ja: 'regional / city / official',
  sw: 'REGIONAL',
  id: 'REGIONAL',
  ar: 'OFFICIAL',
  de: 'NATIONAL',
  es: 'SPECIALIST',
  hi: 'NATIONAL',
  en: 'OFFICIAL',
}

export function isVagueGapQuery(query: string): boolean {
  return /find more news|find japanese sources|search africa|more sources/i.test(query)
}

export function buildGapPrompt(input: {
  cell: Pick<CoverageCell, 'cellId' | 'geography' | 'topic' | 'language' | 'sourceType' | 'evidenceQuality' | 'status' | 'explanation' | 'rejectionReasons'>
  alreadyObserved?: string[]
  fallbackLevel?: FallbackLevel
  index?: number
}): GapPrompt {
  const facet = input.cell
  const classified = classifyGeneratedQuery(nativeObjective(facet), facet.language)
  const already = input.alreadyObserved ?? []
  const excluded = [
    'wrong geography',
    'wrong language',
    'syndicated copy',
    'English fallback',
    'aggregator',
    'wrong source class',
    'duplicate origin',
    'homepage HTTP 200 without content endpoint',
    'source registry presence without observed documents',
  ]
  const currentGap = `${facet.status}: ${facet.explanation}`
  const researchPrompt = [
    `TARGET:`,
    `${facet.geography}`,
    `LANGUAGE:`,
    `${facet.language}`,
    `TOPIC:`,
    `${facet.topic}`,
    `SOURCE TYPE:`,
    `${facet.sourceType}`,
    `LOCALITY:`,
    `${LOCALITY_FOR[facet.language] ?? 'REGIONAL'}`,
    `EVIDENCE NEEDED:`,
    `${facet.evidenceQuality}`,
    `FRESHNESS:`,
    `last 72 hours unless the source class is academic`,
    `CURRENT GAP:`,
    currentGap,
    `ALREADY OBSERVED:`,
    already.length ? already.join(', ') : 'none',
    `DO NOT COUNT:`,
    excluded.join(' / '),
    `SEARCH OBJECTIVE:`,
    `Find independently originated evidence satisfying ALL required dimensions.`,
  ].join('\n')
  return {
    gapId: `gap-${facet.cellId}-${input.fallbackLevel ?? 0}`,
    coverageCell: `${facet.geography} × ${facet.topic} × ${facet.language} × ${facet.sourceType}`,
    researchPrompt,
    requestedLanguage: facet.language,
    actualQueryLanguage: classified.queryLanguage,
    targetGeography: facet.geography === 'GLOBAL' ? 'EAST_ASIA' : facet.geography,
    targetTopic: facet.topic,
    targetSourceClass: facet.sourceType,
    targetLocality: LOCALITY_FOR[facet.language] ?? 'REGIONAL',
    targetEvidenceClass: facet.evidenceQuality,
    excluded,
    fallbackLevel: input.fallbackLevel ?? 0,
    currentGap,
    alreadyObserved: already,
  }
}

function nativeObjective(facet: { geography: string; topic: string; language: string; sourceType: string }): string {
  if (facet.language === 'ja') return `${facet.geography} ${facet.topic} 日本語の一次情報 現地報道 今日`
  if (facet.language === 'sw') return `chanzo cha Kiswahili cha ${facet.topic} Afrika Mashariki habari asili leo`
  if (facet.language === 'id') return `sumber berbahasa Indonesia ${facet.topic} Asia Tenggara asal independen hari ini`
  if (facet.language === 'ar') return `${facet.geography} ${facet.topic} مصادر محلية أصلية اليوم`
  if (facet.language === 'de') return `unabhängige deutsche quelle ${facet.topic} ${facet.geography} heute`
  if (facet.language === 'hi') return `${facet.geography} ${facet.topic} स्वतंत्र हिंदी स्रोत आज`
  if (facet.language === 'es') return `${facet.geography} ${facet.topic} fuentes locales español origen original hoy`
  return `independently originated ${facet.topic} ${facet.sourceType} covering ${facet.geography} in ${facet.language} today`
}

export function fallbackDoesNotSatisfyOriginal(level: FallbackLevel, originalDimensionsMet: boolean): boolean {
  if (level === 0) return !originalDimensionsMet
  return !originalDimensionsMet
}

export function promptGapCells(cells: CoverageCell[], alreadyObserved: string[] = []): GapPrompt[] {
  const priority = [
    'EAST_ASIA:INFRASTRUCTURE:ja',
    'EAST_AFRICA:HEALTH:sw',
    'SOUTHEAST_ASIA:INFRASTRUCTURE:id',
    'MIDDLE_EAST:PUBLIC_SAFETY:ar',
    'EUROPE:ENERGY:de',
    'LATIN_AMERICA:SCIENCE:es',
    'SOUTH_ASIA:ECONOMICS:hi',
    'OCEANIA:WEATHER:en',
  ]
  return cells
    .filter(cell => cell.status === 'MISSING' || cell.status === 'WEAK' || cell.status === 'NOT_ASSESSED')
    .filter(cell => priority.includes(`${cell.geography}:${cell.topic}:${cell.language}`))
    .map((cell, index) => buildGapPrompt({ cell, alreadyObserved, index }))
}

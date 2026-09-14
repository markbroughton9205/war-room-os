import type {
  CoverageCell,
  CoverageCellStatus,
  EvidenceClass,
  GapFillTask,
  LedgerClaim,
  PlanetaryGeography,
  PlanetaryTopic,
  RetrievedDocument,
  SourceClass,
} from './types'

function cellId(input: {
  geography: PlanetaryGeography | 'GLOBAL'
  topic: PlanetaryTopic
  language: string
  sourceType: SourceClass
  time: string
  evidenceQuality: EvidenceClass
}): string {
  return `cell-${input.geography}-${input.topic}-${input.language}-${input.sourceType}-${input.time}-${input.evidenceQuality}`
}

export const DEFAULT_COVERAGE_FACETS: Array<{
  geography: PlanetaryGeography
  topic: PlanetaryTopic
  language: string
  sourceType: SourceClass
  evidenceQuality: EvidenceClass
}> = [
  { geography: 'WEST_AFRICA', topic: 'LOCAL_GOVERNANCE', language: 'fr', sourceType: 'JOURNALISM', evidenceQuality: 'LOCAL_REPORTING' },
  { geography: 'EAST_ASIA', topic: 'INFRASTRUCTURE', language: 'ja', sourceType: 'OFFICIAL_RECORD', evidenceQuality: 'PRIMARY_EVIDENCE' },
  { geography: 'LATIN_AMERICA', topic: 'SCIENCE', language: 'es', sourceType: 'SCIENTIFIC_SOURCE', evidenceQuality: 'RESEARCH_PAPER' },
  { geography: 'SOUTHEAST_ASIA', topic: 'INFRASTRUCTURE', language: 'id', sourceType: 'JOURNALISM', evidenceQuality: 'LOCAL_REPORTING' },
  { geography: 'MIDDLE_EAST', topic: 'PUBLIC_SAFETY', language: 'ar', sourceType: 'PRIMARY_PUBLIC_SIGNAL', evidenceQuality: 'ALERT' },
  { geography: 'EUROPE', topic: 'ENERGY', language: 'de', sourceType: 'TRADE_SOURCE', evidenceQuality: 'TECHNICAL_DOCUMENT' },
  { geography: 'NORTH_AMERICA', topic: 'TECHNOLOGY', language: 'en', sourceType: 'TRADE_SOURCE', evidenceQuality: 'TECHNICAL_DOCUMENT' },
  { geography: 'SOUTH_ASIA', topic: 'ECONOMICS', language: 'hi', sourceType: 'JOURNALISM', evidenceQuality: 'REGIONAL_REPORTING' },
  { geography: 'OCEANIA', topic: 'WEATHER', language: 'en', sourceType: 'ALERT_FEED', evidenceQuality: 'ALERT' },
  { geography: 'EAST_AFRICA', topic: 'HEALTH', language: 'sw', sourceType: 'COMMUNITY_SOURCE', evidenceQuality: 'LOCAL_REPORTING' },
]

export function statusFor(input: { claims: number; independentOrigins: number; blocked?: boolean; assessed: boolean }): CoverageCellStatus {
  if (!input.assessed) return 'NOT_ASSESSED'
  if (input.blocked) return 'BLOCKED'
  if (input.claims === 0 || input.independentOrigins === 0) return 'MISSING'
  if (input.independentOrigins < 2 || input.claims < 2) return 'WEAK'
  return 'COVERED'
}

export function buildCoverageMatrix(input: {
  documents: RetrievedDocument[]
  claims: LedgerClaim[]
  time?: string
}): CoverageCell[] {
  const time = input.time ?? 'today'
  return DEFAULT_COVERAGE_FACETS.map(facet => {
    const geoDocs = input.documents.filter(doc => doc.geography === facet.geography)
    const topicDocs = geoDocs.filter(doc => doc.topic === facet.topic)
    const langDocs = topicDocs.filter(doc => doc.detectedLanguage === facet.language || doc.queryLanguage === facet.language)
    const assessedDocs = langDocs.length ? langDocs : topicDocs.length ? topicDocs : geoDocs
    const assessed = geoDocs.length > 0 || topicDocs.length > 0
    const claims = input.claims.filter(claim => claim.geography === facet.geography && claim.topic === facet.topic)
    const origins = new Set(assessedDocs.map(doc => doc.independentOriginId).filter(Boolean))
    const status = statusFor({
      claims: claims.length || assessedDocs.length,
      independentOrigins: origins.size,
      assessed,
    })
    const qualityDistribution: Record<string, number> = {}
    for (const doc of assessedDocs) qualityDistribution[doc.evidenceClass] = (qualityDistribution[doc.evidenceClass] ?? 0) + 1
    return {
      cellId: cellId({ ...facet, time }),
      geography: facet.geography,
      topic: facet.topic,
      language: facet.language,
      sourceType: facet.sourceType,
      time,
      evidenceQuality: facet.evidenceQuality,
      claims: claims.length,
      independentOrigins: origins.size,
      freshestEvidence: assessedDocs[0]?.publishedAt ?? assessedDocs[0]?.documentId ?? null,
      qualityDistribution,
      verification: claims.some(claim => claim.verificationState === 'SUPPORTED') ? 'PARTIAL' : 'NONE',
      status,
    }
  })
}

const MAX_GAP_FILL_CYCLES = 1
const MAX_GAP_FILL_TASKS = 3

export function planGapFill(input: {
  missionId: string
  coverage: CoverageCell[]
  cycle: number
}): GapFillTask[] {
  if (input.cycle >= MAX_GAP_FILL_CYCLES) return []
  const targets = input.coverage
    .filter(cell => cell.status === 'WEAK' || cell.status === 'MISSING' || cell.status === 'NOT_ASSESSED')
    .slice(0, MAX_GAP_FILL_TASKS)
  return targets.map((cell, index) => ({
    taskId: `task-gap-${String(index + 1).padStart(2, '0')}-${input.missionId.slice(-8)}`,
    missionId: input.missionId,
    seat: cell.topic === 'SCIENCE' || cell.topic === 'ECONOMICS' ? 'NOVA' : cell.evidenceQuality === 'PRIMARY_EVIDENCE' ? 'ORION' : 'PULSAR',
    timeRange: cell.time,
    geographicScope: cell.geography === 'GLOBAL' ? 'AFRICA' : cell.geography,
    topic: cell.topic,
    languages: [cell.language],
    sourceTypes: [cell.sourceType],
    evidenceTypes: [cell.evidenceQuality],
    noveltyObjective: cell.evidenceQuality === 'PRIMARY_EVIDENCE' ? 'VERIFY_PRIMARY' : 'MAXIMIZE_DISCOVERY',
    verificationDepth: 'TARGETED',
    searchBudget: 4,
    priority: 9 - index,
    query: targetedGapQuery(cell),
    queryLanguage: cell.language,
    preferredProviders: ['tavily', 'public_news_rss', 'searxng'],
    reason: `${cell.status}: ${cell.geography} × ${cell.topic} × ${cell.language} × ${cell.sourceType}`,
    targetCellId: cell.cellId,
  }))
}

function targetedGapQuery(cell: CoverageCell): string {
  const geo = cell.geography.replace(/_/g, ' ').toLowerCase()
  const topic = cell.topic.replace(/_/g, ' ').toLowerCase()
  if (cell.language === 'es' || cell.language === 'pt') {
    return `${geo} ${topic} fuentes locales ${cell.language === 'pt' ? 'portugués' : 'español'} origen original hoy`
  }
  if (cell.language === 'fr') return `reportages locaux originaux ${geo} ${topic} aujourd'hui`
  if (cell.language === 'ja') return `${geo} ${topic} 一次情報 現地報道 今日`
  if (cell.language === 'ar') return `${geo} ${topic} مصادر محلية أصلية اليوم`
  return `locally originated ${topic} in ${geo} primary or local sources today language=${cell.language}`
}

export function gapFillIsBounded(cycle: number, tasks: GapFillTask[]): boolean {
  return cycle <= MAX_GAP_FILL_CYCLES && tasks.length <= MAX_GAP_FILL_TASKS
}

export function coverageStatusesAreDistinct(): boolean {
  return statusFor({ claims: 0, independentOrigins: 0, assessed: false }) === 'NOT_ASSESSED'
    && statusFor({ claims: 0, independentOrigins: 0, assessed: true }) === 'MISSING'
    && statusFor({ claims: 1, independentOrigins: 1, assessed: true }) === 'WEAK'
    && statusFor({ claims: 3, independentOrigins: 3, assessed: true }) === 'COVERED'
    && statusFor({ claims: 3, independentOrigins: 3, assessed: true, blocked: true }) === 'BLOCKED'
}

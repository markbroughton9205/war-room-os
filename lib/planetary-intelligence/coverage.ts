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
import { classifyGeneratedQuery } from './languageTruth'
import { resolveObservedTopic } from './observedTopic'

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

function observedGeography(doc: RetrievedDocument): PlanetaryGeography | null {
  return doc.sourceCoverageGeography ?? doc.eventGeography ?? doc.datelineGeography ?? null
}

function observedTopic(doc: RetrievedDocument): PlanetaryTopic | null {
  return resolveObservedTopic(doc.title, doc.observedTopic ?? doc.topic, doc.originalText)
}

function languageOf(doc: RetrievedDocument): string {
  return doc.detectedLanguage || 'und'
}

export function qualifyDocumentForCell(doc: RetrievedDocument, facet: {
  geography: PlanetaryGeography
  topic: PlanetaryTopic
  language: string
  sourceType: SourceClass
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const geo = observedGeography(doc)
  if (geo !== facet.geography) reasons.push(`geography_mismatch:${geo ?? 'none'}!=${facet.geography}`)
  if (observedTopic(doc) !== facet.topic) reasons.push(`topic_mismatch:${observedTopic(doc) ?? 'none'}!=${facet.topic}`)
  const lang = languageOf(doc)
  if (lang === 'und') reasons.push('language_und')
  else if (lang !== facet.language) reasons.push(`language_mismatch:${lang}!=${facet.language}`)
  if (doc.evidenceLanguageMatch === false && facet.language !== 'en') reasons.push('english_fallback_rejected')
  if (doc.sourceClass !== facet.sourceType) reasons.push(`source_class_mismatch:${doc.sourceClass}!=${facet.sourceType}`)
  if (doc.sourceGeographyMatch === 'NO_MATCH') reasons.push('source_geography_no_match')
  return { ok: reasons.length === 0, reasons }
}

export function buildCoverageMatrix(input: {
  documents: RetrievedDocument[]
  claims: LedgerClaim[]
  time?: string
}): CoverageCell[] {
  const time = input.time ?? 'today'
  return DEFAULT_COVERAGE_FACETS.map(facet => {
    const evaluations = input.documents.map(doc => ({ doc, result: qualifyDocumentForCell(doc, facet) }))
    const qualifying = evaluations.filter(row => row.result.ok).map(row => row.doc)
    const geographyMatched = input.documents.filter(doc => observedGeography(doc) === facet.geography)
    const languageMatched = input.documents.filter(doc => languageOf(doc) === facet.language && languageOf(doc) !== 'und')
    const sourceClassMatched = input.documents.filter(doc => doc.sourceClass === facet.sourceType)
    const assessed = geographyMatched.length > 0 || languageMatched.length > 0
    const origins = new Set(qualifying.map(doc => doc.independentOriginId).filter(Boolean))
    const claims = input.claims.filter(claim => qualifying.some(doc => doc.documentId && claim.independentOriginIds.includes(doc.independentOriginId ?? '')))
    const status = statusFor({
      claims: qualifying.length,
      independentOrigins: origins.size,
      assessed,
    })
    const rejectionReasons = [...new Set(evaluations.flatMap(row => row.result.reasons))].slice(0, 12)
    const qualityDistribution: Record<string, number> = {}
    for (const doc of qualifying) qualityDistribution[doc.evidenceClass] = (qualityDistribution[doc.evidenceClass] ?? 0) + 1
    const explanation = status === 'COVERED'
      ? `${qualifying.length} qualifying documents, ${origins.size} independent origins matching ${facet.language}`
      : `${origins.size} qualifying origins, ${languageMatched.length} ${facet.language} documents, ${geographyMatched.length} geography matches; ${rejectionReasons[0] ?? 'no qualifying evidence'}`
    return {
      cellId: cellId({ ...facet, time }),
      geography: facet.geography,
      topic: facet.topic,
      language: facet.language,
      sourceType: facet.sourceType,
      time,
      evidenceQuality: facet.evidenceQuality,
      claims: claims.length || qualifying.length,
      independentOrigins: origins.size,
      freshestEvidence: qualifying[0]?.publishedAt ?? qualifying[0]?.documentId ?? null,
      qualityDistribution,
      verification: claims.some(claim => claim.verificationState === 'SUPPORTED') ? 'PARTIAL' : 'NONE',
      status,
      qualifyingDocumentCount: qualifying.length,
      languageMatchedCount: languageMatched.length,
      geographyMatchedCount: geographyMatched.length,
      sourceClassMatchedCount: sourceClassMatched.length,
      rejectionReasons,
      explanation,
    }
  })
}

const MAX_GAP_FILL_CYCLES = 1
const MAX_GAP_FILL_TASKS = 3

function primaryFailedDimension(cell: CoverageCell): string {
  if (cell.language !== 'en' && cell.languageMatchedCount === 0) return 'language'
  if (cell.geographyMatchedCount === 0) return 'geography'
  if (cell.sourceClassMatchedCount === 0) return 'source_class'
  const topicFail = cell.rejectionReasons.find(reason => reason.startsWith('topic'))
  if (cell.qualifyingDocumentCount === 0 && topicFail) return 'topic'
  if (cell.qualifyingDocumentCount === 0 && cell.independentOrigins < 2) return 'independent_origin'
  return cell.status === 'NOT_ASSESSED' ? 'unassessed' : 'independent_origin'
}

export function planGapFill(input: {
  missionId: string
  coverage: CoverageCell[]
  cycle: number
}): GapFillTask[] {
  if (input.cycle >= MAX_GAP_FILL_CYCLES) return []
  const targets = input.coverage
    .filter(cell => cell.status === 'WEAK' || cell.status === 'MISSING' || cell.status === 'NOT_ASSESSED')
    .slice(0, MAX_GAP_FILL_TASKS)
  return targets.map((cell, index) => {
    const failedDimension = primaryFailedDimension(cell)
    const query = targetedGapQuery(cell, failedDimension)
    const classified = classifyGeneratedQuery(query, cell.language)
    return {
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
      query,
      queryLanguage: classified.queryLanguage,
      requestedLanguage: cell.language,
      preferredProviders: ['public_news_rss', 'searxng'],
      reason: `${cell.status}: ${cell.geography} × ${cell.topic} × ${cell.language} × ${cell.sourceType} missing=${failedDimension}`,
      targetCellId: cell.cellId,
      failedDimension,
    }
  })
}

function targetedGapQuery(cell: CoverageCell, failedDimension: string): string {
  const geo = cell.geography.replace(/_/g, ' ').toLowerCase()
  const topic = cell.topic.replace(/_/g, ' ').toLowerCase()
  if (cell.language === 'fr') {
    if (failedDimension === 'language') return `source francophone originale gouvernance locale Afrique de l'Ouest reportage indépendant aujourd'hui`
    return `reportages locaux originaux indépendants ${geo} ${topic} aujourd'hui`
  }
  if (cell.language === 'ja') {
    if (failedDimension === 'language') return `${geo} ${topic} 日本語の一次情報 現地報道 今日`
    return `${geo} ${topic} 一次情報 現地報道 今日`
  }
  if (cell.language === 'id') {
    if (failedDimension === 'language') return `sumber berbahasa Indonesia infrastruktur regional Asia Tenggara asal independen hari ini`
    return `sumber regional infrastruktur berbahasa Indonesia di ${geo} hari ini`
  }
  if (cell.language === 'sw') {
    if (failedDimension === 'language') return `chanzo cha Kiswahili cha afya Afrika Mashariki habari asili leo`
    return `habari asili za ${topic} ${geo} kwa Kiswahili leo`
  }
  if (cell.language === 'es' || cell.language === 'pt') {
    return `${geo} ${topic} fuentes locales ${cell.language === 'pt' ? 'portugués' : 'español'} origen original hoy`
  }
  if (cell.language === 'ar') return `${geo} ${topic} مصادر محلية أصلية اليوم`
  if (cell.language === 'de') return `unabhängige deutsche quelle ${topic} ${geo} heute`
  if (cell.language === 'hi') return `${geo} ${topic} स्वतंत्र हिंदी स्रोत आज`
  if (failedDimension === 'source_class') return `${facetSourceQuery(cell.sourceType)} covering ${topic} in ${geo} today`
  if (failedDimension === 'geography') return `independently originated ${topic} source physically covering ${geo} today language=${cell.language}`
  return `independently originated ${topic} ${cell.sourceType.toLowerCase()} covering ${geo} in ${cell.language} today`
}

function facetSourceQuery(sourceType: SourceClass): string {
  if (sourceType === 'OFFICIAL_RECORD' || sourceType === 'GOVERNMENT') return 'official government primary record'
  if (sourceType === 'SCIENTIFIC_SOURCE' || sourceType === 'ACADEMIC_SOURCE') return 'scientific primary publication'
  if (sourceType === 'COMMUNITY_SOURCE') return 'community local outlet'
  return 'independent local journalism'
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

export function plannerAssignmentGivesZeroCoverage(): boolean {
  const cells = buildCoverageMatrix({
    documents: [],
    claims: [],
  })
  return cells.every(cell => cell.status === 'NOT_ASSESSED' && cell.qualifyingDocumentCount === 0)
}

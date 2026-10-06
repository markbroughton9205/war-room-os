import { createHash } from 'node:crypto'
import { canonicalizeUrl, hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import { detectLanguageFromText } from '@/lib/intelligence/sourceIndependence'
import { runLiveResearchRouter, type LiveResearchRouterResult } from '@/lib/research/researchRouter'
import type { GeographicRegion } from '@/lib/council/scout-swarm/types'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import { resolveSourceIdentity } from './sourceIdentity'
import { sanitizeUntrustedContent } from './security'
import { applyEvidenceTruth } from './evidenceTruth'
import { preserveLanguage } from './language'
import { classifyGeneratedQuery } from './languageTruth'
import { simhash64 } from './syndication'
import type {
  EvidenceClass,
  InvestigationTask,
  PlanetaryGeography,
  RetrievedDocument,
  SourceClass,
} from './types'

export type LiveProviderStatus = 'LIVE' | 'CONFIG_NEEDED' | 'OFFLINE' | 'FAILED'

export type LiveRetrieveTrace = {
  taskId: string
  seat: InvestigationTask['seat']
  query: string
  requestedLanguage: string
  queryLanguage: string
  queryLanguageClass: ReturnType<typeof classifyGeneratedQuery>['class']
  geographicTarget: PlanetaryGeography | 'GLOBAL'
  sourceClass: SourceClass[]
  providers: Record<string, LiveProviderStatus>
  documentCount: number
  urls: string[]
  canonicalUrls: string[]
  publishers: string[]
  outlets: string[]
  detectedLanguages: string[]
  sourceGeographies: Array<string | null>
  localityClasses: string[]
  geographyMatches: string[]
  error?: string
}

const KNOWN_ENGINE_IDS = new Set<string>([
  'arxiv',
  'federal_register',
  'jstage',
  'eclac_cepalstat',
  'sec_edgar',
  'govinfo',
  'congress_gov',
  'reliefweb',
  'eurostat',
  'crossref',
  'ncbi',
])

export function routerRegionFor(geo: PlanetaryGeography | 'GLOBAL'): GeographicRegion | undefined {
  if (geo === 'GLOBAL') return undefined
  if (geo === 'WEST_AFRICA' || geo === 'EAST_AFRICA' || geo === 'CENTRAL_AFRICA') return 'AFRICA'
  if (geo === 'SOUTHEAST_ASIA') return 'EAST_ASIA'
  if (
    geo === 'NORTH_AMERICA'
    || geo === 'LATIN_AMERICA'
    || geo === 'EUROPE'
    || geo === 'AFRICA'
    || geo === 'MIDDLE_EAST'
    || geo === 'EAST_ASIA'
    || geo === 'SOUTH_ASIA'
    || geo === 'OCEANIA'
  ) {
    return geo
  }
  return undefined
}

function tavilyStatus(error?: string, ok?: boolean): LiveProviderStatus {
  if (ok) return 'LIVE'
  const err = (error ?? '').toLowerCase()
  if (err.includes('missing') || err.includes('not configured') || err.includes('tavily_api_key')) return 'CONFIG_NEEDED'
  return 'FAILED'
}

export function summarizeRouterProviders(router: LiveResearchRouterResult): Record<string, LiveProviderStatus> {
  const searxngConfigured = Boolean(process.env.SEARXNG_BASE_URL?.trim())
  return {
    tavily: tavilyStatus(router.tavily.error, router.tavily.ok),
    public_rss: router.publicRss.ok ? 'LIVE' : (router.publicRss.error ? 'FAILED' : 'OFFLINE'),
    nws: !router.weatherAlerts.queried ? 'OFFLINE' : (router.weatherAlerts.ok ? 'LIVE' : 'FAILED'),
    searxng: router.searxng
      ? (router.searxng.ok ? 'LIVE' : (router.searxng.configured ? 'FAILED' : 'CONFIG_NEEDED'))
      : (searxngConfigured ? 'FAILED' : 'CONFIG_NEEDED'),
    research_engine: router.researchEngine.attempted
      ? (router.researchEngine.ok ? 'LIVE' : 'FAILED')
      : 'OFFLINE',
  }
}

function sourceClassFor(blob: string): SourceClass {
  const text = blob.toLowerCase()
  if (/arxiv|pubmed|jstage|doi|academic|preprint/.test(text)) return 'SCIENTIFIC_SOURCE'
  if (/federalregister|\.gov\b|official|regulator|nara/.test(text)) return 'OFFICIAL_RECORD'
  if (/alert|nws|weather/.test(text)) return 'ALERT_FEED'
  return 'JOURNALISM'
}

function evidenceClassFor(blob: string, sourceClass: SourceClass): EvidenceClass {
  if (sourceClass === 'OFFICIAL_RECORD') return 'PRIMARY_EVIDENCE'
  if (sourceClass === 'SCIENTIFIC_SOURCE') return 'RESEARCH_PAPER'
  if (sourceClass === 'ALERT_FEED') return 'ALERT'
  return 'REGIONAL_REPORTING'
}

function toDocument(input: {
  task: InvestigationTask
  url: string
  title: string
  text: string
  provider: string
  outlet?: string
  publishedAt?: string | null
  language?: string | null
}): RetrievedDocument | null {
  if (!input.url || !/^https?:\/\//i.test(input.url)) return null
  const canonical = canonicalizeUrl(input.url) || input.url
  const originalText = (input.text || input.title || '').slice(0, 4000)
  const sanitized = sanitizeUntrustedContent(originalText)
  const detected = detectLanguageFromText(originalText) || input.language || null
  const preserved = preserveLanguage({
    text: sanitized.text,
    declaredLanguage: detected,
  })
  const identity = resolveSourceIdentity({
    url: input.url,
    outletName: input.outlet,
    title: input.title,
    text: originalText,
  })
  const blob = `${input.provider} ${input.outlet ?? ''} ${hostnameFromUrl(input.url) ?? ''} ${input.title}`
  const sourceClass = sourceClassFor(blob)
  return {
    documentId: `doc-${createHash('sha256').update(`${canonical}|${input.title}`).digest('hex').slice(0, 12)}`,
    url: input.url,
    canonicalUrl: canonical,
    title: input.title,
    publisher: identity.publisher,
    outlet: identity.outlet,
    parentCompany: identity.parentCompany,
    sourceOriginId: identity.storyOriginId,
    independentOriginId: identity.independentEvidenceOriginId,
    retrievalProvider: input.provider,
    query: input.task.query,
    queryLanguage: input.task.queryLanguage,
    detectedLanguage: preserved.originalLanguage,
    originalText: preserved.originalText,
    translatedText: preserved.translatedText,
    translationMethod: preserved.translationMethod,
    translationTime: preserved.translationTime,
    translationConfidence: preserved.translationConfidence,
    publishedAt: input.publishedAt ?? null,
    contentHash: hashEvidenceContent(originalText) || createHash('sha256').update(originalText).digest('hex'),
    simhash: simhash64(`${input.title}\n${originalText}`),
    geography: null,
    topic: input.task.topic,
    sourceClass,
    evidenceClass: evidenceClassFor(blob, sourceClass),
    wireAttribution: /reuters|associated press|\(ap\)|afp/i.test(originalText) ? (originalText.match(/reuters|associated press|\(ap\)|afp/i)?.[0] ?? null) : null,
    byline: null,
    dateline: input.task.geographicScope,
    promptInjectionDetected: sanitized.injectionDetected,
  }
}

export function documentsFromLiveRouter(task: InvestigationTask, router: LiveResearchRouterResult): RetrievedDocument[] {
  const hits: RetrievedDocument[] = []
  const seen = new Set<string>()
  const push = (doc: RetrievedDocument | null) => {
    if (!doc) return
    if (seen.has(doc.canonicalUrl)) return
    seen.add(doc.canonicalUrl)
    hits.push(doc)
  }

  for (const item of router.tavily.results) {
    push(toDocument({
      task,
      url: item.url,
      title: item.title,
      text: item.snippet,
      provider: 'tavily',
      publishedAt: null,
    }))
  }
  for (const item of router.publicRss.results) {
    push(toDocument({
      task,
      url: item.url,
      title: item.title,
      text: item.snippet,
      provider: 'public_rss',
      outlet: item.source,
      publishedAt: item.publishedAt ?? null,
    }))
  }
  for (const item of router.searxng?.results ?? []) {
    push(toDocument({
      task,
      url: item.url,
      title: item.title,
      text: item.snippet,
      provider: 'searxng',
      outlet: item.sourceDomain ?? undefined,
      publishedAt: item.publishedAt,
      language: item.language,
    }))
  }
  for (const item of router.researchEngine.documents) {
    const url = item.canonicalUrl || item.sourceUrl
    if (!url) continue
    push(toDocument({
      task,
      url,
      title: item.title,
      text: item.summary ?? item.contentSnippet ?? '',
      provider: item.provider,
      outlet: item.sourceName,
      publishedAt: item.publishedAt,
      language: item.language,
    }))
  }
  for (const item of router.direct.filter(row => row.ok)) {
    push(toDocument({
      task,
      url: item.url,
      title: `Direct fetch ${item.url}`,
      text: item.contentSnippet,
      provider: 'direct_fetch',
    }))
  }
  for (const item of router.weatherAlerts.results) {
    if (!item.url) continue
    push(toDocument({
      task,
      url: item.url,
      title: item.title,
      text: item.snippet,
      provider: 'nws',
      outlet: item.source,
      publishedAt: item.publishedAt ?? null,
    }))
  }
  return hits
}

export function createLiveRetrieveSession(): {
  traces: LiveRetrieveTrace[]
  retrieve: (task: InvestigationTask) => Promise<RetrievedDocument[]>
} {
  const traces: LiveRetrieveTrace[] = []
  return {
    traces,
    retrieve: async (task: InvestigationTask) => {
      const extra = task.preferredProviders.filter((id): id is ResearchProviderId => KNOWN_ENGINE_IDS.has(id))
      try {
        const router = await runLiveResearchRouter({
          decreeText: task.query,
          supabase: null,
          conversationId: null,
          region: routerRegionFor(task.geographicScope),
          queryLanguage: task.queryLanguage,
          extraProviderIds: extra.length ? extra : undefined,
          skipGenericRssUnlessFallback: Boolean(routerRegionFor(task.geographicScope)),
          retrievalOnly: true,
          commanderSessionContext: true,
          crawlExpansion: false,
          externalMutation: false,
          financialSpend: false,
          budgetMs: 45_000,
        })
        const classified = classifyGeneratedQuery(task.query, task.requestedLanguage || task.queryLanguage)
        const documents = documentsFromLiveRouter(task, router).map(doc => applyEvidenceTruth(doc, task))
        traces.push({
          taskId: task.taskId,
          seat: task.seat,
          query: task.query,
          requestedLanguage: task.requestedLanguage || task.languages[0] || 'und',
          queryLanguage: classified.queryLanguage,
          queryLanguageClass: classified.class,
          geographicTarget: task.geographicScope,
          sourceClass: task.sourceTypes,
          providers: summarizeRouterProviders(router),
          documentCount: documents.length,
          urls: documents.map(doc => doc.url),
          canonicalUrls: documents.map(doc => doc.canonicalUrl),
          publishers: documents.map(doc => doc.publisher),
          outlets: documents.map(doc => doc.outlet),
          detectedLanguages: [...new Set(documents.map(doc => doc.detectedLanguage).filter((lang): lang is string => Boolean(lang)))],
          sourceGeographies: documents.map(doc => doc.sourceCoverageGeography ?? null),
          localityClasses: documents.map(doc => doc.localityClass ?? 'UNKNOWN'),
          geographyMatches: documents.map(doc => doc.sourceGeographyMatch ?? 'UNKNOWN'),
        })
        console.log(`[planetary-live] ${task.seat} ${task.taskId} req=${task.requestedLanguage || task.queryLanguage} queryLang=${classified.queryLanguage} class=${classified.class} geo=${task.geographicScope} docs=${documents.length}`)
        return documents
      } catch (error) {
        traces.push({
          taskId: task.taskId,
          seat: task.seat,
          query: task.query,
          requestedLanguage: task.requestedLanguage || task.languages[0] || 'und',
          queryLanguage: classifyGeneratedQuery(task.query, task.requestedLanguage || task.queryLanguage).queryLanguage,
          queryLanguageClass: classifyGeneratedQuery(task.query, task.requestedLanguage || task.queryLanguage).class,
          geographicTarget: task.geographicScope,
          sourceClass: task.sourceTypes,
          providers: { tavily: 'FAILED', public_rss: 'FAILED' },
          documentCount: 0,
          urls: [],
          canonicalUrls: [],
          publishers: [],
          outlets: [],
          detectedLanguages: [],
          sourceGeographies: [],
          localityClasses: [],
          geographyMatches: [],
          error: error instanceof Error ? error.message : String(error),
        })
        console.log(`[planetary-live] FAILED ${task.seat} ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`)
        return []
      }
    },
  }
}

export function rollupProviderStatus(traces: LiveRetrieveTrace[]): Record<string, LiveProviderStatus> {
  const names = new Set(traces.flatMap(trace => Object.keys(trace.providers)))
  const rolled: Record<string, LiveProviderStatus> = {}
  for (const name of names) {
    const statuses = traces.map(trace => trace.providers[name]).filter((item): item is LiveProviderStatus => Boolean(item))
    if (statuses.includes('LIVE')) rolled[name] = 'LIVE'
    else if (statuses.includes('FAILED')) rolled[name] = 'FAILED'
    else if (statuses.includes('CONFIG_NEEDED')) rolled[name] = 'CONFIG_NEEDED'
    else rolled[name] = 'OFFLINE'
  }
  return rolled
}

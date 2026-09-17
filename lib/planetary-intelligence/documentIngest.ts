import { createHash } from 'node:crypto'
import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { hashEvidenceContent } from '@/lib/intelligence/contentHash'
import { languageTruthFor, detectDocumentLanguage } from './languageTruth'
import { classifyFromLawfulMetadata, resolveObservedTopic } from './observedTopic'
import { resolveSourceIdentity } from './sourceIdentity'
import { clusterSyndication, simhash64 } from './syndication'
import { classifySourceGeography } from './sourceGeography'
import { retainOffline } from './offline'
import { sanitizeUntrustedContent } from './security'
import { resolveFeedItemUrl } from './sourceFabric'
import type { PlanetaryRegistryStore } from './registryStore'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'
import type { RetrievedDocument, SourceClass } from './types'

export type IngestedItem = {
  url: string
  title: string
  publishedAt: string | null
  summary?: string
  categories?: string[]
}

export function evidenceClassFor(sourceClass: SourceClass): RetrievedDocument['evidenceClass'] {
  if (sourceClass === 'OFFICIAL_RECORD' || sourceClass === 'GOVERNMENT') return 'PRIMARY_EVIDENCE'
  if (sourceClass === 'SCIENTIFIC_SOURCE' || sourceClass === 'ACADEMIC_SOURCE') return 'RESEARCH_PAPER'
  if (sourceClass === 'ALERT_FEED' || sourceClass === 'PUBLIC_SAFETY' || sourceClass === 'WEATHER') return 'ALERT'
  if (sourceClass === 'TRADE_SOURCE') return 'TECHNICAL_DOCUMENT'
  if (sourceClass === 'COMMUNITY_SOURCE') return 'LOCAL_REPORTING'
  if (sourceClass === 'PRIMARY_PUBLIC_SIGNAL') return 'ALERT'
  return 'REGIONAL_REPORTING'
}

export function documentSourceClass(source: RegistrySource, endpoint: RegistryEndpoint): SourceClass {
  if (endpoint.endpointType === 'PUBLIC_ALERT_FEED') {
    if (source.sourceType === 'PRIMARY_PUBLIC_SIGNAL') return 'PRIMARY_PUBLIC_SIGNAL'
    return 'ALERT_FEED'
  }
  return source.sourceType
}

export function hydrateObservedDocuments(input: {
  rows: Array<Record<string, unknown>>
  sources: RegistrySource[]
  endpoints: RegistryEndpoint[]
}): RetrievedDocument[] {
  return documentsToRetrieved(input.rows).map((doc, index) => {
    const row = input.rows[index]
    if (!row) return doc
    const source = input.sources.find(item => item.sourceId === String(row.source_id ?? ''))
    const endpoint = input.endpoints.find(item => item.endpointId === String(row.endpoint_id ?? ''))
    if (!source || !endpoint) return doc
    if (endpoint.endpointType !== 'PUBLIC_ALERT_FEED') return doc
    const sourceClass = documentSourceClass(source, endpoint)
    return { ...doc, sourceClass, evidenceClass: evidenceClassFor(sourceClass) }
  })
}

export function ingestItems(input: {
  store: PlanetaryRegistryStore
  missionId: string
  source: RegistrySource
  endpoint: RegistryEndpoint
  items: IngestedItem[]
  requestedLanguage: string
  query: string
  nowIso: string
  limit?: number
  transientExcerpts?: Map<string, string>
}): { documents: RetrievedDocument[]; inserted: number; duplicates: number; transientInspected: number } {
  const limit = input.limit ?? 8
  const docs: RetrievedDocument[] = []
  let inserted = 0
  let duplicates = 0
  let transientInspected = 0
  const sourceClass = documentSourceClass(input.source, input.endpoint)
  for (const item of input.items.slice(0, limit)) {
    const resolved = resolveFeedItemUrl({ url: item.url, title: item.title, feedUrl: input.endpoint.url })
    const url = canonicalizeUrl(resolved) || resolved
    if (!/^https?:\/\//i.test(url)) continue
    const title = sanitizeUntrustedContent(item.title || url).text.slice(0, 300)
    const summary = sanitizeUntrustedContent(item.summary || '').text.slice(0, 800)
    const excerpt = input.transientExcerpts?.get(url) || input.transientExcerpts?.get(item.url) || ''
    if (excerpt) transientInspected += 1
    const classified = classifyFromLawfulMetadata({
      title,
      summary,
      categories: item.categories,
      transientExcerpt: excerpt || null,
    })
    const languageBlob = `${title}\n${summary}`.trim() || title
    const detected = detectDocumentLanguage(languageBlob)
    const truth = languageTruthFor({
      requestedLanguage: input.requestedLanguage,
      query: input.query,
      originalText: languageBlob,
    })
    const identity = resolveSourceIdentity({
      url,
      outletName: input.source.canonicalName,
      publisher: input.source.canonicalName,
      parentCompany: sourceClass === 'JOURNALISM' ? input.source.parentCompanyId : input.source.canonicalName,
      title,
    })
    const geo = classifySourceGeography({
      url,
      title,
      outlet: input.source.canonicalName,
      taskGeography: input.source.region ?? null,
    })
    const sourceGeo = input.source.coverageGeography ?? input.source.hqGeography ?? geo.sourceCoverageGeography ?? null
    const topic = classified.topic
    const retention = input.source.retentionPolicy === 'FULL_TEXT_LAWFUL'
    const retained = retainOffline({
      url,
      title,
      publisher: identity.publisher,
      time: item.publishedAt,
      language: detected.language,
      geography: sourceGeo,
      sourceOrigin: identity.storyOriginId,
      contentHash: hashEvidenceContent(title) ?? hashEvidenceContent(url) ?? url,
      claims: title ? [title] : [],
      storyCluster: identity.storyOriginId,
      syndicationCluster: null,
      verification: 'UNVERIFIED',
      licensePermitsFullText: retention,
      termsPermitFullText: retention,
      publicDomain: false,
      permissionExists: retention,
    })
    const document: RetrievedDocument = {
      documentId: `doc-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
      url,
      canonicalUrl: url,
      title,
      publisher: identity.publisher,
      outlet: identity.outlet,
      parentCompany: identity.parentCompany,
      sourceOriginId: identity.storyOriginId,
      independentOriginId: identity.independentEvidenceOriginId,
      retrievalProvider: 'planetary_registry_endpoint',
      query: input.query,
      queryLanguage: truth.queryLanguage,
      requestedLanguage: input.requestedLanguage,
      detectedLanguage: detected.language,
      detectedLanguageConfidence: detected.confidence,
      evidenceLanguageMatch: truth.evidenceLanguageMatch,
      queryLanguageClass: truth.queryClass,
      originalText: retained.fullTextRetained ? title : '',
      translatedText: null,
      translationMethod: null,
      translationTime: null,
      translationConfidence: null,
      publishedAt: item.publishedAt,
      contentHash: hashEvidenceContent(title) ?? hashEvidenceContent(url) ?? url,
      simhash: simhash64(title),
      geography: sourceGeo,
      taskGeography: input.source.region ?? null,
      eventGeography: null,
      sourceHeadquartersGeography: input.source.hqGeography,
      sourceCoverageGeography: sourceGeo,
      datelineGeography: geo.datelineGeography,
      localityClass: input.source.localityClass,
      sourceGeographyMatch: geo.sourceGeographyMatch,
      observedTopic: topic,
      topic,
      sourceClass,
      evidenceClass: evidenceClassFor(sourceClass),
      wireAttribution: input.source.wireRelationship,
      byline: null,
      dateline: null,
      promptInjectionDetected: false,
    }
    const written = input.store.upsertDocument({
      documentId: document.documentId,
      missionId: input.missionId,
      sourceId: input.source.sourceId,
      endpointId: input.endpoint.endpointId,
      canonicalUrl: document.canonicalUrl,
      url: document.url,
      title: document.title,
      publisher: document.publisher,
      outlet: document.outlet,
      parentCompany: document.parentCompany,
      publishedAt: document.publishedAt,
      retrievedAt: input.nowIso,
      originalLanguage: detected.language,
      detectedLanguage: detected.language,
      languageConfidence: detected.confidence,
      requestedLanguage: input.requestedLanguage,
      queryLanguage: truth.queryLanguage,
      translationLanguage: null,
      evidenceLanguageMatch: Boolean(document.evidenceLanguageMatch),
      eventGeography: document.eventGeography ?? null,
      sourceGeography: sourceGeo,
      sourceLocality: input.source.localityClass,
      taskGeography: input.source.region ?? null,
      topic: topic,
      sourceClass,
      evidenceClass: document.evidenceClass,
      contentHash: document.contentHash,
      simhash: document.simhash,
      storyOriginId: document.sourceOriginId,
      independentOriginId: document.independentOriginId,
      retentionMode: retained.fullTextRetained ? 'FULL_TEXT_LAWFUL' : 'METADATA_ONLY',
      originalText: retained.fullTextRetained ? title : null,
      byline: null,
      wireAttribution: document.wireAttribution,
      payload: {
        classificationSource: classified.source,
        transientBodyInspected: Boolean(excerpt),
        fullTextArchived: Boolean(retained.fullTextRetained),
        summaryPresent: Boolean(summary),
      },
    })
    if (written.duplicate) duplicates += 1
    else {
      inserted += 1
      docs.push(document)
    }
  }
  const clustered = clusterSyndication(docs)
  for (const cluster of clustered.clusters) {
    input.store.upsertStoryCluster({
      storyClusterId: cluster.storyClusterId,
      syndicationClusterId: cluster.syndicationClusterId,
      canonicalStoryOrigin: cluster.canonicalStoryOrigin,
      independentOriginId: cluster.independentOriginId,
      originConfidence: cluster.originConfidence,
      originMethod: cluster.originMethod,
      memberDocumentIds: cluster.memberDocumentIds,
      createdAt: input.nowIso,
    })
  }
  return { documents: clustered.documents, inserted, duplicates, transientInspected }
}

export function documentsToRetrieved(rows: Array<Record<string, unknown>>): RetrievedDocument[] {
  return rows.map(row => {
    const title = String(row.title ?? '')
    const storedLanguage = String(row.detected_language ?? 'und') || 'und'
    const detected = detectDocumentLanguage(`${title}\n${String(row.original_text ?? '')}`)
    const language = detected.language !== 'und' ? detected.language : storedLanguage
    const requested = String(row.requested_language ?? '').toLowerCase()
    const evidenceLanguageMatch = language !== 'und' && (!requested || requested === 'und' || language === requested)
    return {
    documentId: String(row.document_id),
    url: String(row.url),
    canonicalUrl: String(row.canonical_url),
    title,
    publisher: String(row.publisher ?? ''),
    outlet: String(row.outlet ?? ''),
    parentCompany: (row.parent_company as string | null) ?? null,
    sourceOriginId: (row.story_origin_id as string | null) ?? null,
    independentOriginId: (row.independent_origin_id as string | null) ?? null,
    retrievalProvider: 'planetary_registry_endpoint',
    query: '',
    queryLanguage: String(row.query_language ?? 'und'),
    requestedLanguage: (row.requested_language as string | null) ?? undefined,
    detectedLanguage: language,
    detectedLanguageConfidence: detected.language !== 'und' ? detected.confidence : 0.7,
    evidenceLanguageMatch,
    originalText: String(row.original_text ?? ''),
    translatedText: null,
    translationMethod: null,
    translationTime: null,
    translationConfidence: null,
    publishedAt: (row.published_at as string | null) ?? null,
    contentHash: String(row.content_hash ?? ''),
    simhash: String(row.simhash ?? ''),
    geography: (row.source_geography as RetrievedDocument['geography']) ?? null,
    taskGeography: (row.task_geography as RetrievedDocument['taskGeography']) ?? null,
    eventGeography: (row.event_geography as RetrievedDocument['eventGeography']) ?? null,
    sourceHeadquartersGeography: (row.source_geography as RetrievedDocument['sourceHeadquartersGeography']) ?? null,
    sourceCoverageGeography: (row.source_geography as RetrievedDocument['sourceCoverageGeography']) ?? null,
    localityClass: (row.source_locality as RetrievedDocument['localityClass']) ?? 'UNKNOWN',
    observedTopic: resolveObservedTopic(String(row.title ?? ''), row.topic as string | null, String(row.original_text ?? '')),
    topic: resolveObservedTopic(String(row.title ?? ''), row.topic as string | null, String(row.original_text ?? '')),
    sourceClass: (row.source_class as SourceClass) ?? 'JOURNALISM',
    evidenceClass: (row.evidence_class as RetrievedDocument['evidenceClass']) ?? 'REGIONAL_REPORTING',
    wireAttribution: (row.wire_attribution as string | null) ?? null,
    byline: (row.byline as string | null) ?? null,
    dateline: null,
    promptInjectionDetected: false,
    }
  })
}

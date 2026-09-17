import { domainFromHomepage, persistVerifiedCandidate, sourceAndEndpointAreDistinct, verifyCandidate } from './registryVerify'
import { classifyFetchedBody, discoverFeedsFromHtml, extractLawfulExcerpt, homepage200IsNotLiveContent } from './endpointDiscover'
import { defaultWave2Fetch, type Wave2Fetch } from './endpointActivate'
import { ingestItems, documentsToRetrieved } from './documentIngest'
import { recommendedPollInterval } from './registryPoll'
import { qualifyObservedDocument } from './observedCoverage'
import { clusterSyndication } from './syndication'
import { sourceMatchesGap } from './registryCoverage'
import { buildGapPrompt, fallbackDoesNotSatisfyOriginal } from './gapPrompt'
import { auroraDoesNotFirstPassRetrieve } from './retrievalContracts'
import { SERIAL_GPU_FLOOR, singleGpuSerialPreserved } from './protocol'
import { visibleConcurrentFamilies } from '@/lib/council/live-orchestration/floorScheduler'
import { diagnoseSearxng } from './searxngDiagnostic'
import { searxngStartPolicy } from './searxngPolicy'
import { resolvePlanetaryRegistryTarget } from './registryPaths'
import { SQLITE_EVIDENCE_LEDGER_DECISION } from './registrySchema'
import { PlanetaryRegistryStore } from './registryStore'
import { wave3CatalogForCell } from './wave3Catalog'
import { WAVE3_PRIORITY_CELLS, cellLabel, type Wave3PriorityCell } from './wave3Cells'
import {
  WAVE3_DOCS_PER_ENDPOINT,
  WAVE3_NEW_SOURCES_HARD_CAP,
  WAVE3_NEW_SOURCES_PER_CELL,
  WAVE3_TRANSIENT_EXCERPTS_PER_ENDPOINT,
} from './registryTypes'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'
import type { RetrievedDocument } from './types'
import { classifyFromLawfulMetadata } from './observedTopic'

export type Wave3CellResult = {
  cell: string
  gapKey: string
  sourceBefore: 'PRESENT' | 'ABSENT'
  endpointBefore: 'LIVE' | 'NONE'
  coverageBefore: string
  sourceAfter: 'PRESENT' | 'ABSENT'
  endpointAfter: 'LIVE' | 'NONE' | 'BLOCKED' | 'VERIFYING'
  documentAfter: 'NOT_ASSESSED' | 'MISSING' | 'OBSERVED'
  coverageAfter: 'MISSING' | 'WEAK' | 'COVERED' | 'BLOCKED' | 'NOT_ASSESSED'
  qualifyingDocuments: number
  rejectedDocuments: number
  rejectionReasons: string[]
  languageMatched: number
  geographyMatched: number
  topicMatched: number
  sourceClassMatched: number
  independentOrigins: number
  newIdentitiesInvestigated: number
  newIdentitiesAdded: number
  newLiveEndpoints: number
  fallbackLevel: 0
  stopReason: 'COVERED' | 'CAP' | 'EXHAUSTED'
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function nativeQuery(language: string, name: string): string {
  if (language === 'ja') return `${name} 日本語の一次情報 インフラ 公式発表 今日`
  if (language === 'sw') return `${name} habari asili za afya kwa Kiswahili leo jamii`
  if (language === 'id') return `${name} infrastruktur kereta jalan pelabuhan berbahasa Indonesia hari ini`
  if (language === 'ar') return `${name} إنذار طوارئ دفاع مدني مصادر رسمية اليوم`
  if (language === 'de') return `${name} unabhängige deutsche Energiebranche heute`
  if (language === 'hi') return `${name} अर्थव्यवस्था महंगाई बाजार स्वतंत्र हिंदी स्रोत आज`
  if (language === 'es') return `${name} investigación ciencia fuentes científicas español hoy`
  return `${name} independently originated weather warning alert today`
}

function coverageStatus(qualifying: RetrievedDocument[]): 'MISSING' | 'WEAK' | 'COVERED' {
  const origins = new Set(qualifying.map(doc => doc.independentOriginId).filter(Boolean))
  if (qualifying.length === 0 || origins.size === 0) return 'MISSING'
  if (origins.size < 2 || qualifying.length < 2) return 'WEAK'
  return 'COVERED'
}

function matchesCell(doc: RetrievedDocument, cell: Wave3PriorityCell, nowIso: string): { ok: boolean; reasons: string[] } {
  return qualifyObservedDocument(doc, {
    geography: cell.geography,
    topic: cell.topic,
    language: cell.language,
    sourceType: cell.sourceType,
  }, nowIso, cell.windowHours)
}

export async function runSourceFabricWave3(input: {
  rootDir?: string
  nowIso?: string
  fetchImpl?: Wave2Fetch
  spacingMs?: number
  skipSearxng?: boolean
}): Promise<{
  classification: 'PLANETARY_SOURCE_FABRIC_WAVE3_COMPLETE' | 'PLANETARY_SOURCE_FABRIC_WAVE3_PARTIAL' | 'PLANETARY_SOURCE_FABRIC_WAVE3_BLOCKED'
  startingSources: number
  startingLive: number
  investigated: number
  added: number
  endpointsDiscovered: number
  newLive: number
  documents: number
  transientInspected: number
  fullTextArchived: number
  independentOrigins: number
  sharedOriginDocuments: number
  cells: Wave3CellResult[]
  auroraNoFirstPass: boolean
  singleGpu: boolean
  persistence: ReturnType<typeof resolvePlanetaryRegistryTarget>
  ledger: typeof SQLITE_EVIDENCE_LEDGER_DECISION
  searxng: Awaited<ReturnType<typeof diagnoseSearxng>> & { startPolicy: ReturnType<typeof searxngStartPolicy> }
  fallbackNeverSatisfies: boolean
}> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const fetchImpl = input.fetchImpl ?? defaultWave2Fetch
  const spacingMs = input.spacingMs ?? 250
  const store = new PlanetaryRegistryStore(input.rootDir)
  const startingSources = store.listSources()
  const startingEndpoints = store.listEndpoints()
  const startingLive = startingEndpoints.filter(item => item.activationState === 'LIVE').length
  const missionId = `WAVE3-GAP-${nowIso.slice(0, 19).replace(/[-:T]/g, '')}`
  store.upsertMission({
    missionId,
    commanderIntent: 'Priority gap closure: exact geography × language × topic × source class',
    complexity: 'SCOPED_RESEARCH',
    protocol: 'DIVERGENT_PLANETARY',
    createdAt: nowIso,
    payload: { wave: 3, cells: WAVE3_PRIORITY_CELLS.map(cellLabel) },
  })

  let investigated = 0
  let added = 0
  let endpointsDiscovered = 0
  let newLive = 0
  let transientInspected = 0
  const allNewDocs: RetrievedDocument[] = []
  const cellResults: Wave3CellResult[] = []

  for (const cell of WAVE3_PRIORITY_CELLS) {
    const sources = store.listSources()
    const endpoints = store.listEndpoints()
    const matching = sources.filter(source => sourceMatchesGap(source, cell.gapKey) || (source.region === cell.geography && source.primaryLanguage === cell.language && source.sourceType === cell.sourceType))
    const liveBefore = endpoints.filter(endpoint => matching.some(source => source.sourceId === endpoint.sourceId) && endpoint.activationState === 'LIVE')
    const existingDocs = qualifyDocs(store, cell, nowIso)
    const beforeStatus = coverageStatus(existingDocs.qualifying)

    const liveExisting = liveBefore.slice(0, 4)
    for (const endpoint of liveExisting) {
      const source = matching.find(item => item.sourceId === endpoint.sourceId)
      if (!source) continue
      const probed = await probeEndpoint({ store, source, url: endpoint.url, endpoint, fetchImpl, missionId, nowIso, cell, spacingMs })
      endpointsDiscovered += probed.discovered
      newLive += probed.live
      transientInspected += probed.transient
      allNewDocs.push(...probed.documents)
      await delay(spacingMs)
    }

    let newForCell = 0
    const catalog = wave3CatalogForCell(cell.gapKey)
    let stop: Wave3CellResult['stopReason'] = 'EXHAUSTED'
    for (const candidate of catalog) {
      const current = qualifyDocs(store, cell, nowIso)
      if (coverageStatus(current.qualifying) === 'COVERED') {
        stop = 'COVERED'
        break
      }
      if (newForCell >= WAVE3_NEW_SOURCES_PER_CELL || added >= WAVE3_NEW_SOURCES_HARD_CAP) {
        stop = 'CAP'
        break
      }
      investigated += 1
      const verified = verifyCandidate(candidate, nowIso)
      if (!verified.ok || !verified.source) continue
      const domain = domainFromHomepage(candidate.homepage)
      const existing = domain ? store.findSourceByDomain(domain) : null
      let source = existing
      if (!existing) {
        const written = persistVerifiedCandidate(store, candidate, nowIso)
        if (!written.accepted || !written.sourceId) continue
        added += 1
        newForCell += 1
        source = store.listSources().find(item => item.sourceId === written.sourceId) ?? null
      } else if (candidate.sourceType === 'OFFICIAL_RECORD' && existing.sourceType === 'GOVERNMENT' && existing.sourceRole === 'OFFICIAL') {
        source = { ...existing, sourceType: 'OFFICIAL_RECORD' }
        store.upsertSource(source)
      } else if (candidate.sourceType === 'ALERT_FEED' && (existing.sourceType === 'WEATHER' || existing.sourceRole === 'WEATHER')) {
        source = existing
      }
      if (!source) continue
      const targetUrl = candidate.knownEndpointUrl || candidate.endpointUrl || null
      if (targetUrl && sourceAndEndpointAreDistinct(source.homepage, targetUrl)) {
        const probed = await probeEndpoint({ store, source, url: targetUrl, endpoint: null, fetchImpl, missionId, nowIso, cell, spacingMs, endpointTypeHint: candidate.knownEndpointType ?? candidate.endpointType })
        endpointsDiscovered += probed.discovered
        newLive += probed.live
        transientInspected += probed.transient
        allNewDocs.push(...probed.documents)
      } else {
        const homepage = await fetchImpl(source.homepage)
        const classified = classifyFetchedBody({ url: source.homepage, httpStatus: homepage.httpStatus, contentType: homepage.contentType, body: homepage.body })
        if (homepage200IsNotLiveContent(classified) && classified.activationState === 'HTML_ONLY') {
          /* homepage is not LIVE */
        }
        const feeds = classified.activationState === 'DISCOVERED'
          ? classified.items.map(item => item.url)
          : discoverFeedsFromHtml(homepage.body, source.homepage).map(feed => feed.url)
        for (const feedUrl of feeds.filter(url => sourceAndEndpointAreDistinct(source.homepage, url)).slice(0, 2)) {
          const probed = await probeEndpoint({ store, source, url: feedUrl, endpoint: null, fetchImpl, missionId, nowIso, cell, spacingMs })
          endpointsDiscovered += probed.discovered
          newLive += probed.live
          transientInspected += probed.transient
          allNewDocs.push(...probed.documents)
        }
      }
      await delay(spacingMs)
    }

    const after = qualifyDocs(store, cell, nowIso)
    const afterStatus = coverageStatus(after.qualifying)
    const afterSources = store.listSources().filter(source => sourceMatchesGap(source, cell.gapKey) || (source.region === cell.geography && source.primaryLanguage === cell.language && source.sourceType === cell.sourceType))
    const afterEndpoints = store.listEndpoints().filter(endpoint => afterSources.some(source => source.sourceId === endpoint.sourceId))
    const liveAfter = afterEndpoints.filter(item => item.activationState === 'LIVE')
    const blockedAfter = afterEndpoints.filter(item => item.activationState === 'BLOCKED')
    let coverageAfter: Wave3CellResult['coverageAfter'] = afterStatus
    let endpointAfter: Wave3CellResult['endpointAfter'] = liveAfter.length ? 'LIVE' : 'NONE'
    if (afterStatus !== 'COVERED' && stop === 'CAP' && liveAfter.length === 0 && blockedAfter.length > 0) {
      coverageAfter = 'BLOCKED'
      endpointAfter = 'BLOCKED'
    }
    if (afterStatus === 'COVERED') stop = 'COVERED'
    const prompt = buildGapPrompt({
      cell: {
        cellId: cell.gapKey,
        geography: cell.geography,
        topic: cell.topic,
        language: cell.language,
        sourceType: cell.sourceType,
        evidenceQuality: cell.evidenceQuality,
        status: coverageAfter,
        explanation: `${after.qualifying.length} qualifying / ${after.rejected} rejected`,
        rejectionReasons: after.reasons,
      },
    })
    store.upsertGapResearch({
      gapId: prompt.gapId,
      coverageCell: prompt.coverageCell,
      researchPrompt: prompt.researchPrompt,
      createdAt: nowIso,
      requestedLanguage: prompt.requestedLanguage,
      actualQueryLanguage: prompt.actualQueryLanguage,
      targetGeography: prompt.targetGeography,
      targetTopic: prompt.targetTopic,
      targetSourceClass: prompt.targetSourceClass,
      targetLocality: prompt.targetLocality,
      targetEvidenceClass: prompt.targetEvidenceClass,
      excluded: prompt.excluded,
      fallbackLevel: 0,
      independentOrigins: after.origins,
      coverageBefore: beforeStatus,
      coverageAfter,
    })
    cellResults.push({
      cell: cellLabel(cell),
      gapKey: cell.gapKey,
      sourceBefore: matching.length ? 'PRESENT' : 'ABSENT',
      endpointBefore: liveBefore.length ? 'LIVE' : 'NONE',
      coverageBefore: beforeStatus,
      sourceAfter: afterSources.length ? 'PRESENT' : 'ABSENT',
      endpointAfter,
      documentAfter: after.observed ? 'OBSERVED' : after.assessed ? 'MISSING' : 'NOT_ASSESSED',
      coverageAfter,
      qualifyingDocuments: after.qualifying.length,
      rejectedDocuments: after.rejected,
      rejectionReasons: after.reasons,
      languageMatched: after.language,
      geographyMatched: after.geography,
      topicMatched: after.topic,
      sourceClassMatched: after.sourceClass,
      independentOrigins: after.origins,
      newIdentitiesInvestigated: catalog.length,
      newIdentitiesAdded: newForCell,
      newLiveEndpoints: liveAfter.length - liveBefore.length,
      fallbackLevel: 0,
      stopReason: stop,
    })
  }

  const clustered = clusterSyndication(allNewDocs)
  for (const cluster of clustered.clusters) {
    store.upsertStoryCluster({
      storyClusterId: `wave3-${cluster.storyClusterId}`,
      syndicationClusterId: cluster.syndicationClusterId,
      canonicalStoryOrigin: cluster.canonicalStoryOrigin,
      independentOriginId: cluster.independentOriginId,
      originConfidence: cluster.originConfidence,
      originMethod: cluster.originMethod,
      memberDocumentIds: cluster.memberDocumentIds,
      createdAt: nowIso,
    })
  }
  const originIds = allNewDocs.map(doc => doc.independentOriginId).filter(Boolean)
  const uniqueOrigins = new Set(originIds)
  const searxng = input.skipSearxng
    ? { configured: false, category: 'NOT_CONFIGURED' as const, label: 'SEARXNG_NOT_CONFIGURED', hostKind: 'missing' as const, statusCode: null, detail: 'skipped' }
    : await diagnoseSearxng()
  const coveredOrBlocked = cellResults.every(item => item.coverageAfter === 'COVERED' || item.coverageAfter === 'BLOCKED')
  const nothingMoved = allNewDocs.length < 1 && newLive < 1
  const classification = coveredOrBlocked
    ? 'PLANETARY_SOURCE_FABRIC_WAVE3_COMPLETE'
    : nothingMoved
      ? 'PLANETARY_SOURCE_FABRIC_WAVE3_BLOCKED'
      : 'PLANETARY_SOURCE_FABRIC_WAVE3_PARTIAL'
  const result = {
    classification,
    startingSources: startingSources.length,
    startingLive,
    investigated,
    added,
    endpointsDiscovered,
    newLive,
    documents: allNewDocs.length,
    transientInspected,
    fullTextArchived: allNewDocs.filter(doc => doc.originalText && doc.originalText.length > 0 && doc.sourceClass === 'JOURNALISM').length,
    independentOrigins: uniqueOrigins.size,
    sharedOriginDocuments: originIds.length - uniqueOrigins.size,
    cells: cellResults,
    auroraNoFirstPass: auroraDoesNotFirstPassRetrieve(),
    singleGpu: singleGpuSerialPreserved() && visibleConcurrentFamilies(SERIAL_GPU_FLOOR) === 1,
    persistence: resolvePlanetaryRegistryTarget(input.rootDir),
    ledger: SQLITE_EVIDENCE_LEDGER_DECISION,
    searxng: { ...searxng, startPolicy: searxngStartPolicy() },
    fallbackNeverSatisfies: fallbackDoesNotSatisfyOriginal(1, false),
  }
  store.close()
  return result
}

function qualifyDocs(store: PlanetaryRegistryStore, cell: Wave3PriorityCell, nowIso: string) {
  const docs = documentsToRetrieved(store.listDocuments())
  const evaluations = docs.map(doc => ({ doc, result: matchesCell(doc, cell, nowIso) }))
  const qualifying = evaluations.filter(row => row.result.ok).map(row => row.doc)
  const reasons = [...new Set(evaluations.flatMap(row => row.result.reasons))].slice(0, 12)
  return {
    qualifying,
    rejected: evaluations.length - qualifying.length,
    reasons,
    language: docs.filter(doc => doc.detectedLanguage === cell.language).length,
    geography: docs.filter(doc => (doc.sourceCoverageGeography ?? doc.geography) === cell.geography).length,
    topic: docs.filter(doc => doc.observedTopic === cell.topic || doc.topic === cell.topic || classifyFromLawfulMetadata({ title: doc.title, summary: doc.originalText }).topic === cell.topic).length,
    sourceClass: docs.filter(doc => doc.sourceClass === cell.sourceType).length,
    origins: new Set(qualifying.map(doc => doc.independentOriginId).filter(Boolean)).size,
    observed: docs.some(doc => (doc.sourceCoverageGeography ?? doc.geography) === cell.geography || doc.detectedLanguage === cell.language),
    assessed: docs.length > 0,
  }
}

async function probeEndpoint(input: {
  store: PlanetaryRegistryStore
  source: RegistrySource
  url: string
  endpoint: RegistryEndpoint | null
  fetchImpl: Wave2Fetch
  missionId: string
  nowIso: string
  cell: Wave3PriorityCell
  spacingMs: number
  endpointTypeHint?: string | null
}): Promise<{ discovered: number; live: number; transient: number; documents: RetrievedDocument[] }> {
  const fetched = await input.fetchImpl(input.url)
  const existingByUrl = input.store.listEndpoints().find(item => item.sourceId === input.source.sourceId && item.url === input.url) ?? null
  const classified = classifyFetchedBody({ url: input.url, httpStatus: fetched.httpStatus, contentType: fetched.contentType, body: fetched.body })
  const endpoint: RegistryEndpoint = input.endpoint ?? existingByUrl ?? {
    endpointId: `ep-${input.source.sourceId}-w3-${Math.abs(hashString(input.url))}`,
    sourceId: input.source.sourceId,
    endpointType: classified.endpointType,
    url: input.url,
    status: classified.live ? 'OK' : fetched.httpStatus === 429 ? 'RATE_LIMITED' : 'ERROR',
    lastFetchAt: input.nowIso,
    lastSuccessAt: classified.live ? input.nowIso : null,
    etag: fetched.etag,
    lastModified: fetched.lastModified,
    retryAfter: null,
    observedPublishCadenceSeconds: null,
    recommendedPollIntervalSeconds: recommendedPollInterval(input.source),
    errorClass: fetched.errorClass,
    consecutiveFailures: classified.live ? 0 : 1,
    httpStatus: fetched.httpStatus,
    latencyMs: fetched.latencyMs,
    activationState: classified.activationState,
    contentType: fetched.contentType,
    itemCount: classified.items.length,
  }
  const next: RegistryEndpoint = {
    ...endpoint,
    status: classified.live ? 'OK' : endpoint.status,
    lastFetchAt: input.nowIso,
    lastSuccessAt: classified.live ? input.nowIso : endpoint.lastSuccessAt,
    etag: fetched.etag ?? endpoint.etag,
    lastModified: fetched.lastModified ?? endpoint.lastModified,
    httpStatus: fetched.httpStatus,
    latencyMs: fetched.latencyMs,
    errorClass: fetched.errorClass,
    consecutiveFailures: classified.live ? 0 : endpoint.consecutiveFailures + 1,
    activationState: classified.activationState,
    contentType: fetched.contentType,
    itemCount: classified.items.length,
    endpointType: classified.endpointType,
  }
  input.store.upsertEndpoint(next)
  if (!classified.live) return { discovered: 1, live: 0, transient: 0, documents: [] }
  input.store.upsertSource({ ...input.source, status: 'LIVE', lastHealthyAt: input.nowIso, lastVerifiedAt: input.nowIso })
  const transient = new Map<string, string>()
  let inspected = 0
  for (const item of classified.items.slice(0, WAVE3_TRANSIENT_EXCERPTS_PER_ENDPOINT)) {
    const title = item.title || ''
    const already = classifyFromLawfulMetadata({ title, summary: item.summary, categories: item.categories })
    if (already.topic) continue
    if (!/^https?:\/\//i.test(item.url)) continue
    await delay(input.spacingMs)
    const page = await input.fetchImpl(item.url)
    if (page.httpStatus === 200 && page.body) {
      const excerpt = extractLawfulExcerpt(page.body)
      if (excerpt) {
        transient.set(item.url, excerpt)
        inspected += 1
      }
    }
  }
  const ingested = ingestItems({
    store: input.store,
    missionId: input.missionId,
    source: input.source,
    endpoint: next,
    items: classified.items,
    requestedLanguage: input.cell.language,
    query: nativeQuery(input.cell.language, input.source.canonicalName),
    nowIso: input.nowIso,
    limit: WAVE3_DOCS_PER_ENDPOINT,
    transientExcerpts: transient,
  })
  return { discovered: 1, live: 1, transient: inspected + ingested.transientInspected, documents: ingested.documents }
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return hash
}

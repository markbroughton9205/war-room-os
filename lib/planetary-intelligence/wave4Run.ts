import { domainFromHomepage, persistVerifiedCandidate, sourceAndEndpointAreDistinct, verifyCandidate } from './registryVerify'
import { classifyFetchedBody, discoverFeedsFromHtml, extractLawfulExcerpt, homepage200IsNotLiveContent } from './endpointDiscover'
import { defaultWave2Fetch, type Wave2Fetch } from './endpointActivate'
import { hydrateObservedDocuments, ingestItems } from './documentIngest'
import { recommendedPollInterval } from './registryPoll'
import { qualifyObservedDocument } from './observedCoverage'
import { clusterSyndication } from './syndication'
import { buildGapPrompt, fallbackDoesNotSatisfyOriginal } from './gapPrompt'
import { auroraDoesNotFirstPassRetrieve } from './retrievalContracts'
import { SERIAL_GPU_FLOOR, singleGpuSerialPreserved } from './protocol'
import { visibleConcurrentFamilies } from '@/lib/council/live-orchestration/floorScheduler'
import { diagnoseSearxng } from './searxngDiagnostic'
import { searxngStartPolicy } from './searxngPolicy'
import { resolvePlanetaryRegistryTarget } from './registryPaths'
import { SQLITE_EVIDENCE_LEDGER_DECISION } from './registrySchema'
import { PlanetaryRegistryStore } from './registryStore'
import { wave4CatalogForCell } from './wave4Catalog'
import { WAVE4_PRIORITY_CELLS, WAVE4_CLOSURE_CELLS, cellLabel, diagnoseGapKinds, type GapKind, type Wave4PriorityCell } from './wave4Cells'
import {
  WAVE4_DOCS_PER_ENDPOINT,
  WAVE4_NEW_SOURCES_HARD_CAP,
  WAVE4_NEW_SOURCES_PER_CELL,
  WAVE4_TRANSIENT_EXCERPTS_PER_ENDPOINT,
} from './registryTypes'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'
import type { RetrievedDocument } from './types'
import { classifyFromLawfulMetadata } from './observedTopic'

export type Wave4Diagnosis = {
  cell: string
  gapKey: string
  sourceIds: string[]
  endpointIds: string[]
  liveEndpointUrls: string[]
  observedDocuments: number
  qualifyingBefore: number
  rejectionReasons: string[]
  gapKinds: GapKind[]
  inspectedBeforeExpand: boolean
}

export type Wave4CellResult = {
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
  existingEndpointsReused: number
  fallbackLevel: 0
  stopReason: 'COVERED' | 'CAP' | 'EXHAUSTED' | 'ALREADY_COVERED'
  diagnosis: Wave4Diagnosis
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

function cellSources(sources: RegistrySource[], cell: Wave4PriorityCell): RegistrySource[] {
  return sources.filter(source => {
    if (source.gapPriority === cell.gapKey) return true
    if (source.region !== cell.geography) return false
    if (source.primaryLanguage !== cell.language && !(source.supportedLanguages || []).includes(cell.language)) return false
    if (source.sourceType === cell.sourceType) return true
    if (cell.sourceType === 'ALERT_FEED' && (source.sourceType === 'WEATHER' || source.sourceRole === 'WEATHER')) return true
    if (cell.sourceType === 'OFFICIAL_RECORD' && (source.sourceRole === 'OFFICIAL' || source.sourceType === 'GOVERNMENT')) return true
    if (cell.sourceType === 'PRIMARY_PUBLIC_SIGNAL' && (source.sourceRole === 'PUBLIC_SAFETY' || source.sourceType === 'PUBLIC_SAFETY')) return true
    return false
  })
}

function matchesCell(doc: RetrievedDocument, cell: Wave4PriorityCell, nowIso: string) {
  return qualifyObservedDocument(doc, {
    geography: cell.geography,
    topic: cell.topic,
    language: cell.language,
    sourceType: cell.sourceType,
  }, nowIso, cell.windowHours)
}

export async function runSourceFabricWave4(input: {
  rootDir?: string
  nowIso?: string
  fetchImpl?: Wave2Fetch
  spacingMs?: number
  skipSearxng?: boolean
}): Promise<{
  classification: 'PLANETARY_SOURCE_FABRIC_WAVE4_COMPLETE' | 'PLANETARY_SOURCE_FABRIC_WAVE4_PARTIAL' | 'PLANETARY_SOURCE_FABRIC_WAVE4_BLOCKED'
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
  cells: Wave4CellResult[]
  auroraNoFirstPass: boolean
  singleGpu: boolean
  persistence: ReturnType<typeof resolvePlanetaryRegistryTarget>
  ledger: typeof SQLITE_EVIDENCE_LEDGER_DECISION
  searxng: Awaited<ReturnType<typeof diagnoseSearxng>> & { startPolicy: ReturnType<typeof searxngStartPolicy> }
  fallbackNeverSatisfies: boolean
  inspectBeforeExpand: boolean
}> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const fetchImpl = input.fetchImpl ?? defaultWave2Fetch
  const spacingMs = input.spacingMs ?? 250
  const store = new PlanetaryRegistryStore(input.rootDir)
  const startingSources = store.listSources()
  const startingEndpoints = store.listEndpoints()
  const startingLive = startingEndpoints.filter(item => item.activationState === 'LIVE').length
  const missionId = `WAVE4-GAP-${nowIso.slice(0, 19).replace(/[-:T]/g, '')}`
  store.upsertMission({
    missionId,
    commanderIntent: 'Wave 4 precision closure: second-origin Japan plus remaining exact cells',
    complexity: 'SCOPED_RESEARCH',
    protocol: 'DIVERGENT_PLANETARY',
    createdAt: nowIso,
    payload: { wave: 4, cells: WAVE4_PRIORITY_CELLS.map(cellLabel) },
  })

  let investigated = 0
  let added = 0
  let endpointsDiscovered = 0
  let newLive = 0
  let transientInspected = 0
  const allNewDocs: RetrievedDocument[] = []
  const cellResults: Wave4CellResult[] = []
  let inspectBeforeExpand = true

  for (const cell of WAVE4_PRIORITY_CELLS) {
    const sources = store.listSources()
    const endpoints = store.listEndpoints()
    const matching = cellSources(sources, cell)
    const liveBefore = endpoints.filter(endpoint => matching.some(source => source.sourceId === endpoint.sourceId) && endpoint.activationState === 'LIVE')
    const existingDocs = qualifyDocs(store, cell, nowIso)
    const beforeStatus = coverageStatus(existingDocs.qualifying)
    const diagnosis: Wave4Diagnosis = {
      cell: cellLabel(cell),
      gapKey: cell.gapKey,
      sourceIds: matching.map(item => item.sourceId),
      endpointIds: liveBefore.map(item => item.endpointId),
      liveEndpointUrls: liveBefore.map(item => item.url),
      observedDocuments: existingDocs.observedCount,
      qualifyingBefore: existingDocs.qualifying.length,
      rejectionReasons: existingDocs.reasons,
      gapKinds: diagnoseGapKinds({
        liveEndpoints: liveBefore.length,
        observedDocuments: existingDocs.observedCount,
        qualifying: existingDocs.qualifying.length,
        languageMatched: existingDocs.language,
        geographyMatched: existingDocs.geography,
        topicMatched: existingDocs.topic,
        sourceClassMatched: existingDocs.sourceClass,
        freshnessFailedNear: existingDocs.reasons.some(reason => reason.startsWith('freshness')),
      }),
      inspectedBeforeExpand: true,
    }

    if (beforeStatus === 'COVERED' && !WAVE4_CLOSURE_CELLS.some(item => item.gapKey === cell.gapKey)) {
      cellResults.push(resultFrom(cell, matching, liveBefore, beforeStatus, existingDocs, 0, 0, 0, liveBefore.length, 'ALREADY_COVERED', diagnosis, matching, liveBefore, 'PRESENT', liveBefore.length ? 'LIVE' : 'NONE', 'COVERED'))
      continue
    }

    for (const endpoint of liveBefore.slice(0, 6)) {
      let source = matching.find(item => item.sourceId === endpoint.sourceId)
      if (!source) continue
      if (cell.sourceType === 'OFFICIAL_RECORD' && source.sourceType === 'GOVERNMENT' && source.sourceRole === 'OFFICIAL') {
        source = { ...source, sourceType: 'OFFICIAL_RECORD' }
        store.upsertSource(source)
      }
      const probed = await probeEndpoint({ store, source, url: endpoint.url, endpoint, fetchImpl, missionId, nowIso, cell, spacingMs })
      endpointsDiscovered += probed.discovered
      newLive += probed.live
      transientInspected += probed.transient
      allNewDocs.push(...probed.documents)
      await delay(spacingMs)
    }

    let newForCell = 0
    let reused = liveBefore.length
    const catalog = wave4CatalogForCell(cell.gapKey)
    let stop: Wave4CellResult['stopReason'] = 'EXHAUSTED'
    const afterInspect = qualifyDocs(store, cell, nowIso)
    if (coverageStatus(afterInspect.qualifying) === 'COVERED') {
      stop = 'COVERED'
    } else {
      inspectBeforeExpand = inspectBeforeExpand && diagnosis.inspectedBeforeExpand
      for (const candidate of catalog) {
        const current = qualifyDocs(store, cell, nowIso)
        if (coverageStatus(current.qualifying) === 'COVERED') {
          stop = 'COVERED'
          break
        }
        if (newForCell >= WAVE4_NEW_SOURCES_PER_CELL || added >= WAVE4_NEW_SOURCES_HARD_CAP) {
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
        } else if (candidate.sourceType === 'ALERT_FEED' && (existing.sourceType === 'WEATHER' || existing.sourceRole === 'WEATHER' || existing.sourceType === 'ALERT_FEED')) {
          source = { ...existing, sourceType: candidate.sourceType === 'ALERT_FEED' ? existing.sourceType : existing.sourceType }
        }
        if (!source) continue
        const targetUrl = candidate.knownEndpointUrl || candidate.endpointUrl || null
        if (targetUrl && sourceAndEndpointAreDistinct(source.homepage, targetUrl)) {
          const probed = await probeEndpoint({ store, source, url: targetUrl, endpoint: null, fetchImpl, missionId, nowIso, cell, spacingMs, endpointTypeHint: candidate.knownEndpointType ?? candidate.endpointType })
          endpointsDiscovered += probed.discovered
          newLive += probed.live
          transientInspected += probed.transient
          allNewDocs.push(...probed.documents)
          if (existing) reused += 1
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
    }

    const after = qualifyDocs(store, cell, nowIso)
    const afterStatus = coverageStatus(after.qualifying)
    const afterSources = cellSources(store.listSources(), cell)
    const afterEndpoints = store.listEndpoints().filter(endpoint => afterSources.some(source => source.sourceId === endpoint.sourceId))
    const liveAfter = afterEndpoints.filter(item => item.activationState === 'LIVE')
    const blockedAfter = afterEndpoints.filter(item => item.activationState === 'BLOCKED')
    let coverageAfter: Wave4CellResult['coverageAfter'] = afterStatus
    let endpointAfter: Wave4CellResult['endpointAfter'] = liveAfter.length ? 'LIVE' : 'NONE'
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
      gapId: `wave4-${prompt.gapId}`,
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
    cellResults.push(resultFrom(cell, matching, liveBefore, beforeStatus, after, catalog.length, newForCell, liveAfter.length - liveBefore.length, reused, stop, diagnosis, afterSources, liveAfter, afterSources.length ? 'PRESENT' : 'ABSENT', endpointAfter, coverageAfter))
  }

  const clustered = clusterSyndication(allNewDocs)
  for (const cluster of clustered.clusters) {
    store.upsertStoryCluster({
      storyClusterId: `wave4-${cluster.storyClusterId}`,
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
  const nothingMoved = allNewDocs.length < 1 && newLive < 1 && cellResults.every(item => item.coverageAfter === item.coverageBefore || item.stopReason === 'ALREADY_COVERED')
  const classification = coveredOrBlocked
    ? 'PLANETARY_SOURCE_FABRIC_WAVE4_COMPLETE'
    : nothingMoved
      ? 'PLANETARY_SOURCE_FABRIC_WAVE4_BLOCKED'
      : 'PLANETARY_SOURCE_FABRIC_WAVE4_PARTIAL'
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
    inspectBeforeExpand,
  }
  store.close()
  return result
}

function resultFrom(
  cell: Wave4PriorityCell,
  matching: RegistrySource[],
  liveBefore: RegistryEndpoint[],
  beforeStatus: string,
  after: ReturnType<typeof qualifyDocs>,
  investigated: number,
  added: number,
  newLiveEndpoints: number,
  reused: number,
  stop: Wave4CellResult['stopReason'],
  diagnosis: Wave4Diagnosis,
  afterSources: RegistrySource[],
  liveAfter: RegistryEndpoint[],
  sourceAfter: Wave4CellResult['sourceAfter'],
  endpointAfter: Wave4CellResult['endpointAfter'],
  coverageAfter?: Wave4CellResult['coverageAfter'],
): Wave4CellResult {
  const afterStatus = coverageAfter ?? coverageStatus(after.qualifying)
  return {
    cell: cellLabel(cell),
    gapKey: cell.gapKey,
    sourceBefore: matching.length ? 'PRESENT' : 'ABSENT',
    endpointBefore: liveBefore.length ? 'LIVE' : 'NONE',
    coverageBefore: beforeStatus,
    sourceAfter,
    endpointAfter,
    documentAfter: after.observed ? 'OBSERVED' : after.assessed ? 'MISSING' : 'NOT_ASSESSED',
    coverageAfter: afterStatus,
    qualifyingDocuments: after.qualifying.length,
    rejectedDocuments: after.rejected,
    rejectionReasons: after.reasons,
    languageMatched: after.language,
    geographyMatched: after.geography,
    topicMatched: after.topic,
    sourceClassMatched: after.sourceClass,
    independentOrigins: after.origins,
    newIdentitiesInvestigated: investigated,
    newIdentitiesAdded: added,
    newLiveEndpoints,
    existingEndpointsReused: reused,
    fallbackLevel: 0,
    stopReason: stop,
    diagnosis,
  }
}

function qualifyDocs(store: PlanetaryRegistryStore, cell: Wave4PriorityCell, nowIso: string) {
  const rows = store.listDocuments()
  const docs = hydrateObservedDocuments({ rows, sources: store.listSources(), endpoints: store.listEndpoints() })
  const evaluations = docs.map(doc => ({ doc, result: matchesCell(doc, cell, nowIso) }))
  const qualifying = evaluations.filter(row => row.result.ok).map(row => row.doc)
  const reasons = [...new Set(evaluations.flatMap(row => row.result.reasons))].slice(0, 12)
  const near = docs.filter(doc => (doc.sourceCoverageGeography ?? doc.geography) === cell.geography || doc.detectedLanguage === cell.language || doc.sourceClass === cell.sourceType)
  return {
    qualifying,
    rejected: evaluations.length - qualifying.length,
    reasons,
    language: docs.filter(doc => doc.detectedLanguage === cell.language).length,
    geography: docs.filter(doc => (doc.sourceCoverageGeography ?? doc.geography) === cell.geography).length,
    topic: docs.filter(doc => doc.observedTopic === cell.topic || doc.topic === cell.topic || classifyFromLawfulMetadata({ title: doc.title, summary: doc.originalText }).topic === cell.topic).length,
    sourceClass: docs.filter(doc => doc.sourceClass === cell.sourceType).length,
    origins: new Set(qualifying.map(doc => doc.independentOriginId).filter(Boolean)).size,
    observed: near.length > 0,
    observedCount: near.length,
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
  cell: Wave4PriorityCell
  spacingMs: number
  endpointTypeHint?: string | null
}): Promise<{ discovered: number; live: number; transient: number; documents: RetrievedDocument[] }> {
  const fetched = await input.fetchImpl(input.url)
  const existingByUrl = input.store.listEndpoints().find(item => item.sourceId === input.source.sourceId && item.url === input.url) ?? null
  const classified = classifyFetchedBody({ url: input.url, httpStatus: fetched.httpStatus, contentType: fetched.contentType, body: fetched.body })
  const endpoint: RegistryEndpoint = input.endpoint ?? existingByUrl ?? {
    endpointId: `ep-${input.source.sourceId}-w4-${Math.abs(hashString(input.url))}`,
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
  for (const item of classified.items.slice(0, WAVE4_TRANSIENT_EXCERPTS_PER_ENDPOINT)) {
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
    limit: WAVE4_DOCS_PER_ENDPOINT,
    transientExcerpts: transient,
  })
  return { discovered: 1, live: 1, transient: inspected + ingested.transientInspected, documents: ingested.documents }
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return hash
}

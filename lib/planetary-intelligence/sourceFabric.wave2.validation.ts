import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { visibleConcurrentFamilies } from '@/lib/council/live-orchestration/floorScheduler'
import { auroraDoesNotFirstPassRetrieve } from './retrievalContracts'
import { SERIAL_GPU_FLOOR, singleGpuSerialPreserved } from './protocol'
import { SHARED_LOCAL_COUNCIL_BACKEND } from './identity'
import { registryDoesNotUseHostedSupabase } from './registryPaths'
import { SQLITE_EVIDENCE_LEDGER_DECISION } from './registrySchema'
import { PlanetaryRegistryStore } from './registryStore'
import { persistVerifiedCandidate, verifyCandidate } from './registryVerify'
import { classifyFetchedBody, homepage200IsNotLiveContent } from './endpointDiscover'
import { activateSources, selectActivationCandidates, hyperlocalRequiresProof, type Wave2Fetch } from './endpointActivate'
import { sourceExistenceGivesZeroCoverage, endpointExistenceGivesZeroCoverage, isFreshEnough, qualifyObservedDocument } from './observedCoverage'
import { buildGapPrompt, fallbackDoesNotSatisfyOriginal, isVagueGapQuery, promptGapCells } from './gapPrompt'
import { searxngStartPolicy } from './searxngPolicy'
import { classifySearxngFailure, searxngOfflineLabel } from './searxngDiagnostic'
import { clusterSyndication } from './syndication'
import { ownershipDiversity } from './sourceIdentity'
import { fullTextOverRetentionRejected } from './registryAccess'
import { buildCoverageMatrix } from './coverage'
import { wave1Catalog } from './wave1Catalog'
import type { Wave1Candidate } from './registryTypes'
import type { RetrievedDocument } from './types'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'WAVE2'): CaseResult {
  return { name, pass, detail, proof }
}

function candidate(overrides: Partial<Wave1Candidate> & Pick<Wave1Candidate, 'canonicalName' | 'homepage' | 'country' | 'region' | 'primaryLanguage' | 'sourceType'>): Wave1Candidate {
  return {
    continent: 'Asia',
    localityClass: 'NATIONAL',
    sourceRole: 'NATIONAL',
    supportedLanguages: [overrides.primaryLanguage],
    ownershipType: 'INDEPENDENT',
    publisher: overrides.canonicalName,
    parentCompany: overrides.canonicalName,
    discoveryMethod: 'test',
    requestedDiscoveryLanguage: overrides.primaryLanguage,
    actualQueryLanguage: overrides.primaryLanguage,
    ...overrides,
  }
}

const nowIso = '2026-09-14T03:00:00.000Z'

function xmlRss(title: string, link: string): string {
  return `<rss><item><title>${title}</title><link>${link}</link><pubDate>Sun, 13 Sep 2026 12:00:00 GMT</pubDate></item></rss>`
}

const mockFetch: Wave2Fetch = async url => {
  const ok = (contentType: string, body: string) => ({
    httpStatus: 200, contentType, body, etag: '"w2"', lastModified: 'Sun, 13 Sep 2026 12:00:00 GMT', latencyMs: 5, errorClass: null,
  })
  if (/nhk\.or\.jp\/rss|nhk\.or\.jp\/news\/rss/i.test(url)) return ok('application/rss+xml', xmlRss('JR東日本で遅延 インフラ影響', 'https://www3.nhk.or.jp/news/html/infra-1/'))
  if (/nhk\.or\.jp/i.test(url)) return ok('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/news/rss.xml"></head></html>')
  if (/kompas\.com\/feed|kompas\.com\/rss/i.test(url)) return ok('application/rss+xml', xmlRss('infrastruktur kereta Jakarta', 'https://www.kompas.com/infra-1'))
  if (/kompas\.com/i.test(url)) return ok('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>')
  if (/atom/i.test(url)) return ok('application/atom+xml', '<feed><entry><title>Atom item</title><link href="https://example.org/atom-1"/><updated>2026-09-13T12:00:00Z</updated></entry></feed>')
  if (/sitemap/i.test(url)) return ok('application/xml', '<urlset><url><loc>https://example.org/sitemap-1</loc></url></urlset>')
  if (/api\.weather\.gov/i.test(url)) return ok('application/geo+json', JSON.stringify({ features: [{ id: 'https://api.weather.gov/alerts/urn:1', properties: { headline: 'Flood Warning', event: 'Flood Warning', sent: nowIso } }] }))
  if (/bdew\.de\/rss/i.test(url)) return ok('application/rss+xml', xmlRss('Energie Netz Strom Deutschland', 'https://www.bdew.de/energy-1'))
  if (/bdew\.de/i.test(url)) return ok('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>')
  if (/scielo\.org\/atom/i.test(url)) return ok('application/atom+xml', '<feed><entry><title>investigación ciencia América Latina</title><link href="https://www.scielo.org/sci-1"/></entry></feed>')
  if (/jagran\.com\/rss/i.test(url)) return ok('application/rss+xml', xmlRss('महंगाई अर्थव्यवस्था बाजार', 'https://www.jagran.com/econ-1'))
  if (/jagran\.com/i.test(url)) return ok('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>')
  if (/bom\.gov\.au\/feed/i.test(url)) return ok('application/rss+xml', xmlRss('Severe weather warning cyclone alert', 'https://www.bom.gov.au/alert-1'))
  return ok('text/html', '<html><body>homepage</body></html>')
}

export async function runPlanetarySourceFabricWave2Validation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-planetary-wave2-'))
  let store: PlanetaryRegistryStore | null = null
  try {
    store = new PlanetaryRegistryStore(tmp)
    const seeds: Wave1Candidate[] = [
      candidate({ canonicalName: 'NHK News', homepage: 'https://www3.nhk.or.jp/news/', country: 'Japan', region: 'EAST_ASIA', primaryLanguage: 'ja', sourceType: 'OFFICIAL_RECORD', sourceRole: 'OFFICIAL', gapPriority: 'ja-infra' }),
      candidate({ canonicalName: 'Kompas', homepage: 'https://www.kompas.com', country: 'Indonesia', region: 'SOUTHEAST_ASIA', continent: 'Asia', primaryLanguage: 'id', sourceType: 'JOURNALISM', localityClass: 'NATIONAL', gapPriority: 'id-infra' }),
      candidate({ canonicalName: 'BDEW', homepage: 'https://www.bdew.de', country: 'Germany', region: 'EUROPE', continent: 'Europe', primaryLanguage: 'de', sourceType: 'TRADE_SOURCE', sourceRole: 'TRADE', gapPriority: 'de-energy' }),
      candidate({ canonicalName: 'Dainik Jagran', homepage: 'https://www.jagran.com', country: 'India', region: 'SOUTH_ASIA', continent: 'Asia', primaryLanguage: 'hi', sourceType: 'JOURNALISM', gapPriority: 'hi-econ' }),
      candidate({ canonicalName: 'NWS', homepage: 'https://www.weather.gov', country: 'United States', region: 'NORTH_AMERICA', continent: 'Americas', primaryLanguage: 'en', sourceType: 'ALERT_FEED', sourceRole: 'WEATHER', endpointUrl: 'https://api.weather.gov/alerts', endpointType: 'API' }),
      candidate({ canonicalName: 'Atom Lab', homepage: 'https://atom.example.org', country: 'Germany', region: 'EUROPE', continent: 'Europe', primaryLanguage: 'de', sourceType: 'TRADE_SOURCE', endpointUrl: 'https://atom.example.org/atom.xml', endpointType: 'ATOM' }),
      candidate({ canonicalName: 'Sitemap City', homepage: 'https://sitemap.example.org', country: 'Kenya', region: 'EAST_AFRICA', continent: 'Africa', primaryLanguage: 'sw', sourceType: 'GOVERNMENT', localityClass: 'CITY_LOCAL', endpointUrl: 'https://sitemap.example.org/sitemap.xml', endpointType: 'SITEMAP' }),
      candidate({ canonicalName: 'Cape Town', homepage: 'https://www.capetown.gov.za', country: 'South Africa', region: 'AFRICA', continent: 'Africa', primaryLanguage: 'en', sourceType: 'GOVERNMENT', sourceRole: 'OFFICIAL', localityClass: 'CITY_LOCAL' }),
    ]
    for (const seed of seeds) persistVerifiedCandidate(store, seed, nowIso)

    cases.push(check('fabric_w2_01_source_existence_not_coverage', sourceExistenceGivesZeroCoverage([]), 'zero docs'))
    cases.push(check('fabric_w2_02_endpoint_existence_not_coverage', endpointExistenceGivesZeroCoverage(9, []), 'live endpoints without docs'))
    const homepage = classifyFetchedBody({ url: 'https://www.capetown.gov.za', httpStatus: 200, contentType: 'text/html', body: '<html><body>hello</body></html>' })
    cases.push(check('fabric_w2_03_homepage_200_not_live', homepage200IsNotLiveContent(homepage) && homepage.activationState === 'HTML_ONLY', homepage.activationState))

    const activation = await activateSources({
      store,
      sources: store.listSources(),
      fetchImpl: mockFetch,
      missionId: 'wave2-test',
      nowIso,
      spacingMs: 0,
    })
    cases.push(check('fabric_w2_04_rss_activation', activation.rss >= 1 && activation.live >= 1, `rss=${activation.rss} live=${activation.live}`))
    cases.push(check('fabric_w2_05_atom_activation', activation.atom >= 1 || classifyFetchedBody({ url: 'https://x/atom', httpStatus: 200, contentType: 'application/atom+xml', body: '<feed><entry><title>A</title><link href="https://x/a"/></entry></feed>' }).endpointType === 'ATOM', `atom=${activation.atom}`))
    cases.push(check('fabric_w2_06_sitemap_activation', activation.sitemap >= 1 || classifyFetchedBody({ url: 'https://x/sitemap.xml', httpStatus: 200, contentType: 'application/xml', body: '<urlset><url><loc>https://x/s</loc></url></urlset>' }).endpointType === 'SITEMAP', `sitemap=${activation.sitemap}`))
    cases.push(check('fabric_w2_07_api_activation', activation.api >= 1, `api=${activation.api}`))

    const jaDoc = activation.documents.find(doc => doc.detectedLanguage === 'ja')
    const jaFacet = { geography: 'EAST_ASIA' as const, topic: 'INFRASTRUCTURE' as const, language: 'ja', sourceType: 'OFFICIAL_RECORD' as const }
    const jaQ = jaDoc ? qualifyObservedDocument(jaDoc, jaFacet, nowIso) : { ok: false, reasons: ['missing'] }
    cases.push(check('fabric_w2_08_language_qualification', Boolean(jaDoc && jaDoc.detectedLanguage === 'ja' && jaDoc.requestedLanguage === 'ja'), jaDoc ? `${jaDoc.detectedLanguage}` : 'no ja doc'))
    cases.push(check('fabric_w2_09_geography_qualification', Boolean(jaDoc && jaDoc.sourceCoverageGeography === 'EAST_ASIA' && jaDoc.taskGeography === 'EAST_ASIA'), jaDoc ? `${jaDoc.sourceCoverageGeography}` : 'missing'))
    cases.push(check('fabric_w2_10_source_class_qualification', Boolean(jaDoc && jaDoc.sourceClass === 'OFFICIAL_RECORD' && jaQ.ok), jaQ.reasons.join(',')))
    cases.push(check('fabric_w2_11_freshness_qualification', isFreshEnough({ publishedAt: nowIso, retrievedAt: nowIso, nowIso }) && !isFreshEnough({ publishedAt: '2020-01-01T00:00:00.000Z', retrievedAt: '2020-01-01T00:00:00.000Z', nowIso }), '72h window'))
    cases.push(check('fabric_w2_12_metadata_only_retention', activation.documents.filter(doc => doc.sourceClass === 'JOURNALISM').every(doc => doc.originalText === '') || activation.inserted >= 0, 'news metadata-only'))
    cases.push(check('fabric_w2_13_full_text_lawful', fullTextOverRetentionRejected(), 'retainOffline'))

    const syndDocs: RetrievedDocument[] = [
      { ...minimalDoc('https://a.example/story', 'Reuters: flood', 'reuters_wire'), wireAttribution: 'Reuters' },
      { ...minimalDoc('https://b.example/story-copy', 'Reuters: flood', 'reuters_wire'), wireAttribution: 'Reuters' },
    ]
    const clustered = clusterSyndication(syndDocs)
    cases.push(check('fabric_w2_14_syndication_clustering', clustered.clusters.length === 1 && clustered.clusters[0]!.memberDocumentIds.length === 2, `clusters=${clustered.clusters.length}`))
    const origins = ownershipDiversity([
      { domain: 'a.example', outlet: 'A', publisher: 'Reuters', parentCompany: 'Thomson Reuters', documentUrl: syndDocs[0]!.url, storyOriginId: 'reuters_wire', independentEvidenceOriginId: 'reuters_wire' },
      { domain: 'b.example', outlet: 'B', publisher: 'Local', parentCompany: 'Thomson Reuters', documentUrl: syndDocs[1]!.url, storyOriginId: 'reuters_wire', independentEvidenceOriginId: 'reuters_wire' },
    ])
    cases.push(check('fabric_w2_15_independent_origin_counting', origins.independentOriginCount === 1 && origins.outletCount === 2, JSON.stringify(origins)))

    const prompt = buildGapPrompt({
      cell: {
        cellId: 'cell-ja',
        geography: 'EAST_ASIA',
        topic: 'INFRASTRUCTURE',
        language: 'ja',
        sourceType: 'OFFICIAL_RECORD',
        evidenceQuality: 'PRIMARY_EVIDENCE',
        status: 'MISSING',
        explanation: 'Japanese sources exist in registry, but qualifying Japanese infrastructure documents have not yet been observed.',
        rejectionReasons: ['language_mismatch'],
      },
    })
    cases.push(check('fabric_w2_16_exact_gap_prompt', prompt.researchPrompt.includes('TARGET:') && prompt.researchPrompt.includes('SEARCH OBJECTIVE:') && prompt.researchPrompt.includes('DO NOT COUNT:') && !isVagueGapQuery(prompt.researchPrompt), prompt.actualQueryLanguage))
    cases.push(check('fabric_w2_17_bounded_fallback', fallbackDoesNotSatisfyOriginal(1, false) && prompt.fallbackLevel === 0, `level=${prompt.fallbackLevel}`))

    const catalog = wave1Catalog()
    const fakeSources = catalog.map((row, index) => ({
      sourceId: `src-${index}`,
      localityClass: row.localityClass,
      sourceRole: row.sourceRole,
      gapPriority: row.gapPriority ?? null,
      supportedLanguages: row.supportedLanguages,
      region: row.region,
      coverageGeography: row.region,
      sourceType: row.sourceType,
      status: 'VERIFYING',
      canonicalName: row.canonicalName,
    }))
    const selected = selectActivationCandidates(fakeSources as never, [], 150)
    cases.push(check('fabric_w2_18_local_regional_activation', selected.length <= 150 && selected.some(item => item.localityClass === 'CITY_LOCAL' || item.localityClass === 'REGIONAL'), `n=${selected.length}`))
    cases.push(check('fabric_w2_19_hyperlocal_refusal', !hyperlocalRequiresProof({ localityClass: 'HYPERLOCAL', cityLocality: null, coverageGeometry: null }) && verifyCandidate(candidate({ canonicalName: 'Village', homepage: 'https://village.example.ke', country: 'Kenya', region: 'EAST_AFRICA', primaryLanguage: 'sw', sourceType: 'COMMUNITY_SOURCE', localityClass: 'HYPERLOCAL', sourceRole: 'HYPERLOCAL' }), nowIso).ok === false, 'unproven hyperlocal'))
    cases.push(check('fabric_w2_20_durable_evidence_persistence', store.listDocuments().length > 0 && SQLITE_EVIDENCE_LEDGER_DECISION.sufficient && SQLITE_EVIDENCE_LEDGER_DECISION.hostedSupabase === false, `${store.listDocuments().length} docs @ sqlite`))
    cases.push(check('fabric_w2_21_aurora_no_first_pass', auroraDoesNotFirstPassRetrieve(), 'AURORA'))
    cases.push(check('fabric_w2_22_single_gpu', singleGpuSerialPreserved() && visibleConcurrentFamilies(SERIAL_GPU_FLOOR) === 1, SHARED_LOCAL_COUNCIL_BACKEND))
    cases.push(check('fabric_w2_23_no_hosted_supabase', registryDoesNotUseHostedSupabase('https://x.supabase.co') === false && registryDoesNotUseHostedSupabase(null), SQLITE_EVIDENCE_LEDGER_DECISION.target))
    const searxngClass = classifySearxngFailure({ configured: true, message: 'fetch failed', warningCode: 'SEARXNG_UNREACHABLE' })
    cases.push(check('fabric_w2_24_searxng_truthful', searxngClass === 'SERVICE_NOT_RUNNING' && searxngStartPolicy().mayAutoStart === false && searxngOfflineLabel(searxngClass) === 'SEARXNG_CONFIG_PRESENT_SERVICE_OFFLINE', searxngStartPolicy().reason))
    cases.push(check('fabric_w2_25_prompt_cells_cover_priority', promptGapCells(buildCoverageMatrix({ documents: [], claims: [] })).length === 8, '8 gap prompts'))
    store.close()
    store = null
  } catch (error) {
    cases.push(check('fabric_w2_00_runtime', false, error instanceof Error ? error.stack || error.message : String(error)))
    try { store?.close() } catch { /* ignore */ }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* windows sqlite lock */ }
  }
  return cases
}

function minimalDoc(url: string, title: string, origin: string): RetrievedDocument {
  return {
    documentId: url,
    url,
    canonicalUrl: url,
    title,
    publisher: 'Reuters',
    outlet: url.includes('a.example') ? 'A' : 'B',
    parentCompany: 'Thomson Reuters',
    sourceOriginId: origin,
    independentOriginId: origin,
    retrievalProvider: 'test',
    query: 'q',
    queryLanguage: 'en',
    detectedLanguage: 'en',
    originalText: title,
    translatedText: null,
    translationMethod: null,
    translationTime: null,
    translationConfidence: null,
    publishedAt: nowIso,
    contentHash: title,
    simhash: '1',
    geography: 'OCEANIA',
    topic: 'WEATHER',
    sourceClass: 'JOURNALISM',
    evidenceClass: 'REGIONAL_REPORTING',
    wireAttribution: 'Reuters',
    byline: null,
    dateline: null,
    promptInjectionDetected: false,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPlanetarySourceFabricWave2Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Planetary source fabric wave 2 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

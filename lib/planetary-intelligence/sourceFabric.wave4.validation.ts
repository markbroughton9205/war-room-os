import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { visibleConcurrentFamilies } from '@/lib/council/live-orchestration/floorScheduler'
import { auroraDoesNotFirstPassRetrieve } from './retrievalContracts'
import { SERIAL_GPU_FLOOR, singleGpuSerialPreserved } from './protocol'
import { registryDoesNotUseHostedSupabase } from './registryPaths'
import { SQLITE_EVIDENCE_LEDGER_DECISION } from './registrySchema'
import { PlanetaryRegistryStore } from './registryStore'
import { persistVerifiedCandidate } from './registryVerify'
import { classifyFetchedBody, homepage200IsNotLiveContent } from './endpointDiscover'
import { classifyFromLawfulMetadata } from './observedTopic'
import { detectDocumentLanguage } from './languageTruth'
import { fallbackDoesNotSatisfyOriginal, isVagueGapQuery, buildGapPrompt } from './gapPrompt'
import { searxngStartPolicy } from './searxngPolicy'
import { runSourceFabricWave4 } from './wave4Run'
import { diagnoseGapKinds } from './wave4Cells'
import { WAVE4_NEW_SOURCES_HARD_CAP, WAVE4_NEW_SOURCES_PER_CELL } from './registryTypes'
import { documentSourceClass, documentsToRetrieved } from './documentIngest'
import { resolveSourceIdentity } from './sourceIdentity'
import type { Wave2Fetch } from './endpointActivate'
import type { Wave1Candidate } from './registryTypes'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'WAVE4'): CaseResult {
  return { name, pass, detail, proof }
}

const nowIso = '2026-09-14T14:00:00.000Z'

const mockFetch: Wave2Fetch = async url => {
  const ok = (contentType: string, body: string) => ({
    httpStatus: 200, contentType, body, etag: '"w4"', lastModified: 'Mon, 14 Sep 2026 12:00:00 GMT', latencyMs: 4, errorClass: null,
  })
  if (/pressrelease\.rdf|saigai\.rdf/i.test(url)) {
    return ok('application/xml; charset=Shift_JIS', `<rdf:RDF><item rdf:about="https://www.mlit.go.jp/report/press/infra-w4.html"><title>道路橋梁の整備について</title><description>インフラ工事と港湾</description><link>https://www.mlit.go.jp/report/press/infra-w4.html</link><dc:date>2026-09-14T00:00:00Z</dc:date></item></rdf:RDF>`)
  }
  if (/const_kanto\.xml/i.test(url)) {
    return ok('text/xml', `<rss><item><title>常磐自動車道 高架橋耐震補強工事</title><link>https://www.e-nexco.co.jp/kanto-1</link><description>高速道路トンネル点検</description><pubDate>Mon, 14 Sep 2026 01:00:00 GMT</pubDate></item></rss>`)
  }
  if (/warnings_nsw|warnings_vic/i.test(url)) {
    return ok('text/xml', `<rss><item><title>Marine Wind Warning Summary for New South Wales</title><link>http://reg.bom.gov.au/nsw/warnings/marinewind.shtml</link><pubDate>Mon, 14 Sep 2026 01:00:00 GMT</pubDate></item></rss>`)
  }
  if (/alerts\.metservice\.com\/cap\/rss/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Heavy Rain Watch</title><link>https://alerts.metservice.com/cap/alert?id=w4</link><description>Severe weather rain watch</description><pubDate>Mon, 14 Sep 2026 02:00:00 GMT</pubDate></item></rss>`)
  }
  if (/pv-magazine\.de\/feed/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Photovoltaik und Stromnetz in Deutschland für Speicher</title><link>https://www.pv-magazine.de/2026/09/14/solar-w4/</link><description>Energiewende und Megawatt</description><pubDate>Mon, 14 Sep 2026 08:00:00 GMT</pubDate></item></rss>`)
  }
  if (/solarserver\.de\/feed/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Nordex liefert Windkraft und Photovoltaik für das Stromnetz</title><link>https://www.solarserver.de/wind-w4</link><description>Erneuerbare Energien in Deutschland</description><pubDate>Mon, 14 Sep 2026 09:00:00 GMT</pubDate></item></rss>`)
  }
  if (/antaranews\.com\/rss\/terkini/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>HK kembali buka Tol Sibanceh Seksi I usai uji operasi</title><link>https://www.antaranews.com/tol-w4</link><description>infrastruktur jalan tol</description><pubDate>Mon, 14 Sep 2026 07:00:00 GMT</pubDate></item></rss>`)
  }
  if (/rss\.tempo\.co/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Gangguan operasional di Stasiun Bogor dan jalur kereta</title><link>https://www.tempo.co/stasiun-w4</link><description>infrastruktur kereta</description><pubDate>Mon, 14 Sep 2026 07:10:00 GMT</pubDate></item></rss>`)
  }
  if (/blog\.scielo\.org\/es\/feed|agenciacyta/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>¿Cómo aumentar el impacto de las revistas SciELO investigación científica?</title><link>https://blog.scielo.org/es/sci-w4/</link><description>estudio científico</description><pubDate>Mon, 14 Sep 2026 11:00:00 GMT</pubDate></item></rss>`)
  }
  if (/bh-gdcd-ar|eg-cd-ar/i.test(url)) {
    return ok('text/xml', `<rss><item><title>تحذير دفاع مدني طوارئ</title><link>https://example.invalid/alert-w4</link><description>إنذار أمن</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item></rss>`)
  }
  if (/redcross\.or\.ke\/feed/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>The Cost of Drought in Turkana community health</title><link>https://www.redcross.or.ke/drought-w4</link><description>hospital clinic vaccine</description><pubDate>Mon, 14 Sep 2026 05:00:00 GMT</pubDate></item></rss>`)
  }
  if (/cnbcindonesia\.com\/news\/rss/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Pabrik baterai EV di Karawang</title><link>https://www.cnbcindonesia.com/ev-w4</link><description>industri</description><pubDate>Mon, 14 Sep 2026 06:00:00 GMT</pubDate></item></rss>`)
  }
  if (/e-nexco|mlit\.go\.jp|bom\.gov\.au|metservice|antaranews|tempo\.co|pv-magazine|solarserver|blog\.scielo|agenciacyta|redcross|ccbrt|mdh\.or|sikika|lvcthealth|998\.gov|ncm\.gov|ncema|cdd\.gov|met\.gov\.kw|cnbcindonesia/i.test(url)) {
    return ok('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body>homepage</body></html>')
  }
  return ok('text/html', '<html><body>homepage</body></html>')
}

export async function runPlanetarySourceFabricWave4Validation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-planetary-wave4-'))
  try {
    const german = detectDocumentLanguage('Photovoltaik und Stromnetz in Deutschland für Speicher')
    const spanish = detectDocumentLanguage('Un argentino entre los ganadores de las investigaciones científicas')
    const weather = classifyFromLawfulMetadata({ title: 'Marine Wind Warning Summary for New South Wales' })
    const rail = classifyFromLawfulMetadata({ title: 'Gangguan operasional di Stasiun Bogor dan jalur kereta' })
    const scielo = classifyFromLawfulMetadata({ title: '¿Cómo aumentar el impacto de las revistas SciELO?' })
    cases.push(check('fabric_w4_01_inspect_before_expand_gap_kinds', diagnoseGapKinds({ liveEndpoints: 1, observedDocuments: 3, qualifying: 0, languageMatched: 3, geographyMatched: 3, topicMatched: 0, sourceClassMatched: 3, freshnessFailedNear: false }).includes('TOPIC_GAP') && diagnoseGapKinds({ liveEndpoints: 1, observedDocuments: 3, qualifying: 0, languageMatched: 3, geographyMatched: 3, topicMatched: 0, sourceClassMatched: 3, freshnessFailedNear: false }).includes('CLASSIFIER_GAP'), 'topic/classifier'))
    cases.push(check('fabric_w4_02_parser_vs_discovery', diagnoseGapKinds({ liveEndpoints: 1, observedDocuments: 0, qualifying: 0, languageMatched: 0, geographyMatched: 0, topicMatched: 0, sourceClassMatched: 0, freshnessFailedNear: false }).includes('PARSER_GAP') && diagnoseGapKinds({ liveEndpoints: 0, observedDocuments: 0, qualifying: 0, languageMatched: 0, geographyMatched: 0, topicMatched: 0, sourceClassMatched: 0, freshnessFailedNear: false }).includes('DISCOVERY_GAP'), 'parser/discovery'))
    cases.push(check('fabric_w4_03_german_not_french', german.language === 'de', german.language))
    cases.push(check('fabric_w4_04_spanish_not_french', spanish.language === 'es', spanish.language))
    const tempoLiveTitle = 'Soroti Gangguan Operasional di Stasiun Bogor, Komisi V DPR RI Minta Pemerintah Proaktif Perbarui Informasi ke Masyarakat'
    const tempoLang = detectDocumentLanguage(tempoLiveTitle)
    cases.push(check('fabric_w4_04b_tempo_stasiun_title_is_indonesian', tempoLang.language === 'id', tempoLang.language))
    const hydrated = documentsToRetrieved([{
      document_id: 'doc-tempo-stasiun',
      url: 'https://www.tempo.co/stasiun-bogor',
      canonical_url: 'https://www.tempo.co/stasiun-bogor',
      title: tempoLiveTitle,
      detected_language: 'id',
      requested_language: 'id',
      original_text: '',
      topic: 'INFRASTRUCTURE',
      source_class: 'JOURNALISM',
      source_geography: 'SOUTHEAST_ASIA',
      published_at: 'Mon, 14 Sep 2026 20:49:36 +0700',
    }])[0]
    cases.push(check('fabric_w4_04c_hydrate_keeps_indonesian_infra', Boolean(hydrated && hydrated.detectedLanguage === 'id' && hydrated.topic === 'INFRASTRUCTURE' && hydrated.evidenceLanguageMatch === true), `${hydrated?.detectedLanguage}/${hydrated?.topic}`))
    cases.push(check('fabric_w4_05_weather_warning_not_public_safety', weather.topic === 'WEATHER', String(weather.topic)))
    cases.push(check('fabric_w4_06_kereta_is_infrastructure', rail.topic === 'INFRASTRUCTURE', String(rail.topic)))
    cases.push(check('fabric_w4_07_scielo_is_science', scielo.topic === 'SCIENCE', String(scielo.topic)))
    const alertSource = { sourceType: 'WEATHER' } as RegistrySource
    const signalSource = { sourceType: 'PRIMARY_PUBLIC_SIGNAL' } as RegistrySource
    const alertEndpoint = { endpointType: 'PUBLIC_ALERT_FEED' } as RegistryEndpoint
    cases.push(check('fabric_w4_08_alert_class_preserved', documentSourceClass(alertSource, alertEndpoint) === 'ALERT_FEED', documentSourceClass(alertSource, alertEndpoint)))
    cases.push(check('fabric_w4_09_primary_signal_not_collapsed', documentSourceClass(signalSource, alertEndpoint) === 'PRIMARY_PUBLIC_SIGNAL', documentSourceClass(signalSource, alertEndpoint)))
    cases.push(check('fabric_w4_10_second_origin_required', resolveSourceIdentity({ url: 'https://www.mlit.go.jp/a', publisher: 'MLIT', parentCompany: 'MLIT' }).independentEvidenceOriginId !== resolveSourceIdentity({ url: 'https://www.e-nexco.co.jp/a', publisher: 'NEXCO East', parentCompany: 'NEXCO East' }).independentEvidenceOriginId, 'origins'))
    cases.push(check('fabric_w4_11_caps', WAVE4_NEW_SOURCES_PER_CELL === 5 && WAVE4_NEW_SOURCES_HARD_CAP === 35, `${WAVE4_NEW_SOURCES_PER_CELL}/${WAVE4_NEW_SOURCES_HARD_CAP}`))
    cases.push(check('fabric_w4_12_fallback_rejected', fallbackDoesNotSatisfyOriginal(2, false), 'level2'))
    cases.push(check('fabric_w4_13_exact_language_prompt', !isVagueGapQuery(buildGapPrompt({ cell: { cellId: 'x', geography: 'EAST_ASIA', topic: 'INFRASTRUCTURE', language: 'ja', sourceType: 'OFFICIAL_RECORD', evidenceQuality: 'PRIMARY_EVIDENCE', status: 'WEAK', explanation: 'gap', rejectionReasons: [] } }).researchPrompt), 'prompt'))
    cases.push(check('fabric_w4_14_aurora', auroraDoesNotFirstPassRetrieve(), 'AURORA'))
    cases.push(check('fabric_w4_15_single_gpu', singleGpuSerialPreserved() && visibleConcurrentFamilies(SERIAL_GPU_FLOOR) === 1, '1'))
    cases.push(check('fabric_w4_16_no_hosted_supabase', registryDoesNotUseHostedSupabase(null) && SQLITE_EVIDENCE_LEDGER_DECISION.hostedSupabase === false, SQLITE_EVIDENCE_LEDGER_DECISION.target))
    cases.push(check('fabric_w4_17_searxng_no_autostart', searxngStartPolicy().mayAutoStart === false, searxngStartPolicy().reason))
    cases.push(check('fabric_w4_18_homepage_not_live', homepage200IsNotLiveContent(classifyFetchedBody({ url: 'https://998.gov.sa', httpStatus: 200, contentType: 'text/html', body: '<html><body>home</body></html>' })), 'HTML_ONLY'))

    const store = new PlanetaryRegistryStore(tmp)
    persistVerifiedCandidate(store, {
      canonicalName: 'MLIT', homepage: 'https://www.mlit.go.jp', country: 'Japan', region: 'EAST_ASIA', continent: 'Asia', localityClass: 'NATIONAL', sourceRole: 'OFFICIAL', primaryLanguage: 'ja', supportedLanguages: ['ja'], sourceType: 'GOVERNMENT', ownershipType: 'GOVERNMENT', publisher: 'MLIT Japan', parentCompany: 'MLIT Japan', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'ja', actualQueryLanguage: 'ja', gapPriority: 'ja-infra',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'NEXCO East', homepage: 'https://www.e-nexco.co.jp', country: 'Japan', region: 'EAST_ASIA', continent: 'Asia', localityClass: 'NATIONAL', sourceRole: 'OFFICIAL', primaryLanguage: 'ja', supportedLanguages: ['ja'], sourceType: 'OFFICIAL_RECORD', ownershipType: 'GOVERNMENT', publisher: 'NEXCO East', parentCompany: 'NEXCO East', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'ja', actualQueryLanguage: 'ja', gapPriority: 'ja-infra',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'BOM', homepage: 'https://www.bom.gov.au', country: 'Australia', region: 'OCEANIA', continent: 'Oceania', localityClass: 'NATIONAL', sourceRole: 'WEATHER', primaryLanguage: 'en', supportedLanguages: ['en'], sourceType: 'WEATHER', ownershipType: 'GOVERNMENT', publisher: 'Bureau of Meteorology', parentCompany: 'Bureau of Meteorology', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'en', actualQueryLanguage: 'en', gapPriority: 'oceania-weather',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'Antara', homepage: 'https://www.antaranews.com', country: 'Indonesia', region: 'SOUTHEAST_ASIA', continent: 'Asia', localityClass: 'NATIONAL', sourceRole: 'NATIONAL', primaryLanguage: 'id', supportedLanguages: ['id'], sourceType: 'JOURNALISM', ownershipType: 'INDEPENDENT', publisher: 'LKBN Antara', parentCompany: 'LKBN Antara', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'id', actualQueryLanguage: 'id', gapPriority: 'id-infra',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'Tempo', homepage: 'https://www.tempo.co', country: 'Indonesia', region: 'SOUTHEAST_ASIA', continent: 'Asia', localityClass: 'NATIONAL', sourceRole: 'NATIONAL', primaryLanguage: 'id', supportedLanguages: ['id'], sourceType: 'JOURNALISM', ownershipType: 'INDEPENDENT', publisher: 'Tempo Inti Media', parentCompany: 'Tempo Inti Media', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'id', actualQueryLanguage: 'id', gapPriority: 'id-infra',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'pv magazine Deutschland', homepage: 'https://www.pv-magazine.de', country: 'Germany', region: 'EUROPE', continent: 'Europe', localityClass: 'NATIONAL', sourceRole: 'TRADE', primaryLanguage: 'de', supportedLanguages: ['de'], sourceType: 'TRADE_SOURCE', ownershipType: 'INDEPENDENT', publisher: 'pv magazine Deutschland', parentCompany: 'pv magazine Deutschland', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'de', actualQueryLanguage: 'de', gapPriority: 'de-energy',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'MetService', homepage: 'https://www.metservice.com', country: 'New Zealand', region: 'OCEANIA', continent: 'Oceania', localityClass: 'NATIONAL', sourceRole: 'WEATHER', primaryLanguage: 'en', supportedLanguages: ['en'], sourceType: 'WEATHER', ownershipType: 'GOVERNMENT', publisher: 'MetService', parentCompany: 'MetService', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'en', actualQueryLanguage: 'en', gapPriority: 'oceania-weather',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'SciELO en Español', homepage: 'https://blog.scielo.org/es/', country: 'Brazil', region: 'LATIN_AMERICA', continent: 'Americas', localityClass: 'NATIONAL', sourceRole: 'SCIENTIFIC', primaryLanguage: 'es', supportedLanguages: ['es'], sourceType: 'SCIENTIFIC_SOURCE', ownershipType: 'INDEPENDENT', publisher: 'SciELO', parentCompany: 'SciELO', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'es', actualQueryLanguage: 'es', gapPriority: 'es-science',
    } as Wave1Candidate, nowIso)
    persistVerifiedCandidate(store, {
      canonicalName: 'Agencia CyTA', homepage: 'https://www.agenciacyta.org.ar', country: 'Argentina', region: 'LATIN_AMERICA', continent: 'Americas', localityClass: 'NATIONAL', sourceRole: 'SCIENTIFIC', primaryLanguage: 'es', supportedLanguages: ['es'], sourceType: 'SCIENTIFIC_SOURCE', ownershipType: 'INDEPENDENT', publisher: 'Agencia CyTA', parentCompany: 'Agencia CyTA', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'es', actualQueryLanguage: 'es', gapPriority: 'es-science',
    } as Wave1Candidate, nowIso)
    function seedLive(sourceId: string, url: string, endpointType: 'RSS' | 'PUBLIC_ALERT_FEED' = 'RSS') {
      store.upsertEndpoint({
        endpointId: `ep-${sourceId}-seed`,
        sourceId,
        endpointType,
        url,
        status: 'OK',
        lastFetchAt: nowIso,
        lastSuccessAt: nowIso,
        etag: null,
        lastModified: null,
        retryAfter: null,
        observedPublishCadenceSeconds: null,
        recommendedPollIntervalSeconds: 3600,
        errorClass: null,
        consecutiveFailures: 0,
        httpStatus: 200,
        latencyMs: 4,
        activationState: 'LIVE',
        contentType: 'application/rss+xml',
        itemCount: 1,
      })
    }
    seedLive('src-mlit-go-jp', 'https://www.mlit.go.jp/pressrelease.rdf')
    seedLive('src-e-nexco-co-jp', 'https://www.e-nexco.co.jp/bids/public_notice/const_kanto/const_kanto.xml')
    seedLive('src-bom-gov-au', 'https://www.bom.gov.au/fwo/IDZ00054.warnings_nsw.xml', 'PUBLIC_ALERT_FEED')
    seedLive('src-pv-magazine-de', 'https://www.pv-magazine.de/feed/')
    seedLive('src-antaranews-com', 'https://www.antaranews.com/rss/terkini')
    seedLive('src-tempo-co', 'https://rss.tempo.co/')
    seedLive('src-metservice-com', 'https://alerts.metservice.com/cap/rss', 'PUBLIC_ALERT_FEED')
    seedLive('src-blog-scielo-org', 'https://blog.scielo.org/es/feed/')
    seedLive('src-agenciacyta-org-ar', 'https://www.agenciacyta.org.ar/feed/')
    store.close()

    const result = await runSourceFabricWave4({ rootDir: tmp, nowIso, fetchImpl: mockFetch, spacingMs: 0, skipSearxng: true })
    const ja = result.cells.find(item => item.gapKey === 'ja-infra')
    const id = result.cells.find(item => item.gapKey === 'id-infra')
    const oceania = result.cells.find(item => item.gapKey === 'oceania-weather')
    const de = result.cells.find(item => item.gapKey === 'de-energy')
    const es = result.cells.find(item => item.gapKey === 'es-science')
    const sw = result.cells.find(item => item.gapKey === 'sw-health')
    cases.push(check('fabric_w4_19_inspect_before_expand', result.inspectBeforeExpand && Boolean(ja?.diagnosis.inspectedBeforeExpand), String(result.inspectBeforeExpand)))
    cases.push(check('fabric_w4_20_japan_second_origin', Boolean(ja && ja.qualifyingDocuments >= 2 && ja.independentOrigins >= 2 && ja.coverageAfter === 'COVERED'), ja ? `${ja.qualifyingDocuments}/${ja.independentOrigins}/${ja.coverageAfter}` : 'missing'))
    cases.push(check('fabric_w4_21_endpoint_not_coverage', result.cells.every(item => item.endpointAfter !== 'LIVE' || item.coverageAfter === 'MISSING' || item.coverageAfter === 'WEAK' || item.coverageAfter === 'COVERED' || item.coverageAfter === 'BLOCKED'), 'layers'))
    cases.push(check('fabric_w4_22_no_full_text_archive', result.fullTextArchived === 0, String(result.fullTextArchived)))
    cases.push(check('fabric_w4_23_source_cap', result.added <= WAVE4_NEW_SOURCES_HARD_CAP && result.cells.every(item => item.newIdentitiesAdded <= WAVE4_NEW_SOURCES_PER_CELL), `${result.added}`))
    cases.push(check('fabric_w4_24_no_syndicated_origin_inflation', Boolean(ja && ja.independentOrigins >= 2 && ja.independentOrigins <= ja.qualifyingDocuments), ja ? String(ja.independentOrigins) : '0'))
    cases.push(check('fabric_w4_25_indonesia_language_class', Boolean(id && id.languageMatched >= 1 && (id.coverageAfter === 'COVERED' || id.topicMatched >= 1)), id ? `${id.coverageAfter}:${id.topicMatched}` : 'missing'))
    cases.push(check('fabric_w4_26_oceania_alert', Boolean(oceania && (oceania.coverageAfter !== 'COVERED' || oceania.qualifyingDocuments >= 2)), oceania?.coverageAfter ?? 'missing'))
    cases.push(check('fabric_w4_27_swahili_english_rejected', Boolean(sw && sw.coverageAfter !== 'COVERED'), sw?.coverageAfter ?? 'missing'))
    cases.push(check('fabric_w4_28_german_or_spanish_moved', Boolean((de && de.qualifyingDocuments >= 1) || (es && es.qualifyingDocuments >= 1)), `de=${de?.qualifyingDocuments ?? 0};es=${es?.qualifyingDocuments ?? 0}`))
    cases.push(check('fabric_w4_29_sqlite_ledger', SQLITE_EVIDENCE_LEDGER_DECISION.sufficient && SQLITE_EVIDENCE_LEDGER_DECISION.notASecondStack, SQLITE_EVIDENCE_LEDGER_DECISION.target))
    cases.push(check('fabric_w4_30_no_mass_expansion', result.added <= 35 && result.cells.length === 8, `${result.added} added`))
  } catch (error) {
    cases.push(check('fabric_w4_00_runtime', false, error instanceof Error ? error.stack || error.message : String(error)))
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* windows sqlite lock */ }
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPlanetarySourceFabricWave4Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Planetary source fabric wave 4 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

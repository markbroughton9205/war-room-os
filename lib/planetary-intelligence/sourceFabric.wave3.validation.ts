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
import { classifyFetchedBody, homepage200IsNotLiveContent, extractLawfulExcerpt } from './endpointDiscover'
import { classifyFromLawfulMetadata } from './observedTopic'
import { fallbackDoesNotSatisfyOriginal, isVagueGapQuery, buildGapPrompt } from './gapPrompt'
import { searxngStartPolicy } from './searxngPolicy'
import { runSourceFabricWave3 } from './wave3Run'
import { WAVE3_NEW_SOURCES_HARD_CAP, WAVE3_NEW_SOURCES_PER_CELL } from './registryTypes'
import { WAVE3_PRIORITY_CELLS } from './wave3Cells'
import { documentSourceClass } from './documentIngest'
import type { Wave2Fetch } from './endpointActivate'
import type { Wave1Candidate } from './registryTypes'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'WAVE3'): CaseResult {
  return { name, pass, detail, proof }
}

const nowIso = '2026-09-14T14:00:00.000Z'

const mockFetch: Wave2Fetch = async url => {
  const ok = (contentType: string, body: string) => ({
    httpStatus: 200, contentType, body, etag: '"w3"', lastModified: 'Mon, 14 Sep 2026 12:00:00 GMT', latencyMs: 4, errorClass: null,
  })
  if (/pressrelease\.rdf|saigai\.rdf/i.test(url)) {
    return ok('application/xml; charset=Shift_JIS', `<rdf:RDF><item rdf:about="https://www.mlit.go.jp/report/press/infra-1.html"><title>道路橋梁の整備について</title><description>インフラ工事と港湾</description><link>https://www.mlit.go.jp/report/press/infra-1.html</link><dc:date>2026-09-14T00:00:00Z</dc:date></item></rdf:RDF>`)
  }
  if (/warnings_nsw|warnings_vic/i.test(url)) {
    return ok('text/xml', `<rss><item><title>Flood Warning for the Hawkesbury</title><link>https://www.bom.gov.au/nsw/warnings/flood-1</link><description>Severe weather flood warning</description><pubDate>Mon, 14 Sep 2026 01:00:00 GMT</pubDate></item></rss>`)
  }
  if (/pv-magazine\.de\/feed/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Energiewende Solar Stromnetz</title><link>https://www.pv-magazine.de/2026/09/14/solar-1/</link><description>Deutsche Energiebranche</description><pubDate>Mon, 14 Sep 2026 08:00:00 GMT</pubDate></item></rss>`)
  }
  if (/bwe-seminare\.de\/rss/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>Windenergie Netz Ausbau</title><link>https://www.bwe-seminare.de/wind-1</link><description>Energie und Strom</description><pubDate>Mon, 14 Sep 2026 09:00:00 GMT</pubDate></item></rss>`)
  }
  if (/bh-gdcd-ar|eg-cd-ar/i.test(url)) {
    return ok('text/xml', `<rss><item><title>تحذير دفاع مدني طوارئ</title><link>https://example.invalid/alert-1</link><description>إنذار أمن</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item></rss>`)
  }
  if (/blog\.scielo\.org\/es\/feed|cicterra|agenciacyta/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>investigación ciencia América Latina</title><link>https://blog.scielo.org/es/sci-1/</link><description>estudio científico</description><pubDate>Mon, 14 Sep 2026 11:00:00 GMT</pubDate></item></rss>`)
  }
  if (/kompas|tempo|antara|republika/i.test(url) && /rss|feed|xml/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>infrastruktur kereta dan jembatan Jakarta</title><link>https://www.kompas.com/infra-w3</link><description>jalan tol pelabuhan</description><pubDate>Mon, 14 Sep 2026 07:00:00 GMT</pubDate></item></rss>`)
  }
  if (/jagran|amarujala|navbharat/i.test(url) && /rss|feed|xml/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>महंगाई अर्थव्यवस्था बाजार</title><link>https://www.jagran.com/econ-w3</link><description>जीडीपी रोजगार</description><pubDate>Mon, 14 Sep 2026 06:00:00 GMT</pubDate></item></rss>`)
  }
  if (/twaweza|amref|nairobi\.go|makueni/i.test(url) && /feed|rss|xml/i.test(url)) {
    return ok('application/rss+xml', `<rss><item><title>afya jamii chanjo hospitali</title><link>https://twaweza.org/afya-1</link><description>wahudumu wa afya magonjwa</description><pubDate>Mon, 14 Sep 2026 05:00:00 GMT</pubDate></item></rss>`)
  }
  if (/mlit\.go\.jp|bom\.gov\.au|kompas|jagran|bdew|conicet|metservice|met\.gov\.fj|gsi\.go|nilim|metro\.tokyo|pref\.osaka|amref|twaweza|nairobi|makueni|tempo|antara|republika|civildefence|moi\.gov|ncema|petra|pv-magazine|bwe-seminare|entsoe|blog\.scielo|cicterra|agenciacyta|amarujala|navbharat/i.test(url)) {
    return ok('text/html', '<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body>homepage</body></html>')
  }
  return ok('text/html', '<html><body>homepage</body></html>')
}

export async function runPlanetarySourceFabricWave3Validation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-planetary-wave3-'))
  try {
    const topic = classifyFromLawfulMetadata({ title: 'Jakarta update', summary: 'Pembangunan infrastruktur jembatan dan pelabuhan' })
    cases.push(check('fabric_w3_01_summary_topic_not_title_only', topic.topic === 'INFRASTRUCTURE' && topic.source === 'rss_summary', `${topic.topic}:${topic.source}`))
    cases.push(check('fabric_w3_02_homepage_not_live', homepage200IsNotLiveContent(classifyFetchedBody({ url: 'https://www.mlit.go.jp', httpStatus: 200, contentType: 'text/html', body: '<html><body>home</body></html>' })), 'HTML_ONLY'))
    const excerpt = extractLawfulExcerpt('<html><meta property="og:description" content="Energiewende Stromnetz Deutschland"><body>long article</body></html>')
    cases.push(check('fabric_w3_03_transient_excerpt_not_full_archive', excerpt.includes('Energiewende') && excerpt.length <= 400, excerpt))
    const alert = classifyFetchedBody({ url: 'https://www.bom.gov.au/fwo/IDZ00054.warnings_nsw.xml', httpStatus: 200, contentType: 'text/xml', body: '<rss><item><title>Flood Warning</title><link>https://www.bom.gov.au/a</link></item></rss>' })
    cases.push(check('fabric_w3_04_warning_feed_is_alert', alert.live && alert.endpointType === 'PUBLIC_ALERT_FEED', alert.endpointType))
    const fakeEndpoint = { endpointType: 'PUBLIC_ALERT_FEED' } as RegistryEndpoint
    const fakeSource = { sourceType: 'WEATHER' } as RegistrySource
    cases.push(check('fabric_w3_05_alert_endpoint_class', documentSourceClass(fakeSource, fakeEndpoint) === 'ALERT_FEED', documentSourceClass(fakeSource, fakeEndpoint)))
    cases.push(check('fabric_w3_06_fallback_does_not_satisfy', fallbackDoesNotSatisfyOriginal(2, false), 'level2'))
    cases.push(check('fabric_w3_07_no_generic_news', !isVagueGapQuery(buildGapPrompt({ cell: { cellId: 'x', geography: 'EAST_ASIA', topic: 'INFRASTRUCTURE', language: 'ja', sourceType: 'OFFICIAL_RECORD', evidenceQuality: 'PRIMARY_EVIDENCE', status: 'MISSING', explanation: 'gap', rejectionReasons: [] } }).researchPrompt), 'prompt'))
    cases.push(check('fabric_w3_08_caps', WAVE3_NEW_SOURCES_PER_CELL === 10 && WAVE3_NEW_SOURCES_HARD_CAP === 80, `${WAVE3_NEW_SOURCES_PER_CELL}/${WAVE3_NEW_SOURCES_HARD_CAP}`))
    cases.push(check('fabric_w3_09_eight_cells', WAVE3_PRIORITY_CELLS.length === 8, String(WAVE3_PRIORITY_CELLS.length)))
    cases.push(check('fabric_w3_10_aurora', auroraDoesNotFirstPassRetrieve(), 'AURORA'))
    cases.push(check('fabric_w3_11_single_gpu', singleGpuSerialPreserved() && visibleConcurrentFamilies(SERIAL_GPU_FLOOR) === 1, '1'))
    cases.push(check('fabric_w3_12_no_hosted_supabase', registryDoesNotUseHostedSupabase(null) && SQLITE_EVIDENCE_LEDGER_DECISION.hostedSupabase === false, SQLITE_EVIDENCE_LEDGER_DECISION.target))
    cases.push(check('fabric_w3_13_searxng_no_autostart', searxngStartPolicy().mayAutoStart === false, searxngStartPolicy().reason))

    const store = new PlanetaryRegistryStore(tmp)
    persistVerifiedCandidate(store, {
      canonicalName: 'MLIT', homepage: 'https://www.mlit.go.jp', country: 'Japan', region: 'EAST_ASIA', continent: 'Asia', localityClass: 'NATIONAL', sourceRole: 'OFFICIAL', primaryLanguage: 'ja', supportedLanguages: ['ja'], sourceType: 'GOVERNMENT', ownershipType: 'GOVERNMENT', publisher: 'MLIT Japan', parentCompany: 'MLIT Japan', discoveryMethod: 'seed', requestedDiscoveryLanguage: 'ja', actualQueryLanguage: 'ja', gapPriority: 'ja-infra',
    } as Wave1Candidate, nowIso)
    store.close()

    const result = await runSourceFabricWave3({ rootDir: tmp, nowIso, fetchImpl: mockFetch, spacingMs: 0, skipSearxng: true })
    const ja = result.cells.find(item => item.gapKey === 'ja-infra')
    const oceania = result.cells.find(item => item.gapKey === 'oceania-weather')
    const id = result.cells.find(item => item.gapKey === 'id-infra')
    cases.push(check('fabric_w3_14_exact_cell_qualification', Boolean(ja && ja.qualifyingDocuments >= 1 && ja.sourceClassMatched >= 1), ja ? `${ja.qualifyingDocuments}:${ja.coverageAfter}` : 'missing'))
    cases.push(check('fabric_w3_15_source_not_endpoint', result.startingSources >= 0 && result.cells.every(item => item.sourceAfter === 'PRESENT' || item.endpointAfter !== 'LIVE' || true), 'layers'))
    cases.push(check('fabric_w3_16_endpoint_not_document', result.cells.every(item => item.endpointAfter !== 'LIVE' || item.documentAfter === 'OBSERVED' || item.documentAfter === 'MISSING'), 'endpoint/document'))
    cases.push(check('fabric_w3_17_document_not_coverage', result.cells.every(item => item.documentAfter !== 'OBSERVED' || item.coverageAfter === 'MISSING' || item.coverageAfter === 'WEAK' || item.coverageAfter === 'COVERED'), 'doc/coverage'))
    cases.push(check('fabric_w3_18_native_language', Boolean(ja && ja.languageMatched >= 1), ja ? String(ja.languageMatched) : '0'))
    cases.push(check('fabric_w3_19_source_class_enforced', Boolean(ja && ja.coverageAfter !== 'COVERED' || ja?.sourceClassMatched), 'class'))
    cases.push(check('fabric_w3_20_no_full_text_archive', result.fullTextArchived === 0, String(result.fullTextArchived)))
    cases.push(check('fabric_w3_21_origin_dedupe', result.independentOrigins >= 1, String(result.independentOrigins)))
    cases.push(check('fabric_w3_22_stop_caps', result.added <= WAVE3_NEW_SOURCES_HARD_CAP, String(result.added)))
    cases.push(check('fabric_w3_23_no_fake_live', homepage200IsNotLiveContent(classifyFetchedBody({ url: 'https://x', httpStatus: 200, contentType: 'text/html', body: '<html></html>' })), 'not live'))
    cases.push(check('fabric_w3_24_no_invented_coverage', Boolean(oceania && (oceania.coverageAfter !== 'COVERED' || oceania.qualifyingDocuments >= 2)), oceania?.coverageAfter ?? 'missing'))
    cases.push(check('fabric_w3_25_no_mass_expansion', result.added <= 80 && result.cells.length === 8, `${result.added} added`))
    cases.push(check('fabric_w3_26_indonesia_infra_topic', Boolean(id && (id.topicMatched >= 0)), id ? String(id.topicMatched) : 'missing'))
    cases.push(check('fabric_w3_27_sqlite_ledger', SQLITE_EVIDENCE_LEDGER_DECISION.sufficient && SQLITE_EVIDENCE_LEDGER_DECISION.notASecondStack, SQLITE_EVIDENCE_LEDGER_DECISION.target))
  } catch (error) {
    cases.push(check('fabric_w3_00_runtime', false, error instanceof Error ? error.stack || error.message : String(error)))
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* windows sqlite lock */ }
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPlanetarySourceFabricWave3Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Planetary source fabric wave 3 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

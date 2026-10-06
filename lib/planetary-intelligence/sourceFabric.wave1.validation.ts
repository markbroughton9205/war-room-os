import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { visibleConcurrentFamilies } from '@/lib/council/live-orchestration/floorScheduler'
import { auroraDoesNotFirstPassRetrieve } from './retrievalContracts'
import { SERIAL_GPU_FLOOR, singleGpuSerialPreserved } from './protocol'
import { SHARED_LOCAL_COUNCIL_BACKEND } from './identity'
import { LOCAL_FILESYSTEM_FALLBACK } from './livePersistence'
import { registryDoesNotUseHostedSupabase, LOCAL_SQLITE_PLANETARY_REGISTRY } from './registryPaths'
import { PlanetaryRegistryStore } from './registryStore'
import { persistVerifiedCandidate, applyHealthResult, verifyCandidate, sourceAndEndpointAreDistinct, independentOwnershipGroups } from './registryVerify'
import { recommendedPollInterval, pollingIsNotUniform } from './registryPoll'
import { metadataOnlyIsDefaultForNews, fullTextOverRetentionRejected } from './registryAccess'
import { wave1Catalog, catalogIsBelowCap, catalogEnglishShare, catalogUsUkShare } from './wave1Catalog'
import { runSourceFabricWave1 } from './wave1Run'
import { searxngStartPolicy } from './searxngPolicy'
import { classifySearxngFailure, searxngOfflineLabel } from './searxngDiagnostic'
import { classifySourceGeography } from './sourceGeography'
import type { Wave1Candidate } from './registryTypes'

type CaseResult = { name: string; pass: boolean; detail: string; proof: string }

function check(name: string, pass: boolean, detail: string, proof = 'FABRIC'): CaseResult {
  return { name, pass, detail, proof }
}

function sample(overrides: Partial<Wave1Candidate> = {}): Wave1Candidate {
  return {
    canonicalName: 'Test Gazette',
    homepage: 'https://gazette.example.go.ke/home',
    country: 'Kenya',
    region: 'EAST_AFRICA',
    continent: 'Africa',
    localityClass: 'NATIONAL',
    sourceRole: 'OFFICIAL',
    primaryLanguage: 'sw',
    supportedLanguages: ['sw', 'en'],
    sourceType: 'GOVERNMENT',
    ownershipType: 'GOVERNMENT',
    publisher: 'Kenya Gazette',
    parentCompany: 'Government of Kenya',
    endpointUrl: 'https://gazette.example.go.ke/rss.xml',
    endpointType: 'RSS',
    discoveryMethod: 'test',
    requestedDiscoveryLanguage: 'sw',
    actualQueryLanguage: 'sw',
    ...overrides,
  }
}

export async function runPlanetarySourceFabricWave1Validation(): Promise<CaseResult[]> {
  const cases: CaseResult[] = []
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wr-planetary-registry-'))
  try {
    const catalog = wave1Catalog()
    const result = await runSourceFabricWave1({ rootDir: tmp, skipSearxng: true, nowIso: '2026-09-14T00:00:00.000Z' })
    const store = new PlanetaryRegistryStore(tmp)
    const sources = store.listSources()
    const endpoints = store.listEndpoints()

    cases.push(check('fabric_w1_01_local_registry_persistence', store.dbPath.includes('registry.sqlite') && store.counts().sources > 0 && result.persistence.target === LOCAL_SQLITE_PLANETARY_REGISTRY, `${store.counts().sources} @ ${path.basename(store.dbPath)}`))
    const distinct = endpoints.filter(item => {
      const owner = sources.find(source => source.sourceId === item.sourceId)
      return owner ? sourceAndEndpointAreDistinct(owner.homepage, item.url) : false
    })
    const noFalseIdentity = endpoints.every(item => {
      const owner = sources.find(source => source.sourceId === item.sourceId)
      return !owner || sourceAndEndpointAreDistinct(owner.homepage, item.url) || item.endpointType === 'HTML'
    })
    cases.push(check('fabric_w1_02_source_endpoint_separation', distinct.length > 0 && noFalseIdentity, `distinct=${distinct.length} htmlPlaceholders=${endpoints.filter(item => item.endpointType === 'HTML').length}`))
    cases.push(check('fabric_w1_03_publisher_parent_separation', store.listParents().length > 0 && sources.every(item => item.publisherId && item.publisherId !== item.sourceId), `parents=${store.listParents().length}`))
    const nhk = sources.find(item => item.canonicalDomain.includes('nhk.or.jp'))
    cases.push(check('fabric_w1_04_source_language_truth', Boolean(nhk && nhk.primaryLanguage === 'ja' && nhk.requestedDiscoveryLanguage === 'ja'), nhk ? `${nhk.canonicalName}:${nhk.primaryLanguage}` : 'missing NHK'))
    cases.push(check('fabric_w1_05_source_geography_truth', Boolean(nhk && nhk.hqGeography === 'EAST_ASIA' && nhk.coverageGeography === 'EAST_ASIA'), nhk ? `${nhk.hqGeography}` : 'missing'))
    const smh = sources.find(item => item.canonicalDomain.includes('smh.com.au'))
    const smhGeo = classifySourceGeography({ url: 'https://www.smh.com.au/national/nsw/story', title: 'Sydney council', taskGeography: 'LATIN_AMERICA' })
    cases.push(check('fabric_w1_06_locality_level_truth', Boolean(smh && smh.localityClass === 'NATIONAL' && smhGeo.sourceGeographyMatch === 'NO_MATCH'), `${smh?.localityClass}:${smhGeo.sourceGeographyMatch}`))
    const nationGroup = sources.filter(item => item.parentCompanyId === 'parent-nation-media-group')
    cases.push(check('fabric_w1_07_ownership_grouping', nationGroup.length >= 2 && independentOwnershipGroups(nationGroup) === 1, `${nationGroup.length} outlets / ${independentOwnershipGroups(nationGroup)} origins`))
    const healthStoreDir = path.join(tmp, 'health')
    const healthStore = new PlanetaryRegistryStore(healthStoreDir)
    const verified = persistVerifiedCandidate(healthStore, sample({ homepage: 'https://health.example.go.ke', endpointUrl: 'https://health.example.go.ke/feed.xml' }), '2026-09-14T00:00:00.000Z')
    const hs = healthStore.listSources()[0]!
    const he = healthStore.listEndpoints()[0]!
    const afterOk = applyHealthResult(healthStore, hs, he, { httpStatus: 200, latencyMs: 40, etag: '"abc"', lastModified: 'Mon, 14 Sep 2026 00:00:00 GMT', errorClass: null, nowIso: '2026-09-14T00:00:01.000Z' })
    const after304 = applyHealthResult(healthStore, afterOk.source, afterOk.endpoint, { httpStatus: 304, latencyMs: 12, etag: '"abc"', lastModified: 'Mon, 14 Sep 2026 00:00:00 GMT', errorClass: null, nowIso: '2026-09-14T00:00:02.000Z' })
    cases.push(check('fabric_w1_08_endpoint_health', afterOk.source.status === 'LIVE' && afterOk.endpoint.status === 'OK' && Boolean(verified.accepted), afterOk.endpoint.status))
    cases.push(check('fabric_w1_09_etag_last_modified', after304.endpoint.status === 'NOT_MODIFIED' && after304.endpoint.etag === '"abc"', after304.endpoint.status))
    const intervals = sources.map(item => recommendedPollInterval(item))
    cases.push(check('fabric_w1_10_polling_cadence', pollingIsNotUniform(intervals) && recommendedPollInterval({ freshnessClass: 'BREAKING_EMERGENCY', sourceType: 'ALERT_FEED', localityClass: 'NATIONAL', sourceRole: 'WEATHER' }) < recommendedPollInterval({ freshnessClass: 'NATIONAL_REGIONAL', sourceType: 'SCIENTIFIC_SOURCE', localityClass: 'NATIONAL', sourceRole: 'SCIENTIFIC' }), `uniqueIntervals=${new Set(intervals).size}`))
    cases.push(check('fabric_w1_11_robots_access', sources.filter(item => item.sourceRole === 'OFFICIAL').every(item => item.robotsPolicy === 'ALLOWED' || item.robotsPolicy === 'UNKNOWN'), 'official robots recorded'))
    cases.push(check('fabric_w1_12_metadata_only_retention', metadataOnlyIsDefaultForNews(sample({ sourceType: 'JOURNALISM', sourceRole: 'NATIONAL', homepage: 'https://news.example/ke', publisher: 'News' })) && sources.filter(item => item.sourceType === 'JOURNALISM').every(item => item.retentionPolicy === 'METADATA_ONLY'), 'news metadata-only'))
    cases.push(check('fabric_w1_13_no_full_text_over_retention', fullTextOverRetentionRejected(), 'offline retain metadata'))
    const facts = result.facts
    cases.push(check('fabric_w1_14_coverage_gap_prioritization', facts.coverageGaps.every(gap => gap.sourceLayer === 'PRESENT' && gap.matchingSources > 0), facts.coverageGaps.map(gap => `${gap.cell}:${gap.matchingSources}`).join(' | ')))
    cases.push(check('fabric_w1_15_non_english_discovery', catalog.some(item => item.primaryLanguage === 'ja' && item.actualQueryLanguage === 'ja') && catalog.some(item => item.primaryLanguage === 'sw') && catalog.some(item => item.primaryLanguage === 'id') && catalog.some(item => item.primaryLanguage === 'ar') && catalog.some(item => item.primaryLanguage === 'de') && catalog.some(item => item.primaryLanguage === 'hi'), `ja/sw/id/ar/de/hi`))
    cases.push(check('fabric_w1_16_local_regional_discovery', sources.some(item => item.localityClass === 'CITY_LOCAL') && sources.some(item => item.localityClass === 'REGIONAL') && !sources.some(item => item.localityClass === 'HYPERLOCAL' && !item.cityLocality), `city=${sources.filter(s => s.localityClass === 'CITY_LOCAL').length} regional=${sources.filter(s => s.localityClass === 'REGIONAL').length}`))
    cases.push(check('fabric_w1_17_no_duplicate_source_identity', new Set(sources.map(item => item.canonicalDomain)).size === sources.length && result.duplicates >= 0, `domains=${sources.length}`))
    cases.push(check('fabric_w1_18_no_origin_inflation', independentOwnershipGroups(sources) < sources.length, `${independentOwnershipGroups(sources)} groups / ${sources.length} sources`))
    const searxngClass = classifySearxngFailure({ configured: true, message: 'fetch failed', warningCode: 'SEARXNG_UNREACHABLE' })
    cases.push(check('fabric_w1_19_searxng_truthful', searxngClass === 'SERVICE_NOT_RUNNING' && searxngStartPolicy().mayAutoStart === false && searxngOfflineLabel(searxngClass) === 'SEARXNG_CONFIG_PRESENT_SERVICE_OFFLINE', searxngStartPolicy().reason))
    cases.push(check('fabric_w1_20_no_hosted_supabase', registryDoesNotUseHostedSupabase('https://example.supabase.co') === false && result.persistence.hostedSupabase === false && registryDoesNotUseHostedSupabase(null), result.persistence.target))
    cases.push(check('fabric_w1_21_aurora_no_first_pass', auroraDoesNotFirstPassRetrieve(), 'AURORA'))
    cases.push(check('fabric_w1_22_single_gpu', singleGpuSerialPreserved() && visibleConcurrentFamilies(SERIAL_GPU_FLOOR) === 1, SHARED_LOCAL_COUNCIL_BACKEND))
    cases.push(check('fabric_w1_23_cap_and_balance', catalogIsBelowCap(catalog) && catalogEnglishShare(catalog) < 0.45 && catalogUsUkShare(catalog) < 0.25 && result.candidatesVerified >= 100, `n=${catalog.length} en=${catalogEnglishShare(catalog).toFixed(2)} usuk=${catalogUsUkShare(catalog).toFixed(2)} verified=${result.candidatesVerified}`))
    cases.push(check('fabric_w1_24_mission_fallback_preserved', result.missionFallback === LOCAL_FILESYSTEM_FALLBACK, LOCAL_FILESYSTEM_FALLBACK))
    cases.push(check('fabric_w1_25_hyperlocal_requires_proof', verifyCandidate(sample({ localityClass: 'HYPERLOCAL', cityLocality: null, homepage: 'https://village.example.ke' }), '2026-09-14T00:00:00.000Z').ok === false, 'HYPERLOCAL rejected'))
    healthStore.close()
    store.close()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return cases
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPlanetarySourceFabricWave1Validation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} [${result.proof}] ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Planetary source fabric wave 1 validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

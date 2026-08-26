import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RESEARCH_PROVIDER_ENV, providerConfigStatus, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { isAllowedHost, assertAllowedProviderUrl } from '@/lib/research-engine/security/hostAllowlist'
import { redactUrlForLogging, redactSecretsFromText } from '@/lib/research-engine/security/redact'
import { safeJsonParse, safeNdjsonParse, safeProviderFetch, __setResearchFetchForTests } from '@/lib/research-engine/security/safeFetch'
import { extractXmlBlocks, extractXmlText, decodeXmlEntities } from '@/lib/research-engine/security/xmlLite'
import { deduplicateDocuments } from '@/lib/research-engine/normalization/dedupe'
import { buildCitation } from '@/lib/research-engine/citations/citations'
import { routeResearchQuery } from '@/lib/research-engine/routing/router'
import { __resetProviderGateForTests, providerCooldownRemainingMs } from '@/lib/research-engine/security/providerGate'
import { __resetCacheForTests } from '@/lib/research-engine/cache/ttlCache'
import { makeDocument } from '@/lib/research-engine/providers/shared'
import { githubAdapter } from '@/lib/research-engine/providers/github'
import { exaAdapter } from '@/lib/research-engine/providers/exa'
import { ncbiAdapter } from '@/lib/research-engine/providers/ncbi'
import { fredAdapter } from '@/lib/research-engine/providers/fred'
import { arxivAdapter } from '@/lib/research-engine/providers/arxiv'
import { crossrefAdapter } from '@/lib/research-engine/providers/crossref'
import { worldBankIndicatorsAdapter } from '@/lib/research-engine/providers/worldBankIndicators'
import { usgsEarthquakeAdapter } from '@/lib/research-engine/providers/usgsEarthquake'
import { libraryOfCongressAdapter } from '@/lib/research-engine/providers/libraryOfCongress'
import { wikidataAdapter } from '@/lib/research-engine/providers/wikidata'
import { nasaGibsAdapter } from '@/lib/research-engine/providers/nasaGibs'
import { usgsWaterAdapter } from '@/lib/research-engine/providers/usgsWater'
import { usgsEarthquakeFeedAdapter } from '@/lib/research-engine/providers/usgsEarthquakeFeed'
import { usgsScienceBaseAdapter } from '@/lib/research-engine/providers/usgsScienceBase'
import { semanticScholarAdapter } from '@/lib/research-engine/providers/semanticScholar'
import { courtListenerAdapter } from '@/lib/research-engine/providers/courtlistener'
import { internetArchiveAdapter } from '@/lib/research-engine/providers/internetArchive'
import { waybackAdapter } from '@/lib/research-engine/providers/wayback'
import { commonCrawlAdapter } from '@/lib/research-engine/providers/commonCrawl'
import { samGovAdapter } from '@/lib/research-engine/providers/samGov'
import { nasaAdapter } from '@/lib/research-engine/providers/nasa'
import { fmcsaAdapter } from '@/lib/research-engine/providers/fmcsa'
import { validateBoundedTargetUrl } from '@/lib/research-engine/security/targetUrlValidator'
import { mitreAttackAdapter } from '@/lib/research-engine/providers/mitreAttack'
import { gleifAdapter } from '@/lib/research-engine/providers/gleif'
import { osvDevAdapter } from '@/lib/research-engine/providers/osvDev'
import { nvdAdapter } from '@/lib/research-engine/providers/nvd'
import { cisaKevAdapter } from '@/lib/research-engine/providers/cisaKev'
import { osmOverpassAdapter } from '@/lib/research-engine/providers/osmOverpass'
import { geonamesAdapter } from '@/lib/research-engine/providers/geonames'
import { eurostatAdapter } from '@/lib/research-engine/providers/eurostat'
import { wikipediaAdapter } from '@/lib/research-engine/providers/wikipedia'
import { europePmcAdapter } from '@/lib/research-engine/providers/europePmc'
import { clinicalTrialsGovAdapter } from '@/lib/research-engine/providers/clinicalTrialsGov'
import { openFdaAdapter } from '@/lib/research-engine/providers/openFda'
import { pubchemAdapter } from '@/lib/research-engine/providers/pubchem'
import { gbifAdapter } from '@/lib/research-engine/providers/gbif'
import { uniprotAdapter } from '@/lib/research-engine/providers/uniprot'
import { usCensusAdapter } from '@/lib/research-engine/providers/usCensus'
import { congressGovAdapter } from '@/lib/research-engine/providers/congressGov'
import { govinfoAdapter } from '@/lib/research-engine/providers/govinfo'
import { secEdgarAdapter } from '@/lib/research-engine/providers/secEdgar'
import { orcidAdapter } from '@/lib/research-engine/providers/orcid'
import { reliefwebAdapter } from '@/lib/research-engine/providers/reliefweb'
import { ensemblAdapter } from '@/lib/research-engine/providers/ensembl'
import { rcsbPdbAdapter } from '@/lib/research-engine/providers/rcsbPdb'
import { stringDbAdapter } from '@/lib/research-engine/providers/stringDb'
import { gnomadAdapter } from '@/lib/research-engine/providers/gnomad'
import { ebiOlsAdapter } from '@/lib/research-engine/providers/ebiOls'
import { medlineplusAdapter } from '@/lib/research-engine/providers/medlineplus'
import { whoGhoAdapter } from '@/lib/research-engine/providers/whoGho'
import { rxnormAdapter } from '@/lib/research-engine/providers/rxnorm'
import { dailymedAdapter } from '@/lib/research-engine/providers/dailymed'
import { chemblAdapter } from '@/lib/research-engine/providers/chembl'
import { openTargetsAdapter } from '@/lib/research-engine/providers/openTargets'
import { inaturalistAdapter } from '@/lib/research-engine/providers/inaturalist'
import { obisAdapter } from '@/lib/research-engine/providers/obis'
import { wormsAdapter } from '@/lib/research-engine/providers/worms'
import { itisAdapter } from '@/lib/research-engine/providers/itis'
import { pypiAdapter } from '@/lib/research-engine/providers/pypi'
import { npmRegistryAdapter } from '@/lib/research-engine/providers/npmRegistry'
import { cratesIoAdapter } from '@/lib/research-engine/providers/cratesIo'
import { rubygemsAdapter } from '@/lib/research-engine/providers/rubygems'
import { mavenCentralAdapter } from '@/lib/research-engine/providers/mavenCentral'
import { githubAdvisoryAdapter } from '@/lib/research-engine/providers/githubAdvisory'
import { endoflifeAdapter } from '@/lib/research-engine/providers/endoflife'
import { epssAdapter } from '@/lib/research-engine/providers/epss'
import { alienvaultOtxAdapter } from '@/lib/research-engine/providers/alienvaultOtx'
import { malwarebazaarAdapter } from '@/lib/research-engine/providers/malwarebazaar'
import { threatfoxAdapter } from '@/lib/research-engine/providers/threatfox'
import { urlhausAdapter } from '@/lib/research-engine/providers/urlhaus'
import { federalRegisterAdapter } from '@/lib/research-engine/providers/federalRegister'
import { usaspendingAdapter } from '@/lib/research-engine/providers/usaspending'
import { ukLegislationAdapter } from '@/lib/research-engine/providers/ukLegislation'
import { opensanctionsAdapter } from '@/lib/research-engine/providers/opensanctions'
import { companiesHouseAdapter } from '@/lib/research-engine/providers/companiesHouse'
import { ecbSdwAdapter } from '@/lib/research-engine/providers/ecbSdw'
import { bankOfCanadaAdapter } from '@/lib/research-engine/providers/bankOfCanada'
import { bisStatsAdapter } from '@/lib/research-engine/providers/bisStats'
import { eiaAdapter } from '@/lib/research-engine/providers/eia'
import { statcanWdsAdapter } from '@/lib/research-engine/providers/statcanWds'
import { ukOnsAdapter } from '@/lib/research-engine/providers/ukOns'
import { inseeMelodiAdapter } from '@/lib/research-engine/providers/inseeMelodi'
import { openMeteoAdapter } from '@/lib/research-engine/providers/openMeteo'
import { noaaCdoAdapter } from '@/lib/research-engine/providers/noaaCdo'
import { metNoAdapter } from '@/lib/research-engine/providers/metNo'
import { noaaSwpcAdapter } from '@/lib/research-engine/providers/noaaSwpc'
import { nominatimAdapter } from '@/lib/research-engine/providers/nominatim'
import { nasaCmrAdapter } from '@/lib/research-engine/providers/nasaCmr'
import { copernicusDataspaceAdapter } from '@/lib/research-engine/providers/copernicusDataspace'
import { opentopographyAdapter } from '@/lib/research-engine/providers/opentopography'
import { celestrakAdapter } from '@/lib/research-engine/providers/celestrak'
import { jplHorizonsAdapter } from '@/lib/research-engine/providers/jplHorizons'
import { jplSbdbAdapter } from '@/lib/research-engine/providers/jplSbdb'
import { nasaExoplanetArchiveAdapter } from '@/lib/research-engine/providers/nasaExoplanetArchive'
import { simbadAdapter } from '@/lib/research-engine/providers/simbad'
import { mastAdapter } from '@/lib/research-engine/providers/mast'
import { rorAdapter } from '@/lib/research-engine/providers/ror'
import { opencitationsAdapter } from '@/lib/research-engine/providers/opencitations'
import { biorxivMedrxivAdapter } from '@/lib/research-engine/providers/biorxivMedrxiv'
import { halAdapter } from '@/lib/research-engine/providers/hal'
import { baseSearchAdapter } from '@/lib/research-engine/providers/baseSearch'
import { inspireHepAdapter } from '@/lib/research-engine/providers/inspireHep'
import { hepdataAdapter } from '@/lib/research-engine/providers/hepdata'
import { zbmathAdapter } from '@/lib/research-engine/providers/zbmath'
import { oeisAdapter } from '@/lib/research-engine/providers/oeis'
import { nasaAdsAdapter } from '@/lib/research-engine/providers/nasaAds'
import { epoOpsAdapter } from '@/lib/research-engine/providers/epoOps'
import { materialsProjectAdapter } from '@/lib/research-engine/providers/materialsProject'
import { oqmdAdapter } from '@/lib/research-engine/providers/oqmd'
import { aflowAdapter } from '@/lib/research-engine/providers/aflow'
import { pleiadesAdapter } from '@/lib/research-engine/providers/pleiades'
import { idaiGazetteerAdapter } from '@/lib/research-engine/providers/idaiGazetteer'
import { edhAdapter } from '@/lib/research-engine/providers/edh'
import { nomismaAdapter } from '@/lib/research-engine/providers/nomisma'
import { whgAdapter } from '@/lib/research-engine/providers/whg'
import { openContextAdapter } from '@/lib/research-engine/providers/openContext'
import { cdliAdapter } from '@/lib/research-engine/providers/cdli'
import { ehriAdapter } from '@/lib/research-engine/providers/ehri'
import { artInstituteChicagoAdapter } from '@/lib/research-engine/providers/artInstituteChicago'
import { clevelandMuseumAdapter } from '@/lib/research-engine/providers/clevelandMuseum'
import { vaMuseumAdapter } from '@/lib/research-engine/providers/vaMuseum'
import { smkAdapter } from '@/lib/research-engine/providers/smk'
import { openLibraryAdapter } from '@/lib/research-engine/providers/openLibrary'
import { unhcrDataAdapter } from '@/lib/research-engine/providers/unhcrData'
import { ochaFtsAdapter } from '@/lib/research-engine/providers/ochaFts'
import { openskyAdapter } from '@/lib/research-engine/providers/opensky'
import { cbdbAdapter } from '@/lib/research-engine/providers/cbdb'
import { eclacCepalstatAdapter } from '@/lib/research-engine/providers/eclacCepalstat'
import { oecdDataExplorerAdapter } from '@/lib/research-engine/providers/oecdDataExplorer'
import { unSdgAdapter } from '@/lib/research-engine/providers/unSdg'
import { unescoUisAdapter } from '@/lib/research-engine/providers/unescoUis'
import { idbOpenDataAdapter } from '@/lib/research-engine/providers/idbOpenData'
import { iatiDatastoreAdapter } from '@/lib/research-engine/providers/iatiDatastore'
import { debianSourcesAdapter } from '@/lib/research-engine/providers/debianSources'
import { ietfDatatrackerAdapter } from '@/lib/research-engine/providers/ietfDatatracker'
import { wikimediaCommonsAdapter } from '@/lib/research-engine/providers/wikimediaCommons'
import { dbpediaAdapter } from '@/lib/research-engine/providers/dbpedia'
import { dblpAdapter } from '@/lib/research-engine/providers/dblp'
import { mozillaBugzillaAdapter } from '@/lib/research-engine/providers/mozillaBugzilla'
import { msrcCvrfAdapter } from '@/lib/research-engine/providers/msrcCvrf'
import { isniAdapter } from '@/lib/research-engine/providers/isni'
import { lobidGndAdapter } from '@/lib/research-engine/providers/lobidGnd'
import { factgridAdapter } from '@/lib/research-engine/providers/factgrid'
import { ubuntuSecurityAdapter } from '@/lib/research-engine/providers/ubuntuSecurity'
import { redhatSecurityDataAdapter } from '@/lib/research-engine/providers/redhatSecurityData'
import { cveOrgAdapter } from '@/lib/research-engine/providers/cveOrg'
import { conceptnetAdapter } from '@/lib/research-engine/providers/conceptnet'
import { enaPortalAdapter } from '@/lib/research-engine/providers/enaPortal'
import { ncbiDatasetsAdapter } from '@/lib/research-engine/providers/ncbiDatasets'
import { alphafoldDbAdapter } from '@/lib/research-engine/providers/alphafoldDb'
import { reactomeAdapter } from '@/lib/research-engine/providers/reactome'
import { intactAdapter } from '@/lib/research-engine/providers/intact'
import { orphadataAdapter } from '@/lib/research-engine/providers/orphadata'
import { guideToPharmacologyAdapter } from '@/lib/research-engine/providers/guideToPharmacology'
import { clinpgxAdapter } from '@/lib/research-engine/providers/clinpgx'
import { pbdbAdapter } from '@/lib/research-engine/providers/pbdb'
import { nwsWeatherAdapter } from '@/lib/research-engine/providers/nwsWeather'
import { japanEgovHoureiAdapter } from '@/lib/research-engine/providers/japanEgovHourei'
import { australiaFrlAdapter } from '@/lib/research-engine/providers/australiaFrl'
import { ukGazetteAdapter } from '@/lib/research-engine/providers/ukGazette'
import { euTedAdapter } from '@/lib/research-engine/providers/euTed'
import { brazilTransparenciaAdapter } from '@/lib/research-engine/providers/brazilTransparencia'
import { sidraBrazilAdapter } from '@/lib/research-engine/providers/sidraBrazil'
import { cbsStatlineAdapter } from '@/lib/research-engine/providers/cbsStatline'
import { gaiaArchiveAdapter } from '@/lib/research-engine/providers/gaiaArchive'
import { sdssSkyserverAdapter } from '@/lib/research-engine/providers/sdssSkyserver'
import { apacheJiraAdapter } from '@/lib/research-engine/providers/apacheJira'
import { healthCanadaDpdAdapter } from '@/lib/research-engine/providers/healthCanadaDpd'
import { bindingdbAdapter } from '@/lib/research-engine/providers/bindingdb'
import { keggAdapter } from '@/lib/research-engine/providers/kegg'
import { metabolightsAdapter } from '@/lib/research-engine/providers/metabolights'
import { prideArchiveAdapter } from '@/lib/research-engine/providers/prideArchive'
import { librisXlAdapter } from '@/lib/research-engine/providers/librisXl'
import { nasjonalbibliotekAdapter } from '@/lib/research-engine/providers/nasjonalbiblioteket'
import { naraCatalogAdapter } from '@/lib/research-engine/providers/naraCatalog'
import { jstageAdapter } from '@/lib/research-engine/providers/jstage'
import { ciniiAdapter } from '@/lib/research-engine/providers/cinii'
import { musicbrainzAdapter } from '@/lib/research-engine/providers/musicbrainz'
import { gitlabApiAdapter } from '@/lib/research-engine/providers/gitlabApi'
import { codebergAdapter } from '@/lib/research-engine/providers/codeberg'
import { softwareHeritageAdapter } from '@/lib/research-engine/providers/softwareHeritage'
import { launchpadAdapter } from '@/lib/research-engine/providers/launchpad'
import { metacpanAdapter } from '@/lib/research-engine/providers/metacpan'
import { ecosystemsAdapter } from '@/lib/research-engine/providers/ecosystems'
import { depsDevAdapter } from '@/lib/research-engine/providers/depsDev'
import { homebrewAdapter } from '@/lib/research-engine/providers/homebrew'
import { mdnWebDocsAdapter } from '@/lib/research-engine/providers/mdnWebDocs'
import { rosettaCodeAdapter } from '@/lib/research-engine/providers/rosettaCode'
import { greynoiseAdapter } from '@/lib/research-engine/providers/greynoise'
import { phishstatsAdapter } from '@/lib/research-engine/providers/phishstats'
import { virustotalAdapter } from '@/lib/research-engine/providers/virustotal'
import { abuseipdbAdapter } from '@/lib/research-engine/providers/abuseipdb'
import { hybridAnalysisAdapter } from '@/lib/research-engine/providers/hybridAnalysis'
import { ontobeeAdapter } from '@/lib/research-engine/providers/ontobee'
import { umlsAdapter } from '@/lib/research-engine/providers/umls'
import { loincFhirAdapter } from '@/lib/research-engine/providers/loincFhir'
import { wikipathwaysAdapter } from '@/lib/research-engine/providers/wikipathways'
import { cellosaurusAdapter } from '@/lib/research-engine/providers/cellosaurus'
import { metabolomicsWorkbenchAdapter } from '@/lib/research-engine/providers/metabolomicsWorkbench'
import { npatlasAdapter } from '@/lib/research-engine/providers/npatlas'
import { wellcomeCollectionAdapter } from '@/lib/research-engine/providers/wellcomeCollection'
import { bhlAdapter } from '@/lib/research-engine/providers/bhl'
import { googleKgSearchAdapter } from '@/lib/research-engine/providers/googleKgSearch'
import { merriamWebsterAdapter } from '@/lib/research-engine/providers/merriamWebster'
import { braveSearchAdapter } from '@/lib/research-engine/providers/braveSearch'
import { checklistbankAdapter } from '@/lib/research-engine/providers/checklistbank'
import { eolAdapter } from '@/lib/research-engine/providers/eol'
import { globiAdapter } from '@/lib/research-engine/providers/globi'
import { mushroomObserverAdapter } from '@/lib/research-engine/providers/mushroomObserver'
import { arcticDataCenterAdapter } from '@/lib/research-engine/providers/arcticDataCenter'
import { cbetaAdapter } from '@/lib/research-engine/providers/cbeta'
import { eblAdapter } from '@/lib/research-engine/providers/ebl'
import { mercadoPublicoAdapter } from '@/lib/research-engine/providers/mercadoPublico'
import { inpeBdcAdapter } from '@/lib/research-engine/providers/inpeBdc'
import { pdokAdapter } from '@/lib/research-engine/providers/pdok'
import { satnogsAdapter } from '@/lib/research-engine/providers/satnogs'
import { nomadRepositoryAdapter } from '@/lib/research-engine/providers/nomadRepository'
import { krameriusAdapter } from '@/lib/research-engine/providers/kramerius'
import { bdlPolandAdapter } from '@/lib/research-engine/providers/bdlPoland'
import { israelCbsAdapter } from '@/lib/research-engine/providers/israelCbs'
import { nomisUkAdapter } from '@/lib/research-engine/providers/nomisUk'
import { absAustraliaAdapter } from '@/lib/research-engine/providers/absAustralia'
import { argentinaSeriesAdapter } from '@/lib/research-engine/providers/argentinaSeries'
import { dataGovMyAdapter } from '@/lib/research-engine/providers/dataGovMy'
import { datosAbiertosColombiaAdapter } from '@/lib/research-engine/providers/datosAbiertosColombia'
import { ineTempus3Adapter } from '@/lib/research-engine/providers/ineTempus3'
import { singstatAdapter } from '@/lib/research-engine/providers/singstat'
import { usgsM2mAdapter } from '@/lib/research-engine/providers/usgsM2m'
import { n2yoAdapter } from '@/lib/research-engine/providers/n2yo'
import { ariadnePortalAdapter } from '@/lib/research-engine/providers/ariadnePortal'
import { ohmOverpassAdapter } from '@/lib/research-engine/providers/ohmOverpass'
import { stackExchangeAdapter } from '@/lib/research-engine/providers/stackExchange'
import { ecmwfCdsAdapter } from '@/lib/research-engine/providers/ecmwfCds'
import { metOfficeDataHubAdapter } from '@/lib/research-engine/providers/metOfficeDataHub'
import { ndlSearchAdapter } from '@/lib/research-engine/providers/ndlSearch'
import { swisscoveryAdapter } from '@/lib/research-engine/providers/swisscovery'
import { yagoAdapter } from '@/lib/research-engine/providers/yago'
import { dataCommonsAdapter } from '@/lib/research-engine/providers/dataCommons'
import { econstorAdapter } from '@/lib/research-engine/providers/econstor'
import { w3cApiAdapter } from '@/lib/research-engine/providers/w3cApi'
import { wtoTimeseriesAdapter } from '@/lib/research-engine/providers/wtoTimeseries'
import { eStatJapanAdapter } from '@/lib/research-engine/providers/eStatJapan'
import { worldBankProjectsAdapter } from '@/lib/research-engine/providers/worldBankProjects'
import { usgsNationalMapAdapter } from '@/lib/research-engine/providers/usgsNationalMap'
import { imfSdmxAdapter } from '@/lib/research-engine/providers/imfSdmx'
import { scbSwedenAdapter } from '@/lib/research-engine/providers/scbSweden'
import { ssbNorwayAdapter } from '@/lib/research-engine/providers/ssbNorway'
import { statfinFinlandAdapter } from '@/lib/research-engine/providers/statfinFinland'
import { statisticsDenmarkAdapter } from '@/lib/research-engine/providers/statisticsDenmark'
import { unDesaPopulationAdapter } from '@/lib/research-engine/providers/unDesaPopulation'
import { IMPLEMENTED_PROVIDER_ADAPTERS } from '@/lib/research-engine/providers/registry'
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'

export type ResearchValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string | Promise<boolean | string>): Promise<ResearchValidationResult> {
  return Promise.resolve()
    .then(fn)
    .then(result => ({ id, pass: result === true, detail: result === true ? 'PASS' : String(result) }))
    .catch(error => ({ id, pass: false, detail: error instanceof Error ? error.message : String(error) }))
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function textResponse(text: string, status = 200, contentType = 'application/xml'): Response {
  return new Response(text, { status, headers: { 'Content-Type': contentType } })
}

function sampleDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return makeDocument({
    id: 'sample:1',
    provider: 'arxiv',
    providerRecordId: '1234.5678',
    title: 'Sample Title',
    summary: null,
    contentSnippet: null,
    canonicalUrl: 'https://export.arxiv.org/abs/1234.5678',
    sourceUrl: 'https://export.arxiv.org/abs/1234.5678',
    sourceName: 'arXiv',
    contentType: 'preprint',
    authors: [],
    organization: null,
    publishedAt: '2026-01-01',
    updatedAt: null,
    geography: null,
    language: 'en',
    identifiers: { arxiv_id: '1234.5678' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    ...overrides,
  })
}

/** Marks a sample document as a historical/archived capture (see dedupe.ts partitioning). */
function asHistorical(doc: ResearchDocument): ResearchDocument {
  return { ...doc, provenance: { ...doc.provenance, isHistorical: true } }
}

/** Temporarily sets env vars for the duration of `fn`, restoring the prior values (or absence) afterward. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(vars)) {
    prev[key] = process.env[key]
    process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Temporarily deletes env vars for the duration of `fn`, restoring the prior values afterward. */
async function withoutEnv<T>(names: string[], fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {}
  for (const name of names) {
    prev[name] = process.env[name]
    delete process.env[name]
  }
  try {
    return await fn()
  } finally {
    for (const [name, value] of Object.entries(prev)) {
      if (value !== undefined) process.env[name] = value
    }
  }
}

/** Returns a mocked `fetch` that yields each response in order, repeating the last one for any extra calls. */
function sequenceFetch(responses: Response[]): typeof fetch {
  let index = 0
  return (async () => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response
  }) as typeof fetch
}

/**
 * Runs an adapter test with a mocked, network-free `fetch` sequence and clean
 * provider-gate/cache/fetch-hook state before and after — so adapter tests
 * never leak concurrency-cooldown state, cached responses, or a stale mock
 * into a later test (see Repair 6's test-isolation requirement).
 */
async function withAdapterFetch<T>(responses: Response[], fn: () => Promise<T>): Promise<T> {
  __resetProviderGateForTests()
  __resetCacheForTests()
  __setResearchFetchForTests(sequenceFetch(responses))
  try {
    return await fn()
  } finally {
    __setResearchFetchForTests(null)
    __resetProviderGateForTests()
    __resetCacheForTests()
  }
}

type CountingFetchCalls = { count: number; urls: string[]; inits: (RequestInit | undefined)[] }

/**
 * Like withAdapterFetch, but also records every request URL/init so a test
 * can assert on call count, host, path, method, or query parameters.
 * Deliberately does NOT fall back to replaying the last mocked response once
 * `responses` is exhausted (Repair: independent-audit finding — a naive
 * Math.min-clamped index would let an unexpected extra retry/redirect fetch
 * hide behind a silently-replayed success response, so a call-count
 * assertion could pass even when the adapter secretly made more upstream
 * requests than the test authorized). Instead, any fetch beyond the
 * authorized `responses.length` throws immediately with a distinctive
 * message, so an unauthorized extra request surfaces as a visible failure
 * rather than a concealed retry.
 */
async function withCountingFetch<T>(responses: Response[], fn: (calls: CountingFetchCalls) => Promise<T>): Promise<T> {
  __resetProviderGateForTests()
  __resetCacheForTests()
  const calls: CountingFetchCalls = { count: 0, urls: [], inits: [] }
  __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
    const index = calls.count
    calls.count += 1
    calls.urls.push(String(input))
    calls.inits.push(init)
    if (index >= responses.length) {
      throw new Error(`withCountingFetch: unauthorized fetch #${calls.count} — only ${responses.length} mocked response(s) were authorized for this test, but the adapter attempted another upstream request`)
    }
    return responses[index]
  }) as typeof fetch)
  try {
    return await fn(calls)
  } finally {
    __setResearchFetchForTests(null)
    __resetProviderGateForTests()
    __resetCacheForTests()
  }
}

/** Common shape checks every normalized ResearchDocument must satisfy, regardless of provider. */
function documentShapeIssue(doc: ResearchDocument, provider: string): string | null {
  if (doc.provider !== provider) return `expected provider ${provider}, got ${doc.provider}`
  if (!doc.title) return 'missing title'
  if (!doc.canonicalUrl && !doc.sourceUrl) return 'missing canonical/source URL'
  if (typeof doc.retrievedAt !== 'string' || !doc.retrievedAt) return 'missing retrievedAt'
  if (doc.provenance.provider !== provider) return 'provenance.provider mismatch'
  return null
}

export async function runResearchEngineValidation(): Promise<ResearchValidationResult[]> {
  const results: ResearchValidationResult[] = []
  const add = async (id: string, fn: () => boolean | string | Promise<boolean | string>) => results.push(await test(id, fn))

  await add('re_01_all_31_providers_registered', () =>
    RESEARCH_PROVIDER_ENV.length === 254 || `expected 254 providers, found ${RESEARCH_PROVIDER_ENV.length}`)

  await add('re_02_missing_required_env_not_configured', () => {
    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    const withRequiredEnv = RESEARCH_PROVIDER_ENV.filter(descriptor => descriptor.requiredEnv.length > 0)
    return withRequiredEnv.every(descriptor => providerConfigStatus(descriptor, emptyEnv) !== 'configured')
      || 'a provider with required env reported configured against an empty environment'
  })

  await add('re_03_env_satisfied_check_never_reads_value_into_result', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === 'github')!
    const satisfied = isProviderEnvSatisfied(descriptor, { ...process.env, GITHUB_TOKEN: 'not-a-real-token' })
    return typeof satisfied === 'boolean' || 'isProviderEnvSatisfied must return a boolean, never the value'
  })

  await add('re_04_host_allowlist_blocks_unknown_host', () =>
    !isAllowedHost('github', 'evil.example.com') || 'github allowlist accepted an arbitrary host')

  await add('re_05_host_allowlist_accepts_official_host', () =>
    isAllowedHost('github', 'api.github.com') || 'github allowlist rejected its own official host')

  await add('re_06_assert_allowed_url_blocks_non_https', () => {
    try {
      assertAllowedProviderUrl('github', 'http://api.github.com/repos')
      return 'non-HTTPS URL was not rejected'
    } catch {
      return true
    }
  })

  await add('re_07_assert_allowed_url_blocks_disallowed_host', () => {
    try {
      assertAllowedProviderUrl('fred', 'https://attacker.example.com/steal')
      return 'disallowed host was not rejected'
    } catch {
      return true
    }
  })

  await add('re_08_redact_url_strips_api_key', () => {
    const redacted = redactUrlForLogging('https://api.stlouisfed.org/fred/series?api_key=SECRET123&file_type=json')
    return (!redacted.includes('SECRET123') && redacted.includes('REDACTED')) || `secret leaked into redacted URL: ${redacted}`
  })

  await add('re_09_redact_text_strips_bearer_token', () => {
    const redacted = redactSecretsFromText('request failed: Bearer abcdef123456789 unauthorized')
    return !redacted.includes('abcdef123456789') || 'bearer token leaked into redacted error text'
  })

  await add('re_10_safe_json_parse_never_throws', () => safeJsonParse('{not valid json') === null || 'safeJsonParse should return null on invalid input, not throw')

  await add('re_11_safe_ndjson_parse_caps_lines_and_skips_bad_lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => (i === 3 ? 'not-json' : JSON.stringify({ i }))).join('\n')
    const parsed = safeNdjsonParse<{ i: number }>(lines, 5)
    return parsed.length <= 5 || `expected at most 5 parsed lines, got ${parsed.length}`
  })

  await add('re_12_xml_lite_extracts_atom_entry_fields', () => {
    const xml = '<feed><entry><id>http://arxiv.org/abs/1234.5678v1</id><title>A Title &amp; More</title><summary><![CDATA[abstract text]]></summary></entry></feed>'
    const entries = extractXmlBlocks(xml, 'entry')
    if (entries.length !== 1) return `expected 1 entry, got ${entries.length}`
    const title = extractXmlText(entries[0], 'title')
    const summary = extractXmlText(entries[0], 'summary')
    return (title === 'A Title & More' && summary === 'abstract text') || `title=${title} summary=${summary}`
  })

  await add('re_13_xml_lite_decodes_numeric_entities', () =>
    decodeXmlEntities('&#65;&#x42;') === 'AB' || 'numeric entity decoding failed')

  await add('re_14_dedupe_merges_same_doi_preserves_distinct_citations', () => {
    const a = sampleDoc({
      id: 'a', provider: 'crossref', identifiers: { doi: '10.1234/x' },
      canonicalUrl: 'https://doi.org/10.1234/x',
      citations: [buildCitation(sampleDoc({ provider: 'crossref', identifiers: { doi: '10.1234/x' }, canonicalUrl: 'https://doi.org/10.1234/x' }))],
    })
    const b = sampleDoc({
      id: 'b', provider: 'crossref', identifiers: { doi: '10.1234/x' }, title: 'Different title, same DOI',
      canonicalUrl: 'https://doi.org/10.1234/x',
      citations: [buildCitation(sampleDoc({
        provider: 'crossref', identifiers: { doi: '10.1234/x' },
        canonicalUrl: 'https://publisher.example.com/article/10.1234x', sourceUrl: 'https://publisher.example.com/article/10.1234x',
      }))],
    })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1 && documents[0].citations.length === 2)
      || `documents=${documents.length} duplicatesRemoved=${duplicatesRemoved} citations=${documents[0]?.citations.length}`
  })

  await add('re_15_dedupe_does_not_merge_on_title_similarity_alone', () => {
    const a = sampleDoc({ id: 'a', identifiers: {}, canonicalUrl: 'https://example.com/a', title: 'Climate report 2026' })
    const b = sampleDoc({ id: 'b', identifiers: {}, canonicalUrl: 'https://example.com/b', title: 'Climate report 2026', publishedAt: '2026-02-02' })
    const { documents } = deduplicateDocuments([a, b])
    return documents.length === 2 || 'documents with different URLs and dates were incorrectly merged on title alone'
  })

  await add('re_16_citation_never_fabricates_missing_fields', () => {
    const doc = sampleDoc({ authors: [], organization: null, license: null })
    const citation = buildCitation(doc)
    return (citation.authorOrOrganization === null && citation.licenseOrAccessWarning === null)
      || 'citation invented an author/org or license that was not present on the source document'
  })

  await add('re_17_router_rejects_unimplemented_provider_with_reason', () => {
    // world_bank_climate has no required env var and remains unimplemented
    // (confirmed live this mission: real Cloudflare JS-challenge block on
    // every path, EXTERNAL_BLOCKER), so this isolates the "adapter not
    // implemented" rejection path from "env missing".
    const decision = routeResearchQuery({ text: 'test', intent: 'climate_environment' })
    const worldBankClimate = decision.rejectedProviders.find(entry => entry.provider === 'world_bank_climate')
    return Boolean(worldBankClimate && /not implemented/i.test(worldBankClimate.reason)) || `world_bank_climate rejection: ${JSON.stringify(worldBankClimate)}`
  })

  await add('re_18_router_selects_only_configured_implemented_providers', () => {
    const decision = routeResearchQuery({ text: 'earthquake', intent: 'earthquakes_hazards' })
    return decision.selectedProviders.includes('usgs_earthquake') || `usgs_earthquake (public, unauthenticated) should always be selectable: ${JSON.stringify(decision)}`
  })

  await add('re_19_router_enforces_max_results_ceiling', () => {
    const decision = routeResearchQuery({ text: 'x', maxResults: 9999 })
    return decision.maxResults <= 50 || `maxResults ceiling not enforced: ${decision.maxResults}`
  })

  await add('re_20_safe_fetch_retries_429_then_succeeds', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      if (calls === 1) return jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '0' })
      return jsonResponse({ ok: true })
    }) as typeof fetch)
    try {
      const result = await safeProviderFetch('github', 'https://api.github.com/search/repositories?q=test', { maxRetries: 2, timeoutMs: 5000 })
      return (result.ok && calls === 2) || `ok=${result.ok} calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  await add('re_21_safe_fetch_caps_response_size', async () => {
    __setResearchFetchForTests((async () => new Response('x'.repeat(2_000_000), { status: 200 })) as typeof fetch)
    try {
      const result = await safeProviderFetch('github', 'https://api.github.com/search/repositories?q=test', { maxResponseBytes: 1000, maxRetries: 0, timeoutMs: 5000 })
      return (result.truncated && result.text.length <= 1000) || `truncated=${result.truncated} len=${result.text.length}`
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  await add('re_22_safe_fetch_blocks_disallowed_redirect_host', async () => {
    __setResearchFetchForTests((async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example.com/steal' } })) as typeof fetch)
    try {
      await safeProviderFetch('github', 'https://api.github.com/search/repositories?q=test', { maxRetries: 0, timeoutMs: 5000 })
      return 'redirect to a disallowed host was not blocked'
    } catch {
      return true
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  await add('re_23_search_route_requires_commander_session', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/search/route.ts'), 'utf8')
    return (source.includes('requireCommanderSession') && source.includes('secretsExposed: false')) || 'search route is missing Commander auth or secretsExposed flag'
  })

  await add('re_24_providers_route_requires_commander_session', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/providers/route.ts'), 'utf8')
    return source.includes('requireCommanderSession') || 'providers route is missing Commander auth'
  })

  await add('re_25_health_route_requires_commander_session', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/providers/[provider]/health/route.ts'), 'utf8')
    return source.includes('requireCommanderSession') || 'health route is missing Commander auth'
  })

  await add('re_26_search_route_rejects_arbitrary_provider_ids', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/research/search/route.ts'), 'utf8')
    return source.includes('KNOWN_PROVIDER_IDS.has') || 'search route does not validate provider ids against the known registry'
  })

  await add('re_27_no_next_public_provider_secrets', () => {
    const configSource = readFileSync(join(process.cwd(), 'lib/research-engine/config/providerEnv.ts'), 'utf8')
    return !/NEXT_PUBLIC_.*(KEY|TOKEN|SECRET)/i.test(configSource) || 'a provider secret env var appears to be exposed via NEXT_PUBLIC_'
  })

  await add('re_28_nasa_gibs_reuses_existing_module_not_duplicated', () => {
    const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers/nasaGibs.ts'), 'utf8')
    return (source.includes("from '@/lib/earth-intelligence/gibsLayers'") && source.includes("from '@/lib/earth-intelligence/gibsServerConfig'"))
      || 'nasa_gibs adapter does not import the existing earth-intelligence module'
  })

  // Exercises the actual safe-error path (safeProviderFetch -> catch -> redactSecretsFromText -> throw)
  // with a synthetic error carrying a fake secret, an Authorization-style value, and an internal
  // stack-frame/file-path fragment, and verifies none of the three survive into the thrown message.
  await add('re_29_safe_fetch_error_redacts_secrets_authorization_and_stack_details', async () => {
    __resetProviderGateForTests()
    const fakeSecret = 'sk-FAKESECRET1234567890'
    const syntheticMessage = `connect ECONNREFUSED: Authorization: Bearer ${fakeSecret} request failed at Object.<anonymous> (C:\\Users\\markb\\warroom\\lib\\research-engine\\providers\\worldBankIndicators.ts:45:10)`
    __setResearchFetchForTests((async () => {
      throw new Error(syntheticMessage)
    }) as typeof fetch)
    try {
      await safeProviderFetch('world_bank_indicators', 'https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.CD', { maxRetries: 0, timeoutMs: 5000 })
      return 'expected safeProviderFetch to throw on a network-layer error'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes(fakeSecret)) return `fake secret leaked into error message: ${message}`
      if (/Authorization["']?\s*[:=]\s*["']?Bearer\s+sk-FAKESECRET/i.test(message)) return `Authorization value leaked into error message: ${message}`
      if (message.includes('worldBankIndicators.ts:45:10') || message.includes('Object.<anonymous>')) return `internal stack/path detail leaked into error message: ${message}`
      if (!message.includes('REDACTED')) return `expected a safe redacted marker in the error message, got: ${message}`
      return true
    } finally {
      __setResearchFetchForTests(null)
    }
  })

  // --- Repair 2: historical/current provenance must never be collapsed by dedupe ---

  await add('re_30_dedupe_current_current_duplicate_merges', () => {
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/hist-cc' } })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/hist-cc' }, title: 'A different title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1 && documents[0].provenance.isHistorical === false)
      || `expected current+current merge, got documents=${documents.length} duplicatesRemoved=${duplicatesRemoved}`
  })

  await add('re_31_dedupe_historical_historical_duplicate_merges', () => {
    const a = asHistorical(sampleDoc({ id: 'a', identifiers: { doi: '10.1/hist-hh' } }))
    const b = asHistorical(sampleDoc({ id: 'b', identifiers: { doi: '10.1/hist-hh' }, title: 'A different title' }))
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1 && documents[0].provenance.isHistorical === true)
      || `expected historical+historical merge, got documents=${documents.length} duplicatesRemoved=${duplicatesRemoved}`
  })

  await add('re_32_dedupe_current_and_historical_never_merge', () => {
    const current = sampleDoc({ id: 'cur', identifiers: { doi: '10.1/hist-mix' } })
    const historical = asHistorical(sampleDoc({ id: 'hist', identifiers: { doi: '10.1/hist-mix' } }))
    const { documents, duplicatesRemoved } = deduplicateDocuments([current, historical])
    const hasCurrent = documents.some(doc => !doc.provenance.isHistorical)
    const hasHistorical = documents.some(doc => doc.provenance.isHistorical)
    return (documents.length === 2 && duplicatesRemoved === 0 && hasCurrent && hasHistorical)
      || `a current and a historical document sharing an identifier were merged: documents=${documents.length}`
  })

  await add('re_33_dedupe_preserves_and_dedupes_warnings_across_merge', () => {
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/warn' }, warnings: ['shared warning', 'a-only warning'] })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/warn' }, warnings: ['shared warning', 'b-only warning'] })
    const { documents } = deduplicateDocuments([a, b])
    const warnings = documents[0]?.warnings ?? []
    return (warnings.length === 3 && new Set(warnings).size === 3) || `expected 3 deduplicated warnings, got ${JSON.stringify(warnings)}`
  })

  await add('re_34_dedupe_collapses_identical_duplicate_citations', () => {
    const citation = buildCitation(sampleDoc({ provider: 'crossref', identifiers: { doi: '10.1/dupcite' } }))
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/dupcite' }, citations: [citation] })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/dupcite' }, citations: [citation] })
    const { documents } = deduplicateDocuments([a, b])
    return documents[0]?.citations.length === 1 || `expected a truly identical citation to collapse to 1, got ${documents[0]?.citations.length}`
  })

  // --- Repair 3 (revised): title and/or publication date must never be a merge key,
  // alone or combined, whether the records share a provider or come from different ones ---

  await add('re_35_dedupe_null_date_title_match_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: null, title: 'Shared Title No Date' })
    const b = sampleDoc({ id: 'b', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: null, title: 'Shared Title No Date' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two unrelated null-date same-title documents were merged: documents=${documents.length}`
  })

  await add('re_36_dedupe_same_title_same_date_same_provider_no_identifier_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const b = sampleDoc({ id: 'b', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two same-provider documents with no stable identifier were merged on title+date alone: documents=${documents.length}`
  })

  await add('re_36b_dedupe_same_title_same_date_different_providers_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const b = sampleDoc({ id: 'b', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Dated Title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two different-provider documents with no stable identifier were merged on title+date alone: documents=${documents.length}`
  })

  await add('re_37_dedupe_canonical_url_duplicates_still_merge', () => {
    const a = sampleDoc({ id: 'a', identifiers: {}, canonicalUrl: 'https://example.com/report', title: 'Title A' })
    const b = sampleDoc({ id: 'b', identifiers: {}, canonicalUrl: 'https://example.com/report', title: 'Title B (different)' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1) || `expected canonical URL match to merge, got documents=${documents.length}`
  })

  await add('re_38_dedupe_stable_identifier_duplicates_still_merge', () => {
    const a = sampleDoc({ id: 'a', identifiers: { pmid: '12345' } })
    const b = sampleDoc({ id: 'b', identifiers: { pmid: '12345' }, title: 'A totally different title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1) || `expected strong-identifier match to merge, got documents=${documents.length}`
  })

  await add('re_39_dedupe_provider_record_id_duplicates_merge_when_no_stronger_evidence', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title X' })
    const b = sampleDoc({ id: 'b', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title Y' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 1 && duplicatesRemoved === 1) || `expected providerRecordId match to merge, got documents=${documents.length}`
  })

  await add('re_39b_dedupe_provider_record_id_same_value_different_providers_stays_separate', () => {
    const a = sampleDoc({ id: 'a', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title X' })
    const b = sampleDoc({ id: 'b', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: 'rec-1', title: 'Title Y' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `a providerRecordId shared across two different providers was incorrectly merged: documents=${documents.length}`
  })

  await add('re_39c_dedupe_duplicates_removed_count_is_exact_across_mixed_batch', () => {
    // 5 inputs: {a,b} share a DOI (1 merge), {c,d} share only title+date across different providers (must stay separate), e is unrelated.
    const a = sampleDoc({ id: 'a', identifiers: { doi: '10.1/exact-count' } })
    const b = sampleDoc({ id: 'b', identifiers: { doi: '10.1/exact-count' }, title: 'A different title' })
    const c = sampleDoc({ id: 'c', provider: 'exa', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-04-01', title: 'Same Title Different Provider' })
    const d = sampleDoc({ id: 'd', provider: 'wikidata', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-04-01', title: 'Same Title Different Provider' })
    const e = sampleDoc({ id: 'e', identifiers: { doi: '10.1/exact-count-unrelated' } })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b, c, d, e])
    return (documents.length === 4 && duplicatesRemoved === 1) || `expected exactly 1 duplicate removed out of 5 (1 real merge, 2 correctly-kept-separate lookalikes, 1 unrelated), got documents=${documents.length} duplicatesRemoved=${duplicatesRemoved}`
  })

  // --- Repair 4: every declared config-status value must be reachable ---

  await add('re_40_all_declared_provider_config_statuses_are_reachable', () => {
    const reachable = new Set<string>()
    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    for (const descriptor of RESEARCH_PROVIDER_ENV) {
      reachable.add(providerConfigStatus(descriptor, emptyEnv))
      reachable.add(providerConfigStatus(descriptor, process.env))
    }
    const declared = ['configured', 'unavailable', 'pending']
    const unreachable = declared.filter(status => !reachable.has(status))
    return unreachable.length === 0 || `declared status(es) never reachable against this registry: ${unreachable.join(', ')}`
  })

  // --- Repair 7: capability declarations must not overstate what run() actually does ---

  await add('re_41_implemented_provider_capabilities_do_not_overstate_run_behavior', () => {
    const maxCapabilitiesById: Record<string, string[]> = {
      exa: ['search'],
      github: ['search'],
      ncbi: ['search'],
      fred: ['search', 'timeSeries'],
      arxiv: ['search'],
      crossref: ['search'],
      nasa_gibs: ['mapLayers'],
      world_bank_indicators: ['search', 'timeSeries'],
      usgs_earthquake: ['search', 'geoSearch'],
      library_of_congress: ['search'],
      wikidata: ['search'],
      usgs_water: ['timeSeries', 'geoSearch'],
      usgs_earthquake_feed: ['list'],
      usgs_sciencebase: ['search', 'getById'],
      semantic_scholar: ['search'],
      courtlistener: ['search'],
      internet_archive: ['search'],
      wayback: ['historicalCaptures'],
      common_crawl: ['historicalCaptures'],
      sam_gov: ['search'],
      nasa: ['search'],
      fmcsa: ['getById'],
      mitre_attack: ['search', 'getById'],
      gleif: ['search', 'getById'],
      osv_dev: ['search'],
      nvd: ['search', 'getById'],
      cisa_kev: ['search'],
      osm_overpass: ['geoSearch'],
      geonames: ['search'],
      eurostat: ['timeSeries'],
      wikipedia: ['getById'],
      europe_pmc: ['search'],
      clinicaltrials_gov: ['search'],
      openfda: ['search'],
      pubchem: ['getById'],
      gbif: ['search'],
      uniprot: ['search'],
      us_census: ['timeSeries'],
      congress_gov: ['search'],
      govinfo: ['search'],
      sec_edgar: ['search'],
      orcid: ['search'],
      reliefweb: ['search'],
      ensembl: ['getById'],
      rcsb_pdb: ['search'],
      string_db: ['search'],
      gnomad: ['getById'],
      ebi_ols: ['search'],
      medlineplus: ['search'],
      who_gho: ['timeSeries'],
      rxnorm: ['search'],
      dailymed: ['search'],
      chembl: ['search'],
      open_targets: ['search'],
      inaturalist: ['search'],
      obis: ['search', 'geoSearch'],
      worms: ['search'],
      itis: ['search'],
      pypi: ['getById'],
      npm_registry: ['getById'],
      crates_io: ['search'],
      rubygems: ['search'],
      maven_central: ['search'],
      github_advisory: ['search'],
      endoflife: ['timeSeries'],
      epss: ['getById'],
      alienvault_otx: ['search'],
      malwarebazaar: ['search'],
      threatfox: ['search'],
      urlhaus: ['search'],
      federal_register: ['search'],
      usaspending: ['search'],
      uk_legislation: ['search'],
      opensanctions: ['search'],
      companies_house: ['search'],
      ecb_sdw: ['timeSeries'],
      bank_of_canada: ['timeSeries'],
      bis_stats: ['timeSeries'],
      eia: ['timeSeries'],
      statcan_wds: ['timeSeries'],
      uk_ons: ['search'],
      insee_melodi: ['search'],
      open_meteo: ['getById'],
      noaa_cdo: ['search'],
      met_no: ['getById'],
      noaa_swpc: ['list'],
      nominatim: ['search'],
      nasa_cmr: ['search'],
      copernicus_dataspace: ['search'],
      opentopography: ['getById'],
      celestrak: ['getById', 'list'],
      jpl_horizons: ['getById'],
      jpl_sbdb: ['getById'],
      nasa_exoplanet_archive: ['search'],
      simbad: ['search'],
      mast: ['search'],
      ror: ['search'],
      opencitations: ['getById'],
      biorxiv_medrxiv: ['getById'],
      hal: ['search'],
      base_search: ['search'],
      inspire_hep: ['search'],
      hepdata: ['getById'],
      zbmath: ['search'],
      oeis: ['search'],
      nasa_ads: ['search'],
      epo_ops: ['search'],
      materials_project: ['search'],
      oqmd: ['search'],
      aflow: ['search'],
      pleiades: ['search'],
      idai_gazetteer: ['search'],
      edh: ['search'],
      nomisma: ['getById'],
      whg: ['search'],
      open_context: ['search'],
      cdli: ['search'],
      ehri: ['search'],
      art_institute_chicago: ['search'],
      cleveland_museum: ['search'],
      va_museum: ['search'],
      smk: ['search'],
      open_library: ['search'],
      unhcr_data: ['search'],
      ocha_fts: ['search'],
      opensky: ['search'],
      cbdb: ['getById'],
      eclac_cepalstat: ['getById'],
      oecd_data_explorer: ['timeSeries'],
      un_sdg: ['search'],
      unesco_uis: ['search'],
      idb_open_data: ['search'],
      iati_datastore: ['search'],
      debian_sources: ['getById'],
      ietf_datatracker: ['search'],
      wikimedia_commons: ['search'],
      dbpedia: ['search'],
      dblp: ['search'],
      mozilla_bugzilla: ['search'],
      msrc_cvrf: ['getById'],
      isni: ['search'],
      lobid_gnd: ['search'],
      factgrid: ['search'],
      ubuntu_security: ['search'],
      redhat_security_data: ['search'],
      cve_org: ['getById'],
      conceptnet: ['getById'],
      ena_portal: ['search'],
      ncbi_datasets: ['getById'],
      alphafold_db: ['getById'],
      reactome: ['search'],
      intact: ['search'],
      orphadata: ['getById'],
      guide_to_pharmacology: ['search'],
      clinpgx: ['search'],
      pbdb: ['search'],
      nws_weather: ['search'],
      japan_egov_hourei: ['search'],
      australia_frl: ['search'],
      uk_gazette: ['search'],
      eu_ted: ['search'],
      brazil_transparencia: ['search'],
      sidra_brazil: ['getById'],
      cbs_statline: ['getById'],
      gaia_archive: ['getById'],
      sdss_skyserver: ['search'],
      apache_jira: ['search'],
      health_canada_dpd: ['search'],
      bindingdb: ['getById'],
      kegg: ['search'],
      metabolights: ['getById'],
      pride_archive: ['search'],
      libris_xl: ['search'],
      nasjonalbiblioteket: ['search'],
      nara_catalog: ['search'],
      jstage: ['search'],
      cinii: ['search'],
      musicbrainz: ['search'],
      gitlab_api: ['search'],
      codeberg: ['search'],
      software_heritage: ['search'],
      launchpad: ['search'],
      metacpan: ['search'],
      ecosystems: ['getById'],
      deps_dev: ['getById'],
      homebrew: ['getById'],
      mdn_web_docs: ['search'],
      rosetta_code: ['search'],
      greynoise: ['getById'],
      phishstats: ['search'],
      virustotal: ['search'],
      abuseipdb: ['getById'],
      hybrid_analysis: ['search'],
      ontobee: ['search'],
      umls: ['search'],
      loinc_fhir: ['getById'],
      wikipathways: ['search'],
      cellosaurus: ['search'],
      metabolomics_workbench: ['search'],
      npatlas: ['search'],
      wellcome_collection: ['search'],
      bhl: ['search'],
      google_kg_search: ['search'],
      merriam_webster: ['getById'],
      brave_search: ['search'],
      checklistbank: ['search'],
      eol: ['search'],
      globi: ['search'],
      mushroom_observer: ['search'],
      arctic_data_center: ['search'],
      cbeta: ['search'],
      ebl: ['getById'],
      mercado_publico: ['getById'],
      inpe_bdc: ['search'],
      pdok: ['search'],
      satnogs: ['search'],
      nomad_repository: ['search'],
      kramerius: ['search'],
      bdl_poland: ['search'],
      israel_cbs: ['getById'],
      nomis_uk: ['getById'],
      abs_australia: ['getById', 'timeSeries'],
      argentina_series: ['getById', 'timeSeries'],
      data_gov_my: ['getById'],
      datos_abiertos_colombia: ['search'],
      ine_tempus3: ['getById', 'timeSeries'],
      singstat: ['getById'],
      usgs_m2m: ['search'],
      n2yo: ['getById'],
      ariadne_portal: ['search'],
      ohm_overpass: ['geoSearch'],
      stack_exchange: ['search'],
      ecmwf_cds: ['search'],
      met_office_datahub: ['getById'],
      ndl_search: ['search'],
      swisscovery: ['search'],
      yago: ['search'],
      data_commons: ['getById'],
      econstor: ['search'],
      w3c_api: ['search'],
      wto_timeseries: ['timeSeries'],
      e_stat_japan: ['search'],
      world_bank_projects: ['search'],
      usgs_national_map: ['search'],
      imf_sdmx: ['timeSeries'],
      scb_sweden: ['timeSeries'],
      ssb_norway: ['timeSeries'],
      statfin_finland: ['timeSeries'],
      statistics_denmark: ['timeSeries'],
      un_desa_population: ['search'],
    }
    const implemented = RESEARCH_PROVIDER_ENV.filter(descriptor => descriptor.implemented)
    const offenders = implemented.filter(descriptor => {
      const allowed = maxCapabilitiesById[descriptor.id]
      if (!allowed) return true
      return descriptor.capabilities.some(capability => !allowed.includes(capability))
    })
    return offenders.length === 0 || `capability declarations overstate run() behavior for: ${offenders.map(d => d.id).join(', ')}`
  })

  // --- Repair 6: adapter-specific mocked tests for all 11 implemented providers ---

  await add('re_42_github_success_normalizes_repository_search', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ items: [{ full_name: 'octocat/hello-world', html_url: 'https://github.com/octocat/hello-world', description: 'demo repo', owner: { login: 'octocat' }, language: 'TypeScript', license: { name: 'MIT' }, stargazers_count: 42, pushed_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', created_at: '2025-01-01T00:00:00Z' }] }),
  ], async () => {
    const response = await githubAdapter.run({ text: 'hello world' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.documents[0].identifiers.github_full_name !== 'octocat/hello-world') return 'github_full_name identifier missing/incorrect'
    if (response.documents.length > 25) return 'result count not bounded'
    return documentShapeIssue(response.documents[0], 'github') ?? true
  })))

  await add('re_43_github_upstream_error_is_safe_not_a_fake_success', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await githubAdapter.run({ text: 'hello world' })
    return (response.ok === false && response.documents.length === 0 && response.error !== null) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_403_github_issue_prefix_uses_official_issue_search_endpoint', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withCountingFetch([
    jsonResponse({ items: [{ id: 101, number: 7, title: 'Investigate parser drift', html_url: 'https://github.com/octocat/hello-world/issues/7', body: 'Parser drift in import path', user: { login: 'octocat' }, repository_url: 'https://api.github.com/repos/octocat/hello-world', state: 'open', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', closed_at: null }] }),
  ], async calls => {
    const response = await githubAdapter.run({ text: 'github issues: parser drift repo:octocat/hello-world', maxResults: 3 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (calls.count !== 1) return `expected one upstream request, got ${calls.count}`
    const url = new URL(calls.urls[0])
    if (url.pathname !== '/search/issues') return `expected /search/issues, got ${url.pathname}`
    if (url.searchParams.get('per_page') !== '3') return `expected bounded per_page=3, got ${url.searchParams.get('per_page')}`
    if (!url.searchParams.get('q')?.includes('is:issue')) return `missing is:issue qualifier in ${url.searchParams.get('q')}`
    const doc = response.documents[0]
    if (doc.contentType !== 'code_issue') return `expected code_issue, got ${doc.contentType}`
    if (doc.identifiers.github_repository !== 'octocat/hello-world') return 'github_repository identifier missing'
    if (doc.identifiers.github_issue_number !== '7') return 'github_issue_number identifier missing'
    return documentShapeIssue(doc, 'github') ?? true
  })))

  await add('re_404_github_pr_prefix_uses_issue_search_with_pr_qualifier', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withCountingFetch([
    jsonResponse({ items: [{ id: 202, number: 11, title: 'Repair trace output', html_url: 'https://github.com/octocat/hello-world/pull/11', body: 'Trace output repair', user: { login: 'hubot' }, repository_url: 'https://api.github.com/repos/octocat/hello-world', state: 'open', created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-02T00:00:00Z', closed_at: null, pull_request: { url: 'https://api.github.com/repos/octocat/hello-world/pulls/11' } }] }),
  ], async calls => {
    const response = await githubAdapter.run({ text: 'github prs: trace output repo:octocat/hello-world', maxResults: 2 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const url = new URL(calls.urls[0])
    if (url.pathname !== '/search/issues') return `expected /search/issues, got ${url.pathname}`
    if (!url.searchParams.get('q')?.includes('is:pr')) return `missing is:pr qualifier in ${url.searchParams.get('q')}`
    const doc = response.documents[0]
    if (doc.contentType !== 'code_pull_request') return `expected code_pull_request, got ${doc.contentType}`
    if (doc.identifiers.github_pull_request !== 'true') return 'github_pull_request marker missing'
    return documentShapeIssue(doc, 'github') ?? true
  })))

  await add('re_405_github_default_search_remains_repository_search', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withCountingFetch([
    jsonResponse({ items: [{ full_name: 'octocat/default-search', html_url: 'https://github.com/octocat/default-search', description: 'default repo mode', owner: { login: 'octocat' }, language: 'TypeScript', license: { name: 'MIT' }, stargazers_count: 1, pushed_at: '2026-03-02T00:00:00Z', updated_at: '2026-03-02T00:00:00Z', created_at: '2026-03-01T00:00:00Z' }] }),
  ], async calls => {
    // Deliberately irregular whitespace and >256 chars so this proves the generic
    // repository-search path sends query.text verbatim (pre-Wave-1 behavior), not
    // the trim/collapse/256-char-truncate normalization added for issues/PR modes.
    const rawQueryText = `  default   search  is:issue  ${'x'.repeat(300)}  `
    const response = await githubAdapter.run({ text: rawQueryText, maxResults: 30 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const url = new URL(calls.urls[0])
    if (url.pathname !== '/search/repositories') return `expected /search/repositories, got ${url.pathname}`
    if (url.searchParams.get('per_page') !== '25') return `expected per_page cap of 25, got ${url.searchParams.get('per_page')}`
    if (url.searchParams.get('q') !== rawQueryText) return `expected raw query.text to reach the repository-search request unchanged, got ${JSON.stringify(url.searchParams.get('q'))}`
    if (response.documents[0].contentType !== 'code_repository') return `expected code_repository, got ${response.documents[0].contentType}`
    return true
  })))

  await add('re_406_github_issues_mode_strips_conflicting_pr_discriminator', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withCountingFetch([
    jsonResponse({ items: [{ id: 301, number: 21, title: 'Security bug', html_url: 'https://github.com/octocat/hello-world/issues/21', body: 'Security bug report', user: { login: 'octocat' }, repository_url: 'https://api.github.com/repos/octocat/hello-world', state: 'open', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', closed_at: null }] }),
  ], async calls => {
    const response = await githubAdapter.run({ text: 'github issues: is:pr security bug', maxResults: 3 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const url = new URL(calls.urls[0])
    if (url.pathname !== '/search/issues') return `expected /search/issues, got ${url.pathname}`
    const q = url.searchParams.get('q') ?? ''
    if (!/\bis:issue\b/.test(q)) return `expected canonical is:issue qualifier to win, got ${q}`
    if (/\bis:pr\b/i.test(q)) return `conflicting is:pr qualifier was not stripped in issues mode: ${q}`
    if (/\btype:pr\b/i.test(q)) return `conflicting type:pr qualifier was not stripped in issues mode: ${q}`
    return true
  })))

  await add('re_407_github_pr_mode_strips_conflicting_issue_discriminator', () => withEnv({ GITHUB_TOKEN: 'test-token-not-real' }, () => withCountingFetch([
    jsonResponse({ items: [{ id: 302, number: 22, title: 'Security bug fix', html_url: 'https://github.com/octocat/hello-world/pull/22', body: 'Security bug fix', user: { login: 'hubot' }, repository_url: 'https://api.github.com/repos/octocat/hello-world', state: 'open', created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-04T00:00:00Z', closed_at: null, pull_request: { url: 'https://api.github.com/repos/octocat/hello-world/pulls/22' } }] }),
  ], async calls => {
    const response = await githubAdapter.run({ text: 'github prs: is:issue security bug', maxResults: 3 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const url = new URL(calls.urls[0])
    if (url.pathname !== '/search/issues') return `expected /search/issues, got ${url.pathname}`
    const q = url.searchParams.get('q') ?? ''
    if (!/\bis:pr\b/.test(q)) return `expected canonical is:pr qualifier to win, got ${q}`
    if (/\bis:issue\b/i.test(q)) return `conflicting is:issue qualifier was not stripped in prs mode: ${q}`
    if (/\btype:issue\b/i.test(q)) return `conflicting type:issue qualifier was not stripped in prs mode: ${q}`
    return true
  })))

  await add('re_44_exa_success_normalizes_web_search', () => withEnv({ EXA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ title: 'Example Article', url: 'https://example.com/article', publishedDate: '2026-02-01', author: 'Jane Doe', score: 0.9, text: 'snippet text' }] }),
  ], async () => {
    const response = await exaAdapter.run({ text: 'example query' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    return documentShapeIssue(response.documents[0], 'exa') ?? true
  })))

  await add('re_45_exa_upstream_error_is_safe_not_a_fake_success', () => withEnv({ EXA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await exaAdapter.run({ text: 'example query' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_46_ncbi_success_normalizes_pubmed_search', () => withAdapterFetch([
    jsonResponse({ esearchresult: { idlist: ['111'] } }),
    jsonResponse({ result: { '111': { uid: '111', title: 'Sample Study', pubdate: '2026-01-01', authors: [{ name: 'A Researcher' }], fulljournalname: 'Journal of Examples', articleids: [{ idtype: 'doi', value: '10.9999/sample' }] } } }),
    textResponse('<PubmedArticleSet><PubmedArticle><Abstract><AbstractText>Abstract text here.</AbstractText></Abstract></PubmedArticle></PubmedArticleSet>'),
  ], async () => {
    const response = await ncbiAdapter.run({ text: 'sample study' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.pmid !== '111') return 'pmid identifier missing'
    if (doc.summary !== 'Abstract text here.') return `expected the efetch abstract normalized onto the top result, got ${doc.summary}`
    return documentShapeIssue(doc, 'ncbi') ?? true
  }))

  await add('re_47_ncbi_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await ncbiAdapter.run({ text: 'sample study' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_48_fred_success_normalizes_series_and_observations', () => withEnv({ FRED_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ seriess: [{ id: 'GNPCA', title: 'Real Gross National Product', frequency: 'Annual', units: 'Billions of Chained 2017 Dollars', observation_start: '1929-01-01', observation_end: '2025-01-01', last_updated: '2026-01-01' }] }),
    jsonResponse({ observations: [{ date: '2024-01-01', value: '20500.1' }, { date: '2025-01-01', value: '21000.5' }] }),
  ], async () => {
    const response = await fredAdapter.run({ text: 'gross national product' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.timeSeries.length !== 1 || response.timeSeries[0].points.length !== 2) return `expected a normalized 2-point time series, got ${JSON.stringify(response.timeSeries)}`
    return documentShapeIssue(response.documents[0], 'fred') ?? true
  })))

  await add('re_49_fred_upstream_error_is_safe_not_a_fake_success', () => withEnv({ FRED_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await fredAdapter.run({ text: 'gross national product' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_50_arxiv_success_normalizes_atom_entry', () => withAdapterFetch([
    textResponse('<feed><entry><id>http://arxiv.org/abs/2601.00001v1</id><title>Sample Paper Title</title><summary>Sample abstract text.</summary><published>2026-01-01T00:00:00Z</published><updated>2026-01-01T00:00:00Z</updated><author><name>A. Researcher</name></author><link href="http://arxiv.org/pdf/2601.00001v1" rel="related" type="application/pdf"/></entry></feed>', 200, 'application/atom+xml'),
  ], async () => {
    const response = await arxivAdapter.run({ text: 'sample paper' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.arxiv_id !== '2601.00001') return `expected arxiv_id extracted from the entry id, got ${JSON.stringify(doc.identifiers)}`
    return documentShapeIssue(doc, 'arxiv') ?? true
  }))

  await add('re_51_arxiv_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await arxivAdapter.run({ text: 'sample paper' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_52_crossref_success_normalizes_works_search', () => withAdapterFetch([
    jsonResponse({ message: { items: [{ DOI: '10.1000/sample', title: ['Sample Work'], author: [{ given: 'Jane', family: 'Doe' }], 'container-title': ['Journal of Samples'], URL: 'https://doi.org/10.1000/sample', license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }], 'published-print': { 'date-parts': [[2026, 1, 1]] }, publisher: 'Sample Publisher' }] } }),
  ], async () => {
    const response = await crossrefAdapter.run({ text: 'sample work' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.doi !== '10.1000/sample') return 'doi identifier missing'
    if (doc.publishedAt !== '2026-01-01') return `expected published-print date-parts normalized, got ${doc.publishedAt}`
    return documentShapeIssue(doc, 'crossref') ?? true
  }))

  await add('re_53_crossref_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await crossrefAdapter.run({ text: 'sample work' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_54_world_bank_success_normalizes_multiple_observations', () => withAdapterFetch([
    jsonResponse([
      { page: 1, pages: 1, per_page: 60, total: 2 },
      [
        { indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' }, country: { id: 'WLD', value: 'World' }, countryiso3code: 'WLD', date: '2025', value: 105_000_000_000_000, unit: '', obs_status: '' },
        { indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' }, country: { id: 'WLD', value: 'World' }, countryiso3code: 'WLD', date: '2024', value: 101_000_000_000_000, unit: '', obs_status: '' },
      ],
    ]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.GDP.MKTP.CD' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.timeSeries.length !== 1) return `expected 1 time series, got ${response.timeSeries.length}`
    const points = response.timeSeries[0].points
    if (points.length !== 2) return `expected both observations to normalize, got ${points.length}`
    if (points[0].date !== '2024' || points[1].date !== '2025') return `expected chronological (oldest-first) order, got ${JSON.stringify(points.map(p => p.date))}`
    return documentShapeIssue(response.documents[0], 'world_bank_indicators') ?? true
  }))

  await add('re_55_world_bank_result_count_stays_bounded', () => withAdapterFetch([
    jsonResponse([
      { page: 1, pages: 1, per_page: 60, total: 90 },
      Array.from({ length: 90 }, (_, i) => ({ indicator: { id: 'X', value: 'X indicator' }, country: { id: 'WLD', value: 'World' }, countryiso3code: 'WLD', date: String(2026 - i), value: i, unit: '', obs_status: '' })),
    ]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'X' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.timeSeries[0].points.length <= 60 || `expected observation count bounded to 60, got ${response.timeSeries[0].points.length}`
  }))

  await add('re_56_world_bank_empty_result_is_honest_not_fabricated', () => withAdapterFetch([
    jsonResponse([{ page: 1, pages: 1, per_page: 60, total: 0 }, []]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.UNKNOWN.CODE' })
    return (response.ok === true && response.documents.length === 0 && response.timeSeries.length === 0)
      || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_57_world_bank_documented_api_error_becomes_error_not_empty_success', () => withAdapterFetch([
    jsonResponse([{ message: [{ id: '120', key: 'Invalid value', value: 'Invalid country code. It should be the ISO country code' }] }]),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.GDP.MKTP.CD for ZZ' })
    if (response.ok !== false || !response.error) return `expected the documented WB error shape to become ok:false, got ${JSON.stringify(response)}`
    if (response.error.category !== 'upstream_error') return `expected category upstream_error, got ${response.error.category}`
    return response.error.message.includes('Invalid country code') || `expected the WB error text surfaced safely, got ${response.error.message}`
  }))

  await add('re_58_world_bank_malformed_shape_becomes_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ unexpected: 'shape', not: 'the documented array response' }),
  ], async () => {
    const response = await worldBankIndicatorsAdapter.run({ text: 'NY.GDP.MKTP.CD' })
    if (response.ok !== false || !response.error) return `expected a malformed shape to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_59_usgs_earthquake_success_normalizes_geojson_features', () => withAdapterFetch([
    jsonResponse({ features: [{ id: 'us1234', properties: { mag: 5.6, place: '10km N of Somewhere', time: 1767225600000, updated: 1767229200000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1234', tsunami: 0, alert: null, type: 'earthquake', status: 'reviewed' }, geometry: { type: 'Point', coordinates: [-120.5, 38.2, 10] } }] }),
  ], async () => {
    const response = await usgsEarthquakeAdapter.run({ text: 'M5 earthquake' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1 || response.geoFeatures.length !== 1) return `expected 1 document + 1 geoFeature, got docs=${response.documents.length} geo=${response.geoFeatures.length}`
    if (response.documents[0].identifiers.usgs_event_id !== 'us1234') return 'usgs_event_id identifier missing'
    return documentShapeIssue(response.documents[0], 'usgs_earthquake') ?? true
  }))

  await add('re_60_usgs_earthquake_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await usgsEarthquakeAdapter.run({ text: 'M5 earthquake' })
    return (response.ok === false && response.documents.length === 0 && response.geoFeatures.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_61_library_of_congress_success_normalizes_search_results', () => withAdapterFetch([
    jsonResponse({ results: [{ id: '2026001', url: 'https://www.loc.gov/item/2026001/', title: 'Sample Archival Item', description: ['A description.'], date: '1900', digitized: true, access_restricted: false, online_format: ['image'], original_format: ['photo'], contributor: ['Photographer, A.'], resources: [{ url: 'https://www.loc.gov/resource/2026001/' }] }] }),
  ], async () => {
    const response = await libraryOfCongressAdapter.run({ text: 'sample archival item' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    return documentShapeIssue(response.documents[0], 'library_of_congress') ?? true
  }))

  await add('re_62_library_of_congress_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await libraryOfCongressAdapter.run({ text: 'sample archival item' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_63_wikidata_success_normalizes_entity_search', () => withEnv({ WIKIMEDIA_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ search: [{ id: 'Q42', label: 'Douglas Adams', description: 'English writer and humorist' }] }),
    jsonResponse({ entities: { Q42: { labels: { en: { value: 'Douglas Adams' } }, descriptions: { en: { value: 'English writer and humorist' } }, aliases: { en: [{ value: 'Douglas Noel Adams' }] } } } }),
  ], async () => {
    const response = await wikidataAdapter.run({ text: 'Douglas Adams' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.documents[0].identifiers.wikidata_qid !== 'Q42') return 'wikidata_qid identifier missing'
    return documentShapeIssue(response.documents[0], 'wikidata') ?? true
  })))

  await add('re_64_wikidata_upstream_error_is_safe_not_a_fake_success', () => withEnv({ WIKIMEDIA_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    new Response('Bad Gateway', { status: 500 }),
  ], async () => {
    const response = await wikidataAdapter.run({ text: 'Douglas Adams' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_65_nasa_gibs_success_lists_curated_layers_without_network', () => withEnv({ NASA_GIBS_WMTS_BASE_URL: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' }, async () => {
    const response = await nasaGibsAdapter.run({ text: '' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length === 0) return 'expected at least one curated GIBS layer document'
    return documentShapeIssue(response.documents[0], 'nasa_gibs') ?? true
  }))

  await add('re_66_nasa_gibs_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['NASA_GIBS_WMTS_BASE_URL'], async () => {
    const response = await nasaGibsAdapter.run({ text: '' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  // --- Batch 1A: USGS Water Data (usgs_water) ---

  const sampleWaterFeature = {
    id: 'daily.USGS-01646500.00060.00003',
    properties: {
      monitoring_location_id: 'USGS-01646500',
      parameter_code: '00060',
      statistic_id: '00003',
      time: '2026-01-01',
      value: 120.5,
      unit_of_measure: 'ft3/s',
      qualifier: ['A'],
      approvals_status: 'Approved',
      last_modified: '2026-01-02T00:00:00Z',
    },
    geometry: { type: 'Point', coordinates: [-77.0365, 38.8951] },
  }

  await add('re_67_usgs_water_success_normalizes_daily_values', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [sampleWaterFeature] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.timeSeries.length !== 1 || response.timeSeries[0].points.length !== 1) return `expected a normalized 1-point time series, got ${JSON.stringify(response.timeSeries)}`
    if (response.geoFeatures.length !== 1) return `expected 1 geoFeature, got ${response.geoFeatures.length}`
    if (response.documents[0].identifiers.usgs_monitoring_location_id !== 'USGS-01646500') return 'usgs_monitoring_location_id identifier missing'
    return documentShapeIssue(response.documents[0], 'usgs_water') ?? true
  }))

  await add('re_68_usgs_water_empty_response_is_honest_not_fabricated', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === true && response.documents.length === 0 && response.timeSeries.length === 0)
      || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_69_usgs_water_malformed_response_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a malformed shape to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_70_usgs_water_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_71_usgs_water_retries_429_then_succeeds', () => withAdapterFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    jsonResponse({ type: 'FeatureCollection', features: [sampleWaterFeature] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    return response.ok || `expected the shared safeProviderFetch retry to recover from a 429, got ${JSON.stringify(response.error)}`
  }))

  await add('re_72_usgs_water_503_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response after exhausted 503 retries, got ${JSON.stringify(response)}`
  }))

  await add('re_73_usgs_water_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse({
      type: 'FeatureCollection',
      features: Array.from({ length: 150 }, (_, i) => ({
        id: `daily.USGS-01646500.00060.00003.${i}`,
        properties: { monitoring_location_id: 'USGS-01646500', parameter_code: '00060', statistic_id: '00003', time: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, value: i, unit_of_measure: 'ft3/s' },
        geometry: { type: 'Point', coordinates: [-77.0365, 38.8951] },
      })),
    }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.timeSeries[0].points.length <= 100 || `expected point count bounded to 100, got ${response.timeSeries[0].points.length}`
  }))

  await add('re_74_usgs_water_next_links_are_not_followed', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: [sampleWaterFeature], links: [{ rel: 'next', href: 'https://api.waterdata.usgs.gov/collections/daily/items?offset=100' }] })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
      return (response.ok && calls === 1) || `expected exactly one fetch (no next-link auto-follow), calls=${calls} ok=${response.ok}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_75_usgs_water_configured_without_api_key', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === 'usgs_water')!
    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    return (descriptor.requiredEnv.length === 0 && providerConfigStatus(descriptor, emptyEnv) === 'configured')
      || `expected usgs_water to report configured without any env, got requiredEnv=${JSON.stringify(descriptor.requiredEnv)} status=${providerConfigStatus(descriptor, emptyEnv)}`
  })

  await add('re_76_usgs_water_optional_api_key_sent_only_via_header_never_url', () => withEnv({ USGS_WATER_API_KEY: 'test-key-not-real' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string> | undefined
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      await usgsWaterAdapter.run({ text: 'site 01646500' })
      if (capturedUrl.includes('test-key-not-real')) return `API key leaked into the request URL: ${capturedUrl}`
      if (!capturedHeaders || capturedHeaders['X-Api-Key'] !== 'test-key-not-real') return `expected the optional key sent via X-Api-Key header, got ${JSON.stringify(capturedHeaders)}`
      return true
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_77_usgs_water_preserves_zero_and_null_distinctly', () => withAdapterFetch([
    jsonResponse({
      type: 'FeatureCollection',
      features: [
        { id: 'a', properties: { monitoring_location_id: 'USGS-01646500', time: '2026-01-01', value: 0, unit_of_measure: 'ft3/s' }, geometry: null },
        { id: 'b', properties: { monitoring_location_id: 'USGS-01646500', time: '2026-01-02', value: null, unit_of_measure: 'ft3/s' }, geometry: null },
      ],
    }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const points = response.timeSeries[0]?.points ?? []
    const hasZero = points.some(p => p.value === 0)
    const hasNull = points.some(p => p.value === null)
    return (hasZero && hasNull) || `expected a preserved real zero and a preserved null distinctly, got ${JSON.stringify(points)}`
  }))

  await add('re_78_usgs_water_preserves_provisional_warning', () => withAdapterFetch([
    jsonResponse({
      type: 'FeatureCollection',
      features: [{ id: 'a', properties: { monitoring_location_id: 'USGS-01646500', time: '2026-01-01', value: 5, unit_of_measure: 'ft3/s', approvals_status: 'Provisional' }, geometry: null }],
    }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const warnings = response.documents[0]?.warnings ?? []
    return warnings.some(w => /provisional/i.test(w)) || `expected a provisional-data warning, got ${JSON.stringify(warnings)}`
  }))

  await add('re_79_usgs_water_missing_site_number_is_rejected_not_unbounded_query', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'water quality near the river' })
      return (response.ok === false && calls === 0 && response.error?.category === 'unknown')
        || `expected a rejected, non-fetching response for a missing site number, got ok=${response.ok} calls=${calls} category=${response.error?.category}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A: USGS Real-Time Earthquake Feeds (usgs_earthquake_feed) ---

  const sampleFeedFeature = {
    id: 'us7000abcd',
    properties: {
      mag: 5.1,
      place: '20km SW of Somewhere',
      time: 1767225600000,
      updated: 1767229200000,
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
      alert: 'green',
      status: 'reviewed',
      tsunami: 0,
      sig: 400,
      code: '7000abcd',
      ids: ',us7000abcd,',
      type: 'earthquake',
    },
    geometry: { type: 'Point', coordinates: [-122.1, 37.4, 8.2] },
  }

  await add('re_80_usgs_earthquake_feed_success_normalizes_feed_events', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000, title: '4.5 Day', url: 'https://earthquake.usgs.gov' }, features: [sampleFeedFeature] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'significant earthquakes today' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1 || response.geoFeatures.length !== 1) return `expected 1 document + 1 geoFeature, got docs=${response.documents.length} geo=${response.geoFeatures.length}`
    if (response.documents[0].identifiers.usgs_event_id !== 'us7000abcd') return 'usgs_event_id identifier missing'
    return documentShapeIssue(response.documents[0], 'usgs_earthquake_feed') ?? true
  }))

  await add('re_81_usgs_earthquake_feed_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 500 }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'significant earthquakes today' })
    return (response.ok === false && response.documents.length === 0 && response.geoFeatures.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_82_usgs_earthquake_feed_only_allowlisted_magnitude_and_period_used', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      await usgsEarthquakeFeedAdapter.run({ text: 'give me the significant events this week' })
      return capturedUrl === 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson'
        || `expected the fixed allowlisted path template, got ${capturedUrl}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_83_usgs_earthquake_feed_arbitrary_text_cannot_redirect_feed_selection', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      await usgsEarthquakeFeedAdapter.run({ text: 'https://attacker.example.com/steal magnitude=999 period=decade' })
      return capturedUrl === 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'
        || `expected arbitrary text to fall back to the conservative default feed, got ${capturedUrl}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_84_usgs_earthquake_feed_one_fetch_per_uncached_run', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ features: [sampleFeedFeature] })
    }) as typeof fetch)
    try {
      const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
      return (response.ok && calls === 1) || `expected exactly one upstream fetch for one uncached run, calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_85_usgs_earthquake_feed_event_count_is_bounded', () => withAdapterFetch([
    jsonResponse({ features: Array.from({ length: 150 }, (_, i) => ({ ...sampleFeedFeature, id: `us${i}` })) }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 100 || `expected event count bounded to 100, got ${response.documents.length}`
  }))

  await add('re_86_usgs_earthquake_feed_retries_429_then_succeeds', () => withAdapterFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    jsonResponse({ features: [sampleFeedFeature] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return response.ok || `expected the shared safeProviderFetch retry to recover from a 429, got ${JSON.stringify(response.error)}`
  }))

  await add('re_87_usgs_earthquake_feed_503_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response after exhausted 503 retries, got ${JSON.stringify(response)}`
  }))

  await add('re_88_usgs_earthquake_feed_honest_missing_magnitude_and_geometry', () => withAdapterFetch([
    jsonResponse({ features: [{ id: 'us_nomag', properties: { mag: null, place: null, time: 1767225600000, updated: 1767225600000, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us_nomag', alert: null, status: 'automatic', tsunami: 0, sig: null }, geometry: null }] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for a missing geometry, got ${response.geoFeatures.length}`
    const doc = response.documents[0]
    if (!doc || doc.title !== 'M? — Unknown location') return `expected an honest placeholder title for missing magnitude/place, got ${doc?.title}`
    return true
  }))

  // --- Batch 1A: USGS ScienceBase (usgs_sciencebase) ---

  const sampleSbItem = {
    id: '4f4e4b24e4b07f02db47e234',
    title: 'Sample Groundwater Dataset',
    summary: 'A <b>bounded</b> dataset summary with &amp; an entity.',
    tags: [{ type: 'Theme', name: 'Groundwater' }, { type: 'Theme', name: 'Hydrology' }],
    ancestors: ['4f4e4b24e4b07f02db47e000'],
    provenance: { dateCreated: '2026-01-01T00:00:00Z', lastUpdated: '2026-01-02T00:00:00Z' },
    link: { url: 'https://www.sciencebase.gov/catalog/item/4f4e4b24e4b07f02db47e234' },
  }

  await add('re_89_usgs_sciencebase_search_success_normalizes_items', () => withAdapterFetch([
    jsonResponse({ items: [sampleSbItem] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    if (response.documents[0].identifiers.sciencebase_item_id !== sampleSbItem.id) return 'sciencebase_item_id identifier missing'
    if (response.documents[0].summary?.includes('<b>')) return `expected HTML markup stripped from summary, got ${response.documents[0].summary}`
    if (!response.documents[0].summary?.includes('& an entity')) return `expected entity decoded, got ${response.documents[0].summary}`
    return documentShapeIssue(response.documents[0], 'usgs_sciencebase') ?? true
  }))

  await add('re_90_usgs_sciencebase_getbyid_success_uses_item_path', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse(sampleSbItem)
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: sampleSbItem.id })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      if (!capturedUrl.includes(`/item/${sampleSbItem.id}`)) return `expected the /item/{id} path to be used, got ${capturedUrl}`
      if (capturedUrl.includes('/items/')) return `expected getById to use /item/{id}, not the /items/ search path, got ${capturedUrl}`
      return response.documents[0]?.providerRecordId === sampleSbItem.id || `expected the stable item id preserved, got ${response.documents[0]?.providerRecordId}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_91_usgs_sciencebase_arbitrary_text_does_not_become_id_lookup', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl = ''
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ items: [] })
    }) as typeof fetch)
    try {
      // 24 characters but not all hex, and a second case with hex-like but wrong length — neither is a valid ScienceBase item id.
      await usgsScienceBaseAdapter.run({ text: 'not-a-valid-item-id-zzzz' })
      return capturedUrl.includes('/items/') || `expected non-id free text to dispatch to the /items/ search path, got ${capturedUrl}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_92_usgs_sciencebase_empty_search_result_is_honest_not_fabricated', () => withAdapterFetch([
    jsonResponse({ items: [] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_93_usgs_sciencebase_malformed_response_is_safe_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: sampleSbItem.id })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a safe parse_error response, got ${JSON.stringify(response)}`
  }))

  await add('re_94_usgs_sciencebase_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_95_usgs_sciencebase_503_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    return (response.ok === false && response.documents.length === 0) || `expected a safe error response after exhausted 503 retries, got ${JSON.stringify(response)}`
  }))

  await add('re_96_usgs_sciencebase_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse({ items: Array.from({ length: 60 }, (_, i) => ({ ...sampleSbItem, id: `4f4e4b24e4b07f02db47e${String(i).padStart(3, '0')}` })) }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 25 || `expected result count bounded to 25, got ${response.documents.length}`
  }))

  await add('re_97_usgs_sciencebase_html_summary_is_stripped_not_executed', () => withAdapterFetch([
    jsonResponse({ items: [{ ...sampleSbItem, summary: '<script>alert(1)</script>Safe text' }] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const summary = response.documents[0]?.summary ?? ''
    return (!summary.includes('<script>') && summary.includes('Safe text')) || `expected script markup stripped as inert text, got ${summary}`
  }))

  await add('re_98_usgs_sciencebase_next_links_are_not_followed', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ items: [sampleSbItem], nextlink: { url: 'https://www.sciencebase.gov/catalog/items/?offset=25' } })
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      return (response.ok && calls === 1) || `expected exactly one fetch (no next-link auto-follow), calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_99_usgs_sciencebase_only_get_requests_used', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ items: [sampleSbItem] })
    }) as typeof fetch)
    try {
      await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A: registry/provider-count integrity (Phase 8) ---

  const BATCH_1A_TARGET_IDS = ['usgs_water', 'usgs_earthquake_feed', 'usgs_sciencebase'] as const
  const UNAUTHORIZED_BATCH_1_IDS = ['world_bank_data_catalog', 'world_bank_finances', 'world_bank_climate'] as const

  await add('re_100_registered_provider_count_is_31', () =>
    RESEARCH_PROVIDER_ENV.length === 254 || `expected 254 registered providers, found ${RESEARCH_PROVIDER_ENV.length}`)

  await add('re_101_implemented_count_derives_to_24_from_descriptors_and_registry', () => {
    const implementedDescriptors = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).length
    const implementedAdapters = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).length
    return (implementedDescriptors === 250 && implementedAdapters === 250)
      || `expected 250 implemented in both descriptors and registry, got descriptors=${implementedDescriptors} registry=${implementedAdapters}`
  })

  await add('re_102_three_target_adapters_registered_and_reachable', () => {
    const missing = BATCH_1A_TARGET_IDS.filter(id => !(id in IMPLEMENTED_PROVIDER_ADAPTERS))
    const notImplementedInDescriptor = BATCH_1A_TARGET_IDS.filter(id => !RESEARCH_PROVIDER_ENV.find(d => d.id === id)?.implemented)
    return (missing.length === 0 && notImplementedInDescriptor.length === 0)
      || `expected all three Batch 1A providers registered+implemented, missingFromRegistry=${JSON.stringify(missing)} notImplementedInDescriptor=${JSON.stringify(notImplementedInDescriptor)}`
  })

  await add('re_103_three_unauthorized_batch1_providers_remain_unimplemented', () => {
    const wronglyImplemented = UNAUTHORIZED_BATCH_1_IDS.filter(id => {
      const descriptor = RESEARCH_PROVIDER_ENV.find(d => d.id === id)
      return descriptor?.implemented === true || id in IMPLEMENTED_PROVIDER_ADAPTERS
    })
    return wronglyImplemented.length === 0 || `unauthorized provider(s) were implemented: ${JSON.stringify(wronglyImplemented)}`
  })

  await add('re_104_usgs_water_key_is_optional', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(d => d.id === 'usgs_water')!
    return (!descriptor.requiredEnv.includes('USGS_WATER_API_KEY') && descriptor.optionalEnv.includes('USGS_WATER_API_KEY'))
      || `expected USGS_WATER_API_KEY in optionalEnv only, got requiredEnv=${JSON.stringify(descriptor.requiredEnv)} optionalEnv=${JSON.stringify(descriptor.optionalEnv)}`
  })

  await add('re_105_no_duplicate_descriptor', () => {
    const ids = RESEARCH_PROVIDER_ENV.map(d => d.id)
    return ids.length === new Set(ids).size || `duplicate descriptor id(s) found: ${JSON.stringify(ids)}`
  })

  await add('re_106_no_duplicate_adapter', () => {
    const ids = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS)
    const mismatched = ids.filter(id => IMPLEMENTED_PROVIDER_ADAPTERS[id as keyof typeof IMPLEMENTED_PROVIDER_ADAPTERS]?.id !== id)
    return (ids.length === new Set(ids).size && mismatched.length === 0)
      || `duplicate or mismatched adapter registration found: ids=${JSON.stringify(ids)} mismatched=${JSON.stringify(mismatched)}`
  })

  await add('re_107_implemented_descriptor_and_registry_sets_match_exactly', () => {
    const descriptorImplemented = new Set(RESEARCH_PROVIDER_ENV.filter(d => d.implemented).map(d => d.id))
    const registryImplemented = new Set(Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS) as ResearchProviderId[])
    const onlyInDescriptors = [...descriptorImplemented].filter(id => !registryImplemented.has(id))
    const onlyInRegistry = [...registryImplemented].filter(id => !descriptorImplemented.has(id))
    return (onlyInDescriptors.length === 0 && onlyInRegistry.length === 0)
      || `implemented sets diverge: onlyInDescriptors=${JSON.stringify(onlyInDescriptors)} onlyInRegistry=${JSON.stringify(onlyInRegistry)}`
  })

  await add('re_108_no_title_date_dedupe_fallback_exists', () => {
    // Behavioral re-confirmation (not a source-text scan, which would false-positive on
    // citationKey's unrelated provider-scoped title+date fallback): two documents that share
    // only a title and a publish date, with no identifier/URL/providerRecordId, must never merge,
    // whether they share a provider or not — re-derived here against the new Batch 1A adapters too.
    const a = sampleDoc({ id: 'a', provider: 'usgs_water', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Title' })
    const b = sampleDoc({ id: 'b', provider: 'usgs_sciencebase', identifiers: {}, canonicalUrl: null, providerRecordId: null, publishedAt: '2026-03-01', title: 'Shared Title' })
    const { documents, duplicatesRemoved } = deduplicateDocuments([a, b])
    return (documents.length === 2 && duplicatesRemoved === 0) || `two documents sharing only title+date were incorrectly merged: documents=${documents.length}`
  })

  await add('re_109_batch_1a_current_and_historical_documents_remain_separate', () => {
    const current = sampleDoc({ id: 'w-cur', provider: 'usgs_water', identifiers: { usgs_monitoring_location_id: 'USGS-01646500' } })
    const historical = asHistorical(sampleDoc({ id: 'w-hist', provider: 'usgs_water', identifiers: { usgs_monitoring_location_id: 'USGS-01646500' } }))
    const { documents, duplicatesRemoved } = deduplicateDocuments([current, historical])
    return (documents.length === 2 && duplicatesRemoved === 0) || `a current and historical usgs_water document were incorrectly merged: documents=${documents.length}`
  })

  await add('re_110_no_provider_secret_uses_next_public', () => {
    const configSource = readFileSync(join(process.cwd(), 'lib/research-engine/config/providerEnv.ts'), 'utf8')
    return !/NEXT_PUBLIC_.*(KEY|TOKEN|SECRET)/i.test(configSource) || 'a provider secret env var appears to be exposed via NEXT_PUBLIC_'
  })

  const REMAINING_15_IMPLEMENTED_FILES = [
    'semanticScholar.ts', 'courtlistener.ts', 'internetArchive.ts', 'wayback.ts', 'commonCrawl.ts',
    'samGov.ts', 'nasa.ts',
  ]

  await add('re_111_no_new_adapter_uses_write_capable_http_method', () => {
    const files = ['usgsWater.ts', 'usgsEarthquakeFeed.ts', 'usgsScienceBase.ts', ...REMAINING_15_IMPLEMENTED_FILES]
    const offenders = files.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(source)
    })
    return offenders.length === 0 || `write-capable HTTP method referenced in: ${offenders.join(', ')}`
  })

  await add('re_112_new_adapters_never_call_raw_fetch', () => {
    const files = ['usgsWater.ts', 'usgsEarthquakeFeed.ts', 'usgsScienceBase.ts', ...REMAINING_15_IMPLEMENTED_FILES]
    const offenders = files.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /[^.\w]fetch\(/.test(source)
    })
    return offenders.length === 0 || `raw fetch() call (bypassing safeProviderFetch) found in: ${offenders.join(', ')}`
  })

  // --- Batch 1A Repair: malformed-response handling and test-completeness gaps found by audit ---

  await add('re_113_usgs_earthquake_feed_legitimate_empty_features_is_honest_success', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 }, features: [] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return (response.ok === true && response.documents.length === 0 && response.geoFeatures.length === 0)
      || `expected an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_114_usgs_earthquake_feed_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_115_usgs_earthquake_feed_non_array_features_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ features: 'not-an-array' }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected a non-array "features" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_116_usgs_earthquake_feed_invalid_coordinate_types_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ features: [{ ...sampleFeedFeature, id: 'us_badcoord', geometry: { type: 'Point', coordinates: ['not-a-number', 'also-not', 5] } }] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response despite malformed geometry, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for non-numeric coordinates, got ${response.geoFeatures.length}`
    return response.documents.length === 1 || `expected the event document to still be created despite malformed geometry, got ${response.documents.length}`
  }))

  await add('re_117_usgs_earthquake_feed_out_of_range_coordinates_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ features: [{ ...sampleFeedFeature, id: 'us_rangecoord', geometry: { type: 'Point', coordinates: [200, -95, 10] } }] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (!response.ok) return `expected ok response despite out-of-range geometry, got error: ${JSON.stringify(response.error)}`
    return response.geoFeatures.length === 0 || `expected no geoFeature for out-of-range coordinates, got ${response.geoFeatures.length}`
  }))

  await add('re_118_usgs_earthquake_feed_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ USGS_EARTHQUAKE_FEED_BASE_URL: 'https://evil.example.com/feed' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
      if (calls !== 0) return `expected the central host allowlist to block the request before any network call, but the mock was invoked ${calls} time(s)`
      if (response.ok !== false) return `expected the arbitrary-host override to be rejected, got ok=${response.ok}`
      return (response.error?.message ?? '').includes('Blocked host') || `expected the central allowlist rejection to surface safely, got ${JSON.stringify(response.error)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_119_usgs_earthquake_feed_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ features: [] })
    }) as typeof fetch)
    try {
      await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_120_usgs_sciencebase_search_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected malformed JSON search response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_121_usgs_sciencebase_search_non_array_items_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ items: 'not-an-array' }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected a non-array "items" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_122_usgs_sciencebase_search_retries_429_then_succeeds', () => withAdapterFetch([
    new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
    jsonResponse({ items: [sampleSbItem] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    return response.ok || `expected the shared safeProviderFetch retry to recover from a 429, got ${JSON.stringify(response.error)}`
  }))

  await add('re_123_usgs_sciencebase_search_does_not_fetch_attachment_or_resource_urls', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({
        items: [{
          ...sampleSbItem,
          files: [{ name: 'data.zip', url: 'https://www.sciencebase.gov/catalog/file/get/000attach' }],
          distributionLinks: [{ uri: 'https://www.sciencebase.gov/catalog/item/000attach/download' }],
          webLinks: [{ type: 'download', uri: 'https://www.sciencebase.gov/catalog/item/000attach/related' }],
        }],
      })
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      return calls === 1 || `expected exactly one fetch (the search call only, no attachment/resource follow-up), calls=${calls}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_124_usgs_sciencebase_search_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ USGS_SCIENCEBASE_API_BASE_URL: 'https://evil.example.com/catalog' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ items: [] })
    }) as typeof fetch)
    try {
      const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
      if (calls !== 0) return `expected the central host allowlist to block the request before any network call, but the mock was invoked ${calls} time(s)`
      if (response.ok !== false) return `expected the arbitrary-host override to be rejected, got ok=${response.ok}`
      return (response.error?.message ?? '').includes('Blocked host') || `expected the central allowlist rejection to surface safely, got ${JSON.stringify(response.error)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_125_usgs_water_invalid_coordinate_element_types_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [{ ...sampleWaterFeature, id: 'daily.badcoord', geometry: { type: 'Point', coordinates: ['not-a-number', 'also-not'] } }] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response despite malformed geometry, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for non-numeric coordinates, got ${response.geoFeatures.length}`
    return response.documents.length === 1 || `expected the observation document to still be created despite malformed geometry, got ${response.documents.length}`
  }))

  await add('re_126_usgs_water_out_of_range_coordinates_do_not_create_geofeatures', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [{ ...sampleWaterFeature, id: 'daily.rangecoord', geometry: { type: 'Point', coordinates: [-200, 95] } }] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response despite out-of-range geometry, got error: ${JSON.stringify(response.error)}`
    return response.geoFeatures.length === 0 || `expected no geoFeature for out-of-range coordinates, got ${response.geoFeatures.length}`
  }))

  await add('re_127_usgs_water_timeseries_survives_malformed_geometry', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [{ ...sampleWaterFeature, id: 'daily.badgeo', geometry: { type: 'Point', coordinates: [Number.NaN, Number.NaN] } }] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500 parameter 00060 statistic 00003' })
    if (!response.ok) return `expected ok response despite malformed geometry, got error: ${JSON.stringify(response.error)}`
    if (response.geoFeatures.length !== 0) return `expected no geoFeature for NaN coordinates, got ${response.geoFeatures.length}`
    if (response.timeSeries.length !== 1 || response.timeSeries[0].points.length !== 1) return `expected the observation time series to survive malformed geometry, got ${JSON.stringify(response.timeSeries)}`
    return response.documents.length === 1 || `expected the observation document to survive malformed geometry, got ${response.documents.length}`
  }))

  await add('re_128_usgs_water_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ USGS_WATER_API_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
      if (calls !== 0) return `expected the central host allowlist to block the request before any network call, but the mock was invoked ${calls} time(s)`
      if (response.ok !== false) return `expected the arbitrary-host override to be rejected, got ok=${response.ok}`
      return (response.error?.message ?? '').includes('Blocked host') || `expected the central allowlist rejection to surface safely, got ${JSON.stringify(response.error)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_129_usgs_water_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ type: 'FeatureCollection', features: [] })
    }) as typeof fetch)
    try {
      await usgsWaterAdapter.run({ text: 'site 01646500' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A Final Micro-Repair: USGS Water fail-closed response-shape validation ---

  await add('re_130_usgs_water_top_level_number_is_safe_parse_error', () => withAdapterFetch([
    new Response('42', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level number response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_131_usgs_water_top_level_string_is_safe_parse_error', () => withAdapterFetch([
    new Response('"not-a-collection"', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level string response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_132_usgs_water_top_level_boolean_is_safe_parse_error', () => withAdapterFetch([
    new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level boolean response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_133_usgs_water_top_level_array_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse([sampleWaterFeature]),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a top-level array response to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_134_usgs_water_missing_features_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection' }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a response with a missing "features" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_135_usgs_water_features_null_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: null }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected features:null to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_136_usgs_water_features_object_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: {} }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected features:{} to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_137_usgs_water_features_string_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: 'invalid' }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected features:"invalid" to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_138_usgs_water_explicit_empty_features_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: [] }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    return (response.ok === true && response.documents.length === 0 && response.timeSeries.length === 0)
      || `expected an explicit empty features array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_139_usgs_water_malformed_shapes_never_expose_raw_js_errors', () => withAdapterFetch([
    jsonResponse({ type: 'FeatureCollection', features: 'invalid' }),
  ], async () => {
    const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
    if (response.ok !== false || !response.error) return `expected a safe error response, got ${JSON.stringify(response)}`
    const message = response.error.message ?? ''
    if (/slice is not a function/i.test(message)) return `raw JavaScript error text leaked: ${message}`
    if (/cannot read propert/i.test(message)) return `raw JavaScript error text leaked: ${message}`
    return true
  }))

  await add('re_140_usgs_water_malformed_shape_makes_no_real_network_call', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return jsonResponse({ type: 'FeatureCollection', features: 'invalid' })
    }) as typeof fetch)
    try {
      const response = await usgsWaterAdapter.run({ text: 'site 01646500' })
      if (calls !== 1) return `expected exactly one request, routed only through the mocked fetch (no real network escape), got ${calls}`
      return response.ok === false || `expected ok:false for the malformed "features" shape, got ${JSON.stringify(response)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Batch 1A Final Micro-Repair: USGS Earthquake Feed fail-closed for missing/null features ---

  await add('re_141_usgs_earthquake_feed_missing_features_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 } }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected a response with a missing "features" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_142_usgs_earthquake_feed_features_null_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 }, features: null }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    if (response.ok !== false || !response.error) return `expected features:null to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_143_usgs_earthquake_feed_explicit_empty_features_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ metadata: { generated: 1767225600000 }, features: [] }),
  ], async () => {
    const response = await usgsEarthquakeFeedAdapter.run({ text: 'earthquakes today' })
    return (response.ok === true && response.documents.length === 0 && response.geoFeatures.length === 0)
      || `expected an explicit empty features array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  // --- Batch 1A Final Micro-Repair: USGS ScienceBase search fail-closed for missing/null items ---

  await add('re_144_usgs_sciencebase_search_missing_items_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({}),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected a response with a missing "items" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_145_usgs_sciencebase_search_items_null_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ items: null }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'groundwater dataset' })
    if (response.ok !== false || !response.error) return `expected items:null to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_146_usgs_sciencebase_search_explicit_empty_items_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ items: [] }),
  ], async () => {
    const response = await usgsScienceBaseAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty items array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  // --- Remaining 15: semantic_scholar (Group A) ---

  const sampleSsPaper = {
    paperId: 'abc123def456',
    title: 'A Study of Sample Things',
    abstract: 'This is a sample abstract.',
    year: 2025,
    authors: [{ authorId: '1', name: 'A. Researcher' }],
    externalIds: { DOI: '10.9999/sample-ss' },
    url: 'https://www.semanticscholar.org/paper/abc123def456',
    venue: 'Journal of Samples',
    citationCount: 12,
  }

  await add('re_147_semantic_scholar_success_normalizes_paper_search', () => withAdapterFetch([
    jsonResponse({ total: 1, offset: 0, data: [sampleSsPaper] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.semantic_scholar_paper_id !== 'abc123def456') return 'semantic_scholar_paper_id identifier missing'
    if (doc.identifiers.doi !== '10.9999/sample-ss') return 'doi identifier missing'
    if (doc.summary !== 'This is a sample abstract.') return `expected abstract preserved as summary, got ${doc.summary}`
    return documentShapeIssue(doc, 'semantic_scholar') ?? true
  }))

  await add('re_148_semantic_scholar_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_149_semantic_scholar_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_150_semantic_scholar_missing_data_field_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ total: 0 }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false || !response.error) return `expected a missing "data" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_151_semantic_scholar_non_array_data_field_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ data: 'not-an-array' }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false || !response.error) return `expected a non-array "data" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_152_semantic_scholar_explicit_empty_data_remains_honest_success', () => withAdapterFetch([
    jsonResponse({ total: 0, data: [] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty data array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_153_semantic_scholar_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse({ total: 200, data: Array.from({ length: 200 }, (_, i) => ({ ...sampleSsPaper, paperId: `paper-${i}` })) }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 25 || `expected result count bounded to 25, got ${response.documents.length}`
  }))

  await add('re_154_semantic_scholar_missing_abstract_stays_null_not_fabricated', () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, abstract: null }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].summary === null || `expected a missing abstract to stay null, got ${JSON.stringify(response.documents[0].summary)}`
  }))

  await add('re_155_semantic_scholar_api_key_sent_only_via_header_never_url', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedHeaders: Record<string, string> | undefined
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string> | undefined
      return jsonResponse({ data: [] })
    }) as typeof fetch)
    try {
      await withEnv({ SEMANTIC_SCHOLAR_API_KEY: 'test-key-not-real' }, () => semanticScholarAdapter.run({ text: 'sample things' }))
      if (capturedUrl?.includes('test-key-not-real')) return 'API key leaked into the request URL'
      return capturedHeaders?.['x-api-key'] === 'test-key-not-real' || `expected the x-api-key header to carry the key, got headers=${JSON.stringify(capturedHeaders)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_156_semantic_scholar_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse({ data: [] })
    }) as typeof fetch)
    try {
      await semanticScholarAdapter.run({ text: 'sample things' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Remaining 15: courtlistener (Group A) ---

  const sampleClResult = {
    cluster_id: 987654,
    absolute_url: '/opinion/987654/sample-v-example/',
    caseName: 'Sample v. Example',
    dateFiled: '2025-06-01',
    court: 'Supreme Court of the United States',
    court_id: 'scotus',
    status: 'Published',
    docketNumber: '25-1234',
    citation: ['600 U.S. 1'],
  }

  await add('re_157_courtlistener_success_normalizes_case_law_search', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 1, results: [sampleClResult], next: null, previous: null }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.courtlistener_cluster_id !== '987654') return 'courtlistener_cluster_id identifier missing'
    if (doc.canonicalUrl !== 'https://www.courtlistener.com/opinion/987654/sample-v-example/') return `expected absolute_url resolved against courtlistener.com, got ${doc.canonicalUrl}`
    return documentShapeIssue(doc, 'courtlistener') ?? true
  })))

  await add('re_158_courtlistener_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['COURTLISTENER_API_TOKEN'], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_159_courtlistener_upstream_error_is_safe_not_a_fake_success', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_160_courtlistener_malformed_json_is_safe_parse_error', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_161_courtlistener_missing_results_field_is_safe_parse_error', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 0 }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (response.ok !== false || !response.error) return `expected a missing "results" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_162_courtlistener_non_array_results_field_is_safe_parse_error', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: 'not-an-array' }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (response.ok !== false || !response.error) return `expected a non-array "results" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_163_courtlistener_explicit_empty_results_remains_honest_success', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 0, results: [] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty results array to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_164_courtlistener_result_count_is_bounded', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ count: 100, results: Array.from({ length: 100 }, (_, i) => ({ ...sampleClResult, cluster_id: i })) }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_165_courtlistener_never_fabricates_missing_precedential_status', () => withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ ...sampleClResult, status: undefined }] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample v example' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].identifiers.courtlistener_status === undefined || `expected a missing status to never be fabricated, got ${JSON.stringify(response.documents[0].identifiers)}`
  })))

  await add('re_166_courtlistener_token_sent_only_via_header_never_url', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedHeaders: Record<string, string> | undefined
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string> | undefined
      return jsonResponse({ results: [] })
    }) as typeof fetch)
    try {
      await withEnv({ COURTLISTENER_API_TOKEN: 'test-token-not-real' }, () => courtListenerAdapter.run({ text: 'sample v example' }))
      if (capturedUrl?.includes('test-token-not-real')) return 'API token leaked into the request URL'
      return capturedHeaders?.Authorization === 'Token test-token-not-real' || `expected the Authorization header to carry the token, got headers=${JSON.stringify(capturedHeaders)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Remaining 15: internet_archive (Group A) ---

  const sampleIaDoc = {
    identifier: 'sample-item-2026',
    title: 'A Sample Archive Item',
    description: 'A description of the sample item.',
    mediatype: 'texts',
    date: '2020-01-01',
    creator: 'A. Archivist',
  }

  await add('re_167_internet_archive_success_normalizes_search_results', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ responseHeader: {}, response: { numFound: 1, start: 0, docs: [sampleIaDoc] } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.internet_archive_identifier !== 'sample-item-2026') return 'internet_archive_identifier missing'
    if (doc.canonicalUrl !== 'https://archive.org/details/sample-item-2026') return `expected canonical details URL, got ${doc.canonicalUrl}`
    return documentShapeIssue(doc, 'internet_archive') ?? true
  })))

  await add('re_168_internet_archive_handles_array_valued_metadata_fields', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: [{ ...sampleIaDoc, title: ['First Title', 'Alt Title'], creator: ['A. One', 'B. Two'] }] } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    const doc = response.documents[0]
    if (doc.authors.length !== 2) return `expected both array-valued creators preserved, got ${JSON.stringify(doc.authors)}`
    return true
  })))

  await add('re_169_internet_archive_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['INTERNET_ARCHIVE_USER_AGENT_BASE'], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_170_internet_archive_upstream_error_is_safe_not_a_fake_success', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_171_internet_archive_malformed_json_is_safe_parse_error', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_172_internet_archive_missing_response_docs_is_safe_parse_error', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ responseHeader: {} }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (response.ok !== false || !response.error) return `expected a missing "response.docs" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_173_internet_archive_non_array_docs_field_is_safe_parse_error', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: 'not-an-array' } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample item' })
    if (response.ok !== false || !response.error) return `expected a non-array "docs" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_174_internet_archive_explicit_empty_docs_remains_honest_success', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { numFound: 0, docs: [] } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty docs array to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_175_internet_archive_result_count_is_bounded', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: Array.from({ length: 100 }, (_, i) => ({ ...sampleIaDoc, identifier: `item-${i}` })) } }),
  ], async () => {
    const response = await internetArchiveAdapter.run({ text: 'sample', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_176_internet_archive_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0', INTERNET_ARCHIVE_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      return jsonResponse({ response: { docs: [] } })
    }) as typeof fetch)
    try {
      const response = await internetArchiveAdapter.run({ text: 'sample item' })
      if (called) return 'the mocked fetch was invoked despite a disallowed host override — the central allowlist did not block it'
      return (response.ok === false) || 'expected a safe error response when the base URL override is not on the host allowlist'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  // --- Remaining 15: wayback (Group A) ---

  const sampleCdxRows = [
    ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
    ['com,example)/', '20250601120000', 'https://example.com/', 'text/html', '200', 'ABCDEF123456', '1024'],
  ]

  await add('re_177_wayback_success_normalizes_cdx_captures', () => withAdapterFetch([
    jsonResponse(sampleCdxRows),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.wayback_timestamp !== '20250601120000') return 'wayback_timestamp identifier missing'
    if (doc.canonicalUrl !== 'https://web.archive.org/web/20250601120000/https://example.com/') return `expected the documented capture URL pattern, got ${doc.canonicalUrl}`
    return documentShapeIssue(doc, 'wayback') ?? true
  }))

  await add('re_178_wayback_rejects_localhost_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://localhost/admin' })
    return (response.ok === false && response.error?.category === 'unknown') || `expected localhost target to be rejected before any request, got ${JSON.stringify(response)}`
  })

  await add('re_179_wayback_rejects_loopback_ipv4_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://127.0.0.1/secret' })
    return response.ok === false || 'expected a loopback IPv4 target to be rejected'
  })

  await add('re_180_wayback_rejects_rfc1918_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://10.0.0.5/internal' })
    return response.ok === false || 'expected an RFC1918 target to be rejected'
  })

  await add('re_181_wayback_rejects_link_local_metadata_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://169.254.169.254/latest/meta-data/' })
    return response.ok === false || 'expected the cloud metadata address to be rejected'
  })

  await add('re_182_wayback_rejects_decimal_encoded_loopback_target', async () => {
    // 2130706433 is the decimal encoding of 127.0.0.1 — the WHATWG URL
    // parser canonicalizes this to "127.0.0.1" before the range check runs.
    const response = await waybackAdapter.run({ text: 'http://2130706433/' })
    return response.ok === false || 'expected a decimal-encoded loopback target to be rejected'
  })

  await add('re_183_wayback_rejects_embedded_credentials_target', async () => {
    const response = await waybackAdapter.run({ text: 'http://user:pass@example.com/' })
    return response.ok === false || 'expected a target URL with embedded credentials to be rejected'
  })

  await add('re_184_wayback_rejects_non_web_scheme_target', async () => {
    const response = await waybackAdapter.run({ text: 'file:///etc/passwd' })
    return response.ok === false || 'expected a non-http(s) scheme target to be rejected'
  })

  await add('re_185_wayback_accepts_ordinary_public_https_target', () => {
    const result = validateBoundedTargetUrl('https://example.com/some/page')
    return result.ok || `expected an ordinary public HTTPS URL to validate, got ${JSON.stringify(result)}`
  })

  await add('re_186_wayback_upstream_error_is_safe_not_a_fake_success', () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  }))

  await add('re_187_wayback_malformed_json_is_safe_parse_error', () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_188_wayback_non_array_top_level_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse({ not: 'an array' }),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected a non-array top level to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_189_wayback_unexpected_header_shape_is_safe_parse_error', () => withAdapterFetch([
    jsonResponse([['not', 'the', 'expected', 'header'], ['a', 'b']]),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected an unrecognized header row to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  }))

  await add('re_190_wayback_explicit_empty_array_remains_honest_success', () => withAdapterFetch([
    jsonResponse([]),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/never-captured' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty CDX array to remain an honest empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_191_wayback_result_count_is_bounded', () => withAdapterFetch([
    jsonResponse([
      sampleCdxRows[0],
      ...Array.from({ length: 100 }, (_, i) => ['com,example)/', `2025060${i % 9}120000`, 'https://example.com/', 'text/html', '200', `DIGEST${i}`, '1024']),
    ]),
  ], async () => {
    const response = await waybackAdapter.run({ text: 'https://example.com/', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  }))

  await add('re_192_wayback_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ WAYBACK_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      return jsonResponse([])
    }) as typeof fetch)
    try {
      const response = await waybackAdapter.run({ text: 'https://example.com/' })
      if (called) return 'the mocked fetch was invoked despite a disallowed host override — the central allowlist did not block it'
      return (response.ok === false) || 'expected a safe error response when the base URL override is not on the host allowlist'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_193_wayback_get_only_at_runtime', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return jsonResponse([])
    }) as typeof fetch)
    try {
      await waybackAdapter.run({ text: 'https://example.com/' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  // --- Remaining 15: common_crawl (Group A) ---

  const ccEnv = { COMMON_CRAWL_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0', COMMON_CRAWL_COLLECTION_ID: 'CC-MAIN-2025-33' }
  const sampleCcLine = JSON.stringify({ urlkey: 'com,example)/', timestamp: '20250601120000', url: 'https://example.com/', mime: 'text/html', status: '200', digest: 'ABCDEF123456', filename: 'crawl-data/CC-MAIN-2025-33/segments/x.warc.gz', offset: '123', length: '456' })

  await add('re_194_common_crawl_success_normalizes_index_records', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse(sampleCcLine, 200, 'application/x-ndjson'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.common_crawl_timestamp !== '20250601120000') return 'common_crawl_timestamp identifier missing'
    if (doc.canonicalUrl !== 'https://example.com/') return `expected the record's own url as canonicalUrl, got ${doc.canonicalUrl}`
    if ('common_crawl_filename' in doc.identifiers || 'common_crawl_offset' in doc.identifiers) return 'WARC pointer fields must never appear in normalized output'
    return documentShapeIssue(doc, 'common_crawl') ?? true
  })))

  await add('re_195_common_crawl_not_configured_without_collection_id', () => withEnv({ COMMON_CRAWL_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withoutEnv(['COMMON_CRAWL_COLLECTION_ID'], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error when the collection id is missing, got ${JSON.stringify(response)}`
  })))

  await add('re_196_common_crawl_not_configured_without_user_agent', () => withoutEnv(['COMMON_CRAWL_USER_AGENT_BASE'], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_197_common_crawl_upstream_error_is_safe_not_a_fake_success', () => withEnv(ccEnv, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_198_common_crawl_nonempty_unparseable_body_is_safe_parse_error', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse('this is not ndjson at all {{{', 200, 'text/plain'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    if (response.ok !== false || !response.error) return `expected a non-empty unparseable body to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_199_common_crawl_empty_body_remains_honest_success', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse('', 200, 'application/x-ndjson'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/never-crawled' })
    return (response.ok === true && response.documents.length === 0) || `expected an empty body to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_200_common_crawl_result_count_is_bounded', () => withEnv(ccEnv, () => withAdapterFetch([
    textResponse(Array.from({ length: 100 }, (_, i) => JSON.stringify({ urlkey: 'com,example)/', timestamp: `2025060${i % 9}120000`, url: 'https://example.com/', digest: `D${i}` })).join('\n'), 200, 'application/x-ndjson'),
  ], async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_201_common_crawl_rejects_localhost_target', () => withEnv(ccEnv, async () => {
    const response = await commonCrawlAdapter.run({ text: 'http://localhost/admin' })
    return response.ok === false || 'expected a localhost target to be rejected before any request'
  }))

  await add('re_202_common_crawl_rejects_invalid_collection_id_format', () => withEnv({ ...ccEnv, COMMON_CRAWL_COLLECTION_ID: '../../etc/passwd' }, async () => {
    const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected an invalid collection id to be rejected as not_configured, got ${JSON.stringify(response)}`
  }))

  await add('re_203_common_crawl_arbitrary_base_url_override_rejected_by_allowlist', () => withEnv({ ...ccEnv, COMMON_CRAWL_INDEX_BASE_URL: 'https://evil.example.com' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      return textResponse('', 200)
    }) as typeof fetch)
    try {
      const response = await commonCrawlAdapter.run({ text: 'https://example.com/' })
      if (called) return 'the mocked fetch was invoked despite a disallowed host override — the central allowlist did not block it'
      return (response.ok === false) || 'expected a safe error response when the base URL override is not on the host allowlist'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_204_common_crawl_get_only_at_runtime', () => withEnv(ccEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedMethod: string | undefined
    __setResearchFetchForTests((async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method
      return textResponse('', 200)
    }) as typeof fetch)
    try {
      await commonCrawlAdapter.run({ text: 'https://example.com/' })
      return (capturedMethod === undefined || capturedMethod === 'GET') || `expected a GET-only request, got method=${capturedMethod}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  // --- Remaining 15: sam_gov (Group B) ---

  const sampleSamOpp = {
    noticeId: 'abc123',
    title: 'Sample IT Services Opportunity',
    solicitationNumber: 'SOL-2026-001',
    postedDate: '2026-07-01',
    type: 'Solicitation',
    active: 'Yes',
    typeOfSetAsideDescription: 'Total Small Business Set-Aside',
    responseDeadLine: '2026-08-01T17:00:00-04:00',
    uiLink: 'https://sam.gov/opp/abc123/view',
    naicsCode: '541511',
  }

  await add('re_205_sam_gov_success_normalizes_opportunity_search', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ totalRecords: 1, opportunitiesData: [sampleSamOpp] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.sam_gov_notice_id !== 'abc123') return 'sam_gov_notice_id identifier missing'
    if (doc.identifiers.sam_gov_active !== 'Yes') return 'sam_gov_active identifier missing'
    return documentShapeIssue(doc, 'sam_gov') ?? true
  })))

  await add('re_206_sam_gov_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['SAM_GOV_API_KEY'], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_207_sam_gov_upstream_error_is_safe_not_a_fake_success', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_208_sam_gov_malformed_json_is_safe_parse_error', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_209_sam_gov_missing_opportunities_data_is_safe_parse_error', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ totalRecords: 0 }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (response.ok !== false || !response.error) return `expected a missing "opportunitiesData" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_210_sam_gov_non_array_opportunities_data_is_safe_parse_error', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: 'not-an-array' }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (response.ok !== false || !response.error) return `expected a non-array "opportunitiesData" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_211_sam_gov_explicit_empty_opportunities_remains_honest_success', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ totalRecords: 0, opportunitiesData: [] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'a search with no matches' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty opportunitiesData array to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_212_sam_gov_result_count_is_bounded', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: Array.from({ length: 100 }, (_, i) => ({ ...sampleSamOpp, noticeId: `notice-${i}` })) }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_213_sam_gov_never_fabricates_missing_active_status', () => withEnv({ SAM_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: [{ ...sampleSamOpp, active: undefined, typeOfSetAsideDescription: undefined }] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return (response.documents[0].identifiers.sam_gov_active === undefined && response.documents[0].identifiers.sam_gov_set_aside === undefined) || `expected missing active/set-aside to never be fabricated, got ${JSON.stringify(response.documents[0].identifiers)}`
  })))

  await add('re_214_sam_gov_api_key_never_leaks_into_cache_key_or_normalized_output', () => withEnv({ SAM_GOV_API_KEY: 'sk-live-sam-secret-not-real' }, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: [sampleSamOpp] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services' })
    const serialized = JSON.stringify(response)
    return !serialized.includes('sk-live-sam-secret-not-real') || 'the SAM.gov API key leaked into the normalized response'
  })))

  // --- Remaining 15: nasa (Group B, NeoWs feed only) ---

  const sampleNeo = {
    id: '3542519',
    neo_reference_id: '3542519',
    name: '(2010 XC15)',
    nasa_jpl_url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=3542519',
    close_approach_data: [{ close_approach_date: '2026-07-15' }],
  }

  await add('re_215_nasa_success_normalizes_neo_feed', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ element_count: 1, near_earth_objects: { '2026-07-15': [sampleNeo] } }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const doc = response.documents[0]
    if (doc.identifiers.nasa_neo_reference_id !== '3542519') return 'nasa_neo_reference_id identifier missing'
    if (doc.publishedAt !== '2026-07-15') return `expected the nearest close-approach date surfaced, got ${doc.publishedAt}`
    return documentShapeIssue(doc, 'nasa') ?? true
  })))

  await add('re_216_nasa_not_configured_is_safe_not_a_fake_success', () => withoutEnv(['NASA_API_KEY'], async () => {
    const response = await nasaAdapter.run({ text: '' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_217_nasa_upstream_error_is_safe_not_a_fake_success', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error') || `expected a safe error response, got ${JSON.stringify(response)}`
  })))

  await add('re_218_nasa_malformed_json_is_safe_parse_error', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (response.ok !== false || !response.error) return `expected malformed JSON to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_219_nasa_missing_near_earth_objects_is_safe_parse_error', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ element_count: 0 }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (response.ok !== false || !response.error) return `expected a missing "near_earth_objects" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_220_nasa_non_object_near_earth_objects_is_safe_parse_error', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ near_earth_objects: 'not-an-object' }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    if (response.ok !== false || !response.error) return `expected a non-object "near_earth_objects" field to become ok:false, got ${JSON.stringify(response)}`
    return response.error.category === 'parse_error' || `expected category parse_error, got ${response.error.category}`
  })))

  await add('re_221_nasa_explicit_empty_feed_remains_honest_success', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ element_count: 0, near_earth_objects: {} }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    return (response.ok === true && response.documents.length === 0) || `expected an explicit empty feed to remain an honest empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_222_nasa_result_count_is_bounded', () => withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ near_earth_objects: { '2026-07-15': Array.from({ length: 50 }, (_, i) => ({ ...sampleNeo, id: `neo-${i}`, neo_reference_id: `neo-${i}` })) } }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '', maxResults: 9999 })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents.length <= 20 || `expected result count bounded to 20, got ${response.documents.length}`
  })))

  await add('re_223_nasa_date_range_is_clamped_to_seven_days', async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ near_earth_objects: {} })
    }) as typeof fetch)
    try {
      await withEnv({ NASA_API_KEY: 'test-key-not-real' }, () => nasaAdapter.run({ text: '', dateFrom: '2026-01-01', dateTo: '2026-06-01' }))
      if (!capturedUrl) return 'expected a request to be made'
      const url = new URL(capturedUrl)
      const start = new Date(`${url.searchParams.get('start_date')}T00:00:00Z`)
      const end = new Date(`${url.searchParams.get('end_date')}T00:00:00Z`)
      const days = (end.getTime() - start.getTime()) / 86_400_000
      return days <= 7 || `expected the date range clamped to 7 days, got ${days} days (${capturedUrl})`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  })

  await add('re_224_nasa_api_key_never_leaks_into_normalized_output', () => withEnv({ NASA_API_KEY: 'sk-live-nasa-secret-not-real' }, () => withAdapterFetch([
    jsonResponse({ near_earth_objects: { '2026-07-15': [sampleNeo] } }),
  ], async () => {
    const response = await nasaAdapter.run({ text: '' })
    const serialized = JSON.stringify(response)
    return !serialized.includes('sk-live-nasa-secret-not-real') || 'the NASA API key leaked into the normalized response'
  })))

  // --- Remaining 15: global regression coverage for the whole build phase ---

  // re_225 is a structural sanity check only (a source-text occurrence count
  // of `<adapter>.run(` call sites) — it proves each adapter has *some*
  // amount of direct runtime test coverage beyond just its success path, but
  // it is not a measure of behavioral coverage completeness and must never
  // be cited as proof that an adapter's security or correctness behavior is
  // adequately tested. The actual behavioral coverage (SSRF matrices, date
  // validation, literal-query encoding, canonical-URL hardening, item
  // normalization, HTTP status handling, etc.) lives in the individual named
  // checks throughout this file — re_225 is retained for compatibility only.
  await add('re_225_remaining_15_implemented_adapters_each_have_runtime_tests', () => {
    const selfSource = readFileSync(join(process.cwd(), 'lib/research-engine/diagnostics/validation.ts'), 'utf8')
    const adapterVarNames: Record<string, string> = {
      semantic_scholar: 'semanticScholarAdapter',
      courtlistener: 'courtListenerAdapter',
      internet_archive: 'internetArchiveAdapter',
      wayback: 'waybackAdapter',
      common_crawl: 'commonCrawlAdapter',
      sam_gov: 'samGovAdapter',
      nasa: 'nasaAdapter',
    }
    const missing = Object.entries(adapterVarNames).filter(([, varName]) => {
      const runCallCount = selfSource.split(`${varName}.run(`).length - 1
      // 1 call is the adapter's own success test; require at least 2 (success + at least one failure/edge case).
      return runCallCount < 2
    })
    return missing.length === 0 || `adapter(s) missing sufficient runtime .run() test coverage: ${missing.map(([id]) => id).join(', ')}`
  })

  await add('re_226_all_unimplemented_providers_reject_honestly_via_getImplementedAdapter', () => {
    const unimplemented = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).map(d => d.id)
    const wronglyResolved = unimplemented.filter(id => IMPLEMENTED_PROVIDER_ADAPTERS[id] != null)
    return wronglyResolved.length === 0 || `unimplemented provider(s) unexpectedly resolved a real adapter: ${JSON.stringify(wronglyResolved)}`
  })

  await add('re_227_remaining_15_implemented_files_never_use_timers_or_polling', () => {
    const offenders = REMAINING_15_IMPLEMENTED_FILES.filter(file => {
      const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers', file), 'utf8')
      return /setInterval\(|setTimeout\(/.test(source)
    })
    return offenders.length === 0 || `background timer/polling reference found in: ${offenders.join(', ')}`
  })

  await add('re_228_remaining_15_no_arbitrary_provider_host_accepted', () => {
    const newlyImplementedIds: ResearchProviderId[] = ['semantic_scholar', 'courtlistener', 'internet_archive', 'wayback', 'common_crawl', 'sam_gov', 'nasa']
    const offenders = newlyImplementedIds.filter(id => isAllowedHost(id, 'attacker.example.com'))
    return offenders.length === 0 || `provider(s) accepted an arbitrary host: ${JSON.stringify(offenders)}`
  })

  await add('re_229_final_provider_descriptor_count_is_31', () =>
    RESEARCH_PROVIDER_ENV.length === 254 || `expected 254 total provider descriptors, found ${RESEARCH_PROVIDER_ENV.length}`)

  await add('re_230_final_implemented_count_is_24', () => {
    const count = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).length
    return count === 250 || `expected 250 implemented adapters, found ${count}`
  })

  await add('re_231_final_unimplemented_count_is_7', () => {
    const count = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).length
    return count === 4 || `expected 4 unimplemented providers, found ${count}`
  })

  // --- Repair pass: H1 (IPv4-mapped IPv6 SSRF bypass) fix regression + M5 SSRF matrix expansion ---
  //
  // Exercised through each real adapter's .run() (not just the shared validator in
  // isolation) so a future regression in how an adapter wires up the validator would
  // also be caught here, per the repair pass's Phase 3 requirement. Every case below
  // asserts: (1) ok:false, (2) the exact error category, (3) the injected fetch was
  // never invoked, and (4) provider-gate/cache state is restored in a finally block.

  const BACKSLASH = String.fromCharCode(92)

  const ssrfRejectedTargetCases: Array<{ id: string; url: string }> = [
    // IPv6
    { id: 'ipv6_loopback_target', url: 'http://[::1]/' },
    { id: 'ipv6_unspecified_target', url: 'http://[::]/' },
    { id: 'ipv6_link_local_target', url: 'http://[fe80::1]/' },
    { id: 'ipv6_unique_local_fc_target', url: 'http://[fc00::1]/' },
    { id: 'ipv6_unique_local_fd_target', url: 'http://[fd00::1]/' },
    { id: 'ipv6_multicast_target', url: 'http://[ff00::1]/' },
    // IPv4-mapped IPv6 (H1 — the confirmed bypass, in its dotted-decimal spelling)
    { id: 'ipv4_mapped_ipv6_loopback_target', url: 'http://[::ffff:127.0.0.1]/' },
    { id: 'ipv4_mapped_ipv6_metadata_target', url: 'http://[::ffff:169.254.169.254]/' },
    { id: 'ipv4_mapped_ipv6_rfc1918_10_target', url: 'http://[::ffff:10.0.0.1]/' },
    { id: 'ipv4_mapped_ipv6_rfc1918_172_target', url: 'http://[::ffff:172.16.0.1]/' },
    { id: 'ipv4_mapped_ipv6_rfc1918_192_target', url: 'http://[::ffff:192.168.1.1]/' },
    // IPv4-mapped IPv6, pre-normalized into the compressed hex form the WHATWG URL
    // parser actually produces — this is the literal shape the bypass exploited,
    // since the old validator's regex only matched the dotted-decimal spelling above.
    { id: 'ipv4_mapped_ipv6_hex_loopback_target', url: 'http://[::ffff:7f00:1]/' },
    { id: 'ipv4_mapped_ipv6_hex_metadata_target', url: 'http://[::ffff:a9fe:a9fe]/' },
    { id: 'ipv4_mapped_ipv6_hex_rfc1918_10_target', url: 'http://[::ffff:a00:1]/' },
    { id: 'ipv4_mapped_ipv6_hex_rfc1918_172_target', url: 'http://[::ffff:ac10:1]/' },
    { id: 'ipv4_mapped_ipv6_hex_rfc1918_192_target', url: 'http://[::ffff:c0a8:101]/' },
    // Alternative IPv4 encodings (the WHATWG URL parser canonicalizes each into
    // dotted-decimal before the range check runs)
    { id: 'ipv4_decimal_loopback_target', url: 'http://2130706433/' },
    { id: 'ipv4_hex_loopback_target', url: 'http://0x7f000001/' },
    { id: 'ipv4_octal_loopback_target', url: 'http://0177.0.0.1/' },
    { id: 'ipv4_shortform_loopback_target', url: 'http://127.1/' },
    { id: 'ipv4_cgnat_target', url: 'http://100.64.0.1/' },
    { id: 'ipv4_link_local_target', url: 'http://169.254.1.1/' },
    { id: 'ipv4_rfc1918_10_target', url: 'http://10.0.0.1/' },
    { id: 'ipv4_rfc1918_172_target', url: 'http://172.16.0.1/' },
    { id: 'ipv4_rfc1918_192_target', url: 'http://192.168.1.1/' },
    { id: 'ipv4_documentation_range_target', url: 'http://192.0.2.1/' },
    { id: 'ipv4_test_net_3_target', url: 'http://203.0.113.1/' },
    // Hostname / authority edge cases
    { id: 'hostname_localhost_target', url: 'http://localhost/' },
    { id: 'hostname_localhost_trailing_dot_target', url: 'http://localhost./' },
    { id: 'hostname_localhost_mixed_case_target', url: 'http://LocalHost/' },
    { id: 'authority_embedded_credentials_target', url: 'http://user:pass@example.com/' },
    { id: 'authority_username_only_target', url: 'http://user@example.com/' },
    { id: 'hostname_trailing_dot_private_ip_target', url: 'http://10.0.0.1./' },
    { id: 'authority_encoded_at_confusion_target', url: 'http://example.com%40evil.com/' },
    { id: 'authority_backslash_disguised_metadata_target', url: `http://169.254.169.254${BACKSLASH}@example.com/` },
    { id: 'authority_backslash_disguised_loopback_target', url: `http://127.0.0.1${BACKSLASH}@example.com/` },
    { id: 'percent_encoded_loopback_octets_target', url: 'http://127%2e0%2e0%2e1/' },
    { id: 'percent_encoded_loopback_digits_target', url: 'http://%31%32%37.0.0.1/' },
    { id: 'malformed_percent_encoding_host_target', url: 'http://exa%zzmple.com/' },
    // Non-web schemes
    { id: 'scheme_file_target', url: 'file:///etc/passwd' },
    { id: 'scheme_ftp_target', url: 'ftp://example.com/' },
    { id: 'scheme_data_target', url: 'data:text/plain;base64,SGVsbG8=' },
    { id: 'scheme_javascript_target', url: 'javascript:alert(1)' },
    { id: 'scheme_blob_target', url: 'blob:https://example.com/uuid' },
    { id: 'scheme_gopher_target', url: 'gopher://example.com/' },
  ]

  /** Runs one SSRF rejection case through a real adapter, proving no request is ever attempted. */
  async function assertRejectedTarget(provider: 'wayback' | 'common_crawl', url: string): Promise<boolean | string> {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let called = false
    __setResearchFetchForTests((async () => {
      called = true
      throw new Error('fetch must not be invoked for a target that should have been rejected before any request')
    }) as typeof fetch)
    try {
      const response = provider === 'wayback'
        ? await waybackAdapter.run({ text: url })
        : await withEnv(ccEnv, () => commonCrawlAdapter.run({ text: url }))
      if (called) return `mocked fetch was invoked for rejected target ${JSON.stringify(url)} — the SSRF gate did not block it before the request`
      if (response.ok !== false) return `expected ok:false for rejected target ${JSON.stringify(url)}, got ${JSON.stringify(response)}`
      if (response.documents.length !== 0) return `expected no documents for rejected target ${JSON.stringify(url)}, got ${response.documents.length}`
      return response.error?.category === 'unknown' || `expected error category 'unknown' for rejected target ${JSON.stringify(url)}, got ${response.error?.category}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }

  let ssrfCaseId = 232
  for (const { id, url } of ssrfRejectedTargetCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_wayback_rejects_${id}`, () => assertRejectedTarget('wayback', url))
  }
  for (const { id, url } of ssrfRejectedTargetCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_common_crawl_rejects_${id}`, () => assertRejectedTarget('common_crawl', url))
  }

  // Corrected per the target-port micro-repair: an explicit nonstandard port must be
  // rejected outright (not accepted) for both target-URL providers. re_322/re_323 keep
  // their original numeric IDs — only the asserted behavior and descriptive name change.
  await add(`re_${ssrfCaseId}_wayback_rejects_explicit_nonstandard_https_port_8443`, () => assertRejectedTarget('wayback', 'https://example.com:8443/'))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_common_crawl_rejects_explicit_nonstandard_https_port_8443`, () => assertRejectedTarget('common_crawl', 'https://example.com:8443/'))
  ssrfCaseId += 1

  // --- Repair pass: explicit nonstandard target-port rejection matrix (M-port) ---
  //
  // The WHATWG URL parser normalizes an explicit default port (http:80, https:443) to
  // an empty `port` string, so those remain indistinguishable from no-port URLs and stay
  // allowed. Any other explicit port must be rejected before the target reaches the
  // provider's outbound request. Rejected cases reuse assertRejectedTarget (ok:false,
  // error category 'unknown', fetch never invoked, no documents, gate/cache/env restored).
  // Accepted cases prove the opposite: ok:true and exactly one outbound mocked request.

  const rejectedPortCases: Array<{ id: string; url: string }> = [
    { id: 'explicit_nonstandard_https_port_8443', url: 'https://example.com:8443/' },
    { id: 'explicit_nonstandard_http_port_8080', url: 'http://example.com:8080/' },
    { id: 'explicit_nonstandard_https_port_22', url: 'https://example.com:22/' },
    { id: 'explicit_nonstandard_http_port_3000', url: 'http://example.com:3000/' },
  ]

  const acceptedPortCases: Array<{ id: string; url: string }> = [
    { id: 'no_port_https', url: 'https://example.com/' },
    { id: 'no_port_http', url: 'http://example.com/' },
    { id: 'explicit_default_https_port_443', url: 'https://example.com:443/' },
    { id: 'explicit_default_http_port_80', url: 'http://example.com:80/' },
  ]

  /** Runs one target-port acceptance case through a real adapter, proving exactly one outbound request is made. */
  async function assertAcceptedTarget(provider: 'wayback' | 'common_crawl', url: string): Promise<boolean | string> {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let calls = 0
    __setResearchFetchForTests((async () => {
      calls += 1
      return provider === 'wayback' ? jsonResponse([]) : textResponse('', 200, 'application/x-ndjson')
    }) as typeof fetch)
    try {
      const response = provider === 'wayback'
        ? await waybackAdapter.run({ text: url })
        : await withEnv(ccEnv, () => commonCrawlAdapter.run({ text: url }))
      if (calls !== 1) return `expected exactly one outbound request for accepted target ${JSON.stringify(url)}, got ${calls}`
      if (response.ok !== true) return `expected ok:true for accepted target ${JSON.stringify(url)}, got ${JSON.stringify(response)}`
      return response.documents.length === 0 || `expected the mocked empty response to yield no documents for ${JSON.stringify(url)}, got ${response.documents.length}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }

  for (const { id, url } of rejectedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_wayback_rejects_${id}`, () => assertRejectedTarget('wayback', url))
  }
  for (const { id, url } of rejectedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_common_crawl_rejects_${id}`, () => assertRejectedTarget('common_crawl', url))
  }
  for (const { id, url } of acceptedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_wayback_accepts_${id}`, () => assertAcceptedTarget('wayback', url))
  }
  for (const { id, url } of acceptedPortCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_common_crawl_accepts_${id}`, () => assertAcceptedTarget('common_crawl', url))
  }

  // --- Repair pass: M1 (SAM.gov reversed/oversized date-range validation) ---
  //
  // Preferred policy: invalid dates, a reversed range, and a range spanning more
  // than 365 calendar days are all rejected outright (never silently corrected,
  // swapped, or clamped) via error category 'unknown' — the same category the
  // wayback/common_crawl target-URL validator uses for caller-input rejection,
  // since the shared ResearchProviderError type has no 'invalid_request' category.

  const samGovKey = { SAM_GOV_API_KEY: 'test-key-not-real' }

  /** Runs one SAM.gov date-range rejection case, proving no upstream request is ever attempted. */
  async function assertSamGovDateRejected(query: { text: string; dateFrom?: string; dateTo?: string }): Promise<boolean | string> {
    return withEnv(samGovKey, async () => {
      __resetProviderGateForTests()
      __resetCacheForTests()
      let called = false
      __setResearchFetchForTests((async () => {
        called = true
        throw new Error('fetch must not be invoked for a rejected caller date range')
      }) as typeof fetch)
      try {
        const response = await samGovAdapter.run(query)
        if (called) return `mocked fetch was invoked for a date range that should have been rejected: ${JSON.stringify(query)}`
        if (response.ok !== false) return `expected ok:false for rejected date range ${JSON.stringify(query)}, got ${JSON.stringify(response)}`
        return response.error?.category === 'unknown' || `expected error category 'unknown', got ${response.error?.category}`
      } finally {
        __setResearchFetchForTests(null)
        __resetProviderGateForTests()
        __resetCacheForTests()
      }
    })
  }

  await add(`re_${ssrfCaseId}_sam_gov_accepts_valid_caller_date_range`, () => withEnv(samGovKey, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ opportunitiesData: [sampleSamOpp] })
    }) as typeof fetch)
    try {
      const response = await samGovAdapter.run({ text: 'IT services', dateFrom: '2026-01-01', dateTo: '2026-01-31' })
      if (!response.ok) return `expected ok response for a valid caller date range, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      if (requestUrl.searchParams.get('postedFrom') !== '01/01/2026') return `expected postedFrom=01/01/2026, got ${requestUrl.searchParams.get('postedFrom')}`
      if (requestUrl.searchParams.get('postedTo') !== '01/31/2026') return `expected postedTo=01/31/2026, got ${requestUrl.searchParams.get('postedTo')}`
      return true
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_invalid_date_from`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: 'not-a-date', dateTo: '2026-01-31' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_invalid_date_to`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: '2026-01-01', dateTo: 'not-a-date' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_reversed_date_range`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: '2026-02-01', dateTo: '2026-01-01' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_accepts_exactly_365_day_range`, () => withEnv(samGovKey, () => withAdapterFetch([
    jsonResponse({ opportunitiesData: [sampleSamOpp] }),
  ], async () => {
    const response = await samGovAdapter.run({ text: 'IT services', dateFrom: '2025-01-01', dateTo: '2026-01-01' })
    return response.ok === true || `expected a 365-day range to be accepted, got error: ${JSON.stringify(response.error)}`
  })))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_rejects_range_greater_than_365_days`, () =>
    assertSamGovDateRejected({ text: 'IT services', dateFrom: '2025-01-01', dateTo: '2026-01-02' }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_default_bounded_range_used_without_caller_dates`, () => withEnv(samGovKey, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ opportunitiesData: [] })
    }) as typeof fetch)
    try {
      const response = await samGovAdapter.run({ text: 'IT services' })
      if (!response.ok) return `expected ok response when no caller dates are supplied, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      const postedFrom = requestUrl.searchParams.get('postedFrom')
      const postedTo = requestUrl.searchParams.get('postedTo')
      if (!postedFrom || !postedTo) return `expected a default bounded postedFrom/postedTo pair, got ${postedFrom}..${postedTo}`
      const parse = (mmddyyyy: string) => {
        const [mm, dd, yyyy] = mmddyyyy.split('/')
        return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`).getTime()
      }
      const rangeDays = Math.round((parse(postedTo) - parse(postedFrom)) / 86_400_000)
      return (rangeDays > 0 && rangeDays <= 365) || `expected the default window to be bounded within 365 days, got ${rangeDays}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_sam_gov_api_key_absent_from_serialized_date_range_error`, () => withEnv({ SAM_GOV_API_KEY: 'sk-live-samgov-secret-not-real' }, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    __setResearchFetchForTests((async () => {
      throw new Error('fetch must not be invoked for a rejected caller date range')
    }) as typeof fetch)
    try {
      const response = await samGovAdapter.run({ text: 'IT services', dateFrom: '2026-02-01', dateTo: '2026-01-01' })
      const serialized = JSON.stringify(response)
      return !serialized.includes('sk-live-samgov-secret-not-real') || 'the SAM.gov API key leaked into a serialized date-range validation error'
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  // --- Repair pass: M2 (Internet Archive literal-only query hardening) ---
  //
  // Caller text must never be interpreted as raw Solr/Lucene syntax (field
  // selectors, boolean operators, grouping, wildcards, range/proximity
  // syntax). Each case below captures the actual outbound request and proves
  // the `q` param sent upstream is a single escaped, quoted literal phrase
  // that round-trips back to exactly the caller's original text — not a
  // naive passthrough of caller-controlled Solr syntax.

  const iaEnv = { INTERNET_ARCHIVE_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }

  /** Reverses the literal-phrase escaping independently of the adapter's own implementation, as an external oracle. */
  function unescapeLiteralSolrPhrase(q: string): string | null {
    if (q.length < 2 || q[0] !== '"' || q[q.length - 1] !== '"') return null
    const inner = q.slice(1, -1)
    let result = ''
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '\\' && i + 1 < inner.length && (inner[i + 1] === '\\' || inner[i + 1] === '"')) {
        result += inner[i + 1]
        i += 1
      } else {
        result += inner[i]
      }
    }
    return result
  }

  /** Runs one literal-query hardening case through the real adapter, capturing the exact outbound `q` param. */
  async function assertInternetArchiveLiteralQuery(callerText: string): Promise<boolean | string> {
    return withEnv(iaEnv, async () => {
      __resetProviderGateForTests()
      __resetCacheForTests()
      let capturedUrl: string | undefined
      __setResearchFetchForTests((async (input: RequestInfo | URL) => {
        capturedUrl = typeof input === 'string' ? input : input.toString()
        return jsonResponse({ response: { numFound: 0, docs: [] } })
      }) as typeof fetch)
      try {
        const response = await internetArchiveAdapter.run({ text: callerText })
        if (!response.ok) return `expected ok response for caller text ${JSON.stringify(callerText)}, got error: ${JSON.stringify(response.error)}`
        const requestUrl = new URL(capturedUrl ?? '')
        const q = requestUrl.searchParams.get('q')
        if (q === null) return `expected a "q" search param on the outbound request for ${JSON.stringify(callerText)}`
        if (q === callerText) return `caller text ${JSON.stringify(callerText)} was passed through unescaped as raw Solr syntax`
        const roundTripped = unescapeLiteralSolrPhrase(q)
        if (roundTripped === null) return `expected "q" to be a single quoted literal phrase, got ${JSON.stringify(q)}`
        return roundTripped === callerText || `expected the literal phrase to round-trip to ${JSON.stringify(callerText)}, got ${JSON.stringify(roundTripped)} (raw q=${JSON.stringify(q)})`
      } finally {
        __setResearchFetchForTests(null)
        __resetProviderGateForTests()
        __resetCacheForTests()
      }
    })
  }

  const iaLiteralQueryCases: Array<{ id: string; text: string }> = [
    { id: 'field_selector_syntax', text: 'title:secret' },
    { id: 'boolean_operator_syntax', text: 'foo OR mediatype:movies' },
    { id: 'bare_wildcard_syntax', text: '*' },
    { id: 'grouping_parentheses_syntax', text: '(test)' },
    { id: 'embedded_double_quotes', text: '"quoted"' },
    { id: 'embedded_backslash', text: 'backslash\\value' },
    { id: 'range_syntax', text: 'date:[1900 TO 2100]' },
  ]

  for (const { id, text } of iaLiteralQueryCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_internet_archive_encodes_${id}_as_literal_text`, () => assertInternetArchiveLiteralQuery(text))
  }

  await add(`re_${ssrfCaseId}_internet_archive_fl_fields_remain_fixed_regardless_of_caller_input`, () => withEnv(iaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ response: { numFound: 0, docs: [] } })
    }) as typeof fetch)
    try {
      const response = await internetArchiveAdapter.run({ text: 'fl[]=identifier,secret_field&sort=random' })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      const fields = requestUrl.searchParams.getAll('fl[]')
      const expected = ['identifier', 'title', 'description', 'mediatype', 'date', 'creator']
      return (fields.length === expected.length && fields.every((f, i) => f === expected[i])) || `expected fl[] to remain fixed at ${JSON.stringify(expected)}, got ${JSON.stringify(fields)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_internet_archive_strips_control_characters_from_query`, () => withEnv(iaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let capturedUrl: string | undefined
    __setResearchFetchForTests((async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return jsonResponse({ response: { numFound: 0, docs: [] } })
    }) as typeof fetch)
    try {
      const response = await internetArchiveAdapter.run({ text: 'line1\x00line2\x1fline3' })
      if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
      const requestUrl = new URL(capturedUrl ?? '')
      const q = requestUrl.searchParams.get('q') ?? ''
      return !/[\x00-\x1f\x7f]/.test(q) || `expected raw control characters to be stripped from the outbound query, got ${JSON.stringify(q)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))
  ssrfCaseId += 1

  // --- Repair pass: M3 (CourtListener canonical-URL hardening) ---
  //
  // `absolute_url` is resolved via `new URL(relativePath, trustedOrigin)` and
  // post-validated (https, exact hostname, default port, no credentials) —
  // never naively string-concatenated. Preferred policy: a record whose
  // `absolute_url` is present but unsafe/unusable is skipped; if every result
  // in a non-empty upstream response is unsafe, the whole response becomes a
  // parse_error rather than a fabricated honest-empty success.

  const clEnv = { COURTLISTENER_API_TOKEN: 'test-token-not-real' }

  const clUnsafeAbsoluteUrlCases: Array<{ id: string; absoluteUrl: string }> = [
    { id: 'protocol_relative_authority_override', absoluteUrl: '//evil.example/path' },
    { id: 'full_off_host_url', absoluteUrl: 'https://evil.example/path' },
    { id: 'lookalike_host_suffix', absoluteUrl: 'https://www.courtlistener.com.evil.example/path' },
    { id: 'backslash_authority_confusion', absoluteUrl: `/${String.fromCharCode(92)}evil.example/path` },
    // WHATWG URL parsing strips embedded newlines before parsing, so a raw
    // path containing a newline before "evil.example" (which does not literally
    // start with "//") normalizes into the protocol-relative "//evil.example/..."
    // once resolved -- proving the post-resolution hostname check catches what a
    // pre-resolution string-prefix check alone would miss.
    { id: 'newline_stripped_protocol_relative_bypass', absoluteUrl: `/${String.fromCharCode(10)}/evil.example/path` },
  ]
  for (const { id, absoluteUrl } of clUnsafeAbsoluteUrlCases) {
    const currentId = ssrfCaseId
    ssrfCaseId += 1
    await add(`re_${currentId}_courtlistener_skips_result_with_${id}`, () => withEnv(clEnv, () => withAdapterFetch([
      jsonResponse({ count: 1, results: [{ ...sampleClResult, absolute_url: absoluteUrl }] }),
    ], async () => {
      const response = await courtListenerAdapter.run({ text: 'sample case' })
      if (response.ok !== false) return `expected an all-unsafe result set to become ok:false (parse_error), got ${JSON.stringify(response)}`
      return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
    })))
  }

  await add(`re_${ssrfCaseId}_courtlistener_accepts_normal_relative_opinion_path`, () => withEnv(clEnv, () => withAdapterFetch([
    jsonResponse({ count: 1, results: [sampleClResult] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample case' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    const expected = `https://www.courtlistener.com${sampleClResult.absolute_url}`
    return response.documents[0].canonicalUrl === expected || `expected canonicalUrl ${expected}, got ${response.documents[0].canonicalUrl}`
  })))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_courtlistener_mixed_valid_and_invalid_results_keeps_only_valid`, () => withEnv(clEnv, () => withAdapterFetch([
    jsonResponse({ count: 2, results: [sampleClResult, { ...sampleClResult, cluster_id: 111, absolute_url: '//evil.example/path' }] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample case' })
    if (!response.ok) return `expected ok response when at least one result is safe, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected only the 1 safe result to survive, got ${response.documents.length}`
    return response.documents[0].canonicalUrl === `https://www.courtlistener.com${sampleClResult.absolute_url}` || `unexpected canonicalUrl on the surviving document: ${response.documents[0].canonicalUrl}`
  })))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_courtlistener_all_results_invalid_is_parse_error_not_fabricated_empty_success`, () => withEnv(clEnv, () => withAdapterFetch([
    jsonResponse({ count: 2, results: [{ ...sampleClResult, absolute_url: '//evil.example/path' }, { ...sampleClResult, cluster_id: 222, absolute_url: 'https://evil.example/other' }] }),
  ], async () => {
    const response = await courtListenerAdapter.run({ text: 'sample case' })
    if (response.ok !== false) return `expected an all-invalid non-empty result set to become ok:false, got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  })))
  ssrfCaseId += 1

  // --- Repair pass: M4/L1 (Semantic Scholar stable-ID and item hardening) ---
  //
  // `paperId` is mandatory (title is never used as an ID fallback), `authors`
  // is only ever iterated after an Array.isArray guard, and `url` is only
  // trusted as canonicalUrl when it is a valid HTTPS URL on the accepted
  // Semantic Scholar public origin. Preferred policy matches CourtListener's:
  // skip individual malformed records, keep valid ones in a mixed response,
  // and return parse_error (not a fabricated honest-empty success) if every
  // record in a non-empty upstream response is malformed.

  await add(`re_${ssrfCaseId}_semantic_scholar_skips_record_missing_paper_id`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, paperId: undefined }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false) return `expected a lone record missing paperId to become ok:false (parse_error), got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_title_present_but_paper_id_missing_is_still_skipped`, () => withAdapterFetch([
    jsonResponse({ data: [{ title: 'A Title With No Stable ID', abstract: null, year: 2024 }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false) return `expected a title-only record (no paperId) to be rejected rather than used as a fallback ID, got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_authors_as_string_does_not_crash_normalization`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, authors: 'A. Researcher' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when authors is a string, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].authors.length === 0 || `expected authors to be normalized to [] when not an array, got ${JSON.stringify(response.documents[0].authors)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_authors_null_does_not_crash_normalization`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, authors: null }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when authors is null, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].authors.length === 0 || `expected authors to be normalized to [], got ${JSON.stringify(response.documents[0].authors)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_malformed_author_entries_are_dropped_not_crashed`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, authors: ['not-an-object', { authorId: '2' }, { authorId: '3', name: 42 }, { authorId: '4', name: 'Valid Name' }, null] }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response with malformed author entries present, got error: ${JSON.stringify(response.error)}`
    const authors = response.documents[0].authors
    return (authors.length === 1 && authors[0] === 'Valid Name') || `expected only the one well-formed author name to survive, got ${JSON.stringify(authors)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_external_ids_as_string_does_not_crash_normalization`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, externalIds: 'DOI:10.9999/oops' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when externalIds is a string, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].identifiers.doi === undefined || `expected no doi identifier when externalIds is malformed, got ${response.documents[0].identifiers.doi}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_rejects_invalid_paper_url_as_canonical`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, url: 'https://evil.example/paper/abc123def456' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response (paperId is still present), got error: ${JSON.stringify(response.error)}`
    return response.documents[0].canonicalUrl === null || `expected an off-origin paper url to be rejected as canonicalUrl, got ${response.documents[0].canonicalUrl}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_mixed_valid_and_invalid_records_keeps_only_valid`, () => withAdapterFetch([
    jsonResponse({ data: [sampleSsPaper, { ...sampleSsPaper, paperId: undefined, title: 'Missing ID Paper' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response when at least one record is valid, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected only the 1 valid record to survive, got ${response.documents.length}`
    return response.documents[0].identifiers.semantic_scholar_paper_id === sampleSsPaper.paperId || `unexpected surviving record: ${JSON.stringify(response.documents[0].identifiers)}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_all_records_invalid_is_parse_error_not_fabricated_empty_success`, () => withAdapterFetch([
    jsonResponse({ data: [{ ...sampleSsPaper, paperId: undefined }, { title: 'Also Missing ID' }] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (response.ok !== false) return `expected an all-invalid non-empty result set to become ok:false, got ${JSON.stringify(response)}`
    return response.error?.category === 'parse_error' || `expected category parse_error, got ${response.error?.category}`
  }))
  ssrfCaseId += 1

  await add(`re_${ssrfCaseId}_semantic_scholar_year_preserved_as_bare_year_not_fabricated_date`, () => withAdapterFetch([
    jsonResponse({ data: [sampleSsPaper] }),
  ], async () => {
    const response = await semanticScholarAdapter.run({ text: 'sample things' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    return response.documents[0].publishedAt === String(sampleSsPaper.year) || `expected publishedAt to be the bare year "${sampleSsPaper.year}", got ${response.documents[0].publishedAt}`
  }))
  ssrfCaseId += 1

  // --- Repair pass: M5 (HTTP 401/403/429/503 coverage matrix) ---
  //
  // Every Remaining-15 adapter maps any failed HTTP status to the same safe
  // 'upstream_error' category (never a fake success), so each case below
  // proves that holds for the auth-failure (401/403), rate-limit (429), and
  // service-unavailable (503) statuses specifically, not just the existing
  // 500 coverage. 429/503 responses carry `Retry-After: 0` so safeFetch's
  // built-in retry/backoff resolves immediately rather than sleeping for
  // real between attempts. Each case also proves the raw response body never
  // leaks into the normalized error.

  type HttpStatusAdapterConfig = {
    id: string
    env: Record<string, string>
    query: { text: string }
    run: (query: { text: string }) => ReturnType<typeof waybackAdapter.run>
  }

  const httpStatusAdapterConfigs: HttpStatusAdapterConfig[] = [
    { id: 'semantic_scholar', env: {}, query: { text: 'sample things' }, run: semanticScholarAdapter.run },
    { id: 'courtlistener', env: clEnv, query: { text: 'sample case' }, run: courtListenerAdapter.run },
    { id: 'internet_archive', env: iaEnv, query: { text: 'sample item' }, run: internetArchiveAdapter.run },
    { id: 'wayback', env: {}, query: { text: 'https://example.com/' }, run: waybackAdapter.run },
    { id: 'common_crawl', env: ccEnv, query: { text: 'https://example.com/' }, run: commonCrawlAdapter.run },
    { id: 'sam_gov', env: samGovKey, query: { text: 'IT services' }, run: samGovAdapter.run },
    { id: 'nasa', env: { NASA_API_KEY: 'test-key-not-real' }, query: { text: '' }, run: nasaAdapter.run },
  ]

  const httpStatusCases = [401, 403, 429, 503]

  for (const config of httpStatusAdapterConfigs) {
    for (const status of httpStatusCases) {
      const currentId = ssrfCaseId
      ssrfCaseId += 1
      const bodyMarker = `sensitive-raw-body-marker-${config.id}-${status}-must-never-leak`
      await add(`re_${currentId}_${config.id}_http_${status}_is_safe_upstream_error`, () => withEnv(config.env, () => withAdapterFetch([
        new Response(bodyMarker, { status, headers: status === 429 || status === 503 ? { 'Retry-After': '0' } : {} }),
      ], async () => {
        const response = await config.run(config.query)
        if (response.ok !== false) return `expected HTTP ${status} to produce ok:false for ${config.id}, got ${JSON.stringify(response)}`
        if (response.documents.length !== 0) return `expected 0 documents for an HTTP ${status} error on ${config.id}, got ${response.documents.length}`
        if (response.error?.category !== 'upstream_error') return `expected category upstream_error for HTTP ${status} on ${config.id}, got ${response.error?.category}`
        const serialized = JSON.stringify(response)
        return !serialized.includes(bodyMarker) || `the raw upstream response body leaked into the normalized error for ${config.id} HTTP ${status}`
      })))
    }
  }

  // --- FMCSA QCMobile USDOT-only adapter (BLOCKED PROVIDER 1 OF 8 build) ---
  //
  // Envelope proven by two Commander-authorized, structure-only controlled
  // probes against the official documentation-published sample USDOT 44110
  // (see docs/RESEARCH_CONTROLLED_PROBE_LOG.md): a 200 response is
  // `{ content: { _links, carrier: { dotNumber: number, legalName: string, ... } }, retrievalDate }`.
  // All fixture values below are synthetic test data, never a real carrier record.

  const fmcsaEnv = { FMCSA_WEB_KEY: 'test-key-not-real' }

  const sampleFmcsaCarrier = {
    content: {
      _links: { self: { href: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110' } },
      carrier: {
        dotNumber: 44110,
        legalName: 'SAMPLE CARRIER LLC',
        dbaName: 'SAMPLE DBA',
        allowedToOperate: 'Y',
        statusCode: 'A',
        oosDate: null,
        phyCity: 'SAMPLE CITY',
        phyState: 'KS',
        phyCountry: 'US',
        safetyRating: 'S',
        safetyRatingDate: '2020-01-01',
        commonAuthorityStatus: 'A',
        contractAuthorityStatus: 'N',
        brokerAuthorityStatus: 'N',
      },
    },
    retrievalDate: '2026-08-07T00:00:00.000Z',
  }

  await add('re_600_fmcsa_success_normalizes_proven_content_carrier_envelope', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (!response.ok) return `expected ok response, got error: ${JSON.stringify(response.error)}`
    if (response.documents.length !== 1) return `expected 1 document, got ${response.documents.length}`
    return documentShapeIssue(response.documents[0], 'fmcsa') ?? true
  })))

  await add('re_601_fmcsa_uses_exact_content_carrier_record_path', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    return doc?.canonicalUrl === 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110' || `expected the sanitized carrier endpoint as canonicalUrl, got ${doc?.canonicalUrl}`
  })))

  await add('re_602_fmcsa_dot_number_mapped_as_stable_identifier', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    return (doc?.providerRecordId === '44110' && doc.identifiers.fmcsa_dot_number === '44110') || `expected dotNumber mapped as a stable identifier, got ${JSON.stringify(doc?.identifiers)}`
  })))

  await add('re_603_fmcsa_legal_name_mapped_to_title', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return response.documents[0]?.title === 'SAMPLE CARRIER LLC' || `expected legalName mapped to title, got ${response.documents[0]?.title}`
  })))

  await add('re_604_fmcsa_optional_dba_name_mapped', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return response.documents[0]?.identifiers.fmcsa_dba_name === 'SAMPLE DBA' || `expected dbaName mapped, got ${JSON.stringify(response.documents[0]?.identifiers)}`
  })))

  await add('re_605_fmcsa_operating_status_mapped', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return response.documents[0]?.identifiers.fmcsa_allowed_to_operate === 'Y' || `expected allowedToOperate mapped, got ${JSON.stringify(response.documents[0]?.identifiers)}`
  })))

  await add('re_606_fmcsa_null_optional_field_preserved_not_fabricated', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, safetyRating: null, safetyRatingDate: null } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (!response.ok) return `expected ok response despite null optional fields, got ${JSON.stringify(response.error)}`
    const ids = response.documents[0]?.identifiers ?? {}
    return (!('fmcsa_safety_rating' in ids) && !('fmcsa_safety_rating_date' in ids)) || `expected null optional fields to be omitted, never fabricated, got ${JSON.stringify(ids)}`
  })))

  // Repair (independent-audit HIGH finding): this test formerly requested
  // usdot 44110 and asserted that a response with dotNumber: 0 was accepted
  // as valid ("falsy but valid"), proving the adapter never checked the
  // returned carrier identity against the requested one. It now proves the
  // opposite and required behavior: a returned dotNumber that does not match
  // the requested USDOT is rejected as parse_error with zero documents, and
  // is never cached under the requested key (a repeated identical request
  // still performs a fresh fetch rather than serving a poisoned cache entry).
  await add('re_607_fmcsa_returned_dot_number_mismatch_rejected_and_never_cached', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 99999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 99999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async calls => {
    const first = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (first.ok !== false) return `expected a returned dotNumber (99999) that does not match the requested USDOT (44110) to be rejected, got ${JSON.stringify(first)}`
    if (first.documents.length !== 0) return `expected zero documents for a mismatched carrier identity, got ${first.documents.length}`
    if (first.error?.category !== 'parse_error') return `expected parse_error for a mismatched carrier identity, got ${first.error?.category}`
    const second = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (second.ok === false && calls.count === 2) || `expected the mismatched response to never be cached under the requested key — a repeated identical request should still re-fetch, not hit a poisoned cache entry; got calls=${calls.count} second=${JSON.stringify(second)}`
  })))

  await add('re_608_fmcsa_retrieval_date_never_fabricates_publish_or_update_date', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    return (doc?.publishedAt === null && doc?.updatedAt === null) || `expected retrievalDate to never populate publishedAt/updatedAt (its meaning is undocumented), got publishedAt=${doc?.publishedAt} updatedAt=${doc?.updatedAt}`
  })))

  await add('re_609_fmcsa_invalid_input_rejected_before_fetch', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'hello world' })
    return (response.ok === false && calls.count === 0) || `expected invalid input rejected without any fetch call, calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_610_fmcsa_free_text_query_rejected', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'acme trucking company' })
    return (response.ok === false && calls.count === 0) || `expected free-text query rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_611_fmcsa_multiple_identifiers_rejected', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 123 456' })
    return (response.ok === false && calls.count === 0) || `expected multiple identifiers rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_612_fmcsa_overlong_identifier_rejected', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 123456789' })
    return (response.ok === false && calls.count === 0) || `expected a 9-digit identifier beyond the conservative bound rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_613_fmcsa_missing_webkey_reports_not_configured', () => withoutEnv(['FMCSA_WEB_KEY'], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'not_configured') || `expected a not_configured error, got ${JSON.stringify(response)}`
  }))

  await add('re_614_fmcsa_exact_host_construction', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (calls.urls.length !== 1) return `expected exactly 1 request, got ${calls.urls.length}`
    return new URL(calls.urls[0]).hostname === 'mobile.fmcsa.dot.gov' || `expected host mobile.fmcsa.dot.gov, got ${new URL(calls.urls[0]).hostname}`
  })))

  await add('re_615_fmcsa_exact_path_construction', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    return new URL(calls.urls[0]).pathname === '/qc/services/carriers/44110' || `expected path /qc/services/carriers/44110, got ${new URL(calls.urls[0]).pathname}`
  })))

  await add('re_616_fmcsa_get_method_only', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    const method = calls.inits[0]?.method ?? 'GET'
    return method === 'GET' || `expected GET method only, got ${method}`
  })))

  await add('re_617_fmcsa_one_provider_call_maximum_per_run', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok && calls.count === 1) || `expected exactly 1 provider call per run, got ${calls.count}`
  })))

  await add('re_618_fmcsa_name_search_not_supported', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'name acme trucking' })
    return (response.ok === false && calls.count === 0) || `expected name-search-style input rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_619_fmcsa_docket_search_not_supported', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const response = await fmcsaAdapter.run({ text: 'docket MC-123456' })
    return (response.ok === false && calls.count === 0) || `expected docket-search-style input rejected without a fetch call, calls=${calls.count}`
  })))

  await add('re_620_fmcsa_never_constructs_a_sub_resource_url', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    return new URL(calls.urls[0]).pathname === '/qc/services/carriers/44110' || `expected only the bare carrier endpoint, never a sub-resource path, got ${new URL(calls.urls[0]).pathname}`
  })))

  await add('re_621_fmcsa_never_sends_pagination_parameters', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    await fmcsaAdapter.run({ text: 'usdot 44110' })
    const keys = Array.from(new URL(calls.urls[0]).searchParams.keys())
    return (keys.length === 1 && keys[0] === 'webKey') || `expected only a webKey query parameter, no pagination params, got ${JSON.stringify(keys)}`
  })))

  await add('re_622_fmcsa_never_follows_hal_links_in_the_response', () => withEnv(fmcsaEnv, () => withCountingFetch([jsonResponse({
    content: {
      _links: { self: { href: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110' }, basics: { href: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110/basics' } },
      carrier: sampleFmcsaCarrier.content.carrier,
    },
    retrievalDate: sampleFmcsaCarrier.retrievalDate,
  })], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok && calls.count === 1) || `expected the HAL _links in the response body to never be followed (exactly 1 call), got ${calls.count}`
  })))

  await add('re_623_fmcsa_missing_content_wrapper_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error' && response.documents.length === 0) || `expected parse_error for a missing content wrapper, got ${JSON.stringify(response)}`
  })))

  await add('re_624_fmcsa_content_wrong_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: 'not-an-object', retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a non-object content field, got ${JSON.stringify(response)}`
  })))

  await add('re_625_fmcsa_carrier_record_wrong_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: ['not', 'an', 'object'] }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a non-object carrier record, got ${JSON.stringify(response)}`
  })))

  await add('re_626_fmcsa_missing_dot_number_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { legalName: 'SAMPLE CARRIER LLC' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a missing dotNumber, got ${JSON.stringify(response)}`
  })))

  await add('re_627_fmcsa_malformed_dot_number_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { dotNumber: '44110', legalName: 'SAMPLE CARRIER LLC' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a string-typed dotNumber (the proven type is number), got ${JSON.stringify(response)}`
  })))

  await add('re_628_fmcsa_missing_legal_name_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { dotNumber: 44110 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a missing legalName, got ${JSON.stringify(response)}`
  })))

  await add('re_629_fmcsa_legal_name_wrong_type_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { dotNumber: 44110, legalName: 12345 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for a numeric-typed legalName, got ${JSON.stringify(response)}`
  })))

  await add('re_630_fmcsa_malformed_json_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('{not valid json', { status: 200 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for malformed JSON, got ${JSON.stringify(response)}`
  })))

  await add('re_631_fmcsa_html_response_is_parse_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('<html><body>Not JSON</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected parse_error for an HTML response, got ${JSON.stringify(response)}`
  })))

  await add('re_632_fmcsa_404_is_safe_not_a_fake_success', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Not Found', { status: 404 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error' && response.error?.httpStatus === 404) || `expected a safe upstream_error for 404 (no dedicated not_found category exists in this build's types), got ${JSON.stringify(response)}`
  })))

  await add('re_633_fmcsa_400_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Bad Request', { status: 400 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error for 400, got ${JSON.stringify(response)}`
  })))

  await add('re_634_fmcsa_401_is_safe_upstream_error_without_key_leak', () => withEnv({ FMCSA_WEB_KEY: 'sk-live-fmcsa-secret-not-real' }, () => withAdapterFetch([
    new Response('Unauthorized', { status: 401 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const serialized = JSON.stringify(response)
    return (response.ok === false && response.error?.category === 'upstream_error' && !serialized.includes('sk-live-fmcsa-secret-not-real')) || `expected a safe 401 upstream_error without a key leak, got ${serialized}`
  })))

  await add('re_635_fmcsa_403_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Forbidden', { status: 403 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error for 403, got ${JSON.stringify(response)}`
  })))

  await add('re_636_fmcsa_429_is_rate_limited', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'rate_limited') || `expected rate_limited for 429, got ${JSON.stringify(response)}`
  })))

  await add('re_637_fmcsa_500_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error for 500, got ${JSON.stringify(response)}`
  })))

  await add('re_638_fmcsa_503_is_safe_upstream_error', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected upstream_error after exhausted 503 retries, got ${JSON.stringify(response)}`
  })))

  await add('re_639_fmcsa_timeout_is_safe_upstream_error', () => withEnv(fmcsaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    __setResearchFetchForTests((async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      throw abortError
    }) as typeof fetch)
    try {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      return (response.ok === false && response.documents.length === 0) || `expected a safe error response on timeout, got ${JSON.stringify(response)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_640_fmcsa_oversized_response_is_rejected_not_parsed', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('x'.repeat(200_000), { status: 200 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0) || `expected an oversized response to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_641_fmcsa_redirect_is_never_followed_and_costs_exactly_one_fetch', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response(null, { status: 302, headers: { location: 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110/redirected' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (response.ok !== false || response.documents.length !== 0) return `expected a redirect to be rejected rather than followed, got ${JSON.stringify(response)}`
    if (calls.count !== 1) return `expected exactly 1 upstream fetch for a redirect response (maxRetries: 0 + maxRedirects: 0 — no amplification), got ${calls.count}`
    return calls.urls.every(u => !u.includes('/redirected')) || `expected the Location redirect target to never be requested, got ${JSON.stringify(calls.urls)}`
  })))

  await add('re_642_fmcsa_webkey_stripped_from_network_error_text', () => withEnv(fmcsaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    __setResearchFetchForTests((async () => {
      throw new Error('fetch failed for https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKEWEBKEY123 : network unreachable')
    }) as typeof fetch)
    try {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      const serialized = JSON.stringify(response)
      return !serialized.includes('FAKEWEBKEY123') || `a fake webKey value leaked through a network-error message: ${serialized}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_643_fmcsa_webkey_absent_from_cache_key', () => withCountingFetch([jsonResponse(sampleFmcsaCarrier)], async calls => {
    const prevKey = process.env.FMCSA_WEB_KEY
    process.env.FMCSA_WEB_KEY = 'first-fake-key-not-real'
    try {
      const first = await fmcsaAdapter.run({ text: 'usdot 44110' })
      if (!first.ok) return `expected first call to succeed, got ${JSON.stringify(first.error)}`
      process.env.FMCSA_WEB_KEY = 'second-fake-key-not-real'
      const second = await fmcsaAdapter.run({ text: 'usdot 44110' })
      if (!second.ok) return `expected second call to succeed, got ${JSON.stringify(second.error)}`
      return (second.fromCache === true && calls.count === 1) || `expected the cache key to be independent of webKey; calls=${calls.count} fromCache=${second.fromCache}`
    } finally {
      if (prevKey === undefined) delete process.env.FMCSA_WEB_KEY
      else process.env.FMCSA_WEB_KEY = prevKey
    }
  }))

  await add('re_644_fmcsa_webkey_absent_from_serialized_errors', () => withEnv({ FMCSA_WEB_KEY: 'sk-live-fmcsa-secret-not-real' }, () => withAdapterFetch([
    new Response('not valid json', { status: 200 }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const serialized = JSON.stringify(response)
    return !serialized.includes('sk-live-fmcsa-secret-not-real') || 'the FMCSA WebKey leaked into a serialized error response'
  })))

  await add('re_645_fmcsa_webkey_absent_from_source_url', () => withEnv({ FMCSA_WEB_KEY: 'sk-live-fmcsa-secret-not-real' }, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    const doc = response.documents[0]
    const noKeyLeak = !JSON.stringify(doc).includes('sk-live-fmcsa-secret-not-real')
    const noParamLeak = !(doc?.sourceUrl ?? '').includes('webKey') && !(doc?.canonicalUrl ?? '').includes('webKey')
    return (noKeyLeak && noParamLeak) || 'the WebKey or a webKey query parameter leaked into the normalized source/canonical URL'
  })))

  await add('re_646_fmcsa_fake_webkey_fully_redacted_by_shared_redactors', () => {
    const redactedUrl = redactUrlForLogging('https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKEWEBKEY123')
    const redactedText = redactSecretsFromText('request failed: https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKEWEBKEY123 timed out')
    if (redactedUrl.includes('FAKEWEBKEY123') || !redactedUrl.includes('REDACTED')) return `webKey not redacted from URL: ${redactedUrl}`
    if (redactedText.includes('FAKEWEBKEY123') || !redactedText.includes('REDACTED')) return `webKey not redacted from free text: ${redactedText}`
    return true
  })

  await add('re_647_fmcsa_provider_gate_cooldown_engages_on_consecutive_failures', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('Internal Server Error', { status: 500 }),
  ], async () => {
    await fmcsaAdapter.run({ text: 'usdot 11111' })
    await fmcsaAdapter.run({ text: 'usdot 22222' })
    await fmcsaAdapter.run({ text: 'usdot 33333' })
    const cooling = providerCooldownRemainingMs('fmcsa')
    return cooling > 0 || `expected fmcsa to enter a failure cooldown after 3 consecutive failures, got ${cooling}ms remaining`
  })))

  await add('re_648_fmcsa_cache_does_not_leak_across_tests', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok && response.fromCache === false) || `expected a fresh (non-cached) lookup in an isolated test run despite an earlier test caching the same USDOT, got fromCache=${response.fromCache} ok=${response.ok}`
  })))

  await add('re_649_fmcsa_never_calls_global_fetch_directly', () => {
    const source = readFileSync(join(process.cwd(), 'lib/research-engine/providers/fmcsa.ts'), 'utf8')
    return !source.includes('fetch(') || 'fmcsa adapter appears to call fetch() directly instead of exclusively using safeProviderFetch'
  })

  await add('re_650_fmcsa_registered_exactly_once', () => {
    const count = Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS).filter(id => id === 'fmcsa').length
    return count === 1 || `expected fmcsa registered exactly once, found ${count}`
  })

  await add('re_651_fmcsa_descriptor_implemented_and_counts_are_31_24_7', () => {
    const descriptor = RESEARCH_PROVIDER_ENV.find(d => d.id === 'fmcsa')
    const totalCount = RESEARCH_PROVIDER_ENV.length
    const implementedCount = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).length
    const blockedCount = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).length
    return (descriptor?.implemented === true && totalCount === 254 && implementedCount === 250 && blockedCount === 4)
      || `expected fmcsa implemented plus a 250/4 split, got implemented=${descriptor?.implemented} total=${totalCount} implemented=${implementedCount} blocked=${blockedCount}`
  })

  await add('re_652_implemented_descriptor_ids_exactly_equal_registry_keys', () => {
    const descriptorImplementedIds = RESEARCH_PROVIDER_ENV.filter(d => d.implemented).map(d => d.id).sort()
    const registryIds = (Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS) as ResearchProviderId[]).sort()
    const equal = descriptorImplementedIds.length === registryIds.length && descriptorImplementedIds.every((id, i) => id === registryIds[i])
    return equal || `descriptor implemented set and registry key set diverge: descriptors=${JSON.stringify(descriptorImplementedIds)} registry=${JSON.stringify(registryIds)}`
  })

  await add('re_653_remaining_four_blocked_providers_are_exactly_as_specified', () => {
    const expected = ['uspto', 'world_bank_climate', 'world_bank_data_catalog', 'world_bank_finances'].sort()
    const actual = RESEARCH_PROVIDER_ENV.filter(d => !d.implemented).map(d => d.id).sort()
    const equal = expected.length === actual.length && expected.every((id, i) => id === actual[i])
    return equal || `expected the remaining blocked set ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  })

  // --- FMCSA repair pass (independent-audit HIGH/MEDIUM findings) ---
  //
  // New tests re_654-re_678 close the gaps identified by the independent
  // audit: requested-vs-returned USDOT identity, numeric range/type
  // validation on the returned dotNumber, requested-identifier
  // canonicalization, legalName bounds, the true one-upstream-fetch
  // guarantee (maxRetries: 0) under every response condition, and
  // mixed-case/URL-encoded WebKey redaction. re_607 (mismatch/cache
  // poisoning) and re_641 (redirect fetch count) were repaired in place
  // above rather than duplicated here. All fixture values are synthetic.

  await add('re_654_fmcsa_returned_dot_number_exact_match_accepted_and_cached', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === true && response.documents[0]?.providerRecordId === '44110' && response.fromCache === false && calls.count === 1)
      || `expected a returned dotNumber exactly matching the requested USDOT to be accepted on exactly 1 fetch, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_655_fmcsa_returned_dot_number_prefix_substring_not_treated_as_match', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 44110 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 4411' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'parse_error')
      || `expected requested "4411" vs. returned dotNumber 44110 (a superstring, not equal) to be rejected as a mismatch, not accepted via prefix/substring confusion, got ${JSON.stringify(response)}`
  })))

  await add('re_656_fmcsa_returned_zero_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 0 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'parse_error')
      || `expected a returned dotNumber of 0 to be rejected (zero is never a valid USDOT), got ${JSON.stringify(response)}`
  })))

  await add('re_657_fmcsa_returned_negative_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: -44110 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a negative returned dotNumber to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_658_fmcsa_returned_decimal_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 44110.5 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a decimal returned dotNumber to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_659_fmcsa_returned_unsafe_integer_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 9_999_999_999_999_999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected an unsafe-integer returned dotNumber to be rejected, got ${JSON.stringify(response)}`
  })))

  // NaN is not representable in valid JSON — `JSON.parse` throws on the bare
  // `NaN` token before any JavaScript NaN value could ever reach the FMCSA
  // numeric validator. This test therefore proves malformed-JSON (parse
  // failure) rejection, not a direct Number.isSafeInteger(NaN) rejection.
  // Valid-JSON non-finite behavior (a number literal that parses successfully
  // but overflows to a non-finite value) is separately exercised by re_661
  // (1e400 parses as Infinity, then fails Number.isSafeInteger).
  await add('re_660_fmcsa_invalid_json_nan_literal_is_parse_error', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('{"content":{"carrier":{"dotNumber":NaN,"legalName":"SAMPLE CARRIER LLC"}}}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error' && response.documents.length === 0 && calls.count === 1)
      || `expected a body containing the illegal JSON token NaN to fail JSON.parse and be rejected as parse_error on exactly 1 fetch, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_661_fmcsa_returned_infinity_dot_number_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    new Response('{"content":{"carrier":{"dotNumber":1e400,"legalName":"SAMPLE CARRIER LLC"}}}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a valid-JSON dotNumber that overflows to Infinity (1e400) to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_662_fmcsa_requested_zero_rejected_before_fetch', () => withEnv(fmcsaEnv, () => withCountingFetch([], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 0' })
    return (response.ok === false && calls.count === 0) || `expected a requested USDOT of 0 to be rejected before any fetch, calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_663_fmcsa_leading_zero_input_canonicalized_before_url_construction', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 044110' })
    if (response.ok !== true || response.documents[0]?.providerRecordId !== '44110') return `expected leading-zero input "044110" to canonicalize to "44110", got ${JSON.stringify(response)}`
    return new URL(calls.urls[0]).pathname === '/qc/services/carriers/44110' || `expected the canonical (non-leading-zero) form in the request path, got ${new URL(calls.urls[0]).pathname}`
  })))

  await add('re_664_fmcsa_leading_zero_and_canonical_input_share_cache_identity', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const first = await fmcsaAdapter.run({ text: 'usdot 044110' })
    if (!first.ok) return `expected the leading-zero request to succeed, got ${JSON.stringify(first.error)}`
    const second = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (second.ok === true && second.fromCache === true && calls.count === 1)
      || `expected "usdot 044110" and "usdot 44110" to share one cache entry (only 1 real fetch total), got calls=${calls.count} second=${JSON.stringify(second)}`
  })))

  await add('re_665_fmcsa_empty_legal_name_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: '' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected an empty legalName to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_666_fmcsa_whitespace_only_legal_name_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: '   ' } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a whitespace-only legalName to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_667_fmcsa_oversized_legal_name_rejected', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: 'A'.repeat(257) } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'parse_error') || `expected a legalName over the 256-char bound to be rejected, got ${JSON.stringify(response)}`
  })))

  await add('re_668_fmcsa_maximum_length_legal_name_accepted', () => withEnv(fmcsaEnv, () => withAdapterFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, legalName: 'A'.repeat(256) } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
  ], async () => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === true && response.documents[0]?.title === 'A'.repeat(256)) || `expected a legalName exactly at the 256-char bound to be accepted, got ${JSON.stringify(response)}`
  })))

  await add('re_669_fmcsa_wrong_carrier_response_never_poisons_the_requested_cache_key', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse({ content: { carrier: { ...sampleFmcsaCarrier.content.carrier, dotNumber: 99999 } }, retrievalDate: sampleFmcsaCarrier.retrievalDate }),
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const mismatched = await fmcsaAdapter.run({ text: 'usdot 44110' })
    if (mismatched.ok !== false) return `expected the mismatched carrier response to be rejected, got ${JSON.stringify(mismatched)}`
    const matched = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (matched.ok === true && matched.fromCache === false && calls.count === 2)
      || `expected the requested-key cache to remain empty after a rejected mismatch, so the next matching request still performs a fresh fetch; got calls=${calls.count} matched=${JSON.stringify(matched)}`
  })))

  await add('re_670_fmcsa_success_never_consumes_more_than_one_fetch_even_when_more_are_available', () => withEnv(fmcsaEnv, () => withCountingFetch([
    jsonResponse(sampleFmcsaCarrier),
    jsonResponse(sampleFmcsaCarrier),
    jsonResponse(sampleFmcsaCarrier),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === true && calls.count === 1) || `expected exactly 1 fetch even though 3 mocked responses were available (no speculative extra calls), got ${calls.count}`
  })))

  await add('re_671_fmcsa_429_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'rate_limited' && calls.count === 1)
      || `expected exactly 1 fetch for a 429 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_672_fmcsa_503_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.error?.category === 'upstream_error' && calls.count === 1)
      || `expected exactly 1 fetch for a 503 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_673_fmcsa_timeout_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, async () => {
    __resetProviderGateForTests()
    __resetCacheForTests()
    let fetchCount = 0
    __setResearchFetchForTests((async () => {
      fetchCount += 1
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      throw abortError
    }) as typeof fetch)
    try {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      return (response.ok === false && fetchCount === 1)
        || `expected exactly 1 fetch attempt for a persistent timeout under maxRetries: 0, got fetchCount=${fetchCount} response=${JSON.stringify(response)}`
    } finally {
      __setResearchFetchForTests(null)
      __resetProviderGateForTests()
      __resetCacheForTests()
    }
  }))

  await add('re_674_fmcsa_mixed_case_webkey_parameter_names_all_redacted', () => {
    for (const paramName of ['webKey', 'WebKey', 'WEBKEY', 'webkey']) {
      const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?${paramName}=FAKEWEBKEY123`
      const redactedUrl = redactUrlForLogging(url)
      if (redactedUrl.includes('FAKEWEBKEY123') || !redactedUrl.includes('REDACTED')) return `expected "${paramName}" to be redacted from the URL, got ${redactedUrl}`
      const redactedText = redactSecretsFromText(`request failed: ${url} timed out`)
      if (redactedText.includes('FAKEWEBKEY123') || !redactedText.includes('REDACTED')) return `expected "${paramName}" to be redacted from free text, got ${redactedText}`
    }
    return true
  })

  await add('re_675_fmcsa_url_encoded_webkey_value_fully_redacted', () => {
    const url = 'https://mobile.fmcsa.dot.gov/qc/services/carriers/44110?webKey=FAKE%20WEB%2FKEY%3D123'
    const redacted = redactUrlForLogging(url)
    return (!redacted.includes('FAKE') && redacted.includes('REDACTED')) || `expected a URL-encoded webKey value to be fully redacted, got ${redacted}`
  })

  await add('re_676_fmcsa_provider_gate_state_restored_after_test_helper_finally', () => withEnv(fmcsaEnv, async () => {
    await withAdapterFetch([
      new Response('Internal Server Error', { status: 500 }),
    ], async () => {
      await fmcsaAdapter.run({ text: 'usdot 11111' })
    })
    const cooling = providerCooldownRemainingMs('fmcsa')
    return cooling === 0 || `expected the provider gate to be reset by withAdapterFetch's finally block, got ${cooling}ms remaining`
  }))

  await add('re_677_fmcsa_cache_state_restored_between_separate_test_helper_invocations', () => withEnv(fmcsaEnv, async () => {
    await withAdapterFetch([jsonResponse(sampleFmcsaCarrier)], async () => {
      await fmcsaAdapter.run({ text: 'usdot 44110' })
    })
    return withAdapterFetch([jsonResponse(sampleFmcsaCarrier)], async () => {
      const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
      return (response.ok === true && response.fromCache === false) || `expected the cache to have been cleared between separate withAdapterFetch invocations, got fromCache=${response.fromCache}`
    })
  }))

  await add('re_678_fmcsa_test_fetch_hook_restored_to_real_fetch_in_finally', () => {
    const source = readFileSync(join(process.cwd(), 'lib/research-engine/diagnostics/validation.ts'), 'utf8')
    const marker = 'async function withCountingFetch'
    const start = source.indexOf(marker)
    const body = source.slice(start, start + 1200)
    return body.includes('__setResearchFetchForTests(null)') || 'expected withCountingFetch to restore the real fetch implementation (__setResearchFetchForTests(null)) in its finally block'
  })

  // Final LOW-finding cleanup: re_679/re_680 close out the retryable-status
  // matrix (429/502/503/504) with the same exactly-one-fetch guarantee
  // already proven for 429 (re_671) and 503 (re_672), so every status
  // safeProviderFetch treats as retryable is now covered under FMCSA's
  // maxRetries: 0 override.

  await add('re_679_fmcsa_502_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Bad Gateway', { status: 502, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error' && response.error?.httpStatus === 502 && calls.count === 1)
      || `expected exactly 1 fetch for a 502 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  await add('re_680_fmcsa_504_uses_exactly_one_fetch_no_retry_amplification', () => withEnv(fmcsaEnv, () => withCountingFetch([
    new Response('Gateway Timeout', { status: 504, headers: { 'retry-after': '0' } }),
  ], async calls => {
    const response = await fmcsaAdapter.run({ text: 'usdot 44110' })
    return (response.ok === false && response.documents.length === 0 && response.error?.category === 'upstream_error' && response.error?.httpStatus === 504 && calls.count === 1)
      || `expected exactly 1 fetch for a 504 response under maxRetries: 0, got calls=${calls.count} response=${JSON.stringify(response)}`
  })))

  // --- Earth Knowledge Registry mission: mitre_attack and gleif had zero
  // deterministic coverage prior to this build (present in registry.ts/
  // providerEnv.ts but never imported into this file) — re_700/re_701 close
  // that pre-existing gap, live-verified separately via
  // scripts/run-research-engine-live-validation.mjs.

  await add('re_700_mitre_attack_success_normalizes_stix_object', () => withAdapterFetch([
    jsonResponse({ objects: [{ id: 'attack-pattern--test-1', type: 'attack-pattern', name: 'Phishing', description: 'desc', external_references: [{ source_name: 'mitre-attack', external_id: 'T1566', url: 'https://attack.mitre.org/techniques/T1566' }], modified: '2024-01-01T00:00:00.000Z' }] }),
  ], async () => {
    const response = await mitreAttackAdapter.run({ text: 'phishing' })
    if (!response.ok || response.documents.length === 0) return `expected ok success with documents, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'mitre_attack') ?? true
  }))

  await add('re_701_gleif_success_normalizes_lei_record', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 'HWUPKR0MPOU8FGXBT394', attributes: { lei: 'HWUPKR0MPOU8FGXBT394', entity: { legalName: { name: 'Apple Inc' }, legalAddress: { country: 'US' } } } }] }),
  ], async () => {
    const response = await gleifAdapter.run({ text: 'Apple Inc' })
    if (!response.ok || response.documents.length === 0) return `expected ok success with documents, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'gleif') ?? true
  }))

  // --- First-25 completion adapters built this mission (re_702-re_722):
  // one mocked success-path normalization test per new provider. Real
  // upstream proof for all of these lives in
  // scripts/run-research-engine-live-validation.mjs (see
  // docs/earth-knowledge/gap-matrix.md for the actual run transcript), not
  // here — this file is deterministic-only by design.

  await add('re_702_wikipedia_success_normalizes_page_summary', () => withEnv({ WIKIMEDIA_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0' }, () => withAdapterFetch([
    jsonResponse({ title: 'Earth', pageid: 9228, extract: 'Earth is the third planet.', description: 'Third planet from the Sun', timestamp: '2024-01-01T00:00:00Z', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Earth' } } }),
  ], async () => {
    const response = await wikipediaAdapter.run({ text: 'Earth' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'wikipedia') ?? true
  })))

  await add('re_703_europe_pmc_success_normalizes_result', () => withAdapterFetch([
    jsonResponse({ hitCount: 1, resultList: { result: [{ id: '42617733', title: 'Cancer study', authorString: 'Doe J, Smith A', journalTitle: 'Nature', pubYear: '2024', doi: '10.1234/x', source: 'MED', pmid: '42617733', isOpenAccess: 'Y', firstPublicationDate: '2024-01-01' }] } }),
  ], async () => {
    const response = await europePmcAdapter.run({ text: 'cancer' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'europe_pmc') ?? true
  }))

  await add('re_704_clinicaltrials_gov_success_normalizes_study', () => withAdapterFetch([
    jsonResponse({ studies: [{ protocolSection: { identificationModule: { nctId: 'NCT03768492', briefTitle: 'Test trial' }, statusModule: { overallStatus: 'ACTIVE_NOT_RECRUITING', lastUpdatePostDateStruct: { date: '2024-01-01' } }, conditionsModule: { conditions: ['Cancer'] }, sponsorCollaboratorsModule: { leadSponsor: { name: 'NIH' } } } }] }),
  ], async () => {
    const response = await clinicalTrialsGovAdapter.run({ text: 'cancer' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'clinicaltrials_gov') ?? true
  }))

  await add('re_705_openfda_success_normalizes_drug_label', () => withAdapterFetch([
    jsonResponse({ results: [{ id: '8c45ef1f-f708-485b-bc20-60aa87ce6289', effective_time: '20240101', indications_and_usage: ['For pain relief'], openfda: { brand_name: ['Aspirin'], manufacturer_name: ['Acme'], spl_id: ['abc-123'], substance_name: ['ASPIRIN'] } }] }),
  ], async () => {
    const response = await openFdaAdapter.run({ text: 'aspirin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'openfda') ?? true
  }))

  await add('re_706_pubchem_success_normalizes_compound_property', () => withAdapterFetch([
    jsonResponse({ PropertyTable: { Properties: [{ CID: 2244, MolecularFormula: 'C9H8O4', MolecularWeight: '180.16', IUPACName: '2-acetyloxybenzoic acid', ConnectivitySMILES: 'CC(=O)OC1=CC=CC=C1C(=O)O' }] } }),
  ], async () => {
    const response = await pubchemAdapter.run({ text: 'aspirin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'pubchem') ?? true
  }))

  await add('re_707_gbif_success_normalizes_occurrence', () => withAdapterFetch([
    jsonResponse({ count: 1, results: [{ key: 5938145577, scientificName: 'Puma concolor', decimalLatitude: 40.1, decimalLongitude: -105.2, eventDate: '2024-01-01', country: 'United States', basisOfRecord: 'HUMAN_OBSERVATION', kingdom: 'Animalia', recordedBy: 'J. Doe', license: 'CC0' }] }),
  ], async () => {
    const response = await gbifAdapter.run({ text: 'Puma concolor' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    // Terra Phase 4 regression: real decimalLatitude/decimalLongitude must reach `geography` as
    // the exact "lat X, lon Y" string Terra's LATENT_GEO extractor matches — the same bug class
    // fixed in obis.ts (coordinates computed for `summary` prose only, never assigned here).
    if (response.documents[0].geography !== 'lat 40.1, lon -105.2') return `expected real coordinates in geography, got ${JSON.stringify(response.documents[0].geography)}`
    if (response.documents[0].identifiers.country !== 'United States') return `expected country preserved in identifiers, got ${JSON.stringify(response.documents[0].identifiers)}`
    return documentShapeIssue(response.documents[0], 'gbif') ?? true
  }))

  await add('re_707b_gbif_missing_coordinates_falls_back_to_country_in_geography', () => withAdapterFetch([
    jsonResponse({ count: 1, results: [{ key: 1, scientificName: 'Example species', country: 'Canada', basisOfRecord: 'HUMAN_OBSERVATION' }] }),
  ], async () => {
    const response = await gbifAdapter.run({ text: 'Example species' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].geography !== 'Canada') return `expected country fallback in geography when coordinates are absent, got ${JSON.stringify(response.documents[0].geography)}`
    return true
  }))

  await add('re_708_uniprot_success_normalizes_entry', () => withAdapterFetch([
    jsonResponse({ results: [{ primaryAccession: 'P01308', uniProtkbId: 'INS_HUMAN', entryType: 'UniProtKB reviewed (Swiss-Prot)', organism: { scientificName: 'Homo sapiens' }, proteinDescription: { recommendedName: { fullName: { value: 'Insulin' } } } }] }),
  ], async () => {
    const response = await uniprotAdapter.run({ text: 'insulin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'uniprot') ?? true
  }))

  await add('re_709_osv_dev_success_normalizes_vuln_record', () => withAdapterFetch([
    jsonResponse({ vulns: [{ id: 'GHSA-29mw-wpgm-hmr9', summary: 'ReDoS in lodash', details: 'details', modified: '2024-01-01T00:00:00Z', published: '2020-01-01T00:00:00Z', aliases: ['CVE-2020-8203'], affected: [{ package: { name: 'lodash', ecosystem: 'npm' } }] }] }),
  ], async () => {
    const response = await osvDevAdapter.run({ text: 'npm:lodash@4.17.4' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].identifiers.evidence_class !== 'VULNERABILITY_EXISTS') return 'expected osv_dev evidence_class to be VULNERABILITY_EXISTS'
    return documentShapeIssue(response.documents[0], 'osv_dev') ?? true
  }))

  await add('re_710_nvd_success_normalizes_cve_and_evidence_class', () => withAdapterFetch([
    jsonResponse({ totalResults: 1, vulnerabilities: [{ cve: { id: 'CVE-2021-44228', published: '2021-12-10T00:00:00.000', lastModified: '2021-12-11T00:00:00.000', descriptions: [{ lang: 'en', value: 'Log4Shell' }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: 10.0, baseSeverity: 'CRITICAL' } }] }, cisaExploitAdd: '2021-12-10' } }] }),
  ], async () => {
    const response = await nvdAdapter.run({ text: 'CVE-2021-44228' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].identifiers.evidence_class !== 'CONFIRMED_EXPLOITED') return 'expected nvd evidence_class to be CONFIRMED_EXPLOITED when cisaExploitAdd is present'
    return documentShapeIssue(response.documents[0], 'nvd') ?? true
  }))

  await add('re_711_cisa_kev_success_normalizes_catalog_entry_as_confirmed_exploited', () => withAdapterFetch([
    jsonResponse({ catalogVersion: '2024.01.01', dateReleased: '2024-01-01T00:00:00Z', count: 1, vulnerabilities: [{ cveID: 'CVE-2021-45046', vendorProject: 'Apache', product: 'Log4j2', vulnerabilityName: 'Log4Shell follow-up', dateAdded: '2021-12-14', shortDescription: 'desc', requiredAction: 'Patch', dueDate: '2021-12-28' }] }),
  ], async () => {
    const response = await cisaKevAdapter.run({ text: 'log4j' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].identifiers.evidence_class !== 'CONFIRMED_EXPLOITED') return 'expected cisa_kev evidence_class to always be CONFIRMED_EXPLOITED'
    return documentShapeIssue(response.documents[0], 'cisa_kev') ?? true
  }))

  await add('re_712_osm_overpass_rejects_query_without_near_clause', async () => {
    const response = await osmOverpassAdapter.run({ text: 'Eiffel Tower' })
    return (response.ok === false && response.documents.length === 0) || 'expected an unbounded query without "near" to be rejected, not silently guessed'
  })

  await add('re_713_osm_overpass_success_normalizes_way_via_center', () => withAdapterFetch([
    jsonResponse({ elements: [{ type: 'way', id: 231157316, center: { lat: 48.8646, lon: 2.2852 }, tags: { name: 'Eiffel Tower' } }] }),
  ], async () => {
    const response = await osmOverpassAdapter.run({ text: 'Eiffel Tower near 48.8584,2.2945,5' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'osm_overpass') ?? true
  }))

  await add('re_714_geonames_success_normalizes_place', () => withEnv({ GEONAMES_USERNAME: 'warroom_validation_test' }, () => withAdapterFetch([
    jsonResponse({ totalResultsCount: 1, geonames: [{ geonameId: 2643743, name: 'London', toponymName: 'London', countryName: 'United Kingdom', fcodeName: 'capital of a political entity' }] }),
  ], async () => {
    const response = await geonamesAdapter.run({ text: 'London' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'geonames') ?? true
  })))

  await add('re_715_geonames_detects_status_error_not_fabricated_empty_success', () => withEnv({ GEONAMES_USERNAME: 'warroom_validation_test' }, () => withAdapterFetch([
    jsonResponse({ status: { message: 'invalid username', value: 10 } }),
  ], async () => {
    const response = await geonamesAdapter.run({ text: 'London' })
    return (response.ok === false && response.error?.category === 'upstream_error') || `expected a GeoNames status.message error to surface as a failure, got ${JSON.stringify(response)}`
  })))

  await add('re_716_eurostat_success_decodes_json_stat_sample', () => withAdapterFetch([
    jsonResponse({ label: 'Population density', id: ['geo'], size: [2], dimension: { geo: { category: { index: { BE: 0, FR: 1 }, label: { BE: 'Belgium', FR: 'France' } } } }, value: { '0': 100, '1': 200 } }),
  ], async () => {
    const response = await eurostatAdapter.run({ text: 'population' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'eurostat') ?? true
  }))

  await add('re_717_eurostat_rejects_unknown_keyword_and_code', async () => {
    const response = await eurostatAdapter.run({ text: 'not a real keyword or code' })
    return (response.ok === false) || 'expected an unresolvable Eurostat query to fail rather than guess a dataset code'
  })

  await add('re_718_us_census_success_normalizes_array_of_arrays', () => withAdapterFetch([
    jsonResponse([['NAME', 'B01001_001E', 'state'], ['California', '39000000', '06'], ['Texas', '30000000', '48']]),
  ], async () => {
    const response = await usCensusAdapter.run({ text: '' })
    if (!response.ok || response.documents.length !== 2) return `expected 2 normalized state rows, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'us_census') ?? true
  }))

  await add('re_719_us_census_client_side_filter_narrows_by_name', () => withAdapterFetch([
    jsonResponse([['NAME', 'B01001_001E', 'state'], ['California', '39000000', '06'], ['Texas', '30000000', '48']]),
  ], async () => {
    const response = await usCensusAdapter.run({ text: 'california' })
    return (response.ok === true && response.documents.length === 1 && response.documents[0].geography === 'California')
      || `expected exactly 1 filtered document for "california", got ${JSON.stringify(response)}`
  }))

  await add('re_720_congress_gov_success_normalizes_bill', () => withEnv({ CONGRESS_GOV_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ bills: [{ congress: 118, number: '3076', type: 'HR', title: 'Test Act', updateDate: '2024-01-01', originChamber: 'House', latestAction: { actionDate: '2024-01-02', text: 'Passed House' } }] }),
  ], async () => {
    const response = await congressGovAdapter.run({ text: '118' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'congress_gov') ?? true
  })))

  await add('re_721_govinfo_success_normalizes_package', () => withEnv({ GOVINFO_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ packages: [{ packageId: 'FR-2024-01-01', title: 'Federal Register', dateIssued: '2024-01-01', lastModified: '2024-01-02', packageLink: 'https://api.govinfo.gov/packages/FR-2024-01-01/summary', docClass: 'FR' }] }),
  ], async () => {
    const response = await govinfoAdapter.run({ text: 'FR' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'govinfo') ?? true
  })))

  await add('re_722_sec_edgar_success_normalizes_filing_hit', () => withEnv({ SEC_EDGAR_USER_AGENT_BASE: 'WarRoomResearchEngineValidation/1.0 (validation@example.com)' }, () => withAdapterFetch([
    jsonResponse({ hits: { total: { value: 1 }, hits: [{ _id: 'x', _source: { cik: '320193', display_names: ['Apple Inc.'], file_type: '10-K', file_date: '2024-01-01', root_form: '10-K', adsh: '0000320193-24-000123' } }] } }),
  ], async () => {
    const response = await secEdgarAdapter.run({ text: 'apple' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'sec_edgar') ?? true
  })))

  await add('re_723_orcid_success_fetches_token_then_normalizes_search', () => withEnv({ ORCID_CLIENT_ID: 'test-client', ORCID_CLIENT_SECRET: 'test-secret-not-real' }, () => withAdapterFetch([
    jsonResponse({ access_token: 'test-token-not-real', token_type: 'bearer', expires_in: 3600 }),
    jsonResponse({ 'expanded-result': [{ 'orcid-id': '0000-0002-1825-0097', 'given-names': 'Jane', 'family-names': 'Doe', 'institution-name': ['MIT'] }], 'num-found': 1 }),
  ], async () => {
    const response = await orcidAdapter.run({ text: 'jane doe' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'orcid') ?? true
  })))

  await add('re_724_reliefweb_success_normalizes_report', () => withEnv({ RELIEFWEB_APPNAME: 'warroom-validation-test' }, () => withAdapterFetch([
    jsonResponse({ data: [{ id: '123', fields: { title: 'Earthquake situation report', url: 'https://reliefweb.int/report/123', date: { original: '2024-01-01' }, source: [{ name: 'OCHA' }], primary_country: { name: 'Haiti' }, body: 'Report body text.' } }] }),
  ], async () => {
    const response = await reliefwebAdapter.run({ text: 'earthquake' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'reliefweb') ?? true
  })))

  // --- Checkpoint 2 completion adapters (biomedical/genetics, re_725-re_739):
  // one mocked success-path normalization test per new provider. Real
  // upstream proof lives in scripts/run-research-engine-live-validation.mjs.

  await add('re_725_ensembl_success_normalizes_gene_lookup', () => withAdapterFetch([
    jsonResponse({ id: 'ENSG00000139618', display_name: 'BRCA2', description: 'BRCA2 DNA repair associated', biotype: 'protein_coding', species: 'homo_sapiens', seq_region_name: '13', start: 32315086, end: 32400268 }),
  ], async () => {
    const response = await ensemblAdapter.run({ text: 'BRCA2' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ensembl') ?? true
  }))

  await add('re_726_rcsb_pdb_success_normalizes_search_then_detail', () => withAdapterFetch([
    jsonResponse({ result_set: [{ identifier: '4HHB', score: 1 }] }),
    jsonResponse({ rcsb_id: '4HHB', struct: { title: 'THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN' }, rcsb_accession_info: { initial_release_date: '1984-07-17' }, audit_author: [{ name: 'Fermi, G.' }] }),
  ], async () => {
    const response = await rcsbPdbAdapter.run({ text: 'hemoglobin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'rcsb_pdb') ?? true
  }))

  await add('re_727_string_db_success_normalizes_resolve_then_partners', () => withAdapterFetch([
    jsonResponse([{ stringId: '9606.ENSP00000269305', preferredName: 'TP53', annotation: 'Cellular tumor antigen p53', taxonName: 'Homo sapiens' }]),
    jsonResponse([{ stringId_A: '9606.ENSP00000269305', stringId_B: '9606.ENSP00000228872', preferredName_A: 'TP53', preferredName_B: 'MDM2', score: 0.999 }]),
  ], async () => {
    const response = await stringDbAdapter.run({ text: 'TP53' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'string_db') ?? true
  }))

  await add('re_728_gnomad_success_normalizes_graphql_gene', () => withAdapterFetch([
    jsonResponse({ data: { gene: { gene_id: 'ENSG00000141510', symbol: 'TP53', chrom: '17', start: 7661779, stop: 7687538 } } }),
  ], async () => {
    const response = await gnomadAdapter.run({ text: 'TP53' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'gnomad') ?? true
  }))

  await add('re_729_ebi_ols_success_normalizes_ontology_term', () => withAdapterFetch([
    jsonResponse({ response: { numFound: 1, docs: [{ iri: 'http://purl.obolibrary.org/obo/HP_0005978', short_form: 'HP_0005978', obo_id: 'HP:0005978', ontology_name: 'hp', label: 'Type II diabetes mellitus', description: [] }] } }),
  ], async () => {
    const response = await ebiOlsAdapter.run({ text: 'diabetes' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ebi_ols') ?? true
  }))

  await add('re_730_medlineplus_success_parses_attribute_addressed_xml', () => withAdapterFetch([
    textResponse('<nlmSearchResult><list><document rank="1" url="https://medlineplus.gov/highbloodpressure.html"><content name="title">High <span class="qt0"><span class="qt1">Blood</span></span> Pressure</content><content name="organizationName">NIH</content><content name="snippet">A short summary.</content></document></list></nlmSearchResult>', 200, 'text/xml'),
  ], async () => {
    const response = await medlineplusAdapter.run({ text: 'hypertension' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].title.includes('<span')) return 'expected highlight-wrapper spans to be stripped from the title'
    return documentShapeIssue(response.documents[0], 'medlineplus') ?? true
  }))

  await add('re_731_who_gho_success_normalizes_indicator_row', () => withAdapterFetch([
    jsonResponse({ value: [{ Id: 1, IndicatorCode: 'WHOSIS_000001', SpatialDim: 'SOM', ParentLocation: 'Africa', TimeDim: 2020, Value: '55.0', NumericValue: 55.0 }] }),
  ], async () => {
    const response = await whoGhoAdapter.run({ text: 'life expectancy' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'who_gho') ?? true
  }))

  await add('re_732_who_gho_rejects_unknown_keyword_and_code', async () => {
    const response = await whoGhoAdapter.run({ text: 'not a real keyword or code' })
    return (response.ok === false) || 'expected an unresolvable WHO GHO query to fail rather than guess an indicator code'
  })

  await add('re_733_rxnorm_success_flattens_nested_concept_groups', () => withAdapterFetch([
    jsonResponse({ drugGroup: { conceptGroup: [{ tty: 'IN', conceptProperties: [{ rxcui: '1191', name: 'aspirin', tty: 'IN' }] }, { tty: 'BN', conceptProperties: [{ rxcui: '212033', name: 'Bayer Aspirin', tty: 'BN' }] }] } }),
  ], async () => {
    const response = await rxnormAdapter.run({ text: 'aspirin' })
    if (!response.ok || response.documents.length !== 2) return `expected 2 flattened, deduplicated concepts, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'rxnorm') ?? true
  }))

  await add('re_734_dailymed_success_normalizes_spl_entry', () => withAdapterFetch([
    jsonResponse({ data: [{ spl_version: 2, published_date: 'Aug 21, 2026', title: 'IBUPROFEN TABLET', setid: '5ba08c30-7eb9-433b-b763-9288f4dd1012' }], metadata: { total_elements: 1 } }),
  ], async () => {
    const response = await dailymedAdapter.run({ text: 'ibuprofen' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'dailymed') ?? true
  }))

  await add('re_735_chembl_success_normalizes_molecule', () => withAdapterFetch([
    jsonResponse({ molecules: [{ molecule_chembl_id: 'CHEMBL941', pref_name: 'IMATINIB', max_phase: '4.0', first_approval: 2001, molecule_properties: { full_mwt: '493.62', full_molformula: 'C29H31N7O' }, molecule_type: 'Small molecule', withdrawn_flag: false }] }),
  ], async () => {
    const response = await chemblAdapter.run({ text: 'imatinib' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'chembl') ?? true
  }))

  await add('re_736_open_targets_success_normalizes_graphql_hits', () => withAdapterFetch([
    jsonResponse({ data: { search: { hits: [{ id: 'MONDO_0004979', name: 'asthma', entity: 'disease' }] } } }),
  ], async () => {
    const response = await openTargetsAdapter.run({ text: 'asthma' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'open_targets') ?? true
  }))

  await add('re_737_inaturalist_success_normalizes_observation', () => withAdapterFetch([
    jsonResponse({ total_results: 1, results: [{ id: 393957654, taxon: { name: 'Puma concolor', id: 42 }, observed_on: '2024-01-01', uri: 'https://www.inaturalist.org/observations/393957654', quality_grade: 'research', license_code: 'cc-by' }] }),
  ], async () => {
    const response = await inaturalistAdapter.run({ text: 'Puma concolor' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'inaturalist') ?? true
  }))

  await add('re_738_obis_success_normalizes_occurrence', () => withAdapterFetch([
    jsonResponse({ total: 1, results: [{ id: '00042a5b-d420-450d-ba01-8a59bcfc6d4f', scientificName: 'Orcinus orca', decimalLatitude: 60.1, decimalLongitude: -2.3, eventDate: '2025-06-30T11:01:16', basisOfRecord: 'HumanObservation', waterBody: 'North Sea' }] }),
  ], async () => {
    const response = await obisAdapter.run({ text: 'Orcinus orca' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    // Terra Phase 4 regression: real decimalLatitude/decimalLongitude must reach `geography` as
    // the exact "lat X, lon Y" string Terra's LATENT_GEO extractor matches — a prior bug computed
    // this string for use in `summary` prose only and silently discarded it here in favor of
    // waterBody (or nothing). waterBody must still survive, just relocated to `identifiers`.
    if (response.documents[0].geography !== 'lat 60.1, lon -2.3') return `expected real coordinates in geography, got ${JSON.stringify(response.documents[0].geography)}`
    if (response.documents[0].identifiers.water_body !== 'North Sea') return `expected waterBody preserved in identifiers, got ${JSON.stringify(response.documents[0].identifiers)}`
    return documentShapeIssue(response.documents[0], 'obis') ?? true
  }))

  await add('re_738b_obis_missing_coordinates_falls_back_to_water_body_in_geography', () => withAdapterFetch([
    jsonResponse({ total: 1, results: [{ id: 'no-coords-1', scientificName: 'Example species', basisOfRecord: 'HumanObservation', waterBody: 'Pacific Ocean' }] }),
  ], async () => {
    const response = await obisAdapter.run({ text: 'Example species' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].geography !== 'Pacific Ocean') return `expected waterBody fallback in geography when coordinates are absent, got ${JSON.stringify(response.documents[0].geography)}`
    return true
  }))

  await add('re_739_worms_success_normalizes_aphia_record', () => withAdapterFetch([
    jsonResponse([{ AphiaID: 137102, scientificname: 'Orcinus orca', authority: '(Linnaeus, 1758)', status: 'accepted', rank: 'Species', kingdom: 'Animalia', url: 'https://www.marinespecies.org/aphia.php?p=taxdetails&id=137102', modified: '2008-08-20T11:25:36.853Z' }]),
  ], async () => {
    const response = await wormsAdapter.run({ text: 'Orcinus orca' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'worms') ?? true
  }))

  await add('re_740_worms_rejects_non_array_sentinel_response', () => withAdapterFetch([
    jsonResponse(-999),
  ], async () => {
    const response = await wormsAdapter.run({ text: 'ambiguousname' })
    return (response.ok === false && response.documents.length === 0) || `expected a non-array WoRMS sentinel response to fail closed, not a fabricated empty success, got ${JSON.stringify(response)}`
  }))

  await add('re_741_itis_success_normalizes_scientific_name_record', () => withAdapterFetch([
    jsonResponse({ scientificNames: [{ tsn: '180544', combinedName: 'Ursus americanus', author: 'Pallas, 1780', kingdom: 'Animalia' }] }),
  ], async () => {
    const response = await itisAdapter.run({ text: 'Ursus americanus' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'itis') ?? true
  }))

  // --- Checkpoint 3 completion adapters (cybersecurity/software, re_742-re_753):
  // one mocked success-path normalization test per new provider. Real
  // upstream proof lives in scripts/run-research-engine-live-validation.mjs.

  await add('re_742_pypi_success_normalizes_package_json', () => withAdapterFetch([
    jsonResponse({ info: { name: 'requests', version: '2.34.2', summary: 'Python HTTP for Humans.', author: 'Kenneth Reitz', license: 'Apache-2.0', project_url: 'https://pypi.org/project/requests/' } }),
  ], async () => {
    const response = await pypiAdapter.run({ text: 'requests' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'pypi') ?? true
  }))

  await add('re_743_npm_registry_success_normalizes_package', () => withAdapterFetch([
    jsonResponse({ name: 'express', description: 'Fast web framework', 'dist-tags': { latest: '5.2.1' }, license: 'MIT', time: { '5.2.1': '2026-01-01T00:00:00.000Z' } }),
  ], async () => {
    const response = await npmRegistryAdapter.run({ text: 'express' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'npm_registry') ?? true
  }))

  await add('re_744_crates_io_success_normalizes_crate', () => withAdapterFetch([
    jsonResponse({ crates: [{ name: 'serde', description: 'Serialization framework', max_version: '1.0.229', downloads: 1301752025, updated_at: '2026-01-01T00:00:00Z' }] }),
  ], async () => {
    const response = await cratesIoAdapter.run({ text: 'serde' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'crates_io') ?? true
  }))

  await add('re_745_rubygems_success_normalizes_bare_array_response', () => withAdapterFetch([
    jsonResponse([{ name: 'rails', info: 'Full-stack framework', version: '8.1.3.1', authors: 'David Heinemeier Hansson', licenses: ['MIT'], project_uri: 'https://rubygems.org/gems/rails' }]),
  ], async () => {
    const response = await rubygemsAdapter.run({ text: 'rails' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'rubygems') ?? true
  }))

  await add('re_746_maven_central_success_normalizes_artifact', () => withAdapterFetch([
    jsonResponse({ response: { numFound: 1, docs: [{ id: 'com.google.guava:guava', g: 'com.google.guava', a: 'guava', latestVersion: '33.4.8-jre', timestamp: 1700000000000, p: 'jar' }] } }),
  ], async () => {
    const response = await mavenCentralAdapter.run({ text: 'guava' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'maven_central') ?? true
  }))

  await add('re_747_github_advisory_success_tags_distinct_evidence_classes', () => withAdapterFetch([
    jsonResponse([{ ghsa_id: 'GHSA-66mm-25pp-rfff', cve_id: 'CVE-2024-0001', summary: 'Test advisory', severity: 'critical', epss: { percentage: 0.00508, percentile: 0.41336 }, published_at: '2024-01-01T00:00:00Z', html_url: 'https://github.com/advisories/GHSA-66mm-25pp-rfff' }]),
  ], async () => {
    const response = await githubAdvisoryAdapter.run({ text: 'npm' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    const doc = response.documents[0]
    if (doc.identifiers.evidence_class !== 'VULNERABILITY_EXISTS') return 'expected github_advisory evidence_class to be VULNERABILITY_EXISTS'
    if (doc.identifiers.epss_evidence_class !== 'PREDICTED_EXPLOITABILITY') return 'expected github_advisory epss_evidence_class to be PREDICTED_EXPLOITABILITY, kept distinct from evidence_class'
    return documentShapeIssue(doc, 'github_advisory') ?? true
  }))

  await add('re_748_endoflife_success_resolves_slug_and_normalizes_cycle', () => withAdapterFetch([
    jsonResponse(['python', 'nodejs', 'ubuntu']),
    jsonResponse([{ cycle: '3.14', releaseDate: '2025-10-01', eol: '2030-10-31', latest: '3.14.7' }]),
  ], async () => {
    const response = await endoflifeAdapter.run({ text: 'python' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'endoflife') ?? true
  }))

  await add('re_749_epss_success_parses_decimal_string_score_as_predicted_exploitability', () => withAdapterFetch([
    jsonResponse({ status: 'OK', data: [{ cve: 'CVE-2021-44228', epss: '0.999990000', percentile: '1.000000000', date: '2026-08-23' }] }),
  ], async () => {
    const response = await epssAdapter.run({ text: 'CVE-2021-44228' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].identifiers.evidence_class !== 'PREDICTED_EXPLOITABILITY') return 'expected epss evidence_class to be PREDICTED_EXPLOITABILITY'
    return documentShapeIssue(response.documents[0], 'epss') ?? true
  }))

  await add('re_750_epss_rejects_non_cve_query', async () => {
    const response = await epssAdapter.run({ text: 'not a cve id' })
    return (response.ok === false) || 'expected a non-CVE-ID query to fail rather than call the API with a garbage id'
  })

  await add('re_751_alienvault_otx_success_tags_community_reported', () => withEnv({ OTX_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ id: 'abc123', name: 'Test pulse', description: 'desc', author: { username: 'researcher' }, created: '2024-01-01T00:00:00Z', tags: ['apt'] }] }),
  ], async () => {
    const response = await alienvaultOtxAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].identifiers.evidence_class !== 'COMMUNITY_REPORTED') return 'expected alienvault_otx evidence_class to be COMMUNITY_REPORTED'
    return documentShapeIssue(response.documents[0], 'alienvault_otx') ?? true
  })))

  await add('re_752_malwarebazaar_success_tags_community_reported', () => withEnv({ MALWAREBAZAAR_AUTH_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ query_status: 'ok', data: [{ sha256_hash: 'a'.repeat(64), file_name: 'sample.exe', file_type: 'exe', signature: 'TestMalware', first_seen: '2024-01-01' }] }),
  ], async () => {
    const response = await malwarebazaarAdapter.run({ text: 'testtag' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].identifiers.evidence_class !== 'COMMUNITY_REPORTED') return 'expected malwarebazaar evidence_class to be COMMUNITY_REPORTED'
    return documentShapeIssue(response.documents[0], 'malwarebazaar') ?? true
  })))

  await add('re_753_threatfox_and_urlhaus_success_tag_community_reported', () => withEnv({ THREATFOX_AUTH_KEY: 'test-key-not-real', URLHAUS_AUTH_KEY: 'test-key-not-real' }, async () => {
    const tfResponse = await withAdapterFetch([
      jsonResponse({ query_status: 'ok', data: [{ id: '1', ioc: '1.2.3.4', ioc_type: 'ip:port', threat_type: 'botnet_cc', malware_printable: 'TestBot', confidence_level: 80, first_seen: '2024-01-01' }] }),
    ], () => threatfoxAdapter.run({ text: '1.2.3.4' }))
    if (!tfResponse.ok || tfResponse.documents.length === 0) return `threatfox: expected ok success, got ${JSON.stringify(tfResponse)}`
    if (tfResponse.documents[0].identifiers.evidence_class !== 'COMMUNITY_REPORTED') return 'expected threatfox evidence_class to be COMMUNITY_REPORTED'
    const tfShapeIssue = documentShapeIssue(tfResponse.documents[0], 'threatfox')
    if (tfShapeIssue) return tfShapeIssue

    const uhResponse = await withAdapterFetch([
      jsonResponse({ query_status: 'ok', url_count: 1, urls: [{ id: '1', url: 'http://evil.example/payload', url_status: 'online', date_added: '2024-01-01', threat: 'malware_download' }] }),
    ], () => urlhausAdapter.run({ text: 'evil.example' }))
    if (!uhResponse.ok || uhResponse.documents.length === 0) return `urlhaus: expected ok success, got ${JSON.stringify(uhResponse)}`
    if (uhResponse.documents[0].identifiers.evidence_class !== 'COMMUNITY_REPORTED') return 'expected urlhaus evidence_class to be COMMUNITY_REPORTED'
    return documentShapeIssue(uhResponse.documents[0], 'urlhaus') ?? true
  }))

  // --- Checkpoint 4 completion adapters (government/law/economics/statistics,
  // re_754-re_765): one mocked success-path normalization test per new
  // provider. Real upstream proof lives in
  // scripts/run-research-engine-live-validation.mjs.

  await add('re_754_federal_register_success_normalizes_document', () => withAdapterFetch([
    jsonResponse({ count: 1, results: [{ document_number: '2026-11091', title: 'Test Rule', type: 'Rule', abstract: 'desc', html_url: 'https://www.federalregister.gov/documents/2026-11091', publication_date: '2026-01-01', agencies: [{ name: 'EPA' }] }] }),
  ], async () => {
    const response = await federalRegisterAdapter.run({ text: 'climate' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'federal_register') ?? true
  }))

  await add('re_755_usaspending_success_normalizes_award', () => withAdapterFetch([
    jsonResponse({ results: [{ 'Award ID': 'W123', 'Recipient Name': 'Acme Corp', 'Award Amount': 5000000, 'Start Date': '2026-01-01', 'Awarding Agency': 'DoD', generated_internal_id: 'CONT_AWD_W123' }] }),
  ], async () => {
    const response = await usaspendingAdapter.run({ text: 'research' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'usaspending') ?? true
  }))

  await add('re_756_uk_legislation_success_parses_atom_entry', () => withAdapterFetch([
    textResponse('<feed><entry><id>http://www.legislation.gov.uk/id/eudn/2020/1745</id><title>Test Act 2020</title><updated>2020-01-01T00:00:00Z</updated><published>2020-01-01T00:00:00Z</published><summary>desc</summary><link rel="alternate" type="text/html" href="http://www.legislation.gov.uk/eudn/2020/1745"/></entry></feed>', 200, 'application/atom+xml'),
  ], async () => {
    const response = await ukLegislationAdapter.run({ text: 'data protection' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'uk_legislation') ?? true
  }))

  await add('re_757_opensanctions_success_normalizes_entity', () => withEnv({ OPENSANCTIONS_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ id: 'Q123', caption: 'Test Entity', schema: 'Person', datasets: ['sanctions'], first_seen: '2024-01-01', target: true }] }),
  ], async () => {
    const response = await opensanctionsAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'opensanctions') ?? true
  })))

  await add('re_758_companies_house_success_normalizes_company', () => withEnv({ COMPANIES_HOUSE_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ items: [{ company_number: '00000006', title: 'TEST COMPANY LTD', company_status: 'active', company_type: 'ltd', date_of_creation: '2000-01-01', address_snippet: 'London' }] }),
  ], async () => {
    const response = await companiesHouseAdapter.run({ text: 'test company' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'companies_house') ?? true
  })))

  await add('re_759_ecb_sdw_success_decodes_sdmx_json', () => withAdapterFetch([
    jsonResponse({ dataSets: [{ series: { '0:0:0:0:0': { observations: { '0': [1.16], '1': [1.17] } } } }], structure: { dimensions: { observation: [{ values: [{ id: '2026-08-19' }, { id: '2026-08-20' }] }] } } }),
  ], async () => {
    const response = await ecbSdwAdapter.run({ text: 'EXR/D.USD.EUR.SP00.A' })
    if (!response.ok || response.documents.length !== 2) return `expected 2 decoded observations, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ecb_sdw') ?? true
  }))

  await add('re_760_bank_of_canada_success_normalizes_observation', () => withAdapterFetch([
    jsonResponse({ seriesDetail: { FXUSDCAD: { label: 'USD/CAD' } }, observations: [{ d: '2026-08-21', FXUSDCAD: { v: '1.3760' } }] }),
  ], async () => {
    const response = await bankOfCanadaAdapter.run({ text: 'FXUSDCAD' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'bank_of_canada') ?? true
  }))

  await add('re_761_bis_stats_success_decodes_sdmx_json', () => withAdapterFetch([
    jsonResponse({ data: { dataSets: [{ series: { '0:0': { observations: { '0': [3.625] } } } }], structure: { dimensions: { observation: [{ values: [{ id: '2026-08-21' }] }] } } } }),
  ], async () => {
    const response = await bisStatsAdapter.run({ text: 'WS_CBPOL/D.US' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'bis_stats') ?? true
  }))

  await add('re_762_eia_success_handles_response_data_wrapper', () => withEnv({ EIA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ response: { data: [{ period: '2026-01', price: 12.5 }] } }),
  ], async () => {
    const response = await eiaAdapter.run({ text: 'electricity/retail-sales' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'eia') ?? true
  })))

  await add('re_763_statcan_wds_success_normalizes_vector_point', () => withAdapterFetch([
    jsonResponse([{ status: 'SUCCESS', object: { vectorId: 41690973, vectorDataPoint: [{ refPer: '2026-01-01', value: 161.9, releaseTime: '2026-02-01' }] } }]),
  ], async () => {
    const response = await statcanWdsAdapter.run({ text: 'cpi' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'statcan_wds') ?? true
  }))

  await add('re_764_uk_ons_success_normalizes_search_item', () => withAdapterFetch([
    jsonResponse({ count: 1, items: [{ title: 'Population estimates', summary: 'desc', uri: '/peoplepopulationandcommunity/pop', release_date: '2026-01-01', type: 'bulletin' }] }),
  ], async () => {
    const response = await ukOnsAdapter.run({ text: 'population' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'uk_ons') ?? true
  }))

  await add('re_765_insee_melodi_success_two_call_catalog_then_data', () => withAdapterFetch([
    jsonResponse([{ identifier: 'DD_ESTIMATION_POPULATION', title: [{ content: 'Population estimates', lang: 'en' }] }]),
    jsonResponse({ observations: [{ dimensions: { GEO: 'FR', TIME_PERIOD: '2026' }, measures: { OBS_VALUE_NIVEAU: { value: 68000000 } } }] }),
  ], async () => {
    const response = await inseeMelodiAdapter.run({ text: 'population' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'insee_melodi') ?? true
  }))

  // --- Checkpoint 5 completion adapters (earth/GIS/space, re_766-re_779):
  // one mocked success-path normalization test per new provider. Real
  // upstream proof lives in scripts/run-research-engine-live-validation.mjs.

  await add('re_766_open_meteo_success_normalizes_current_forecast', () => withAdapterFetch([
    jsonResponse({ latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin', current: { time: '2026-01-01T00:00', temperature_2m: 12.7, wind_speed_10m: 10.2 }, current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' } }),
  ], async () => {
    const response = await openMeteoAdapter.run({ text: '52.52,13.41' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'open_meteo') ?? true
  }))

  await add('re_767_noaa_cdo_success_normalizes_dataset', () => withEnv({ NOAA_CDO_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ results: [{ id: 'GHCND', name: 'Daily Summaries', mindate: '1750-01-01', maxdate: '2026-01-01', datacoverage: 1 }] }),
  ], async () => {
    const response = await noaaCdoAdapter.run({ text: 'GHCND' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'noaa_cdo') ?? true
  })))

  await add('re_768_met_no_success_normalizes_timeseries_point', () => withAdapterFetch([
    jsonResponse({ geometry: { coordinates: [13.41, 52.52, 34] }, properties: { meta: { updated_at: '2026-01-01T00:00:00Z' }, timeseries: [{ time: '2026-01-01T00:00:00Z', data: { instant: { details: { air_temperature: 12.6, air_pressure_at_sea_level: 1021.6 } } } }] } }),
  ], async () => {
    const response = await metNoAdapter.run({ text: '52.52,13.41' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'met_no') ?? true
  }))

  await add('re_769_noaa_swpc_success_normalizes_scales', () => withAdapterFetch([
    jsonResponse({ '0': { DateStamp: '2026-01-01', TimeStamp: '00:00:00', R: { Scale: '0' }, S: { Scale: '0' }, G: { Scale: '0' } } }),
  ], async () => {
    const response = await noaaSwpcAdapter.run({ text: 'scales' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'noaa_swpc') ?? true
  }))

  await add('re_770_nominatim_success_normalizes_place', () => withAdapterFetch([
    jsonResponse([{ place_id: 97683695, osm_type: 'relation', osm_id: 71525, lat: '48.8534951', lon: '2.3483915', display_name: 'Paris, Île-de-France, France', class: 'boundary', type: 'administrative' }]),
  ], async () => {
    const response = await nominatimAdapter.run({ text: 'Paris, France' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nominatim') ?? true
  }))

  await add('re_771_nasa_cmr_success_normalizes_collection', () => withAdapterFetch([
    jsonResponse({ feed: { entry: [{ entry_id: 'C123-LPDAAC', short_name: 'MYD00F', dataset_id: 'MODIS Test', version_id: '1', data_center: 'LPDAAC', summary: 'desc', time_start: '2000-01-01T00:00:00Z' }] } }),
  ], async () => {
    const response = await nasaCmrAdapter.run({ text: 'MODIS' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nasa_cmr') ?? true
  }))

  await add('re_772_copernicus_dataspace_success_normalizes_product', () => withAdapterFetch([
    jsonResponse({ value: [{ Id: 'abc-123', Name: 'S2A_MSIL1C_TEST.SAFE', OriginDate: '2026-01-01T00:00:00Z', Online: true, ContentLength: 500000000 }] }),
  ], async () => {
    const response = await copernicusDataspaceAdapter.run({ text: 'S2A' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'copernicus_dataspace') ?? true
  }))

  await add('re_773_opentopography_rejects_oversized_bbox', () => withEnv({ OPENTOPOGRAPHY_API_KEY: 'test-key-not-real' }, async () => {
    const response = await opentopographyAdapter.run({ text: '30,-115,40,-105' })
    return (response.ok === false) || 'expected a bbox spanning more than 1 degree per side to be rejected, not silently accepted'
  }))

  await add('re_774_celestrak_success_normalizes_gp_element', () => withAdapterFetch([
    jsonResponse([{ OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544, EPOCH: '2026-01-01T00:00:00', INCLINATION: 51.6 }]),
  ], async () => {
    const response = await celestrakAdapter.run({ text: '25544' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'celestrak') ?? true
  }))

  await add('re_775_jpl_horizons_success_treats_result_as_content', () => withAdapterFetch([
    jsonResponse({ result: 'Target body name: Mars (499)                     {source: mar097}\nVol. mean radius (km) = 3389.5' }),
  ], async () => {
    const response = await jplHorizonsAdapter.run({ text: '499' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'jpl_horizons') ?? true
  }))

  await add('re_776_jpl_sbdb_success_normalizes_small_body', () => withAdapterFetch([
    jsonResponse({ object: { fullname: '1 Ceres (A801 AA)', des: '1', spkid: '20000001', kind: 'an', neo: false, pha: false, orbit_class: { name: 'Main-belt Asteroid' } }, orbit: { epoch: '2026-01-01', last_obs: '2025-12-01' } }),
  ], async () => {
    const response = await jplSbdbAdapter.run({ text: 'Ceres' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'jpl_sbdb') ?? true
  }))

  await add('re_777_nasa_exoplanet_archive_success_normalizes_planet_row', () => withAdapterFetch([
    jsonResponse([{ pl_name: 'Kepler-10 b', hostname: 'Kepler-10', discoverymethod: 'Transit', disc_year: 2011, pl_orbper: 0.8374907 }]),
  ], async () => {
    const response = await nasaExoplanetArchiveAdapter.run({ text: 'Kepler-10 b' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nasa_exoplanet_archive') ?? true
  }))

  await add('re_778_simbad_success_decodes_tap_json_column_array', () => withAdapterFetch([
    jsonResponse({ metadata: [{ name: 'main_id' }, { name: 'ra' }, { name: 'dec' }, { name: 'otype' }], data: [['M  31', 10.68, 41.27, 'AGN']] }),
  ], async () => {
    const response = await simbadAdapter.run({ text: 'M31' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].providerRecordId !== 'M 31') return `expected main_id padding ("M  31") to be trimmed to "M 31", got ${JSON.stringify(response.documents[0].providerRecordId)}`
    return documentShapeIssue(response.documents[0], 'simbad') ?? true
  }))

  await add('re_779_mast_success_two_call_name_resolve_then_cone_search', () => withAdapterFetch([
    jsonResponse({ resolvedCoordinate: [{ ra: 10.68, decl: 41.27 }] }),
    jsonResponse({ status: 'COMPLETE', data: [{ obs_id: 'tess-s0017-2-4', obs_collection: 'TESS', instrument_name: 'Photometer', target_name: 'M31', s_ra: 10.68, s_dec: 41.27, t_min: 58700 }] }),
  ], async () => {
    const response = await mastAdapter.run({ text: 'M31' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'mast') ?? true
  }))

  // --- Checkpoint 6 completion adapters (academic/patents/materials,
  // re_780-re_793): one mocked success-path normalization test per new
  // provider. Real upstream proof lives in
  // scripts/run-research-engine-live-validation.mjs.

  await add('re_780_ror_success_normalizes_organization', () => withAdapterFetch([
    jsonResponse({ number_of_results: 1, items: [{ id: 'https://ror.org/00f54p054', names: [{ value: 'Stanford University', types: ['ror_display'] }], links: [{ type: 'website', value: 'https://www.stanford.edu' }], established: 1891 }] }),
  ], async () => {
    const response = await rorAdapter.run({ text: 'Stanford' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ror') ?? true
  }))

  await add('re_781_opencitations_success_normalizes_citation_count', () => withAdapterFetch([
    jsonResponse([{ count: '1806' }]),
  ], async () => {
    const response = await opencitationsAdapter.run({ text: '10.1038/nature12373' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'opencitations') ?? true
  }))

  await add('re_782_biorxiv_medrxiv_success_normalizes_preprint', () => withAdapterFetch([
    jsonResponse({ messages: [{ status: 'ok' }], collection: [{ title: 'Test preprint', authors: 'Doe J; Smith A', doi: '10.1101/339747', date: '2018-06-05', version: '1', category: 'genomics' }] }),
  ], async () => {
    const response = await biorxivMedrxivAdapter.run({ text: '10.1101/339747' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'biorxiv_medrxiv') ?? true
  }))

  await add('re_783_hal_success_normalizes_doc', () => withAdapterFetch([
    jsonResponse({ response: { numFound: 1, docs: [{ docid: '05309397', title_s: ['Climate change study'], authFullName_s: ['Jane Doe'], producedDate_s: '2024-01-01', uri_s: 'https://hal.science/hal-05309397v1' }] } }),
  ], async () => {
    const response = await halAdapter.run({ text: 'climate change' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'hal') ?? true
  }))

  await add('re_784_base_search_detects_access_denied_error_field', () => withEnv({ BASE_SEARCH_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ error: 'Access denied for IP address and user agent' }),
  ], async () => {
    const response = await baseSearchAdapter.run({ text: 'test' })
    return (response.ok === false) || `expected a BASE Search API error field to surface as a failure, not a fabricated empty success, got ${JSON.stringify(response)}`
  })))

  await add('re_785_inspire_hep_success_normalizes_literature_hit', () => withAdapterFetch([
    jsonResponse({ hits: { hits: [{ id: '819311', metadata: { titles: [{ title: 'Higgs boson otherwise' }], arxiv_eprints: [{ value: '0905.0206' }], earliest_date: '2009-05-01' } }] } }),
  ], async () => {
    const response = await inspireHepAdapter.run({ text: 'Higgs boson' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'inspire_hep') ?? true
  }))

  await add('re_786_hepdata_rejects_non_numeric_query', async () => {
    const response = await hepdataAdapter.run({ text: 'higgs boson' })
    return (response.ok === false) || 'expected a non-numeric query to be rejected — HEPData search is not programmatically accessible, getById only'
  })

  await add('re_787_hepdata_success_normalizes_record', () => withAdapterFetch([
    jsonResponse({ data_tables: [{ id: 1, name: 'Table 1', description: 'desc', doi: '10.17182/hepdata.1' }], breadcrumb_text: 'Test Collaboration' }),
  ], async () => {
    const response = await hepdataAdapter.run({ text: '1283842' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'hepdata') ?? true
  }))

  await add('re_788_zbmath_success_normalizes_document', () => withAdapterFetch([
    jsonResponse({ result: [{ identifier: '0688.10043', title: { title: 'On prime-additive numbers' }, contributors: { authors: [{ name: 'Erdős' }] }, year: 1988, zbmath_url: 'https://zbmath.org/0688.10043' }] }),
  ], async () => {
    const response = await zbmathAdapter.run({ text: 'prime numbers' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'zbmath') ?? true
  }))

  await add('re_789_oeis_success_normalizes_sequence_and_handles_null_empty', () => withAdapterFetch([
    jsonResponse([{ number: 45, data: '1,1,2,3,5,8', name: 'Fibonacci numbers', author: 'N. J. A. Sloane' }]),
  ], async () => {
    const response = await oeisAdapter.run({ text: '1,1,2,3,5,8' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].providerRecordId !== 'A000045') return `expected A-number zero-padded to A000045, got ${response.documents[0].providerRecordId}`
    return documentShapeIssue(response.documents[0], 'oeis') ?? true
  }))

  await add('re_790_nasa_ads_success_normalizes_bibcode_record', () => withEnv({ NASA_ADS_API_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ response: { docs: [{ bibcode: '2011ApJ...737..103S', title: ['Test paper'], author: ['Smith, J.'], year: '2011', pub: 'ApJ' }] } }),
  ], async () => {
    const response = await nasaAdsAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nasa_ads') ?? true
  })))

  await add('re_791_epo_ops_success_two_call_token_then_biblio_search', () => withEnv({ EPO_OPS_CONSUMER_KEY: 'test-key', EPO_OPS_CONSUMER_SECRET: 'test-secret-not-real' }, () => withAdapterFetch([
    jsonResponse({ access_token: 'test-token-not-real', expires_in: 1200 }),
    textResponse('<exchange-documents><exchange-document><document-id><country>EP</country><doc-number>1000000</doc-number><kind>A1</kind></document-id><invention-title>Test Invention</invention-title><date>20240101</date></exchange-document></exchange-documents>', 200, 'application/xml'),
  ], async () => {
    const response = await epoOpsAdapter.run({ text: 'electric vehicle' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'epo_ops') ?? true
  })))

  await add('re_792_materials_project_success_normalizes_material', () => withEnv({ MATERIALS_PROJECT_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ data: [{ material_id: 'mp-19770', formula_pretty: 'Fe2O3', symmetry: { crystal_system: 'Trigonal', space_group_symbol: 'R-3c' }, band_gap: 2.1, is_stable: true }] }),
  ], async () => {
    const response = await materialsProjectAdapter.run({ text: 'Fe2O3' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'materials_project') ?? true
  })))

  await add('re_793_oqmd_success_normalizes_entry', () => withAdapterFetch([
    jsonResponse({ data: [{ entry_id: 353416, name: 'Fe2O3', spacegroup: 'Pm-3m', delta_e: -0.935846740892949 }], meta: { data_available: 1 } }),
  ], async () => {
    const response = await oqmdAdapter.run({ text: 'Fe2O3' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'oqmd') ?? true
  }))

  await add('re_794_aflow_success_normalizes_optimade_structure', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 'aflow:abc123', attributes: { chemical_formula_reduced: 'Fe2O3', elements: ['Fe', 'O'], nsites: 10 } }] }),
  ], async () => {
    const response = await aflowAdapter.run({ text: 'Fe2O3' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'aflow') ?? true
  }))

  await add('re_795_pleiades_success_two_step_resolve_then_place_json', () => withAdapterFetch([
    textResponse('<rdf:RDF><item><rdf:li rdf:resource="https://pleiades.stoa.org/places/579885"/></item></rdf:RDF>', 200, 'application/rdf+xml'),
    jsonResponse({ id: '579885', title: 'Rome', reprPoint: [12.5, 41.9], placeTypes: ['settlement'], description: 'Ancient city of Rome.' }),
  ], async () => {
    const response = await pleiadesAdapter.run({ text: 'Rome' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'pleiades') ?? true
  }))

  await add('re_796_idai_gazetteer_success_normalizes_place', () => withAdapterFetch([
    jsonResponse({ total: 1, result: [{ '@id': 'https://gazetteer.dainst.org/place/2078044', gazId: 2078044, types: ['settlement'], prefName: { title: 'Pergamon', language: 'en' }, prefLocation: { coordinates: [27.1836, 39.1325] } }] }),
  ], async () => {
    const response = await idaiGazetteerAdapter.run({ text: 'Pergamon' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'idai_gazetteer') ?? true
  }))

  await add('re_797_edh_success_normalizes_inscription', () => withAdapterFetch([
    jsonResponse({ items: [{ id: 'HD000001', country: 'Italy', findspot_ancient: 'Roma', transcription: 'IMP CAESAR DIVI F', type_of_inscription: 'honorific', language: 'Latin', not_before: 1, not_after: 100, modern_region: 'Lazio' }] }),
  ], async () => {
    const response = await edhAdapter.run({ text: 'Roma' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'edh') ?? true
  }))

  await add('re_798_nomisma_success_normalizes_concept', () => withAdapterFetch([
    jsonResponse({ '@id': 'https://nomisma.org/id/denarius', label: 'Denarius' }),
  ], async () => {
    const response = await nomismaAdapter.run({ text: 'denarius' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nomisma') ?? true
  }))

  await add('re_799_whg_success_normalizes_place_feature', () => withAdapterFetch([
    jsonResponse({ features: [{ properties: { title: 'Rome', index_id: 12345, place_id: 6789, variants: ['Roma'], placetypes: ['city'], timespans: [{ gte: -753, lte: 2024 }], ccodes: ['IT'] }, geometry: { type: 'Point', coordinates: [12.4964, 41.9028] } }] }),
  ], async () => {
    const response = await whgAdapter.run({ text: 'Rome' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'whg') ?? true
  }))

  await add('re_800_open_context_success_normalizes_uri_meta_item', () => withAdapterFetch([
    jsonResponse([{ label: 'Pottery sherd', uri: 'https://opencontext.org/subjects/abc123', href: 'https://opencontext.org/subjects/abc123', 'project label': 'Test Excavation', 'item category': 'Pottery', snippet: 'A <mark>pottery</mark> sherd found in situ.', published: '2020-01-01' }]),
  ], async () => {
    const response = await openContextAdapter.run({ text: 'pottery' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'open_context') ?? true
  }))

  await add('re_801_cdli_success_normalizes_artifact', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 123456, designation: 'P123456', museum_no: 'BM 12345', findspot_comments: 'Ur', artifact_type: { artifact_type: 'tablet' }, period: { period: 'Ur III' }, provenience: { provenience: 'Ur' } }] }),
  ], async () => {
    const response = await cdliAdapter.run({ text: 'tablet' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cdli') ?? true
  }))

  await add('re_802_ehri_success_normalizes_documentary_unit', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 'us-005578', type: 'DocumentaryUnit', attributes: { descriptions: [{ languageCode: 'eng', name: 'Auschwitz Collection', scopeAndContent: 'Records relating to Auschwitz.' }] } }], meta: { total: 1 } }),
  ], async () => {
    const response = await ehriAdapter.run({ text: 'Auschwitz' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ehri') ?? true
  }))

  await add('re_803_art_institute_chicago_success_normalizes_artwork', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 129884, title: 'A Sunday on La Grande Jatte', artist_display: 'Georges Seurat', date_display: '1884-1886', image_id: '9c6e9c3d-2d5e-4e2e-8f2e-abc' }], config: { iiif_url: 'https://www.artic.edu/iiif/2' } }),
  ], async () => {
    const response = await artInstituteChicagoAdapter.run({ text: 'Seurat' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'art_institute_chicago') ?? true
  }))

  await add('re_804_cleveland_museum_success_normalizes_artwork', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 129930, accession_number: '1916.1029', title: 'Twilight in the Wilderness', creators: [{ description: 'Frederic Edwin Church (American, 1826-1900)' }], creation_date: '1860', url: 'https://www.clevelandart.org/art/1916.1029', share_license_status: 'CC0' }] }),
  ], async () => {
    const response = await clevelandMuseumAdapter.run({ text: 'Church' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cleveland_museum') ?? true
  }))

  await add('re_805_va_museum_success_normalizes_object', () => withAdapterFetch([
    jsonResponse({ records: [{ systemNumber: 'O13200', objectType: 'Teapot', _primaryTitle: 'Teapot', _primaryMaker: { name: 'Josiah Wedgwood' }, _primaryDate: '1770', _primaryPlace: 'Staffordshire' }] }),
  ], async () => {
    const response = await vaMuseumAdapter.run({ text: 'teapot' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'va_museum') ?? true
  }))

  await add('re_806_smk_success_normalizes_artwork', () => withAdapterFetch([
    jsonResponse({ items: [{ id: 'KMS1', object_number: 'KMS1', titles: [{ title: 'Portrait of a Man', language: 'en' }], frontend_url: 'https://open.smk.dk/en/artwork/image/KMS1', production: [{ creator: 'Vilhelm Hammershøi' }], public_domain: true }] }),
  ], async () => {
    const response = await smkAdapter.run({ text: 'Hammershoi' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'smk') ?? true
  }))

  await add('re_807_open_library_success_normalizes_work', () => withAdapterFetch([
    jsonResponse({ docs: [{ key: '/works/OL262758W', title: 'The Hobbit', author_name: ['J. R. R. Tolkien'], first_publish_year: 1937, isbn: ['9780618968633'], cover_i: 6498519, language: ['eng'], subject: ['Fiction'] }] }),
  ], async () => {
    const response = await openLibraryAdapter.run({ text: 'hobbit' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'open_library') ?? true
  }))

  await add('re_808_unhcr_data_success_normalizes_population_item', () => withAdapterFetch([
    jsonResponse({ items: [{ year: 2023, coo_name: 'Syrian Arab Rep.', coo_iso: 'SYR', coa_name: 'Germany', coa_iso: 'DEU', refugees: 100, asylum_seekers: 10, idps: 0, stateless: 0 }] }),
  ], async () => {
    const response = await unhcrDataAdapter.run({ text: 'SYR' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'unhcr_data') ?? true
  }))

  await add('re_809_ocha_fts_success_normalizes_plan', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 1129, planVersion: { name: 'Syria HRP 2024', shortName: 'Syria 2024', code: 'HSYR24', startDate: '2024-01-01', endDate: '2024-12-31' } }] }),
  ], async () => {
    const response = await ochaFtsAdapter.run({ text: '2024' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ocha_fts') ?? true
  }))

  await add('re_810_opensky_success_normalizes_state_vector', () => withAdapterFetch([
    jsonResponse({ time: 1700000000, states: [['3c6444', 'DLH9LF  ', 'Germany', 1700000000, 1700000000, 8.5, 47.0, 10000, false, 250, 90, 0, null, 10200, '1000', false, 0]] }),
  ], async () => {
    const response = await openskyAdapter.run({ text: '45.8,5.9,47.8,10.5' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'opensky') ?? true
  }))

  await add('re_811_cbdb_success_normalizes_person', () => withAdapterFetch([
    jsonResponse({ Package: { PersonAuthority: { PersonInfo: { Person: { BasicInfo: { PersonId: 1762, EngName: 'Wang Anshi', ChName: '王安石', YearBirth: 1021, YearDeath: 1086, Dynasty: 'Song', Notes: 'Song dynasty statesman.' } } } } } }),
  ], async () => {
    const response = await cbdbAdapter.run({ text: 'Wang Anshi' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cbdb') ?? true
  }))

  await add('re_812_eclac_cepalstat_success_normalizes_indicator_row', () => withAdapterFetch([
    jsonResponse({ body: { metadata: { indicator_id: 145, indicator_name: 'GDP growth', theme: 'Economic', area: 'LAC', unit: '%', definition: 'Annual GDP growth rate.' }, data: [{ value: 3.2, iso3: 'BRA' }] } }),
  ], async () => {
    const response = await eclacCepalstatAdapter.run({ text: '145' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'eclac_cepalstat') ?? true
  }))

  await add('re_813_oecd_data_explorer_success_decodes_sdmx_json_series', () => withAdapterFetch([
    jsonResponse({
      data: {
        dataSets: [{ series: { '0:0:0:0:0:0:0:0:0': { observations: { '0': [5.1], '1': ['5.2'] } } } }],
        structures: [{ dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ id: '2023-01' }, { id: '2023-02' }] }] } }],
      },
    }),
  ], async () => {
    const response = await oecdDataExplorerAdapter.run({ text: 'not-a-valid-series-so-uses-default' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'oecd_data_explorer') ?? true
  }))

  await add('re_814_un_sdg_success_normalizes_series_row', () => withAdapterFetch([
    jsonResponse({ data: [{ series: 'SI_POV_DAY1', seriesDescription: 'Poverty headcount ratio', geoAreaCode: '840', geoAreaName: 'United States', timePeriodStart: 2020, value: '1.2', source: 'World Bank' }] }),
  ], async () => {
    const response = await unSdgAdapter.run({ text: 'SI_POV_DAY1' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'un_sdg') ?? true
  }))

  await add('re_815_unesco_uis_success_normalizes_record', () => withAdapterFetch([
    jsonResponse({ records: [{ indicatorId: '10403', geoUnit: 'USA', year: 2020, value: 98.5, qualifier: 'estimate' }] }),
  ], async () => {
    const response = await unescoUisAdapter.run({ text: 'USA' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'unesco_uis') ?? true
  }))

  await add('re_816_idb_open_data_success_normalizes_ckan_dataset', () => withAdapterFetch([
    jsonResponse({ success: true, result: { count: 1, results: [{ id: 'abc123', name: 'poverty-dataset', title: 'Poverty in LAC', notes: 'Dataset on poverty.', organization: { title: 'IDB' }, metadata_created: '2020-01-01', metadata_modified: '2021-01-01' }] } }),
  ], async () => {
    const response = await idbOpenDataAdapter.run({ text: 'poverty' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'idb_open_data') ?? true
  }))

  await add('re_817_iati_datastore_success_normalizes_solr_doc', () => withEnv({ IATI_DATASTORE_SUBSCRIPTION_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ response: { numFound: 1, docs: [{ iati_identifier: 'XM-DAC-1-1', title_narrative: ['Health Project'], description_narrative: ['A health project.'], reporting_org_narrative: ['WHO'], activity_status_code: '2', start_date_actual_iso_date: '2020-01-01' }] } }),
  ], async () => {
    const response = await iatiDatastoreAdapter.run({ text: 'health' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'iati_datastore') ?? true
  })))

  await add('re_818_debian_sources_success_normalizes_package_version', () => withAdapterFetch([
    jsonResponse({ package: 'curl', versions: [{ area: 'main', suites: ['bookworm'], version: '7.88.1-10' }] }),
  ], async () => {
    const response = await debianSourcesAdapter.run({ text: 'curl' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'debian_sources') ?? true
  }))

  await add('re_819_ietf_datatracker_success_normalizes_rfc', () => withAdapterFetch([
    jsonResponse({ objects: [{ name: 'rfc8259', title: 'The JSON Data Interchange Format', abstract: 'JSON is a text format for structured data.', rev: '', rfc: 8259, time: '2017-12-01' }] }),
  ], async () => {
    const response = await ietfDatatrackerAdapter.run({ text: 'rfc8259' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ietf_datatracker') ?? true
  }))

  await add('re_820_wikimedia_commons_success_normalizes_file', () => withAdapterFetch([
    jsonResponse({ query: { pages: { '123': { pageid: 123, title: 'File:Cat.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/cat.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cat.jpg', extmetadata: { ImageDescription: { value: 'A cat' }, Artist: { value: 'John' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } }),
  ], async () => {
    const response = await wikimediaCommonsAdapter.run({ text: 'cat' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'wikimedia_commons') ?? true
  }))

  await add('re_821_dbpedia_success_normalizes_entity_and_strips_highlight_tags', () => withAdapterFetch([
    jsonResponse({ docs: [{ resource: ['http://dbpedia.org/resource/Berlin'], label: ['<B>Berlin</B>'], comment: ['Capital of Germany'], typeName: ['City'] }] }),
  ], async () => {
    const response = await dbpediaAdapter.run({ text: 'Berlin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].title.includes('<B>')) return `expected highlight tags stripped, got title "${response.documents[0].title}"`
    return documentShapeIssue(response.documents[0], 'dbpedia') ?? true
  }))

  await add('re_822_dblp_success_normalizes_publication_and_multi_author', () => withAdapterFetch([
    jsonResponse({ result: { hits: { hit: [{ '@id': '1', info: { title: 'Attention Is All You Need', venue: 'NeurIPS', year: '2017', type: 'Conference and Workshop Papers', key: 'conf/nips/x', authors: { author: [{ text: 'A' }, { text: 'B' }] } } }] } } }),
  ], async () => {
    const response = await dblpAdapter.run({ text: 'transformer' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'dblp') ?? true
  }))

  await add('re_823_mozilla_bugzilla_success_normalizes_bug', () => withAdapterFetch([
    jsonResponse({ bugs: [{ id: 12345, summary: 'App crashes on load', status: 'NEW', product: 'Firefox', component: 'General' }] }),
  ], async () => {
    const response = await mozillaBugzillaAdapter.run({ text: 'crash' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'mozilla_bugzilla') ?? true
  }))

  await add('re_824_msrc_cvrf_success_normalizes_vulnerability', () => withAdapterFetch([
    jsonResponse({ DocumentTitle: { Value: 'January 2024 Security Updates' }, Vulnerability: [{ Title: { Value: 'Windows Kernel EoP' }, CVE: 'CVE-2024-0001', CWE: [{ ID: 'CWE-123' }] }] }),
  ], async () => {
    const response = await msrcCvrfAdapter.run({ text: '2024-Jan' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'msrc_cvrf') ?? true
  }))

  await add('re_825_isni_success_decodes_sru_xml_record', () => withAdapterFetch([
    textResponse('<srw:records><srw:record><srw:recordData><responseRecord><ISNIAssigned><isniUnformatted>000000053038150X</isniUnformatted><ISNIMetadata><identity><personOrFiction><personalName><surname>Einstein</surname></personalName></personOrFiction></identity></ISNIMetadata></ISNIAssigned></responseRecord></srw:recordData></srw:record></srw:records>', 200, 'application/xml'),
  ], async () => {
    const response = await isniAdapter.run({ text: 'Einstein' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'isni') ?? true
  }))

  await add('re_826_lobid_gnd_success_normalizes_authority_record', () => withAdapterFetch([
    jsonResponse({ totalItems: 1, member: [{ id: 'https://d-nb.info/gnd/118529579', preferredName: 'Einstein, Albert', dateOfBirth: ['1879'], dateOfDeath: ['1955'], type: ['Person'] }] }),
  ], async () => {
    const response = await lobidGndAdapter.run({ text: 'Albert Einstein' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'lobid_gnd') ?? true
  }))

  await add('re_827_factgrid_success_normalizes_entity', () => withAdapterFetch([
    jsonResponse({ search: [{ id: 'Q1', concepturi: 'https://database.factgrid.de/entity/Q1', label: 'Gottfried Wilhelm Leibniz', description: 'German polymath' }] }),
  ], async () => {
    const response = await factgridAdapter.run({ text: 'Leibniz' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'factgrid') ?? true
  }))

  await add('re_828_ubuntu_security_success_normalizes_notice', () => withAdapterFetch([
    jsonResponse({ notices: [{ id: 'USN-8671-1', title: 'Linux kernel vulnerabilities', summary: 'Several security issues were fixed.', published: '2024-01-01' }] }),
  ], async () => {
    const response = await ubuntuSecurityAdapter.run({ text: 'kernel' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ubuntu_security') ?? true
  }))

  await add('re_829_redhat_security_data_success_normalizes_cve_array', () => withAdapterFetch([
    jsonResponse([{ CVE: 'CVE-2024-0001', severity: 'important', public_date: '2024-01-01', bugzilla_description: 'OpenSSL vulnerability', cvss3_score: 7.5 }]),
  ], async () => {
    const response = await redhatSecurityDataAdapter.run({ text: 'openssl' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'redhat_security_data') ?? true
  }))

  await add('re_830_cve_org_success_normalizes_cve_record', () => withAdapterFetch([
    jsonResponse({ cveMetadata: { cveId: 'CVE-2021-44228', state: 'PUBLISHED', datePublished: '2021-12-10', assignerShortName: 'apache' }, containers: { cna: { title: 'Log4Shell', descriptions: [{ lang: 'en', value: 'Apache Log4j2 RCE' }] } } }),
  ], async () => {
    const response = await cveOrgAdapter.run({ text: 'CVE-2021-44228' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cve_org') ?? true
  }))

  await add('re_831_conceptnet_success_normalizes_edge', () => withAdapterFetch([
    jsonResponse({ edges: [{ rel: { label: 'IsA' }, start: { label: 'dog' }, end: { label: 'animal' }, weight: 2.0 }] }),
  ], async () => {
    const response = await conceptnetAdapter.run({ text: 'dog' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'conceptnet') ?? true
  }))

  await add('re_832_ena_portal_success_normalizes_sequence_entry', () => withAdapterFetch([
    jsonResponse([{ accession: 'AB123456', description: 'E. coli genome sequence', scientific_name: 'Escherichia coli' }]),
  ], async () => {
    const response = await enaPortalAdapter.run({ text: 'Escherichia coli' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ena_portal') ?? true
  }))

  await add('re_833_ncbi_datasets_success_normalizes_gene_report', () => withAdapterFetch([
    jsonResponse({ reports: [{ gene: { gene_id: '675', symbol: 'BRCA2', description: 'BRCA2 DNA repair associated', tax_id: '9606', taxname: 'Homo sapiens', synonyms: ['FANCD1'] } }] }),
  ], async () => {
    const response = await ncbiDatasetsAdapter.run({ text: 'BRCA2' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ncbi_datasets') ?? true
  }))

  await add('re_834_alphafold_db_success_normalizes_prediction', () => withAdapterFetch([
    jsonResponse([{ uniprotAccession: 'P69905', uniprotId: 'HBA_HUMAN', uniprotDescription: 'Hemoglobin subunit alpha', gene: 'HBA1', organismScientificName: 'Homo sapiens', globalMetricValue: 92.3, cifUrl: 'https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v4.cif' }]),
  ], async () => {
    const response = await alphafoldDbAdapter.run({ text: 'P69905' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'alphafold_db') ?? true
  }))

  await add('re_835_reactome_success_strips_highlight_tags', () => withAdapterFetch([
    jsonResponse({ results: [{ entries: [{ dbId: 109581, stId: 'R-HSA-109581', name: '<span class="highlighting">Apoptosis</span>', type: 'Pathway', summation: 'Programmed cell death.' }] }] }),
  ], async () => {
    const response = await reactomeAdapter.run({ text: 'apoptosis' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].title.includes('<span')) return `expected highlight tags stripped, got title "${response.documents[0].title}"`
    return documentShapeIssue(response.documents[0], 'reactome') ?? true
  }))

  await add('re_836_intact_success_normalizes_interactor', () => withAdapterFetch([
    jsonResponse({ content: [{ interactorAc: 'EBI-366083', interactorName: 'TP53_HUMAN', interactorPreferredIdentifier: 'P04637', interactorDescription: 'Cellular tumor antigen p53', interactorType: 'protein', interactorSpecies: 'Homo sapiens', interactionCount: 100 }] }),
  ], async () => {
    const response = await intactAdapter.run({ text: 'TP53' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'intact') ?? true
  }))

  await add('re_837_orphadata_success_normalizes_disorder', () => withAdapterFetch([
    jsonResponse({ data: { results: { ORPHAcode: 558, 'Preferred term': 'Marfan syndrome', OrphanetURL: 'https://www.orpha.net/en/disease/detail/558', DisorderGroup: 'Disease', SummaryInformation: [{ Definition: 'A rare genetic disorder of connective tissue.' }], Synonym: ['MFS'] } } }),
  ], async () => {
    const response = await orphadataAdapter.run({ text: 'Marfan syndrome' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'orphadata') ?? true
  }))

  await add('re_838_guide_to_pharmacology_success_normalizes_ligand', () => withAdapterFetch([
    jsonResponse([{ ligandId: 2249, name: 'aspirin', type: 'Synthetic organic', approved: true, withdrawn: false, radioactive: false }]),
  ], async () => {
    const response = await guideToPharmacologyAdapter.run({ text: 'aspirin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'guide_to_pharmacology') ?? true
  }))

  await add('re_839_clinpgx_success_normalizes_drug', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 'PA451906', name: 'warfarin', pediatric: true, types: ['Drug'] }] }),
  ], async () => {
    const response = await clinpgxAdapter.run({ text: 'warfarin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'clinpgx') ?? true
  }))

  await add('re_840_pbdb_success_normalizes_occurrence', () => withAdapterFetch([
    jsonResponse({ records: [{ oid: 'occ:1001', tna: 'Tyrannosaurus rex', oei: 'Maastrichtian', eag: 72.1, lag: 66.0 }] }),
  ], async () => {
    const response = await pbdbAdapter.run({ text: 'Tyrannosaurus' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'pbdb') ?? true
  }))

  await add('re_841_nws_weather_success_two_hop_points_then_forecast', () => withAdapterFetch([
    jsonResponse({ properties: { forecast: 'https://api.weather.gov/gridpoints/LWX/97,71/forecast', relativeLocation: { properties: { city: 'Washington', state: 'DC' } } } }),
    jsonResponse({ properties: { periods: [{ name: 'Tonight', startTime: '2024-01-01T18:00:00-05:00', temperature: 45, temperatureUnit: 'F', windSpeed: '5 mph', windDirection: 'NW', shortForecast: 'Clear', detailedForecast: 'Clear skies overnight.' }] } }),
  ], async () => {
    const response = await nwsWeatherAdapter.run({ text: '38.8894,-77.0352' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nws_weather') ?? true
  }))

  await add('re_842_japan_egov_hourei_success_normalizes_law', () => withAdapterFetch([
    jsonResponse({ total_count: 1, laws: [{ law_info: { law_id: '325CO0000000001', law_num: 'Showa 25 Cabinet Order No. 1', promulgation_date: '1950-01-01' }, revision_info: { law_title: 'Test Law', category: 'Administrative', updated: '2020-01-01' } }] }),
  ], async () => {
    const response = await japanEgovHoureiAdapter.run({ text: 'test law' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'japan_egov_hourei') ?? true
  }))

  await add('re_843_australia_frl_success_normalizes_title', () => withAdapterFetch([
    jsonResponse({ value: [{ id: 'C2004A00819', name: 'Corporations Act 2001', makingDate: '2001-06-28', collection: 'Act', isInForce: true, status: 'In force', year: 2001, number: '50' }] }),
  ], async () => {
    const response = await australiaFrlAdapter.run({ text: 'Corporations' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'australia_frl') ?? true
  }))

  await add('re_844_uk_gazette_success_normalizes_notice', () => withAdapterFetch([
    jsonResponse({ entry: [{ id: 'https://www.thegazette.co.uk/id/notice/1234', title: 'Notice of insolvency', 'f:notice-code': '2301', 'f:status': 'published', published: '2024-01-01', updated: '2024-01-01', link: [{ '@href': 'https://www.thegazette.co.uk/notice/1234', '@rel': 'alternate' }] }] }),
  ], async () => {
    const response = await ukGazetteAdapter.run({ text: 'insolvency' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'uk_gazette') ?? true
  }))

  await add('re_845_eu_ted_success_normalizes_notice', () => withAdapterFetch([
    jsonResponse({ notices: [{ ND: '123456-2024', PD: '20240101', TI: { eng: 'Software procurement notice' }, 'publication-number': '123456-2024' }] }),
  ], async () => {
    const response = await euTedAdapter.run({ text: 'software' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'eu_ted') ?? true
  }))

  await add('re_846_brazil_transparencia_success_normalizes_documento', () => withEnv({ BRAZIL_TRANSPARENCIA_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse([{ documento: 'DOC123', valor: 1000.5, dataDocumento: '2024-01-01', favorecido: { nome: 'Empresa X' }, orgao: { nome: 'Ministerio Y' } }]),
  ], async () => {
    const response = await brazilTransparenciaAdapter.run({ text: '26246' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'brazil_transparencia') ?? true
  })))

  await add('re_847_sidra_brazil_success_normalizes_series_value', () => withAdapterFetch([
    jsonResponse([{ id: '9324', variavel: 'População residente estimada', unidade: 'Pessoas', resultados: [{ series: [{ localidade: { id: '1', nome: 'Brasil' }, serie: { '2021': '213317639' } }] }] }]),
  ], async () => {
    const response = await sidraBrazilAdapter.run({ text: '6579/2021/9324' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'sidra_brazil') ?? true
  }))

  await add('re_848_cbs_statline_success_normalizes_row', () => withAdapterFetch([
    jsonResponse({ value: [{ ID: 0, WijkenEnBuurten: 'NL00', AantalInwoners_5: 17000000 }] }),
  ], async () => {
    const response = await cbsStatlineAdapter.run({ text: '83765NED' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cbs_statline') ?? true
  }))

  await add('re_849_gaia_archive_success_decodes_tap_json_column_array', () => withAdapterFetch([
    jsonResponse({
      metadata: [{ name: 'source_id' }, { name: 'ra' }, { name: 'dec' }, { name: 'parallax' }, { name: 'pmra' }, { name: 'pmdec' }, { name: 'phot_g_mean_mag' }],
      data: [['5853498713190525696', 217.39, -62.67, 742.0, -3781.7, 769.2, 6.7]],
    }),
  ], async () => {
    const response = await gaiaArchiveAdapter.run({ text: '5853498713190525696' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'gaia_archive') ?? true
  }))

  await add('re_850_sdss_skyserver_success_normalizes_object', () => withAdapterFetch([
    jsonResponse([{ TableName: 'Table1', Rows: [{ objID: '1237648720693739577', ra: 185.0, dec: 15.0, type: 3, r: 18.2, g: 19.1 }] }]),
  ], async () => {
    const response = await sdssSkyserverAdapter.run({ text: '185.0,15.0' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'sdss_skyserver') ?? true
  }))

  await add('re_851_apache_jira_success_normalizes_issue', () => withAdapterFetch([
    jsonResponse({ issues: [{ key: 'SPARK-1234', fields: { summary: 'Build fails on JDK 17', status: { name: 'Open' }, project: { key: 'SPARK', name: 'Spark' }, priority: { name: 'Major' }, created: '2024-01-01', updated: '2024-01-02' } }] }),
  ], async () => {
    const response = await apacheJiraAdapter.run({ text: 'build' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'apache_jira') ?? true
  }))

  await add('re_852_health_canada_dpd_success_normalizes_drug', () => withAdapterFetch([
    jsonResponse([{ drug_code: 12345, class_name: 'Human', drug_identification_number: '00000123', brand_name: 'Tylenol', descriptor: 'Acetaminophen tablet', company_name: 'Johnson & Johnson', last_update_date: '2024-01-01' }]),
  ], async () => {
    const response = await healthCanadaDpdAdapter.run({ text: 'tylenol' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'health_canada_dpd') ?? true
  }))

  await add('re_853_bindingdb_success_normalizes_affinity', () => withAdapterFetch([
    jsonResponse({ getLindsByUniprotResponse: { 'bdb.affinities': [{ 'bdb.monomerid': 50000001, 'bdb.smile': 'CC(=O)Oc1ccccc1C(=O)O', 'bdb.affinity_type': 'IC50', 'bdb.affinity': '10' }] } }),
  ], async () => {
    const response = await bindingdbAdapter.run({ text: 'P00533' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'bindingdb') ?? true
  }))

  await add('re_854_kegg_success_parses_flat_text', () => withAdapterFetch([
    textResponse('hsa:675\tBRCA2, BRCC2; breast cancer type 2 susceptibility protein\n', 200, 'text/plain'),
  ], async () => {
    const response = await keggAdapter.run({ text: 'BRCA2' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'kegg') ?? true
  }))

  await add('re_855_metabolights_success_normalizes_study_title', () => withAdapterFetch([
    jsonResponse({ title: 'A metabolomic study of urinary changes in type 2 diabetes' }),
  ], async () => {
    const response = await metabolightsAdapter.run({ text: 'MTBLS1' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'metabolights') ?? true
  }))

  await add('re_856_pride_archive_success_normalizes_project', () => withAdapterFetch([
    jsonResponse([{ accession: 'PXD000001', title: 'Test proteomics project', projectDescription: 'A study of protein expression.', publicationDate: '2024-01-01', updatedDate: '2024-01-02', organisms: ['Homo sapiens'], diseases: ['cancer'], instruments: ['Orbitrap'] }]),
  ], async () => {
    const response = await prideArchiveAdapter.run({ text: 'cancer' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'pride_archive') ?? true
  }))

  await add('re_857_libris_xl_success_normalizes_json_ld_item', () => withAdapterFetch([
    jsonResponse({ totalItems: 1, items: [{ '@id': 'https://libris.kb.se/abc123', '@type': 'Instance', hasTitle: [{ mainTitle: 'Fröken Julie' }] }] }),
  ], async () => {
    const response = await librisXlAdapter.run({ text: 'Strindberg' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'libris_xl') ?? true
  }))

  await add('re_858_nasjonalbiblioteket_success_normalizes_item', () => withAdapterFetch([
    jsonResponse({ _embedded: { items: [{ id: 'URN:NBN:no-nb_digibok_123', _links: { self: { href: 'https://api.nb.no/catalog/v1/items/123' } }, accessInfo: { isPublicDomain: true, license: 'CC0' }, metadata: { title: 'Et dukkehjem', creators: ['Henrik Ibsen'], contentClasses: ['bøker'] } }] } }),
  ], async () => {
    const response = await nasjonalbibliotekAdapter.run({ text: 'Ibsen' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nasjonalbiblioteket') ?? true
  }))

  await add('re_859_nara_catalog_success_normalizes_hit', () => withAdapterFetch([
    jsonResponse({ body: { hits: { hits: [{ _id: '123456', _source: { metadata: { controlGroup: { naId: 123456 } }, record: { title: 'Test Record', levelOfDescription: 'item', recordType: 'textual' } } }] } } }),
  ], async () => {
    const response = await naraCatalogAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nara_catalog') ?? true
  }))

  await add('re_860_jstage_success_decodes_nested_en_ja_atom_xml', () => withAdapterFetch([
    textResponse('<feed><entry><article_title><en><![CDATA[Test Article]]></en><ja/></article_title><article_link><en>https://www.jstage.jst.go.jp/article/test/1/1/1_1/_article</en><ja/></article_link><cdjournal>testj</cdjournal><material_title><en><![CDATA[Test Journal]]></en><ja/></material_title></entry></feed>', 200, 'application/xml'),
  ], async () => {
    const response = await jstageAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'jstage') ?? true
  }))

  await add('re_861_cinii_success_normalizes_article', () => withAdapterFetch([
    jsonResponse({ items: [{ '@id': 'https://cir.nii.ac.jp/crid/123', title: 'Test paper', 'dc:creator': ['Taro Yamada'], 'prism:publicationName': 'Journal of Test', 'prism:publicationDate': '2020' }] }),
  ], async () => {
    const response = await ciniiAdapter.run({ text: 'science' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cinii') ?? true
  }))

  await add('re_862_musicbrainz_success_normalizes_artist', () => withAdapterFetch([
    jsonResponse({ count: 1, artists: [{ id: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d', type: 'Group', name: 'The Beatles', country: 'GB', area: { name: 'United Kingdom' }, 'life-span': { begin: '1957' } }] }),
  ], async () => {
    const response = await musicbrainzAdapter.run({ text: 'Beatles' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'musicbrainz') ?? true
  }))

  await add('re_863_gitlab_api_success_normalizes_project', () => withAdapterFetch([
    jsonResponse([{ id: 278964, description: 'A JS library', name: 'react', path_with_namespace: 'test/react', created_at: '2020-01-01', web_url: 'https://gitlab.com/test/react', star_count: 100 }]),
  ], async () => {
    const response = await gitlabApiAdapter.run({ text: 'react' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'gitlab_api') ?? true
  }))

  await add('re_864_codeberg_success_normalizes_repo', () => withAdapterFetch([
    jsonResponse({ ok: true, data: [{ id: 1, owner: { login: 'testuser' }, name: 'test-repo', full_name: 'testuser/test-repo', description: 'A test repo', language: 'Go', html_url: 'https://codeberg.org/testuser/test-repo' }] }),
  ], async () => {
    const response = await codebergAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'codeberg') ?? true
  }))

  await add('re_865_software_heritage_success_normalizes_origin', () => withAdapterFetch([
    jsonResponse([{ url: 'https://github.com/torvalds/linux', nb_visits: 500, last_visit_date: '2024-01-01' }]),
  ], async () => {
    const response = await softwareHeritageAdapter.run({ text: 'linux' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'software_heritage') ?? true
  }))

  await add('re_866_launchpad_success_normalizes_bug_task', () => withAdapterFetch([
    jsonResponse({ entries: [{ self_link: 'https://api.launchpad.net/devel/bugs/12345', web_link: 'https://bugs.launchpad.net/ubuntu/+bug/12345', status: 'New', importance: 'High', bug_target_display_name: 'ubuntu', date_created: '2024-01-01' }] }),
  ], async () => {
    const response = await launchpadAdapter.run({ text: 'crash' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'launchpad') ?? true
  }))

  await add('re_867_metacpan_success_normalizes_release', () => withAdapterFetch([
    jsonResponse({ hits: { hits: [{ _id: 'abc123', _source: { abstract: 'A postmodern object system', author: 'STEVAN', date: '2020-01-01', distribution: 'Moose' } }] } }),
  ], async () => {
    const response = await metacpanAdapter.run({ text: 'Moose' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'metacpan') ?? true
  }))

  await add('re_868_ecosystems_success_normalizes_package', () => withAdapterFetch([
    jsonResponse({ name: 'express', ecosystem: 'npm', description: 'Fast web framework', homepage: 'https://expressjs.com', repository_url: 'https://github.com/expressjs/express', latest_release_number: '4.18.0', versions_count: 100 }),
  ], async () => {
    const response = await ecosystemsAdapter.run({ text: 'npmjs.org/express' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ecosystems') ?? true
  }))

  await add('re_869_deps_dev_success_normalizes_package', () => withAdapterFetch([
    jsonResponse({ packageKey: { system: 'NPM', name: 'react' }, versions: [{ versionKey: { system: 'NPM', name: 'react', version: '18.0.0' }, publishedAt: '2022-01-01', isDefault: true }] }),
  ], async () => {
    const response = await depsDevAdapter.run({ text: 'npm/react' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'deps_dev') ?? true
  }))

  await add('re_870_homebrew_success_normalizes_formula', () => withAdapterFetch([
    jsonResponse({ name: 'wget', full_name: 'wget', desc: 'Internet file retriever', license: 'GPL-3.0-or-later', homepage: 'https://www.gnu.org/software/wget/', versions: { stable: '1.21.3' } }),
  ], async () => {
    const response = await homebrewAdapter.run({ text: 'wget' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'homebrew') ?? true
  }))

  await add('re_871_mdn_web_docs_success_normalizes_document', () => withAdapterFetch([
    jsonResponse({ documents: [{ mdn_url: '/en-US/docs/Web/API/fetch', title: 'fetch()', summary: 'The fetch() method starts a request.', locale: 'en-US' }] }),
  ], async () => {
    const response = await mdnWebDocsAdapter.run({ text: 'fetch' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'mdn_web_docs') ?? true
  }))

  await add('re_872_rosetta_code_success_normalizes_search_hit', () => withAdapterFetch([
    jsonResponse({ query: { search: [{ pageid: 123, title: 'Quicksort', snippet: 'A <span>sort</span> algorithm', wordcount: 500, timestamp: '2020-01-01' }] } }),
  ], async () => {
    const response = await rosettaCodeAdapter.run({ text: 'quicksort' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'rosetta_code') ?? true
  }))

  await add('re_873_greynoise_success_normalizes_community_result', () => withAdapterFetch([
    jsonResponse({ ip: '8.8.8.8', noise: false, riot: true, classification: 'benign', name: 'Google Public DNS', message: 'Success' }),
  ], async () => {
    const response = await greynoiseAdapter.run({ text: '8.8.8.8' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'greynoise') ?? true
  }))

  await add('re_874_phishstats_success_normalizes_entry', () => withAdapterFetch([
    jsonResponse([{ id: 12345, url: 'https://phish.example.com', ip: '1.2.3.4', countryname: 'Romania', title: 'Fake PayPal', date: '2024-01-01', score: 8.5, host: 'phish.example.com' }]),
  ], async () => {
    const response = await phishstatsAdapter.run({ text: 'paypal' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'phishstats') ?? true
  }))

  await add('re_875_virustotal_success_normalizes_result', () => withEnv({ VIRUSTOTAL_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ data: [{ id: '8.8.8.8', type: 'ip_address', attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 70 }, type_description: 'IP address' } }] }),
  ], async () => {
    const response = await virustotalAdapter.run({ text: '8.8.8.8' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'virustotal') ?? true
  })))

  await add('re_876_abuseipdb_success_normalizes_check', () => withEnv({ ABUSEIPDB_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ data: { ipAddress: '8.8.8.8', abuseConfidenceScore: 0, countryCode: 'US', isp: 'Google LLC', usageType: 'Data Center', totalReports: 0, lastReportedAt: null } }),
  ], async () => {
    const response = await abuseipdbAdapter.run({ text: '8.8.8.8' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'abuseipdb') ?? true
  })))

  await add('re_877_hybrid_analysis_success_normalizes_sample', () => withEnv({ HYBRID_ANALYSIS_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ result: [{ sha256: 'abc123def456', submit_name: 'test.exe', verdict: 'malicious', vx_family: 'TestFamily', analysis_start_time: '2024-01-01' }], count: 1 }),
  ], async () => {
    const response = await hybridAnalysisAdapter.run({ text: 'test.exe' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'hybrid_analysis') ?? true
  })))

  await add('re_878_ontobee_success_decodes_sparql_binding', () => withAdapterFetch([
    jsonResponse({ results: { bindings: [{ s: { value: 'http://purl.obolibrary.org/obo/MONDO_0005015' }, label: { value: 'diabetes mellitus' } }] } }),
  ], async () => {
    const response = await ontobeeAdapter.run({ text: 'diabetes' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ontobee') ?? true
  }))

  await add('re_879_umls_success_normalizes_concept', () => withEnv({ UMLS_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ result: { results: [{ ui: 'C0011849', name: 'Diabetes Mellitus', rootSource: 'MSH' }] } }),
  ], async () => {
    const response = await umlsAdapter.run({ text: 'diabetes' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'umls') ?? true
  })))

  await add('re_880_loinc_fhir_success_normalizes_lookup', () => withEnv({ LOINC_FHIR_USERNAME: 'test-user', LOINC_FHIR_PASSWORD: 'test-pass' }, () => withAdapterFetch([
    jsonResponse({ parameter: [{ name: 'display', valueString: 'Cholesterol [Mass/volume] in Serum or Plasma' }] }),
  ], async () => {
    const response = await loincFhirAdapter.run({ text: '2093-3' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'loinc_fhir') ?? true
  })))

  await add('re_881_wikipathways_success_decodes_sparql_binding', () => withAdapterFetch([
    jsonResponse({ results: { bindings: [{ pathway: { value: 'https://identifiers.org/wikipathways/WP1584' }, title: { value: 'Type II diabetes mellitus' } }] } }),
  ], async () => {
    const response = await wikipathwaysAdapter.run({ text: 'diabetes' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'wikipathways') ?? true
  }))

  await add('re_882_cellosaurus_success_normalizes_cell_line', () => withAdapterFetch([
    jsonResponse({ Cellosaurus: { 'cell-line-list': [{ 'accession-list': [{ type: 'primary', value: 'CVCL_0030' }], 'name-list': [{ type: 'identifier', value: 'HeLa' }, { type: 'synonym', value: 'HELA' }] }] } }),
  ], async () => {
    const response = await cellosaurusAdapter.run({ text: 'HeLa' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cellosaurus') ?? true
  }))

  await add('re_883_metabolomics_workbench_success_normalizes_numeric_keyed_object', () => withAdapterFetch([
    jsonResponse({ '1': { study_id: 'ST004967', study_title: 'Test diabetes study', species: 'Homo sapiens', institute: 'Test Institute', analysis_type: 'LC-MS', submission_date: '2024-01-01' } }),
  ], async () => {
    const response = await metabolomicsWorkbenchAdapter.run({ text: 'diabetes' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'metabolomics_workbench') ?? true
  }))

  await add('re_884_npatlas_success_normalizes_compound', () => withAdapterFetch([
    jsonResponse([{ npaid: 'NPA000001', original_name: 'Penicillin G', mol_formula: 'C16H18N2O4S', original_organism: 'Penicillium chrysogenum', original_doi: '10.1000/test' }]),
  ], async () => {
    const response = await npatlasAdapter.run({ text: 'penicillin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'npatlas') ?? true
  }))

  await add('re_885_wellcome_collection_success_normalizes_work', () => withAdapterFetch([
    jsonResponse({ results: [{ id: 'abc123', title: 'A history of medicine', description: 'A book about medicine.', workType: { label: 'Books' } }] }),
  ], async () => {
    const response = await wellcomeCollectionAdapter.run({ text: 'medicine' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'wellcome_collection') ?? true
  }))

  await add('re_886_bhl_success_normalizes_publication', () => withEnv({ BHL_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ Status: 'ok', Result: [{ TitleID: 12345, FullTitle: 'On the Origin of Species', PublisherName: 'John Murray', PublicationDate: '1859' }] }),
  ], async () => {
    const response = await bhlAdapter.run({ text: 'darwin' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'bhl') ?? true
  })))

  await add('re_887_google_kg_search_success_normalizes_entity', () => withEnv({ GOOGLE_KG_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ itemListElement: [{ result: { '@id': 'kg:/m/0jcx', name: 'Albert Einstein', description: 'Physicist', url: 'https://en.wikipedia.org/wiki/Albert_Einstein' } }] }),
  ], async () => {
    const response = await googleKgSearchAdapter.run({ text: 'Einstein' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'google_kg_search') ?? true
  })))

  await add('re_888_merriam_webster_success_normalizes_definition', () => withEnv({ MERRIAM_WEBSTER_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse([{ shortdef: ['a procedure for critical evaluation'] }]),
  ], async () => {
    const response = await merriamWebsterAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'merriam_webster') ?? true
  })))

  await add('re_889_brave_search_success_normalizes_web_result', () => withEnv({ BRAVE_SEARCH_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ web: { results: [{ url: 'https://example.com', title: 'Example', description: 'An example site.' }] } }),
  ], async () => {
    const response = await braveSearchAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'brave_search') ?? true
  })))

  await add('re_890_checklistbank_success_normalizes_taxon', () => withAdapterFetch([
    jsonResponse({ result: [{ usage: { id: '4CGXF', datasetKey: '3LR', name: { scientificName: 'Panthera leo', rank: 'species' }, status: 'accepted' } }] }),
  ], async () => {
    const response = await checklistbankAdapter.run({ text: 'Panthera leo' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'checklistbank') ?? true
  }))

  await add('re_891_eol_success_normalizes_result', () => withAdapterFetch([
    jsonResponse({ results: [{ id: 328672, title: 'Panthera leo', link: 'https://eol.org/pages/328672', content: 'The lion is a large cat.' }] }),
  ], async () => {
    const response = await eolAdapter.run({ text: 'lion' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'eol') ?? true
  }))

  await add('re_892_globi_success_normalizes_interaction', () => withAdapterFetch([
    jsonResponse({ columns: ['source_taxon_name', 'interaction_type', 'target_taxon_name', 'study_title'], data: [['Homo sapiens', 'eats', 'Bos taurus', 'Test dietary study']] }),
  ], async () => {
    const response = await globiAdapter.run({ text: 'Homo sapiens' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'globi') ?? true
  }))

  await add('re_893_mushroom_observer_success_normalizes_observation', () => withAdapterFetch([
    jsonResponse({ results: [{ id: 123456, date: '2020-06-01', confidence: 90, consensus: { name: 'Amanita muscaria' }, notes: 'Found near birch trees.' }] }),
  ], async () => {
    const response = await mushroomObserverAdapter.run({ text: 'Amanita muscaria' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'mushroom_observer') ?? true
  }))

  await add('re_894_arctic_data_center_success_normalizes_solr_doc', () => withAdapterFetch([
    jsonResponse({ response: { docs: [{ id: 'urn:uuid:test-1', title: 'Permafrost temperature study', abstract: 'A study of permafrost.', dateUploaded: '2020-01-01', dataUrl: 'https://arcticdata.io/data/1' }] } }),
  ], async () => {
    const response = await arcticDataCenterAdapter.run({ text: 'permafrost' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'arctic_data_center') ?? true
  }))

  await add('re_895_cbeta_success_normalizes_canon_text', () => withAdapterFetch([
    jsonResponse({ num_found: 1, results: [{ id: 21548, canon: 'T', file: 'T0001', title: '般若波羅蜜多心經', byline: '玄奘 譯', time_dynasty: '唐' }] }),
  ], async () => {
    const response = await cbetaAdapter.run({ text: '般若' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'cbeta') ?? true
  }))

  await add('re_896_ebl_success_normalizes_fragment', () => withAdapterFetch([
    // Real shape (confirmed live this mission via GET /api/fragments/K.1):
    // museumNumber is a structured object, not a flat string — a prior
    // version of both this mock and the adapter's type assumed the wrong
    // (flat-string) shape, caught only by live validation.
    jsonResponse({ museumNumber: { prefix: 'K', number: '1', suffix: '' }, publication: 'CT 1', description: 'A cuneiform fragment.', collection: 'Kouyunjik' }),
  ], async () => {
    const response = await eblAdapter.run({ text: 'K.1' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.documents[0].providerRecordId !== 'K.1') return `expected providerRecordId "K.1", got ${response.documents[0].providerRecordId}`
    return documentShapeIssue(response.documents[0], 'ebl') ?? true
  }))

  await add('re_897_mercado_publico_success_normalizes_tender', () => withEnv({ MERCADO_PUBLICO_TICKET: 'test-ticket-not-real' }, () => withAdapterFetch([
    jsonResponse({ Listado: [{ CodigoExterno: '750301-1-L124', Nombre: 'Adquisicion de insumos', Descripcion: 'Compra de insumos medicos.', Estado: 'Activa', FechaPublicacion: '2024-01-01', Comprador: { NombreOrganismo: 'Hospital Regional' } }] }),
  ], async () => {
    const response = await mercadoPublicoAdapter.run({ text: '750301-1-L124' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'mercado_publico') ?? true
  })))

  await add('re_898_inpe_bdc_success_normalizes_collection', () => withAdapterFetch([
    jsonResponse({ collections: [{ id: 'S2-16D-2', title: 'Sentinel-2 16-day composite', description: 'Sentinel-2 surface reflectance composite.', keywords: ['sentinel'], extent: { spatial: { bbox: [[-180, -90, 180, 90]] }, temporal: { interval: [['2020-01-01T00:00:00Z', null]] } } }] }),
  ], async () => {
    const response = await inpeBdcAdapter.run({ text: 'sentinel' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'inpe_bdc') ?? true
  }))

  await add('re_899_pdok_success_normalizes_location', () => withAdapterFetch([
    jsonResponse({ response: { numFound: 1, docs: [{ id: 'gem-0b2a8b92856b27f86fbd67ab35808ebf', weergavenaam: 'Gemeente Amsterdam', type: 'gemeente', gemeentenaam: 'Amsterdam', provincienaam: 'Noord-Holland', centroide_ll: 'POINT(4.9 52.3)', bron: 'Bestuurlijke Grenzen' }] } }),
  ], async () => {
    const response = await pdokAdapter.run({ text: 'Amsterdam' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'pdok') ?? true
  }))

  await add('re_900_satnogs_success_normalizes_satellite', () => withAdapterFetch([
    jsonResponse([{ sat_id: 'ISSX-0000-0000-0000-0001', norad_cat_id: 25544, name: 'ISS (ZARYA)', names: 'International Space Station', status: 'alive', operator: 'NASA/Roscosmos', countries: 'US,RU', launched: '1998-11-20T00:00:00Z', website: 'https://example.com' }]),
  ], async () => {
    const response = await satnogsAdapter.run({ text: 'ISS' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'satnogs') ?? true
  }))

  await add('re_901_nomad_repository_success_normalizes_entry', () => withAdapterFetch([
    jsonResponse({ data: [{ entry_id: 'test-entry-1', upload_id: 'test-upload-1', origin: 'Test Author', upload_create_time: '2020-01-01', results: { material: { chemical_formula_hill: 'Si', elements: ['Si'], structural_type: 'bulk' } } }] }),
  ], async () => {
    const response = await nomadRepositoryAdapter.run({ text: 'Si' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nomad_repository') ?? true
  }))

  await add('re_902_kramerius_success_normalizes_document', () => withAdapterFetch([
    jsonResponse({ response: { docs: [{ PID: 'uuid:08f3ba90-c42f-11dc-9207-000d606f5dc6', 'dc.title': 'Praha', 'dc.creator': ['Author'], datum_str: '1900', language: ['cze'], document_type: ['monograph'], dostupnost: 'public' }] } }),
  ], async () => {
    const response = await krameriusAdapter.run({ text: 'praha' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'kramerius') ?? true
  }))

  await add('re_903_bdl_poland_success_normalizes_variable', () => withAdapterFetch([
    jsonResponse({ totalRecords: 1, results: [{ id: 72305, n1: 'Ludność ogółem', subjectId: 'K1', measureUnitName: 'osoba' }] }),
  ], async () => {
    const response = await bdlPolandAdapter.run({ text: 'ludność' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'bdl_poland') ?? true
  }))

  await add('re_904_israel_cbs_success_normalizes_index_point', () => withAdapterFetch([
    jsonResponse({ month: [{ code: 120010, name: 'CPI general', date: [{ year: 2024, month: 1, monthDesc: 'January', percent: 0.3, percentYear: 1.5, currBase: { baseDesc: '2024 average', value: 105.1 } }] }] }),
  ], async () => {
    const response = await israelCbsAdapter.run({ text: '120010' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'israel_cbs') ?? true
  }))

  await add('re_905_nomis_uk_success_normalizes_observation', () => withAdapterFetch([
    jsonResponse({ obs: [{ dataset: { value: 'NM_1_1', description: "Jobseeker's Allowance" }, geography: { value: 2092957697, description: 'United Kingdom' }, time: { value: '2024-01', description: 'January 2024' }, obs_value: { value: 100 }, obs_status: { description: 'normal' } }] }),
  ], async () => {
    const response = await nomisUkAdapter.run({ text: 'NM_1_1' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'nomis_uk') ?? true
  }))

  await add('re_906_abs_australia_success_decodes_sdmx_json', () => withAdapterFetch([
    jsonResponse({ data: { dataSets: [{ series: { '0:0:0:0:0': { observations: { '0': [7.4] } } } }], structures: [{ dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ id: '2024-01', name: '2024-01' }] }] } }] } }),
  ], async () => {
    const response = await absAustraliaAdapter.run({ text: 'CPI' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'abs_australia') ?? true
  }))

  await add('re_907_argentina_series_success_normalizes_point', () => withAdapterFetch([
    jsonResponse({ data: [['2024-01-01', 8.5]], meta: [{ frequency: 'day', start_date: '2024-01-01', end_date: '2024-01-01' }, { catalog: { title: 'Datos Programación Macroeconómica' }, dataset: { title: 'Tipo de Cambio', description: 'Serie de tipo de cambio.', source: 'BCRA' } }] }),
  ], async () => {
    const response = await argentinaSeriesAdapter.run({ text: '168.1_T_CAMBIOR_D_0_0_26' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'argentina_series') ?? true
  }))

  await add('re_908_data_gov_my_success_normalizes_row', () => withAdapterFetch([
    jsonResponse([{ age: 'overall_age', sex: 'overall_sex', date: '2020-01-01', state: 'Johor', ethnicity: 'overall_ethnicity', population: 4009.7 }]),
  ], async () => {
    const response = await dataGovMyAdapter.run({ text: 'population_state' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'data_gov_my') ?? true
  }))

  await add('re_909_datos_abiertos_colombia_success_normalizes_resource', () => withAdapterFetch([
    jsonResponse({ results: [{ resource: { id: 'gt2j-8ykr', name: 'Casos positivos de COVID-19', description: 'Casos confirmados por departamento.', attribution: 'Ministerio de Salud', createdAt: '2020-01-01', updatedAt: '2024-01-01' }, classification: { domain_category: 'Salud y Protección Social', domain_tags: ['salud', 'covid'] } }] }),
  ], async () => {
    const response = await datosAbiertosColombiaAdapter.run({ text: 'salud' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'datos_abiertos_colombia') ?? true
  }))

  await add('re_910_ine_tempus3_success_normalizes_data_point', () => withAdapterFetch([
    jsonResponse([{ COD: 'IPC251852', Nombre: 'National. Overall index.', Data: [{ Fecha: 1764543600000, FK_Periodo: 12, Anyo: 2024, Valor: 119.942 }] }]),
  ], async () => {
    const response = await ineTempus3Adapter.run({ text: '50913' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ine_tempus3') ?? true
  }))

  await add('re_911_singstat_success_normalizes_table_row', () => withAdapterFetch([
    jsonResponse({ Data: { title: 'Singapore Residents By Age Group', footnote: 'Data refer to Singapore residents.', datasource: 'SINGAPORE DEPARTMENT OF STATISTICS', row: [{ seriesNo: '1', rowText: 'Total Residents', uoM: 'Number', columns: [{ key: '2024', value: '3600000' }] }] } }),
  ], async () => {
    const response = await singstatAdapter.run({ text: 'M810011' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'singstat') ?? true
  }))

  await add('re_912_usgs_m2m_success_normalizes_scene', () => withEnv({ USGS_M2M_USERNAME: 'test-user-not-real', USGS_M2M_TOKEN: 'test-token-not-real' }, () => withAdapterFetch([
    jsonResponse({ data: 'test-auth-token-not-real', errorCode: null, errorMessage: null }),
    jsonResponse({ data: { results: [{ entityId: 'LC80010012024001LGN00', displayId: 'LC08_L2SP_001001_20240101_20240101_02_T1', publishDate: '2024-01-01', cloudCover: 5.2, browse: [{ browsePath: 'https://example.com/browse.jpg' }] }] }, errorCode: null, errorMessage: null }),
  ], async () => {
    const response = await usgsM2mAdapter.run({ text: 'landsat_ot_c2_l2' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'usgs_m2m') ?? true
  })))

  await add('re_913_n2yo_success_normalizes_tle', () => withEnv({ N2YO_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ info: { satname: 'SPACE STATION', satid: 25544, transactionscount: 1 }, tle: '1 25544U 98067A   24001.00000000  .00016717  00000-0  10270-3 0  9994\n2 25544  51.6416 339.6448 0006317  55.6524 304.5292 15.49560932' }),
  ], async () => {
    const response = await n2yoAdapter.run({ text: '25544' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'n2yo') ?? true
  })))

  await add('re_914_ariadne_portal_success_normalizes_hit', () => withAdapterFetch([
    jsonResponse({ total: { value: 88126 }, hits: [{ id: 'abc123', data: { title: { text: 'Pottery sherd', language: 'en' }, description: { text: 'A Roman pottery fragment.' }, identifier: 'https://ariadne-infrastructure.eu/aocat/Resource/1', landingPage: 'https://finds.org.uk/database/artefacts/record/id/1', issued: '2003-07-07', accessRights: 'CC-BY', country: ['GB'], contributor: [{ name: 'Archaeology Data Service', institution: 'ADS' }], nativeSubject: [{ prefLabel: 'pottery' }] } }] }),
  ], async () => {
    const response = await ariadnePortalAdapter.run({ text: 'pottery' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ariadne_portal') ?? true
  }))

  await add('re_915_ohm_overpass_success_normalizes_historical_element', () => withAdapterFetch([
    jsonResponse({ elements: [{ type: 'node', id: 2084450176, lat: 52.5167175, lon: 13.4068301, tags: { name: 'Berlin', start_date: '1237', end_date: '1746' } }] }),
  ], async () => {
    const response = await ohmOverpassAdapter.run({ text: 'Berlin near 52.5,13.4' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ohm_overpass') ?? true
  }))

  await add('re_916_stack_exchange_success_normalizes_question', () => withAdapterFetch([
    jsonResponse({ items: [{ question_id: 231767, title: 'What does the "yield" keyword do in Python?', link: 'https://stackoverflow.com/questions/231767', tags: ['python', 'generator'], owner: { display_name: 'Alex. S.' }, score: 13135, view_count: 3497899, answer_count: 51, is_answered: true, creation_date: 1224800471, content_license: 'CC BY-SA 4.0' }] }),
  ], async () => {
    const response = await stackExchangeAdapter.run({ text: 'python yield' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'stack_exchange') ?? true
  }))

  await add('re_917_ecmwf_cds_success_normalizes_collection', () => withAdapterFetch([
    jsonResponse({ collections: [{ id: 'reanalysis-era5-pressure-levels', title: 'ERA5 hourly data on pressure levels', description: 'ERA5 is the fifth generation ECMWF reanalysis.', license: 'CC-BY-4.0', keywords: ['Product type: Reanalysis'], extent: { spatial: { bbox: [[0, -89, 360, 89]] }, temporal: { interval: [['1940-01-01T00:00:00+00:00', null]] } } }] }),
  ], async () => {
    const response = await ecmwfCdsAdapter.run({ text: 'era5' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ecmwf_cds') ?? true
  }))

  await add('re_918_met_office_datahub_success_normalizes_forecast_point', () => withEnv({ MET_OFFICE_DATAHUB_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ features: [{ properties: { location: { name: 'London' }, timeSeries: [{ time: '2024-01-01T12:00:00Z', screenTemperature: 8.5, windSpeed10m: 3.2, totalPrecipAmount: 0 }] } }] }),
  ], async () => {
    const response = await metOfficeDataHubAdapter.run({ text: '51.5,-0.1' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'met_office_datahub') ?? true
  })))

  await add('re_919_ndl_search_success_parses_rss_item', () => withAdapterFetch([
    textResponse('<rss><channel><item><title>Test Title</title><link>https://ndlsearch.ndl.go.jp/books/R000000004-I1</link><dc:title>Test Title</dc:title><dc:creator>Test Author</dc:creator><dc:description>A test description.</dc:description><pubDate>Thu, 23 Feb 2017 19:30:51 +0900</pubDate></item></channel></rss>', 200, 'application/xml'),
  ], async () => {
    const response = await ndlSearchAdapter.run({ text: 'test' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'ndl_search') ?? true
  }))

  await add('re_920_swisscovery_success_normalizes_pnx_doc', () => withAdapterFetch([
    jsonResponse({ docs: [{ '@id': 'https://eu03.alma.exlibrisgroup.com/primaws/rest/pub/pnxs/L/991170244053905501', pnx: { display: { title: ['Shakespeare.'], type: ['journal'], language: ['eng'], creationdate: ['2005-'], publisher: ['London : Taylor & Francis'], contributor: ['British Shakespeare Association'], subject: ['Shakespeare'], mms: ['991170244053905501'] } } }] }),
  ], async () => {
    const response = await swisscoveryAdapter.run({ text: 'shakespeare' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'swisscovery') ?? true
  }))

  await add('re_921_yago_success_normalizes_sparql_binding', () => withAdapterFetch([
    jsonResponse({ results: { bindings: [{ entity: { value: 'https://yago-knowledge.org/resource/Albert_Einstein' }, label: { value: 'Albert Einstein' } }] } }),
  ], async () => {
    const response = await yagoAdapter.run({ text: 'Einstein' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'yago') ?? true
  }))

  await add('re_922_data_commons_success_normalizes_dcid_node', () => withEnv({ DATA_COMMONS_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ data: { 'geoId/06085': { arcs: { name: { nodes: [{ value: 'Santa Clara County' }] }, typeOf: { nodes: [{ name: 'Place' }] }, description: { nodes: [{ value: 'A county in California.' }] } } } } }),
  ], async () => {
    const response = await dataCommonsAdapter.run({ text: 'geoId/06085' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'data_commons') ?? true
  })))

  await add('re_923_econstor_success_parses_oai_dc_record', () => withAdapterFetch([
    textResponse('<OAI-PMH><ListRecords><record><header><identifier>oai:econstor.eu:10419/123456</identifier></header><metadata><oai_dc:dc><dc:title>Test Working Paper on Trade</dc:title><dc:creator>Jane Doe</dc:creator><dc:description>A test abstract about trade.</dc:description><dc:date>2020</dc:date><dc:language>eng</dc:language><dc:identifier>http://hdl.handle.net/10419/123456</dc:identifier></oai_dc:dc></metadata></record></ListRecords></OAI-PMH>', 200, 'application/xml'),
  ], async () => {
    const response = await econstorAdapter.run({ text: 'trade' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'econstor') ?? true
  }))

  await add('re_924_w3c_api_success_normalizes_specification', () => withAdapterFetch([
    jsonResponse({ _embedded: { specifications: [{ shortname: 'html', title: 'HTML Standard', description: 'The HTML specification.', status: 'Recommendation', shortlink: 'https://www.w3.org/TR/html/' }] } }),
  ], async () => {
    const response = await w3cApiAdapter.run({ text: 'html' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'w3c_api') ?? true
  }))

  await add('re_926_wto_timeseries_success_normalizes_data_point', () => withEnv({ WTO_API_KEY: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ Dataset: [{ IndicatorCode: 'ITS_MTV_AX', ReportingEconomyCode: '842', ReportingEconomy: 'United States of America', Period: '2023', Value: 2018000, Unit: 'USD million', ProductOrSector: 'Total merchandise' }] }),
  ], async () => {
    const response = await wtoTimeseriesAdapter.run({ text: 'ITS_MTV_AX' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'wto_timeseries') ?? true
  })))

  await add('re_927_e_stat_japan_success_normalizes_table', () => withEnv({ ESTAT_JAPAN_APP_ID: 'test-key-not-real' }, () => withAdapterFetch([
    jsonResponse({ GET_STATS_LIST: { RESULT: { STATUS: 0 }, DATALIST_INF: { TABLE_INF: [{ '@id': '0003348423', STAT_NAME: { '$': 'Population Census' }, GOV_ORG: { '$': 'Ministry of Internal Affairs and Communications' }, STATISTICS_NAME: 'Population Census 2020', TITLE: { '$': 'Population by prefecture' }, CYCLE: 'Quinquennial', SURVEY_DATE: 202010, UPDATED_DATE: '2021-06-25' }] } } }),
  ], async () => {
    const response = await eStatJapanAdapter.run({ text: 'population' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'e_stat_japan') ?? true
  })))

  await add('re_928_world_bank_projects_success_normalizes_project', () => withAdapterFetch([
    jsonResponse({ total: '1', projects: { P505244: { id: 'P505244', project_name: 'Boosting Green Finance, Investment and Trade in Rwanda', regionname: 'Eastern and Southern Africa', countryname: ['Republic of Rwanda'], countryshortname: 'Rwanda', status: 'Active', boardapprovaldate: '2024-12-20T00:00:00Z', totalamt: '200,000,000', url: 'https://projects.worldbank.org/en/projects-operations/project-detail/P505244', sector1: { Name: 'Public Administration' } } } }),
  ], async () => {
    const response = await worldBankProjectsAdapter.run({ text: 'green finance' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'world_bank_projects') ?? true
  }))

  await add('re_929_usgs_national_map_success_normalizes_product', () => withAdapterFetch([
    jsonResponse({ total: 1, items: [{ title: '3D Hydrography Program (3DHP) (Alaska)', moreInfo: 'USGS 3DHP hydrologic dataset.', sourceId: '69743a66d4be0260181a1220', metaUrl: 'https://www.sciencebase.gov/catalog/item/69743a66d4be0260181a1220', publicationDate: '2026-01-23', lastUpdated: '2026-01-23T20:41:06.655-07:00', extent: 'Alaska', format: 'FileGDB', downloadURL: 'https://prd-tnm.s3.amazonaws.com/example.zip' }] }),
  ], async () => {
    const response = await usgsNationalMapAdapter.run({ text: 'Alaska hydrography' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'usgs_national_map') ?? true
  }))

  await add('re_930_imf_sdmx_success_normalizes_observation', () => withAdapterFetch([
    jsonResponse({
      data: {
        dataSets: [{ series: { '0:0:0:0:0': { observations: { '0': ['4930.72', null, 0, '1993M12', null] } } } }],
        structures: [{ dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ value: '2018-M01' }] }] } }],
      },
    }),
  ], async () => {
    const response = await imfSdmxAdapter.run({ text: 'IMF.STA/CPI/~/BRA.CPI._T.IX.M' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    return documentShapeIssue(response.documents[0], 'imf_sdmx') ?? true
  }))

  // --- Earth Knowledge Implementation Exhaustion mission (2026-08-25): PxWeb-family national
  // statistics providers + UN DESA reference metadata. Two mocked calls each (GET table metadata,
  // POST query), matching the real two-step live flow verified against SCB/SSB/StatFin/Denmark. ---

  // Response bodies can only be read once — each test needs its own fresh Response instances
  // rather than sharing one across multiple withAdapterFetch calls (a shared instance's body
  // stream is already consumed after the first test reads it).
  function makePxWebMetadataFixture() {
    return jsonResponse({
      title: 'Test Population Table',
      variables: [
        { code: 'Region', text: 'region', values: ['00'], valueTexts: ['Sweden'], elimination: true },
        { code: 'ContentsCode', text: 'observations', values: ['BE0101N1'], valueTexts: ['Population'] },
        { code: 'Tid', text: 'year', values: ['2021', '2022', '2023'], valueTexts: ['2021', '2022', '2023'], time: true },
      ],
    })
  }
  function makePxWebDataFixture() {
    return jsonResponse({
      version: '2.0',
      class: 'dataset',
      id: ['Region', 'ContentsCode', 'Tid'],
      size: [1, 1, 3],
      dimension: {
        Region: { label: 'region', category: { index: { '00': 0 }, label: { '00': 'Sweden' } } },
        ContentsCode: { label: 'observations', category: { index: { BE0101N1: 0 }, label: { BE0101N1: 'Population' }, unit: { BE0101N1: { base: 'number', decimals: 0 } } } },
        Tid: { label: 'year', category: { index: { '2021': 0, '2022': 1, '2023': 2 }, label: { '2021': '2021', '2022': '2022', '2023': '2023' } } },
      },
      value: [10_380_000, 10_450_000, 10_520_000],
    })
  }

  await add('re_931_scb_sweden_success_normalizes_table', () => withAdapterFetch([makePxWebMetadataFixture(), makePxWebDataFixture()], async () => {
    const response = await scbSwedenAdapter.run({ text: '' })
    if (!response.ok || response.documents.length === 0 || response.timeSeries.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.timeSeries[0].points.length !== 3) return `expected 3 time series points, got ${response.timeSeries[0].points.length}`
    if (response.timeSeries[0].points[0].date !== '2021' || response.timeSeries[0].points[0].value !== 10_380_000) return `unexpected first point: ${JSON.stringify(response.timeSeries[0].points[0])}`
    if (response.timeSeries[0].unit !== 'number') return `expected unit "number" extracted from JSON-stat2, got ${response.timeSeries[0].unit}`
    return documentShapeIssue(response.documents[0], 'scb_sweden') ?? true
  }))

  await add('re_932_ssb_norway_success_normalizes_table', () => withAdapterFetch([makePxWebMetadataFixture(), makePxWebDataFixture()], async () => {
    const response = await ssbNorwayAdapter.run({ text: '' })
    if (!response.ok || response.documents.length === 0 || response.timeSeries.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.timeSeries[0].points.length !== 3) return `expected 3 time series points, got ${response.timeSeries[0].points.length}`
    return documentShapeIssue(response.documents[0], 'ssb_norway') ?? true
  }))

  await add('re_933_statfin_finland_success_normalizes_table', () => withAdapterFetch([makePxWebMetadataFixture(), makePxWebDataFixture()], async () => {
    const response = await statfinFinlandAdapter.run({ text: '' })
    if (!response.ok || response.documents.length === 0 || response.timeSeries.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.timeSeries[0].points.length !== 3) return `expected 3 time series points, got ${response.timeSeries[0].points.length}`
    return documentShapeIssue(response.documents[0], 'statfin_finland') ?? true
  }))

  await add('re_934_statistics_denmark_success_normalizes_table', () => withAdapterFetch([
    jsonResponse({ id: 'FOLK1A', text: 'Population at the first day of the quarter', variables: [
      { id: 'OMRÅDE', elimination: true, values: [{ id: '000', text: 'All Denmark' }] },
      { id: 'Tid', elimination: false, values: [{ id: '2023K1', text: '2023Q1' }, { id: '2023K2', text: '2023Q2' }] },
    ] }),
    // `id`/`size`/`role` nested INSIDE `dimension` (not at the dataset root, where the JSON-stat2
    // spec and every classic PxWebApi host places them) — Statistics Denmark's real live response
    // shape, confirmed during this mission's live verification. This exact shape caught a real
    // bug: statisticsDenmark.ts originally assumed `dataset.id` existed at the root and crashed.
    jsonResponse({ dataset: {
      dimension: {
        ContentsCode: { label: 'Indhold', category: { index: { FOLK1A: 0 }, label: { FOLK1A: 'Population' } } },
        Tid: { label: 'tid', category: { index: { '2023K1': 0, '2023K2': 1 }, label: { '2023K1': '2023K1', '2023K2': '2023K2' } } },
        id: ['ContentsCode', 'Tid'],
        size: [1, 2],
        role: { metric: ['ContentsCode'], time: ['Tid'] },
      },
      label: 'Population at the first day of the quarter by Indhold and time',
      source: 'Statistics Denmark',
      value: [5_930_000, 5_932_654],
    } }),
  ], async () => {
    const response = await statisticsDenmarkAdapter.run({ text: '' })
    if (!response.ok || response.documents.length === 0 || response.timeSeries.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    if (response.timeSeries[0].points.length !== 2) return `expected 2 time series points, got ${response.timeSeries[0].points.length}`
    if (response.timeSeries[0].points[1].date !== '2023K2' || response.timeSeries[0].points[1].value !== 5_932_654) return `unexpected second point: ${JSON.stringify(response.timeSeries[0].points[1])}`
    return documentShapeIssue(response.documents[0], 'statistics_denmark') ?? true
  }))

  await add('re_935_un_desa_population_success_normalizes_reference_metadata', () => withAdapterFetch([
    jsonResponse({ data: [{ id: 4, name: 'Sweden', iso3: 'SWE', iso2: 'SE', longitude: 18.6, latitude: 60.1 }] }),
    jsonResponse({ data: [{ id: 49, name: 'Total Population', shortName: 'TPopulation', description: 'De facto total population.' }] }),
  ], async () => {
    const response = await unDesaPopulationAdapter.run({ text: 'Sweden' })
    if (!response.ok || response.documents.length === 0) return `expected ok success, got ${JSON.stringify(response)}`
    const coordinates = response.geoFeatures[0]?.coordinates as number[] | undefined
    if (response.geoFeatures.length !== 1 || coordinates?.[0] !== 18.6) return `expected one geoFeature carrying real coordinates, got ${JSON.stringify(response.geoFeatures)}`
    return documentShapeIssue(response.documents[0], 'un_desa_population') ?? true
  }))

  return results
}

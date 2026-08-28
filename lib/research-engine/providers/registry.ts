import 'server-only'

import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { githubAdapter } from '@/lib/research-engine/providers/github'
import { digitrafficMarineAdapter } from '@/lib/research-engine/providers/digitraffic_marine'
import { digitrafficRoadCamerasAdapter } from '@/lib/research-engine/providers/digitraffic_road_cameras'
import { drivebcEventsAdapter } from '@/lib/research-engine/providers/drivebc_events'
import { arxivAdapter } from '@/lib/research-engine/providers/arxiv'
import { crossrefAdapter } from '@/lib/research-engine/providers/crossref'
import { fredAdapter } from '@/lib/research-engine/providers/fred'
import { worldBankIndicatorsAdapter } from '@/lib/research-engine/providers/worldBankIndicators'
import { usgsEarthquakeAdapter } from '@/lib/research-engine/providers/usgsEarthquake'
import { wikidataAdapter } from '@/lib/research-engine/providers/wikidata'
import { ncbiAdapter } from '@/lib/research-engine/providers/ncbi'
import { exaAdapter } from '@/lib/research-engine/providers/exa'
import { libraryOfCongressAdapter } from '@/lib/research-engine/providers/libraryOfCongress'
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
import { scbSwedenAdapter } from '@/lib/research-engine/providers/scbSweden'
import { ssbNorwayAdapter } from '@/lib/research-engine/providers/ssbNorway'
import { statfinFinlandAdapter } from '@/lib/research-engine/providers/statfinFinland'
import { statisticsDenmarkAdapter } from '@/lib/research-engine/providers/statisticsDenmark'
import { unDesaPopulationAdapter } from '@/lib/research-engine/providers/unDesaPopulation'
import { nhcCurrentStormsAdapter } from '@/lib/research-engine/providers/nhcCurrentStorms'
import { nasaEonetAdapter } from '@/lib/research-engine/providers/nasaEonet'
import { tsunamiGovAdapter } from '@/lib/research-engine/providers/tsunamiGov'
import { worldBankProjectsAdapter } from '@/lib/research-engine/providers/worldBankProjects'
import { usgsNationalMapAdapter } from '@/lib/research-engine/providers/usgsNationalMap'
import { imfSdmxAdapter } from '@/lib/research-engine/providers/imfSdmx'

/**
 * Only providers with a real, implemented adapter appear here. Every
 * provider (implemented or not) is still visible in
 * config/providerEnv.ts::RESEARCH_PROVIDER_ENV for configuration-status
 * reporting — this map is strictly narrower and is the source of truth for
 * "can the router actually call this provider."
 */
export const IMPLEMENTED_PROVIDER_ADAPTERS: Partial<Record<ResearchProviderId, ResearchProviderAdapter>> = {
  github: githubAdapter,
  arxiv: arxivAdapter,
  crossref: crossrefAdapter,
  fred: fredAdapter,
  world_bank_indicators: worldBankIndicatorsAdapter,
  usgs_earthquake: usgsEarthquakeAdapter,
  wikidata: wikidataAdapter,
  ncbi: ncbiAdapter,
  exa: exaAdapter,
  library_of_congress: libraryOfCongressAdapter,
  nasa_gibs: nasaGibsAdapter,
  usgs_water: usgsWaterAdapter,
  usgs_earthquake_feed: usgsEarthquakeFeedAdapter,
  usgs_sciencebase: usgsScienceBaseAdapter,
  semantic_scholar: semanticScholarAdapter,
  courtlistener: courtListenerAdapter,
  internet_archive: internetArchiveAdapter,
  wayback: waybackAdapter,
  common_crawl: commonCrawlAdapter,
  sam_gov: samGovAdapter,
  nasa: nasaAdapter,
  fmcsa: fmcsaAdapter,
  mitre_attack: mitreAttackAdapter,
  gleif: gleifAdapter,
  osv_dev: osvDevAdapter,
  nvd: nvdAdapter,
  cisa_kev: cisaKevAdapter,
  osm_overpass: osmOverpassAdapter,
  geonames: geonamesAdapter,
  eurostat: eurostatAdapter,
  wikipedia: wikipediaAdapter,
  europe_pmc: europePmcAdapter,
  clinicaltrials_gov: clinicalTrialsGovAdapter,
  openfda: openFdaAdapter,
  pubchem: pubchemAdapter,
  gbif: gbifAdapter,
  uniprot: uniprotAdapter,
  us_census: usCensusAdapter,
  congress_gov: congressGovAdapter,
  govinfo: govinfoAdapter,
  sec_edgar: secEdgarAdapter,
  orcid: orcidAdapter,
  reliefweb: reliefwebAdapter,
  ensembl: ensemblAdapter,
  rcsb_pdb: rcsbPdbAdapter,
  string_db: stringDbAdapter,
  gnomad: gnomadAdapter,
  ebi_ols: ebiOlsAdapter,
  medlineplus: medlineplusAdapter,
  who_gho: whoGhoAdapter,
  rxnorm: rxnormAdapter,
  dailymed: dailymedAdapter,
  chembl: chemblAdapter,
  open_targets: openTargetsAdapter,
  inaturalist: inaturalistAdapter,
  obis: obisAdapter,
  worms: wormsAdapter,
  itis: itisAdapter,
  pypi: pypiAdapter,
  npm_registry: npmRegistryAdapter,
  crates_io: cratesIoAdapter,
  rubygems: rubygemsAdapter,
  maven_central: mavenCentralAdapter,
  github_advisory: githubAdvisoryAdapter,
  endoflife: endoflifeAdapter,
  epss: epssAdapter,
  alienvault_otx: alienvaultOtxAdapter,
  malwarebazaar: malwarebazaarAdapter,
  threatfox: threatfoxAdapter,
  urlhaus: urlhausAdapter,
  federal_register: federalRegisterAdapter,
  usaspending: usaspendingAdapter,
  uk_legislation: ukLegislationAdapter,
  opensanctions: opensanctionsAdapter,
  companies_house: companiesHouseAdapter,
  ecb_sdw: ecbSdwAdapter,
  bank_of_canada: bankOfCanadaAdapter,
  bis_stats: bisStatsAdapter,
  eia: eiaAdapter,
  statcan_wds: statcanWdsAdapter,
  uk_ons: ukOnsAdapter,
  insee_melodi: inseeMelodiAdapter,
  open_meteo: openMeteoAdapter,
  noaa_cdo: noaaCdoAdapter,
  met_no: metNoAdapter,
  noaa_swpc: noaaSwpcAdapter,
  nominatim: nominatimAdapter,
  nasa_cmr: nasaCmrAdapter,
  copernicus_dataspace: copernicusDataspaceAdapter,
  opentopography: opentopographyAdapter,
  celestrak: celestrakAdapter,
  jpl_horizons: jplHorizonsAdapter,
  jpl_sbdb: jplSbdbAdapter,
  nasa_exoplanet_archive: nasaExoplanetArchiveAdapter,
  simbad: simbadAdapter,
  mast: mastAdapter,
  ror: rorAdapter,
  opencitations: opencitationsAdapter,
  biorxiv_medrxiv: biorxivMedrxivAdapter,
  hal: halAdapter,
  base_search: baseSearchAdapter,
  inspire_hep: inspireHepAdapter,
  hepdata: hepdataAdapter,
  zbmath: zbmathAdapter,
  oeis: oeisAdapter,
  nasa_ads: nasaAdsAdapter,
  epo_ops: epoOpsAdapter,
  materials_project: materialsProjectAdapter,
  oqmd: oqmdAdapter,
  aflow: aflowAdapter,
  pleiades: pleiadesAdapter,
  idai_gazetteer: idaiGazetteerAdapter,
  edh: edhAdapter,
  nomisma: nomismaAdapter,
  whg: whgAdapter,
  open_context: openContextAdapter,
  cdli: cdliAdapter,
  ehri: ehriAdapter,
  art_institute_chicago: artInstituteChicagoAdapter,
  cleveland_museum: clevelandMuseumAdapter,
  va_museum: vaMuseumAdapter,
  smk: smkAdapter,
  open_library: openLibraryAdapter,
  unhcr_data: unhcrDataAdapter,
  ocha_fts: ochaFtsAdapter,
  opensky: openskyAdapter,
  digitraffic_marine: digitrafficMarineAdapter,
  digitraffic_road_cameras: digitrafficRoadCamerasAdapter,
  drivebc_events: drivebcEventsAdapter,
  cbdb: cbdbAdapter,
  eclac_cepalstat: eclacCepalstatAdapter,
  oecd_data_explorer: oecdDataExplorerAdapter,
  un_sdg: unSdgAdapter,
  unesco_uis: unescoUisAdapter,
  idb_open_data: idbOpenDataAdapter,
  iati_datastore: iatiDatastoreAdapter,
  debian_sources: debianSourcesAdapter,
  ietf_datatracker: ietfDatatrackerAdapter,
  wikimedia_commons: wikimediaCommonsAdapter,
  dbpedia: dbpediaAdapter,
  dblp: dblpAdapter,
  mozilla_bugzilla: mozillaBugzillaAdapter,
  msrc_cvrf: msrcCvrfAdapter,
  isni: isniAdapter,
  lobid_gnd: lobidGndAdapter,
  factgrid: factgridAdapter,
  ubuntu_security: ubuntuSecurityAdapter,
  redhat_security_data: redhatSecurityDataAdapter,
  cve_org: cveOrgAdapter,
  conceptnet: conceptnetAdapter,
  ena_portal: enaPortalAdapter,
  ncbi_datasets: ncbiDatasetsAdapter,
  alphafold_db: alphafoldDbAdapter,
  reactome: reactomeAdapter,
  intact: intactAdapter,
  orphadata: orphadataAdapter,
  guide_to_pharmacology: guideToPharmacologyAdapter,
  clinpgx: clinpgxAdapter,
  pbdb: pbdbAdapter,
  nws_weather: nwsWeatherAdapter,
  japan_egov_hourei: japanEgovHoureiAdapter,
  australia_frl: australiaFrlAdapter,
  uk_gazette: ukGazetteAdapter,
  eu_ted: euTedAdapter,
  brazil_transparencia: brazilTransparenciaAdapter,
  sidra_brazil: sidraBrazilAdapter,
  cbs_statline: cbsStatlineAdapter,
  gaia_archive: gaiaArchiveAdapter,
  sdss_skyserver: sdssSkyserverAdapter,
  apache_jira: apacheJiraAdapter,
  health_canada_dpd: healthCanadaDpdAdapter,
  bindingdb: bindingdbAdapter,
  kegg: keggAdapter,
  metabolights: metabolightsAdapter,
  pride_archive: prideArchiveAdapter,
  libris_xl: librisXlAdapter,
  nasjonalbiblioteket: nasjonalbibliotekAdapter,
  nara_catalog: naraCatalogAdapter,
  jstage: jstageAdapter,
  cinii: ciniiAdapter,
  musicbrainz: musicbrainzAdapter,
  gitlab_api: gitlabApiAdapter,
  codeberg: codebergAdapter,
  software_heritage: softwareHeritageAdapter,
  launchpad: launchpadAdapter,
  metacpan: metacpanAdapter,
  ecosystems: ecosystemsAdapter,
  deps_dev: depsDevAdapter,
  homebrew: homebrewAdapter,
  mdn_web_docs: mdnWebDocsAdapter,
  rosetta_code: rosettaCodeAdapter,
  greynoise: greynoiseAdapter,
  phishstats: phishstatsAdapter,
  virustotal: virustotalAdapter,
  abuseipdb: abuseipdbAdapter,
  hybrid_analysis: hybridAnalysisAdapter,
  ontobee: ontobeeAdapter,
  umls: umlsAdapter,
  loinc_fhir: loincFhirAdapter,
  wikipathways: wikipathwaysAdapter,
  cellosaurus: cellosaurusAdapter,
  metabolomics_workbench: metabolomicsWorkbenchAdapter,
  npatlas: npatlasAdapter,
  wellcome_collection: wellcomeCollectionAdapter,
  bhl: bhlAdapter,
  google_kg_search: googleKgSearchAdapter,
  merriam_webster: merriamWebsterAdapter,
  brave_search: braveSearchAdapter,
  checklistbank: checklistbankAdapter,
  eol: eolAdapter,
  globi: globiAdapter,
  mushroom_observer: mushroomObserverAdapter,
  arctic_data_center: arcticDataCenterAdapter,
  cbeta: cbetaAdapter,
  ebl: eblAdapter,
  mercado_publico: mercadoPublicoAdapter,
  inpe_bdc: inpeBdcAdapter,
  pdok: pdokAdapter,
  satnogs: satnogsAdapter,
  nomad_repository: nomadRepositoryAdapter,
  kramerius: krameriusAdapter,
  bdl_poland: bdlPolandAdapter,
  israel_cbs: israelCbsAdapter,
  nomis_uk: nomisUkAdapter,
  abs_australia: absAustraliaAdapter,
  argentina_series: argentinaSeriesAdapter,
  data_gov_my: dataGovMyAdapter,
  datos_abiertos_colombia: datosAbiertosColombiaAdapter,
  ine_tempus3: ineTempus3Adapter,
  singstat: singstatAdapter,
  usgs_m2m: usgsM2mAdapter,
  n2yo: n2yoAdapter,
  ariadne_portal: ariadnePortalAdapter,
  ohm_overpass: ohmOverpassAdapter,
  stack_exchange: stackExchangeAdapter,
  ecmwf_cds: ecmwfCdsAdapter,
  met_office_datahub: metOfficeDataHubAdapter,
  ndl_search: ndlSearchAdapter,
  swisscovery: swisscoveryAdapter,
  yago: yagoAdapter,
  data_commons: dataCommonsAdapter,
  econstor: econstorAdapter,
  w3c_api: w3cApiAdapter,
  wto_timeseries: wtoTimeseriesAdapter,
  e_stat_japan: eStatJapanAdapter,
  scb_sweden: scbSwedenAdapter,
  ssb_norway: ssbNorwayAdapter,
  statfin_finland: statfinFinlandAdapter,
  statistics_denmark: statisticsDenmarkAdapter,
  un_desa_population: unDesaPopulationAdapter,
  nhc_current_storms: nhcCurrentStormsAdapter,
  nasa_eonet: nasaEonetAdapter,
  tsunami_gov: tsunamiGovAdapter,
  world_bank_projects: worldBankProjectsAdapter,
  usgs_national_map: usgsNationalMapAdapter,
  imf_sdmx: imfSdmxAdapter,
}

export function getImplementedAdapter(id: ResearchProviderId): ResearchProviderAdapter | null {
  return IMPLEMENTED_PROVIDER_ADAPTERS[id] ?? null
}

export function listImplementedProviderIds(): ResearchProviderId[] {
  return Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS) as ResearchProviderId[]
}

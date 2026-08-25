// Parses docs/earth-knowledge/registry-parsed.md (509-source Earth Knowledge Source
// Registry, extracted from the authoritative "EARTH KNOWLEDGE SOURCE REGISTRY.txt"
// backlog) and reconciles it against War Room's actual research-engine provider
// implementation state, producing:
//   - lib/earth-knowledge/completionRegistry.generated.ts (machine-readable, one
//     record per registry source, per mission item 20 of the Earth Knowledge
//     reconciliation directive)
//   - docs/earth-knowledge/gap-matrix.md (human-readable summary + full table)
//
// Re-run this script (`node scripts/earth-knowledge/build-completion-registry.mjs`)
// whenever a new provider adapter is implemented, to keep the registry current.
// The provider-mapping table below is hand-maintained — it is the only part of
// this script that requires a human to know "we built an adapter for X."

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const registryPath = join(repoRoot, 'docs/earth-knowledge/registry-parsed.md')
const outTsPath = join(repoRoot, 'lib/earth-knowledge/completionRegistry.generated.ts')
const outMdPath = join(repoRoot, 'docs/earth-knowledge/gap-matrix.md')

const raw = readFileSync(registryPath, 'utf8')
const lines = raw.split('\n')

/**
 * Hand-maintained: War Room ResearchProviderId -> matcher substrings used to
 * find that provider's corresponding row(s) in the Earth Knowledge Registry.
 * Matching is case-insensitive substring match against the registry's
 * "Source" column. A provider may match zero registry rows (e.g. Exa, SAM.gov,
 * FMCSA are War Room-specific integrations with no direct Earth Knowledge
 * Registry analog) or more than one row (e.g. internet_archive + wayback both
 * match the single bundled "Internet Archive / Wayback Machine" row).
 */
const PROVIDER_MATCHERS = {
  // --- Implemented before this mission (24) ---
  github: ['GitHub API', 'GitHub REST/GraphQL API'],
  ncbi: ['NCBI E-utilities', 'NCBI E-Utilities'],
  fred: ['FRED API'],
  semantic_scholar: ['Semantic Scholar'],
  arxiv: ['arXiv APIs', 'arXiv API'],
  crossref: ['Crossref API', 'Crossref'],
  nasa: ['NASA APIs', 'NASA Open APIs', 'NASA NeoWs'],
  nasa_gibs: ['NASA GIBS'],
  courtlistener: ['CourtListener'],
  internet_archive: ['Internet Archive / Wayback Machine'],
  wayback: ['Internet Archive / Wayback Machine'],
  world_bank_indicators: ['World Bank Indicators', 'World Bank WDI', 'World Bank Open Data'],
  usgs_water: ['USGS Water', 'USGS Water Services'],
  usgs_earthquake: ['USGS Earthquake', 'USGS ComCat'],
  usgs_earthquake_feed: ['USGS Earthquake', 'USGS Real-Time'],
  usgs_sciencebase: ['USGS ScienceBase'],
  library_of_congress: ['Library of Congress'],
  wikidata: ['Wikidata'],
  common_crawl: ['Common Crawl'],
  mitre_attack: ['MITRE ATT&CK', 'MITRE ATT&CK'],
  gleif: ['GLEIF LEI API', 'GLEIF'],
  // exa, sam_gov, fmcsa: no direct Earth Knowledge Registry analog (War Room-specific).

  // --- Stub-only (declared, no adapter) ---
  uspto: ['USPTO Open Data Portal', 'USPTO'],
  world_bank_data_catalog: ['World Bank Data Catalog'],
  world_bank_projects: ['World Bank Projects'],
  world_bank_finances: ['World Bank Finances', 'World Bank Boost'],
  world_bank_climate: ['World Bank Climate', 'Climate Knowledge Portal'],
  imf_sdmx: ['IMF SDMX', 'IMF Data'],
  usgs_national_map: ['USGS National Map', 'USGS 3DEP', 'The National Map'],

  // --- Built this mission (First 25 completion) ---
  wikipedia: ['Wikipedia REST API'],
  europe_pmc: ['Europe PMC'],
  clinicaltrials_gov: ['ClinicalTrials.gov'],
  openfda: ['openFDA'],
  pubchem: ['PubChem'],
  gbif: ['GBIF'],
  uniprot: ['UniProtKB', 'UniProt'],
  osv_dev: ['OSV.dev', 'OSV.Dev'],
  nvd: ['NVD API', 'National Vulnerability Database'],
  cisa_kev: ['CISA KEV', 'CISA Known Exploited Vulnerabilities Catalog'],
  osm_overpass: ['OpenStreetMap Overpass'],
  geonames: ['GeoNames'],
  eurostat: ['Eurostat Database API', 'Eurostat'],
  us_census: ['US Census Bureau Data API', 'Census Bureau', 'Census Data API'],
  congress_gov: ['Congress.gov API'],
  govinfo: ['GovInfo API'],
  sec_edgar: ['SEC EDGAR'],
  orcid: ['ORCID Public API', 'ORCID'],
  reliefweb: ['ReliefWeb API'],

  // --- Built this mission (Checkpoint 2: biomedical/genetics) ---
  ensembl: ['Ensembl REST API'],
  rcsb_pdb: ['RCSB PDB'],
  string_db: ['STRING API'],
  gnomad: ['gnomAD GraphQL API'],
  ebi_ols: ['EBI Ontology Lookup Service', 'OLS4'],
  medlineplus: ['MedlinePlus Web Service'],
  who_gho: ['WHO Global Health Observatory'],
  rxnorm: ['RxNorm / RxNav', 'RxNav'],
  dailymed: ['DailyMed SPL Web Services'],
  chembl: ['ChEMBL Web Services'],
  open_targets: ['Open Targets Platform GraphQL API'],
  inaturalist: ['iNaturalist API'],
  obis: ['OBIS REST API'],
  worms: ['WoRMS REST API'],
  itis: ['ITIS Web Services'],

  // --- Built this mission (Checkpoint 3: cybersecurity/software) ---
  pypi: ['PyPI'],
  npm_registry: ['npm Registry API'],
  crates_io: ['crates.io'],
  rubygems: ['RubyGems.org API'],
  maven_central: ['Maven Central Repository'],
  github_advisory: ['GitHub Advisory Database'],
  endoflife: ['endoflife.date'],
  epss: ['FIRST EPSS API'],
  alienvault_otx: ['AlienVault OTX'],
  malwarebazaar: ['MalwareBazaar'],
  threatfox: ['ThreatFox'],
  urlhaus: ['URLhaus'],

  // --- Built this mission (Checkpoint 4: government/law/economics/statistics) ---
  federal_register: ['US Federal Register API'],
  usaspending: ['USAspending API'],
  uk_legislation: ['UK legislation.gov.uk API'],
  opensanctions: ['OpenSanctions'],
  companies_house: ['UK Companies House API'],
  ecb_sdw: ['ECB Statistical Data Warehouse SDMX API'],
  bank_of_canada: ['Bank of Canada Valet API'],
  bis_stats: ['BIS Data Portal API'],
  eia: ['EIA API v2'],
  statcan_wds: ['StatCan WDS'],
  uk_ons: ['UK ONS Website API'],
  insee_melodi: ['INSEE BDM API'],

  // --- Built this mission (Checkpoint 5: earth/GIS/space) ---
  open_meteo: ['Open-Meteo'],
  noaa_cdo: ['NOAA NCEI Climate Data Online'],
  met_no: ['Met.no Locationforecast API'],
  noaa_swpc: ['NOAA Space Weather Prediction Center'],
  nominatim: ['Nominatim'],
  nasa_cmr: ['NASA Earthdata'],
  copernicus_dataspace: ['Copernicus Data Space Ecosystem'],
  opentopography: ['OpenTopography API'],
  celestrak: ['CelesTrak'],
  jpl_horizons: ['JPL Horizons API'],
  jpl_sbdb: ['JPL Small-Body Database'],
  nasa_exoplanet_archive: ['NASA Exoplanet Archive'],
  simbad: ['CDS — SIMBAD'],
  mast: ['MAST (Mikulski'],

  // --- Built this mission (Checkpoint 6: academic/patents/engineering) ---
  ror: ['ROR'],
  opencitations: ['OpenCitations Index'],
  biorxiv_medrxiv: ['bioRxiv / medRxiv'],
  hal: ['HAL Search API'],
  base_search: ['BASE Search API'],
  inspire_hep: ['INSPIRE-HEP'],
  hepdata: ['HEPData'],
  zbmath: ['zbMATH Open API'],
  oeis: ['OEIS'],
  nasa_ads: ['NASA ADS'],
  epo_ops: ['EPO OPS'],
  materials_project: ['Materials Project API'],
  oqmd: ['OQMD'],
  aflow: ['AFLOW'],
  pleiades: ['Pleiades'],
  idai_gazetteer: ['iDAI.gazetteer'],
  edh: ['EDH', 'Epigraphic Database Heidelberg'],
  nomisma: ['Nomisma.org'],
  whg: ['WHG', 'World Historical Gazetteer'],
  open_context: ['Open Context'],
  cdli: ['CDLI', 'Cuneiform Digital Library Initiative'],
  ehri: ['EHRI', 'European Holocaust Research Infra'],
  art_institute_chicago: ['Art Institute of Chicago'],
  cleveland_museum: ['Cleveland Museum of Art'],
  va_museum: ['V&A API'],
  smk: ['SMK API'],
  open_library: ['Open Library'],
  unhcr_data: ['UNHCR Refugee Data API'],
  ocha_fts: ['OCHA Financial Tracking Service'],
  opensky: ['OpenSky Network'],
  cbdb: ['China Biographical Database', 'CBDB API'],
  eclac_cepalstat: ['ECLAC CEPALSTAT'],
  oecd_data_explorer: ['OECD Data Explorer'],
  un_sdg: ['UN SDG Global Database'],
  unesco_uis: ['UNESCO UIS Data API'],
  idb_open_data: ['IDB Open Data'],
  iati_datastore: ['IATI Datastore'],
  debian_sources: ['Debian Sources/UDD'],
  ietf_datatracker: ['IETF Datatracker'],
  wikimedia_commons: ['Wikimedia Commons'],
  dbpedia: ['DBpedia'],
  dblp: ['DBLP'],
  mozilla_bugzilla: ['Mozilla Bugzilla'],
  msrc_cvrf: ['Microsoft Security Response Center'],
  isni: ['ISNI'],
  lobid_gnd: ['lobid-gnd'],
  factgrid: ['FactGrid'],
  ubuntu_security: ['Ubuntu Security'],
  redhat_security_data: ['Red Hat Security Data'],
  cve_org: ['CVE Services API'],
  conceptnet: ['ConceptNet'],
  ena_portal: ['ENA Portal'],
  ncbi_datasets: ['NCBI Datasets'],
  alphafold_db: ['AlphaFold DB'],
  reactome: ['Reactome'],
  intact: ['IntAct API'],
  orphadata: ['Orphadata', 'Orphanet / Orphadata'],
  guide_to_pharmacology: ['Guide to Pharmacology'],
  clinpgx: ['PharmGKB API'],
  pbdb: ['PBDB API'],
  nws_weather: ['NOAA/NWS api.weather.gov'],
  japan_egov_hourei: ['Japan e-Gov Hourei'],
  australia_frl: ['Australia FRL OData API'],
  uk_gazette: ['UK The Gazette API'],
  eu_ted: ['EU Tenders Electronic Daily (TED) API', 'TED API (eForms notices)'],
  brazil_transparencia: ['Portal da Transparência API', 'Brazil Portal da Transparência API'],
  sidra_brazil: ['SIDRA API'],
  cbs_statline: ['CBS StatLine Open Data'],
  gaia_archive: ['ESA Gaia Archive'],
  sdss_skyserver: ['SDSS SkyServer'],
  apache_jira: ['Apache Jira REST API'],
  health_canada_dpd: ['Health Canada DPD API'],
  bindingdb: ['BindingDB'],
  kegg: ['KEGG API'],
  metabolights: ['MetaboLights REST API'],
  pride_archive: ['PRIDE Archive RESTful API'],
  libris_xl: ['LIBRIS XL'],
  nasjonalbiblioteket: ['Nasjonalbiblioteket API'],
  nara_catalog: ['NARA Catalog API'],
  jstage: ['J-STAGE WebAPI'],
  cinii: ['CiNii Web APIs'],
  musicbrainz: ['MusicBrainz'],
  gitlab_api: ['GitLab API'],
  codeberg: ['Codeberg (Forgejo)'],
  software_heritage: ['Software Heritage Archive'],
  launchpad: ['Launchpad API'],
  metacpan: ['MetaCPAN API'],
  ecosystems: ['Ecosyste.ms APIs'],
  deps_dev: ['deps.dev API'],
  homebrew: ['Homebrew JSON API'],
  mdn_web_docs: ['MDN Web Docs'],
  rosetta_code: ['Rosetta Code'],
  greynoise: ['GreyNoise'],
  phishstats: ['PhishStats API'],
  virustotal: ['VirusTotal API'],
  abuseipdb: ['AbuseIPDB API'],
  hybrid_analysis: ['Hybrid Analysis'],
  ontobee: ['Ontobee'],
  umls: ['UMLS Terminology Services'],
  loinc_fhir: ['LOINC Terminology Service'],
  wikipathways: ['WikiPathways API'],
  cellosaurus: ['Cellosaurus REST API'],
  metabolomics_workbench: ['Metabolomics Workbench'],
  npatlas: ['Natural Products Atlas'],
  wellcome_collection: ['Wellcome Collection'],
  bhl: ['Biodiversity Heritage Library'],
  google_kg_search: ['Google Knowledge Graph Search'],
  merriam_webster: ['Merriam-Webster Developer Center'],
  brave_search: ['Brave Search API'],

  // --- Built this mission (Wave 8: 542-registry exhaustion sweep) ---
  checklistbank: ['ChecklistBank API (Catalogue of Life)'],
  eol: ['EOL API v1.0 + TraitBank'],
  globi: ['GloBI Web API'],
  mushroom_observer: ['Mushroom Observer API (api2)', 'Mushroom Observer API'],
  arctic_data_center: ['Arctic Data Center API'],
  cbeta: ['CBETA (Chinese Buddhist canon)'],
  ebl: ['eBL — electronic Babylonian Library'],
  mercado_publico: ['Chile Mercado Público (ChileCompra) API', 'API Mercado Público'],
  inpe_bdc: ['INPE — Brazil CBERS/Amazonia-1 STAC'],
  pdok: ['National mapping agency OGC services (grouped)'],
  satnogs: ['SatNOGS Network'],
  nomad_repository: ['NOMAD Repository & Archive (FAIRmat)'],
  kramerius: ['Národní knihovna ČR (NKP, Czechia)'],
  bdl_poland: ['BDL API (Local Data Bank, Poland)'],
  israel_cbs: ['CBS Statistical Series API + Price Indices API'],
  nomis_uk: ['Nomis API (UK labour market)'],
  abs_australia: ['ABS Data API'],
  argentina_series: ['API de Series de Tiempo'],
  data_gov_my: ['data.gov.my Data Catalogue API'],
  datos_abiertos_colombia: ['Datos Abiertos Colombia API'],
  ine_tempus3: ['INE Tempus3 Web Service'],
  singstat: ['SingStat Table Builder API'],
  usgs_m2m: ['USGS EarthExplorer M2M API + Landsat on AWS'],
  n2yo: ['N2YO Satellite Tracking API'],
  ariadne_portal: ['ARIADNE portal API'],
  ohm_overpass: ['OpenHistoricalMap (OHM)'],
  stack_exchange: ['Stack Exchange API v2.3'],
  ecmwf_cds: ['ECMWF Copernicus Climate Data Store (CDS)+ADS'],
  met_office_datahub: ['Met Office Weather DataHub (UK)'],
  ndl_search: ['NDL Search API (Japan)'],
  swisscovery: ['Swissbib/swisscovery (Switzerland)'],
  // --- Implemented this mission, Phase 2 batch (7) ---
  yago: ['YAGO 4.5'],
  data_commons: ['Data Commons'],
  econstor: ['EconStor OAI-PMH'],
  w3c_api: ['W3C API'],
  wto_timeseries: ['WTO APIs (Timeseries + QR)', 'WTO Stats / Timeseries API'],
  e_stat_japan: ['Japan e-Stat API', 'e-Stat API v3'],
}

// Registry sources with a deliberate, researched, non-default classification
// this mission (mission items 24/9: honest EXTERNAL_BLOCKER/BULK_ONLY calls,
// not fake adapters). Checked before the normal provider matcher, same as
// DUPLICATE_COVERAGE_MAP.
const FORCED_CLASSIFICATION_MAP = {
  'ofac sanctions lists': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: OFAC\'s list-download endpoint 302-redirects to a dynamic, pre-signed AWS S3 URL (different bucket/token every call, 1-hour expiry). War Room\'s safeProviderFetch redirect-following logic only follows redirects to a fixed, pre-declared per-provider host allowlist (a deliberate SSRF protection) — a dynamic per-request S3 target cannot be pre-allowlisted as a fixed hostname without a real security-model change. Not built rather than loosening that protection or building a fragile workaround; a Commander decision on the redirect-allowlist question would unblock this.',
  },
  'open contracting partnership': {
    state: 'BULK_ONLY',
    note: 'Confirmed this mission: this is a discovery/bulk-download portal over ~50+ independent national/city OCDS publishers with heterogeneous access methods, not one unified query API — there is no single host/endpoint contract "OCDS" as a whole represents. Correctly classified as a federated bulk-download layer rather than MISSING or a fake unified adapter.',
  },
  'iau minor planet center': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: the MPC Designation Identifier API requires a GET request carrying a JSON body (POST to the same URL returns a hard 405). Node\'s fetch/undici — the only HTTP client this codebase\'s safeProviderFetch uses — refuses at the client level to send a body on a GET request ("Request with GET/HEAD method cannot have body"), confirmed via a direct runtime test. No viable request method exists for this codebase\'s shared fetch-based HTTP client without a real architecture change (a raw http.request escape hatch for one provider) — not built rather than special-casing the shared client.',
  },
  'patentsview': {
    state: 'DISCONTINUED',
    note: 'Confirmed live this mission: DNS lookups for search.patentsview.org and api.patentsview.org (the historical API hosts) both fail to resolve, and patentsview.org/apis/purpose now 301-redirects permanently to USPTO\'s Open Data Portal (ODP) transition guide. PatentsView has been fully absorbed into the exact same successor system War Room\'s existing uspto provider already targets (currently STUB_ONLY) — not a distinct source needing its own adapter. A future implementation of the uspto stub against real ODP inherently supersedes PatentsView\'s former functionality.',
  },
  'viaf': {
    state: 'SEARCH_INTERFACE_ONLY',
    note: 'Confirmed live this mission: every VIAF endpoint (/viaf/AutoSuggest, /viaf/search) returns HTTP 403 behind a Cloudflare managed-challenge page (server: cloudflare, __cf_bm cookie set) regardless of User-Agent — real bot-management, not a docs/path error. A server-side fetch with no JS execution cannot pass this challenge. Not built rather than fabricating an adapter against an endpoint confirmed unreachable from this codebase\'s HTTP client.',
  },
  'chinese text project': {
    state: 'IMPLEMENTED_CREDENTIAL_BLOCKED',
    note: 'Confirmed live this mission: ctext.org\'s API has no keyword/full-text search function at all — searchbooks/search/searchtext/getconcordance/getpassages all return ERR_INVALID_FUNCTION. The only zero-auth capability is a static book-title catalog (gettexttitles), not a meaningful search. The real text-retrieval function (gettext, by known URN) unconditionally returns ERR_REQUIRES_AUTHENTICATION without a ctext-issued API key or registered IP. Not built as a weak catalog-only adapter that could not satisfy this codebase\'s query-based provider contract even with credentials.',
  },
  'iom dtm': {
    state: 'MISSING',
    note: 'Confirmed live this mission: IOM DTM\'s real API is Azure-APIM-hosted behind a JS-rendered SPA portal (dtm-apim-portal.iom.int) requiring a registered subscription key. Could not confirm the real base host/endpoint paths or response shape via direct HTTP probing in the time available (the portal itself does not render its docs to a plain fetch). Not built rather than fabricating an endpoint contract that could not be verified.',
  },
  'adb key indicators': {
    state: 'MISSING',
    note: 'Confirmed this mission: kidb.adb.org is a JS-rendered Inertia.js/Laravel SPA shell with no working REST/SDMX endpoint found despite probing multiple plausible paths (/api/rest/dataflow, /sdmxapi/rest/dataflow, /rest/dataflow, /v1/rest/dataflow — all 404); sdmx.adb.org does not resolve at all. Not built rather than fabricating an SDMX contract with no confirmed working endpoint.',
  },
  'un desa population division': {
    state: 'MISSING',
    note: 'Confirmed live this mission: population.un.org/dataportalapi\'s locations/indicators metadata endpoints are zero-auth, but the actual population-data query endpoint (/data/indicators/{id}/locations/{id}/start/{y}/end/{y}) returns a real 401 with WWW-Authenticate: Bearer — a genuine current access-policy change, not a path error. Not built as a metadata-only adapter (locations/indicators lists alone are not a meaningful population-data capability) rather than a real data-query adapter that cannot function without credentials whose acquisition path was not confirmed.',
  },
  'local contexts hub': {
    state: 'MISSING',
    note: 'Confirmed live this mission: only the bare API root (/api/v2/) is public — it returns an endpoint map, but every real content endpoint tested (projects list, open-to-collaborate notices) returns a real 403 "Authentication not provided." A token is required per the project\'s own wiki docs, but whether it is genuinely free self-service or requires manual approval was not confirmed in this session. Not built as a speculative auth flow against an unconfirmed token-acquisition process.',
  },
  'babelnet': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and key-based auth mechanism exist (a bogus key returns a real 403 with a documented error message), but no valid response body shape could be confirmed or found documented anywhere accessible in this session — unlike nasa_ads/epo_ops/materials_project (built against officially documented schemas despite missing credentials), BabelNet\'s actual success-response shape is unknown. Not built against a completely unconfirmed response contract.',
  },
  'who icd api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real REST endpoint and OAuth2 client_credentials auth mechanism both exist (a real 401 with WWW-Authenticate: Bearer, and a real token endpoint), with free self-service registration via icd.who.int/icdapi. Not built because no confirmed search-response body shape could be found in accessible docs or via a live authenticated call (no credentials available this session) — unlike nasa_ads/epo_ops/materials_project, which were built against officially documented schemas.',
  },
  'ncbo bioportal api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: data.bioontology.org/search requires a free API key (real 401 with a documented registration URL). Not built because no confirmed response body shape could be obtained without a key in this session.',
  },
  'ebird api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the zero-auth taxonomy reference endpoint (/v2/ref/taxonomy/ebird) returns the full ~16,000-species list with no query/filter parameter — too large to fetch per-request as a search substitute. The actual observation-data endpoints are real but key-gated (confirmed via a real 403), and their response shape was not independently confirmed without a key. Not built as either a misrepresented bulk-list search or a blind key-gated adapter.',
  },
  'bold api': {
    state: 'DISCONTINUED',
    note: 'Confirmed this mission: v4.boldsystems.org (http and https) serves a real "BOLD Public Offline" maintenance page instead of JSON for every query. api.boldsystems.org resolves but every plausible v5 path tried (species, records, openapi.json, swagger, docs) 404s. v5.boldsystems.org is only a WordPress marketing site. No working query endpoint found on any host.',
  },
  'space-track.org': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real session-cookie login flow exists (POST /ajaxauth/login with real field-validation errors confirming identity/password params are genuine) and the query API is real (unauthenticated queries confirmed 404 rather than a wrong-path error). Not built this pass: this is a genuinely different auth pattern (stateful cookie-based login, not a bearer token or API key) not yet used elsewhere in this codebase, and the authenticated response body shape could not be confirmed without test credentials — a good candidate for a dedicated future implementation pass rather than a rushed one here.',
  },
  'istat i.stat sdmx': {
    state: 'MISSING',
    note: 'Confirmed this mission: every SDMX path under sdmx.istat.it (dataflow, data, both HTTP and HTTPS) 302-redirects to itself in an infinite loop, eventually timing out — a genuinely broken/misconfigured endpoint from this network right now, not a wrong path. Not built against a currently non-functional service.',
  },
  'genesis web service': {
    state: 'MISSING',
    note: 'Confirmed this mission: the REST service host (genesis.destatis.de, redirected from www-genesis.destatis.de) is alive (a parameterless helloworld/whoami call succeeds), but every parameterized call — including with GENESIS\'s own documented guest test credentials — redirects to an announcement/maintenance page rather than returning authenticated data. Could not determine whether this is a genuine outage or a changed auth flow; not built against an unconfirmed, currently non-responsive auth path.',
  },
  'scb statistical database api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: SCB\'s PXWEB API is real and zero-auth, but requires the caller to already know a specific table path AND that table\'s own variable/value codes (discovered via a separate metadata GET per table) before a data POST can succeed — there is no general free-text query across all SCB tables. Not built as a single-table-only adapter that would not generalize to a meaningful query capability without a much larger table+variable-code catalog this pass did not build.',
  },
  'statbank denmark api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: same PXWEB-family constraint as SCB (Sweden) — real, zero-auth, but requires per-table variable-code discovery before querying, with no cross-table free-text search. Not built for the same reason.',
  },
  'ssb api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: same PXWEB-family constraint as SCB (Sweden) and StatBank (Denmark) — real, zero-auth, but requires per-table variable-code discovery before querying, with no cross-table free-text search. Not built for the same reason.',
  },
  'kosis open api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and apiKey-based auth mechanism exist (a bogus key returns a real structured Korean-language error), with a documented free account-based key request process. Not built because no confirmed success-response body shape could be obtained without a key in this session.',
  },
  'inegi indicadores api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and token-in-path auth mechanism exist (a bogus token returns a real structured error), with a documented free self-service registration flow. Not built because no confirmed success-response body shape could be obtained without a token in this session.',
  },
  'bps webapi': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: every path on webapi.bps.go.id returns a real bot-management "Perimeter WAF Block" page, both with and without an API key param — a genuine perimeter block, not a docs/path error. Not buildable without a way to pass this challenge.',
  },
  'aotearoa data explorer (nzdotstat) sdmx api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real host (apis.stats.govt.nz/ade-api) and Azure-APIM auth mechanism (Ocp-Apim-Subscription-Key header) both exist, confirmed via a real 401 "missing subscription key" error. Not built because no free-tier/registration process was confirmed and no response body shape could be obtained without a key in this session\'s time budget.',
  },
  'czso vdb open data catalogue api': {
    state: 'MISSING',
    note: 'Confirmed this mission: data.gov.cz/api/3/action/package_search returns a real HTML 404 (not a CKAN JSON error) — the CKAN API is not at that path; vdb.czso.cz/pll/eweb/package_search* also 404s. No working endpoint found within this session\'s time budget.',
  },
  'india: esankhyiki + ogd data.gov.in': {
    state: 'MISSING',
    note: 'Confirmed live this mission: api.data.gov.in/resource/{resourceId} is real and key-gated (a bogus key returns a real "Key not authorised" error), but every dataset has its own distinct resource_id with no confirmed way to discover one by free-text query — the catalog/cross-dataset search endpoints tried (/catalog, datastore/resource.json) were unreachable. Not built as a lookup-by-already-known-resource-ID adapter with no resource-discovery mechanism.',
  },
  'saudi open data platform api (gastat)': {
    state: 'MISSING',
    note: 'Confirmed this mission: open.data.gov.sa (both bare and /en/ paths) connection-timed-out repeatedly (25s+) from this network — could not confirm live/dead status either way within this session\'s time budget.',
  },
  'un data (data.un.org)': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: data.un.org/ws/rest/data (and the /WS/rest/data variant) both return a real, consistently-reproduced HTTP 500 from the underlying IIS server on every call — a hard, confirmed failure of the legacy API stack, not an intermittent degradation. Upgraded from the registry\'s own "DEGRADED (legacy stack)" note now that live evidence shows a hard failure rather than a working-but-slow service.',
  },
  'openstat api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: openstat.psa.gov.ph/PXWeb/api/v1 is real and zero-auth, but is PXWEB-family — same structural constraint already established for SCB/StatBank/SSB (Sweden/Denmark/Norway) elsewhere in this map: real data queries require per-table navigation to discover variable/value codes, then a POST with a JSON query body, with no cross-table free-text search. Not built for the same reason.',
  },
  'statfin pxweb api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: both statfin.stat.fi/PXWeb/api/v1 and the newer pxdata.stat.fi/PxWeb/api/v1 are real and zero-auth, but are PXWEB-family — same per-table-navigation constraint as SCB/StatBank/SSB/OpenSTAT elsewhere in this map. Not built for the same reason.',
  },
  'griis': {
    state: 'DUPLICATE_COVERAGE',
    note: 'GRIIS (Global Register of Introduced and Invasive Species) is explicitly published and accessed via GBIF (REST+BULK "via GBIF" per the registry\'s own access-type column) — its records are already reachable through the existing gbif adapter, which already supports institution/dataset-scoped occurrence search. Not built as a second adapter over data already covered.',
  },
  'powo internal json api': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: powo.science.kew.org\'s internal search API is behind Cloudflare bot-management (real 403/challenge page, server: cloudflare) regardless of User-Agent — matches the registry\'s own "(unofficial/bot-blocked)" note. A server-side fetch with no JS execution cannot pass this challenge.',
  },
  'tdar (digital archaeological record)': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: core.tdar.org is behind a real Cloudflare Turnstile challenge (not a simple managed-challenge page) — a JS-execution-based proof-of-work challenge no server-side fetch client can solve. Not built rather than attempting to defeat bot protection.',
  },
  'ads — archaeology data service (uk)': {
    state: 'MISSING',
    note: 'Confirmed this mission: archaeologydataservice.ac.uk has migrated to a JS-rendered SPA frontend; no working OAI-PMH or SPARQL endpoint matching the registry\'s documented access type could be located at its former paths within this session\'s time budget. Not built against an unconfirmed, possibly-migrated endpoint.',
  },
  'bdrc — buddhist digital resource center': {
    state: 'MISSING',
    note: 'Confirmed this mission: BDRC\'s API endpoints (ldspdi/openpecha family) return real, consistently-reproduced HTTP 500 server errors on every tested path — a genuine current server-side breakage, not a wrong-path or auth issue. Not built against a currently non-functional service.',
  },
  'chgis v6 datasets': {
    state: 'MISSING',
    note: 'Confirmed this mission: the CHGIS v6 API host (dataverse.harvard.edu/chgis or the historical chgis.fas.harvard.edu path) fails DNS resolution entirely — the service appears to have been taken fully offline or relocated to an unannounced host. Not built against a non-resolving host.',
  },
  'ifes electionguide api': {
    state: 'MISSING',
    note: 'Confirmed this mission: no working REST/JSON API endpoint could be located for electionguide.org within this session\'s time budget — the site now appears to be a static content site with no discoverable machine-readable API path. Not built against an unconfirmed/unfound endpoint.',
  },
  'opencorporates api': {
    state: 'COMMERCIAL_GATED',
    note: 'Confirmed this mission: OpenCorporates has moved toward a paid/partner-only access model in recent years; no confirmed genuinely-free self-service tier could be verified within this session\'s time budget (the historical free tier appears deprecated or heavily rate-limited to the point of non-viability for real use). Classified as commercial-gated rather than building blind against an unconfirmed free-tier assumption.',
  },
  'bank of england statistical interactive db': {
    state: 'MISSING',
    note: 'Confirmed this mission: the Bank of England\'s IADB is real and zero-auth (REST-ish CSV per the registry\'s own access-type column), but its actual request-parameter shape (series codes, date-range query encoding) could not be confirmed via direct probing within this session\'s time budget. Not built against an unconfirmed request contract.',
  },
  'euipo tmview / esearch': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed this mission: euipo.europa.eu\'s TMview/eSearch endpoints return a real TCP connection reset on every attempt from this network — a genuine current network-level block, not a docs/path error. Not built against an endpoint this session\'s HTTP client cannot reach.',
  },
  'mpds (materials platform for data science)': {
    state: 'MISSING',
    note: 'Confirmed this mission: MPDS\'s real API and key-based auth mechanism exist, but neither its exact query-parameter shape nor its current free-tier availability status could be confirmed within this session\'s time budget. Not built against an unconfirmed request contract and uncertain access tier.',
  },
  'datos.bne.es — bne linked data (spain)': {
    state: 'MISSING',
    note: 'Confirmed this mission: datos.bne.es returned real HTTP 403 responses on every tested SPARQL endpoint path, and no alternative working host could be located within this session\'s time budget. Not built against an endpoint this session could not successfully reach.',
  },
  'culturaitalia / internet culturale (italy)': {
    state: 'MISSING',
    note: 'Confirmed this mission: culturaitalia.it\'s domain now appears repurposed/redirected away from its historical SPARQL+OAI-PMH API function, and no working API host could be located within this session\'s time budget. Not built against an unconfirmed/possibly-defunct endpoint.',
  },
  'lore.kernel.org': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: lore.kernel.org (public-inbox search over the Linux kernel mailing lists) is behind an Anubis JS-proof-of-work bot-challenge ("Making sure you\'re not a bot!") — a real challenge no server-side fetch client can solve, not a docs/path error.',
  },
  'libraries.io api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: libraries.io/api returns a plain-text "Forbidden" response on every tested query, with or without an API key parameter — the historical free-tier API appears to now be blocked/deprecated in practice. Not built against an access path that could not be confirmed working within this session\'s time budget.',
  },
  'xeno-canto': {
    state: 'MISSING',
    note: 'Confirmed live this mission (covers both the cat10 "Biology & Biodiversity" and cat16 "Academic Research" cross-referenced rows): the real endpoint and key-based auth mechanism exist (a missing/invalid key returns a real structured error naming the registration URL), with free self-service registration via xeno-canto.org/account. Not built because no confirmed success-response body shape could be obtained without a key in this session.',
  },
  'openweathermap': {
    state: 'DUPLICATE_COVERAGE',
    note: 'Confirmed live this mission: the real endpoint and key-based auth are confirmed (a bogus key returns a real structured 401 error), but War Room already has solid zero-auth current-weather/forecast coverage via the existing open_meteo, met_no, and nws_weather adapters. Not built as a second, credential-gated adapter over capability already covered for free.',
  },
  'seshat: global history databank': {
    state: 'MISSING',
    note: 'Confirmed this mission: no working REST/JSON API endpoint could be located for seshatdatabank.info within this session\'s time budget (a guessed /api/ path 404s). Not built against an unconfirmed/unfound endpoint.',
  },
  'qatar digital library (qdl)': {
    state: 'MISSING',
    note: 'Confirmed this mission: a guessed search-API path on qdl.qa returned a real HTTP 403, and no working alternative endpoint was located within this session\'s time budget. Not built against an endpoint this session could not confirm.',
  },
  'e-periodica (eth library)': {
    state: 'MISSING',
    note: 'Confirmed this mission: both a guessed classic search path (/digbib/dossearch?format=json, real HTTP 400) and a guessed REST path (/api/search, real HTTP 404) returned genuine app-server error pages, not bot walls — no working query/search endpoint found distinct from the plain IIIF manifest delivery already noted elsewhere in the registry (cross-referenced primarily under cat13). Not built against an unconfirmed endpoint.',
  },
  'data.go.kr': {
    state: 'MISSING',
    note: 'Confirmed live this mission (covers both the cat14 "공공데이터포털 Open APIs" and cat16 "공공데이터포털" cross-referenced rows): apis.data.go.kr is real and serviceKey-gated (a bogus key returns a real structured Korean-language "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"), but the portal fronts thousands of independently-registered per-service endpoints, each with its own distinct schema and its own separate serviceKey registration — there is no single unified query capability "data.go.kr" as a whole represents, the same federated-many-endpoint structural limitation already established for other multi-instance platforms in this mission. Not built as a fake unified adapter over a federated service catalog.',
  },
  'ocds + ocp data registry': {
    state: 'BULK_ONLY',
    note: 'Same underlying Open Contracting Partnership source already researched this mission under the "open contracting partnership" entry — a discovery/bulk-download portal over ~50+ independent national/city OCDS publishers with heterogeneous access methods, not one unified query API. Cross-referenced under a second registry category (cat15 economics), not a distinct source.',
  },
  'ofac sdn/consolidated + sls': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Same underlying OFAC sanctions-list source already researched this mission under the "ofac sanctions lists" entry — the list-download endpoint 302-redirects to a dynamic, pre-signed AWS S3 URL that cannot be pre-allowlisted as a fixed hostname without loosening War Room\'s redirect-allowlist SSRF protection. Cross-referenced under a second registry category, not a distinct source.',
  },
  'repec / ideas api': {
    state: 'MISSING',
    note: 'Confirmed this mission: ideas.repec.org/cgi-bin/htsearch (the historical search CGI) failed to connect entirely from this network within this session\'s time budget. Not built against an endpoint that could not be reached.',
  },
  'redalyc journal api': {
    state: 'MISSING',
    note: 'Confirmed this mission: api.redalyc.org resolves and returns HTTP 200, but serves the same main-site HTML (title "Sistema de Información Científica Redalyc") as www.redalyc.org, not a distinct API — it is not a separate API host. The specific documented docs path (/docs/) real-404s with a genuine Java servlet error ("SRVE0190E: File not found"), and the TLS certificate served does not cover the api.redalyc.org hostname at all (a shared wildcard cert for the main site). No working, distinctly-hosted API found. Not built against an unconfirmed/likely-nonexistent endpoint.',
  },
  'kisti scienceon / ndsl open service (korea)': {
    state: 'MISSING',
    note: 'Confirmed this mission: both scienceon.kisti.re.kr and apigateway.kisti.re.kr connection-timed-out repeatedly from this network — could not confirm live/dead status or endpoint shape either way within this session\'s time budget, the same class of finding already recorded elsewhere in this map for other geo-distant government hosts (e.g. Saudi GASTAT). Not built against an endpoint that could not be reached.',
  },
  'lens.org': {
    state: 'MISSING',
    note: 'Confirmed live this mission (covers both the cat16 "Lens.org Scholarly API" and cat17 "Lens.org Patent & Scholarly API" cross-referenced rows): api.lens.org/scholarly/search is real and Bearer-token-gated (a real structured 401 "Missing/Incorrect Authorization Header" error). Not built because no confirmed success-response body shape or registration process could be obtained without a token in this session.',
  },
  'ieee xplore metadata api': {
    state: 'MISSING',
    note: 'Confirmed live this mission (covers both the cat16 and cat20 cross-referenced rows): ieeexploreapi.ieee.org is real but returned a real "Developer Inactive" error for a test key — the real auth model requires an approved/active developer registration status, not merely a syntactically valid key. Not built against an access path whose approval process could not be confirmed within this session.',
  },
  'movebank': {
    state: 'MISSING',
    note: 'Confirmed live this mission: movebank.org\'s direct-read service returned a real 401 on an unauthenticated call. Movebank access is governed by per-study data-use agreements set by individual researchers, not a simple self-service API key — a fundamentally different, per-dataset permission model this session could not confirm a general registration path for.',
  },
  'mapillary (street-level imagery)': {
    state: 'MISSING',
    note: 'Confirmed live this mission: graph.mapillary.com is real and returns a real structured OAuth error for an invalid token — Mapillary (Meta-owned) uses a full OAuth2 app-registration flow, not a simple API key, and this session did not confirm the registration process or a response shape within its time budget.',
  },
  'ndl digital collections iiif': {
    state: 'MISSING',
    note: 'This is IIIF (image/manifest delivery) access to digitized NDL items, not a keyword-search capability — distinct from the "NDL Search API (Japan)" row this mission built as the ndl_search adapter, which already provides real catalog search coverage including links into the digitized collection. Not built as a manifest-delivery adapter that would misrepresent itself as search.',
  },
  'polona (poland)': {
    state: 'MISSING',
    note: 'Confirmed this mission: a guessed entities-search path on polona.pl returned a real HTTP 404, and no working alternative endpoint was located within this session\'s time budget. Not built against an endpoint this session could not confirm.',
  },
  'atom-based archives ecosystem': {
    state: 'MISSING',
    note: 'This is a federated ecosystem of many independently-hosted AtoM (Access to Memory) archival-description instances with no unified query endpoint — the same not-a-single-addressable-source structural limitation already established this mission for other federated platforms (Wikibase Cloud, the OAI-PMH institutional-repository ecosystem). Not buildable as one adapter.',
  },
  'biblioteca nacional de portugal': {
    state: 'MISSING',
    note: 'Confirmed this mission: the guessed SRU endpoint on bibnacional.bnportugal.gov.pt failed to connect entirely from this network within this session\'s time budget. Not built against an endpoint that could not be reached.',
  },
  'nasjonalmuseet collection api (norway)': {
    state: 'MISSING',
    note: 'Confirmed this mission: a guessed search path on api.nasjonalmuseet.no returned a real HTTP 404, and no working alternative endpoint was located within this session\'s time budget. Not built against an endpoint this session could not confirm.',
  },
  'pg catalog feeds + gutendex api': {
    state: 'BULK_ONLY',
    note: 'Confirmed live this mission: gutendex.com (the real-time query API) timed out on every attempt from this network, both with default and extended timeouts — currently unreachable. Project Gutenberg\'s own catalog feeds (RDF/CSV bulk exports) remain a real, working bulk-download fallback, so this is classified as bulk-only access rather than MISSING or a fake adapter over an unreachable live endpoint.',
  },
  'librivox api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: librivox.org/api/feed/audiobooks returned genuinely malformed/truncated JSON on a first call (an unterminated string mid-response) and then empty (0-byte) responses on immediate retries — real, reproduced API instability at the source, not a wrong path or transient blip. Not built against a currently unreliable JSON contract.',
  },
  'shamela library': {
    state: 'BULK_ONLY',
    note: 'Confirmed this mission via a real third-party reverse-engineered client (github.com/ragaeeb/shamela): shamela.ws does expose a real API, but its two endpoints (/api/master_patch, /api/books) are a database-sync/patch-distribution mechanism — requests return download URLs for SQLite-database or JSON book/master-index dumps, not query results from a live search endpoint. The API key required is not self-service (the client\'s own docs say "I cannot provide API keys... contact mail@shamela.ws"). Correctly bulk-only, not a live search API even with credentials.',
  },
  'impresso — media monitoring of the past': {
    state: 'MISSING',
    note: 'Confirmed this mission: a guessed search path on impresso-project.ch returned a real HTTP 404, and no working alternative endpoint was located within this session\'s time budget. Not built against an endpoint this session could not confirm.',
  },
  'anno — austrian newspapers online (önb)': {
    state: 'MISSING',
    note: 'Confirmed this mission: a guessed search-API path on anno.onb.ac.at returned the site\'s Angular application shell (HTML), not JSON — no working API endpoint was located within this session\'s time budget, consistent with the registry\'s own "(search API unofficial)" note.',
  },
  'emiss open data api (fedstat)': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Registry\'s own status already confirms "DEGRADED (geo-blocked)" for this source — a real, current network-level access restriction, not a docs/path or auth issue. Not independently re-probed this session; the registry\'s own evidence is sufficient for a terminal classification.',
  },
  'iea data & statistics api': {
    state: 'COMMERCIAL_GATED',
    note: 'Registry\'s own status already confirms "OPERATIONAL (core paywalled)" for this source — the core dataset access is paid, per the registry\'s own research. Not independently re-probed this session; the registry\'s own evidence is sufficient for a terminal classification.',
  },
  'accessgudid': {
    state: 'DUPLICATE_COVERAGE',
    note: 'Confirmed live this mission: AccessGUDID is a lookup-by-device-identifier API with no free-text search, and the same underlying GUDID data is already reachable with real search support through the existing openfda adapter\'s device/udi endpoint. Not built as a second, weaker adapter over data already covered.',
  },
  'fda orange book': {
    state: 'DUPLICATE_COVERAGE',
    note: 'Confirmed live this mission: FDA Orange Book data is served from api.fda.gov, the same host and API family as this codebase\'s existing openfda adapter — not a distinct source. Purple Book has no working API (purplebooksearch.fda.gov endpoints real-403 to a bot-detection page); FAERS adverse-event data is already covered by openfda\'s drug/event.json. Not built as a redundant/non-viable adapter.',
  },
  'ema medicines data': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the SPOR (IDMP) API is real but HTTP Basic-auth gated (a real 401 with WWW-Authenticate: Basic, no error detail to learn from) via an EMA-account registration process not confirmed as simple self-service. The general "EMA medicines data" page is a static bulk-download portal, not a live query API. Not built against an unconfirmed auth flow and response shape.',
  },
  'ddbj programmatic access': {
    state: 'MISSING',
    note: 'Confirmed this mission: every DDBJ search endpoint tried (new search API paths and the classic getentry CGI) returned real 502/404 errors or a dropped connection — a genuine current service-side outage/misconfiguration, not a wrong path. Not built against a currently non-functional service.',
  },
  'biogrid web service': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and access-key format (32-character alphanumeric) are confirmed via a real structured error response, with free registration. Not built because no confirmed success-response body shape could be obtained without a valid key in this session.',
  },
  'bacdive api': {
    state: 'MISSING',
    note: 'Confirmed this mission: /fetch/{id} unexpectedly returned real data even with bogus Basic Auth credentials, while /taxon/{genus species} returned zero results for a known-good query — an inconsistent, not-fully-understood auth/query contract. Not built against an ambiguous, unconfirmed behavior rather than a cleanly verified one.',
  },
  'movebank rest': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and Basic Auth requirement are confirmed via a real 401 with WWW-Authenticate: Basic, via free account registration. Not built because no confirmed authenticated response body shape could be obtained without real credentials in this session.',
  },
  'kipris plus open api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint (kipo-api/kipi path, not the shorter openapi/rest path which redirects to an error page) and ServiceKey-based auth are confirmed via a real structured XML error. Not built because no confirmed success-response body shape could be obtained without a key in this session.',
  },
  'inpi france': {
    state: 'MISSING',
    note: 'Confirmed this mission: data.inpi.fr is real but every request (root and a guessed search path) returned a real Cloudflare 403 bot-management block. Could not determine whether a real public REST API exists behind this block. Not built against an unconfirmed, currently inaccessible endpoint.',
  },
  'ip australia': {
    state: 'MISSING',
    note: 'Confirmed this mission: the commonly-referenced developer.ipaustralia.gov.au host does not resolve at all (DNS failure); the real live product (search.ipaustralia.gov.au/trademarks) is an Angular SPA whose actual backend API path was not discovered within this session\'s time budget. Not built against an unconfirmed endpoint.',
  },
  'esa discosweb': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and Bearer-token auth mechanism are confirmed via a real 401 with rate-limit headers, via free account registration. Not built because no confirmed success-response body shape could be obtained without a valid token in this session.',
  },
  'deutsche digitale bibliothek': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and oauth_consumer_key-based auth are confirmed via a real 403 NotAuthorizedException. Not built because no confirmed success-response body shape could be obtained without a valid key in this session.',
  },
  'finna api': {
    state: 'MISSING',
    note: 'Confirmed this mission: api.finna.fi returns a real Cloudflare JS-challenge page instead of JSON for a plain server-side request — genuine bot-management, not a path/param error. Not built without a way to pass this challenge.',
  },
  'archivportal-d': {
    state: 'MISSING',
    note: 'Confirmed this mission: every request returns a real Anubis anti-bot challenge page instead of data — genuine bot-management, not a wrong endpoint. Not built without a way to pass this challenge.',
  },
  'trove api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and X-API-KEY auth are confirmed via a real 401 with a WWW-Authenticate: Key header. Not built because no confirmed success-response body shape could be obtained without a key in this session.',
  },
  'digitalnz api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and api_key query-param auth are confirmed via a real 403 "Invalid API Key". Not built because no confirmed success-response body shape could be obtained without a key in this session.',
  },
  'harvard art museums api': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and apikey query-param auth are confirmed via a real 401. Not built because no confirmed success-response body shape could be obtained without a key in this session.',
  },
  'cooper hewitt': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and access_token query-param auth are confirmed via a real structured 400 "Required access token missing". Not built because no confirmed success-response body shape could be obtained without a token in this session.',
  },
  'paris musées': {
    state: 'MISSING',
    note: 'Confirmed this mission: the GraphQL endpoint returns a real 403 "Accès refusé" from a site firewall, not a GraphQL error — no other endpoint variant tried resolved. Not built against an unconfirmed, currently blocked endpoint.',
  },
  'finnish national gallery api': {
    state: 'MISSING',
    note: 'Confirmed this mission: api.kansallisgalleria.fi does not resolve at all; the documented alternative (Finna filtered to the Kansallisgalleria building) is real but Cloudflare-JS-challenge-blocked from this network. Not built.',
  },
  'te papa collections api': {
    state: 'MISSING',
    note: 'Confirmed this mission: the real endpoint returns a structured 403 "Forbidden" both with and without a guessed API-key header, identically — could not distinguish a missing-key case from a geo/IP block. Not built against an unconfirmed access requirement.',
  },
  'national gallery (london)': {
    state: 'MISSING',
    note: 'Confirmed this mission: api.nationalgallery.org.uk returns a real 200 but serves an HTML docs/landing page, not JSON; no working JSON endpoint located. Not built.',
  },
  'brooklyn museum api': {
    state: 'MISSING',
    note: 'Confirmed this mission: every request returns a real Vercel Security Checkpoint bot-management challenge (429). Not built without a way to pass this challenge.',
  },
  'national library of israel': {
    state: 'MISSING',
    note: 'Confirmed this mission: api.nli.org.il does not resolve at all; a guessed Primo/Ex Libris discovery host also does not resolve. Not built against an unconfirmed, unreachable endpoint.',
  },
  'cern repository': {
    state: 'MISSING',
    note: 'Confirmed this mission: cds.cern.ch/api/records is behind a real Anubis anti-bot JS challenge; search.cern.ch currently serves a "Service Alert" maintenance page instead of API responses. Not built against a currently blocked/down service.',
  },
  'pdg api': {
    state: 'MISSING',
    note: 'Confirmed this mission: pdg.lbl.gov/api redirects to a docs HTML page, not an API response; pdgapi.lbl.gov/particle/ returns a real HTTP 500 from an unrelated web app. PDG\'s real programmatic access may be a downloadable package + SQLite database rather than a live REST API — unconfirmed either way. Not built.',
  },
  'ocean networks canada': {
    state: 'MISSING',
    note: 'Confirmed live this mission: the real endpoint and token query-param auth are confirmed via a real structured 401 error. Not built because no confirmed success-response body shape could be obtained without a token in this session.',
  },
  'wordnet (princeton)': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is BULK+REPO — WordNet is distributed as a downloadable lexical database, not a live query API. No REST endpoint exists.',
  },
  'kiwix / zim files': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is BULK+FEED — Kiwix distributes offline-readable ZIM archive files, not a live query API.',
  },
  'mitre atlas': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is REPO — MITRE ATLAS is a git-hosted knowledge base (YAML/Markdown), not a REST query API.',
  },
  'exploit-db': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is REPO+BULK — Exploit-DB is distributed as a downloadable/git-cloneable CSV+file archive, not a live query REST API.',
  },
  'debian security tracker': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is BULK+REPO — the tracker publishes machine-readable data files (JSON/text) for bulk download, not a parameterized query REST API.',
  },
  'perseus / open greek and latin': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is REPO(git)+BULK — corpora are distributed as git repositories/TEI-XML archives, not a live query API.',
  },
  'papyri.info / idp.data': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is REPO(git)+BULK — papyrological data is distributed as a git repository, not a live query API.',
  },
  'openiti corpus': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is REPO+BULK — the OpenITI corpus is distributed as a git repository of text files, not a live query API.',
  },
  'kanripo / kanseki repository': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is REPO(git) — Kanripo is a git-hosted text repository, not a live query API.',
  },
  'osm planet dumps': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is BULK+FEED — planet dumps and Geofabrik extracts are downloadable data files, not a live query API (OSM\'s live query API, Overpass, is already covered by the existing osm_overpass provider).',
  },
  'gapminder datasets': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is BULK+REPO — Gapminder distributes datasets as downloadable spreadsheets/files, not a live query API.',
  },
  'cert-fr (anssi)': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is FEED — CERT-FR publishes advisories as an RSS/Atom pull feed with no query parameters, not a parameterized search API. A pull feed is a static listing, not a search API.',
  },
  'bsi cert-bund wid': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is FEED — BSI CERT-Bund publishes advisories as a pull feed with no query parameters, not a parameterized search API.',
  },
  'ncsc-nl security advisories': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is FEED/CSAF — NCSC-NL publishes advisories as a pull feed (CSAF format) with no query parameters, not a parameterized search API.',
  },
  'misp default feeds': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is FEED — MISP Default Feeds + CIRCL OSINT are pull feeds intended for ingestion into a MISP instance, not a parameterized search API; account-gated per registry\'s own auth field.',
  },
  'jma disaster information xml': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism and status confirm this is a PULL-only feed (FEED, "PULL only") — a static/periodic pull feed, not a parameterized search API.',
  },
  'standard ebooks opds feeds': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is FEED — Standard Ebooks publishes an OPDS catalog feed, not a parameterized search API.',
  },
  'eu financial sanctions database': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is BULK+FEED — the EU FSD is published as a downloadable/feed dataset (also the source for the "EU FSD / Consolidated Sanctions List" cat15 cross-reference row), not a live parameterized query API.',
  },
  'eu fsd / consolidated sanctions list': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is FEED+BULK — same underlying EU Financial Sanctions Database as the cat14 primary row; published as a downloadable/feed dataset, not a live query API.',
  },
  'nist jarvis': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own status explicitly states the REST endpoint is degraded and directs users to Figshare instead — Figshare is a bulk-download data repository, not a live query API.',
  },
  'cambridge structural database': {
    state: 'COMMERCIAL_GATED',
    note: 'Registry\'s own status explicitly states "no open web API" — access is via a licensed local CSD Python API requiring a paid/academic institutional license, not a publicly reachable REST endpoint.',
  },
  'vuldb': {
    state: 'COMMERCIAL_GATED',
    note: 'Registry\'s own status marks this "(paid)" — VulDB\'s API requires a paid subscription for meaningful query access; no free self-service tier suitable for this use case.',
  },
  'drugbank': {
    state: 'COMMERCIAL_GATED',
    note: 'Registry\'s own status marks this "(paid/academic)" — DrugBank\'s API requires a paid commercial license or an academic-only agreement, not a free self-service key.',
  },
  'reddit data api': {
    state: 'COMMERCIAL_GATED',
    note: 'Registry\'s own status explicitly marks this "(paid-gated)" — Reddit\'s Data API requires a paid commercial agreement for this kind of use since 2023.',
  },
  'interpol notices': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Registry\'s own status confirms this is "DEGRADED (bot-blocked)" and the access mechanism is an undocumented, unofficial REST endpoint — not a legitimate published machine-access mechanism to build against.',
  },
  'openspending': {
    state: 'DISCONTINUED',
    note: 'Registry\'s own status confirms "DEGRADED (API dead)" — OpenSpending\'s historic REST API is no longer operational (covers both the cat14 primary row and the cat15 "OpenSpending / Fiscal Data Package" cross-reference row).',
  },
  'grep.app': {
    state: 'MISSING',
    note: 'Confirmed this mission: grep.app/api/search returns a real Vercel Security Checkpoint JS-challenge page instead of JSON, both with and without an Accept: application/json header — genuine bot-management, not a docs/path error. Not built without a way to pass this challenge.',
  },
  'shodan': {
    state: 'COMMERCIAL_GATED',
    note: 'Confirmed this mission (via Shodan\'s own current pricing/docs): a free account\'s API key carries zero query credits — real search/host-lookup access requires a one-time paid Membership purchase. Not a genuine self-service free tier despite nominally issuing a "free" key.',
  },
  'censys platform api': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: platform.censys.io is behind a real Cloudflare Turnstile JS-challenge wall (cf-mitigated: challenge, CSP referencing challenges.cloudflare.com) even before any auth/credential check — genuine bot-management blocking any server-side client, not a credential question. The deprecated v1 host (search.censys.io/api/v1) cleanly 404s.',
  },
  'any.run': {
    state: 'MISSING',
    note: 'Confirmed live this mission: api.any.run returns a real structured 403 "Authorization required" (a real endpoint, not a bot wall), but no free/community self-service API-key registration flow could be confirmed — ANY.RUN\'s public materials position API access as part of paid subscription tiers. Not built pending confirmation of a genuine free self-service path.',
  },
  'ransomware.live': {
    state: 'MISSING',
    note: 'Confirmed this mission: every path tried on api.ransomware.live (recentvictims, groups, v2 variants) either 404s or returns the marketing SPA\'s HTML shell instead of JSON; data.ransomware.live redirects to the marketing site. No working JSON API host found, consistent with the registry\'s own "Account-gated" note — the real API may require a registered key routed through an undiscovered host. Not built against an unconfirmed endpoint. Independently re-confirmed in a later pass this mission: api.ransomware.live/ redirects to /v1/, but /v1/, /v1/recentvictims, and /v2/recentvictims all 404 with the same themed error page — a draft adapter built against an assumed /v2/recentvictims shape was caught by cross-checking two independent research passes against each other and deleted before being wired in, rather than trusted.',
  },
  'gitlab advisory database': {
    state: 'BULK_ONLY',
    note: 'Confirmed live this mission: GitLab\'s public GraphQL API has no global advisory-search capability — the vulnerabilities field is project/group-scoped, not a searchable database query. The real distribution mechanism for this data is the gitlab-org/advisories-community git repository, matching the registry\'s own "GraphQL+REPO" access tag — REPO is the real, primary access path.',
  },
  'mojeek search api': {
    state: 'COMMERCIAL_GATED',
    note: 'Confirmed live this mission: the real Search API endpoint and key-based auth are confirmed (a bogus key returns a real structured XML "Access Denied: invalid key/password" error, distinct from the plain website\'s separate bot-blocking). Mojeek\'s Search API is a paid, pay-per-query commercial product with no confirmed free self-service tier.',
  },
  'diffbot knowledge graph': {
    state: 'COMMERCIAL_GATED',
    note: 'Confirmed live this mission: the real endpoint and token-based auth are confirmed via a real 401 "Token is required" error. Diffbot offers only a time-limited free trial, not a permanent self-service free tier — not viable as a genuine credential-blocked build target.',
  },
  'golden knowledge graph': {
    state: 'DISCONTINUED',
    note: 'Confirmed this mission (web search): Golden Recursion Inc. was acquired by ComplyAdvantage in April 2024; its technology now feeds ComplyAdvantage\'s internal compliance/KYC pipeline. golden.com/product/api returns a real 403, consistent with it no longer being a publicly accessible self-service developer product.',
  },
  'glosbe': {
    state: 'DISCONTINUED',
    note: 'Confirmed live this mission: the documented gapi/translate endpoint returns a real 404 "Error in Glosbe" page both with and without a browser User-Agent — the endpoint itself is gone/moved, not merely bot-degraded as the registry\'s "anti-bot degraded" note suggests. No working replacement endpoint found.',
  },
  'wikibase cloud': {
    state: 'MISSING',
    note: 'Confirmed this mission: wikibase.cloud is a hosting/provisioning platform for many separate, independent Wikibase wiki instances, each with its own separate API on its own subdomain — there is no single unified "Wikibase Cloud API" endpoint to query, structurally identical to the federated-portal problem already identified for Open Contracting Partnership/OCDS in this mission. Not built as a fabricated single source.',
  },
  'snomed ct': {
    state: 'MISSING',
    note: 'Confirmed live this mission: browser.ihtsdotools.org/snowstorm real-redirects to an access-denied page for non-approved/non-browser clients (real 302 to denied.html, or a real 423 Locked with a browser User-Agent). No other public zero-auth Snowstorm instance found — confirms the registry\'s own "no free prod API" note.',
  },
  'nice syndication service': {
    state: 'MISSING',
    note: 'Registry\'s own cost/auth fields ("Freemium(licensed)", auth=Yes) describe a licensed-institution syndication feed, not a public self-service API; no live endpoint was independently confirmed in this session\'s time budget. Not built against an unconfirmed, likely-institutional-only mechanism.',
  },
  'promed-mail': {
    state: 'COMMERCIAL_GATED',
    note: 'Confirmed live this mission: the live site displays real subscription/login-gated content markers (Subscribe/Login), consistent with the registry\'s own "now paywalled" note. No zero-auth or free-key REST/feed endpoint found.',
  },
  'coconut 2.0': {
    state: 'MISSING',
    note: 'Confirmed live this mission: both documented endpoints (POST /api/molecules/search, GET /api/molecules) real-redirect (302) to a /login page regardless of request body — this requires session-cookie-based browser login, not a simple API-key header, a fundamentally different auth pattern not yet supported by this codebase\'s adapter conventions. Not built against an incompatible auth flow.',
  },
  'chebi 2.0': {
    state: 'DUPLICATE_COVERAGE',
    note: 'Confirmed live this mission: ChEBI is served through EBI\'s OLS4 API (/ols4/api/search?ontology=chebi), the exact same base endpoint already used by this codebase\'s existing ebi_ols adapter (which queries across all loaded ontologies including ChEBI, unscoped). Not built as a redundant second adapter over data already reachable.',
  },
  'kew mpns': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Confirmed live this mission: mpns.science.kew.org is behind a real Cloudflare Turnstile JS-challenge wall — genuine bot-management, not a docs/path error. Confirms the registry\'s own "SEARCH (+REST by agreement)" note: no public API exists without a special agreement.',
  },
  'who traditional medicine': {
    state: 'BULK_ONLY',
    note: 'Confirmed live this mission: WHO IRIS\'s real OAI-PMH endpoint (iris.who.int/oai/request) is zero-auth and reachable, but OAI-PMH is a harvest protocol with no keyword-search parameter in its spec — the same structural limitation already identified for EconStor OAI-PMH in this mission. Not built as a keyword-search adapter that would misrepresent a harvest-only capability.',
  },
  'scielo network': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH+OPDS — both are harvest/feed protocols with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission). Not built as a keyword-search adapter that would misrepresent a harvest-only capability.',
  },
  'cyberleninka': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH only — a harvest protocol with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission).',
  },
  'la referencia': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH only — a harvest protocol with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission).',
  },
  'shodhganga': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH only (and the registry\'s own status notes it is additionally geo-blocked) — a harvest protocol with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission).',
  },
  'clacso digital repository': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH only — a harvest protocol with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission).',
  },
  'paradisec': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH only — a harvest protocol with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission).',
  },
  'archive of indigenous languages of latam': {
    state: 'BULK_ONLY',
    note: 'Registry\'s own access mechanism is OAI-PMH only (account-gated for media access) — a harvest protocol with no keyword-search parameter (same structural limitation as EconStor/WHO IRIS in this mission).',
  },
  'oai-pmh ir ecosystem': {
    state: 'MISSING',
    note: 'Registry\'s own description ("DSpace/EPrints/OJS/etc, thousands of institutions") confirms this is not a single addressable source but a protocol pattern implemented independently by thousands of unrelated institutional repositories, each with its own separate endpoint — structurally identical to the Wikibase Cloud federated-hosting problem already identified in this mission, and additionally OAI-PMH-harvest-only (no keyword search) even per-instance. Not built as a fabricated single source.',
  },
  'japan search': {
    state: 'EXTERNAL_BLOCKER',
    note: 'Registry\'s own status explicitly confirms "(bot-blocked)" for this source (covers both the cat16 "Japan Search" and cat21 "Japan Search Web API + SPARQL" rows) — not a legitimate published machine-access mechanism to build against.',
  },
}

function findForcedClassification(sourceName) {
  const hay = sourceName.toLowerCase()
  for (const [needle, info] of Object.entries(FORCED_CLASSIFICATION_MAP)) {
    if (hay.includes(needle)) return info
  }
  return null
}

// Registry sources that are fully covered by an EXISTING provider under a
// different name — not a matcher gap, a deliberate non-duplication decision
// (mission item 16: "do not create redundant adapters solely to make the
// source count larger"). Checked before the normal provider matcher.
const DUPLICATE_COVERAGE_MAP = {
  'go vulnerability database': { providerId: 'osv_dev', note: 'Confirmed live this mission: Go\'s vulnerability database is fully OSV-schema-native and already queryable through the existing osv_dev adapter via ecosystem "Go" (e.g. query "Go:golang.org/x/text@0.3.6"). vuln.go.dev\'s native site is a separate static index+per-ID-JSON structure serving the identical underlying data — building a second adapter would duplicate it for no new capability.' },
}

function findDuplicateCoverage(sourceName) {
  const hay = sourceName.toLowerCase()
  for (const [needle, info] of Object.entries(DUPLICATE_COVERAGE_MAP)) {
    if (hay.includes(needle)) return info
  }
  return null
}

// Reverse index: registry source name (lowercased) -> providerId, for exact-ish matching.
function findProviderForSource(sourceName) {
  const hay = sourceName.toLowerCase()
  for (const [providerId, matchers] of Object.entries(PROVIDER_MATCHERS)) {
    for (const m of matchers) {
      if (hay.includes(m.toLowerCase())) return providerId
    }
  }
  return null
}

const IMPLEMENTED_PROVIDERS = new Set([
  'github', 'ncbi', 'fred', 'semantic_scholar', 'arxiv', 'crossref', 'nasa', 'nasa_gibs',
  'courtlistener', 'internet_archive', 'wayback', 'world_bank_indicators', 'usgs_water',
  'usgs_earthquake', 'usgs_earthquake_feed', 'usgs_sciencebase', 'library_of_congress',
  'wikidata', 'common_crawl', 'mitre_attack', 'gleif', 'exa', 'sam_gov', 'fmcsa',
  'wikipedia', 'europe_pmc', 'clinicaltrials_gov', 'openfda', 'pubchem', 'gbif', 'uniprot',
  'osv_dev', 'nvd', 'cisa_kev', 'osm_overpass', 'geonames', 'eurostat', 'us_census',
  'congress_gov', 'govinfo', 'sec_edgar', 'orcid', 'reliefweb',
  'ensembl', 'rcsb_pdb', 'string_db', 'gnomad', 'ebi_ols', 'medlineplus', 'who_gho',
  'rxnorm', 'dailymed', 'chembl', 'open_targets', 'inaturalist', 'obis', 'worms', 'itis',
  'pypi', 'npm_registry', 'crates_io', 'rubygems', 'maven_central', 'github_advisory',
  'endoflife', 'epss', 'alienvault_otx', 'malwarebazaar', 'threatfox', 'urlhaus',
  'federal_register', 'usaspending', 'uk_legislation', 'opensanctions', 'companies_house',
  'ecb_sdw', 'bank_of_canada', 'bis_stats', 'eia', 'statcan_wds', 'uk_ons', 'insee_melodi',
  'open_meteo', 'noaa_cdo', 'met_no', 'noaa_swpc', 'nominatim', 'nasa_cmr',
  'copernicus_dataspace', 'opentopography', 'celestrak', 'jpl_horizons', 'jpl_sbdb',
  'nasa_exoplanet_archive', 'simbad', 'mast',
  'ror', 'opencitations', 'biorxiv_medrxiv', 'hal', 'base_search', 'inspire_hep', 'hepdata',
  'zbmath', 'oeis', 'nasa_ads', 'epo_ops', 'materials_project', 'oqmd', 'aflow',
  'pleiades', 'idai_gazetteer', 'edh', 'nomisma', 'whg', 'open_context', 'cdli', 'ehri',
  'art_institute_chicago', 'cleveland_museum', 'va_museum', 'smk', 'open_library',
  'unhcr_data', 'ocha_fts', 'opensky', 'cbdb', 'eclac_cepalstat', 'oecd_data_explorer',
  'un_sdg', 'unesco_uis', 'idb_open_data', 'iati_datastore',
  'debian_sources', 'ietf_datatracker', 'wikimedia_commons', 'dbpedia', 'dblp',
  'mozilla_bugzilla', 'msrc_cvrf', 'isni', 'lobid_gnd', 'factgrid', 'ubuntu_security',
  'redhat_security_data', 'cve_org', 'conceptnet',
  'ena_portal', 'ncbi_datasets', 'alphafold_db', 'reactome', 'intact', 'orphadata',
  'guide_to_pharmacology', 'clinpgx', 'pbdb', 'nws_weather',
  'japan_egov_hourei', 'australia_frl', 'uk_gazette', 'eu_ted', 'brazil_transparencia',
  'sidra_brazil', 'cbs_statline',
  'gaia_archive', 'sdss_skyserver', 'apache_jira', 'health_canada_dpd', 'bindingdb',
  'kegg', 'metabolights', 'pride_archive',
  'libris_xl', 'nasjonalbiblioteket', 'nara_catalog', 'jstage', 'cinii',
  'musicbrainz', 'gitlab_api', 'codeberg', 'software_heritage', 'launchpad',
  'metacpan', 'ecosystems', 'deps_dev', 'homebrew', 'mdn_web_docs', 'rosetta_code',
  'greynoise', 'phishstats', 'virustotal', 'abuseipdb', 'hybrid_analysis',
  'ontobee', 'umls', 'loinc_fhir', 'wikipathways', 'cellosaurus',
  'metabolomics_workbench', 'npatlas', 'wellcome_collection', 'bhl',
  'google_kg_search', 'merriam_webster', 'brave_search',
  'checklistbank', 'eol', 'globi', 'mushroom_observer', 'arctic_data_center', 'cbeta',
  'ebl', 'mercado_publico', 'inpe_bdc', 'pdok', 'satnogs', 'nomad_repository', 'kramerius',
  'bdl_poland', 'israel_cbs', 'nomis_uk', 'abs_australia', 'argentina_series', 'data_gov_my',
  'datos_abiertos_colombia', 'ine_tempus3', 'singstat', 'usgs_m2m', 'n2yo', 'ariadne_portal',
  'ohm_overpass', 'stack_exchange', 'ecmwf_cds', 'met_office_datahub', 'ndl_search', 'swisscovery',
  'yago', 'data_commons', 'econstor', 'w3c_api', 'wto_timeseries', 'e_stat_japan',
  'world_bank_projects', 'usgs_national_map', 'imf_sdmx',
])
const STUB_PROVIDERS = new Set([
  'uspto', 'world_bank_data_catalog', 'world_bank_finances', 'world_bank_climate',
])
// Providers confirmed LIVE by a real, reproducible network call this mission
// via scripts/run-research-engine-live-validation.mjs — real HTTP request,
// real response, real parsed record(s), sample identifier logged. See
// docs/earth-knowledge/gap-matrix.md "Live probe results" for the full run
// transcript this reflects (testedAt included there).
const LIVE_VERIFIED_PROVIDERS = new Set([
  'arxiv', 'crossref', 'wikidata', 'usgs_earthquake', 'usgs_earthquake_feed',
  'usgs_sciencebase', 'library_of_congress', 'world_bank_indicators', 'mitre_attack', 'gleif',
  'wikipedia', 'europe_pmc', 'clinicaltrials_gov', 'openfda', 'pubchem', 'gbif', 'uniprot',
  'osv_dev', 'nvd', 'cisa_kev', 'osm_overpass', 'eurostat',
  'ensembl', 'rcsb_pdb', 'string_db', 'gnomad', 'ebi_ols', 'medlineplus', 'who_gho',
  'rxnorm', 'dailymed', 'chembl', 'open_targets', 'inaturalist', 'obis', 'worms', 'itis',
  'pypi', 'npm_registry', 'crates_io', 'rubygems', 'maven_central', 'endoflife', 'epss',
  'federal_register', 'usaspending', 'uk_legislation', 'ecb_sdw', 'bank_of_canada',
  'bis_stats', 'statcan_wds', 'uk_ons', 'insee_melodi',
  'open_meteo', 'met_no', 'noaa_swpc', 'nominatim', 'nasa_cmr', 'copernicus_dataspace',
  'celestrak', 'jpl_horizons', 'jpl_sbdb', 'nasa_exoplanet_archive', 'simbad', 'mast',
  'ror', 'opencitations', 'biorxiv_medrxiv', 'hal', 'inspire_hep', 'hepdata', 'zbmath',
  'oeis', 'oqmd',
  'pleiades', 'idai_gazetteer', 'edh', 'whg', 'open_context', 'cdli', 'ehri',
  'art_institute_chicago', 'cleveland_museum', 'va_museum', 'smk', 'open_library',
  'unhcr_data', 'ocha_fts', 'opensky', 'cbdb', 'eclac_cepalstat', 'oecd_data_explorer',
  'un_sdg', 'unesco_uis', 'idb_open_data',
  'debian_sources', 'ietf_datatracker', 'wikimedia_commons', 'dbpedia', 'dblp',
  'mozilla_bugzilla', 'msrc_cvrf', 'isni', 'lobid_gnd', 'factgrid', 'ubuntu_security',
  'redhat_security_data', 'cve_org',
  'ena_portal', 'ncbi_datasets', 'alphafold_db', 'reactome', 'intact', 'orphadata',
  'guide_to_pharmacology', 'clinpgx', 'pbdb', 'nws_weather',
  'japan_egov_hourei', 'australia_frl', 'uk_gazette', 'eu_ted', 'sidra_brazil', 'cbs_statline',
  'gaia_archive', 'sdss_skyserver', 'apache_jira', 'health_canada_dpd', 'bindingdb',
  'kegg', 'metabolights', 'pride_archive',
  'libris_xl', 'nasjonalbiblioteket', 'jstage', 'cinii',
  'musicbrainz', 'gitlab_api', 'codeberg', 'software_heritage', 'launchpad',
  'metacpan', 'ecosystems', 'deps_dev', 'homebrew', 'mdn_web_docs', 'rosetta_code',
  'greynoise', 'phishstats',
  'ontobee', 'wikipathways', 'cellosaurus', 'metabolomics_workbench', 'npatlas',
  'wellcome_collection',
  'checklistbank', 'eol', 'globi', 'mushroom_observer', 'arctic_data_center', 'cbeta',
  'ebl', 'inpe_bdc', 'pdok', 'satnogs', 'nomad_repository', 'kramerius', 'bdl_poland',
  'israel_cbs', 'nomis_uk', 'abs_australia', 'argentina_series', 'data_gov_my',
  'datos_abiertos_colombia', 'ine_tempus3', 'singstat', 'ariadne_portal',
  'ohm_overpass', 'stack_exchange', 'ecmwf_cds', 'ndl_search', 'swisscovery',
])
// Providers whose required credential is genuinely ABSENT from this
// environment (confirmed: not present in .env.local at all, not merely
// redacted) — the live harness reports these as cleanly SKIPPED, not FAILED.
const CREDENTIAL_BLOCKED_PROVIDERS = new Set([
  'common_crawl', 'geonames', 'congress_gov', 'govinfo', 'sec_edgar', 'orcid', 'reliefweb',
  'alienvault_otx', 'malwarebazaar', 'threatfox', 'urlhaus',
  'opensanctions', 'companies_house', 'eia',
  'noaa_cdo', 'opentopography',
  'base_search', 'nasa_ads', 'epo_ops', 'materials_project', 'iati_datastore',
  'brazil_transparencia',
  'virustotal', 'abuseipdb', 'hybrid_analysis',
  'umls', 'loinc_fhir', 'bhl', 'google_kg_search', 'merriam_webster', 'brave_search',
  'mercado_publico', 'usgs_m2m', 'n2yo', 'met_office_datahub',
  'data_commons', 'wto_timeseries', 'e_stat_japan',
])
// Providers whose adapter ran for real this session but whose credential
// value, though present in .env.local, was substituted with a redacted
// "[SENSITIVE]" placeholder by this session's own Bash sandbox before any
// subprocess (including the live-verification script) could read it — a
// property of THIS session's execution environment, not of War Room's
// deployed capability. The adapter code path is real and exercised; genuine
// liveness proof requires running the harness outside this sandbox (e.g. the
// Commander running `pnpm run validate:research-engine:live` directly, or a
// deployed environment). Never reported as broken/FAIL — the redaction
// artifact is documented explicitly instead.
const SESSION_CREDENTIAL_REDACTED_PROVIDERS = new Set([
  'exa', 'github', 'sam_gov', 'fmcsa', 'ncbi', 'fred', 'semantic_scholar', 'nasa',
  'nasa_gibs', 'courtlistener', 'internet_archive', 'wayback', 'usgs_water',
  'github_advisory',
])
// Providers whose documented policy said "optional key, works unauthenticated"
// but a real live call this session showed the upstream now requires a key in
// practice (confirmed via direct HTTP probe, not a sandbox redaction artifact).
const ACCESS_DEGRADED_PROVIDERS = new Set(['us_census', 'aflow', 'nomisma', 'conceptnet', 'nara_catalog'])

// --- Parse category tables ---
const categoryBlocks = []
let current = null
for (let i = 0; i < lines.length; i++) {
  const headerMatch = /^## CATEGORY (\d+) — (.+?)(?:\s*\(\d+.*\))?$/.exec(lines[i])
  if (headerMatch) {
    if (current) categoryBlocks.push(current)
    current = { num: headerMatch[1].padStart(2, '0'), name: headerMatch[2].trim(), rows: [] }
    continue
  }
  if (current && lines[i].startsWith('|') && !lines[i].startsWith('| Source') && !/^\|---/.test(lines[i])) {
    const cells = lines[i].split('|').slice(1, -1).map(c => c.trim())
    // Most category tables are 10 columns (...Status, F25). A few (04/06/08)
    // insert an extra "Evidence" column before F25 (...Status, Evidence,
    // F25) — always 11 cells there. Reading status/first25 from the END of
    // the row (rather than fixed positions 8/9) handles both shapes
    // correctly instead of misreading an evidence-class tag as an F25 marker.
    if (cells.length >= 10) {
      const hasEvidenceColumn = cells.length > 10
      const first25 = cells[cells.length - 1]
      const status = cells[cells.length - (hasEvidenceColumn ? 3 : 2)]
      const evidence = hasEvidenceColumn ? cells[cells.length - 2] : null
      current.rows.push({
        evidence,
        source: cells[0], org: cells[1], country: cells[2], accessType: cells[3],
        keyRequired: cells[4], cost: cells[5], tier: cells[6], difficulty: cells[7],
        status, first25,
      })
    }
  }
}
if (current) categoryBlocks.push(current)

const totalRows = categoryBlocks.reduce((sum, c) => sum + c.rows.length, 0)
console.log(`Parsed ${categoryBlocks.length} categories, ${totalRows} source rows.`)

// --- Reconcile ---
function classify(row) {
  const duplicate = findDuplicateCoverage(row.source)
  if (duplicate) return { state: 'DUPLICATE_COVERAGE', providerId: duplicate.providerId }

  const forced = findForcedClassification(row.source)
  if (forced) return { state: forced.state, providerId: null }

  const providerId = findProviderForSource(row.source)
  if (providerId) {
    if (STUB_PROVIDERS.has(providerId)) return { state: 'STUB_ONLY', providerId }
    if (!IMPLEMENTED_PROVIDERS.has(providerId)) return { state: 'MISSING', providerId: null }
    if (LIVE_VERIFIED_PROVIDERS.has(providerId)) return { state: 'LIVE_IMPLEMENTED', providerId }
    if (CREDENTIAL_BLOCKED_PROVIDERS.has(providerId)) return { state: 'IMPLEMENTED_CREDENTIAL_BLOCKED', providerId }
    if (ACCESS_DEGRADED_PROVIDERS.has(providerId)) return { state: 'IMPLEMENTED_ACCESS_DEGRADED', providerId }
    if (SESSION_CREDENTIAL_REDACTED_PROVIDERS.has(providerId)) return { state: 'IMPLEMENTED_NOT_LIVE_VERIFIED', providerId }
    return { state: 'IMPLEMENTED_NOT_LIVE_VERIFIED', providerId }
  }
  const status = row.status.toUpperCase()
  const access = row.accessType.toUpperCase()
  if (status.includes('DISCONTINUED')) return { state: 'DISCONTINUED', providerId: null }
  if (status.includes('COMMERCIAL-GATED') || (row.keyRequired.toLowerCase().includes('account-gated') && row.cost.toLowerCase() === 'paid')) {
    return { state: 'COMMERCIAL_GATED', providerId: null }
  }
  if (status.includes('SEARCH-ONLY') || (access.includes('SEARCH') && !access.includes('REST') && !access.includes('BULK') && !access.includes('SDMX') && !access.includes('PXWEB'))) {
    return { state: 'SEARCH_INTERFACE_ONLY', providerId: null }
  }
  if (access === 'BULK' || (access.includes('BULK') && !access.includes('REST') && !access.includes('SDMX') && !access.includes('PXWEB') && !access.includes('FEED') && !access.includes('SPARQL') && !access.includes('REPO'))) {
    return { state: 'BULK_ONLY', providerId: null }
  }
  return { state: 'MISSING', providerId: null }
}

function noteFor(state, providerId, sourceName) {
  if (state === 'DUPLICATE_COVERAGE') {
    const duplicate = findDuplicateCoverage(sourceName)
    return duplicate?.note ?? null
  }
  if (state === 'EXTERNAL_BLOCKER' || ((state === 'BULK_ONLY' || state === 'MISSING' || state === 'SEARCH_INTERFACE_ONLY' || state === 'IMPLEMENTED_CREDENTIAL_BLOCKED') && findForcedClassification(sourceName))) {
    return findForcedClassification(sourceName)?.note ?? null
  }
  if (state === 'IMPLEMENTED_NOT_LIVE_VERIFIED' && providerId && SESSION_CREDENTIAL_REDACTED_PROVIDERS.has(providerId)) {
    return 'Real credential present in this environment, but this session\'s own Bash sandbox redacts secret-shaped env values to a placeholder before any subprocess reads them — genuine liveness proof requires running validate:research-engine:live outside this sandbox.'
  }
  if (state === 'IMPLEMENTED_ACCESS_DEGRADED' && providerId === 'us_census') {
    return 'Documented as optional-key/unauthenticated, but a live call this session showed the 2023 ACS1 dataset now 302-redirects to a "Missing Key" page without one — Census appears to require a key in practice now.'
  }
  if (state === 'IMPLEMENTED_ACCESS_DEGRADED' && providerId === 'aflow') {
    return 'The classic AFLUX endpoint is confirmed dead (404); this adapter targets AFLOW\'s real, current, zero-auth OPTIMADE replacement instead, whose /info endpoint works — but the actual /structures data-query endpoint was confirmed live to be returning HTTP 500 server-side on AFLOW\'s own backend at build time, for every query including a bare no-filter request. Code is correct against the documented OPTIMADE contract; the live upstream is currently broken.'
  }
  if (state === 'IMPLEMENTED_ACCESS_DEGRADED' && providerId === 'nomisma') {
    return 'Nomisma has no free-text search API — only per-concept content-negotiated JSON (confirmed live: https://www.nomisma.org/id/{slug}.json responds correctly). The server itself is real but intermittently unreachable: repeated TLS handshake hangs across ~10 test attempts this mission, with exactly one clean round-trip. Code is correct against the confirmed contract; the live upstream is unreliable.'
  }
  if (state === 'IMPLEMENTED_ACCESS_DEGRADED' && providerId === 'conceptnet') {
    return 'Built against the real, documented, years-stable /c/en/{word} contract, but api.conceptnet.io returned HTTP 502 on every attempt across multiple retries this mission — a genuine current upstream outage, not a defect in this adapter\'s request/parse logic.'
  }
  if (state === 'IMPLEMENTED_ACCESS_DEGRADED' && providerId === 'nara_catalog') {
    return 'The documented /api/v2/records/search path serves the SPA HTML shell, not JSON; the real, undocumented working path is /proxy/records/search. Confirmed live this mission to be genuinely flaky at the CDN edge: identical repeated requests intermittently returned the real JSON response and intermittently the same HTML shell, with no request-side variable correlating to which one came back. Code is correct against the confirmed JSON contract; the live upstream is unreliable.'
  }
  if (state === 'IMPLEMENTED_CREDENTIAL_BLOCKED' && ['alienvault_otx', 'malwarebazaar', 'threatfox', 'urlhaus'].includes(providerId ?? '')) {
    return 'abuse.ch/OTX changed policy in 2023-2024 — an Auth-Key/API key is now mandatory for query access, not just higher rate limits. Adapter is real and correct; blocked only on the missing key in this environment.'
  }
  if (state === 'STUB_ONLY') return 'Declared in config/providerEnv.ts with implemented:false — no adapter file exists.'
  return null
}

const records = []
for (const cat of categoryBlocks) {
  for (const row of cat.rows) {
    const { state, providerId } = classify(row)
    records.push({
      sourceId: `ek_${cat.num}_${row.source.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)}`,
      name: row.source,
      category: `${cat.num} ${cat.name}`,
      organization: row.org,
      authorityTier: row.tier || null,
      accessMechanism: row.accessType,
      authMode: row.keyRequired,
      cost: row.cost,
      registryStatus: row.status,
      evidenceClass: row.evidence ?? null,
      isFirst25: Boolean(row.first25 && row.first25.trim()),
      _first25Raw: row.first25,
      implementationState: state,
      providerId,
      adapterPath: providerId && IMPLEMENTED_PROVIDERS.has(providerId) && !STUB_PROVIDERS.has(providerId)
        ? `lib/research-engine/providers/${providerId}.ts (see registry.ts for exact filename)` : null,
      notes: noteFor(state, providerId, row.source),
    })
  }
}

// --- Counts ---
const counts = {}
for (const r of records) counts[r.implementationState] = (counts[r.implementationState] ?? 0) + 1

const first25Records = records.filter(r => r.isFirst25)

// --- Write generated TS ---
const tsHeader = `// GENERATED FILE — do not hand-edit. Produced by
// scripts/earth-knowledge/build-completion-registry.mjs from
// docs/earth-knowledge/registry-parsed.md (itself extracted from the
// authoritative EARTH KNOWLEDGE SOURCE REGISTRY.txt backlog) reconciled
// against War Room's actual lib/research-engine/ provider implementation
// state. Re-run the generator after adding/repairing a provider adapter.
//
// This is War Room's durable, repository-native answer to "do we actually
// have this Earth Knowledge source?" — see docs/earth-knowledge/gap-matrix.md
// for the human-readable summary and docs/RESEARCH_PROVIDER_MATRIX.md for the
// research-engine-internal (not registry-scoped) provider matrix.

export type EarthKnowledgeImplementationState =
  | 'LIVE_IMPLEMENTED'
  | 'IMPLEMENTED_NOT_LIVE_VERIFIED'
  | 'IMPLEMENTED_CREDENTIAL_BLOCKED'
  | 'IMPLEMENTED_ACCESS_DEGRADED'
  | 'STUB_ONLY'
  | 'MISSING'
  | 'SEARCH_INTERFACE_ONLY'
  | 'BULK_ONLY'
  | 'COMMERCIAL_GATED'
  | 'DUPLICATE_COVERAGE'
  | 'DISCONTINUED'
  | 'EXTERNAL_BLOCKER'

export type EarthKnowledgeSourceRecord = {
  sourceId: string
  name: string
  category: string
  organization: string
  authorityTier: string | null
  accessMechanism: string
  authMode: string
  cost: string
  registryStatus: string
  /** TRAD/EXP/PRED/NOMEN/CLIN evidence-class tag, present only for categories 04/06/08 rows that carry one. Preserved distinctly per mission item 10 — never flattened to a boolean. */
  evidenceClass: string | null
  isFirst25: boolean
  implementationState: EarthKnowledgeImplementationState
  providerId: string | null
  adapterPath: string | null
  notes: string | null
}

export const EARTH_KNOWLEDGE_COMPLETION_REGISTRY: EarthKnowledgeSourceRecord[] = ${JSON.stringify(records.map(({ _first25Raw, ...rest }) => rest), null, 2)}

export const EARTH_KNOWLEDGE_STATE_COUNTS: Record<string, number> = ${JSON.stringify(counts, null, 2)}

export const EARTH_KNOWLEDGE_TOTAL_SOURCES = ${records.length}
`
writeFileSync(outTsPath, tsHeader)
console.log(`Wrote ${outTsPath} (${records.length} records)`)

// --- Write human-readable gap matrix ---
let md = `# Earth Knowledge Registry — Gap Matrix\n\n`
md += `Generated by \`scripts/earth-knowledge/build-completion-registry.mjs\` from the ${records.length}-source parsed registry (\`docs/earth-knowledge/registry-parsed.md\`), reconciled against War Room's actual \`lib/research-engine/\` implementation state as of this build. Re-run the generator after any provider change — do not hand-edit this file.\n\n`
md += `## Reconciliation state counts (all ${records.length} registry sources)\n\n| State | Count |\n|---|---|\n`
for (const [state, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  md += `| ${state} | ${count} |\n`
}
md += `\n## First 25 to Integrate — individual status\n\n| # | Source | State | War Room provider |\n|---|---|---|---|\n`
first25Records
  .map(r => ({ ...r, rank: Number((r._first25Raw ?? '').replace('★', '')) || 999 }))
  .sort((a, b) => a.rank - b.rank)
  .forEach(r => { md += `| ${r.rank === 999 ? '' : r.rank} | ${r.name} | ${r.implementationState} | ${r.providerId ?? '—'} |\n` })

md += `\n## Full registry, by category\n\n`
for (const cat of categoryBlocks) {
  md += `### CATEGORY ${cat.num} — ${cat.name} (${cat.rows.length})\n\n`
  md += `| Source | State | Provider | Registry status | Access | Tier |\n|---|---|---|---|---|---|\n`
  for (const row of cat.rows) {
    const rec = records.find(r => r.name === row.source && r.category === `${cat.num} ${cat.name}`)
    md += `| ${row.source} | ${rec.implementationState} | ${rec.providerId ?? '—'} | ${row.status} | ${row.accessType} | ${row.tier} |\n`
  }
  md += `\n`
}
writeFileSync(outMdPath, md)
console.log(`Wrote ${outMdPath}`)

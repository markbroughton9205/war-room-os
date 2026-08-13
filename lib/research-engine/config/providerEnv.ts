import 'server-only'

import type { ResearchProviderCapability, ResearchProviderCategory, ResearchProviderConfigStatus, ResearchProviderId } from '@/lib/research-engine/core/types'

/**
 * Server-only environment descriptor for one Research Engine provider.
 *
 * `requiredEnv` must all be present for the provider to be usable at all.
 * `optionalEnv` improves rate limits / identification but is not required.
 * `defaultBaseUrls` documents an internal fallback used ONLY when the
 * Commander did not set the corresponding base-URL env var — every default
 * here is a stable, official host and is the single source of truth the
 * HTTP safety layer allowlists against (see security/hostAllowlist.ts).
 */
export type ResearchProviderEnvDescriptor = {
  id: ResearchProviderId
  displayName: string
  category: ResearchProviderCategory
  capabilities: ResearchProviderCapability[]
  requiredEnv: string[]
  optionalEnv: string[]
  defaultBaseUrls: Record<string, string>
  /** Whether an adapter exists in this build phase. False = registry-only (env detection works; search does not). */
  implemented: boolean
  /** Provider that is pending/optional-by-design even when its key is absent (e.g. Semantic Scholar). */
  pendingWhenUnconfigured: boolean
  notes: string
}

export const RESEARCH_PROVIDER_ENV: ResearchProviderEnvDescriptor[] = [
  { id: 'exa', displayName: 'Exa', category: 'general_web', capabilities: ['search'], requiredEnv: ['EXA_API_KEY'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'Semantic/web search with content snippets. `run()` only calls POST /search; no distinct getById operation is implemented.' },
  { id: 'github', displayName: 'GitHub', category: 'code', capabilities: ['search'], requiredEnv: ['GITHUB_TOKEN'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'Read-only search against https://api.github.com. Default mode remains `GET /search/repositories`. Explicit `github issues:` / `github prs:` prefixes use `GET /search/issues` with `is:issue` / `is:pr` qualifiers. No code search, commit search, release search, GraphQL, or write path is implemented.' },
  { id: 'sam_gov', displayName: 'SAM.gov', category: 'government_contracts', capabilities: ['search'], requiredEnv: ['SAM_GOV_API_KEY'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'GET /opportunities/v2/search only. postedFrom/postedTo are mandatory per the official API and default to a bounded trailing 90-day window when not supplied. api_key is a required query parameter per the documented contract (no header alternative exists); redacted from logs/errors by the existing redact.ts allowlist. active/set-aside fields are only recorded when the API itself supplies them, never defaulted to active/eligible. Distinct from the revenue-focused adapter in lib/opportunity-agents/sources.' },
  { id: 'fmcsa', displayName: 'FMCSA', category: 'transportation', capabilities: ['getById'], requiredEnv: ['FMCSA_WEB_KEY'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'GET /qc/services/carriers/{dotNumber} only, dispatched from an exact "usdot <digits>" query (1-8 digits, a War Room safety bound — FMCSA publishes no formal digit-length rule). No name search, no docket-number search, no pagination, no sub-resource calls. Response envelope (`content.carrier` with numeric `dotNumber` and string `legalName`) was proven via two Commander-authorized, structure-only controlled probes against the official documentation-published sample USDOT 44110 — see docs/RESEARCH_CONTROLLED_PROBE_LOG.md and docs/RESEARCH_FMCSA_BUILD_REPORT.md. `webKey` is a required query parameter per the documented contract (no header alternative exists); redacted from logs/errors by the existing redact.ts allowlist. Empty-result and full error-response shapes were not live-verified this build (only a single matching carrier was ever probed) — non-2xx and malformed/unexpected shapes fail closed to upstream_error/parse_error, never a fabricated empty success.' },
  { id: 'ncbi', displayName: 'NCBI / PubMed', category: 'scholarly', capabilities: ['search'], requiredEnv: [], optionalEnv: ['NCBI_API_KEY'], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'ESearch+ESummary (JSON) + EFetch (XML, top result\'s abstract only) behind a single free-text search call — not independently callable getById/related operations. E-utilities work unauthenticated at a lower rate limit; NCBI_API_KEY raises the limit. No Commander base-URL override exists.' },
  { id: 'fred', displayName: 'FRED', category: 'economics', capabilities: ['search', 'timeSeries'], requiredEnv: ['FRED_API_KEY'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'St. Louis Fed economic time series. `search` and `timeSeries` describe the two output shapes one call produces (series matches + observations for the top match), not independently dispatched operations. No Commander base-URL override exists.' },
  { id: 'semantic_scholar', displayName: 'Semantic Scholar', category: 'scholarly', capabilities: ['search'], requiredEnv: [], optionalEnv: ['SEMANTIC_SCHOLAR_API_KEY'], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'Academic Graph API GET /paper/search only (never /paper/search/bulk — bounded, no bulk retrieval). Works unauthenticated at a shared, lower rate limit; SEMANTIC_SCHOLAR_API_KEY raises limits via the x-api-key header. No citations/references/PDF fields requested. Capability: search only.' },
  { id: 'arxiv', displayName: 'arXiv', category: 'scholarly', capabilities: ['search'], requiredEnv: [], optionalEnv: ['ARXIV_API_BASE_URL'], defaultBaseUrls: { ARXIV_API_BASE_URL: 'https://export.arxiv.org/api/query' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Atom/XML search, one request at a time, throttled. No distinct getById operation is implemented.' },
  { id: 'crossref', displayName: 'Crossref', category: 'scholarly', capabilities: ['search'], requiredEnv: [], optionalEnv: ['CROSSREF_API_BASE_URL', 'CROSSREF_MAILTO', 'CROSSREF_USER_AGENT_BASE'], defaultBaseUrls: { CROSSREF_API_BASE_URL: 'https://api.crossref.org' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Only /works search is implemented; no distinct DOI getById lookup. CROSSREF_MAILTO enables the polite pool; functions without it at reduced priority.' },
  { id: 'nasa', displayName: 'NASA Open APIs', category: 'space_earth', capabilities: ['search'], requiredEnv: ['NASA_API_KEY'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'GET /neo/rest/v1/feed (NeoWs) only — one narrow capability, not a generic NASA proxy, not a duplicate of nasa_gibs. Date range clamped server-side to the documented ≤7-day maximum regardless of caller input. No image/large-file download.' },
  { id: 'nasa_gibs', displayName: 'NASA GIBS (Earth Imagery)', category: 'space_earth', capabilities: ['mapLayers'], requiredEnv: ['NASA_GIBS_WMTS_BASE_URL'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: '`mapLayers` means "lists the curated available layers as documents" — it does not fetch or render a live tile; tile URLs still come from lib/earth-intelligence/gibsTileUrl.ts, unchanged. Already implemented in lib/earth-intelligence — this registry wires into that existing, reviewed module rather than duplicating it.' },
  { id: 'uspto', displayName: 'USPTO Open Data Portal', category: 'patents', capabilities: ['search', 'getById'], requiredEnv: ['USPTO_API_KEY'], optionalEnv: [], defaultBaseUrls: {}, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase; verify current ODP OpenAPI spec before implementing.' },
  { id: 'courtlistener', displayName: 'CourtListener', category: 'legal', capabilities: ['search'], requiredEnv: ['COURTLISTENER_API_TOKEN'], optionalEnv: [], defaultBaseUrls: {}, implemented: true, pendingWhenUnconfigured: false, notes: 'REST API v4 GET /search/?type=o (case-law opinion clusters) only. Token required per official docs. No docket/cluster getById dispatch this phase, so capability is search only. Opinion text/attachment URLs are never fetched.' },
  { id: 'internet_archive', displayName: 'Internet Archive', category: 'web_archive', capabilities: ['search'], requiredEnv: ['INTERNET_ARCHIVE_USER_AGENT_BASE'], optionalEnv: ['INTERNET_ARCHIVE_BASE_URL'], defaultBaseUrls: { INTERNET_ARCHIVE_BASE_URL: 'https://archive.org' }, implemented: true, pendingWhenUnconfigured: false, notes: 'GET /advancedsearch.php with a fixed allowlisted field list only — no unrestricted advanced-search field-query passthrough. No getById dispatch this phase, so capability is search only. Canonical URL only; no file/media/torrent download.' },
  { id: 'wayback', displayName: 'Wayback Machine', category: 'web_archive', capabilities: ['historicalCaptures'], requiredEnv: [], optionalEnv: ['WAYBACK_BASE_URL'], defaultBaseUrls: { WAYBACK_BASE_URL: 'https://web.archive.org' }, implemented: true, pendingWhenUnconfigured: false, notes: 'CDX Server API only (GET /cdx/search/cdx) — the query text is treated as the target URL to look up, bounded/SSRF-validated, never fetched. No compareCaptures (would require fetching archived page content) and no Availability API (different host). Public, unauthenticated.' },
  { id: 'world_bank_indicators', displayName: 'World Bank Indicators', category: 'global_development', capabilities: ['search', 'timeSeries'], requiredEnv: [], optionalEnv: ['WORLD_BANK_API_BASE_URL', 'WORLD_BANK_WDI_SOURCE_ID'], defaultBaseUrls: { WORLD_BANK_API_BASE_URL: 'https://api.worldbank.org/v2' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Country/indicator time series, two-array response shape. `search` and `timeSeries` describe the two output shapes one call produces (a summary document plus the full observation series), not independently dispatched operations.' },
  { id: 'world_bank_data_catalog', displayName: 'World Bank Data Catalog', category: 'global_development', capabilities: ['search'], requiredEnv: [], optionalEnv: ['WORLD_BANK_DATA_CATALOG_API_BASE_URL'], defaultBaseUrls: { WORLD_BANK_DATA_CATALOG_API_BASE_URL: 'https://datacatalogapi.worldbank.org/ddhxext' }, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase.' },
  { id: 'world_bank_projects', displayName: 'World Bank Projects', category: 'global_development', capabilities: ['search', 'getById'], requiredEnv: [], optionalEnv: ['WORLD_BANK_PROJECTS_API_BASE_URL'], defaultBaseUrls: { WORLD_BANK_PROJECTS_API_BASE_URL: 'https://search.worldbank.org/api/v2' }, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase.' },
  { id: 'world_bank_finances', displayName: 'World Bank Finances', category: 'global_development', capabilities: ['search'], requiredEnv: [], optionalEnv: ['WORLD_BANK_FINANCES_API_BASE_URL'], defaultBaseUrls: { WORLD_BANK_FINANCES_API_BASE_URL: 'https://finances.worldbank.org' }, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase.' },
  { id: 'world_bank_climate', displayName: 'World Bank Climate', category: 'climate_environment', capabilities: ['timeSeries'], requiredEnv: [], optionalEnv: ['WORLD_BANK_CLIMATE_API_BASE_URL'], defaultBaseUrls: { WORLD_BANK_CLIMATE_API_BASE_URL: 'https://climateknowledgeportal.worldbank.org' }, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase.' },
  { id: 'imf_sdmx', displayName: 'IMF SDMX', category: 'economics', capabilities: ['timeSeries'], requiredEnv: ['IMF_API_SUBSCRIPTION_KEY'], optionalEnv: ['IMF_SDMX_3_API_BASE_URL', 'IMF_SDMX_21_API_BASE_URL'], defaultBaseUrls: {}, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase; subscription key must be sent via Ocp-Apim-Subscription-Key header, never a query parameter.' },
  { id: 'usgs_water', displayName: 'USGS Water Data', category: 'hydrology_hazards', capabilities: ['timeSeries', 'geoSearch'], requiredEnv: [], optionalEnv: ['USGS_WATER_API_BASE_URL', 'USGS_WATER_API_KEY'], defaultBaseUrls: { USGS_WATER_API_BASE_URL: 'https://api.waterdata.usgs.gov' }, implemented: true, pendingWhenUnconfigured: false, notes: 'OGC API v0, `daily` collection only. Public read is unauthenticated; USGS_WATER_API_KEY is optional and, when set, sent only via the X-Api-Key header (never a query param) to raise rate limits. Query requires an explicit monitoring-location site number in the request text.' },
  { id: 'usgs_earthquake', displayName: 'USGS Earthquake Catalog', category: 'hydrology_hazards', capabilities: ['search', 'geoSearch'], requiredEnv: [], optionalEnv: ['USGS_EARTHQUAKE_API_BASE_URL'], defaultBaseUrls: { USGS_EARTHQUAKE_API_BASE_URL: 'https://earthquake.usgs.gov/fdsnws/event/1' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Public, unauthenticated GeoJSON event search; every call returns both documents and geoFeatures for the same query (search/geoSearch are two output views of one operation, not independently dispatched). No distinct getById-by-event-id operation is implemented.' },
  { id: 'usgs_earthquake_feed', displayName: 'USGS Real-Time Earthquake Feeds', category: 'hydrology_hazards', capabilities: ['list'], requiredEnv: [], optionalEnv: ['USGS_EARTHQUAKE_FEED_BASE_URL'], defaultBaseUrls: { USGS_EARTHQUAKE_FEED_BASE_URL: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Public, unauthenticated fixed-path GeoJSON feed (only allowlisted magnitude/period combinations). Fetch-on-request only, never background-polled; one upstream call per uncached run. No pagination exists for this endpoint.' },
  { id: 'usgs_national_map', displayName: 'USGS National Map', category: 'geospatial', capabilities: ['search'], requiredEnv: [], optionalEnv: ['USGS_NATIONAL_MAP_API_BASE_URL'], defaultBaseUrls: { USGS_NATIONAL_MAP_API_BASE_URL: 'https://tnmaccess.nationalmap.gov/api/v1' }, implemented: false, pendingWhenUnconfigured: false, notes: 'Adapter not yet implemented this build phase.' },
  { id: 'usgs_sciencebase', displayName: 'USGS ScienceBase', category: 'geospatial', capabilities: ['search', 'getById'], requiredEnv: [], optionalEnv: ['USGS_SCIENCEBASE_API_BASE_URL'], defaultBaseUrls: { USGS_SCIENCEBASE_API_BASE_URL: 'https://www.sciencebase.gov/catalog' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Public, unauthenticated read-only catalog. `run()` dispatches to /item/{id} only when the whole query text is a validated 24-hex-character ScienceBase item id; otherwise it dispatches to a bounded /items/ search. No create/update/delete/upload path exists.' },
  { id: 'library_of_congress', displayName: 'Library of Congress', category: 'cultural_heritage', capabilities: ['search'], requiredEnv: [], optionalEnv: ['LIBRARY_OF_CONGRESS_API_BASE_URL'], defaultBaseUrls: { LIBRARY_OF_CONGRESS_API_BASE_URL: 'https://www.loc.gov' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Global JSON search across LOC digital collections only; no distinct getById operation is implemented.' },
  { id: 'wikidata', displayName: 'Wikidata', category: 'knowledge_graph', capabilities: ['search'], requiredEnv: ['WIKIMEDIA_USER_AGENT_BASE'], optionalEnv: ['WIKIDATA_ACTION_API_URL', 'WIKIDATA_ENTITY_DATA_BASE_URL', 'WIKIDATA_SPARQL_ENDPOINT', 'WIKIDATA_SCHOLARLY_SPARQL_ENDPOINT'], defaultBaseUrls: { WIKIDATA_ACTION_API_URL: 'https://www.wikidata.org/w/api.php', WIKIDATA_ENTITY_DATA_BASE_URL: 'https://www.wikidata.org/wiki/Special:EntityData', WIKIDATA_SPARQL_ENDPOINT: 'https://query.wikidata.org/sparql' }, implemented: true, pendingWhenUnconfigured: false, notes: 'wbsearchentities + wbgetentities (label/description/alias enrichment) run together behind one free-text search call, not a separately callable getById; no arbitrary SPARQL is exposed to clients.' },
  { id: 'common_crawl', displayName: 'Common Crawl', category: 'web_archive', capabilities: ['historicalCaptures'], requiredEnv: ['COMMON_CRAWL_USER_AGENT_BASE', 'COMMON_CRAWL_COLLECTION_ID'], optionalEnv: ['COMMON_CRAWL_INDEX_BASE_URL', 'COMMON_CRAWL_DATA_BASE_URL', 'COMMON_CRAWL_COLLECTIONS_URL'], defaultBaseUrls: { COMMON_CRAWL_INDEX_BASE_URL: 'https://index.commoncrawl.org', COMMON_CRAWL_DATA_BASE_URL: 'https://data.commoncrawl.org', COMMON_CRAWL_COLLECTIONS_URL: 'https://index.commoncrawl.org/collinfo.json' }, implemented: true, pendingWhenUnconfigured: false, notes: 'CDX-compatible Index Server API GET /{collectionId}-index only — the query text is treated as the target URL to look up, bounded/SSRF-validated, never fetched. Requires a Commander-set COMMON_CRAWL_COLLECTION_ID (not read from providerEnv.ts, checked directly): this build could not authoritatively confirm a single current collection id without a disallowed live catalog fetch (collinfo.json), so no default is guessed. No WARC retrieval — filename/offset/length pointers are never read into output. Declared search capability is not claimed by run() — only historicalCaptures (bounded URL lookup, no free-text corpus search).' },
  { id: 'mitre_attack', displayName: 'MITRE ATT&CK', category: 'cyber_threat_intelligence', capabilities: ['search', 'getById'], requiredEnv: [], optionalEnv: ['MITRE_ATTACK_TAXII_API_ROOT'], defaultBaseUrls: { MITRE_ATTACK_TAXII_API_ROOT: 'https://attack-taxii.mitre.org/api/v21' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Official MITRE ATT&CK TAXII 2.1/STIX 2.1 server (attack-taxii.mitre.org, migrated from the legacy cti-taxii.mitre.org TAXII 2.0 host as of ATT&CK v15), Enterprise ATT&CK collection only. Public and unauthenticated. TAXII object retrieval supports type matching; free-text and ATT&CK external-ID matching are bounded local filtering over retrieved STIX objects, not claimed as server-side TAXII search. Structured threat-knowledge/reference data, not live threat telemetry.' },
  { id: 'gleif', displayName: 'GLEIF LEI API', category: 'legal_entity_reference', capabilities: ['search', 'getById'], requiredEnv: [], optionalEnv: ['GLEIF_API_BASE_URL'], defaultBaseUrls: { GLEIF_API_BASE_URL: 'https://api.gleif.org/api/v1' }, implemented: true, pendingWhenUnconfigured: false, notes: 'Official public JSON:API v1. GET /lei-records/{LEI} for exact 20-character LEI lookup; otherwise bounded legal-name filtering via GET /lei-records?filter[entity.legalName]=…. Returned record links expose available relationship resources, but this adapter does not crawl them. Public, unauthenticated; documented limit is 60 requests/minute/user.' },
]

function trimmedEnv(name: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** True if every requiredEnv name is present and non-empty. Never returns or logs values. */
export function isProviderEnvSatisfied(descriptor: ResearchProviderEnvDescriptor, env: NodeJS.ProcessEnv = process.env): boolean {
  return descriptor.requiredEnv.every(name => trimmedEnv(name, env) !== null)
}

/**
 * Resolve a base URL for a provider: the Commander-configured env var value
 * if present, otherwise the documented internal default. Returns null only
 * when neither exists (should not happen for descriptors in this registry).
 */
export function resolveBaseUrl(envName: string, descriptor: ResearchProviderEnvDescriptor, env: NodeJS.ProcessEnv = process.env): string | null {
  return trimmedEnv(envName, env) ?? descriptor.defaultBaseUrls[envName] ?? null
}

export function providerConfigStatus(descriptor: ResearchProviderEnvDescriptor, env: NodeJS.ProcessEnv = process.env): ResearchProviderConfigStatus {
  if (descriptor.pendingWhenUnconfigured && !isProviderEnvSatisfied(descriptor, env)) return 'pending'
  if (!isProviderEnvSatisfied(descriptor, env)) return 'unavailable'
  if (!descriptor.implemented) return 'pending'
  return 'configured'
}

export type ResearchProviderStatusRow = {
  id: ResearchProviderId
  displayName: string
  category: ResearchProviderCategory
  capabilities: ResearchProviderCapability[]
  requiredEnv: string[]
  optionalEnv: string[]
  configStatus: ResearchProviderConfigStatus
  implemented: boolean
  notes: string
}

/** Browser-safe: booleans and names only, never values. */
export function browserSafeProviderStatusRows(env: NodeJS.ProcessEnv = process.env): ResearchProviderStatusRow[] {
  return RESEARCH_PROVIDER_ENV.map(descriptor => ({
    id: descriptor.id,
    displayName: descriptor.displayName,
    category: descriptor.category,
    capabilities: descriptor.capabilities,
    requiredEnv: descriptor.requiredEnv,
    optionalEnv: descriptor.optionalEnv,
    configStatus: providerConfigStatus(descriptor, env),
    implemented: descriptor.implemented,
    notes: descriptor.notes,
  }))
}

export function providerEnvDescriptor(id: ResearchProviderId): ResearchProviderEnvDescriptor | null {
  return RESEARCH_PROVIDER_ENV.find(descriptor => descriptor.id === id) ?? null
}

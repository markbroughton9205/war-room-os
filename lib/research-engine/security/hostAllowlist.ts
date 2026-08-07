import 'server-only'

import type { ResearchProviderId } from '@/lib/research-engine/core/types'

/**
 * Every host a Research Engine provider is ever allowed to contact. This is
 * an allowlist, not a denylist — callers can never redirect an adapter to an
 * arbitrary upstream host, including via a Location header. Add a host here
 * only when it is the provider's official domain.
 */
export const RESEARCH_PROVIDER_HOST_ALLOWLIST: Record<ResearchProviderId, string[]> = {
  exa: ['api.exa.ai'],
  github: ['api.github.com'],
  sam_gov: ['api.sam.gov'],
  fmcsa: ['mobile.fmcsa.dot.gov'],
  ncbi: ['eutils.ncbi.nlm.nih.gov'],
  fred: ['api.stlouisfed.org'],
  semantic_scholar: ['api.semanticscholar.org'],
  arxiv: ['export.arxiv.org'],
  crossref: ['api.crossref.org'],
  nasa: ['api.nasa.gov'],
  nasa_gibs: ['gibs.earthdata.nasa.gov'],
  uspto: ['api.uspto.gov'],
  courtlistener: ['www.courtlistener.com'],
  internet_archive: ['archive.org', 'ia.us.archive.org'],
  wayback: ['web.archive.org'],
  world_bank_indicators: ['api.worldbank.org'],
  world_bank_data_catalog: ['datacatalogapi.worldbank.org'],
  world_bank_projects: ['search.worldbank.org'],
  world_bank_finances: ['finances.worldbank.org'],
  world_bank_climate: ['climateknowledgeportal.worldbank.org', 'climatedataapi.worldbank.org'],
  imf_sdmx: ['api.imf.org', 'dataservices.imf.org'],
  usgs_water: ['api.waterdata.usgs.gov'],
  usgs_earthquake: ['earthquake.usgs.gov'],
  usgs_earthquake_feed: ['earthquake.usgs.gov'],
  usgs_national_map: ['tnmaccess.nationalmap.gov'],
  usgs_sciencebase: ['www.sciencebase.gov'],
  library_of_congress: ['www.loc.gov'],
  wikidata: ['www.wikidata.org', 'query.wikidata.org'],
  common_crawl: ['index.commoncrawl.org', 'data.commoncrawl.org'],
}

export function isAllowedHost(provider: ResearchProviderId, hostname: string): boolean {
  const allowed = RESEARCH_PROVIDER_HOST_ALLOWLIST[provider] ?? []
  return allowed.some(host => hostname.toLowerCase() === host.toLowerCase())
}

/** Validates a URL is https and its host is on the given provider's allowlist. Throws otherwise. */
export function assertAllowedProviderUrl(provider: ResearchProviderId, url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL for provider ${provider}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Blocked non-HTTPS URL for provider ${provider}`)
  }
  if (!isAllowedHost(provider, parsed.hostname)) {
    throw new Error(`Blocked host "${parsed.hostname}" for provider ${provider}: not on the official-host allowlist`)
  }
  return parsed
}

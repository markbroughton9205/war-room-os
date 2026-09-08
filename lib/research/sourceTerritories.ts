import type { GeographicRegion } from '@/lib/council/scout-swarm/types'
import type { SourceAuthorityClass } from '@/lib/intelligence/intelligencePacket'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { PublicNewsCategory } from '@/lib/research/publicRssFeeds'

export type SourceQueryCapability =
  | 'free_text'
  | 'keyword_dataset'
  | 'locale_search'
  | 'rss_feed'
  | 'requires_env'
  | 'unsupported'

export type TerritorySourceDeclaration = {
  id: string
  provider: string
  providerId?: ResearchProviderId
  region: GeographicRegion | 'SCIENCE' | 'GLOBAL'
  language: string
  authorityClass: SourceAuthorityClass
  liveAvailable: boolean
  queryCapability: SourceQueryCapability
  notes: string
  rssCategories?: PublicNewsCategory[]
  googleNewsLocale?: { hl: string; gl: string; ceid: string }
  genericFallback?: boolean
}

export type GoogleNewsLocale = { hl: string; gl: string; ceid: string; queryLanguage: string }

export const GOOGLE_NEWS_LOCALE_BY_REGION: Record<GeographicRegion, GoogleNewsLocale> = {
  NORTH_AMERICA: { hl: 'en-US', gl: 'US', ceid: 'US:en', queryLanguage: 'en' },
  LATIN_AMERICA: { hl: 'es-419', gl: 'MX', ceid: 'MX:es', queryLanguage: 'es' },
  EUROPE: { hl: 'de', gl: 'DE', ceid: 'DE:de', queryLanguage: 'de' },
  AFRICA: { hl: 'en-ZA', gl: 'ZA', ceid: 'ZA:en', queryLanguage: 'en' },
  MIDDLE_EAST: { hl: 'ar', gl: 'AE', ceid: 'AE:ar', queryLanguage: 'ar' },
  EAST_ASIA: { hl: 'ja', gl: 'JP', ceid: 'JP:ja', queryLanguage: 'ja' },
  SOUTH_ASIA: { hl: 'en-IN', gl: 'IN', ceid: 'IN:en', queryLanguage: 'en' },
  OCEANIA: { hl: 'en-AU', gl: 'AU', ceid: 'AU:en', queryLanguage: 'en' },
}

/**
 * Additive catalog of source territories. liveAvailable means an adapter or public endpoint
 * exists in this repo — not that the current host has credentials or that a given query will hit.
 * Never mark an unsupported source as live.
 */
export const SOURCE_TERRITORIES: readonly TerritorySourceDeclaration[] = [
  { id: 'na-federal-register', provider: 'Federal Register API', providerId: 'federal_register', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'PRIMARY_REGULATOR', liveAvailable: true, queryCapability: 'free_text', notes: 'Keyless public documents.json search.' },
  { id: 'na-sec-edgar', provider: 'SEC EDGAR', providerId: 'sec_edgar', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'PRIMARY_CORPORATE', liveAvailable: true, queryCapability: 'requires_env', notes: 'PRIMARY_CORPORATE filings. Not a federal freight regulator. Needs SEC_EDGAR_USER_AGENT_BASE.' },
  { id: 'na-govinfo', provider: 'GovInfo', providerId: 'govinfo', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'PRIMARY_GOVERNMENT', liveAvailable: true, queryCapability: 'requires_env', notes: 'Requires GOVINFO_API_KEY. Federal Register collection window, not arbitrary free-text.' },
  { id: 'na-congress', provider: 'Congress.gov', providerId: 'congress_gov', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'PRIMARY_GOVERNMENT', liveAvailable: true, queryCapability: 'requires_env', notes: 'Requires CONGRESS_GOV_API_KEY when configured.' },
  { id: 'na-census', provider: 'US Census', providerId: 'us_census', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'Dataset-oriented; may miss newsy semiconductor queries.' },
  { id: 'na-statcan', provider: 'Statistics Canada WDS', providerId: 'statcan_wds', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'Canadian statistical tables.' },
  { id: 'na-abc-rss', provider: 'ABC News RSS', region: 'NORTH_AMERICA', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', rssCategories: ['news', 'world'], notes: 'Regional secondary US news feed already in trusted RSS list.' },

  { id: 'eu-eurostat', provider: 'Eurostat', providerId: 'eurostat', region: 'EUROPE', language: 'en', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'Not free-text. Dataset-code/keyword lookup only; semiconductor queries often miss.' },
  { id: 'eu-ecb', provider: 'ECB SDW', providerId: 'ecb_sdw', region: 'EUROPE', language: 'en', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'Statistical series, not news.' },
  { id: 'eu-uk-legislation', provider: 'UK legislation', providerId: 'uk_legislation', region: 'EUROPE', language: 'en', authorityClass: 'PRIMARY_GOVERNMENT', liveAvailable: true, queryCapability: 'free_text', notes: 'UK statute search.' },
  { id: 'eu-ted', provider: 'EU TED', providerId: 'eu_ted', region: 'EUROPE', language: 'en', authorityClass: 'PRIMARY_GOVERNMENT', liveAvailable: true, queryCapability: 'free_text', notes: 'Procurement notices; may be weakly relevant.' },
  { id: 'eu-dw-rss', provider: 'Deutsche Welle RSS', region: 'EUROPE', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', rssCategories: ['europe', 'news'], notes: 'Existing trusted Europe feed.' },
  { id: 'eu-lemonde-rss', provider: 'Le Monde RSS', region: 'EUROPE', language: 'fr', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', rssCategories: ['europe', 'news'], notes: 'French-language pathway via existing trusted feed.' },

  { id: 'ea-estat', provider: 'e-Stat Japan', providerId: 'e_stat_japan', region: 'EAST_ASIA', language: 'ja', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'requires_env', notes: 'Requires ESTAT_JAPAN_APP_ID. Honest miss if unconfigured.' },
  { id: 'ea-hourei', provider: 'Japan e-Gov Hourei', providerId: 'japan_egov_hourei', region: 'EAST_ASIA', language: 'ja', authorityClass: 'PRIMARY_GOVERNMENT', liveAvailable: true, queryCapability: 'free_text', notes: 'Japanese law corpus adapter.' },
  { id: 'ea-jstage', provider: 'J-STAGE', providerId: 'jstage', region: 'EAST_ASIA', language: 'ja', authorityClass: 'PRIMARY_ACADEMIC', liveAvailable: true, queryCapability: 'free_text', notes: 'Academic papers, not trade news.' },
  { id: 'ea-ndl', provider: 'NDL Search', providerId: 'ndl_search', region: 'EAST_ASIA', language: 'ja', authorityClass: 'PRIMARY_ACADEMIC', liveAvailable: true, queryCapability: 'free_text', notes: 'National Diet Library search.' },
  { id: 'ea-scmp-rss', provider: 'SCMP RSS', region: 'EAST_ASIA', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', rssCategories: ['asia', 'news'], notes: 'Hong Kong English secondary. Not a Japanese-government primary.' },

  { id: 'la-eclac', provider: 'ECLAC CEPALSTAT', providerId: 'eclac_cepalstat', region: 'LATIN_AMERICA', language: 'es', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'Statistical tables.' },
  { id: 'la-brazil', provider: 'Brazil Transparencia', providerId: 'brazil_transparencia', region: 'LATIN_AMERICA', language: 'pt', authorityClass: 'PRIMARY_GOVERNMENT', liveAvailable: true, queryCapability: 'free_text', notes: 'Brazilian public expenditure/search adapter.' },

  { id: 'af-reliefweb', provider: 'ReliefWeb', providerId: 'reliefweb', region: 'AFRICA', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'free_text', notes: 'Humanitarian reporting; not an African statistical office.' },
  { id: 'af-allafrica-rss', provider: 'AllAfrica RSS', region: 'AFRICA', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', rssCategories: ['africa', 'news'], notes: 'Existing trusted Africa feed.' },

  { id: 'me-israel-cbs', provider: 'Israel CBS', providerId: 'israel_cbs', region: 'MIDDLE_EAST', language: 'en', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'National statistics. Limited topical coverage.' },
  { id: 'me-aljazeera-rss', provider: 'Al Jazeera RSS', region: 'MIDDLE_EAST', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', notes: 'English Al Jazeera feed — not Arabic-native retrieval by itself.' },

  { id: 'sa-hindu-rss', provider: 'The Hindu RSS', region: 'SOUTH_ASIA', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', rssCategories: ['asia', 'news'], notes: 'English Indian newspaper. No dedicated South Asia government adapter wired as free-text primary.' },

  { id: 'oc-abs', provider: 'ABS Australia', providerId: 'abs_australia', region: 'OCEANIA', language: 'en', authorityClass: 'PRIMARY_DATA', liveAvailable: true, queryCapability: 'keyword_dataset', notes: 'Australian Bureau of Statistics.' },
  { id: 'oc-smh-rss', provider: 'Sydney Morning Herald RSS', region: 'OCEANIA', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', notes: 'Existing trusted Oceania feed.' },

  { id: 'sci-arxiv', provider: 'arXiv', providerId: 'arxiv', region: 'SCIENCE', language: 'en', authorityClass: 'PRIMARY_ACADEMIC', liveAvailable: true, queryCapability: 'free_text', notes: 'Preprints.' },
  { id: 'sci-crossref', provider: 'Crossref', providerId: 'crossref', region: 'SCIENCE', language: 'en', authorityClass: 'PRIMARY_ACADEMIC', liveAvailable: true, queryCapability: 'free_text', notes: 'Scholarly metadata.' },
  { id: 'sci-ncbi', provider: 'NCBI/PubMed', providerId: 'ncbi', region: 'SCIENCE', language: 'en', authorityClass: 'PRIMARY_ACADEMIC', liveAvailable: true, queryCapability: 'free_text', notes: 'Biomedical literature.' },

  { id: 'global-bbc-rss', provider: 'BBC World News RSS', region: 'GLOBAL', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'rss_feed', genericFallback: true, notes: 'Generic global RSS fallback — must not be the sole claimed regional-primary source.' },
  { id: 'global-google-news', provider: 'Google News RSS', region: 'GLOBAL', language: 'en', authorityClass: 'SECONDARY_MAJOR_MEDIA', liveAvailable: true, queryCapability: 'locale_search', genericFallback: true, notes: 'Query-driven. Locale must follow region; US locale is not a global primary.' },
]

export function territoriesForRegion(region: GeographicRegion): TerritorySourceDeclaration[] {
  return SOURCE_TERRITORIES.filter(item => item.region === region)
}

export function primaryProviderIdsForRegion(region: GeographicRegion): ResearchProviderId[] {
  return territoriesForRegion(region)
    .filter(item => item.providerId && item.authorityClass.startsWith('PRIMARY_') && item.liveAvailable)
    .map(item => item.providerId!)
}

export function secondaryRssCategoriesForRegion(region: GeographicRegion): PublicNewsCategory[] {
  const cats = new Set<PublicNewsCategory>()
  for (const item of territoriesForRegion(region)) {
    for (const cat of item.rssCategories ?? []) cats.add(cat)
  }
  if (region === 'EUROPE') cats.add('europe')
  if (region === 'EAST_ASIA' || region === 'SOUTH_ASIA') cats.add('asia')
  if (region === 'AFRICA') cats.add('africa')
  return [...cats]
}

export function googleNewsLocaleForRegion(region?: GeographicRegion | null): GoogleNewsLocale {
  if (!region) return { hl: 'en-US', gl: 'US', ceid: 'US:en', queryLanguage: 'en' }
  return GOOGLE_NEWS_LOCALE_BY_REGION[region]
}

export function regionHasPrimaryPublicEndpoint(region: GeographicRegion): boolean {
  return primaryProviderIdsForRegion(region).length > 0
}

import type { ResearchProviderId, ResearchQuery, ResearchQueryIntent, ResearchRouteDecision } from '@/lib/research-engine/core/types'
import { RESEARCH_PROVIDER_ENV, providerConfigStatus } from '@/lib/research-engine/config/providerEnv'
import { listImplementedProviderIds } from '@/lib/research-engine/providers/registry'

/**
 * Intent -> candidate provider list, per the routing table in the assignment
 * spec. The router never calls every provider for every request — it
 * narrows to this list, then further narrows to providers that are both
 * configured and implemented.
 */
const INTENT_PROVIDER_MAP: Record<ResearchQueryIntent, ResearchProviderId[]> = {
  general_web: ['exa', 'internet_archive', 'wayback', 'common_crawl', 'wikidata'],
  software_code: ['github', 'exa', 'arxiv', 'crossref'],
  scholarly: ['arxiv', 'crossref', 'ncbi', 'semantic_scholar', 'github'],
  medical_biomedical: ['ncbi', 'crossref', 'semantic_scholar'],
  legal_case_law: ['courtlistener', 'library_of_congress', 'wayback', 'wikidata'],
  patents_inventions: ['uspto', 'crossref', 'github', 'wikidata'],
  government_contracts: ['sam_gov', 'fmcsa', 'world_bank_projects'],
  transportation_carriers: ['fmcsa'],
  economics_macro: ['fred', 'imf_sdmx', 'world_bank_indicators'],
  global_development: ['world_bank_indicators', 'world_bank_projects', 'world_bank_finances', 'world_bank_climate', 'imf_sdmx'],
  finance_public_data: ['fred', 'world_bank_finances'],
  climate_environment: ['world_bank_climate', 'nasa_gibs', 'nasa', 'usgs_water'],
  earthquakes_hazards: ['usgs_earthquake', 'usgs_earthquake_feed', 'nasa_gibs', 'usgs_sciencebase'],
  water_hydrology: ['usgs_water', 'usgs_national_map', 'world_bank_climate'],
  maps_geospatial: ['nasa_gibs', 'usgs_national_map', 'usgs_sciencebase'],
  historical_web: ['wayback', 'internet_archive', 'common_crawl', 'library_of_congress'],
  cultural_history: ['library_of_congress', 'internet_archive', 'wikidata'],
  entity_knowledge_graph: ['wikidata', 'library_of_congress', 'github', 'sam_gov'],
  space_science: ['nasa', 'nasa_gibs'],
  cyber_threat_intelligence: ['mitre_attack'],
  legal_entity: ['gleif'],
}

function rejectionReason(provider: ResearchProviderId): string {
  const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === provider)
  if (!descriptor) return 'unknown provider'
  const status = providerConfigStatus(descriptor)
  if (status === 'unavailable') return `required environment variable(s) not configured: ${descriptor.requiredEnv.join(', ')}`
  if (status === 'pending' && !descriptor.implemented) return 'adapter not implemented in this build phase'
  if (status === 'pending') return 'optional credential not configured; provider marked pending by design'
  return 'not selected for this query'
}

export function routeResearchQuery(query: ResearchQuery): ResearchRouteDecision {
  const intent = query.intent ?? null
  const implementedIds = new Set(listImplementedProviderIds())
  const explicit = query.providers && query.providers.length > 0 ? query.providers : null
  const candidates = explicit ?? (intent ? INTENT_PROVIDER_MAP[intent] ?? [] : listImplementedProviderIds())

  const selectedProviders: ResearchProviderId[] = []
  const rejectedProviders: { provider: ResearchProviderId; reason: string }[] = []

  for (const provider of candidates) {
    const descriptor = RESEARCH_PROVIDER_ENV.find(entry => entry.id === provider)
    const configured = descriptor ? providerConfigStatus(descriptor) === 'configured' : false
    if (configured && implementedIds.has(provider)) {
      selectedProviders.push(provider)
    } else {
      rejectedProviders.push({ provider, reason: rejectionReason(provider) })
    }
  }

  return {
    intent,
    selectedProviders,
    rejectedProviders,
    freshnessRequirement: query.requireCurrent ? 'current' : 'either',
    maxResults: Math.max(1, Math.min(query.maxResults ?? 20, 50)),
  }
}

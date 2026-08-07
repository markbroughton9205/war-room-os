import 'server-only'

import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { githubAdapter } from '@/lib/research-engine/providers/github'
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
}

export function getImplementedAdapter(id: ResearchProviderId): ResearchProviderAdapter | null {
  return IMPLEMENTED_PROVIDER_ADAPTERS[id] ?? null
}

export function listImplementedProviderIds(): ResearchProviderId[] {
  return Object.keys(IMPLEMENTED_PROVIDER_ADAPTERS) as ResearchProviderId[]
}

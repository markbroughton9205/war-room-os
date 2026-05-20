import { isProviderHealthy } from './healthMemory'
import { rankProviders } from './weighting'
import { FAILOVER_CHAIN, type SignalSourceId } from './types'

export function selectPrimaryProvider(
  configuredMap: Partial<Record<SignalSourceId, boolean>>,
  chain: SignalSourceId[] = FAILOVER_CHAIN,
): SignalSourceId {
  const configured = chain.filter(id => configuredMap[id])
  const healthy = configured.filter(id => isProviderHealthy(id, true))
  const pool = healthy.length ? healthy : configured
  if (!pool.length) return 'historical'
  const ranked = rankProviders(pool, configuredMap)
  return ranked[0] ?? pool[0]
}

export function buildConfiguredMap(): Partial<Record<SignalSourceId, boolean>> {
  return {
    tavily: Boolean(process.env.TAVILY_API_KEY?.trim()),
    brave: Boolean(process.env.BRAVE_API_KEY?.trim()),
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
    rss: true,
    cache: true,
    historical: true,
    local_manual: true,
  }
}

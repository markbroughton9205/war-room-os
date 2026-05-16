import { TAB_CONFIG_REGISTRY, type ConfigurationStatus, type TabConfigDefinition } from './configurationRegistry'
import type { ProviderConfigStatus } from './providerConfigStatus'

export type TabConfigurationAudit = {
  id: TabConfigDefinition['id']
  name: string
  status: ConfigurationStatus
  configured: boolean
  configuredProviders: number
  totalProviders: number
  missingProviders: string[]
  degradedProviders: string[]
  criticalBlockers: string[]
  providerIds: string[]
  description: string
  recommendedNextAction: string
}

const statusRank: Record<ConfigurationStatus, number> = {
  unavailable: 6,
  missing_api_key: 5,
  missing_provider: 4,
  degraded: 3,
  disabled_by_operator: 2,
  configured: 1,
  ready: 0,
}

function tabStatus(providers: ProviderConfigStatus[]): ConfigurationStatus {
  if (providers.length === 0) return 'unavailable'
  const blockers = providers.filter(provider => provider.required === 'required' && statusRank[provider.status] >= statusRank.missing_provider)
  if (blockers.some(provider => provider.status === 'missing_api_key')) return 'missing_api_key'
  if (blockers.some(provider => provider.status === 'missing_provider')) return 'missing_provider'
  if (blockers.some(provider => provider.status === 'unavailable')) return 'unavailable'

  const recommendedMissing = providers.filter(provider =>
    (provider.required === 'recommended' || provider.required === 'optional')
    && statusRank[provider.status] >= statusRank.missing_provider
  )
  if (recommendedMissing.length > 0) return 'degraded'
  if (providers.some(provider => provider.status === 'disabled_by_operator')) return 'disabled_by_operator'
  if (providers.every(provider => provider.status === 'ready' || provider.status === 'configured')) return 'ready'
  return 'configured'
}

export function buildTabConfigAudit(providers: ProviderConfigStatus[]): TabConfigurationAudit[] {
  const providerById = new Map(providers.map(provider => [provider.id, provider]))

  return TAB_CONFIG_REGISTRY.map(tab => {
    const tabProviders = tab.providerIds.flatMap(id => {
      const provider = providerById.get(id)
      return provider ? [provider] : []
    })
    const missingProviders = tabProviders
      .filter(provider => provider.status === 'missing_provider' || provider.status === 'missing_api_key' || provider.status === 'unavailable')
      .map(provider => provider.name)
    const degradedProviders = tabProviders
      .filter(provider => provider.status === 'degraded' || provider.status === 'disabled_by_operator')
      .map(provider => provider.name)
    const criticalBlockers = tabProviders
      .filter(provider =>
        provider.required === 'required'
        && (provider.status === 'missing_api_key' || provider.status === 'missing_provider' || provider.status === 'unavailable')
      )
      .map(provider => `${provider.name}: ${provider.missingDependency ?? provider.status}`)
    const status = tabStatus(tabProviders)
    const configuredProviders = tabProviders.filter(provider => provider.configured).length

    return {
      id: tab.id,
      name: tab.name,
      status,
      configured: status === 'ready' || status === 'configured',
      configuredProviders,
      totalProviders: tabProviders.length,
      missingProviders,
      degradedProviders,
      criticalBlockers,
      providerIds: tab.providerIds,
      description: tab.description,
      recommendedNextAction: criticalBlockers[0]
        ?? missingProviders[0]
        ?? degradedProviders[0]
        ?? 'No tab-level configuration action required.',
    }
  })
}

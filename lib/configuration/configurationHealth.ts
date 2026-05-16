import type { ConfigurationStatus } from './configurationRegistry'
import { buildMissingProviderGuide, type MissingProviderGuideEntry } from './missingProviderGuide'
import { evaluateAllProviderConfigs, type ProviderConfigStatus } from './providerConfigStatus'
import { buildTabConfigAudit, type TabConfigurationAudit } from './tabConfigAudit'

export type ConfigurationHealthSummary = {
  checkedAt: string
  totalProviders: number
  totalProvidersConfigured: number
  missingProviders: number
  degradedSystems: number
  criticalBlockers: string[]
  optionalEnhancements: string[]
  statusCounts: Record<ConfigurationStatus, number>
}

export type ConfigurationSweep = {
  checkedAt: string
  providers: ProviderConfigStatus[]
  tabs: TabConfigurationAudit[]
  missingProviderGuide: MissingProviderGuideEntry[]
  summary: ConfigurationHealthSummary
  safety: {
    exposesSecretValues: false
    envValuesReturned: false
    checkMode: 'env_presence_only'
  }
}

const allStatuses: ConfigurationStatus[] = [
  'configured',
  'missing_provider',
  'missing_api_key',
  'degraded',
  'unavailable',
  'ready',
  'disabled_by_operator',
]

function buildSummary(checkedAt: string, providers: ProviderConfigStatus[], tabs: TabConfigurationAudit[]): ConfigurationHealthSummary {
  const statusCounts = Object.fromEntries(allStatuses.map(status => [status, 0])) as Record<ConfigurationStatus, number>
  for (const provider of providers) statusCounts[provider.status] += 1

  const criticalBlockers = tabs.flatMap(tab => tab.criticalBlockers.map(blocker => `${tab.name}: ${blocker}`))
  const optionalEnhancements = providers
    .filter(provider =>
      (provider.required === 'optional' || provider.required === 'future')
      && (provider.status === 'missing_provider' || provider.status === 'missing_api_key' || provider.status === 'unavailable')
    )
    .map(provider => `${provider.name}: ${provider.recommendedNextAction}`)

  return {
    checkedAt,
    totalProviders: providers.length,
    totalProvidersConfigured: providers.filter(provider => provider.configured).length,
    missingProviders: providers.filter(provider => provider.status === 'missing_provider' || provider.status === 'missing_api_key').length,
    degradedSystems: providers.filter(provider => provider.status === 'degraded' || provider.status === 'disabled_by_operator').length,
    criticalBlockers,
    optionalEnhancements,
    statusCounts,
  }
}

export function buildConfigurationSweep(env: NodeJS.ProcessEnv = process.env): ConfigurationSweep {
  const checkedAt = new Date().toISOString()
  const providers = evaluateAllProviderConfigs(env)
  const tabs = buildTabConfigAudit(providers)
  const missingProviderGuide = buildMissingProviderGuide(providers)
  const summary = buildSummary(checkedAt, providers, tabs)

  return {
    checkedAt,
    providers,
    tabs,
    missingProviderGuide,
    summary,
    safety: {
      exposesSecretValues: false,
      envValuesReturned: false,
      checkMode: 'env_presence_only',
    },
  }
}

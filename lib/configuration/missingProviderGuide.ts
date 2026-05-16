import type { ProviderConfigStatus } from './providerConfigStatus'

export type MissingProviderGuideEntry = {
  providerId: string
  providerName: string
  status: ProviderConfigStatus['status']
  whatItPowers: string[]
  requiredEnvVarNames: string[]
  optionalEnvVarNames: string[]
  whereToConfigure: string
  required: ProviderConfigStatus['required']
  affectedFeatures: string[]
  recommendedNextAction: string
}

export function buildMissingProviderGuide(providers: ProviderConfigStatus[]): MissingProviderGuideEntry[] {
  return providers
    .filter(provider =>
      provider.status === 'missing_provider'
      || provider.status === 'missing_api_key'
      || provider.status === 'degraded'
      || provider.status === 'unavailable'
      || provider.status === 'disabled_by_operator'
    )
    .map(provider => ({
      providerId: provider.id,
      providerName: provider.name,
      status: provider.status,
      whatItPowers: provider.powers,
      requiredEnvVarNames: provider.requiredEnvVars,
      optionalEnvVarNames: provider.optionalEnvVars,
      whereToConfigure: provider.setupLocation,
      required: provider.required,
      affectedFeatures: provider.affectedFeatures,
      recommendedNextAction: provider.recommendedNextAction,
    }))
}

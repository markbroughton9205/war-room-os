import { PROVIDER_CONFIG_REGISTRY, type ConfigurationStatus, type ProviderConfigDefinition } from './configurationRegistry'
import { configuredEnvName, envAliasDiagnosticsForPreferredNames, envNameConfigured, type EnvAliasDiagnostic } from './envAlias'
import { redactServerOnlyEnvName, redactServerOnlyEnvNames } from '@/lib/security/sensitiveEnv'

export type ProviderConfigStatus = {
  id: string
  name: string
  category: ProviderConfigDefinition['category']
  status: ConfigurationStatus
  configured: boolean
  required: ProviderConfigDefinition['required']
  requiredEnvVars: string[]
  optionalEnvVars: string[]
  configuredEnvVars: string[]
  missingEnvVars: string[]
  preferredEnvName: string | null
  aliasDetected: boolean
  aliasRecommendation: string | null
  envAliasDiagnostics: EnvAliasDiagnostic[]
  lastCheckResult: string
  missingDependency: string | null
  affectedFeatures: string[]
  recommendedNextAction: string
  powers: string[]
  setupLocation: string
}

function envPresent(env: NodeJS.ProcessEnv, name: string): boolean {
  return envNameConfigured(env, name)
}

function unique(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

function alternativeGroupSatisfied(env: NodeJS.ProcessEnv, groups: string[][] | undefined): boolean {
  if (!groups?.length) return true
  return groups.some(group => group.some(name => envPresent(env, name)))
}

function missingAlternativeNames(env: NodeJS.ProcessEnv, groups: string[][] | undefined): string[] {
  if (!groups?.length || alternativeGroupSatisfied(env, groups)) return []
  return unique(groups.flat())
}

function resolveStatus(def: ProviderConfigDefinition, env: NodeJS.ProcessEnv, missingEnvVars: string[]): ConfigurationStatus {
  if (def.disabledByEnvVar && envPresent(env, def.disabledByEnvVar)) return 'disabled_by_operator'
  if (def.staticStatus) return def.staticStatus

  if (missingEnvVars.length > 0) {
    return def.requiredEnvVars.length > 0 || def.alternativeEnvVarGroups?.length ? 'missing_api_key' : 'missing_provider'
  }

  if (def.required === 'future') return 'unavailable'
  if (def.required === 'optional') return 'configured'
  return 'ready'
}

export function evaluateProviderConfig(def: ProviderConfigDefinition, env: NodeJS.ProcessEnv = process.env): ProviderConfigStatus {
  const requiredMissing = def.requiredEnvVars.filter(name => !envPresent(env, name))
  const alternativeMissing = missingAlternativeNames(env, def.alternativeEnvVarGroups)
  const missingEnvVars = unique([...requiredMissing, ...alternativeMissing])
  const envVarNames = unique([
    ...def.requiredEnvVars,
    ...(def.optionalEnvVars ?? []),
    ...(def.alternativeEnvVarGroups ?? []).flat(),
    ...(def.disabledByEnvVar ? [def.disabledByEnvVar] : []),
  ])
  const configuredEnvVars = unique(envVarNames.flatMap(name => configuredEnvName(env, name) ?? []))
  const envAliasDiagnostics = envAliasDiagnosticsForPreferredNames(envVarNames, env)
  const aliasRecommendation = envAliasDiagnostics.find(diagnostic => diagnostic.recommendation)?.recommendation ?? null
  const status = resolveStatus(def, env, missingEnvVars)
  const configured = status === 'ready' || status === 'configured' || (configuredEnvVars.length > 0 && status !== 'disabled_by_operator')

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    status,
    configured,
    required: def.required,
    requiredEnvVars: unique(redactServerOnlyEnvNames([...def.requiredEnvVars, ...(def.alternativeEnvVarGroups ?? []).flat()])),
    optionalEnvVars: unique(redactServerOnlyEnvNames([...(def.optionalEnvVars ?? []), ...(def.disabledByEnvVar ? [def.disabledByEnvVar] : [])])),
    configuredEnvVars: unique(redactServerOnlyEnvNames(configuredEnvVars)),
    missingEnvVars: unique(redactServerOnlyEnvNames(missingEnvVars)),
    preferredEnvName: envAliasDiagnostics[0]?.preferredEnvName ?? null,
    aliasDetected: envAliasDiagnostics.some(diagnostic => diagnostic.aliasDetected),
    aliasRecommendation,
    envAliasDiagnostics,
    lastCheckResult: def.lastCheckResult,
    missingDependency: missingEnvVars.length > 0
      ? `Missing ${missingEnvVars.map(redactServerOnlyEnvName).join(' or ')}`
      : def.missingDependency ?? null,
    affectedFeatures: def.affectedFeatures,
    recommendedNextAction: aliasRecommendation
      ?? (status === 'ready' || status === 'configured'
        ? 'No setup action required; use existing diagnostics for live checks.'
        : def.recommendedNextAction),
    powers: def.powers,
    setupLocation: def.setupLocation,
  }
}

export function evaluateAllProviderConfigs(env: NodeJS.ProcessEnv = process.env): ProviderConfigStatus[] {
  return PROVIDER_CONFIG_REGISTRY.map(def => evaluateProviderConfig(def, env))
}

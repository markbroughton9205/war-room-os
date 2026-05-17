export type EnvAliasKey =
  | 'weatherApiKey'
  | 'weatherProvider'
  | 'weatherGovContact'
  | 'financeApiKey'
  | 'financeProvider'
  | 'newsApiKey'
  | 'guardianApiKey'
  | 'newsRssFeeds'
  | 'horoscopeApiKey'
  | 'astrologyProvider'

export type EnvAliasDiagnostic = {
  preferredEnvName: string
  detectedEnvName: string | null
  aliasDetected: boolean
  configured: boolean
  recommendation: string | null
}

type EnvAliasDefinition = {
  key: EnvAliasKey
  preferredName: string
  aliases: string[]
}

const ENV_ALIAS_DEFINITIONS: EnvAliasDefinition[] = [
  {
    key: 'weatherApiKey',
    preferredName: 'WEATHER_API_KEY',
    aliases: ['WEATHER_API_KEY', 'Weather_API_Key', 'weather_api_key'],
  },
  {
    key: 'weatherProvider',
    preferredName: 'WEATHER_PROVIDER',
    aliases: ['WEATHER_PROVIDER'],
  },
  {
    key: 'weatherGovContact',
    preferredName: 'WEATHER_GOV_CONTACT',
    aliases: ['WEATHER_GOV_CONTACT', 'NWS_CONTACT', 'WEATHER_CONTACT'],
  },
  {
    key: 'financeApiKey',
    preferredName: 'FINANCE_API_KEY',
    aliases: ['FINANCE_API_KEY', 'FINNHUB_API_KEY', 'Finnhub_API_Key', 'finance_api_key'],
  },
  {
    key: 'financeProvider',
    preferredName: 'FINANCE_PROVIDER',
    aliases: ['FINANCE_PROVIDER'],
  },
  {
    key: 'newsApiKey',
    preferredName: 'NEWS_API_KEY',
    aliases: ['NEWS_API_KEY', 'News_API_Key', 'news_api_key'],
  },
  {
    key: 'guardianApiKey',
    preferredName: 'GUARDIAN_API_KEY',
    aliases: ['GUARDIAN_API_KEY', 'THE_GUARDIAN_API_KEY'],
  },
  {
    key: 'newsRssFeeds',
    preferredName: 'NEWS_RSS_FEEDS',
    aliases: ['NEWS_RSS_FEEDS', 'RSS_FEED_URLS'],
  },
  {
    key: 'horoscopeApiKey',
    preferredName: 'HOROSCOPE_API_KEY',
    aliases: ['HOROSCOPE_API_KEY', 'Horoscope_API_key', 'Horoscope_API_Key', 'ASTROLOGY_API_KEY'],
  },
  {
    key: 'astrologyProvider',
    preferredName: 'ASTROLOGY_PROVIDER',
    aliases: ['ASTROLOGY_PROVIDER'],
  },
]

function trimmedEnvValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim()
  return value ? value : null
}

function definitionForKey(key: EnvAliasKey): EnvAliasDefinition {
  return ENV_ALIAS_DEFINITIONS.find(definition => definition.key === key) ?? ENV_ALIAS_DEFINITIONS[0]
}

function definitionForPreferredName(name: string): EnvAliasDefinition | null {
  return ENV_ALIAS_DEFINITIONS.find(definition => definition.preferredName === name) ?? null
}

function detectedEnvName(definition: EnvAliasDefinition, env: NodeJS.ProcessEnv): string | null {
  return definition.aliases.find(name => Boolean(trimmedEnvValue(env, name))) ?? null
}

export function getEnvAliasNames(key: EnvAliasKey): string[] {
  return definitionForKey(key).aliases
}

export function getEnvAliasValue(key: EnvAliasKey, env: NodeJS.ProcessEnv = process.env): string | null {
  const definition = definitionForKey(key)
  const name = detectedEnvName(definition, env)
  return name ? trimmedEnvValue(env, name) : null
}

export function resolveEnvAlias(key: EnvAliasKey, env: NodeJS.ProcessEnv = process.env): EnvAliasDiagnostic {
  const definition = definitionForKey(key)
  const detectedName = detectedEnvName(definition, env)
  const aliasDetected = Boolean(detectedName && detectedName !== definition.preferredName)

  return {
    preferredEnvName: definition.preferredName,
    detectedEnvName: detectedName,
    aliasDetected,
    configured: Boolean(detectedName),
    recommendation: aliasDetected
      ? `Provider configured through alias. Recommended: rename to ${definition.preferredName}.`
      : null,
  }
}

export function resolveEnvAliasByPreferredName(name: string, env: NodeJS.ProcessEnv = process.env): EnvAliasDiagnostic | null {
  const definition = definitionForPreferredName(name)
  return definition ? resolveEnvAlias(definition.key, env) : null
}

export function envNameConfigured(env: NodeJS.ProcessEnv, name: string): boolean {
  const aliasDiagnostic = resolveEnvAliasByPreferredName(name, env)
  return aliasDiagnostic ? aliasDiagnostic.configured : Boolean(trimmedEnvValue(env, name))
}

export function configuredEnvName(env: NodeJS.ProcessEnv, name: string): string | null {
  const aliasDiagnostic = resolveEnvAliasByPreferredName(name, env)
  return aliasDiagnostic?.detectedEnvName ?? (trimmedEnvValue(env, name) ? name : null)
}

export function envAliasDiagnosticsForPreferredNames(names: string[], env: NodeJS.ProcessEnv = process.env): EnvAliasDiagnostic[] {
  return names.flatMap(name => {
    const diagnostic = resolveEnvAliasByPreferredName(name, env)
    return diagnostic ? [diagnostic] : []
  })
}

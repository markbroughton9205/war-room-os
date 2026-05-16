import type { IntelligenceClientMetadata } from '@/lib/intelligence/intelligencePacket'
import type { CommanderLocationState } from '@/lib/intelligence/environment/locationPolicy'
import { describeLocationMode } from '@/lib/intelligence/environment/locationPolicy'
import type { WeatherEnvironmentSnapshot } from '@/lib/intelligence/environment/weatherEnvironment'
import type { HoroscopeSnapshot } from '@/lib/intelligence/environment/horoscopeEnvironment'

export type EnvironmentContextFeed = {
  locationMode: string
  weather: WeatherEnvironmentSnapshot
  sourceHealthLabel: string
  latestLocalHeadline: string
  weakSignalCount: number
  horoscope?: HoroscopeSnapshot
}

export function buildEnvironmentContextFeed(args: {
  location: CommanderLocationState
  weather: WeatherEnvironmentSnapshot
  intelligence?: IntelligenceClientMetadata
  horoscope?: HoroscopeSnapshot
}): EnvironmentContextFeed {
  return {
    locationMode: describeLocationMode(args.location),
    weather: args.weather,
    sourceHealthLabel: args.intelligence?.retrieval
      ? `retrieval ${args.intelligence.retrieval.success ? 'ok' : 'gap'}`
      : 'retrieval idle',
    latestLocalHeadline: args.intelligence?.sourcesPreview || 'No source-backed headline loaded',
    weakSignalCount: args.intelligence?.local?.weakSignalCount ?? (args.intelligence?.weakSignalDetected ? 1 : 0),
    ...(args.horoscope ? { horoscope: args.horoscope } : {}),
  }
}

export function buildEnvironmentContextPromptBlock(feed: EnvironmentContextFeed): string {
  return [
    '### Commander environment context (do not force into answer)',
    `- locationMode: ${feed.locationMode}`,
    `- weather: ${feed.weather.status} · ${feed.weather.locationLabel} · ${feed.weather.condition} · freshness=${feed.weather.freshness}`,
    `- sourceHealth: ${feed.sourceHealthLabel}`,
    `- latestLocalHeadline: ${feed.latestLocalHeadline}`,
    `- weakSignals: ${feed.weakSignalCount}`,
    '- Use this context only when relevant to the decree. Do not mention horoscope unless asked.',
  ].join('\n')
}

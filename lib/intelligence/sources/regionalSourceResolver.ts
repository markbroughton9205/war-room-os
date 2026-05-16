import type { PersistentSourceNode } from '@/lib/intelligence/sources/persistentSourceNetwork'
import { getPersistentSourceNetwork } from '@/lib/intelligence/sources/persistentSourceNetwork'

export type RegionalResolution = {
  locality: 'akron' | 'northeast_ohio' | 'ohio' | 'us_national' | 'international' | 'unknown'
  localFirst: boolean
  sourceIds: string[]
}

export function resolveRegionalSources(decree: string): RegionalResolution {
  const text = decree.toLowerCase()
  const network = getPersistentSourceNetwork()
  const includes = (...ids: string[]) => ids.filter(id => network.some(source => source.source_id === id))

  if (/\bakron|summit\s+county\b/i.test(text)) {
    return {
      locality: 'akron',
      localFirst: true,
      sourceIds: includes('akron_beacon_journal', 'signal_akron', 'cleveland19', 'wkyc', 'wews', 'fox8_cleveland', 'local_public_alerts', 'local_community_feeds', 'x_twitter_discussions'),
    }
  }
  if (/\bcleveland|northeast\s+ohio|cuyahoga\b/i.test(text)) {
    return {
      locality: 'northeast_ohio',
      localFirst: true,
      sourceIds: includes('cleveland19', 'wkyc', 'wews', 'fox8_cleveland', 'local_public_alerts', 'local_community_feeds', 'x_twitter_discussions'),
    }
  }
  if (/\bohio\b/i.test(text)) {
    return {
      locality: 'ohio',
      localFirst: true,
      sourceIds: includes('cleveland19', 'wkyc', 'wews', 'fox8_cleveland', 'ap', 'local_public_alerts'),
    }
  }
  if (/\bworld|international|global|ukraine|gaza|israel|china|russia|europe|asia|africa|middle\s+east\b/i.test(text)) {
    return {
      locality: 'international',
      localFirst: false,
      sourceIds: includes('reuters_world', 'bbc', 'al_jazeera', 'dw', 'france24', 'nhk', 'scmp', 'rt'),
    }
  }
  return {
    locality: /\bus|america|national|congress|white\s+house|economy|market|stocks?\b/i.test(text) ? 'us_national' : 'unknown',
    localFirst: false,
    sourceIds: includes('ap', 'reuters', 'npr', 'pbs', 'cnn', 'fox_news', 'nbc', 'abc', 'bloomberg', 'wsj', 'politico'),
  }
}

export function sourcesForRegionalResolution(resolution: RegionalResolution): PersistentSourceNode[] {
  const network = getPersistentSourceNetwork()
  const byId = new Map(network.map(source => [source.source_id, source]))
  return resolution.sourceIds.map(id => byId.get(id)).filter((source): source is PersistentSourceNode => Boolean(source))
}

import 'server-only'

import type { SignalRawItem, SignalSourceDefinition } from '../model'
import { classifyFreshness, maxAgeDaysForProvider, withFreshnessMetadata } from '../freshness'
import { isAllowedCloudUrl } from '../sources'
import type { ParsedRssItem } from './parser'
import { rssContentHash } from './dedupe'

function compact(value: string, limit = 900): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}...` : clean
}

export type NormalizedRssItem = SignalRawItem & {
  dedupeHash: string
  persistable: boolean
}

export function normalizeRssItem(
  item: ParsedRssItem,
  source: SignalSourceDefinition,
  signalIngestedAt: string,
): NormalizedRssItem | null {
  const url = item.link.trim()
  const title = item.title.trim()
  if (!title || !isAllowedCloudUrl(url)) return null

  const maxAgeDays = maxAgeDaysForProvider('rss')
  const freshness = classifyFreshness(item.pubDate, { maxAgeDays, provider: 'rss' })
  const dedupeHash = rssContentHash({ url, guid: item.guid, title })

  return {
    provider: 'rss',
    sourceId: source.id,
    sourceLabel: source.label,
    sourceKind: 'rss',
    title,
    url,
    summary: compact(item.description ?? title, 900),
    categories: source.categories,
    rawScore: source.reliabilityScore,
    capturedAt: signalIngestedAt,
    metadata: withFreshnessMetadata({
      feedUrl: source.url,
      rssGuid: item.guid,
      dedupeHash,
      ingestionChannel: 'rss_runtime',
    }, freshness, signalIngestedAt),
    dedupeHash,
    persistable: freshness.acceptedForLiveSignal || freshness.timeIntegrityStatus === 'TIME_INTEGRITY_WARNING',
  }
}

export function toSignalRawItem(item: NormalizedRssItem): SignalRawItem {
  return {
    provider: item.provider,
    sourceId: item.sourceId,
    sourceLabel: item.sourceLabel,
    sourceKind: item.sourceKind,
    title: item.title,
    url: item.url,
    summary: item.summary,
    categories: item.categories,
    rawScore: item.rawScore,
    capturedAt: item.capturedAt,
    metadata: item.metadata,
  }
}

export function normalizeRssFeedItems(
  items: ParsedRssItem[],
  source: SignalSourceDefinition,
  signalIngestedAt: string,
): NormalizedRssItem[] {
  return items.flatMap(item => {
    const normalized = normalizeRssItem(item, source, signalIngestedAt)
    return normalized ? [normalized] : []
  })
}

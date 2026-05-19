import 'server-only'

import { listPersistedSignalSnapshot, type SignalResult } from '@/lib/signals'

const RSS_GROUNDING_MAX_ITEMS = 8
const RSS_GROUNDING_MAX_CHARS = 2800

function formatRssItem(item: SignalResult): string {
  const truth =
    typeof item.metadata?.truthLabel === 'string'
      ? item.metadata.truthLabel
      : 'PROPOSED'
  return `- [${truth}] ${item.title.trim()} (${item.source}) — ${item.summary.trim().slice(0, 220)}`
}

/**
 * Cached RSS signal snapshot for Grok when live research / intelligence packet is unavailable.
 * Returns null when no RSS rows exist in persistence.
 */
export async function buildGrokRssIntelligenceAugment(): Promise<string | null> {
  const snapshot = await listPersistedSignalSnapshot(40)
  const rssItems = snapshot.results
    .filter(row => row.provider === 'rss' && row.summary.trim().length > 0)
    .slice(0, RSS_GROUNDING_MAX_ITEMS)

  if (!rssItems.length) return null

  const lines = rssItems.map(formatRssItem)
  let block = [
    '### RSS intelligence cache (persisted signals; not live web search)',
    `- snapshotAt: ${snapshot.generatedAt}`,
    `- itemCount: ${rssItems.length} (watchlist — label uncertainty; do not treat as verified operator truth)`,
    '',
    ...lines,
  ].join('\n')

  if (block.length > RSS_GROUNDING_MAX_CHARS) {
    block = `${block.slice(0, RSS_GROUNDING_MAX_CHARS).trim()}\n[… RSS cache truncated …]`
  }

  return block
}

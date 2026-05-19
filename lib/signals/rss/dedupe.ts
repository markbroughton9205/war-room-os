import 'server-only'

import { createHash } from 'node:crypto'

export type RssDedupeInput = {
  url: string
  guid?: string | null
  title: string
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function rssDedupeKey(input: RssDedupeInput): string {
  const guid = input.guid?.trim()
  if (guid) return `guid:${normalizeKey(guid)}`
  const url = input.url.trim()
  if (url) return `url:${normalizeKey(url)}`
  return `title:${normalizeKey(input.title)}`
}

export function rssContentHash(input: RssDedupeInput): string {
  return createHash('sha256').update(rssDedupeKey(input)).digest('hex').slice(0, 16)
}

export function dedupeRssInputs<T extends RssDedupeInput>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = rssDedupeKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

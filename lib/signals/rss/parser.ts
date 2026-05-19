import 'server-only'

export type ParsedRssItem = {
  title: string
  link: string
  guid: string | null
  pubDate: string | null
  description: string | null
}

const MAX_ITEMS_PER_FEED = 12
const MAX_XML_BYTES = 1_500_000

function cleanXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function textBetween(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? cleanXml(match[1]) : null
}

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
  return match?.[1] ?? null
}

function linkFromBlock(block: string): string | null {
  const inline = textBetween(block, 'link')
  if (inline && inline.startsWith('http')) return inline
  const linkTag = block.match(/<link\b[^>]*>/i)?.[0]
  if (!linkTag) return null
  return attr(linkTag, 'href')
}

function guidFromBlock(block: string): string | null {
  return textBetween(block, 'guid') ?? textBetween(block, 'id')
}

/** Reject XML that could enable external entity expansion (no DTD/ENTITY processing). */
export function assertSafeRssXml(xml: string): void {
  if (xml.length > MAX_XML_BYTES) {
    throw new Error('RSS XML exceeds bounded size limit')
  }
  if (/<!ENTITY/i.test(xml)) {
    throw new Error('RSS XML rejected: ENTITY declarations are not allowed')
  }
  if (/<!DOCTYPE[^>]*\[/i.test(xml)) {
    throw new Error('RSS XML rejected: inline DTD subsets are not allowed')
  }
}

/**
 * Parse RSS 2.0 / Atom item blocks without a full XML parser (no XXE surface).
 */
export function parseRssXml(xml: string): ParsedRssItem[] {
  assertSafeRssXml(xml)
  const itemBlocks = Array.from(xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)).map(match => match[0])
  return itemBlocks.slice(0, MAX_ITEMS_PER_FEED).flatMap((block): ParsedRssItem[] => {
    const title = textBetween(block, 'title')
    const link = linkFromBlock(block)
    if (!title || !link) return []
    const description =
      textBetween(block, 'description')
      ?? textBetween(block, 'summary')
      ?? textBetween(block, 'content')
      ?? title
    const pubDate =
      textBetween(block, 'pubDate')
      ?? textBetween(block, 'published')
      ?? textBetween(block, 'updated')
      ?? textBetween(block, 'dc:date')
    return [{
      title,
      link,
      guid: guidFromBlock(block),
      pubDate,
      description,
    }]
  })
}

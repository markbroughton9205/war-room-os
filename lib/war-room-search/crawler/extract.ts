import type { ExtractedPage } from './types'

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, body: string) => {
    if (body[0] === '#') {
      const hex = body[1]?.toLowerCase() === 'x'
      const n = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(n) || n <= 0) return full
      try {
        return String.fromCodePoint(n)
      } catch {
        return full
      }
    }
    return ENTITY[body.toLowerCase()] ?? full
  })
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value ? decodeEntities(value.trim()) : null
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  return match?.[1] ? decodeEntities(match[1].trim()) : null
}

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, ' ')
}

function stripBlocks(html: string, tag: string): string {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
}

function innerByTag(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html)
  return match?.[1] ?? null
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
}

function collapseText(text: string): string {
  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function parseIsoDate(raw: string | null): string | null {
  if (!raw?.trim()) return null
  const value = Date.parse(raw.trim())
  if (!Number.isFinite(value)) return null
  return new Date(value).toISOString()
}

function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
      'i',
    )
    const tag = html.match(pattern)?.[0]
    if (tag) {
      const content = attr(tag, 'content')
      if (content) return content
    }
    const patternRev = new RegExp(
      `<meta\\b[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`,
      'i',
    )
    const rev = patternRev.exec(html)
    if (rev?.[1]) return decodeEntities(rev[1].trim())
  }
  return null
}

/**
 * Conservative HTML extraction. Missing metadata stays null — never invented.
 */
export function extractHtml(html: string): ExtractedPage {
  const cleaned = stripComments(html)
  const title = firstMatch(cleaned, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const htmlTag = cleaned.match(/<html\b[^>]*>/i)?.[0] ?? ''
  const language = attr(htmlTag, 'lang')
  let canonicalDeclared: string | null = null
  const linkTags = cleaned.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of linkTags) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/)
    if (rel.includes('canonical')) {
      canonicalDeclared = attr(tag, 'href')
      break
    }
  }
  const description = metaContent(cleaned, ['description', 'og:description'])
  const publishedAt = parseIsoDate(
    metaContent(cleaned, ['article:published_time', 'og:article:published_time', 'datePublished', 'pubdate'])
    ?? firstMatch(cleaned, /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i),
  )
  const author = metaContent(cleaned, ['author'])

  let bodySource = innerByTag(cleaned, 'article') ?? innerByTag(cleaned, 'main') ?? innerByTag(cleaned, 'body') ?? cleaned
  bodySource = stripBlocks(bodySource, 'script')
  bodySource = stripBlocks(bodySource, 'style')
  bodySource = stripBlocks(bodySource, 'noscript')
  bodySource = stripBlocks(bodySource, 'svg')
  bodySource = stripBlocks(bodySource, 'iframe')
  const text = collapseText(stripTags(bodySource))

  return {
    title: title ? collapseText(stripTags(title)) || null : null,
    description: description ? collapseText(description) || null : null,
    text,
    canonicalDeclared,
    language: language ? language.slice(0, 32) : null,
    publishedAt,
    author: author ? collapseText(author) || null : null,
  }
}

export function extractPlainText(text: string): ExtractedPage {
  const collapsed = collapseText(text)
  const firstLine = collapsed.split('\n').map(line => line.trim()).find(Boolean) ?? null
  return {
    title: firstLine ? firstLine.slice(0, 180) : null,
    description: null,
    text: collapsed,
    canonicalDeclared: null,
    language: null,
    publishedAt: null,
    author: null,
  }
}

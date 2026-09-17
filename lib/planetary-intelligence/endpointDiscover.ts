import { canonicalizeUrl } from '@/lib/intelligence/canonicalUrl'
import { parseRssOrAtomOrSitemap } from './sourceFabric'
import type { EndpointType } from './types'
import type { EndpointActivationState } from './registryTypes'

export type DiscoveredFeed = {
  url: string
  endpointType: EndpointType
}

export function resolveAgainstBase(href: string, baseUrl: string): string | null {
  try {
    return canonicalizeUrl(new URL(href, baseUrl).toString()) || new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

export function discoverFeedsFromHtml(html: string, baseUrl: string): DiscoveredFeed[] {
  const out: DiscoveredFeed[] = []
  const seen = new Set<string>()
  const tags = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    const type = /type=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const url = resolveAgainstBase(href, baseUrl)
    if (!url || seen.has(url)) continue
    let endpointType: EndpointType | null = null
    if (rel.includes('alternate') && /rss|xml/.test(type) && !type.includes('atom')) endpointType = 'RSS'
    else if (rel.includes('alternate') && type.includes('atom')) endpointType = 'ATOM'
    else if (type.includes('sitemap') || /sitemap/i.test(href)) endpointType = /news/i.test(href) ? 'NEWS_SITEMAP' : 'SITEMAP'
    if (!endpointType) continue
    seen.add(url)
    out.push({ url, endpointType })
  }
  return out
}

export type ClassifiedItem = {
  url: string
  title: string
  publishedAt: string | null
  summary?: string
  categories?: string[]
}

export function classifyFetchedBody(input: {
  url: string
  httpStatus: number | null
  contentType: string | null
  body: string
}): {
  activationState: EndpointActivationState
  endpointType: EndpointType
  live: boolean
  items: ClassifiedItem[]
  reason: string
} {
  if (input.httpStatus === 429 || input.httpStatus === 503) {
    return { activationState: 'RATE_LIMITED', endpointType: 'HTML', live: false, items: [], reason: `HTTP_${input.httpStatus}` }
  }
  if (input.httpStatus !== null && input.httpStatus >= 400) {
    return { activationState: input.httpStatus === 403 || input.httpStatus === 401 ? 'BLOCKED' : 'OFFLINE', endpointType: 'HTML', live: false, items: [], reason: `HTTP_${input.httpStatus}` }
  }
  if (input.httpStatus === null) {
    return { activationState: 'OFFLINE', endpointType: 'HTML', live: false, items: [], reason: 'NO_HTTP_STATUS' }
  }
  const type = (input.contentType || '').toLowerCase()
  const body = input.body.trim()
  const alertEndpoint = isAlertEndpoint(input.url, body)
  if (/geo\+json|application\/json/.test(type) || body.startsWith('{') || body.startsWith('[')) {
    const items = parseJsonFeed(body)
    return items.length
      ? { activationState: 'LIVE', endpointType: alertEndpoint ? 'PUBLIC_ALERT_FEED' : 'API', live: true, items, reason: `json:${items.length}` }
      : { activationState: 'INVALID', endpointType: 'API', live: false, items: [], reason: 'json_no_items' }
  }
  if (/<rss[\s>]|<rdf:RDF/i.test(body) || type.includes('rss')) {
    const items = parseRssOrAtomOrSitemap(body, alertEndpoint ? 'PUBLIC_ALERT_FEED' : 'RSS')
    return items.length
      ? { activationState: 'LIVE', endpointType: alertEndpoint ? 'PUBLIC_ALERT_FEED' : 'RSS', live: true, items, reason: `rss:${items.length}` }
      : { activationState: 'INVALID', endpointType: alertEndpoint ? 'PUBLIC_ALERT_FEED' : 'RSS', live: false, items: [], reason: 'rss_empty' }
  }
  if (/<alert[\s>]/i.test(body) && /<identifier>|<info>/i.test(body)) {
    const items = parseCapAlert(body)
    return items.length
      ? { activationState: 'LIVE', endpointType: 'PUBLIC_ALERT_FEED', live: true, items, reason: `cap:${items.length}` }
      : { activationState: 'INVALID', endpointType: 'PUBLIC_ALERT_FEED', live: false, items: [], reason: 'cap_empty' }
  }
  if (/<feed[\s>]/i.test(body) || type.includes('atom')) {
    const items = parseRssOrAtomOrSitemap(body, 'ATOM')
    return items.length
      ? { activationState: 'LIVE', endpointType: 'ATOM', live: true, items, reason: `atom:${items.length}` }
      : { activationState: 'INVALID', endpointType: 'ATOM', live: false, items: [], reason: 'atom_empty' }
  }
  if (/<urlset|<sitemapindex/i.test(body) || type.includes('sitemap')) {
    const news = /news/i.test(input.url)
    const items = parseRssOrAtomOrSitemap(body, news ? 'NEWS_SITEMAP' : 'SITEMAP')
    return items.length
      ? { activationState: 'LIVE', endpointType: news ? 'NEWS_SITEMAP' : 'SITEMAP', live: true, items, reason: `sitemap:${items.length}` }
      : { activationState: 'INVALID', endpointType: 'SITEMAP', live: false, items: [], reason: 'sitemap_empty' }
  }
  if (type.includes('html') || /<html[\s>]|<head[\s>]/i.test(body)) {
    const feeds = discoverFeedsFromHtml(body, input.url)
    return {
      activationState: feeds.length ? 'DISCOVERED' : 'HTML_ONLY',
      endpointType: 'HTML',
      live: false,
      items: feeds.map(feed => ({ url: feed.url, title: feed.endpointType, publishedAt: null })),
      reason: feeds.length ? `homepage_feeds:${feeds.length}` : 'homepage_200_not_live',
    }
  }
  return { activationState: 'NO_MACHINE_ENDPOINT', endpointType: 'HTML', live: false, items: [], reason: 'unrecognized_body' }
}

function isAlertEndpoint(url: string, body: string): boolean {
  return /warnings_|cap-sources|\/cap\/|cap-au|public_alert|alert-hub/i.test(`${url}\n${body.slice(0, 500)}`)
}

function parseCapAlert(body: string): ClassifiedItem[] {
  const identifier = /<identifier>([^<]+)<\/identifier>/i.exec(body)?.[1] || ''
  const headline = /<headline>([^<]+)<\/headline>/i.exec(body)?.[1] || /<event>([^<]+)<\/event>/i.exec(body)?.[1] || 'alert'
  const sent = /<sent>([^<]+)<\/sent>/i.exec(body)?.[1] || null
  const desc = /<description>([\s\S]*?)<\/description>/i.exec(body)?.[1] || ''
  if (!identifier && !headline) return []
  return [{ url: identifier || headline, title: headline, publishedAt: sent, summary: desc.replace(/<[^>]+>/g, ' ').trim().slice(0, 800) }]
}

function parseJsonFeed(body: string): ClassifiedItem[] {
  try {
    const parsed = JSON.parse(body) as {
      features?: Array<{ id?: string; properties?: { headline?: string; event?: string; sent?: string; id?: string; description?: string } }>
      items?: Array<{ url?: string; link?: string; title?: string; date_published?: string; summary?: string }>
      feed?: Array<{ title?: string; link?: string; url?: string; published?: string; date?: string; summary?: string; tag?: string }>
    }
    if (Array.isArray(parsed.features)) {
      return parsed.features.slice(0, 20).map(feature => ({
        url: feature.id || feature.properties?.id || '',
        title: feature.properties?.headline || feature.properties?.event || 'alert',
        publishedAt: feature.properties?.sent ?? null,
        summary: feature.properties?.description,
      })).filter(item => item.url)
    }
    if (Array.isArray(parsed.feed)) {
      return parsed.feed.slice(0, 20).map(item => ({
        url: item.url || item.link || '',
        title: item.title || '',
        publishedAt: item.published || item.date || null,
        summary: item.summary,
        categories: item.tag ? [item.tag] : undefined,
      })).filter(item => item.url || item.title)
    }
    if (Array.isArray(parsed.items)) {
      return parsed.items.slice(0, 20).map(item => ({
        url: item.url || item.link || '',
        title: item.title || '',
        publishedAt: item.date_published ?? null,
        summary: item.summary,
      })).filter(item => item.url)
    }
  } catch {
    return []
  }
  return []
}

export function homepage200IsNotLiveContent(classification: ReturnType<typeof classifyFetchedBody>): boolean {
  return classification.activationState !== 'LIVE'
}

export function decodeFetchedBytes(bytes: Uint8Array, contentType: string | null): string {
  const head = Buffer.from(bytes.subarray(0, 180)).toString('latin1')
  const declared = /charset=([^\s;"]+)/i.exec(contentType || '')?.[1]
    || /encoding=["']([^"']+)["']/i.exec(head)?.[1]
    || 'utf-8'
  const label = declared.trim().toLowerCase()
    .replace(/utf-8/i, 'utf-8')
    .replace(/shift[-_]?jis|windows-31j|csshiftjis/i, 'shift_jis')
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export function extractLawfulExcerpt(html: string): string {
  const og = /property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
    || /content=["']([^"']+)["'][^>]*property=["']og:description["']/i.exec(html)?.[1]
    || /name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1]
    || ''
  const cleaned = og.replace(/\s+/g, ' ').trim()
  if (cleaned) return cleaned.slice(0, 400)
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.slice(0, 400)
}

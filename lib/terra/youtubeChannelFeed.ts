/**
 * Lawful YouTube channel Atom adapter.
 * Consumes https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID} only.
 * Extracts source-provided yt:videoId / title / published / author / canonical URL.
 * Does not scrape YouTube HTML. Does not use the YouTube Data API.
 *
 * Stable request profile (independently confirmed against WKYC Atom):
 *   User-Agent: WarRoomTerraLiveIntel/1.0
 *   Accept: application/atom+xml, application/xml, text/xml, and star-slash-star
 * One identity. No rotating browser fingerprints.
 */
import { extractYoutubeVideoIdFromUrl, validateYoutubeChannelId, validateYoutubeVideoId } from './liveIntelMedia'
import type { VerifiedVideoSource } from './verifiedVideoSources'
import { youtubeChannelAtomFeedUrl } from './verifiedVideoSources'
import {
  YOUTUBE_ATOM_HEADERS,
  classifyYoutubeAtomBody,
  classifyYoutubeFetchError,
  classifyYoutubeHttpStatus,
  type YoutubeFeedStatus,
  type YoutubeIngestTransport,
} from './videoFeedResilience'

export type YoutubeChannelFeedEntry = {
  videoId: string
  title: string
  publishedAt: string | null
  channelName: string
  channelId: string
  canonicalUrl: string
  summary: string | null
  thumbnailUrl?: string | null
}

export type YoutubeChannelFeedResult = {
  ok: boolean
  status: YoutubeFeedStatus
  sourceId: string
  channelId: string
  channelName: string
  feedUrl: string
  entries: YoutubeChannelFeedEntry[]
  httpStatus?: number | null
  retrievedAt?: string
  error?: string
  transport?: YoutubeIngestTransport
  uploadsPlaylistId?: string | null
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function xmlField(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)
  return match ? decodeXmlText(match[1] ?? '') : ''
}

function xmlAttr(block: string, tag: string, attr: string): string {
  const match = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`, 'i').exec(block)
  return match?.[1]?.trim() ?? ''
}

function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

function emptyResult(source: VerifiedVideoSource, feedUrl: string, status: YoutubeFeedStatus, error: string, httpStatus?: number | null): YoutubeChannelFeedResult {
  return {
    ok: false,
    status,
    sourceId: source.id,
    channelId: source.channelId,
    channelName: source.officialName,
    feedUrl,
    entries: [],
    httpStatus: httpStatus ?? null,
    error,
    transport: 'YOUTUBE_ATOM',
  }
}

/**
 * Parse a YouTube channel Atom document. Video IDs come from <yt:videoId> or an official
 * YouTube URL on the entry. Unrelated URLs in descriptions are ignored.
 */
export function parseYoutubeChannelAtomFeed(xml: string, expectedChannelId: string): YoutubeChannelFeedEntry[] {
  const expected = validateYoutubeChannelId(expectedChannelId)
  if (!expected) return []
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? []
  const seen = new Set<string>()
  return entries.flatMap(block => {
    const videoId = validateYoutubeVideoId(xmlField(block, 'yt:videoId'))
      ?? extractYoutubeVideoIdFromUrl(xmlAttr(block, 'link', 'href'))
      ?? extractYoutubeVideoIdFromUrl(xmlField(block, 'link'))
    if (!videoId || seen.has(videoId)) return []
    const rawChannel = xmlField(block, 'yt:channelId')
    if (rawChannel) {
      const entryChannel = validateYoutubeChannelId(rawChannel)
      if (!entryChannel || entryChannel !== expected) return []
    }
    const title = xmlField(block, 'title') || xmlField(block, 'media:title')
    if (!title) return []
    const publishedRaw = xmlField(block, 'published')
    const publishedMs = publishedRaw ? Date.parse(publishedRaw) : NaN
    seen.add(videoId)
    return [{
      videoId,
      title,
      publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
      channelName: xmlField(block, 'name') || expected,
      channelId: expected,
      canonicalUrl: canonicalWatchUrl(videoId),
      summary: xmlField(block, 'media:description') || null,
    }]
  })
}

export async function fetchYoutubeChannelAtomFeed(source: VerifiedVideoSource, timeoutMs = 10_000): Promise<YoutubeChannelFeedResult> {
  const channelId = validateYoutubeChannelId(source.channelId)
  const feedUrl = channelId ? youtubeChannelAtomFeedUrl(channelId) : ''
  if (!channelId || !source.enabled) {
    return emptyResult(source, feedUrl, 'PARSE_ERROR', 'Source disabled or channel ID invalid.')
  }
  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...YOUTUBE_ATOM_HEADERS },
    })
    if (!response.ok) {
      const status = classifyYoutubeHttpStatus(response.status)
      return emptyResult(source, feedUrl, status, `HTTP ${response.status}`, response.status)
    }
    const xml = await response.text()
    const entries = parseYoutubeChannelAtomFeed(xml, channelId).slice(0, source.maxItems ?? 6)
    const status = classifyYoutubeAtomBody(xml, entries.length)
    if (status !== 'SUCCESS') {
      return emptyResult(
        source,
        feedUrl,
        status,
        status === 'EMPTY_FEED' ? 'Atom feed returned no source-derived video IDs.' : 'Atom body was not a parseable YouTube channel feed.',
        response.status,
      )
    }
    return {
      ok: true,
      status: 'SUCCESS',
      sourceId: source.id,
      channelId,
      channelName: source.officialName,
      feedUrl,
      entries,
      httpStatus: response.status,
      retrievedAt: new Date().toISOString(),
      transport: 'YOUTUBE_ATOM',
    }
  } catch (error) {
    const status = classifyYoutubeFetchError(error)
    return emptyResult(
      source,
      feedUrl,
      status,
      error instanceof Error ? error.message : String(error),
    )
  }
}

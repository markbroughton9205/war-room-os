/**
 * Verified YouTube Atom feed resilience.
 *
 * Lawful channel Atom only. No HTML scrape, no YouTube search, no yt-dlp,
 * no guessed IDs, no invented fallback videos.
 *
 * Request profile (WKYC-confirmed): User-Agent WarRoomTerraLiveIntel/1.0
 * with Accept application/atom+xml, application/xml, text/xml, and star-slash-star.
 * One stable server-side identity — no rotating browser fingerprints.
 */
import { validateYoutubeChannelId, validateYoutubeVideoId } from './liveIntelMedia'

export const YOUTUBE_FEED_STATUSES = [
  'SUCCESS',
  'HTTP_400',
  'HTTP_403',
  'HTTP_404',
  'HTTP_429',
  'HTTP_5XX',
  'TIMEOUT',
  'PARSE_ERROR',
  'EMPTY_FEED',
] as const
export type YoutubeFeedStatus = (typeof YOUTUBE_FEED_STATUSES)[number]

export const YOUTUBE_INGEST_TRANSPORTS = [
  'YOUTUBE_DATA_API',
  'YOUTUBE_ATOM',
  'LAST_KNOWN_GOOD',
] as const
export type YoutubeIngestTransport = (typeof YOUTUBE_INGEST_TRANSPORTS)[number]

export const VERIFIED_VIDEO_PROVIDER_HEALTH = [
  'LIVE',
  'CACHED',
  'STALE_LAST_GOOD',
  'EMPTY',
  'RATE_LIMITED',
  'ERROR_UPSTREAM',
  'UNAVAILABLE',
] as const
export type VerifiedVideoProviderHealth = (typeof VERIFIED_VIDEO_PROVIDER_HEALTH)[number]

/** Success-only feed cache. Failures never use this TTL. */
export const VERIFIED_VIDEO_SUCCESS_TTL_MS = 10 * 60 * 1000
/** Bounded short backoff after a classified failure. */
export const VERIFIED_VIDEO_FAILURE_BACKOFF_MS = 60 * 1000
/** Retain a prior successful snapshot only inside this window. */
export const VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS = 30 * 60 * 1000

export const YOUTUBE_ATOM_USER_AGENT = 'WarRoomTerraLiveIntel/1.0'
export const YOUTUBE_ATOM_ACCEPT = 'application/atom+xml,application/xml,text/xml,*/*'
export const YOUTUBE_ATOM_HEADERS = {
  'user-agent': YOUTUBE_ATOM_USER_AGENT,
  accept: YOUTUBE_ATOM_ACCEPT,
} as const

export const YOUTUBE_FEED_CACHE_VERSION = 'v3'

export function youtubeFeedSuccessCacheKey(channelId: string): string {
  return `terra-live-intel:yt-channel:${YOUTUBE_FEED_CACHE_VERSION}:${channelId}`
}

export function youtubeFeedFailureCacheKey(channelId: string): string {
  return `terra-live-intel:yt-channel:fail:${YOUTUBE_FEED_CACHE_VERSION}:${channelId}`
}

export function youtubeFeedLastGoodCacheKey(channelId: string): string {
  return `terra-live-intel:yt-channel:last-good:${YOUTUBE_FEED_CACHE_VERSION}:${channelId}`
}

export function youtubeDataApiUploadsCacheKey(channelId: string): string {
  return `terra-live-intel:yt-data:uploads:v1:${channelId}`
}

export type VerifiedVideoLastKnownGood = {
  retrievedAt: string
  channelId: string
  feedUrl: string
  officialName: string
  entries: {
    videoId: string
    title: string
    publishedAt: string | null
    channelName: string
    channelId: string
    canonicalUrl: string
    summary: string | null
    thumbnailUrl?: string | null
  }[]
}

export function classifyYoutubeHttpStatus(status: number): Exclude<YoutubeFeedStatus, 'SUCCESS' | 'TIMEOUT' | 'PARSE_ERROR' | 'EMPTY_FEED'> {
  if (status === 429) return 'HTTP_429'
  if (status === 403) return 'HTTP_403'
  if (status === 400) return 'HTTP_400'
  if (status >= 500 && status <= 599) return 'HTTP_5XX'
  return 'HTTP_404'
}

export function classifyYoutubeFetchError(error: unknown): 'TIMEOUT' | 'PARSE_ERROR' {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out|aborted/i.test(message)) {
    return 'TIMEOUT'
  }
  return 'PARSE_ERROR'
}

export function looksLikeAtomFeed(xml: string): boolean {
  return /<(?:\w+:)?feed[\s>]/i.test(xml)
}

export function classifyYoutubeAtomBody(xml: string, parsedCount: number): 'SUCCESS' | 'EMPTY_FEED' | 'PARSE_ERROR' {
  if (!xml.trim()) return 'PARSE_ERROR'
  if (!looksLikeAtomFeed(xml)) return 'PARSE_ERROR'
  if (parsedCount > 0) return 'SUCCESS'
  return 'EMPTY_FEED'
}

export function verifiedVideoHealthFromFailure(status: YoutubeFeedStatus): Exclude<VerifiedVideoProviderHealth, 'LIVE' | 'CACHED' | 'STALE_LAST_GOOD'> {
  if (status === 'HTTP_429') return 'RATE_LIMITED'
  if (status === 'EMPTY_FEED') return 'EMPTY'
  if (status === 'HTTP_400' || status === 'HTTP_403') return 'UNAVAILABLE'
  if (status === 'HTTP_5XX' || status === 'TIMEOUT' || status === 'PARSE_ERROR' || status === 'HTTP_404') return 'ERROR_UPSTREAM'
  return 'UNAVAILABLE'
}

export function resolveVerifiedVideoProviderHealth(input: {
  status: YoutubeFeedStatus
  fromSuccessCache: boolean
  lastKnownGood: boolean
  sourceEnabled: boolean
}): VerifiedVideoProviderHealth {
  if (!input.sourceEnabled) return 'UNAVAILABLE'
  if (input.status === 'SUCCESS') return input.fromSuccessCache ? 'CACHED' : 'LIVE'
  if (input.lastKnownGood) return 'STALE_LAST_GOOD'
  return verifiedVideoHealthFromFailure(input.status)
}

export function lastKnownGoodIsAdmissible(
  snapshot: VerifiedVideoLastKnownGood | null | undefined,
  nowMs: number,
  windowMs = VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS,
): snapshot is VerifiedVideoLastKnownGood {
  if (!snapshot?.entries.length) return false
  const channelId = validateYoutubeChannelId(snapshot.channelId)
  if (!channelId) return false
  const retrieved = Date.parse(snapshot.retrievedAt)
  if (!Number.isFinite(retrieved)) return false
  const age = nowMs - retrieved
  if (age < 0 || age > windowMs) return false
  return snapshot.entries.every(entry => (
    validateYoutubeVideoId(entry.videoId) === entry.videoId
    && Boolean(entry.title?.trim())
    && entry.channelId === channelId
    && entry.canonicalUrl === `https://www.youtube.com/watch?v=${entry.videoId}`
  ))
}

export function formatLastKnownGoodAge(retrievedAt: string, nowMs: number): string {
  const retrieved = Date.parse(retrievedAt)
  if (!Number.isFinite(retrieved)) return 'STALE LAST KNOWN GOOD'
  const minutes = Math.max(0, Math.round((nowMs - retrieved) / 60_000))
  if (minutes < 1) return 'STALE LAST KNOWN GOOD · <1 min'
  return `STALE LAST KNOWN GOOD · ${minutes} min`
}

export function verifiedVideoHealthLabel(health: VerifiedVideoProviderHealth): string {
  if (health === 'STALE_LAST_GOOD') return 'STALE LAST KNOWN GOOD'
  if (health === 'ERROR_UPSTREAM') return 'ERROR UPSTREAM'
  if (health === 'RATE_LIMITED') return 'RATE LIMITED'
  return health
}

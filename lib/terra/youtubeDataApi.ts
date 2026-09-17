/**
 * Official YouTube Data API v3 transport for verified Terra channels.
 *
 * Direct HTTPS to youtube.googleapis.com only. No googleapis SDK.
 * No search.list. No guessed UU playlist IDs. No HTML scrape. No yt-dlp.
 * The API key stays server-side and is never returned, logged, or serialized.
 */
import 'server-only'

import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import { isTerraOfficialHost } from '@/lib/research-engine/security/hostAllowlist'
import { redactSecretsFromText, redactUrlForLogging } from '@/lib/research-engine/security/redact'
import { lawfulYoutubeThumbnailUrl, validateYoutubeChannelId, validateYoutubeVideoId } from './liveIntelMedia'
import type { VerifiedVideoSource } from './verifiedVideoSources'
import {
  classifyYoutubeFetchError,
  classifyYoutubeHttpStatus,
  youtubeDataApiUploadsCacheKey,
  type YoutubeFeedStatus,
} from './videoFeedResilience'
import type { YoutubeChannelFeedEntry, YoutubeChannelFeedResult } from './youtubeChannelFeed'

export const YOUTUBE_DATA_API_HOST = 'youtube.googleapis.com'
export const YOUTUBE_DATA_API_CHANNEL_TTL_MS = 12 * 60 * 60 * 1000
export const YOUTUBE_DATA_API_MAX_RESULTS = 15
export const YOUTUBE_DATA_API_UNITS = {
  channelsList: 1,
  playlistItemsList: 1,
  searchList: 100,
} as const

export type YoutubeDataApiQuotaSnapshot = {
  channelsList: number
  playlistItemsList: number
  searchList: number
  estimatedUnits: number
}

type UploadsCache = {
  channelId: string
  channelTitle: string
  uploadsPlaylistId: string
  retrievedAt: string
}

type DataApiJson = {
  error?: { code?: number; message?: string }
  items?: unknown[]
}

const quota = {
  channelsList: 0,
  playlistItemsList: 0,
  searchList: 0,
}

export function youtubeApiKeyIsConfigured(): boolean {
  return Boolean(readYoutubeApiKey())
}

function readYoutubeApiKey(): string | null {
  const server = process.env.YOUTUBE_API_KEY?.trim() ?? ''
  if (server) return server
  return null
}

export function youtubeDataApiQuotaSnapshot(): YoutubeDataApiQuotaSnapshot {
  return {
    channelsList: quota.channelsList,
    playlistItemsList: quota.playlistItemsList,
    searchList: quota.searchList,
    estimatedUnits:
      quota.channelsList * YOUTUBE_DATA_API_UNITS.channelsList
      + quota.playlistItemsList * YOUTUBE_DATA_API_UNITS.playlistItemsList
      + quota.searchList * YOUTUBE_DATA_API_UNITS.searchList,
  }
}

export function __resetYoutubeDataApiQuotaForTests(): void {
  quota.channelsList = 0
  quota.playlistItemsList = 0
  quota.searchList = 0
}

export function validateUploadsPlaylistId(value: string | null | undefined): string | null {
  const id = value?.trim() ?? ''
  if (!id) return null
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return null
  return id
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pickThumbnail(snippet: Record<string, unknown> | null): string | null {
  const thumbs = asRecord(snippet?.thumbnails)
  if (!thumbs) return null
  for (const key of ['high', 'medium', 'default', 'standard', 'maxres']) {
    const url = lawfulYoutubeThumbnailUrl(asString(asRecord(thumbs[key])?.url))
    if (url) return url
  }
  return null
}

function emptyResult(
  source: VerifiedVideoSource,
  status: YoutubeFeedStatus,
  error: string,
  httpStatus?: number | null,
  uploadsPlaylistId?: string | null,
): YoutubeChannelFeedResult {
  return {
    ok: false,
    status,
    sourceId: source.id,
    channelId: source.channelId,
    channelName: source.officialName,
    feedUrl: 'https://youtube.googleapis.com/youtube/v3/channels',
    entries: [],
    httpStatus: httpStatus ?? null,
    error,
    transport: 'YOUTUBE_DATA_API',
    uploadsPlaylistId: uploadsPlaylistId ?? null,
  }
}

function assertDataApiUrl(url: URL): void {
  if (url.protocol !== 'https:') throw new Error('Blocked non-HTTPS YouTube Data API URL.')
  if (!isTerraOfficialHost('youtube_data_api', url.hostname)) {
    throw new Error(`Blocked host "${url.hostname}" for youtube_data_api.`)
  }
  if (url.pathname !== '/youtube/v3/channels' && url.pathname !== '/youtube/v3/playlistItems') {
    throw new Error(`Blocked YouTube Data API path ${url.pathname}.`)
  }
  if (url.pathname.includes('search') || url.searchParams.get('q')) {
    throw new Error('search.list is not used for verified channel ingest.')
  }
}

function publicDataApiUrl(path: '/youtube/v3/channels' | '/youtube/v3/playlistItems', params: Record<string, string>): string {
  const url = new URL(`https://${YOUTUBE_DATA_API_HOST}${path}`)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.toString()
}

async function youtubeDataApiGet(
  path: '/youtube/v3/channels' | '/youtube/v3/playlistItems',
  params: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: true; status: number; json: DataApiJson } | { ok: false; status: number | null; failure: YoutubeFeedStatus; error: string }> {
  const key = readYoutubeApiKey()
  if (!key) {
    return { ok: false, status: null, failure: 'HTTP_403', error: 'YOUTUBE_API_KEY is not configured.' }
  }
  const url = new URL(`https://${YOUTUBE_DATA_API_HOST}${path}`)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  url.searchParams.set('key', key)
  assertDataApiUrl(url)
  if (path === '/youtube/v3/channels') quota.channelsList += 1
  else quota.playlistItemsList += 1
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'user-agent': 'WarRoomTerraLiveIntel/1.0',
      },
    })
    const text = await response.text()
    let json: DataApiJson = {}
    try {
      json = text ? JSON.parse(text) as DataApiJson : {}
    } catch {
      return {
        ok: false,
        status: response.status,
        failure: 'PARSE_ERROR',
        error: `YouTube Data API returned a non-JSON body (HTTP ${response.status}).`,
      }
    }
    if (!response.ok) {
      const status = classifyYoutubeHttpStatus(response.status)
      const message = redactSecretsFromText(asString(json.error?.message) ?? `HTTP ${response.status}`)
      return { ok: false, status: response.status, failure: status, error: message }
    }
    return { ok: true, status: response.status, json }
  } catch (error) {
    const failure = classifyYoutubeFetchError(error)
    const message = redactSecretsFromText(redactUrlForLogging(error instanceof Error ? error.message : String(error)))
    return { ok: false, status: null, failure, error: message }
  }
}

export function parseYoutubeChannelsList(
  json: unknown,
  expectedChannelId: string,
): { channelId: string; channelTitle: string; uploadsPlaylistId: string } | { error: string } {
  const expected = validateYoutubeChannelId(expectedChannelId)
  if (!expected) return { error: 'Verified channel ID is invalid.' }
  const root = asRecord(json)
  const items = Array.isArray(root?.items) ? root.items : []
  if (!items.length) return { error: 'channels.list returned no items.' }
  const item = asRecord(items[0])
  const returnedId = validateYoutubeChannelId(asString(item?.id))
  if (!returnedId || returnedId !== expected) {
    return { error: 'channels.list channel id did not match the verified registry id.' }
  }
  const snippet = asRecord(item.snippet)
  const details = asRecord(item.contentDetails)
  const related = asRecord(details?.relatedPlaylists)
  const uploadsPlaylistId = validateUploadsPlaylistId(asString(related?.uploads))
  if (!uploadsPlaylistId) return { error: 'channels.list did not return contentDetails.relatedPlaylists.uploads.' }
  return {
    channelId: returnedId,
    channelTitle: asString(snippet?.title) || expected,
    uploadsPlaylistId,
  }
}

export function parseYoutubePlaylistItems(
  json: unknown,
  expectedChannelId: string,
  maxItems: number,
): YoutubeChannelFeedEntry[] {
  const expected = validateYoutubeChannelId(expectedChannelId)
  if (!expected) return []
  const root = asRecord(json)
  const items = Array.isArray(root?.items) ? root.items : []
  const seen = new Set<string>()
  const entries: YoutubeChannelFeedEntry[] = []
  for (const raw of items) {
    if (entries.length >= maxItems) break
    const item = asRecord(raw)
    const snippet = asRecord(item?.snippet)
    const content = asRecord(item?.contentDetails)
    const resource = asRecord(snippet?.resourceId)
    const videoId = validateYoutubeVideoId(asString(content?.videoId) ?? asString(resource?.videoId))
    if (!videoId || seen.has(videoId)) continue
    const rawChannel = asString(snippet?.channelId)
    if (rawChannel) {
      const entryChannel = validateYoutubeChannelId(rawChannel)
      if (!entryChannel || entryChannel !== expected) continue
    }
    const title = asString(snippet?.title)
    if (!title) continue
    const publishedRaw = asString(content?.videoPublishedAt) ?? asString(snippet?.publishedAt)
    const publishedMs = publishedRaw ? Date.parse(publishedRaw) : NaN
    seen.add(videoId)
    entries.push({
      videoId,
      title,
      publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
      channelName: asString(snippet?.channelTitle) || expected,
      channelId: expected,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      summary: asString(snippet?.description),
      thumbnailUrl: pickThumbnail(snippet),
    })
  }
  return entries
}

async function loadUploadsPlaylist(
  source: VerifiedVideoSource,
  channelId: string,
  timeoutMs: number,
): Promise<{ ok: true; cache: UploadsCache; fromCache: boolean } | { ok: false; result: YoutubeChannelFeedResult }> {
  const cacheKey = youtubeDataApiUploadsCacheKey(channelId)
  const cached = cacheGet<UploadsCache>(cacheKey)
  if (cached?.uploadsPlaylistId && cached.channelId === channelId) {
    return { ok: true, cache: cached, fromCache: true }
  }
  const response = await youtubeDataApiGet('/youtube/v3/channels', {
    part: 'contentDetails,snippet',
    id: channelId,
  }, timeoutMs)
  if (!response.ok) {
    return { ok: false, result: emptyResult(source, response.failure, response.error, response.status) }
  }
  const parsed = parseYoutubeChannelsList(response.json, channelId)
  if ('error' in parsed) {
    return { ok: false, result: emptyResult(source, 'PARSE_ERROR', parsed.error, response.status) }
  }
  const cache: UploadsCache = {
    channelId: parsed.channelId,
    channelTitle: parsed.channelTitle,
    uploadsPlaylistId: parsed.uploadsPlaylistId,
    retrievedAt: new Date().toISOString(),
  }
  cacheSet(cacheKey, cache, YOUTUBE_DATA_API_CHANNEL_TTL_MS)
  return { ok: true, cache, fromCache: false }
}

export async function fetchYoutubeDataApiChannelFeed(
  source: VerifiedVideoSource,
  timeoutMs = 10_000,
): Promise<YoutubeChannelFeedResult> {
  const channelId = validateYoutubeChannelId(source.channelId)
  if (!channelId || !source.enabled) {
    return emptyResult(source, 'PARSE_ERROR', 'Source disabled or channel ID invalid.')
  }
  if (!youtubeApiKeyIsConfigured()) {
    return emptyResult(source, 'HTTP_403', 'YOUTUBE_API_KEY is not configured.')
  }
  const uploads = await loadUploadsPlaylist(source, channelId, timeoutMs)
  if (!uploads.ok) return uploads.result
  const maxResults = Math.max(1, Math.min(source.maxItems ?? 6, YOUTUBE_DATA_API_MAX_RESULTS))
  const response = await youtubeDataApiGet('/youtube/v3/playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploads.cache.uploadsPlaylistId,
    maxResults: String(maxResults),
  }, timeoutMs)
  const feedUrl = publicDataApiUrl('/youtube/v3/playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploads.cache.uploadsPlaylistId,
    maxResults: String(maxResults),
  })
  if (!response.ok) {
    return {
      ...emptyResult(source, response.failure, response.error, response.status, uploads.cache.uploadsPlaylistId),
      feedUrl,
    }
  }
  const entries = parseYoutubePlaylistItems(response.json, channelId, maxResults)
  if (!entries.length) {
    return {
      ...emptyResult(source, 'EMPTY_FEED', 'playlistItems.list returned no source-derived video IDs.', response.status, uploads.cache.uploadsPlaylistId),
      feedUrl,
      channelName: uploads.cache.channelTitle,
    }
  }
  return {
    ok: true,
    status: 'SUCCESS',
    sourceId: source.id,
    channelId,
    channelName: uploads.cache.channelTitle || source.officialName,
    feedUrl,
    entries,
    httpStatus: response.status,
    retrievedAt: new Date().toISOString(),
    transport: 'YOUTUBE_DATA_API',
    uploadsPlaylistId: uploads.cache.uploadsPlaylistId,
  }
}

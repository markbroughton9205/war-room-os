import 'server-only'

import { cacheDelete, cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import { buildMediaPreviewFromSource } from './liveIntelMedia'
import type { TerraLiveIntelNewsSeed } from './liveIntelPanelModel'
import { enabledVerifiedVideoSources, videoSourceIsLocalEligible, youtubeChannelAtomFeedUrl, type VerifiedVideoSource } from './verifiedVideoSources'
import {
  VERIFIED_VIDEO_FAILURE_BACKOFF_MS,
  VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS,
  VERIFIED_VIDEO_SUCCESS_TTL_MS,
  lastKnownGoodIsAdmissible,
  resolveVerifiedVideoProviderHealth,
  youtubeFeedFailureCacheKey,
  youtubeFeedLastGoodCacheKey,
  youtubeFeedSuccessCacheKey,
  type VerifiedVideoLastKnownGood,
  type VerifiedVideoProviderHealth,
  type YoutubeFeedStatus,
  type YoutubeIngestTransport,
} from './videoFeedResilience'
import { fetchYoutubeChannelAtomFeed, type YoutubeChannelFeedResult } from './youtubeChannelFeed'
import { fetchYoutubeDataApiChannelFeed, youtubeApiKeyIsConfigured } from './youtubeDataApi'

export type VerifiedVideoFeedFetcher = (source: VerifiedVideoSource) => Promise<YoutubeChannelFeedResult>

export type VerifiedVideoIntelLoad = {
  seeds: TerraLiveIntelNewsSeed[]
  providers: {
    id: string
    displayName: string
    freshness: VerifiedVideoProviderHealth
    failureClass: YoutubeFeedStatus | null
    reason: string
    objectCount: number
    lastKnownGood: boolean
    transport: YoutubeIngestTransport | null
  }[]
}

type ChannelLoad = {
  feed: YoutubeChannelFeedResult
  fromCache: boolean
  lastKnownGood: boolean
  retrievedAt: string
  transport: YoutubeIngestTransport
}

function resolveTransport(feed: YoutubeChannelFeedResult, lastKnownGood: boolean): YoutubeIngestTransport {
  if (lastKnownGood) return 'LAST_KNOWN_GOOD'
  if (feed.transport === 'YOUTUBE_DATA_API' || feed.transport === 'YOUTUBE_ATOM' || feed.transport === 'LAST_KNOWN_GOOD') {
    return feed.transport
  }
  return 'YOUTUBE_ATOM'
}

function snapshotFromSuccess(source: VerifiedVideoSource, feed: YoutubeChannelFeedResult, retrievedAt: string): VerifiedVideoLastKnownGood {
  return {
    retrievedAt,
    channelId: source.channelId,
    feedUrl: feed.feedUrl,
    officialName: source.officialName,
    entries: feed.entries,
  }
}

function retainLastKnownGood(
  source: VerifiedVideoSource,
  failure: YoutubeChannelFeedResult,
  nowMs: number,
): ChannelLoad | null {
  const snapshot = cacheGet<VerifiedVideoLastKnownGood>(youtubeFeedLastGoodCacheKey(source.channelId))
  if (!lastKnownGoodIsAdmissible(snapshot, nowMs)) return null
  return {
    feed: {
      ...failure,
      entries: snapshot.entries,
      feedUrl: snapshot.feedUrl,
      retrievedAt: snapshot.retrievedAt,
      transport: 'LAST_KNOWN_GOOD',
    },
    fromCache: false,
    lastKnownGood: true,
    retrievedAt: snapshot.retrievedAt,
    transport: 'LAST_KNOWN_GOOD',
  }
}

export async function fetchVerifiedYoutubeChannelFeed(source: VerifiedVideoSource): Promise<YoutubeChannelFeedResult> {
  if (youtubeApiKeyIsConfigured()) {
    const api = await fetchYoutubeDataApiChannelFeed(source)
    if (api.ok && api.status === 'SUCCESS' && api.entries.length > 0) return api
    const atom = await fetchYoutubeChannelAtomFeed(source)
    if (atom.ok && atom.status === 'SUCCESS' && atom.entries.length > 0) return atom
    return api
  }
  return fetchYoutubeChannelAtomFeed(source)
}

async function loadChannelFeed(
  source: VerifiedVideoSource,
  nowMs: number,
  fetchFeed: VerifiedVideoFeedFetcher,
): Promise<ChannelLoad> {
  const successKey = youtubeFeedSuccessCacheKey(source.channelId)
  const failKey = youtubeFeedFailureCacheKey(source.channelId)
  const lastKey = youtubeFeedLastGoodCacheKey(source.channelId)

  const cachedSuccess = cacheGet<YoutubeChannelFeedResult>(successKey)
  if (cachedSuccess?.ok && cachedSuccess.status === 'SUCCESS' && cachedSuccess.entries.length > 0) {
    return {
      feed: cachedSuccess,
      fromCache: true,
      lastKnownGood: false,
      retrievedAt: cachedSuccess.retrievedAt ?? new Date(nowMs).toISOString(),
      transport: resolveTransport(cachedSuccess, false),
    }
  }

  const cachedFailure = cacheGet<YoutubeChannelFeedResult>(failKey)
  if (cachedFailure && cachedFailure.status !== 'SUCCESS') {
    return retainLastKnownGood(source, cachedFailure, nowMs) ?? {
      feed: cachedFailure,
      fromCache: false,
      lastKnownGood: false,
      retrievedAt: new Date(nowMs).toISOString(),
      transport: resolveTransport(cachedFailure, false),
    }
  }

  const feed = await fetchFeed(source)
  if (feed.ok && feed.status === 'SUCCESS' && feed.entries.length > 0) {
    const retrievedAt = new Date(nowMs).toISOString()
    const stored: YoutubeChannelFeedResult = { ...feed, retrievedAt }
    cacheSet(successKey, stored, VERIFIED_VIDEO_SUCCESS_TTL_MS)
    cacheSet(lastKey, snapshotFromSuccess(source, stored, retrievedAt), VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS)
    cacheDelete(failKey)
    return {
      feed: stored,
      fromCache: false,
      lastKnownGood: false,
      retrievedAt,
      transport: resolveTransport(stored, false),
    }
  }

  cacheSet(failKey, feed, VERIFIED_VIDEO_FAILURE_BACKOFF_MS)
  return retainLastKnownGood(source, feed, nowMs) ?? {
    feed,
    fromCache: false,
    lastKnownGood: false,
    retrievedAt: new Date(nowMs).toISOString(),
    transport: resolveTransport(feed, false),
  }
}

function seedFromFeed(
  source: VerifiedVideoSource,
  feed: YoutubeChannelFeedResult,
  fromCache: boolean,
  lastKnownGood: boolean,
  retrievedAt: string,
): TerraLiveIntelNewsSeed[] {
  const localEligible = videoSourceIsLocalEligible(source)
  const intelCategory = localEligible
    ? 'HEADLINES'
    : (source.categories.find(category => category !== 'LOCAL' && category !== 'BREAKING') ?? 'HEADLINES')
  const feedUrl = feed.transport === 'YOUTUBE_DATA_API'
    ? feed.feedUrl
    : youtubeChannelAtomFeedUrl(source.channelId)
  return feed.entries.map(entry => ({
    id: `yt:${source.id}:${entry.videoId}`,
    title: entry.title,
    summary: entry.summary,
    url: entry.canonicalUrl,
    sourceName: source.officialName,
    provider: source.provider,
    publishedAt: entry.publishedAt,
    retrievedAt,
    fromCache,
    lastKnownGood,
    contentType: 'official_youtube',
    geography: null,
    reliability: 'HIGH' as const,
    feedName: source.officialName,
    categories: source.categories,
    declaredLanguage: source.language ?? null,
    youtubeVideoId: entry.videoId,
    verifiedVideoSourceId: source.id,
    intelCategory,
    verificationState: 'REPORTED' as const,
    localSourceType: localEligible ? (source.localSourceType ?? 'TV') : null,
    localServiceArea: localEligible ? (source.geography?.serviceArea ?? null) : null,
    mediaPreview: buildMediaPreviewFromSource({
      sourceUrl: entry.canonicalUrl,
      youtubeVideoId: entry.videoId,
      provider: source.provider,
      retrievedAt,
      originalLanguage: source.language ?? null,
      accessClass: source.accessClass,
      officialChannelName: source.officialName,
      channelId: source.channelId,
      feedUrl,
      verificationSource: source.verificationSource,
      posterUrl: entry.thumbnailUrl ?? null,
    }),
  }))
}

function providerReason(source: VerifiedVideoSource, load: ChannelLoad): string {
  const transport = load.transport
  const statusNote = load.feed.httpStatus != null ? `${load.feed.status} HTTP ${load.feed.httpStatus}` : load.feed.status
  if (load.lastKnownGood) {
    return `transport=${transport}. ${statusNote}. Last-known-good retained within ${VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS / 60_000} min; never labeled LIVE.`
  }
  if (load.feed.ok) {
    return `transport=${transport}. Official ${transport === 'YOUTUBE_DATA_API' ? 'YouTube Data API v3 playlistItems' : `YouTube Atom feed ${youtubeChannelAtomFeedUrl(source.channelId)}`}.`
  }
  return `transport=${transport}. ${statusNote}. ${load.feed.error ?? 'Official YouTube ingest unavailable.'}`
}

export async function loadVerifiedVideoNewsSeeds(options?: {
  nowMs?: number
  fetchFeed?: VerifiedVideoFeedFetcher
  sources?: VerifiedVideoSource[]
}): Promise<VerifiedVideoIntelLoad> {
  const sources = options?.sources ?? enabledVerifiedVideoSources()
  const nowMs = options?.nowMs ?? Date.now()
  const fetchFeed = options?.fetchFeed ?? fetchVerifiedYoutubeChannelFeed
  if (!sources.length) {
    return { seeds: [], providers: [] }
  }
  const settled = await Promise.all(sources.map(source => loadChannelFeed(source, nowMs, fetchFeed)))
  const seeds: TerraLiveIntelNewsSeed[] = []
  const seenVideoIds = new Set<string>()
  const providers: VerifiedVideoIntelLoad['providers'] = []
  for (const [index, load] of settled.entries()) {
    const source = sources[index]!
    const freshness = resolveVerifiedVideoProviderHealth({
      status: load.feed.status,
      fromSuccessCache: load.fromCache,
      lastKnownGood: load.lastKnownGood,
      sourceEnabled: source.enabled,
    })
    const mapped = seedFromFeed(source, load.feed, load.fromCache, load.lastKnownGood, load.retrievedAt).filter(seed => {
      const id = seed.youtubeVideoId
      if (!id || seenVideoIds.has(id)) return false
      seenVideoIds.add(id)
      return true
    })
    seeds.push(...mapped)
    providers.push({
      id: source.provider,
      displayName: source.officialName,
      freshness,
      failureClass: load.feed.status === 'SUCCESS' && !load.lastKnownGood ? null : load.feed.status,
      reason: providerReason(source, load),
      objectCount: mapped.length,
      lastKnownGood: load.lastKnownGood,
      transport: load.transport,
    })
  }
  return { seeds, providers }
}

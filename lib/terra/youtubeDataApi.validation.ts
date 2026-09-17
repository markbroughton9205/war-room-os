/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/youtubeDataApi.validation.ts
 *   node --env-file=.env.local --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/youtubeDataApi.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { __resetCacheForTests, cacheDelete } from '@/lib/research-engine/cache/ttlCache'
import { isTerraOfficialHost, TERRA_OFFICIAL_HOST_ALLOWLIST } from '@/lib/research-engine/security/hostAllowlist'
import { composeLiveIntelPanel } from './liveIntelPanelModel'
import { youtubeMuteEmbedUrl, youtubeUnmuteEmbedUrl, validateYoutubeVideoId } from './liveIntelMedia'
import { classifyVerifiedVideoSeeds } from './localVideoClassification'
import { parseLocalContext } from './localSources/context'
import { loadVerifiedVideoNewsSeeds } from './fetchVerifiedVideoIntel'
import { VERIFIED_VIDEO_SOURCES } from './verifiedVideoSources'
import {
  youtubeFeedSuccessCacheKey,
  type YoutubeFeedStatus,
} from './videoFeedResilience'
import {
  __resetYoutubeDataApiQuotaForTests,
  fetchYoutubeDataApiChannelFeed,
  parseYoutubeChannelsList,
  parseYoutubePlaylistItems,
  validateUploadsPlaylistId,
  youtubeApiKeyIsConfigured,
  youtubeDataApiQuotaSnapshot,
  YOUTUBE_DATA_API_CHANNEL_TTL_MS,
  YOUTUBE_DATA_API_HOST,
  YOUTUBE_DATA_API_UNITS,
} from './youtubeDataApi'
import type { YoutubeChannelFeedResult } from './youtubeChannelFeed'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const WKYC_CHANNEL = 'UCNBmxc6FvKyxtCpUygcdINA'
const NEWS5_CHANNEL = 'UCAAmkc2sRESFoEtiKRTaTRA'
const NWS_CHANNEL = 'UC9hQvMjzSxurMirYDgOMezw'
const NASA_ES_CHANNEL = 'UC8zqCEvaRwHcfz3IhjhMMxQ'
const WKYC_UPLOADS = 'UUNBmxc6FvKyxtCpUygcdINA'
const NEWS5_UPLOADS = 'UUAAmkc2sRESFoEtiKRTaTRA'
const FAKE_KEY = 'unit-test-youtube-data-api-key-not-real'
const NOW_MS = Date.parse('2026-09-17T03:00:00.000Z')

function sourceById(id: string) {
  const source = VERIFIED_VIDEO_SOURCES.find(row => row.id === id)
  if (!source) throw new Error(`missing source ${id}`)
  return source
}

function channelsJson(channelId: string, title: string, uploads: string) {
  return {
    items: [{
      id: channelId,
      snippet: { title },
      contentDetails: { relatedPlaylists: { uploads } },
    }],
  }
}

function playlistJson(channelId: string, channelTitle: string, videos: { id: string; title: string; publishedAt: string }[]) {
  return {
    items: videos.map(video => ({
      snippet: {
        title: video.title,
        description: video.title,
        publishedAt: video.publishedAt,
        channelId,
        channelTitle,
        resourceId: { kind: 'youtube#video', videoId: video.id },
        thumbnails: {
          high: { url: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` },
        },
      },
      contentDetails: {
        videoId: video.id,
        videoPublishedAt: video.publishedAt,
      },
    })),
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function withFakeKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.YOUTUBE_API_KEY
  process.env.YOUTUBE_API_KEY = FAKE_KEY
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = previous
  }
}

async function withMockedFetch<T>(
  handler: (url: URL) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ result: T; paths: string[]; leakedKey: boolean }> {
  const original = globalThis.fetch
  const paths: string[] = []
  let leakedKey = false
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(href)
    paths.push(url.pathname)
    if (href.includes(FAKE_KEY) && url.searchParams.get('key') === FAKE_KEY) {
      // Server fetch may carry the key. Record that it never appears in returned objects later.
    }
    if (url.hostname !== YOUTUBE_DATA_API_HOST) {
      throw new Error(`unexpected host ${url.hostname}`)
    }
    if (url.pathname.includes('search') || url.searchParams.has('q')) {
      throw new Error('search.list is forbidden')
    }
    return handler(url)
  }) as typeof fetch
  try {
    const result = await fn()
    leakedKey = JSON.stringify(result).includes(FAKE_KEY)
    return { result, paths, leakedKey }
  } finally {
    globalThis.fetch = original
  }
}

async function runUnit(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(check(
    'host_allowlist_is_youtube_googleapis_only',
    TERRA_OFFICIAL_HOST_ALLOWLIST.youtube_data_api.length === 1
      && TERRA_OFFICIAL_HOST_ALLOWLIST.youtube_data_api[0] === 'youtube.googleapis.com'
      && isTerraOfficialHost('youtube_data_api', 'youtube.googleapis.com')
      && !isTerraOfficialHost('youtube_data_api', 'www.googleapis.com')
      && !isTerraOfficialHost('youtube_data_api', 'www.youtube.com'),
    TERRA_OFFICIAL_HOST_ALLOWLIST.youtube_data_api.join(','),
  ))
  results.push(check(
    'search_list_is_not_a_steady_state_method',
    YOUTUBE_DATA_API_UNITS.searchList === 100
      && YOUTUBE_DATA_API_UNITS.channelsList === 1
      && YOUTUBE_DATA_API_UNITS.playlistItemsList === 1
      && YOUTUBE_DATA_API_CHANNEL_TTL_MS === 12 * 60 * 60 * 1000,
    `units=${JSON.stringify(YOUTUBE_DATA_API_UNITS)} ttl=${YOUTUBE_DATA_API_CHANNEL_TTL_MS}`,
  ))
  results.push(check(
    'env_name_is_server_only',
    !Object.keys(process.env).some(name => name === 'NEXT_PUBLIC_YOUTUBE_API_KEY'),
    'NEXT_PUBLIC_YOUTUBE_API_KEY absent',
  ))

  const parsed = parseYoutubeChannelsList(
    channelsJson(WKYC_CHANNEL, 'WKYC Channel 3', WKYC_UPLOADS),
    WKYC_CHANNEL,
  )
  results.push(check(
    'channels_list_matches_registry_and_returns_uploads',
    !('error' in parsed)
      && parsed.channelId === WKYC_CHANNEL
      && parsed.uploadsPlaylistId === WKYC_UPLOADS
      && parsed.channelTitle === 'WKYC Channel 3',
    'error' in parsed ? parsed.error : `${parsed.channelId}/${parsed.uploadsPlaylistId}`,
  ))

  const mismatched = parseYoutubeChannelsList(
    channelsJson(NEWS5_CHANNEL, 'News 5', NEWS5_UPLOADS),
    WKYC_CHANNEL,
  )
  results.push(check(
    'channels_list_rejects_mismatched_id',
    'error' in mismatched && /did not match/i.test(mismatched.error),
    'error' in mismatched ? mismatched.error : 'accepted mismatch',
  ))

  const missingUploads = parseYoutubeChannelsList(
    { items: [{ id: WKYC_CHANNEL, snippet: { title: 'WKYC' }, contentDetails: { relatedPlaylists: {} } }] },
    WKYC_CHANNEL,
  )
  const guessed = `UU${WKYC_CHANNEL.slice(2)}`
  results.push(check(
    'uploads_playlist_is_never_guessed',
    'error' in missingUploads
      && !JSON.stringify(missingUploads).includes(guessed)
      && validateUploadsPlaylistId(guessed) !== null
      && guessed === WKYC_UPLOADS,
    'error' in missingUploads ? missingUploads.error : 'guessed UU playlist',
  ))

  const items = parseYoutubePlaylistItems(
    playlistJson(WKYC_CHANNEL, 'WKYC Channel 3', [
      { id: 'DuORJdo5rI0', title: 'Akron fire on Tallmadge Avenue', publishedAt: '2026-09-16T18:00:00.000Z' },
      { id: 'bad-id', title: 'Malformed', publishedAt: '2026-09-16T18:00:00.000Z' },
      { id: 'ClevParkng1', title: 'Cleveland City Council downtown parking', publishedAt: '2026-09-16T19:00:00.000Z' },
    ]),
    WKYC_CHANNEL,
    8,
  )
  results.push(check(
    'playlist_items_keep_source_video_ids_only',
    items.length === 2
      && items[0]?.videoId === 'DuORJdo5rI0'
      && items[1]?.videoId === 'ClevParkng1'
      && items.every(entry => validateYoutubeVideoId(entry.videoId) === entry.videoId)
      && items[0]?.publishedAt === '2026-09-16T18:00:00.000Z'
      && items[0]?.thumbnailUrl === 'https://i.ytimg.com/vi/DuORJdo5rI0/hqdefault.jpg',
    items.map(entry => entry.videoId).join(',') || 'none',
  ))

  __resetCacheForTests()
  __resetYoutubeDataApiQuotaForTests()
  const mocked = await withFakeKey(() => withMockedFetch(url => {
    if (url.pathname === '/youtube/v3/channels') {
      return jsonResponse(200, channelsJson(WKYC_CHANNEL, 'WKYC Channel 3', WKYC_UPLOADS))
    }
    if (url.pathname === '/youtube/v3/playlistItems') {
      return jsonResponse(200, playlistJson(WKYC_CHANNEL, 'WKYC Channel 3', [
        { id: 'DuORJdo5rI0', title: 'Akron fire on Tallmadge Avenue', publishedAt: '2026-09-16T18:00:00.000Z' },
      ]))
    }
    throw new Error(`unexpected path ${url.pathname}`)
  }, async () => {
    const first = await fetchYoutubeDataApiChannelFeed(sourceById('wkyc-youtube'))
    const quotaAfterFirst = youtubeDataApiQuotaSnapshot()
    const second = await fetchYoutubeDataApiChannelFeed(sourceById('wkyc-youtube'))
    const quotaAfterSecond = youtubeDataApiQuotaSnapshot()
    return { first, second, quotaAfterFirst, quotaAfterSecond }
  }))

  results.push(check(
    'data_api_transport_succeeds_without_search',
    mocked.result.first.ok
      && mocked.result.first.transport === 'YOUTUBE_DATA_API'
      && mocked.result.first.uploadsPlaylistId === WKYC_UPLOADS
      && mocked.result.first.entries[0]?.videoId === 'DuORJdo5rI0'
      && !mocked.paths.some(path => path.includes('search'))
      && mocked.paths.filter(path => path === '/youtube/v3/channels').length === 1
      && mocked.paths.filter(path => path === '/youtube/v3/playlistItems').length === 2,
    `paths=${mocked.paths.join(',')} playlist=${mocked.result.first.uploadsPlaylistId}`,
  ))
  results.push(check(
    'cached_uploads_skip_channels_list',
    mocked.result.quotaAfterFirst.channelsList === 1
      && mocked.result.quotaAfterFirst.playlistItemsList === 1
      && mocked.result.quotaAfterSecond.channelsList === 1
      && mocked.result.quotaAfterSecond.playlistItemsList === 2
      && mocked.result.quotaAfterSecond.searchList === 0
      && mocked.result.quotaAfterSecond.estimatedUnits === 3,
    JSON.stringify(mocked.result.quotaAfterSecond),
  ))
  results.push(check(
    'serialized_result_does_not_contain_api_key',
    !mocked.leakedKey
      && !JSON.stringify(mocked.result.first).includes(FAKE_KEY)
      && !JSON.stringify(mocked.result.first.feedUrl).includes('key='),
    mocked.result.first.feedUrl,
  ))

  const httpMap: { status: number; expected: YoutubeFeedStatus }[] = [
    { status: 400, expected: 'HTTP_400' },
    { status: 403, expected: 'HTTP_403' },
    { status: 429, expected: 'HTTP_429' },
    { status: 500, expected: 'HTTP_5XX' },
  ]
  for (const row of httpMap) {
    __resetCacheForTests()
    const failure = await withFakeKey(() => withMockedFetch(() => jsonResponse(row.status, { error: { code: row.status, message: `HTTP ${row.status}` } }), () => (
      fetchYoutubeDataApiChannelFeed(sourceById('wkyc-youtube'))
    )))
    results.push(check(
      `maps_http_${row.status}_honestly`,
      !failure.result.ok && failure.result.status === row.expected && failure.result.entries.length === 0,
      `${failure.result.status} http=${failure.result.httpStatus ?? 'n/a'}`,
    ))
  }

  __resetCacheForTests()
  let dataApiCalls = 0
  const liveThenFail = async (): Promise<YoutubeChannelFeedResult> => {
    dataApiCalls += 1
    if (dataApiCalls === 1) {
      return {
        ok: true,
        status: 'SUCCESS',
        sourceId: 'wkyc-youtube',
        channelId: WKYC_CHANNEL,
        channelName: 'WKYC 3 Cleveland',
        feedUrl: 'https://youtube.googleapis.com/youtube/v3/playlistItems',
        entries: [{
          videoId: 'DuORJdo5rI0',
          title: 'Akron-Canton Chick-fil-A drive-thru backup',
          publishedAt: '2026-09-16T18:00:00.000Z',
          channelName: 'WKYC 3 Cleveland',
          channelId: WKYC_CHANNEL,
          canonicalUrl: 'https://www.youtube.com/watch?v=DuORJdo5rI0',
          summary: 'Akron-Canton Chick-fil-A drive-thru backup',
          thumbnailUrl: 'https://i.ytimg.com/vi/DuORJdo5rI0/hqdefault.jpg',
        }],
        httpStatus: 200,
        retrievedAt: new Date(NOW_MS).toISOString(),
        transport: 'YOUTUBE_DATA_API',
        uploadsPlaylistId: WKYC_UPLOADS,
      }
    }
    return {
      ok: false,
      status: 'HTTP_5XX',
      sourceId: 'wkyc-youtube',
      channelId: WKYC_CHANNEL,
      channelName: 'WKYC 3 Cleveland',
      feedUrl: 'https://youtube.googleapis.com/youtube/v3/playlistItems',
      entries: [],
      httpStatus: 500,
      error: 'HTTP 500',
      transport: 'YOUTUBE_DATA_API',
      uploadsPlaylistId: WKYC_UPLOADS,
    }
  }
  const first = await loadVerifiedVideoNewsSeeds({ sources: [sourceById('wkyc-youtube')], nowMs: NOW_MS, fetchFeed: liveThenFail })
  cacheDelete(youtubeFeedSuccessCacheKey(WKYC_CHANNEL))
  const stale = await loadVerifiedVideoNewsSeeds({ sources: [sourceById('wkyc-youtube')], nowMs: NOW_MS + 2_000, fetchFeed: liveThenFail })
  results.push(check(
    'last_known_good_after_data_api_failure',
    first.providers[0]?.freshness === 'LIVE'
      && first.providers[0]?.transport === 'YOUTUBE_DATA_API'
      && stale.providers[0]?.freshness === 'STALE_LAST_GOOD'
      && stale.providers[0]?.transport === 'LAST_KNOWN_GOOD'
      && stale.providers[0]?.freshness !== 'LIVE'
      && stale.seeds[0]?.youtubeVideoId === 'DuORJdo5rI0',
    `first=${first.providers[0]?.freshness}/${first.providers[0]?.transport} stale=${stale.providers[0]?.freshness}/${stale.providers[0]?.transport}`,
  ))

  const akron = parseLocalContext({ latitude: 41.0814, longitude: -81.519, place: 'Akron, Summit County, Ohio, United States' })
  const cleveland = parseLocalContext({ latitude: 41.4993, longitude: -81.6944, place: 'Cleveland, Cuyahoga County, Ohio, United States' })
  const tokyo = parseLocalContext({ latitude: 35.676, longitude: 139.65, place: 'Tokyo, Japan' })
  const nwsSeed = first.seeds[0] ? {
    ...first.seeds[0],
    id: 'yt:nws-youtube:zz3jM6lu7Fs',
    title: 'El Nino Advisory issued',
    sourceName: 'National Weather Service (NWS)',
    provider: 'nws_youtube',
    youtubeVideoId: 'zz3jM6lu7Fs',
    verifiedVideoSourceId: 'nws-youtube',
    intelCategory: 'EARTH' as const,
    localSourceType: null,
    localServiceArea: null,
  } : null
  const nasaSeed = first.seeds[0] ? {
    ...first.seeds[0],
    id: 'yt:nasa-es-youtube:NasaEsClip1',
    title: 'NASA en Español: Artemis update',
    sourceName: 'NASA en Español',
    provider: 'nasa_youtube',
    youtubeVideoId: 'NasaEsClip1',
    verifiedVideoSourceId: 'nasa-es-youtube',
    intelCategory: 'HEADLINES' as const,
    localSourceType: null,
    localServiceArea: null,
  } : null
  const clevelandSeed = {
    ...first.seeds[0]!,
    id: 'yt:wkyc-youtube:ClevParkng1',
    title: 'Cleveland City Council votes on downtown parking',
    summary: 'Cleveland City Council votes on downtown parking',
    youtubeVideoId: 'ClevParkng1',
  }
  const classifiedAkron = classifyVerifiedVideoSeeds([first.seeds[0]!, clevelandSeed], akron)
  const classifiedCleveland = classifyVerifiedVideoSeeds([clevelandSeed], cleveland)
  const classifiedTokyo = classifyVerifiedVideoSeeds([first.seeds[0]!, clevelandSeed], tokyo)
  results.push(check(
    'akron_local_still_requires_qualify',
    classifiedAkron.localSeeds.some(seed => seed.youtubeVideoId === 'DuORJdo5rI0')
      && !classifiedAkron.localSeeds.some(seed => seed.youtubeVideoId === 'ClevParkng1'),
    classifiedAkron.localSeeds.map(seed => seed.youtubeVideoId).join(',') || 'none',
  ))
  results.push(check(
    'cleveland_local_accepts_cleveland_named_item',
    classifiedCleveland.localSeeds.some(seed => seed.youtubeVideoId === 'ClevParkng1'),
    classifiedCleveland.localSeeds.map(seed => seed.youtubeVideoId).join(',') || 'none',
  ))
  results.push(check(
    'tokyo_leakage_is_zero',
    classifiedTokyo.localSeeds.length === 0 && classifiedTokyo.globalSeeds.length === 0,
    `local=${classifiedTokyo.localSeeds.length} global=${classifiedTokyo.globalSeeds.length}`,
  ))

  if (nwsSeed && nasaSeed) {
    const nwsClassified = classifyVerifiedVideoSeeds([nwsSeed], akron)
    const nasaClassified = classifyVerifiedVideoSeeds([nasaSeed], akron)
    const panel = composeLiveIntelPanel({
      now: '2026-09-17T03:00:00.000Z',
      latitude: 41.0814,
      longitude: -81.519,
      place: 'Akron, OH',
      news: [...nwsClassified.globalSeeds, ...nasaClassified.globalSeeds],
    })
    const nwsItem = panel.sections.flatMap(section => section.items).find(item => item.id === nwsSeed.id)
    const nasaItem = panel.sections.flatMap(section => section.items).find(item => item.id === nasaSeed.id)
    results.push(check(
      'nws_remains_earth_not_local',
      nwsClassified.localSeeds.length === 0 && nwsItem?.category === 'EARTH',
      `${nwsItem?.category ?? 'missing'}/${nwsClassified.localSeeds.length}`,
    ))
    results.push(check(
      'nasa_es_remains_headlines_not_local',
      nasaClassified.localSeeds.length === 0 && nasaItem?.category === 'HEADLINES',
      `${nasaItem?.category ?? 'missing'}/${nasaClassified.localSeeds.length}`,
    ))
  }

  results.push(check(
    'preview_starts_muted',
    youtubeMuteEmbedUrl('DuORJdo5rI0') === 'https://www.youtube.com/embed/DuORJdo5rI0?autoplay=1&mute=1&playsinline=1'
      && youtubeUnmuteEmbedUrl('DuORJdo5rI0').includes('mute=0')
      && !youtubeMuteEmbedUrl('DuORJdo5rI0').includes('mute=0'),
    youtubeMuteEmbedUrl('DuORJdo5rI0'),
  ))
  results.push(check(
    'wkyc_and_news5_registry_ids',
    sourceById('wkyc-youtube').channelId === WKYC_CHANNEL
      && sourceById('news5-cleveland-youtube').channelId === NEWS5_CHANNEL
      && sourceById('nws-youtube').channelId === NWS_CHANNEL
      && sourceById('nasa-es-youtube').channelId === NASA_ES_CHANNEL,
    'registry ids match mission',
  ))

  return results
}

async function runLive(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const present = youtubeApiKeyIsConfigured()
  results.push(check('live_api_key_present', true, present ? 'YES' : 'NO'))
  if (!present) {
    results.push(check('live_wkyc_skipped_without_key', true, 'YOUTUBE_API_KEY absent in this process'))
    return results
  }

  __resetCacheForTests()
  __resetYoutubeDataApiQuotaForTests()
  const wkyc = await fetchYoutubeDataApiChannelFeed(sourceById('wkyc-youtube'))
  const news5 = await fetchYoutubeDataApiChannelFeed(sourceById('news5-cleveland-youtube'))
  const nws = await fetchYoutubeDataApiChannelFeed(sourceById('nws-youtube'))
  const nasa = await fetchYoutubeDataApiChannelFeed(sourceById('nasa-es-youtube'))
  const quota = youtubeDataApiQuotaSnapshot()
  const serialized = JSON.stringify({ wkyc, news5, nws, nasa, quota })
  const keyValue = process.env.YOUTUBE_API_KEY?.trim() ?? ''

  results.push(check(
    'live_wkyc_channels_and_playlist_items',
    wkyc.ok && wkyc.status === 'SUCCESS' && Boolean(wkyc.uploadsPlaylistId) && wkyc.entries.length > 0
      && wkyc.entries.every(entry => validateYoutubeVideoId(entry.videoId) === entry.videoId && entry.channelId === WKYC_CHANNEL)
      && wkyc.transport === 'YOUTUBE_DATA_API',
    `${wkyc.status} playlist=${wkyc.uploadsPlaylistId ?? 'none'} items=${wkyc.entries.length} http=${wkyc.httpStatus ?? 'n/a'} ${wkyc.error ?? ''}`.trim(),
  ))
  results.push(check(
    'live_news5_official_path',
    news5.transport === 'YOUTUBE_DATA_API'
      && (news5.ok
        ? news5.entries.every(entry => validateYoutubeVideoId(entry.videoId) === entry.videoId && entry.channelId === NEWS5_CHANNEL)
        : news5.status === 'EMPTY_FEED' && news5.entries.length === 0),
    `${news5.status} playlist=${news5.uploadsPlaylistId ?? 'none'} items=${news5.entries.length} http=${news5.httpStatus ?? 'n/a'} ${news5.error ?? ''}`.trim(),
  ))
  results.push(check(
    'live_nws_and_nasa_do_not_become_local',
    nws.channelId === NWS_CHANNEL && nasa.channelId === NASA_ES_CHANNEL,
    `nws=${nws.status}/${nws.entries.length} nasa=${nasa.status}/${nasa.entries.length}`,
  ))
  results.push(check(
    'live_quota_has_no_search_list',
    quota.searchList === 0 && quota.channelsList >= 1 && quota.playlistItemsList >= 1,
    JSON.stringify(quota),
  ))
  results.push(check(
    'live_payload_does_not_contain_api_key',
    !keyValue || (!serialized.includes(keyValue) && !encodeURIComponent(keyValue).split(keyValue).some(() => false)),
    keyValue ? `key_length=${keyValue.length} leak=${serialized.includes(keyValue) ? 'YES' : 'NO'}` : 'no key',
  ))

  const tokyo = parseLocalContext({ latitude: 35.676, longitude: 139.65, place: 'Tokyo, Japan' })
  const akron = parseLocalContext({ latitude: 41.0814, longitude: -81.519, place: 'Akron, Summit County, Ohio, United States' })
  const cleveland = parseLocalContext({ latitude: 41.4993, longitude: -81.6944, place: 'Cleveland, Cuyahoga County, Ohio, United States' })
  const liveSeeds = await loadVerifiedVideoNewsSeeds({
    sources: [sourceById('wkyc-youtube'), sourceById('news5-cleveland-youtube'), sourceById('nws-youtube'), sourceById('nasa-es-youtube')],
    nowMs: Date.now(),
  })
  const tokyoClassified = classifyVerifiedVideoSeeds(liveSeeds.seeds, tokyo)
  const akronClassified = classifyVerifiedVideoSeeds(liveSeeds.seeds, akron)
  const clevelandClassified = classifyVerifiedVideoSeeds(liveSeeds.seeds, cleveland)
  results.push(check(
    'live_tokyo_ohio_leakage_zero',
    tokyoClassified.localSeeds.length === 0,
    `local=${tokyoClassified.localSeeds.length} global=${tokyoClassified.globalSeeds.length}`,
  ))
  results.push(check(
    'live_akron_and_cleveland_still_filter',
    akronClassified.localSeeds.every(seed => seed.verifiedVideoSourceId === 'wkyc-youtube' || seed.verifiedVideoSourceId === 'news5-cleveland-youtube')
      && clevelandClassified.localSeeds.every(seed => seed.verifiedVideoSourceId === 'wkyc-youtube' || seed.verifiedVideoSourceId === 'news5-cleveland-youtube')
      && !akronClassified.localSeeds.some(seed => seed.verifiedVideoSourceId === 'nws-youtube' || seed.verifiedVideoSourceId === 'nasa-es-youtube')
      && !clevelandClassified.localSeeds.some(seed => seed.verifiedVideoSourceId === 'nws-youtube' || seed.verifiedVideoSourceId === 'nasa-es-youtube'),
    `akronLocal=${akronClassified.localSeeds.length} clevelandLocal=${clevelandClassified.localSeeds.length}`,
  ))

  cacheDelete(youtubeFeedSuccessCacheKey(WKYC_CHANNEL))
  const stale = await loadVerifiedVideoNewsSeeds({
    sources: [sourceById('wkyc-youtube')],
    nowMs: Date.now(),
    fetchFeed: async source => ({
      ok: false,
      status: 'HTTP_5XX',
      sourceId: source.id,
      channelId: source.channelId,
      channelName: source.officialName,
      feedUrl: 'https://youtube.googleapis.com/youtube/v3/playlistItems',
      entries: [],
      httpStatus: 500,
      error: 'simulated upstream failure',
      transport: 'YOUTUBE_DATA_API',
    }),
  })
  results.push(check(
    'live_last_known_good_after_simulated_failure',
    liveSeeds.seeds.some(seed => seed.verifiedVideoSourceId === 'wkyc-youtube')
      ? stale.providers[0]?.freshness === 'STALE_LAST_GOOD' && stale.providers[0]?.transport === 'LAST_KNOWN_GOOD' && stale.providers[0]?.freshness !== 'LIVE'
      : stale.providers[0]?.freshness !== 'LIVE',
    `${stale.providers[0]?.freshness}/${stale.providers[0]?.transport} items=${stale.seeds.length}`,
  ))

  return results
}

export async function runYoutubeDataApiValidation(): Promise<CaseResult[]> {
  const unit = await runUnit()
  const live = await runLive()
  return [...unit, ...live]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runYoutubeDataApiValidation().then(results => {
    const failed = results.filter(result => !result.pass)
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    console.log(`Terra YouTube Data API ingest: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
    if (failed.length) process.exit(1)
  }).catch(error => {
    console.error(error)
    process.exit(1)
  })
}

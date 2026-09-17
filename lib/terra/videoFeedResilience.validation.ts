/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/videoFeedResilience.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { __resetCacheForTests, cacheDelete } from '@/lib/research-engine/cache/ttlCache'
import { composeLiveIntelPanel, type TerraLiveIntelNewsSeed } from './liveIntelPanelModel'
import { buildMediaPreviewFromSource } from './liveIntelMedia'
import { classifyVerifiedVideoSeeds } from './localVideoClassification'
import { parseLocalContext } from './localSources/context'
import { composeAreaLiveWorkspace, isAreaLiveLocalIntelItem } from './godsEye/areaLiveWorkspace'
import { loadVerifiedVideoNewsSeeds } from './fetchVerifiedVideoIntel'
import {
  YOUTUBE_ATOM_ACCEPT,
  YOUTUBE_ATOM_HEADERS,
  YOUTUBE_ATOM_USER_AGENT,
  VERIFIED_VIDEO_FAILURE_BACKOFF_MS,
  VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS,
  VERIFIED_VIDEO_SUCCESS_TTL_MS,
  classifyYoutubeAtomBody,
  classifyYoutubeFetchError,
  classifyYoutubeHttpStatus,
  formatLastKnownGoodAge,
  lastKnownGoodIsAdmissible,
  resolveVerifiedVideoProviderHealth,
  youtubeFeedSuccessCacheKey,
  type VerifiedVideoLastKnownGood,
} from './videoFeedResilience'
import { VERIFIED_VIDEO_SOURCES } from './verifiedVideoSources'
import { fetchYoutubeChannelAtomFeed, type YoutubeChannelFeedResult } from './youtubeChannelFeed'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-17T03:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const WKYC_CHANNEL = 'UCNBmxc6FvKyxtCpUygcdINA'
const WKYC_VIDEO = 'DuORJdo5rI0'

function wkycSource() {
  const source = VERIFIED_VIDEO_SOURCES.find(row => row.id === 'wkyc-youtube')
  if (!source) throw new Error('WKYC source missing')
  return source
}

function news5Source() {
  const source = VERIFIED_VIDEO_SOURCES.find(row => row.id === 'news5-cleveland-youtube')
  if (!source) throw new Error('News 5 source missing')
  return source
}

function entry(videoId: string, title: string, channelId = WKYC_CHANNEL) {
  return {
    videoId,
    title,
    publishedAt: '2026-09-16T18:00:00.000Z',
    channelName: 'WKYC 3 Cleveland',
    channelId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    summary: title,
  }
}

function successFeed(): YoutubeChannelFeedResult {
  const source = wkycSource()
  return {
    ok: true,
    status: 'SUCCESS',
    sourceId: source.id,
    channelId: source.channelId,
    channelName: source.officialName,
    feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`,
    entries: [entry(WKYC_VIDEO, 'Akron-Canton Chick-fil-A drive-thru backup')],
    httpStatus: 200,
    retrievedAt: NOW,
  }
}

function failureFeed(status: YoutubeChannelFeedResult['status'], httpStatus?: number): YoutubeChannelFeedResult {
  const source = wkycSource()
  return {
    ok: false,
    status,
    sourceId: source.id,
    channelId: source.channelId,
    channelName: source.officialName,
    feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`,
    entries: [],
    httpStatus: httpStatus ?? null,
    error: httpStatus ? `HTTP ${httpStatus}` : status,
  }
}

function staleSeed(minutesAgo: number): TerraLiveIntelNewsSeed {
  const retrievedAt = new Date(NOW_MS - minutesAgo * 60_000).toISOString()
  const url = `https://www.youtube.com/watch?v=${WKYC_VIDEO}`
  return {
    id: `yt:wkyc-youtube:${WKYC_VIDEO}`,
    title: 'Akron fire crews battle blaze on Tallmadge Avenue',
    summary: 'Akron fire crews battle blaze on Tallmadge Avenue',
    url,
    sourceName: 'WKYC 3 Cleveland',
    provider: 'wkyc_youtube',
    publishedAt: '2026-09-16T18:00:00.000Z',
    retrievedAt,
    fromCache: false,
    lastKnownGood: true,
    contentType: 'official_youtube',
    geography: null,
    reliability: 'HIGH',
    feedName: 'WKYC 3 Cleveland',
    youtubeVideoId: WKYC_VIDEO,
    verifiedVideoSourceId: 'wkyc-youtube',
    intelCategory: 'LOCAL',
    verificationState: 'REPORTED',
    localSourceType: 'TV',
    localServiceArea: 'Cleveland / Akron / Northeast Ohio',
    localRelevance: 'CITY',
    mediaPreview: buildMediaPreviewFromSource({
      sourceUrl: url,
      youtubeVideoId: WKYC_VIDEO,
      provider: 'wkyc_youtube',
      retrievedAt,
      originalLanguage: 'en',
      officialChannelName: 'WKYC 3 Cleveland',
      channelId: WKYC_CHANNEL,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${WKYC_CHANNEL}`,
      verificationSource: 'https://www.wkyc.com/',
    }),
  }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(check(
    'failure_classes_are_distinct',
    classifyYoutubeHttpStatus(404) === 'HTTP_404'
      && classifyYoutubeHttpStatus(400) === 'HTTP_400'
      && classifyYoutubeHttpStatus(403) === 'HTTP_403'
      && classifyYoutubeHttpStatus(429) === 'HTTP_429'
      && classifyYoutubeHttpStatus(503) === 'HTTP_5XX'
      && classifyYoutubeFetchError(Object.assign(new Error('aborted'), { name: 'TimeoutError' })) === 'TIMEOUT'
      && classifyYoutubeAtomBody('<html>not atom</html>', 0) === 'PARSE_ERROR'
      && classifyYoutubeAtomBody('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', 0) === 'EMPTY_FEED'
      && classifyYoutubeAtomBody('<feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>', 1) === 'SUCCESS',
    'HTTP_400/HTTP_403/HTTP_404/HTTP_429/HTTP_5XX/TIMEOUT/PARSE_ERROR/EMPTY_FEED/SUCCESS',
  ))
  results.push(check(
    'http_failures_are_not_collapsed_to_unavailable',
    resolveVerifiedVideoProviderHealth({ status: 'HTTP_404', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'ERROR_UPSTREAM'
      && resolveVerifiedVideoProviderHealth({ status: 'HTTP_5XX', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'ERROR_UPSTREAM'
      && resolveVerifiedVideoProviderHealth({ status: 'HTTP_400', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'UNAVAILABLE'
      && resolveVerifiedVideoProviderHealth({ status: 'HTTP_403', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'UNAVAILABLE'
      && resolveVerifiedVideoProviderHealth({ status: 'HTTP_429', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'RATE_LIMITED'
      && resolveVerifiedVideoProviderHealth({ status: 'EMPTY_FEED', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'EMPTY'
      && resolveVerifiedVideoProviderHealth({ status: 'SUCCESS', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) === 'LIVE'
      && resolveVerifiedVideoProviderHealth({ status: 'SUCCESS', fromSuccessCache: true, lastKnownGood: false, sourceEnabled: true }) === 'CACHED',
    'ERROR_UPSTREAM/UNAVAILABLE/RATE_LIMITED/EMPTY/LIVE/CACHED',
  ))
  results.push(check(
    'registry_presence_is_not_live',
    resolveVerifiedVideoProviderHealth({ status: 'HTTP_404', fromSuccessCache: false, lastKnownGood: false, sourceEnabled: true }) !== 'LIVE',
    'enabled source with 404 is ERROR_UPSTREAM',
  ))
  results.push(check(
    'stable_ua_profile',
    YOUTUBE_ATOM_USER_AGENT === 'WarRoomTerraLiveIntel/1.0'
      && YOUTUBE_ATOM_ACCEPT === 'application/atom+xml,application/xml,text/xml,*/*'
      && YOUTUBE_ATOM_HEADERS['user-agent'] === YOUTUBE_ATOM_USER_AGENT
      && YOUTUBE_ATOM_HEADERS.accept === YOUTUBE_ATOM_ACCEPT
      && Object.keys(YOUTUBE_ATOM_HEADERS).length === 2,
    `${YOUTUBE_ATOM_USER_AGENT} / ${YOUTUBE_ATOM_ACCEPT}`,
  ))
  results.push(check(
    'success_ttl_and_failure_backoff',
    VERIFIED_VIDEO_SUCCESS_TTL_MS === 10 * 60 * 1000
      && VERIFIED_VIDEO_FAILURE_BACKOFF_MS === 60 * 1000
      && VERIFIED_VIDEO_FAILURE_BACKOFF_MS < VERIFIED_VIDEO_SUCCESS_TTL_MS
      && VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS === 30 * 60 * 1000,
    `success=${VERIFIED_VIDEO_SUCCESS_TTL_MS} fail=${VERIFIED_VIDEO_FAILURE_BACKOFF_MS} last=${VERIFIED_VIDEO_LAST_KNOWN_GOOD_MS}`,
  ))

  const goodSnapshot: VerifiedVideoLastKnownGood = {
    retrievedAt: new Date(NOW_MS - 18 * 60_000).toISOString(),
    channelId: WKYC_CHANNEL,
    feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${WKYC_CHANNEL}`,
    officialName: 'WKYC 3 Cleveland',
    entries: [entry(WKYC_VIDEO, 'Akron-Canton Chick-fil-A drive-thru backup')],
  }
  results.push(check(
    'last_known_good_admissible_inside_window',
    lastKnownGoodIsAdmissible(goodSnapshot, NOW_MS) === true,
    formatLastKnownGoodAge(goodSnapshot.retrievedAt, NOW_MS),
  ))
  results.push(check(
    'last_known_good_rejected_when_stale_or_unproven',
    lastKnownGoodIsAdmissible({ ...goodSnapshot, retrievedAt: new Date(NOW_MS - 31 * 60_000).toISOString() }, NOW_MS) === false
      && lastKnownGoodIsAdmissible({ ...goodSnapshot, entries: [] }, NOW_MS) === false
      && lastKnownGoodIsAdmissible({ ...goodSnapshot, entries: [{ ...goodSnapshot.entries[0]!, videoId: 'bad-id' }] }, NOW_MS) === false
      && lastKnownGoodIsAdmissible(null, NOW_MS) === false,
    'expired/empty/bad-id/null rejected',
  ))
  results.push(check(
    'stale_label_never_says_live',
    formatLastKnownGoodAge(goodSnapshot.retrievedAt, NOW_MS) === 'STALE LAST KNOWN GOOD · 18 min'
      && !formatLastKnownGoodAge(goodSnapshot.retrievedAt, NOW_MS).includes('LIVE'),
    formatLastKnownGoodAge(goodSnapshot.retrievedAt, NOW_MS),
  ))

  __resetCacheForTests()
  let wkycCalls = 0
  const liveThenFail = async (): Promise<YoutubeChannelFeedResult> => {
    wkycCalls += 1
    return wkycCalls === 1 ? successFeed() : failureFeed('HTTP_5XX', 500)
  }
  const first = await loadVerifiedVideoNewsSeeds({ sources: [wkycSource()], nowMs: NOW_MS, fetchFeed: liveThenFail })
  const secondCached = await loadVerifiedVideoNewsSeeds({ sources: [wkycSource()], nowMs: NOW_MS + 1_000, fetchFeed: liveThenFail })
  results.push(check(
    'wkyc_success_is_live_then_cached',
    first.providers[0]?.freshness === 'LIVE'
      && first.seeds.length === 1
      && first.seeds[0]?.youtubeVideoId === WKYC_VIDEO
      && secondCached.providers[0]?.freshness === 'CACHED'
      && wkycCalls === 1,
    `first=${first.providers[0]?.freshness} second=${secondCached.providers[0]?.freshness} calls=${wkycCalls}`,
  ))

  cacheDelete(youtubeFeedSuccessCacheKey(WKYC_CHANNEL))
  const stale = await loadVerifiedVideoNewsSeeds({ sources: [wkycSource()], nowMs: NOW_MS + 2_000, fetchFeed: liveThenFail })
  results.push(check(
    'transient_failure_retains_last_known_good',
    stale.providers[0]?.freshness === 'STALE_LAST_GOOD'
      && stale.providers[0]?.lastKnownGood === true
      && stale.providers[0]?.failureClass === 'HTTP_5XX'
      && stale.seeds.length === 1
      && stale.seeds[0]?.lastKnownGood === true
      && stale.seeds[0]?.youtubeVideoId === WKYC_VIDEO
      && wkycCalls === 2,
    `${stale.providers[0]?.freshness}/${stale.providers[0]?.failureClass} items=${stale.seeds.length} calls=${wkycCalls}`,
  ))

  const hammer = await loadVerifiedVideoNewsSeeds({ sources: [wkycSource()], nowMs: NOW_MS + 3_000, fetchFeed: liveThenFail })
  results.push(check(
    'failure_backoff_does_not_hammer',
    wkycCalls === 2 && hammer.providers[0]?.freshness === 'STALE_LAST_GOOD',
    `calls=${wkycCalls} health=${hammer.providers[0]?.freshness}`,
  ))

  const panelNow = NOW
  const panel = composeLiveIntelPanel({
    now: panelNow,
    latitude: 41.0814,
    longitude: -81.519,
    place: 'Akron, OH',
    city: 'Akron',
    county: 'Summit County',
    state: 'Ohio',
    country: 'United States',
    countryCode: 'US',
    localIntel: {
      seeds: [staleSeed(18)],
      coverage: 'PARTIAL',
      health: 'STALE',
      mix: [],
      shortLabel: 'AKRON, OH',
      rejectedCount: 0,
      reason: 'Last-known-good fixture.',
    },
  })
  const localItem = panel.sections.find(section => section.id === 'LOCAL')?.items.find(item => item.id === `yt:wkyc-youtube:${WKYC_VIDEO}`)
  results.push(check(
    'ui_labels_stale_last_known_good',
    localItem?.freshnessState === 'STALE_LAST_GOOD'
      && localItem.freshnessLabel === 'STALE LAST KNOWN GOOD · 18 min'
      && localItem.coverageState === 'STALE',
    `${localItem?.freshnessState}/${localItem?.freshnessLabel}/${localItem?.coverageState}`,
  ))

  const area = composeAreaLiveWorkspace({
    originLabel: 'Akron, OH',
    origin: { latitude: 41.0814, longitude: -81.519 },
    cameras: [],
    cameraCount: 0,
    cameraIndexLoaded: true,
    locationState: 'LIVE',
    coveringLabel: null,
    intelPending: false,
    mediaItems: localItem && isAreaLiveLocalIntelItem(localItem) ? [{
      id: localItem.id,
      headline: localItem.headline,
      source: localItem.source,
      provider: localItem.provider,
      sourceUrl: localItem.sourceUrl,
      location: localItem.location,
      lat: localItem.lat,
      lon: localItem.lon,
      originalLanguage: localItem.originalLanguage,
      verificationState: localItem.verificationState,
      timestamp: localItem.timestamp,
      retrievedAt: localItem.retrievedAt,
      category: localItem.category,
      locationRelevance: localItem.localRelevance ?? null,
      freshnessState: localItem.freshnessState,
      freshnessLabel: localItem.freshnessLabel ?? null,
      mediaPreview: localItem.mediaPreview ?? null,
    }] : [],
    eventItems: [],
    filter: 'VIDEO',
  })
  results.push(check(
    'area_live_shows_stale_label',
    Boolean(area.rows[0]?.subtitle.includes('STALE LAST KNOWN GOOD') && !area.rows[0]?.subtitle.includes('LIVE')),
    area.rows[0]?.subtitle ?? 'none',
  ))

  __resetCacheForTests()
  let news5Calls = 0
  const news5Always404 = async (): Promise<YoutubeChannelFeedResult> => {
    news5Calls += 1
    const source = news5Source()
    return {
      ok: false,
      status: 'HTTP_404',
      sourceId: source.id,
      channelId: source.channelId,
      channelName: source.officialName,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`,
      entries: [],
      httpStatus: 404,
      error: 'HTTP 404',
    }
  }
  const news5First = await loadVerifiedVideoNewsSeeds({ sources: [news5Source()], nowMs: NOW_MS, fetchFeed: news5Always404 })
  const news5Second = await loadVerifiedVideoNewsSeeds({ sources: [news5Source()], nowMs: NOW_MS + 1_000, fetchFeed: news5Always404 })
  results.push(check(
    'news5_no_success_has_no_fake_items',
    news5First.seeds.length === 0
      && news5Second.seeds.length === 0
      && news5First.providers[0]?.freshness === 'ERROR_UPSTREAM'
      && news5First.providers[0]?.failureClass === 'HTTP_404'
      && news5Calls === 1,
    `items=${news5First.seeds.length} health=${news5First.providers[0]?.freshness} class=${news5First.providers[0]?.failureClass} calls=${news5Calls}`,
  ))

  const tokyo = parseLocalContext({ latitude: 35.676, longitude: 139.65, place: 'Tokyo, Japan' })
  const tokyoClassified = classifyVerifiedVideoSeeds(stale.seeds, tokyo)
  results.push(check(
    'tokyo_last_known_good_does_not_leak_ohio',
    tokyoClassified.localSeeds.length === 0
      && tokyoClassified.globalSeeds.length === 0
      && tokyoClassified.suppressed.some(row => row.id === stale.seeds[0]?.id),
    `local=${tokyoClassified.localSeeds.length} global=${tokyoClassified.globalSeeds.length} suppressed=${tokyoClassified.suppressed.length}`,
  ))

  const akron = parseLocalContext({ latitude: 41.0814, longitude: -81.519, place: 'Akron, Summit County, Ohio, United States' })
  const akronClassified = classifyVerifiedVideoSeeds(stale.seeds, akron)
  results.push(check(
    'akron_still_filters_retained_items',
    akronClassified.localSeeds.some(seed => seed.youtubeVideoId === WKYC_VIDEO)
      && akronClassified.localSeeds.every(seed => /akron|canton/i.test(seed.title)),
    akronClassified.localSeeds.map(seed => seed.title).join(',') || 'none',
  ))

  try {
    const live = await fetchYoutubeChannelAtomFeed(wkycSource(), 8_000)
    results.push(check(
      'wkyc_live_atom_class_is_truthful',
      live.status === 'SUCCESS' ? live.entries.length > 0 && live.ok : live.entries.length === 0,
      `${live.status} http=${live.httpStatus ?? 'n/a'} items=${live.entries.length} ua=${YOUTUBE_ATOM_USER_AGENT}`,
    ))
  } catch (error) {
    results.push(check('wkyc_live_atom_class_is_truthful', false, error instanceof Error ? error.message : String(error)))
  }

  return results
}

export async function runVideoFeedResilienceValidation(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVideoFeedResilienceValidation().then(results => {
    const failed = results.filter(result => !result.pass)
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    console.log(`Terra video feed resilience: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
    if (failed.length) process.exit(1)
  }).catch(error => {
    console.error(error)
    process.exit(1)
  })
}

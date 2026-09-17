/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/localVideoClassification.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { composeLiveIntelPanel, type TerraLiveIntelNewsSeed } from './liveIntelPanelModel'
import { buildMediaPreviewFromSource, validateYoutubeChannelId } from './liveIntelMedia'
import { parseLocalContext } from './localSources/context'
import { classifyVerifiedVideoSeed, classifyVerifiedVideoSeeds } from './localVideoClassification'
import { composeAreaLiveWorkspace, isAreaLiveLocalIntelItem } from './godsEye/areaLiveWorkspace'
import { isAreaLivePlayableVideo } from './godsEye/areaLiveMedia'
import {
  HELD_LOCAL_VIDEO_SOURCES,
  VERIFIED_VIDEO_SOURCES,
  videoSourceIsLocalEligible,
} from './verifiedVideoSources'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOW = '2026-09-17T03:00:00.000Z'

function videoSeed(input: {
  sourceId: string
  officialName: string
  provider: string
  channelId: string
  videoId: string
  title: string
  summary?: string
  intelCategory?: TerraLiveIntelNewsSeed['intelCategory']
}): TerraLiveIntelNewsSeed {
  const url = `https://www.youtube.com/watch?v=${input.videoId}`
  return {
    id: `yt:${input.sourceId}:${input.videoId}`,
    title: input.title,
    summary: input.summary ?? null,
    url,
    sourceName: input.officialName,
    provider: input.provider,
    publishedAt: '2026-09-16T18:00:00.000Z',
    retrievedAt: NOW,
    contentType: 'official_youtube',
    geography: null,
    reliability: 'HIGH',
    feedName: input.officialName,
    declaredLanguage: 'en',
    youtubeVideoId: input.videoId,
    verifiedVideoSourceId: input.sourceId,
    intelCategory: input.intelCategory ?? 'HEADLINES',
    verificationState: 'REPORTED',
    localSourceType: 'TV',
    localServiceArea: 'Cleveland / Akron / Northeast Ohio',
    mediaPreview: buildMediaPreviewFromSource({
      sourceUrl: url,
      youtubeVideoId: input.videoId,
      provider: input.provider,
      retrievedAt: NOW,
      originalLanguage: 'en',
      officialChannelName: input.officialName,
      channelId: input.channelId,
      feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${input.channelId}`,
      verificationSource: 'official publisher page',
    }),
  }
}

const WKYC = {
  sourceId: 'wkyc-youtube',
  officialName: 'WKYC 3 Cleveland',
  provider: 'wkyc_youtube',
  channelId: 'UCNBmxc6FvKyxtCpUygcdINA',
}

const NEWS5 = {
  sourceId: 'news5-cleveland-youtube',
  officialName: 'News 5 Cleveland (WEWS)',
  provider: 'news5_youtube',
  channelId: 'UCAAmkc2sRESFoEtiKRTaTRA',
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const wkyc = VERIFIED_VIDEO_SOURCES.find(source => source.id === 'wkyc-youtube')
  const news5 = VERIFIED_VIDEO_SOURCES.find(source => source.id === 'news5-cleveland-youtube')
  const nws = VERIFIED_VIDEO_SOURCES.find(source => source.id === 'nws-youtube')
  const nasa = VERIFIED_VIDEO_SOURCES.find(source => source.id === 'nasa-es-youtube')

  results.push(check(
    'wkyc_channel_from_official_homepage',
    Boolean(wkyc?.enabled && wkyc.channelId === 'UCNBmxc6FvKyxtCpUygcdINA' && /wkyc\.com/i.test(wkyc.verificationSource) && videoSourceIsLocalEligible(wkyc)),
    wkyc?.channelId ?? 'missing',
  ))
  results.push(check(
    'news5_channel_from_official_homepage',
    Boolean(news5?.enabled && news5.channelId === 'UCAAmkc2sRESFoEtiKRTaTRA' && /news5cleveland\.com/i.test(news5.verificationSource) && videoSourceIsLocalEligible(news5)),
    news5?.channelId ?? 'missing',
  ))
  results.push(check(
    'local_channel_ids_are_valid',
    Boolean(validateYoutubeChannelId(wkyc?.channelId ?? '') && validateYoutubeChannelId(news5?.channelId ?? '')),
    `${wkyc?.channelId}/${news5?.channelId}`,
  ))
  results.push(check(
    'national_and_global_are_not_local_eligible',
    Boolean(nws && nasa && !videoSourceIsLocalEligible(nws) && !videoSourceIsLocalEligible(nasa)),
    `${nws?.geography?.localityScope}/${nasa?.geography?.localityScope}`,
  ))
  results.push(check(
    'held_sources_have_no_guessed_channel_id',
    HELD_LOCAL_VIDEO_SOURCES.every(source => source.channelId == null),
    HELD_LOCAL_VIDEO_SOURCES.map(source => source.officialName).join(','),
  ))
  results.push(check(
    'held_city_of_akron_is_not_enabled',
    !VERIFIED_VIDEO_SOURCES.some(source => /city of akron/i.test(source.officialName)),
    VERIFIED_VIDEO_SOURCES.map(source => source.id).join(','),
  ))

  const akron = parseLocalContext({ latitude: 41.0814, longitude: -81.519, place: 'Akron, Summit County, Ohio, United States' })
  const cleveland = parseLocalContext({ latitude: 41.4993, longitude: -81.6944, place: 'Cleveland, Cuyahoga County, Ohio, United States' })
  const tokyo = parseLocalContext({ latitude: 35.676, longitude: 139.65, place: 'Tokyo, Japan' })

  const akronFire = videoSeed({ ...WKYC, videoId: 'AkronFire01', title: 'Akron fire crews battle blaze on Tallmadge Avenue' })
  const clevelandParking = videoSeed({ ...WKYC, videoId: 'ClevParkng1', title: 'Cleveland City Council votes on downtown parking' })
  const news5Summit = videoSeed({ ...NEWS5, videoId: 'SummitRd01a', title: 'Summit County road work begins this week in Akron' })
  const genericNewscast = videoSeed({ ...WKYC, videoId: 'GenericCast', title: 'Evening newscast' })
  const nwsSeed = videoSeed({
    sourceId: 'nws-youtube',
    officialName: 'National Weather Service (NWS)',
    provider: 'nws_youtube',
    channelId: 'UC9hQvMjzSxurMirYDgOMezw',
    videoId: 'zz3jM6lu7Fs',
    title: 'El Nino Advisory issued',
    intelCategory: 'EARTH',
  })
  const nasaSeed = videoSeed({
    sourceId: 'nasa-es-youtube',
    officialName: 'NASA en Español',
    provider: 'nasa_youtube',
    channelId: 'UC8zqCEvaRwHcfz3IhjhMMxQ',
    videoId: 'NasaEsVid01',
    title: 'La NASA comparte nuevas imágenes',
    intelCategory: 'HEADLINES',
  })

  const akronClassified = classifyVerifiedVideoSeeds(
    [akronFire, clevelandParking, news5Summit, genericNewscast, nwsSeed, nasaSeed],
    akron,
  )
  results.push(check(
    'akron_accepts_akron_named_video',
    akronClassified.localSeeds.some(seed => seed.id === akronFire.id) && akronClassified.localSeeds.some(seed => seed.id === news5Summit.id),
    akronClassified.localSeeds.map(seed => seed.id).join(','),
  ))
  results.push(check(
    'akron_rejects_cleveland_only_upload',
    !akronClassified.localSeeds.some(seed => seed.id === clevelandParking.id)
      && akronClassified.suppressed.some(row => row.id === clevelandParking.id),
    akronClassified.suppressed.find(row => row.id === clevelandParking.id)?.reason ?? 'not suppressed',
  ))
  results.push(check(
    'akron_rejects_publisher_only_newscast',
    akronClassified.suppressed.some(row => row.id === genericNewscast.id),
    akronClassified.suppressed.find(row => row.id === genericNewscast.id)?.reason ?? 'not suppressed',
  ))
  results.push(check(
    'akron_does_not_promote_nws_or_nasa_to_local',
    akronClassified.globalSeeds.some(seed => seed.id === nwsSeed.id)
      && akronClassified.globalSeeds.some(seed => seed.id === nasaSeed.id)
      && !akronClassified.localSeeds.some(seed => seed.id === nwsSeed.id || seed.id === nasaSeed.id),
    akronClassified.globalSeeds.map(seed => seed.id).join(','),
  ))

  const clevelandClassified = classifyVerifiedVideoSeeds([akronFire, clevelandParking, genericNewscast], cleveland)
  results.push(check(
    'cleveland_accepts_cleveland_named_video',
    clevelandClassified.localSeeds.some(seed => seed.id === clevelandParking.id)
      && !clevelandClassified.localSeeds.some(seed => seed.id === akronFire.id),
    clevelandClassified.localSeeds.map(seed => seed.id).join(','),
  ))

  const tokyoClassified = classifyVerifiedVideoSeeds([akronFire, clevelandParking, news5Summit, nwsSeed], tokyo)
  results.push(check(
    'tokyo_has_no_ohio_local_video',
    tokyoClassified.localSeeds.length === 0
      && tokyoClassified.suppressed.some(row => row.id === akronFire.id)
      && tokyoClassified.globalSeeds.some(seed => seed.id === nwsSeed.id),
    `local=${tokyoClassified.localSeeds.length} suppressed=${tokyoClassified.suppressed.length}`,
  ))
  results.push(check(
    'no_active_location_does_not_globalize_local_video',
    classifyVerifiedVideoSeed(akronFire, null).lane === 'SUPPRESSED',
    classifyVerifiedVideoSeed(akronFire, null).reason,
  ))

  const akronPanel = composeLiveIntelPanel({
    now: NOW,
    latitude: akron.latitude,
    longitude: akron.longitude,
    place: 'Akron, Ohio',
    city: akron.city,
    county: akron.county,
    state: akron.state,
    country: akron.country,
    countryCode: akron.countryCode,
    news: akronClassified.globalSeeds,
    newsCoverage: 'LIVE',
    localIntel: {
      seeds: akronClassified.localSeeds,
      coverage: 'SPARSE',
      health: 'ACTIVE',
      mix: [{ key: 'TV', label: 'TV', count: akronClassified.localSeeds.length }],
      shortLabel: akron.shortLabel,
      rejectedCount: akronClassified.suppressed.length,
      reason: 'Verified local video plus local sources.',
    },
  })
  const akronLocal = akronPanel.sections.find(section => section.id === 'LOCAL')?.items ?? []
  const akronHeadlines = akronPanel.sections.find(section => section.id === 'HEADLINES')?.items ?? []
  results.push(check(
    'akron_local_section_has_akron_video_not_cleveland_upload',
    akronLocal.some(item => item.id === akronFire.id && item.mediaPreview?.type === 'YT_MUTE_EMBED' && item.mediaPreview.posterUrl?.includes('AkronFire01'))
      && !akronLocal.some(item => item.id === clevelandParking.id)
      && !akronLocal.some(item => item.id === nasaSeed.id),
    akronLocal.map(item => item.id).join(','),
  ))
  results.push(check(
    'akron_headlines_do_not_absorb_suppressed_local_video',
    !akronHeadlines.some(item => item.id === clevelandParking.id || item.id === akronFire.id),
    akronHeadlines.map(item => item.id).join(','),
  ))

  const tokyoPanel = composeLiveIntelPanel({
    now: NOW,
    latitude: tokyo.latitude,
    longitude: tokyo.longitude,
    place: 'Tokyo, Japan',
    city: tokyo.city,
    state: tokyo.state,
    country: tokyo.country,
    countryCode: tokyo.countryCode,
    news: tokyoClassified.globalSeeds,
    newsCoverage: 'LIVE',
    localIntel: {
      seeds: tokyoClassified.localSeeds,
      coverage: 'SPARSE',
      health: 'ACTIVE',
      mix: [],
      shortLabel: tokyo.shortLabel,
      rejectedCount: tokyoClassified.suppressed.length,
      reason: 'No overlapping local video sources.',
    },
  })
  const tokyoLocal = tokyoPanel.sections.find(section => section.id === 'LOCAL')?.items ?? []
  results.push(check(
    'tokyo_local_has_no_ohio_video',
    !tokyoLocal.some(item => /wkyc|news5|akron|cleveland/i.test(item.id + item.source + item.headline)),
    tokyoLocal.map(item => item.id).join(',') || 'none',
  ))

  const areaLiveItems = [...akronLocal, ...akronHeadlines].filter(isAreaLiveLocalIntelItem).map(item => ({
    id: item.id,
    headline: item.headline,
    source: item.source,
    provider: item.provider,
    sourceUrl: item.sourceUrl,
    location: item.localRelevance ?? item.location,
    locationRelevance: item.localRelevance ?? null,
    lat: item.lat,
    lon: item.lon,
    originalLanguage: item.originalLanguage,
    verificationState: item.verificationState,
    timestamp: item.timestamp,
    retrievedAt: item.retrievedAt,
    category: item.category,
    mediaPreview: item.mediaPreview ?? null,
  }))
  const areaLive = composeAreaLiveWorkspace({
    originLabel: 'Akron, Ohio',
    origin: { latitude: akron.latitude, longitude: akron.longitude },
    cameras: [],
    cameraCount: 0,
    cameraIndexLoaded: true,
    locationState: 'COVERED',
    coveringLabel: 'OHGO / ODOT',
    intelPending: false,
    mediaItems: areaLiveItems,
    eventItems: [],
    filter: 'VIDEO',
  })
  const nasaWouldHaveLeaked = isAreaLiveLocalIntelItem({ category: 'HEADLINES' })
  results.push(check(
    'area_live_video_uses_local_playable_only',
    areaLive.rows.some(row => row.kind === 'VIDEO' && row.intelItemId === akronFire.id && row.media?.kind === 'YOUTUBE' && row.media.posterUrl?.includes('AkronFire01') && row.verificationState === 'REPORTED')
      && !areaLive.rows.some(row => row.intelItemId === nasaSeed.id || row.intelItemId === clevelandParking.id)
      && !nasaWouldHaveLeaked,
    areaLive.rows.map(row => row.intelItemId).join(','),
  ))
  results.push(check(
    'area_live_playable_is_youtube_not_invented',
    areaLive.rows.every(row => !row.media || isAreaLivePlayableVideo(row.media.kind) === (row.kind === 'VIDEO')),
    areaLive.rows.map(row => `${row.kind}:${row.media?.kind}`).join(','),
  ))

  return results
}

export function runLocalVideoClassificationValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runLocalVideoClassificationValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra local video sources: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

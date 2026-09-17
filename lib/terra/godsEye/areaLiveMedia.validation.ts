/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/areaLiveMedia.validation.ts
 */
import { pathToFileURL } from 'node:url'
import {
  areaLiveCommanderAudible,
  areaLiveNativeVideoMuted,
  areaLiveObservedFacts,
  areaLiveYoutubeIframeSrc,
  buildAreaLiveCameraMedia,
  buildAreaLiveIntelMedia,
  buildAreaLiveOfficialViewerMedia,
  canSendAreaLiveToCouncil,
  isAreaLivePlayableVideo,
  type AreaLiveCameraFeature,
} from './areaLiveMedia'
import { NY511_OFFICIAL_VIEWER } from '../ny511BoundingBox'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function camera(partial: Partial<AreaLiveCameraFeature> & Pick<AreaLiveCameraFeature, 'id' | 'providerId'>): AreaLiveCameraFeature {
  return {
    title: partial.title ?? partial.id,
    kind: 'traffic_camera',
    latitude: 41.0814,
    longitude: -81.519,
    properties: {},
    provenance: { retrievedAt: '2026-09-16T18:00:00.000Z', fromCache: false },
    ...partial,
  }
}

function run(): CaseResult[] {
  const ohgo = buildAreaLiveCameraMedia({
    feature: camera({
      id: 'ohgo-akron-1',
      providerId: 'ohgo_cameras',
      title: 'I-77 at I-271',
      properties: { imagePath: '/images/cam1.jpg', road: 'I-77 at I-271', locationName: 'Richfield', freshness: 'still_image' },
    }),
  })
  const caltrans = buildAreaLiveCameraMedia({
    feature: camera({
      id: 'caltrans-la-1',
      providerId: 'caltrans_cctv',
      title: 'I-5 at Stadium Way',
      latitude: 34.0522,
      longitude: -118.2437,
      properties: { cameraId: 'la-1', road: 'I-5', freshness: 'unknown' },
    }),
  })
  const ny511 = buildAreaLiveOfficialViewerMedia({
    locationState: 'PROVIDER_AUTH_REQUIRED',
    coveringProviders: [{ id: '511ny', agency: '511NY', bbox: { west: -79.25, south: 40.4, east: -71.8, north: 45.1 }, endpointType: 'OFFICIAL_VIEWER', viewerUrl: NY511_OFFICIAL_VIEWER }],
    origin: { latitude: 40.7128, longitude: -74.006, label: 'New York City' },
  })
  const nyFeature = buildAreaLiveCameraMedia({
    feature: camera({
      id: 'fake-nyc',
      providerId: 'ny511_cameras',
      latitude: 40.7128,
      longitude: -74.006,
      properties: { imageUrl: 'https://example.invalid/fake.jpg', viewerUrl: NY511_OFFICIAL_VIEWER },
    }),
  })
  const quebec = buildAreaLiveCameraMedia({
    feature: camera({
      id: 'qc-1',
      providerId: 'quebec_511_cameras',
      latitude: 46.8139,
      longitude: -71.208,
      properties: { viewerUrl: 'https://www.quebec511.info/' },
    }),
  })
  const facts = ohgo ? areaLiveObservedFacts(ohgo) : ''
  const youtube = buildAreaLiveIntelMedia({
    id: 'akron-yt-1',
    headline: 'Verified local video',
    source: 'Official feed',
    provider: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    location: 'Akron, Ohio',
    lat: 41.0814,
    lon: -81.519,
    originalLanguage: 'en',
    verificationState: 'VERIFIED',
    timestamp: '2026-09-16T18:00:00.000Z',
    retrievedAt: '2026-09-16T18:05:00.000Z',
    mediaPreview: {
      type: 'YT_MUTE_EMBED',
      youtubeVideoId: 'jNQXAC9IVRw',
      posterUrl: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
      accessClass: 'PUBLIC',
      provenance: { provider: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', retrievedAt: '2026-09-16T18:05:00.000Z' },
    },
  })
  const guessed = buildAreaLiveIntelMedia({
    id: 'guessed',
    headline: 'No video',
    source: 'Local paper',
    provider: 'rss',
    sourceUrl: 'https://example.invalid/story',
    location: 'Akron, Ohio',
    lat: 41.0814,
    lon: -81.519,
    originalLanguage: 'en',
    verificationState: 'UNVERIFIED',
    timestamp: null,
    retrievedAt: '2026-09-16T18:05:00.000Z',
  })
  return [
    check('ohgo_is_camera_still', ohgo?.kind === 'CAMERA_STILL' && Boolean(ohgo?.stillHref?.includes('/api/terra/camera-image?provider=ohgo_cameras')), ohgo?.kind ?? 'null'),
    check('ohgo_catalog_live_capture_unknown', ohgo?.catalogStatus === 'LIVE' && ohgo?.captureFreshness === 'UNKNOWN' && ohgo?.captureTimestamp == null, `${ohgo?.catalogStatus}/${ohgo?.captureFreshness}`),
    check('ohgo_agency_odod', Boolean(ohgo?.provider.includes('OHGO') && ohgo?.agency.includes('ODOT')), `${ohgo?.provider}/${ohgo?.agency}`),
    check('caltrans_is_camera_still', caltrans?.kind === 'CAMERA_STILL' && Boolean(caltrans?.stillHref?.includes('caltrans_cctv')), caltrans?.kind ?? 'null'),
    check('ny511_official_viewer_only', ny511?.kind === 'OFFICIAL_VIEWER' && ny511?.stillHref === null && ny511?.officialViewerUrl === NY511_OFFICIAL_VIEWER, `${ny511?.kind}/${ny511?.stillHref}`),
    check('ny511_partial_auth_label', Boolean(ny511?.catalogStatus.includes('PROVIDER_AUTH_REQUIRED')), ny511?.catalogStatus ?? 'null'),
    check('ny511_feature_does_not_invent_still', nyFeature?.kind === 'OFFICIAL_VIEWER' && nyFeature?.stillHref === null, `${nyFeature?.kind}/${nyFeature?.stillHref}`),
    check('quebec_html_viewer_no_still', quebec?.kind === 'OFFICIAL_VIEWER' && quebec?.stillHref === null, `${quebec?.kind}/${quebec?.stillHref}`),
    check('observed_facts_do_not_promote_retrieval_to_capture', facts.includes('CAPTURE TIME: UNKNOWN') && facts.includes('RETRIEVAL TIME: 2026-09-16T18:00:00.000Z') && facts.includes('LAYER: Observed Data'), facts.slice(0, 180)),
    check('ohgo_can_send_to_council', canSendAreaLiveToCouncil(ohgo), String(Boolean(ohgo))),
    check('ohgo_has_intel_fields', ohgo?.intelItemId === null && ohgo?.youtubeVideoId === null, `${ohgo?.intelItemId}/${ohgo?.youtubeVideoId}`),
    check('youtube_from_verified_id', youtube.kind === 'YOUTUBE' && youtube.youtubeVideoId === 'jNQXAC9IVRw' && Boolean(youtube.embedUrl?.includes('/embed/jNQXAC9IVRw?autoplay=1&mute=1')), `${youtube.kind}/${youtube.embedUrl}`),
    check('youtube_stored_embed_never_unmutes', Boolean(youtube.embedUrl?.includes('mute=1') && !youtube.embedUrl.includes('mute=0')), youtube.embedUrl ?? 'none'),
    check('expand_false_youtube_src_is_mute', areaLiveYoutubeIframeSrc('jNQXAC9IVRw', false).includes('mute=1') && !areaLiveYoutubeIframeSrc('jNQXAC9IVRw', false).includes('mute=0'), areaLiveYoutubeIframeSrc('jNQXAC9IVRw', false)),
    check('play_true_is_only_audible_transition', areaLiveCommanderAudible(true) && areaLiveYoutubeIframeSrc('jNQXAC9IVRw', true).includes('mute=0'), areaLiveYoutubeIframeSrc('jNQXAC9IVRw', true)),
    check('native_default_muted', areaLiveNativeVideoMuted(false) === true && areaLiveCommanderAudible(false) === false, 'muted until play'),
    check('youtube_is_playable_video', isAreaLivePlayableVideo(youtube.kind), youtube.kind),
    check('story_without_video_is_not_invented_stream', guessed.kind === 'POSTER_ONLY' && guessed.youtubeVideoId === null && guessed.streamHref === null, `${guessed.kind}/${guessed.youtubeVideoId}`),
  ]
}

export function runAreaLiveMediaValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Area Live camera media: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

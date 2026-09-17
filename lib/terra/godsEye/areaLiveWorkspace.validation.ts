/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEye/areaLiveWorkspace.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { areaLiveCoverageTruth, composeAreaLiveWorkspace, formatAreaLiveCount, formatAreaLiveHeader } from './areaLiveWorkspace'
import type { NearbyPublicCamera } from './nearbyCameras'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function camera(partial: Partial<NearbyPublicCamera> & Pick<NearbyPublicCamera, 'id'>): NearbyPublicCamera {
  return {
    layerId: 'ohgo_cameras',
    title: partial.title ?? 'I-77 at I-271',
    agency: 'ODOT',
    provider: 'ohgo_cameras',
    distanceKm: 2.6,
    road: 'I-77 at I-271',
    location: 'Richfield',
    direction: null,
    freshness: 'still_image',
    catalogStatus: 'LIVE',
    imageCaptureFreshness: 'UNKNOWN',
    feedState: 'UNAVAILABLE',
    latitude: 41.2398,
    longitude: -81.6382,
    ...partial,
  }
}

function run(): CaseResult[] {
  const akron = composeAreaLiveWorkspace({
    originLabel: 'Akron, Ohio',
    origin: { latitude: 41.0814, longitude: -81.519 },
    cameras: [camera({ id: 'ohgo-1' })],
    cameraCount: 66,
    cameraIndexLoaded: true,
    locationState: 'COVERED',
    coveringLabel: 'OHGO / ODOT',
    intelPending: false,
    mediaItems: [{
      id: 'story-1',
      headline: 'Local story',
      source: 'Akron station',
      provider: 'rss',
      sourceUrl: 'https://example.invalid/story',
      location: 'Akron',
      lat: 41.0814,
      lon: -81.519,
      originalLanguage: 'en',
      verificationState: 'UNVERIFIED',
      timestamp: '2026-09-16T18:00:00.000Z',
      retrievedAt: '2026-09-16T18:05:00.000Z',
    }],
    eventItems: [],
    filter: 'ALL',
  })
  const pending = composeAreaLiveWorkspace({
    originLabel: 'Akron, Ohio',
    origin: { latitude: 41.0814, longitude: -81.519 },
    cameras: [],
    cameraCount: 0,
    cameraIndexLoaded: false,
    locationState: 'COVERED',
    coveringLabel: 'OHGO / ODOT',
    intelPending: true,
    mediaItems: [],
    eventItems: [],
    filter: 'ALL',
  })
  const nyc = composeAreaLiveWorkspace({
    originLabel: 'New York City',
    origin: { latitude: 40.7128, longitude: -74.006 },
    cameras: [],
    cameraCount: 0,
    cameraIndexLoaded: true,
    locationState: 'PROVIDER_AUTH_REQUIRED',
    coveringLabel: '511NY',
    officialViewerUrl: 'https://511ny.org/',
    intelPending: false,
    mediaItems: [],
    eventItems: [],
    filter: 'CAMERAS',
  })
  const tokyo = areaLiveCoverageTruth('NO_COVERAGE')
  return [
    check('akron_header', akron.headerLabel === 'AREA LIVE · AKRON, OHIO', akron.headerLabel),
    check('akron_camera_count_is_real', akron.counts.cameras.known && akron.counts.cameras.value === 66, JSON.stringify(akron.counts.cameras)),
    check('akron_live_video_zero_when_no_verified_video', akron.counts.liveVideo.known && akron.counts.liveVideo.value === 0, JSON.stringify(akron.counts.liveVideo)),
    check('akron_media_count', akron.counts.media.known && akron.counts.media.value === 1, JSON.stringify(akron.counts.media)),
    check('akron_nearby_has_camera_row', akron.rows.some(row => row.kind === 'CAMERA' && row.cameraRef?.id === 'ohgo-1'), akron.rows.map(row => row.kind).join(',')),
    check('pending_intel_is_available_not_zero', formatAreaLiveCount(pending.counts.media) === 'AVAILABLE' && formatAreaLiveCount(pending.counts.liveVideo) === 'AVAILABLE', `${formatAreaLiveCount(pending.counts.media)}/${formatAreaLiveCount(pending.counts.liveVideo)}`),
    check('nyc_provider_auth', nyc.coverageState === 'PROVIDER_AUTH_REQUIRED' && nyc.rows.length === 0, `${nyc.coverageState}/${nyc.rows.length}`),
    check('tokyo_no_verified_provider', tokyo === 'NO_VERIFIED_PROVIDER', tokyo),
    check('header_without_location', formatAreaLiveHeader(null) === 'AREA LIVE · NO ACTIVE LOCATION', formatAreaLiveHeader(null)),
  ]
}

export function runAreaLiveWorkspaceValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = run()
  const failed = results.filter(result => !result.pass)
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Area Live workspace: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

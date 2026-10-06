import {
  buildTrafficCameraCouncilHandoff,
  cameraLicensePolicyForProvider,
  canRetainTrafficCameraFrame,
  lawfulCurrentFrameReference,
  normalizeTerraTrafficCamera,
  radarCameraDeltaMs,
  restrictiveCameraLicensePolicy,
} from './trafficCameraContract'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail })

const snapshot = normalizeTerraTrafficCamera({
  id: 'C1503503',
  title: 'E18 · Helsinki',
  providerId: 'digitraffic_road_cameras',
  layerId: 'digitraffic_road_cameras',
  latitude: 60.2,
  longitude: 24.9,
  timestamp: '2026-09-18T18:07:32Z',
  properties: {
    imageUrl: 'https://weathercam.digitraffic.fi/C1503503.jpg',
    feedType: 'still',
    freshness: 'LIVE',
    collectionIntervalSec: 60,
    road: 'E18',
  },
  provenance: {
    provider: 'Fintraffic',
    sourceUrl: 'https://www.digitraffic.fi/',
    retrievedAt: '2026-09-18T18:08:00Z',
  },
})

check('snapshot_transport', snapshot.transport === 'SNAPSHOT', snapshot.transport)
check('snapshot_timestamp', snapshot.observedAt === '2026-09-18T18:07:32Z', String(snapshot.observedAt))
check('snapshot_refresh', snapshot.expectedRefreshSeconds === 60, String(snapshot.expectedRefreshSeconds))
check('snapshot_frame_reference_lawful', lawfulCurrentFrameReference(snapshot) !== null, String(lawfulCurrentFrameReference(snapshot)))
check('snapshot_cache_bounded', canRetainTrafficCameraFrame(snapshot) && snapshot.licensePolicy.maxCacheAgeSeconds === 60, JSON.stringify(snapshot.licensePolicy))

const unknownProvider = normalizeTerraTrafficCamera({
  id: 'private-1',
  title: 'Unknown source',
  providerId: 'unknown_provider',
  latitude: 1,
  longitude: 2,
  properties: { imageUrl: 'https://example.invalid/frame.jpg', freshness: 'LIVE' },
})
check('unknown_policy_restrictive', Object.values(restrictiveCameraLicensePolicy()).every(value => value === false || value === 0 || value === 1 || value === true), JSON.stringify(unknownProvider.licensePolicy))
check('unknown_media_blocked', unknownProvider.transport === 'UNAVAILABLE' && unknownProvider.freshness === 'LICENSE_RESTRICTED' && unknownProvider.mediaUrl === null, `${unknownProvider.transport}/${unknownProvider.freshness}`)
check('ontario_defaults_restrictive', !cameraLicensePolicyForProvider('ontario_511_cameras').proxyAllowed, JSON.stringify(cameraLicensePolicyForProvider('ontario_511_cameras')))

const hls = normalizeTerraTrafficCamera({
  id: 'licensed-hls',
  title: 'Licensed HLS',
  providerId: 'digitraffic_road_cameras',
  latitude: 60,
  longitude: 25,
  properties: { streamUrl: 'https://weathercam.digitraffic.fi/example.m3u8', feedType: 'HLS', freshness: 'RECENT' },
})
check('hls_transport', hls.transport === 'HLS', hls.transport)

const delta = radarCameraDeltaMs('2026-09-18T18:05:00Z', snapshot.observedAt)
check('radar_delta', delta === 152_000, String(delta))

const handoff = buildTrafficCameraCouncilHandoff({
  camera: snapshot,
  radarAt: '2026-09-18T18:05:00Z',
  radarProvider: 'IEM / NEXRAD',
})
check('handoff_normalized', handoff.observedFacts.includes('TRANSPORT: SNAPSHOT') && handoff.observedFacts.includes('RADAR/CAMERA DELTA MS: 152000'), handoff.observedFacts)
check('handoff_classification_contract', handoff.commanderPrompt.includes('OBSERVED') && handoff.commanderPrompt.includes('INFERRED') && handoff.commanderPrompt.includes('UNKNOWN'), handoff.commanderPrompt)
check('handoff_no_secret_fields', !/\bBearer\s+\S+|sk-[A-Za-z0-9]+|xai-[A-Za-z0-9]+|AIza[A-Za-z0-9_-]+|^COOKIE:|^AUTHORIZATION:/im.test(handoff.observedFacts), 'redacted normalized evidence')
check('vision_one_current_frame', handoff.observedFacts.includes('VISION ATTACHMENT LIMIT: at most this one current lawful frame'), 'bounded frame')

const radarAwareHandoff = buildTrafficCameraCouncilHandoff({
  camera: snapshot,
  radarAt: '2026-09-18T18:05:00Z',
  radarProvider: 'IEM / NEXRAD',
  radarStatus: 'ACTIVE',
  radarEchoState: 'NO_PRECIP',
})
check('handoff_carries_radar_truth_state', radarAwareHandoff.observedFacts.includes('RADAR STATUS: ACTIVE') && radarAwareHandoff.observedFacts.includes('RADAR PRECIPITATION STATE: NO_PRECIP'), 'radar truth state')
check('handoff_separates_no_precip_from_no_data', /NO_PRECIP means measured and clear; NO_DATA means not measured/.test(radarAwareHandoff.observedFacts), 'echo semantics')
check('handoff_denies_simultaneous_capture', /not captured simultaneously/i.test(radarAwareHandoff.observedFacts), 'simultaneity disclaimer')

const rateLimited = normalizeTerraTrafficCamera({
  id: 'throttled-1',
  title: 'Throttled camera',
  providerId: 'digitraffic_road_cameras',
  latitude: 60,
  longitude: 25,
  properties: { imageUrl: 'https://weathercam.digitraffic.fi/x.jpg', feedType: 'still', freshness: 'RATE_LIMITED' },
})
check('rate_limited_is_its_own_state', rateLimited.freshness === 'RATE_LIMITED', rateLimited.freshness)
check('rate_limited_frame_is_not_treated_as_current', lawfulCurrentFrameReference(rateLimited) === null, String(lawfulCurrentFrameReference(rateLimited)))

const noData = normalizeTerraTrafficCamera({
  id: 'empty-1',
  title: 'Wired provider, no reading',
  providerId: 'digitraffic_road_cameras',
  latitude: 60,
  longitude: 25,
  properties: { imageUrl: 'https://weathercam.digitraffic.fi/y.jpg', feedType: 'still', freshness: 'NO_DATA' },
})
check('no_data_is_its_own_state', noData.freshness === 'NO_DATA', noData.freshness)
check('no_data_is_not_no_coverage', noData.freshness !== 'NO_COVERAGE', `${noData.freshness}`)
check('no_data_frame_is_not_treated_as_current', lawfulCurrentFrameReference(noData) === null, String(lawfulCurrentFrameReference(noData)))
check('no_data_is_not_cached_as_last_good', !canRetainTrafficCameraFrame(noData), 'retained')

let failed = 0
for (const result of results) {
  if (!result.pass) failed += 1
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
}
console.log(`Terra traffic camera contract: ${results.length - failed}/${results.length} ${failed ? 'FAIL' : 'PASS'}`)
if (failed) process.exit(1)

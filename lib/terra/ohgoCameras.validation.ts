/**
 * Offline regression for OHGO / NY / Caltrans mapping + missing-key behavior.
 * Does NOT substitute cameras into the Terra layer. The adapters themselves are live HTTP
 * clients (ohgo_cameras.ts / ny511_cameras.ts / caltrans_cwwp2_cameras.ts).
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/ohgoCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { mapOhgoCamerasToDocuments, ohgoApiKey, ohgoCamerasAdapter, __resetOhgoCatalogCacheForTests } from '@/lib/research-engine/providers/ohgo_cameras'
import { mapNy511CamerasToDocuments, ny511ApiKey } from '@/lib/research-engine/providers/ny511_cameras'
import { mapCaltransCctvToDocuments } from '@/lib/research-engine/providers/caltrans_cwwp2_cameras'
import { allowThrottledRequest, __resetProviderRequestThrottleForTests } from './providerRequestThrottle'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  __resetOhgoCatalogCacheForTests()

  results.push(check('ohgo_key_empty_without_env', ohgoApiKey({}) === '', 'empty'))
  results.push(check('ohgo_key_reads_server_env_only', ohgoApiKey({ OHGO_API_KEY: ' test-key ' }) === 'test-key', 'trimmed'))

  const now = '2026-09-17T00:00:00.000Z'
  const docs = mapOhgoCamerasToDocuments([
    {
      Id: '42',
      Latitude: 39.1,
      Longitude: -84.5,
      Location: 'I-71 at 3rd Street',
      CameraViews: [
        { Direction: 'NB', MainRoute: 'I-71', LargeUrl: 'https://publicapi.ohgo.com/large.jpg', SmallUrl: 'https://publicapi.ohgo.com/small.jpg' },
        { Direction: 'PTZ', MainRoute: 'I-71', SmallUrl: 'https://publicapi.ohgo.com/small2.jpg' },
      ],
    },
    { Id: 'out', Latitude: 40.7, Longitude: -74.0, Location: 'Manhattan — must be bbox-filtered' },
  ], { lamin: 39.0, lomin: -84.6, lamax: 39.3, lomax: -84.3 }, now, 80)

  results.push(check('multi_view_emits_indexed_ids', docs.some(d => d.providerRecordId === 'ohgo:42:0') && docs.some(d => d.providerRecordId === 'ohgo:42:1'), docs.map(d => d.providerRecordId).join(',')))
  results.push(check('prefers_large_url', docs.find(d => d.providerRecordId === 'ohgo:42:0')?.identifiers.imageUrl === 'https://publicapi.ohgo.com/large.jpg', 'LargeUrl'))
  results.push(check('falls_back_to_small_url', docs.find(d => d.providerRecordId === 'ohgo:42:1')?.identifiers.imageUrl === 'https://publicapi.ohgo.com/small2.jpg', 'SmallUrl'))
  results.push(check('ptz_has_no_bearing', docs.find(d => d.providerRecordId === 'ohgo:42:1')?.identifiers.direction === 'PTZ' && docs.find(d => d.providerRecordId === 'ohgo:42:1')?.identifiers.bearing === undefined, 'PTZ'))
  results.push(check('bbox_filters_out_of_ohio_point', !docs.some(d => d.providerRecordId?.includes('out')), 'filtered'))
  results.push(check('catalog_freshness_is_unavailable', docs.every(d => d.identifiers.freshnessState === 'UNAVAILABLE'), docs.map(d => d.identifiers.freshnessState).join(',')))
  results.push(check('stream_url_never_set', docs.every(d => !d.identifiers.streamUrl), 'no stream'))

  const previous = process.env.OHGO_API_KEY
  delete process.env.OHGO_API_KEY
  try {
    const response = await ohgoCamerasAdapter.run({ text: '39.00,-84.60,39.30,-84.30', maxResults: 5 })
    results.push(check('adapter_without_key_is_not_configured_not_provider_dead', !response.ok && response.error?.category === 'not_configured' && (response.error.message.includes('OHGO_API_KEY')), JSON.stringify({ ok: response.ok, category: response.error?.category, message: response.error?.message })))
    results.push(check('adapter_without_key_does_not_return_live_cameras', !response.ok && response.documents.length === 0, `ok=${response.ok} n=${response.documents.length}`))
  } finally {
    if (previous !== undefined) process.env.OHGO_API_KEY = previous
  }

  results.push(check('ny_key_reads_numeric_env_name', ny511ApiKey({ '511NY_API_KEY': 'abc' }) === 'abc', '511NY_API_KEY'))
  const nyDocs = mapNy511CamerasToDocuments([
    { ID: '7', Name: 'I-87 NB', Latitude: 40.8, Longitude: -73.9, Url: 'https://511ny.org/still.jpg', VideoUrl: 'https://511ny.org/video/7', Disabled: false },
    { ID: '8', Name: 'Blocked cam', Latitude: 40.81, Longitude: -73.91, Url: 'https://511ny.org/still2.jpg', Disabled: true },
  ], { lamin: 40.6, lomin: -74.1, lamax: 40.9, lomax: -73.8 }, now, 80)
  results.push(check('ny_id_is_511ny_prefixed', nyDocs[0]?.providerRecordId === '511ny:7', String(nyDocs[0]?.providerRecordId)))
  results.push(check('ny_video_url_is_viewer_not_stream', nyDocs[0]?.identifiers.viewerUrl === 'https://511ny.org/video/7' && !nyDocs[0]?.identifiers.streamUrl, String(nyDocs[0]?.identifiers.viewerUrl)))
  results.push(check('ny_disabled_is_offline', nyDocs.find(d => d.providerRecordId === '511ny:8')?.identifiers.freshnessState === 'OFFLINE', 'disabled'))

  const calDocs = mapCaltransCctvToDocuments([
    { index: 1, inService: true, location: { locationName: 'I-10 at Citrus', latitude: 34.05, longitude: -118.25, route: 'I-10', direction: 'EB' }, imageData: { currentImageURL: 'https://cwwp2.dot.ca.gov/still.jpg', currentImageUpdateFrequency: 30, streamingVideoURL: 'https://cwwp2.dot.ca.gov/stream' } },
    { index: 2, inService: false, location: { locationName: 'Offline', latitude: 34.06, longitude: -118.26, route: 'I-10' }, imageData: { currentImageURL: 'https://cwwp2.dot.ca.gov/off.jpg' } },
  ], { lamin: 33.9, lomin: -118.4, lamax: 34.2, lomax: -118.1 }, now, 80, 'd7')
  results.push(check('caltrans_id_includes_district', calDocs[0]?.providerRecordId === 'caltrans:d7:1', String(calDocs[0]?.providerRecordId)))
  results.push(check('caltrans_stream_is_viewer_link_out', calDocs[0]?.identifiers.viewerUrl === 'https://cwwp2.dot.ca.gov/stream', String(calDocs[0]?.identifiers.viewerUrl)))
  results.push(check('caltrans_out_of_service_is_offline', calDocs.find(d => d.providerRecordId === 'caltrans:d7:2')?.identifiers.freshnessState === 'OFFLINE', 'inService false'))

  __resetProviderRequestThrottleForTests()
  const allowed = Array.from({ length: 10 }, () => allowThrottledRequest('ny511_cameras', 10, 60_000, 1_000))
  const eleventh = allowThrottledRequest('ny511_cameras', 10, 60_000, 1_000)
  results.push(check('ny_throttle_allows_ten_per_minute', allowed.every(Boolean) && eleventh === false, `allowed=${allowed.filter(Boolean).length} eleventh=${eleventh}`))

  return results
}

export async function runOhgoCamerasValidation(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runOhgoCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra ohgoCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

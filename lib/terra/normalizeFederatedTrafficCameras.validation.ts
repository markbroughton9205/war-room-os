/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeFederatedTrafficCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeOhgoTrafficCameras, normalizeNy511TrafficCameras, normalizeCaltransTrafficCameras } from './normalizeFederatedTrafficCameras'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}, identifiers: Record<string, string> = {}): ResearchDocument {
  return {
    id: 'ohgo:42',
    provider: 'ohgo_cameras',
    providerRecordId: 'ohgo:42',
    title: 'I-71 at 3rd — I-71',
    summary: 'I-71',
    contentSnippet: 'lat 39.1, lon -84.5',
    canonicalUrl: 'https://publicapi.ohgo.com/api/v1/cameras/42',
    sourceUrl: 'https://publicapi.ohgo.com/api/v1/cameras',
    sourceName: 'ODOT / OHGO',
    contentType: 'traffic_camera',
    authors: [],
    organization: 'ODOT',
    publishedAt: null,
    updatedAt: '2026-09-17T00:00:00.000Z',
    retrievedAt: '2026-09-17T00:00:00.000Z',
    geography: 'lat 39.1, lon -84.5',
    language: 'en',
    identifiers: {
      latitude: '39.1',
      longitude: '-84.5',
      locationName: 'I-71 at 3rd',
      provider: 'ohgo',
      agency: 'ODOT',
      country: 'US',
      region: 'OH',
      feedType: 'REFRESHED_IMAGE',
      freshnessState: 'UNAVAILABLE',
      coverageState: 'UNAVAILABLE',
      authState: 'PUBLIC_KEY_REQUIRED',
      attribution: 'ODOT / OHGO',
      road: 'I-71',
      direction: 'NB',
      imageUrl: 'https://publicapi.ohgo.com/example.jpg',
      ...identifiers,
    },
    subjects: [],
    license: 'OHGO Public API',
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'ohgo_cameras', sourceUrl: 'https://publicapi.ohgo.com/api/v1/cameras', retrievedAt: '2026-09-17T00:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ohgo = normalizeOhgoTrafficCameras([makeDoc()])
  const event = ohgo.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('ohgo_normalizes', ohgo.events.length === 1 && ohgo.skippedCount === 0, `events=${ohgo.events.length}`))
  results.push(check('ohgo_kind_and_provider', event?.kind === 'traffic_camera' && event?.providerId === 'ohgo_cameras', `${event?.kind}/${event?.providerId}`))
  results.push(check('ohgo_id_is_federated', event?.id === 'ohgo:42', String(event?.id)))
  results.push(check('ohgo_schema_locked_fields', props?.agency === 'ODOT' && props?.region === 'OH' && props?.feedType === 'REFRESHED_IMAGE' && props?.streamUrl === null && props?.authState === 'PUBLIC_KEY_REQUIRED' && props?.attribution === 'ODOT / OHGO', JSON.stringify(props)))
  results.push(check('ohgo_catalog_freshness_is_unavailable_not_live', props?.freshnessState === 'UNAVAILABLE' && props?.freshness !== 'live_video' && props?.freshness !== 'still_image', String(props?.freshnessState)))
  results.push(check('ohgo_poll_clock_is_not_used_as_last_updated', props?.lastUpdated === null, String(props?.lastUpdated)))

  const ny = normalizeNy511TrafficCameras([makeDoc({
    id: '511ny:99',
    provider: 'ny511_cameras',
    providerRecordId: '511ny:99',
    provenance: { provider: 'ny511_cameras', sourceUrl: 'https://511ny.org/api/getcameras', retrievedAt: '2026-09-17T00:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
  }, {
    provider: '511ny',
    agency: 'New York State',
    region: 'NY',
    attribution: 'powered by 511NY',
    viewerUrl: 'https://511ny.org/video/99',
    freshnessState: 'OFFLINE',
    coverageState: 'OFFLINE',
    latitude: '40.75',
    longitude: '-73.99',
  })])
  const nyProps = ny.events[0]?.properties as Record<string, unknown> | undefined
  results.push(check('ny_video_url_is_viewer_link_out_only', nyProps?.viewerUrl === 'https://511ny.org/video/99' && nyProps?.streamUrl === null, String(nyProps?.viewerUrl)))
  results.push(check('ny_disabled_is_offline_never_live', nyProps?.freshnessState === 'OFFLINE' && nyProps?.freshness === 'offline', String(nyProps?.freshnessState)))
  results.push(check('ny_attribution_is_powered_by_511ny', nyProps?.attribution === 'powered by 511NY', String(nyProps?.attribution)))

  const cal = normalizeCaltransTrafficCameras([makeDoc({
    id: 'caltrans:d8:1',
    provider: 'caltrans_cwwp2_cameras',
    providerRecordId: 'caltrans:d8:1',
    provenance: { provider: 'caltrans_cwwp2_cameras', sourceUrl: 'https://cwwp2.dot.ca.gov/data/d8/cctv/cctvStatusD08.json', retrievedAt: '2026-09-17T00:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
  }, {
    provider: 'caltrans',
    agency: 'Caltrans',
    region: 'CA',
    authState: 'PUBLIC_NO_AUTH',
    attribution: 'Caltrans CWWP2',
    collectionIntervalSec: '30',
    latitude: '34.05',
    longitude: '-118.25',
    freshnessState: 'UNAVAILABLE',
    coverageState: 'UNAVAILABLE',
  })])
  const calProps = cal.events[0]?.properties as Record<string, unknown> | undefined
  results.push(check('caltrans_interval_survives', calProps?.collectionIntervalSec === 30, String(calProps?.collectionIntervalSec)))
  results.push(check('caltrans_auth_is_public_no_auth', calProps?.authState === 'PUBLIC_NO_AUTH', String(calProps?.authState)))

  const bad = normalizeOhgoTrafficCameras([makeDoc({}, { latitude: '91', longitude: '-84.5' })])
  results.push(check('out_of_range_latitude_is_skipped', bad.events.length === 0 && bad.skippedCount === 1, 'skipped'))

  return results
}

export function runNormalizeFederatedTrafficCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeFederatedTrafficCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeFederatedTrafficCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

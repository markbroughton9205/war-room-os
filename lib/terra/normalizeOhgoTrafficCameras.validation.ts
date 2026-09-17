/**
 * Deterministic regression suite for the OHGO traffic-camera normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeOhgoTrafficCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeOhgoTrafficCameras } from './normalizeFederatedTrafficCameras'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'ohgo:00000000000102',
    provider: 'ohgo_cameras',
    providerRecordId: 'ohgo:00000000000102',
    title: 'SR-8 at SR-18 / E Market St, 6052 — SR-8',
    summary: 'SR-8',
    contentSnippet: 'lat 41.079871, lon -81.504079',
    canonicalUrl: 'https://publicapi.ohgo.com/api/v1/cameras/00000000000102',
    sourceUrl: 'https://publicapi.ohgo.com/api/v1/cameras',
    sourceName: 'ODOT / OHGO',
    contentType: 'traffic_camera',
    authors: [],
    organization: 'ODOT',
    publishedAt: null,
    updatedAt: '2026-09-17T01:02:05.000Z',
    retrievedAt: '2026-09-17T01:02:10.000Z',
    geography: 'lat 41.079871, lon -81.504079',
    language: 'en',
    identifiers: {
      cameraId: 'ohgo:00000000000102',
      siteId: '00000000000102',
      imagePath: 'akron/sample.jpg',
      latitude: '41.079871',
      longitude: '-81.504079',
      imageUrl: 'https://itscameras.dot.state.oh.us/images/akron/sample.jpg',
      agency: 'ODOT',
      road: 'SR-8',
      locationName: 'SR-8 at SR-18 / E Market St, 6052',
      direction: 'EAST',
      bearing: '90',
      freshnessState: 'UNAVAILABLE',
      coverageState: 'UNAVAILABLE',
      authState: 'PUBLIC_KEY_REQUIRED',
      attribution: 'ODOT / OHGO',
    },
    subjects: [],
    license: 'OHGO Public API — https://publicapi.ohgo.com/docs/terms-of-use',
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'ohgo_cameras', sourceUrl: 'https://publicapi.ohgo.com/api/v1/cameras', retrievedAt: '2026-09-17T01:02:10.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeOhgoTrafficCameras([makeDoc()])
  results.push(check('valid_camera_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length} skipped=${ok.skippedCount}`))
  const event = ok.events[0]
  const properties = (event?.properties ?? {}) as Record<string, unknown>
  results.push(check('kind_is_traffic_camera', event?.kind === 'traffic_camera' && event?.providerId === 'ohgo_cameras', `kind=${event?.kind}`))
  results.push(check('geography_is_source_embedded_point', event?.geography?.kind === 'point' && event?.geography?.coordinateOrigin === 'source_embedded', event?.geography?.kind ?? 'none'))
  results.push(check('image_path_is_preserved', properties.imagePath === 'akron/sample.jpg', String(properties.imagePath)))
  results.push(check('agency_is_odot', properties.agency === 'ODOT', String(properties.agency)))
  results.push(check('direction_is_sourced', properties.direction === 'EAST', String(properties.direction)))
  results.push(check('bearing_is_sourced_cardinal', properties.bearing === 90, String(properties.bearing)))
  results.push(check('freshness_is_honestly_unknown', properties.freshness === 'unknown' && properties.freshnessState === 'UNAVAILABLE', String(properties.freshness)))
  results.push(check('coverage_is_regional', properties.coverage === 'REGIONAL / PROVIDER_DEPENDENT', String(properties.coverage)))

  const badLat = normalizeOhgoTrafficCameras([makeDoc({ identifiers: { latitude: '95', longitude: '-81.5' } })])
  results.push(check('out_of_range_latitude_is_skipped', badLat.events.length === 0 && badLat.skippedCount === 1, `events=${badLat.events.length}`))

  const missing = normalizeOhgoTrafficCameras([makeDoc({ identifiers: {} })])
  results.push(check('missing_coordinates_are_skipped', missing.events.length === 0 && missing.skippedCount === 1, 'no coords'))

  return results
}

export function runNormalizeOhgoTrafficCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeOhgoTrafficCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeOhgoTrafficCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

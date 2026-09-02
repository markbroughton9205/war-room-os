/**
 * Deterministic regression suite for the Hong Kong traffic-camera normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeHongKongTrafficCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeHongKongTrafficCameras } from './normalizeHongKongTrafficCameras'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'hong_kong_td_cameras:BC101F',
    provider: 'hong_kong_td_cameras',
    providerRecordId: 'BC101F',
    title: 'Connaught Road Central near City Hall [BC101F]',
    summary: 'Central and Western — Hong Kong Island',
    contentSnippet: 'lat 22.2818, lon 114.1587',
    canonicalUrl: 'https://tdcctv.data.one.gov.hk/BC101F.JPG',
    sourceUrl: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv',
    sourceName: 'Hong Kong Transport Department (data.gov.hk)',
    contentType: 'traffic_camera',
    authors: [],
    organization: 'Transport Department, Government of the Hong Kong SAR',
    publishedAt: null,
    updatedAt: null,
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 22.2818, lon 114.1587',
    language: 'en',
    identifiers: { cameraId: 'BC101F', latitude: '22.2818', longitude: '114.1587', imageUrl: 'https://tdcctv.data.one.gov.hk/BC101F.JPG' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'hong_kong_td_cameras', sourceUrl: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeHongKongTrafficCameras([makeDoc()])
  results.push(check('valid_camera_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length} skipped=${ok.skippedCount}`))
  const event = ok.events[0]
  results.push(check('kind_is_traffic_camera', event?.kind === 'traffic_camera' && event?.providerId === 'hong_kong_td_cameras', `kind=${event?.kind}`))
  results.push(check('geography_is_source_embedded_point', event?.geography?.kind === 'point' && event?.geography?.coordinateOrigin === 'source_embedded', event?.geography?.kind ?? 'none'))
  results.push(check('image_url_is_preserved', (event?.properties as Record<string, unknown>)?.imageUrl === 'https://tdcctv.data.one.gov.hk/BC101F.JPG', 'direct JPEG'))
  results.push(check('freshness_is_honestly_unknown', (event?.properties as Record<string, unknown>)?.freshness === 'unknown', 'no capture timestamp in source'))

  const badLat = normalizeHongKongTrafficCameras([makeDoc({ identifiers: { latitude: '95', longitude: '114.15' } })])
  results.push(check('out_of_range_latitude_is_skipped', badLat.events.length === 0 && badLat.skippedCount === 1, `events=${badLat.events.length}`))

  const missing = normalizeHongKongTrafficCameras([makeDoc({ identifiers: {} })])
  results.push(check('missing_coordinates_are_skipped', missing.events.length === 0 && missing.skippedCount === 1, 'no coords'))

  return results
}

export function runNormalizeHongKongTrafficCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeHongKongTrafficCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeHongKongTrafficCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

/**
 * Deterministic regression suite for the Ontario traffic-camera normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeOntarioTrafficCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeOntarioTrafficCameras } from './normalizeOntarioTrafficCameras'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'ontario_511_cameras:10001',
    provider: 'ontario_511_cameras',
    providerRecordId: '10001',
    title: 'QEW near Dixie Road — Eastbound',
    summary: 'QEW',
    contentSnippet: 'lat 43.6, lon -79.58',
    canonicalUrl: 'https://511on.ca/map/Cctv/10001',
    sourceUrl: 'https://511on.ca/map/Cctv/10001',
    sourceName: 'Ontario 511 (511on.ca)',
    contentType: 'traffic_camera',
    authors: [],
    organization: 'Government of Ontario / Ministry of Transportation',
    publishedAt: null,
    updatedAt: null,
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 43.6, lon -79.58',
    language: null,
    identifiers: { cameraId: '900', viewId: '10001', latitude: '43.6', longitude: '-79.58', imageUrl: 'https://511on.ca/map/Cctv/10001', road: 'QEW' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'ontario_511_cameras', sourceUrl: 'https://511on.ca/map/Cctv/10001', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeOntarioTrafficCameras([makeDoc()])
  results.push(check('valid_camera_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length}`))
  const event = ok.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('kind_is_traffic_camera', event?.kind === 'traffic_camera' && event?.providerId === 'ontario_511_cameras', `kind=${event?.kind}`))
  results.push(check('direct_jpeg_image_url_preserved', props?.imageUrl === 'https://511on.ca/map/Cctv/10001', 'live-verified direct JPEG'))
  results.push(check('freshness_is_honestly_unknown', props?.freshness === 'unknown', 'no capture timestamp in metadata'))
  results.push(check('geography_is_source_embedded_point', event?.geography?.kind === 'point' && event?.geography?.coordinateOrigin === 'source_embedded', 'point'))

  const bad = normalizeOntarioTrafficCameras([makeDoc({ identifiers: { latitude: '-91', longitude: '-79.5' } })])
  results.push(check('out_of_range_latitude_is_skipped', bad.events.length === 0 && bad.skippedCount === 1, 'skipped'))

  return results
}

export function runNormalizeOntarioTrafficCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeOntarioTrafficCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeOntarioTrafficCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

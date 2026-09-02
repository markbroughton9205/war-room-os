/**
 * Deterministic regression suite for the Québec traffic-camera normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeQuebecTrafficCameras.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeQuebecTrafficCameras } from './normalizeQuebecTrafficCameras'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'quebec_511_cameras:4057',
    provider: 'quebec_511_cameras',
    providerRecordId: '4057',
    title: 'Route 241 at boulevard de Bromont (Bromont)',
    summary: 'Route 241 à la hauteur du boulevard de Bromont (Bromont)',
    contentSnippet: 'lat 45.32044, lon -72.64774',
    canonicalUrl: 'https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=4057',
    sourceUrl: 'https://ws.mapserver.transports.gouv.qc.ca/swtq',
    sourceName: 'Québec 511 (MTMD)',
    contentType: 'traffic_camera',
    authors: [],
    organization: 'Ministère des Transports et de la Mobilité durable du Québec',
    publishedAt: null,
    updatedAt: null,
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 45.32044, lon -72.64774',
    language: 'en',
    identifiers: { cameraId: '4057', latitude: '45.32044', longitude: '-72.64774', road: '241', region: 'Estrie' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'quebec_511_cameras', sourceUrl: 'https://ws.mapserver.transports.gouv.qc.ca/swtq', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeQuebecTrafficCameras([makeDoc()])
  results.push(check('valid_camera_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length} skipped=${ok.skippedCount}`))
  const event = ok.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('kind_is_traffic_camera', event?.kind === 'traffic_camera' && event?.providerId === 'quebec_511_cameras', `kind=${event?.kind}`))
  results.push(check('image_url_is_never_fabricated_from_viewer_page', props?.imageUrl === null, `imageUrl=${JSON.stringify(props?.imageUrl)}`))
  results.push(check('viewer_url_is_preserved_as_provenance', props?.viewerUrl === 'https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=4057', 'viewer page kept'))
  results.push(check('freshness_is_honestly_unknown', props?.freshness === 'unknown', 'no capture timestamp in source'))

  const bad = normalizeQuebecTrafficCameras([makeDoc({ identifiers: { latitude: 'abc', longitude: '-72.6' } })])
  results.push(check('non_numeric_latitude_is_skipped', bad.events.length === 0 && bad.skippedCount === 1, 'malformed'))

  return results
}

export function runNormalizeQuebecTrafficCamerasValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeQuebecTrafficCamerasValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeQuebecTrafficCameras validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

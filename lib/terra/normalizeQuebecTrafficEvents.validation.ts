/**
 * Deterministic regression suite for the Québec traffic-event normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeQuebecTrafficEvents.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeQuebecTrafficEvents } from './normalizeQuebecTrafficEvents'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(rawGeography: string | undefined, overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'quebec_511_events:81387',
    provider: 'quebec_511_events',
    providerRecordId: '81387',
    title: 'chemin du Barrage sur le pont au-dessus de la rivière Blanche.',
    summary: 'Circulation en alternance — Mesures préventives',
    contentSnippet: 'OUEST et EST · Val-des-Monts · Indéterminée',
    canonicalUrl: 'https://www.quebec511.info/',
    sourceUrl: 'https://ws.mapserver.transports.gouv.qc.ca/swtq',
    sourceName: 'Québec 511 (MTMD)',
    contentType: 'traffic_event',
    authors: [],
    organization: 'Ministère des Transports et de la Mobilité durable du Québec',
    publishedAt: '2025-07-30T11:17:00.000Z',
    updatedAt: '2025-07-30T11:17:00.000Z',
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: null,
    language: 'fr',
    identifiers: {
      eventId: '81387',
      eventType: 'Circulation en alternance',
      ...(rawGeography ? { rawGeography } : {}),
      direction: 'OUEST et EST',
      municipality: 'Val-des-Monts',
      inForceSinceIso: '2025-07-30T11:17:00.000Z',
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'quebec_511_events', sourceUrl: 'https://ws.mapserver.transports.gouv.qc.ca/swtq', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const line = normalizeQuebecTrafficEvents([makeDoc(JSON.stringify({ type: 'LineString', coordinates: [[-75.6444, 45.6736], [-75.6439, 45.6739]] }))])
  results.push(check('linestring_event_normalizes_as_path', line.events.length === 1 && line.events[0]?.geography?.kind === 'path', `kind=${line.events[0]?.geography?.kind}`))
  results.push(check('path_coordinates_preserved_verbatim', line.events[0]?.geography?.kind === 'path' && (line.events[0]?.geography as { coordinates: number[][] }).coordinates.length === 2, '2 pairs'))
  results.push(check('french_vocabulary_preserved', (line.events[0]?.properties as Record<string, unknown>)?.eventType === 'Circulation en alternance', 'no translation'))

  const point = normalizeQuebecTrafficEvents([makeDoc(JSON.stringify({ type: 'Point', coordinates: [-73.55, 45.5] }))])
  results.push(check('point_event_normalizes_as_point', point.events.length === 1 && point.events[0]?.geography?.kind === 'point', `kind=${point.events[0]?.geography?.kind}`))

  const missing = normalizeQuebecTrafficEvents([makeDoc(undefined)])
  results.push(check('missing_geometry_is_skipped', missing.events.length === 0 && missing.skippedCount === 1, 'no geometry'))

  const malformed = normalizeQuebecTrafficEvents([makeDoc('not-json')])
  results.push(check('malformed_geometry_is_skipped', malformed.events.length === 0 && malformed.skippedCount === 1, 'bad json'))

  const polygon = normalizeQuebecTrafficEvents([makeDoc(JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0]]] }))])
  results.push(check('unsupported_geometry_type_is_skipped', polygon.events.length === 0 && polygon.skippedCount === 1, 'Polygon not claimed'))

  return results
}

export function runNormalizeQuebecTrafficEventsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeQuebecTrafficEventsValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeQuebecTrafficEvents validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

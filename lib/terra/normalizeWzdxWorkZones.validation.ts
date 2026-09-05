/**
 * Deterministic regression suite for the WZDx work-zone normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeWzdxWorkZones.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeWzdxWorkZones } from './normalizeWzdxWorkZones'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(provider: ResearchDocument['provider'], rawGeography: string | undefined): ResearchDocument {
  return {
    id: `${provider}:WZ-1`,
    provider,
    providerRecordId: 'WZ-1',
    title: 'Work zone WZ-1 — I-5',
    summary: 'I-5',
    contentSnippet: 'southbound · some_lanes_closed',
    canonicalUrl: 'https://example.invalid/feed',
    sourceUrl: 'https://example.invalid/feed',
    sourceName: 'WZDx feed',
    contentType: 'traffic_event',
    authors: [],
    organization: 'State DOT',
    publishedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-28T14:00:00.000Z',
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: null,
    language: 'en',
    identifiers: {
      eventId: 'WZ-1', eventType: 'work_zone', wzdxVersion: '4.2',
      ...(rawGeography ? { rawGeography } : {}),
      road: 'I-5', direction: 'southbound', vehicleImpact: 'some_lanes_closed',
      startDateIso: '2026-08-01T00:00:00.000Z', endDateIso: '2026-09-01T00:00:00.000Z',
      feedUpdatedAtIso: '2026-08-28T14:57:36.000Z',
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider, sourceUrl: 'https://example.invalid/feed', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const line = normalizeWzdxWorkZones([makeDoc('wzdx_wsdot', JSON.stringify({ type: 'LineString', coordinates: [[-122.3, 47.6], [-122.2, 47.7]] }))], 'wzdx_wsdot')
  results.push(check('linestring_work_zone_normalizes_as_path', line.events.length === 1 && line.events[0]?.geography?.kind === 'path', `kind=${line.events[0]?.geography?.kind}`))
  results.push(check('provider_id_is_parameterized', line.events[0]?.providerId === 'wzdx_wsdot', `provider=${line.events[0]?.providerId}`))
  results.push(check('wzdx_version_and_dates_preserved', (line.events[0]?.properties as Record<string, unknown>)?.wzdxVersion === '4.2' && (line.events[0]?.properties as Record<string, unknown>)?.endDate === '2026-09-01T00:00:00.000Z', 'verbatim'))

  const point = normalizeWzdxWorkZones([makeDoc('wzdx_iowa_dot', JSON.stringify({ type: 'Point', coordinates: [-93.6, 41.6] }))], 'wzdx_iowa_dot')
  results.push(check('point_work_zone_normalizes_as_point', point.events.length === 1 && point.events[0]?.geography?.kind === 'point', `kind=${point.events[0]?.geography?.kind}`))

  const multi = normalizeWzdxWorkZones([makeDoc('wzdx_kytc', JSON.stringify({ type: 'MultiPoint', coordinates: [[-85.7, 38.2], [-85.8, 38.3]] }))], 'wzdx_kytc')
  results.push(check('multipoint_uses_first_point_honestly', multi.events.length === 1 && multi.events[0]?.geography?.kind === 'point' && (multi.events[0].properties as Record<string, unknown>).geometryType === 'MultiPoint', 'first point + type noted'))

  const missing = normalizeWzdxWorkZones([makeDoc('wzdx_wsdot', undefined)], 'wzdx_wsdot')
  results.push(check('missing_geometry_is_skipped', missing.events.length === 0 && missing.skippedCount === 1, 'no geometry'))

  const polygon = normalizeWzdxWorkZones([makeDoc('wzdx_wsdot', JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }))], 'wzdx_wsdot')
  results.push(check('unsupported_geometry_type_is_skipped', polygon.events.length === 0 && polygon.skippedCount === 1, 'Polygon not claimed'))

  return results
}

export function runNormalizeWzdxWorkZonesValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeWzdxWorkZonesValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeWzdxWorkZones validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

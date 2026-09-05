/**
 * Deterministic regression suite for the shared NASA EONET normalizer — one function serving
 * three real Terra layers (wildfire_incident/volcano_event/flood_event). Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeNasaEonet.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchGeoFeature, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import { normalizeNasaEonet } from './normalizeNasaEonet'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'nasa_eonet:EONET_23209',
    provider: 'nasa_eonet',
    providerRecordId: 'EONET_23209',
    title: 'Wildfire Old Deer, Carson, Texas',
    summary: null,
    contentSnippet: null,
    canonicalUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_23209',
    sourceUrl: 'https://irwin.doi.gov/observer/incidents/2026-TXTXS-267516',
    sourceName: 'IRWIN',
    contentType: 'eonet_wildfires',
    authors: [],
    organization: 'NASA Earth Observatory Natural Event Tracker',
    publishedAt: '2026-08-23T20:38:00Z',
    updatedAt: '2026-08-23T20:38:00Z',
    retrievedAt: '2026-08-26T03:05:00.000Z',
    geography: null,
    language: 'en',
    identifiers: { eonet_event_id: 'EONET_23209', category: 'wildfires' },
    subjects: ['wildfires'],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'nasa_eonet', sourceUrl: 'https://irwin.doi.gov/observer/incidents/2026-TXTXS-267516', retrievedAt: '2026-08-26T03:05:00.000Z', requestDurationMs: 180, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function makeGeoFeature(overrides: Partial<ResearchGeoFeature> = {}): ResearchGeoFeature {
  return {
    id: 'EONET_23209',
    geometryType: 'Point',
    coordinates: [-101.217, 35.4635],
    properties: { title: 'Wildfire Old Deer, Carson, Texas', category: 'wildfires', magnitudeValue: 676, magnitudeUnit: 'acres', date: '2026-08-23T20:38:00Z', geometryHistory: [{ date: '2026-08-23T20:38:00Z', coordinates: [-101.217, 35.4635], magnitudeValue: 676, magnitudeUnit: 'acres' }] },
    ...overrides,
  }
}

function makeResponse(overrides: Partial<ResearchProviderResponse> = {}): ResearchProviderResponse {
  return { provider: 'nasa_eonet', ok: true, documents: [makeDoc()], timeSeries: [], geoFeatures: [makeGeoFeature()], entities: [], error: null, durationMs: 150, fromCache: false, ...overrides }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const { events, skippedCount } = normalizeNasaEonet(makeResponse(), { kind: 'wildfire_incident', domain: 'hazards' })
  results.push(check('wildfire_event_converts_correctly', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
  const event = events[0]
  results.push(check('kind_and_domain_come_from_options_not_guessed', event?.kind === 'wildfire_incident' && event?.domain === 'hazards', `kind=${event?.kind} domain=${event?.domain}`))
  results.push(check('this_is_a_named_incident_not_relabeled_as_a_raw_detection', event?.title === 'Wildfire Old Deer, Carson, Texas', `title=${event?.title}`))
  results.push(check('magnitude_and_unit_preserved_verbatim', event?.properties.magnitudeValue === 676 && event?.properties.magnitudeUnit === 'acres', `properties=${JSON.stringify(event?.properties)}`))
  results.push(check('geometry_history_preserved_not_discarded', Array.isArray(event?.properties.geometryHistory) && (event?.properties.geometryHistory as unknown[]).length === 1, `geometryHistory=${JSON.stringify(event?.properties.geometryHistory)}`))

  // Same function, different options — proves the "one shared normalizer, three layers" design.
  const volcano = normalizeNasaEonet(makeResponse({ documents: [makeDoc({ id: 'nasa_eonet:EONET_20710', providerRecordId: 'EONET_20710', title: 'Nevados del Chillan Volcano, Chile' })], geoFeatures: [makeGeoFeature({ id: 'EONET_20710', coordinates: [-71.378, -36.868], properties: { title: 'Nevados del Chillan Volcano, Chile', category: 'volcanoes', magnitudeValue: null, magnitudeUnit: null, date: '2026-06-15T00:00:00Z' } })] }), { kind: 'volcano_event', domain: 'hazards' })
  results.push(check('same_normalizer_serves_a_second_kind_via_options', volcano.events[0]?.kind === 'volcano_event' && volcano.events[0]?.title === 'Nevados del Chillan Volcano, Chile', `event=${JSON.stringify(volcano.events[0])}`))

  const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
  results.push(check('event_projects_to_geo_feature_correctly', feature?.longitude === -101.217 && feature?.latitude === 35.4635, `feature=${JSON.stringify(feature)}`))

  {
    const malformed = makeGeoFeature({ id: 'bad', coordinates: [200, 10] })
    const r = normalizeNasaEonet(makeResponse({ geoFeatures: [malformed], documents: [] }), { kind: 'wildfire_incident', domain: 'hazards' })
    results.push(check('malformed_coordinates_are_skipped_not_fabricated', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  {
    const r = normalizeNasaEonet(makeResponse({ geoFeatures: [], documents: [] }), { kind: 'flood_event', domain: 'hazards' })
    results.push(check('no_open_events_is_an_honest_empty_result', r.events.length === 0 && r.skippedCount === 0, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  return results
}

export function runTerraNormalizeNasaEonetValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeNasaEonetValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeNasaEonet validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

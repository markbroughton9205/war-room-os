/**
 * Deterministic regression suite for Terra event -> Related Intelligence query construction. Run
 * directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/eventIntelligenceQuery.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraGeoFeature } from './types'
import type { TerraActiveLocation } from './activeLocation'
import { buildTerraEventIntelligenceQuery } from './eventIntelligenceQuery'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeFeature(overrides: Partial<TerraGeoFeature> = {}): TerraGeoFeature {
  return {
    id: 'usgs_earthquake_feed:us7000abcd',
    eventId: 'usgs_earthquake_feed:us7000abcd',
    providerId: 'usgs_earthquake_feed',
    kind: 'earthquake',
    longitude: 166.1,
    latitude: -10.6,
    altitude: -35000,
    timestamp: '2026-08-26T10:00:00.000Z',
    title: 'M 4.9 - 35 km S of Lata, Solomon Islands',
    summary: null,
    properties: { mag: 4.9 },
    provenance: { provider: 'usgs_earthquake_feed', sourceUrl: 'https://earthquake.usgs.gov/test', retrievedAt: '2026-08-26T10:01:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: null, providerRecordId: 'us7000abcd', canonicalUrl: 'https://earthquake.usgs.gov/test' },
    coordinateOrigin: 'observed',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    ...overrides,
  }
}

function makeActiveLocation(overrides: Partial<TerraActiveLocation> = {}): TerraActiveLocation {
  return {
    latitude: -10.6,
    longitude: 166.1,
    height: null,
    hasTerrainHeight: false,
    label: 'Temotu, Solomon Islands',
    place: 'Temotu',
    address: null,
    region: 'Temotu, Solomon Islands',
    source: 'nominatim',
    sourceLabel: 'OpenStreetMap Nominatim',
    sourceUrl: 'https://nominatim.openstreetmap.org/test',
    status: 'resolved',
    confidence: 'provider_supported',
    detail: 'Provider-supported reverse match.',
    selectedAt: '2026-08-26T10:01:05.000Z',
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- No active location yet: query is built from the feature alone ---
  {
    const query = buildTerraEventIntelligenceQuery(makeFeature(), null)
    results.push(check('feature_only_query_includes_title', query.includes('M 4.9 - 35 km S of Lata, Solomon Islands'), query))
    results.push(check('feature_only_query_adds_kind_label_when_absent_from_title', query.includes('earthquake'), query))
  }

  // --- Resolving (pending) location contributes nothing yet, so the query stays stable ---
  {
    const resolving = makeActiveLocation({ status: 'resolving', region: null, place: null })
    const query = buildTerraEventIntelligenceQuery(makeFeature(), resolving)
    results.push(check('resolving_location_does_not_change_query', !query.includes('Temotu'), query))
  }

  // --- Resolved location at the exact event coordinates adds the resolved region ---
  {
    const query = buildTerraEventIntelligenceQuery(makeFeature(), makeActiveLocation())
    results.push(check('resolved_location_at_event_coordinates_adds_region', query.includes('Temotu'), query))
  }

  // --- A resolved location left over from a DIFFERENT prior selection must never leak in ---
  {
    const staleLocation = makeActiveLocation({ latitude: 40.7, longitude: -74.0, region: 'New York, United States' })
    const query = buildTerraEventIntelligenceQuery(makeFeature(), staleLocation)
    results.push(check('mismatched_coordinates_are_never_used', !query.includes('New York'), query))
  }

  // --- A kind whose title is already a complete description gets no synthetic label appended ---
  {
    const placeFeature = makeFeature({ kind: 'place', title: 'Paris, France', providerId: 'nominatim' })
    const query = buildTerraEventIntelligenceQuery(placeFeature, null)
    results.push(check('place_kind_gets_no_synthetic_label', query === 'Paris, France', query))
  }

  // --- A kind label already present (verbatim) in the title is not duplicated ---
  {
    const feature = makeFeature({ title: 'Kilauea Volcano — ongoing volcanic eruption event', kind: 'volcano_event' })
    const query = buildTerraEventIntelligenceQuery(feature, null)
    const occurrences = (query.toLowerCase().match(/volcanic eruption/g) ?? []).length
    results.push(check('kind_label_already_in_title_is_not_duplicated', occurrences === 1, query))
  }

  return results
}

export function runTerraEventIntelligenceQueryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraEventIntelligenceQueryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra eventIntelligenceQuery validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

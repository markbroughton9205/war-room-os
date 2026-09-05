/**
 * Deterministic regression suite for the LATENT_GEO extraction boundary. The critical property
 * under test is precision: real provider documents that do NOT reliably carry coordinates (gbif,
 * obis, whg-with-country-codes) must be rejected, not mis-parsed, while documents that genuinely
 * do (opensky, whg-without-country-codes, a met_no/open_meteo-style identifiers pair) must be
 * extracted correctly. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeLatentGeoDocument.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeLatentGeoDocuments } from './normalizeLatentGeoDocument'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'opensky:abc123',
    provider: 'opensky',
    providerRecordId: 'abc123',
    title: 'UAL123',
    summary: 'Origin country: United States',
    contentSnippet: 'lat 47.6, lon -122.3',
    canonicalUrl: 'https://opensky-network.org/aircraft-profile?icao24=abc123',
    sourceUrl: 'https://opensky-network.org/aircraft-profile?icao24=abc123',
    sourceName: 'OpenSky Network',
    contentType: 'aircraft_state',
    authors: [],
    organization: null,
    publishedAt: '2026-08-25T12:00:00.000Z',
    updatedAt: null,
    retrievedAt: '2026-08-25T12:00:05.000Z',
    geography: 'lat 47.6, lon -122.3',
    language: null,
    identifiers: { icao24: 'abc123' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: {
      provider: 'opensky',
      sourceUrl: 'https://opensky-network.org/aircraft-profile?icao24=abc123',
      retrievedAt: '2026-08-25T12:00:05.000Z',
      requestDurationMs: 90,
      fromCache: false,
      isHistorical: false,
    },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const options = { providerId: 'opensky' as const, kind: 'aircraft_state' as const, domain: 'other' as const }

  // --- opensky: a clean "lat X, lon Y" geography string extracts correctly ---
  {
    const { events, skippedCount } = normalizeLatentGeoDocuments([makeDoc()], options)
    results.push(check('opensky_style_geography_string_extracts', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
    const event = events[0]
    results.push(check('extracted_point_matches_geography_string', event?.geography?.kind === 'point' && event.geography.latitude === 47.6 && event.geography.longitude === -122.3, `geography=${JSON.stringify(event?.geography)}`))
    results.push(check('domain_kind_provider_from_options_not_guessed', event?.domain === 'other' && event?.kind === 'aircraft_state' && event?.providerId === 'opensky', `domain=${event?.domain} kind=${event?.kind} providerId=${event?.providerId}`))
    results.push(check('evidence_honestly_null', event?.evidence === null, `evidence=${JSON.stringify(event?.evidence)}`))
  }

  // --- whg without country codes: geography IS the coordinate string, extracts correctly ---
  {
    const doc = makeDoc({ id: 'whg:place1', provider: 'whg', geography: 'lat 41.9, lon 12.5', identifiers: {} })
    const r = normalizeLatentGeoDocuments([doc], { providerId: 'whg', kind: 'aircraft_state', domain: 'other' })
    results.push(check('whg_without_country_codes_extracts_from_geography', r.events.length === 1 && r.events[0].geography?.kind === 'point' && r.events[0].geography.latitude === 41.9, `events=${r.events.length} geography=${JSON.stringify(r.events[0]?.geography)}`))
  }

  // --- whg WITH country codes: geography holds "US, FR, DE" instead — must be rejected, not
  // mis-parsed as a coordinate. This is the exact ambiguity that motivated a strict whole-string
  // regex rather than a loose contains/substring check. ---
  {
    const doc = makeDoc({ id: 'whg:place2', provider: 'whg', geography: 'US, FR, DE', identifiers: {} })
    const r = normalizeLatentGeoDocuments([doc], { providerId: 'whg', kind: 'aircraft_state', domain: 'other' })
    results.push(check('whg_with_country_codes_is_rejected_not_misparsed', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  // --- gbif: geography holds only a country name; the real coordinates live in free-text summary
  // prose, never in a structured field — must be rejected, never regex-scraped out of prose. ---
  {
    const doc = makeDoc({ id: 'gbif:occ1', provider: 'gbif', geography: 'United States', summary: 'HumanObservation recorded 2026-08-20 at lat 38.0, lon -122.0', identifiers: {} })
    const r = normalizeLatentGeoDocuments([doc], { providerId: 'gbif', kind: 'aircraft_state', domain: 'other' })
    results.push(check('gbif_coordinates_in_summary_prose_are_not_extracted', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  // --- obis: geography holds a water body name, never coordinates in any field this adapter
  // outputs — must be rejected. ---
  {
    const doc = makeDoc({ id: 'obis:occ1', provider: 'obis', geography: 'North Atlantic Ocean', identifiers: { obis_occurrence_id: 'occ1' } })
    const r = normalizeLatentGeoDocuments([doc], { providerId: 'obis', kind: 'aircraft_state', domain: 'other' })
    results.push(check('obis_water_body_name_is_not_extracted', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  // --- met_no / open_meteo style: no usable geography string, but identifiers carry
  // latitude/longitude as strings ---
  {
    const doc = makeDoc({ id: 'met_no:station1', provider: 'met_no', geography: null, identifiers: { latitude: '59.91', longitude: '10.75' } })
    const r = normalizeLatentGeoDocuments([doc], { providerId: 'met_no', kind: 'aircraft_state', domain: 'weather' })
    results.push(check('identifiers_lat_lon_fallback_extracts', r.events.length === 1 && r.events[0].geography?.kind === 'point' && r.events[0].geography.latitude === 59.91 && r.events[0].geography.longitude === 10.75, `events=${r.events.length} geography=${JSON.stringify(r.events[0]?.geography)}`))
  }

  // --- No coordinate anywhere: honestly skipped, no geocoding attempted ---
  {
    const doc = makeDoc({ id: 'x:1', geography: '10km SW of Somewhere', identifiers: {} })
    const r = normalizeLatentGeoDocuments([doc], options)
    results.push(check('place_description_without_coordinates_is_skipped_not_geocoded', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  // --- Out-of-range values in an otherwise well-formed string are rejected ---
  {
    const doc = makeDoc({ id: 'x:2', geography: 'lat 200, lon 10' })
    const r = normalizeLatentGeoDocuments([doc], options)
    results.push(check('out_of_range_latitude_is_rejected', r.events.length === 0 && r.skippedCount === 1, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  {
    const r = normalizeLatentGeoDocuments([], options)
    results.push(check('empty_input_is_empty_output', r.events.length === 0 && r.skippedCount === 0, `events=${r.events.length} skipped=${r.skippedCount}`))
  }

  return results
}

export function runTerraNormalizeLatentGeoDocumentValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraNormalizeLatentGeoDocumentValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeLatentGeoDocument validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

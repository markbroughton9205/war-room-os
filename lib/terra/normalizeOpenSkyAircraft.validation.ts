/**
 * Deterministic regression suite for the OpenSky aircraft normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeOpenSkyAircraft.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeOpenSkyAircraft } from './normalizeOpenSkyAircraft'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'opensky:a1b2c3',
    provider: 'opensky',
    providerRecordId: 'a1b2c3',
    title: 'UAL123',
    summary: 'Origin country: United States',
    contentSnippet: 'lat 41.2, lon -81.8',
    canonicalUrl: 'https://opensky-network.org/aircraft-profile?icao24=a1b2c3',
    sourceUrl: 'https://opensky-network.org/aircraft-profile?icao24=a1b2c3',
    sourceName: 'OpenSky Network',
    contentType: 'aircraft_state',
    authors: [],
    organization: null,
    publishedAt: '2026-08-27T01:00:00.000Z',
    updatedAt: null,
    retrievedAt: '2026-08-27T01:00:00.000Z',
    geography: 'lat 41.2, lon -81.8',
    language: null,
    identifiers: {
      icao24: 'a1b2c3',
      callsign: 'UAL123',
      originCountry: 'United States',
      latitude: '41.2',
      longitude: '-81.8',
      altitudeMeters: '10363',
      velocityMps: '230.5',
      headingDeg: '271',
      verticalRateMps: '0',
      onGround: 'false',
      lastContactIso: '2026-08-27T00:59:50.000Z',
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'opensky', sourceUrl: 'https://opensky-network.org/aircraft-profile?icao24=a1b2c3', retrievedAt: '2026-08-27T01:00:00.000Z', requestDurationMs: 200, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- A complete real state vector normalizes with every typed field intact ---
  {
    const { events, skippedCount } = normalizeOpenSkyAircraft([makeDoc()])
    const event = events[0]
    results.push(check('complete_state_vector_produces_one_event', events.length === 1 && skippedCount === 0, `events=${events.length}`))
    results.push(check('kind_is_aircraft_state', event?.kind === 'aircraft_state', String(event?.kind)))
    results.push(check('coordinate_origin_is_source_embedded_not_observed', event?.geography?.kind === 'point' && event.geography.coordinateOrigin === 'source_embedded', JSON.stringify(event?.geography)))
    results.push(check('altitude_is_populated_from_identifiers_not_null', event?.geography?.kind === 'point' && event.geography.altitude === 10363, JSON.stringify(event?.geography)))
    results.push(check('heading_velocity_vertical_rate_are_typed_numbers', event?.properties.headingDeg === 271 && event?.properties.velocityMps === 230.5 && event?.properties.verticalRateMps === 0, JSON.stringify(event?.properties)))
    results.push(check('on_ground_is_typed_boolean_not_string', event?.properties.onGround === false, JSON.stringify(event?.properties.onGround)))
    results.push(check('observed_at_uses_real_last_contact_not_batch_time', event?.observedAt === '2026-08-27T00:59:50.000Z', String(event?.observedAt)))
    results.push(check('temporal_status_is_current', event?.temporalStatus === 'current', String(event?.temporalStatus)))
  }

  // --- Missing coordinates is an honest skip, never a fabricated position ---
  {
    const doc = makeDoc({ identifiers: { ...makeDoc().identifiers, latitude: '', longitude: '' } })
    delete (doc.identifiers as Record<string, string>).latitude
    delete (doc.identifiers as Record<string, string>).longitude
    const { events, skippedCount } = normalizeOpenSkyAircraft([doc])
    results.push(check('missing_coordinates_is_skipped_not_fabricated', events.length === 0 && skippedCount === 1, `events=${events.length} skipped=${skippedCount}`))
  }

  // --- Missing altitude/heading/velocity/vertical-rate stay honestly null, never invented ---
  {
    const doc = makeDoc()
    const identifiers = { ...doc.identifiers }
    delete (identifiers as Record<string, string>).altitudeMeters
    delete (identifiers as Record<string, string>).headingDeg
    delete (identifiers as Record<string, string>).velocityMps
    delete (identifiers as Record<string, string>).verticalRateMps
    const { events } = normalizeOpenSkyAircraft([makeDoc({ identifiers })])
    const event = events[0]
    const allNull = event?.geography?.kind === 'point' && event.geography.altitude === null && event.properties.headingDeg === null && event.properties.velocityMps === null && event.properties.verticalRateMps === null
    results.push(check('missing_optional_fields_stay_null_not_fabricated', allNull, JSON.stringify({ geography: event?.geography, properties: event?.properties })))
  }

  // --- An on-ground aircraft is preserved as onGround:true, not silently dropped ---
  {
    const { events } = normalizeOpenSkyAircraft([makeDoc({ identifiers: { ...makeDoc().identifiers, onGround: 'true' } })])
    results.push(check('on_ground_true_is_preserved', events[0]?.properties.onGround === true, JSON.stringify(events[0]?.properties.onGround)))
  }

  // --- No callsign falls back honestly to null, never a fabricated tail number ---
  {
    const doc = makeDoc({ title: 'Aircraft a1b2c3' })
    const identifiers = { ...doc.identifiers }
    delete (identifiers as Record<string, string>).callsign
    const { events } = normalizeOpenSkyAircraft([makeDoc({ title: 'Aircraft a1b2c3', identifiers })])
    results.push(check('missing_callsign_is_null_not_fabricated', events[0]?.properties.callsign === null, JSON.stringify(events[0]?.properties.callsign)))
  }

  // --- Never synthesizes fields this endpoint doesn't supply ---
  {
    const { events } = normalizeOpenSkyAircraft([makeDoc()])
    const props = events[0]?.properties as Record<string, unknown>
    const noFabrication = !('operator' in props) && !('registration' in props) && !('origin' in props) && !('destination' in props) && !('aircraftModel' in props) && !('militaryClassification' in props)
    results.push(check('never_synthesizes_operator_registration_origin_destination_model_or_military_fields', noFabrication, JSON.stringify(Object.keys(props))))
  }

  return results
}

export function runNormalizeOpenSkyAircraftValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeOpenSkyAircraftValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeOpenSkyAircraft validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

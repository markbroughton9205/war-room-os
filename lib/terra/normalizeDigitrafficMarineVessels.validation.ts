/**
 * Deterministic regression suite for the Digitraffic Marine vessel normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeDigitrafficMarineVessels.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeDigitrafficMarineVessels } from './normalizeDigitrafficMarineVessels'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'digitraffic_marine:230123456',
    provider: 'digitraffic_marine',
    providerRecordId: '230123456',
    title: 'FINNMAID',
    summary: 'Navigation status: Under way using engine',
    contentSnippet: 'lat 60.15, lon 24.95',
    canonicalUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230123456',
    sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230123456',
    sourceName: 'Digitraffic Marine Traffic (Fintraffic)',
    contentType: 'vessel_position',
    authors: [],
    organization: 'Fintraffic',
    publishedAt: '2026-08-27T01:00:00.000Z',
    updatedAt: null,
    retrievedAt: '2026-08-27T01:00:00.000Z',
    geography: 'lat 60.15, lon 24.95',
    language: null,
    identifiers: {
      mmsi: '230123456',
      callSign: 'OJAM',
      imo: '9264727',
      latitude: '60.15',
      longitude: '24.95',
      speedKnots: '14.2',
      courseDeg: '271.5',
      headingDeg: '270',
      navStatCode: '0',
      navStatLabel: 'Under way using engine',
      destination: 'HELSINKI',
      draughtMeters: '6.4',
      shipTypeCode: '60',
      shipTypeLabel: 'Passenger',
      lastObservedIso: '2026-08-27T00:59:50.000Z',
      vesselMetadataAvailable: 'true',
    },
    subjects: [],
    license: 'CC BY 4.0',
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'digitraffic_marine', sourceUrl: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230123456', retrievedAt: '2026-08-27T01:00:00.000Z', requestDurationMs: 200, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- A complete real position + metadata record normalizes with every typed field intact ---
  {
    const { events, skippedCount } = normalizeDigitrafficMarineVessels([makeDoc()])
    const event = events[0]
    results.push(check('complete_record_produces_one_event', events.length === 1 && skippedCount === 0, `events=${events.length}`))
    results.push(check('kind_is_vessel_position', event?.kind === 'vessel_position', String(event?.kind)))
    results.push(check('coordinate_origin_is_source_embedded_not_observed', event?.geography?.kind === 'point' && event.geography.coordinateOrigin === 'source_embedded', JSON.stringify(event?.geography)))
    results.push(check('speed_course_heading_are_typed_numbers', event?.properties.speedKnots === 14.2 && event?.properties.courseDeg === 271.5 && event?.properties.headingDeg === 270, JSON.stringify(event?.properties)))
    results.push(check('nav_status_label_is_preserved_verbatim', event?.properties.navStatLabel === 'Under way using engine', String(event?.properties.navStatLabel)))
    results.push(check('destination_and_draught_are_preserved', event?.properties.destination === 'HELSINKI' && event?.properties.draughtMeters === 6.4, JSON.stringify(event?.properties)))
    results.push(check('observed_at_uses_real_last_observed_not_batch_time', event?.observedAt === '2026-08-27T00:59:50.000Z', String(event?.observedAt)))
    results.push(check('temporal_status_is_current', event?.temporalStatus === 'current', String(event?.temporalStatus)))
  }

  // --- Missing coordinates is an honest skip, never a fabricated position ---
  {
    const doc = makeDoc()
    const identifiers = { ...doc.identifiers }
    delete (identifiers as Record<string, string>).latitude
    delete (identifiers as Record<string, string>).longitude
    const { events, skippedCount } = normalizeDigitrafficMarineVessels([makeDoc({ identifiers })])
    results.push(check('missing_coordinates_is_skipped_not_fabricated', events.length === 0 && skippedCount === 1, `events=${events.length} skipped=${skippedCount}`))
  }

  // --- Missing MMSI is an honest skip (the required identity key) ---
  {
    const doc = makeDoc()
    const identifiers = { ...doc.identifiers }
    delete (identifiers as Record<string, string>).mmsi
    const { events, skippedCount } = normalizeDigitrafficMarineVessels([makeDoc({ identifiers })])
    results.push(check('missing_mmsi_is_skipped', events.length === 0 && skippedCount === 1, `events=${events.length} skipped=${skippedCount}`))
  }

  // --- Missing optional fields (no vessel metadata match) stay honestly null, never invented ---
  {
    const doc = makeDoc({ title: 'Vessel 230123456' })
    const identifiers = { ...doc.identifiers }
    for (const key of ['callSign', 'imo', 'destination', 'draughtMeters', 'shipTypeCode', 'shipTypeLabel']) {
      delete (identifiers as Record<string, string>)[key]
    }
    identifiers.vesselMetadataAvailable = 'false'
    const { events } = normalizeDigitrafficMarineVessels([makeDoc({ title: 'Vessel 230123456', identifiers })])
    const props = events[0]?.properties as Record<string, unknown>
    const allNull = props.callSign === null && props.imo === null && props.destination === null && props.draughtMeters === null && props.shipTypeCode === null && props.shipTypeLabel === null
    results.push(check('missing_optional_fields_stay_null_not_fabricated', allNull, JSON.stringify(props)))
    results.push(check('vessel_metadata_unavailable_flag_is_preserved', props.vesselMetadataAvailable === false, JSON.stringify(props.vesselMetadataAvailable)))
  }

  // --- Never synthesizes fields this source doesn't supply (flag/operator/registered-owner) ---
  {
    const { events } = normalizeDigitrafficMarineVessels([makeDoc()])
    const props = events[0]?.properties as Record<string, unknown>
    const noFabrication = !('flag' in props) && !('operator' in props) && !('registeredOwner' in props) && !('country' in props)
    results.push(check('never_synthesizes_flag_operator_or_owner_fields', noFabrication, JSON.stringify(Object.keys(props))))
  }

  return results
}

export function runNormalizeDigitrafficMarineVesselsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeDigitrafficMarineVesselsValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeDigitrafficMarineVessels validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

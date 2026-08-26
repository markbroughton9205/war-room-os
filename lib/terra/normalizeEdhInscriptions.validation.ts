/**
 * Deterministic regression suite for the EDH ENTITY_GEO_RESOLVABLE normalizer — proves batched
 * resolution by distinct place name, honest skip-counting for ambiguous/unresolved/missing
 * geography, and that a resolved event's TerraGeography carries coordinateOrigin: 'resolved' plus
 * full resolver provenance end to end through projection. Mocks the underlying fetch (real
 * nominatim HTTP shape) rather than the resolver function, so this also exercises the real
 * resolveGeography.ts code path. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeEdhInscriptions.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument, ResearchProviderResponse } from '@/lib/research-engine/core/types'
import { __setResearchFetchForTests } from '@/lib/research-engine/security/safeFetch'
import { __resetCacheForTests } from '@/lib/research-engine/cache/ttlCache'
import { __resetProviderGateForTests } from '@/lib/research-engine/security/providerGate'
import { normalizeEdhInscriptions } from './normalizeEdhInscriptions'
import { projectTerraIntelligenceEventToGeoFeature } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// One nominatim HTTP call per distinct geography value, in first-seen order — this queue mock
// asserts that shape by construction (fewer/extra calls than expected throw, same discipline as
// diagnostics/validation.ts's withCountingFetch).
function queueFetch(responses: Response[]): typeof fetch {
  let index = 0
  return (async () => {
    if (index >= responses.length) throw new Error(`unauthorized fetch #${index + 1} — only ${responses.length} response(s) queued`)
    return responses[index++]
  }) as typeof fetch
}

async function withMockedFetch<T>(responses: Response[], fn: () => Promise<T>): Promise<T> {
  __resetProviderGateForTests()
  __resetCacheForTests()
  __setResearchFetchForTests(queueFetch(responses))
  try {
    return await fn()
  } finally {
    __setResearchFetchForTests(null)
    __resetProviderGateForTests()
    __resetCacheForTests()
  }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'edh:HD012345',
    provider: 'edh',
    providerRecordId: 'HD012345',
    retrievedAt: '2026-08-26T12:00:00.000Z',
    title: 'D(is) M(anibus) test inscription',
    summary: 'funerary',
    contentSnippet: 'Roma',
    canonicalUrl: 'https://edh.ub.uni-heidelberg.de/edh/inschrift/HD012345',
    sourceUrl: 'https://edh.ub.uni-heidelberg.de/edh/inschrift/HD012345',
    sourceName: 'Epigraphic Database Heidelberg',
    contentType: 'epigraphic_inscription',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: 'Lazio',
    language: 'la',
    identifiers: { edh_id: 'HD012345' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'edh', sourceUrl: 'https://edh.ub.uni-heidelberg.de/edh/inschrift/HD012345', retrievedAt: '2026-08-26T12:00:00.000Z', requestDurationMs: 90, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function makeResponse(documents: ResearchDocument[]): ResearchProviderResponse {
  return { provider: 'edh', ok: true, documents, timeSeries: [], geoFeatures: [], entities: [], error: null, durationMs: 100, fromCache: false }
}

async function run(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // --- Exact-match resolution succeeds end to end ---
  await withMockedFetch(
    [jsonResponse([{ place_id: 1, lat: '41.9', lon: '12.5', display_name: 'Lazio, Italia', name: 'Lazio' }])],
    async () => {
      const { events, skippedCount } = await normalizeEdhInscriptions(makeResponse([makeDoc()]))
      results.push(check('resolvable_document_produces_one_event', events.length === 1 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
      const event = events[0]
      results.push(check('event_kind_domain_provider_correct', event?.kind === 'heritage_site' && event?.domain === 'research' && event?.providerId === 'edh', `kind=${event?.kind} domain=${event?.domain} providerId=${event?.providerId}`))
      results.push(check('geography_coordinate_origin_is_resolved', event?.geography?.coordinateOrigin === 'resolved', `coordinateOrigin=${event?.geography?.coordinateOrigin}`))
      results.push(check('geography_coordinates_match_resolution', event?.geography?.kind === 'point' && event.geography.latitude === 41.9 && event.geography.longitude === 12.5, `geography=${JSON.stringify(event?.geography)}`))
      results.push(check('event_carries_full_resolver_provenance', event?.geoResolution?.resolverProviderId === 'nominatim' && event?.geoResolution?.quality === 'strong', `geoResolution=${JSON.stringify(event?.geoResolution)}`))

      const feature = event ? projectTerraIntelligenceEventToGeoFeature(event) : null
      results.push(check('resolved_event_projects_to_geo_feature_correctly', feature?.longitude === 12.5 && feature?.latitude === 41.9 && feature?.coordinateOrigin === 'resolved', `feature=${JSON.stringify(feature)}`))
      results.push(check('projected_feature_preserves_resolver_provenance', JSON.stringify(feature?.geoResolution) === JSON.stringify(event?.geoResolution), 'geoResolution mismatch after projection'))
    },
  )

  // --- Ambiguous resolution: event is skipped, never fabricated ---
  await withMockedFetch(
    [jsonResponse([
      { place_id: 1, lat: '51.5', lon: '-0.1', display_name: 'A' },
      { place_id: 2, lat: '37.5', lon: '-77.4', display_name: 'B' },
    ])],
    async () => {
      const { events, skippedCount } = await normalizeEdhInscriptions(makeResponse([makeDoc({ id: 'edh:HD999', providerRecordId: 'HD999', geography: 'Ambiguous Region' })]))
      results.push(check('ambiguous_place_name_is_skipped_not_fabricated', events.length === 0 && skippedCount === 1, `events=${events.length} skipped=${skippedCount}`))
    },
  )

  // --- Unresolved (zero candidates): event is skipped ---
  await withMockedFetch([jsonResponse([])], async () => {
    const { events, skippedCount } = await normalizeEdhInscriptions(makeResponse([makeDoc({ id: 'edh:HD888', providerRecordId: 'HD888', geography: 'Nowhere Really' })]))
    results.push(check('unresolvable_place_name_is_skipped_not_fabricated', events.length === 0 && skippedCount === 1, `events=${events.length} skipped=${skippedCount}`))
  })

  // --- Missing geography entirely: skipped without attempting any resolution call ---
  await withMockedFetch([], async () => {
    const { events, skippedCount } = await normalizeEdhInscriptions(makeResponse([makeDoc({ id: 'edh:HD777', providerRecordId: 'HD777', geography: null })]))
    results.push(check('missing_geography_is_skipped_without_a_resolution_attempt', events.length === 0 && skippedCount === 1, `events=${events.length} skipped=${skippedCount}`))
  })

  // --- Batched resolution: two documents sharing one place name trigger exactly one resolver
  // call, not two ---
  await withMockedFetch(
    [jsonResponse([{ place_id: 1, lat: '40.85', lon: '14.25', display_name: 'Campania, Italia' }])],
    async () => {
      const { events, skippedCount } = await normalizeEdhInscriptions(makeResponse([
        makeDoc({ id: 'edh:A', providerRecordId: 'A', geography: 'Campania' }),
        makeDoc({ id: 'edh:B', providerRecordId: 'B', geography: 'Campania' }),
      ]))
      results.push(check('shared_place_name_resolved_once_applies_to_both_documents', events.length === 2 && skippedCount === 0, `events=${events.length} skipped=${skippedCount}`))
      results.push(check('both_events_share_identical_resolved_coordinates', events[0]?.geography?.kind === 'point' && events[1]?.geography?.kind === 'point' && JSON.stringify(events[0]?.geography) === JSON.stringify(events[1]?.geography), 'coordinates differ between documents sharing one place name'))
    },
  )

  return results
}

export async function runTerraNormalizeEdhInscriptionsValidation(): Promise<CaseResult[]> {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTerraNormalizeEdhInscriptionsValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(r => !r.pass)
    console.log(`Terra normalizeEdhInscriptions validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}

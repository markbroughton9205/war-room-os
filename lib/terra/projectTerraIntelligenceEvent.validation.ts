/**
 * Focused regression suite for the generic, domain-agnostic TerraIntelligenceEvent ->
 * TerraGeoFeature projection — the one spatial-projection step every current and future Terra
 * event kind shares. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/projectTerraIntelligenceEvent.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { TerraIntelligenceEvent } from './types'
import { projectTerraIntelligenceEventToGeoFeature, projectTerraIntelligenceEvents } from './projectTerraIntelligenceEvent'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeEvent(overrides: Partial<TerraIntelligenceEvent> = {}): TerraIntelligenceEvent {
  return {
    id: 'evt-1',
    domain: 'hazards',
    kind: 'earthquake',
    providerId: 'usgs_earthquake_feed',
    layerClass: 'observed',
    title: 'M5.0 — Test Region',
    summary: null,
    observedAt: '2026-08-25T12:00:00.000Z',
    publishedAt: null,
    updatedAt: null,
    temporalStatus: 'current',
    geography: { kind: 'point', longitude: 12.5, latitude: -4.2, altitude: -12000 },
    evidence: null,
    properties: { mag: 5.0 },
    provenance: { provider: 'usgs_earthquake_feed', sourceUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/evt-1', retrievedAt: '2026-08-25T12:05:00.000Z', fromCache: false, isHistorical: false },
    rawReference: { documentId: 'usgs_earthquake_feed:evt-1', providerRecordId: 'evt-1', canonicalUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/evt-1' },
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  {
    const feature = projectTerraIntelligenceEventToGeoFeature(makeEvent())
    results.push(check('point_geography_projects_successfully', feature !== null, `feature=${JSON.stringify(feature)}`))
    results.push(check('projected_coordinates_match_event_geography', feature?.longitude === 12.5 && feature?.latitude === -4.2 && feature?.altitude === -12000, `lon=${feature?.longitude} lat=${feature?.latitude} alt=${feature?.altitude}`))
    results.push(check('projected_id_and_event_id_are_both_set_and_equal_for_a_1to1_point_projection', feature?.id === 'evt-1' && feature?.eventId === 'evt-1', `id=${feature?.id} eventId=${feature?.eventId}`))
    results.push(check('provider_and_kind_carried_through_unchanged', feature?.providerId === 'usgs_earthquake_feed' && feature?.kind === 'earthquake', `providerId=${feature?.providerId} kind=${feature?.kind}`))
    results.push(check('timestamp_prefers_observed_at', feature?.timestamp === '2026-08-25T12:00:00.000Z', `timestamp=${feature?.timestamp}`))
  }

  {
    const feature = projectTerraIntelligenceEventToGeoFeature(makeEvent({ geography: null }))
    results.push(check('null_geography_projects_to_null_not_a_fabricated_point', feature === null, `feature=${JSON.stringify(feature)}`))
  }

  {
    const feature = projectTerraIntelligenceEventToGeoFeature(makeEvent({ observedAt: null, publishedAt: '2026-08-25T09:00:00.000Z' }))
    results.push(check('timestamp_falls_back_to_published_at_when_observed_at_is_absent', feature?.timestamp === '2026-08-25T09:00:00.000Z', `timestamp=${feature?.timestamp}`))
  }

  {
    const feature = projectTerraIntelligenceEventToGeoFeature(makeEvent({ observedAt: null, publishedAt: null }))
    results.push(check('timestamp_is_null_when_neither_source_timestamp_exists_never_fabricated', feature?.timestamp === null, `timestamp=${feature?.timestamp}`))
  }

  {
    const events = [makeEvent({ id: 'a' }), makeEvent({ id: 'b', geography: null }), makeEvent({ id: 'c' })]
    const features = projectTerraIntelligenceEvents(events)
    results.push(check('batch_projection_silently_filters_non_projectable_events_not_crashes', features.length === 2 && features.every(f => f.id !== 'b'), `count=${features.length} ids=${features.map(f => f.id).join(',')}`))
  }

  return results
}

export function runTerraProjectIntelligenceEventValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runTerraProjectIntelligenceEventValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra projectTerraIntelligenceEvent validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

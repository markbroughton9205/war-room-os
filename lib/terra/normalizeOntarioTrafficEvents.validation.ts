/**
 * Deterministic regression suite for the Ontario traffic-event normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeOntarioTrafficEvents.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeOntarioTrafficEvents } from './normalizeOntarioTrafficEvents'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'ontario_511_events:555',
    provider: 'ontario_511_events',
    providerRecordId: '555',
    title: 'Highway 401 — collision',
    summary: 'Highway 401',
    contentSnippet: 'lat 43.7, lon -79.4',
    canonicalUrl: 'https://511on.ca/',
    sourceUrl: 'https://511on.ca/api/v2/get/event',
    sourceName: 'Ontario 511 (511on.ca)',
    contentType: 'traffic_event',
    authors: [],
    organization: 'Government of Ontario / Ministry of Transportation',
    publishedAt: '2026-08-28T20:00:00.000Z',
    updatedAt: '2026-08-28T21:00:00.000Z',
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 43.7, lon -79.4',
    language: null,
    identifiers: {
      latitude: '43.7', longitude: '-79.4', eventType: 'Collision', severity: 'Major',
      road: 'Highway 401', direction: 'Eastbound', laneState: 'Right lane closed',
      reportedAtIso: '2026-08-28T20:00:00.000Z', isFullClosure: 'false',
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'ontario_511_events', sourceUrl: 'https://511on.ca/api/v2/get/event', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeOntarioTrafficEvents([makeDoc()])
  results.push(check('valid_event_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length}`))
  const event = ok.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('kind_is_traffic_event', event?.kind === 'traffic_event' && event?.providerId === 'ontario_511_events', `kind=${event?.kind}`))
  results.push(check('observed_at_uses_reported_timestamp', event?.observedAt === '2026-08-28T20:00:00.000Z', `observedAt=${event?.observedAt}`))
  results.push(check('vocabulary_preserved_verbatim', props?.eventType === 'Collision' && props?.severity === 'Major', 'no rescale'))
  results.push(check('is_full_closure_parsed_as_boolean', props?.isFullClosure === false, 'false boolean'))

  const bad = normalizeOntarioTrafficEvents([makeDoc({ identifiers: { latitude: '43.7', longitude: '-181' } })])
  results.push(check('out_of_range_longitude_is_skipped', bad.events.length === 0 && bad.skippedCount === 1, 'skipped'))

  return results
}

export function runNormalizeOntarioTrafficEventsValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeOntarioTrafficEventsValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeOntarioTrafficEvents validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

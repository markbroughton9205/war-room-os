/**
 * Deterministic regression suite for the WebTRIS traffic-flow normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeWebtrisTrafficFlow.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeWebtrisTrafficFlow } from './normalizeWebtrisTrafficFlow'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'webtris:1234:2026-06-30',
    provider: 'webtris',
    providerRecordId: '1234',
    title: 'M25 site 1234 — 2026-06-30',
    summary: 'M25',
    contentSnippet: 'lat 51.4, lon -0.3',
    canonicalUrl: 'https://webtris.nationalhighways.co.uk/api/v1.0/reports/daily',
    sourceUrl: 'https://webtris.nationalhighways.co.uk/api/v1.0/reports/daily',
    sourceName: 'WebTRIS (National Highways, UK)',
    contentType: 'traffic_flow_observation',
    authors: [],
    organization: 'National Highways',
    publishedAt: '2026-06-30T00:00:00.000Z',
    updatedAt: null,
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 51.4, lon -0.3',
    language: 'en',
    identifiers: { siteId: '1234', latitude: '51.4', longitude: '-0.3', speedMph: '62.5', vehicleFlowCount: '12340', reportDate: '2026-06-30', observedAtIso: '2026-06-30T00:00:00.000Z', road: 'M25' },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'webtris', sourceUrl: 'https://webtris.nationalhighways.co.uk/api/v1.0/reports/daily', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: true },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeWebtrisTrafficFlow([makeDoc()])
  results.push(check('valid_observation_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length}`))
  const event = ok.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('kind_is_traffic_flow_observation', event?.kind === 'traffic_flow_observation' && event?.providerId === 'webtris', `kind=${event?.kind}`))
  results.push(check('temporal_status_is_always_historical', event?.temporalStatus === 'historical', 'source lags ~2 months'))
  results.push(check('provenance_is_historical', event?.provenance.isHistorical === true, 'never live'))
  results.push(check('free_flow_baseline_is_never_invented', props?.freeFlowSpeedMph === null, 'null baseline'))
  results.push(check('speed_and_volume_parsed', props?.speedMph === 62.5 && props?.vehicleFlowCount === 12340, `speed=${props?.speedMph}`))

  const bad = normalizeWebtrisTrafficFlow([makeDoc({ identifiers: { latitude: '95', longitude: '-0.3' } })])
  results.push(check('out_of_range_latitude_is_skipped', bad.events.length === 0 && bad.skippedCount === 1, 'skipped'))

  return results
}

export function runNormalizeWebtrisTrafficFlowValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeWebtrisTrafficFlowValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeWebtrisTrafficFlow validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

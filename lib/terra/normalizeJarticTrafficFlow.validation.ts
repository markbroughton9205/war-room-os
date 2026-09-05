/**
 * Deterministic regression suite for the JARTIC traffic-flow normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeJarticTrafficFlow.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeJarticTrafficFlow } from './normalizeJarticTrafficFlow'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'jartic_traffic_volumes:3310920:202608290500',
    provider: 'jartic_traffic_volumes',
    providerRecordId: '3310920',
    title: 'Traffic volume observation 3310920 — JST 202608290500',
    summary: 'up 508 veh/h, down 640 veh/h',
    contentSnippet: 'lat 35.7489, lon 139.6970',
    canonicalUrl: 'https://api.jartic-open-traffic.org/geoserver',
    sourceUrl: 'https://api.jartic-open-traffic.org/geoserver',
    sourceName: 'JARTIC open traffic data (Japan)',
    contentType: 'traffic_flow_observation',
    authors: [],
    organization: 'JARTIC / MLIT open traffic data',
    publishedAt: null,
    updatedAt: null,
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 35.7489, lon 139.6970',
    language: 'ja',
    identifiers: {
      siteId: '3310920', latitude: '35.7489', longitude: '139.6970',
      timeCodeJst: '202608290500', observedAtIso: '2026-08-28T20:00:00.000Z',
      vehicleFlowCountUp: '508', vehicleFlowCountDown: '640', roadClassCode: '3',
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'jartic_traffic_volumes', sourceUrl: 'https://api.jartic-open-traffic.org/geoserver', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeJarticTrafficFlow([makeDoc()])
  results.push(check('valid_observation_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length}`))
  const event = ok.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('kind_is_traffic_flow_observation', event?.kind === 'traffic_flow_observation' && event?.providerId === 'jartic_traffic_volumes', `kind=${event?.kind}`))
  results.push(check('temporal_status_is_current_not_forced_historical', event?.temporalStatus === 'current', 'near-real-time source'))
  results.push(check('jst_timecode_preserved_raw', props?.timeCodeJst === '202608290500', 'verbatim'))
  results.push(check('up_down_volumes_parsed', props?.vehicleFlowCountUp === 508 && props?.vehicleFlowCountDown === 640, `up=${props?.vehicleFlowCountUp}`))
  results.push(check('observed_at_uses_source_timecode', event?.observedAt === '2026-08-28T20:00:00.000Z', `observedAt=${event?.observedAt}`))

  const bad = normalizeJarticTrafficFlow([makeDoc({ identifiers: { latitude: '35.7', longitude: 'abc' } })])
  results.push(check('non_numeric_longitude_is_skipped', bad.events.length === 0 && bad.skippedCount === 1, 'malformed'))

  return results
}

export function runNormalizeJarticTrafficFlowValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeJarticTrafficFlowValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeJarticTrafficFlow validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

/**
 * Deterministic regression suite for the Digitraffic road-weather normalizer. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/normalizeDigitrafficRoadWeather.validation.ts
 */
import { pathToFileURL } from 'node:url'
import type { ResearchDocument } from '@/lib/research-engine/core/types'
import { normalizeDigitrafficRoadWeather } from './normalizeDigitrafficRoadWeather'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    id: 'digitraffic_road_weather:12345',
    provider: 'digitraffic_road_weather',
    providerRecordId: '12345',
    title: 'Road weather station 12345',
    summary: null,
    contentSnippet: 'lat 60.2, lon 24.9',
    canonicalUrl: 'https://tie.digitraffic.fi/api/weather/v1/stations/12345/data',
    sourceUrl: 'https://tie.digitraffic.fi/api/weather/v1/stations/12345/data',
    sourceName: 'Digitraffic Road Weather (Fintraffic)',
    contentType: 'road_weather_observation',
    authors: [],
    organization: 'Fintraffic',
    publishedAt: '2026-08-28T21:59:00.000Z',
    updatedAt: null,
    retrievedAt: '2026-08-28T22:00:00.000Z',
    geography: 'lat 60.2, lon 24.9',
    language: null,
    identifiers: {
      stationId: '12345', latitude: '60.2', longitude: '24.9',
      measuredTimeIso: '2026-08-28T21:59:00.000Z', airTemperatureC: '14.5',
      relativeHumidityPct: '82', rawSensorCodesJson: '{"KELI_1":"2"}',
      sourceReportsUnavailable: 'false',
    },
    subjects: [],
    license: null,
    accessStatus: 'open',
    score: null,
    providerRank: null,
    citations: [],
    provenance: { provider: 'digitraffic_road_weather', sourceUrl: 'https://tie.digitraffic.fi/api/weather/v1/stations/12345/data', retrievedAt: '2026-08-28T22:00:00.000Z', requestDurationMs: 0, fromCache: false, isHistorical: false },
    warnings: [],
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const ok = normalizeDigitrafficRoadWeather([makeDoc()])
  results.push(check('valid_observation_normalizes', ok.events.length === 1 && ok.skippedCount === 0, `events=${ok.events.length}`))
  const event = ok.events[0]
  const props = event?.properties as Record<string, unknown> | undefined
  results.push(check('kind_is_road_weather_observation', event?.kind === 'road_weather_observation' && event?.domain === 'weather', `kind=${event?.kind}`))
  results.push(check('observed_at_uses_measured_time', event?.observedAt === '2026-08-28T21:59:00.000Z', `observedAt=${event?.observedAt}`))
  results.push(check('temperature_and_humidity_parsed', props?.airTemperatureC === 14.5 && props?.relativeHumidityPct === 82, 'numbers'))
  results.push(check('raw_sensor_codes_preserved_not_decoded', JSON.stringify(props?.rawSensorCodes) === '{"KELI_1":"2"}', 'raw'))
  results.push(check('snow_ice_indicator_is_never_invented', props?.snowOrIceIndicator === null, 'null'))

  const badCodes = normalizeDigitrafficRoadWeather([makeDoc({ identifiers: { latitude: '60.2', longitude: '24.9', rawSensorCodesJson: 'not-json' } })])
  results.push(check('malformed_sensor_codes_become_null_not_crash', badCodes.events.length === 1 && (badCodes.events[0].properties as Record<string, unknown>).rawSensorCodes === null, 'null'))

  const missing = normalizeDigitrafficRoadWeather([makeDoc({ identifiers: {} })])
  results.push(check('missing_coordinates_are_skipped', missing.events.length === 0 && missing.skippedCount === 1, 'skipped'))

  return results
}

export function runNormalizeDigitrafficRoadWeatherValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runNormalizeDigitrafficRoadWeatherValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra normalizeDigitrafficRoadWeather validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

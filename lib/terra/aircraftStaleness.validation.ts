/**
 * Deterministic regression suite for the per-aircraft staleness rule. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aircraftStaleness.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { isTerraAircraftStale, TERRA_AIRCRAFT_STALE_AFTER_MS } from './aircraftStaleness'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const now = '2026-08-27T01:00:00.000Z'

  results.push(check('fresh_observation_is_not_stale', isTerraAircraftStale('2026-08-27T00:59:50.000Z', now) === false, '10s old'))
  results.push(check('observation_older_than_threshold_is_stale', isTerraAircraftStale('2026-08-27T00:58:00.000Z', now) === true, '120s old'))

  {
    const boundary = new Date(Date.parse(now) - TERRA_AIRCRAFT_STALE_AFTER_MS - 1).toISOString()
    results.push(check('one_ms_past_threshold_is_stale', isTerraAircraftStale(boundary, now) === true, boundary))
  }

  results.push(check('null_observation_is_stale', isTerraAircraftStale(null, now) === true, 'null in'))
  results.push(check('malformed_timestamp_is_honestly_stale_not_assumed_fresh', isTerraAircraftStale('not-a-date', now) === true, 'malformed in'))

  return results
}

export function runAircraftStalenessValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAircraftStalenessValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aircraftStaleness validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

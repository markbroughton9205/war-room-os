/**
 * Deterministic regression suite for the per-vessel staleness rule. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/vesselStaleness.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { isTerraVesselStale, TERRA_VESSEL_STALE_AFTER_MS } from './vesselStaleness'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const now = '2026-08-27T01:00:00.000Z'

  results.push(check('fresh_observation_is_not_stale', isTerraVesselStale('2026-08-27T00:59:50.000Z', now) === false, '10s old'))
  results.push(check('observation_older_than_threshold_is_stale', isTerraVesselStale('2026-08-27T00:45:00.000Z', now) === true, '900s old'))

  {
    const boundary = new Date(Date.parse(now) - TERRA_VESSEL_STALE_AFTER_MS - 1).toISOString()
    results.push(check('one_ms_past_threshold_is_stale', isTerraVesselStale(boundary, now) === true, boundary))
  }

  results.push(check('null_observation_is_stale', isTerraVesselStale(null, now) === true, 'null in'))
  results.push(check('malformed_timestamp_is_honestly_stale_not_assumed_fresh', isTerraVesselStale('not-a-date', now) === true, 'malformed in'))

  return results
}

export function runVesselStalenessValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runVesselStalenessValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra vesselStaleness validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

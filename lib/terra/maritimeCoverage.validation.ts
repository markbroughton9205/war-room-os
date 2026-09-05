/**
 * Deterministic regression suite for Maritime Coverage Truth resolution — the release-blocking
 * distinction between NO_COVERAGE and NO_VESSELS_OBSERVED. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/maritimeCoverage.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { resolveTerraMaritimeCoverageState } from './maritimeCoverage'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  // --- Mission-critical: no known coverage at all must NEVER read as "0 vessels" ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: false, boundingBoxQuery: null, feedState: 'empty', lastErrorMessage: null })
    results.push(check('no_coverage_is_never_reported_as_no_vessels_observed', state === 'NO_COVERAGE', state))
  }

  // --- A real bounded query with zero real matching vessels is an honest NO_VESSELS_OBSERVED,
  //     distinct from NO_COVERAGE ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: '59.8,24.5,60.5,25.5', feedState: 'empty', lastErrorMessage: null })
    results.push(check('real_empty_fetch_in_coverage_is_no_vessels_observed', state === 'NO_VESSELS_OBSERVED', state))
  }

  // --- A real fetch with real vessels is LIVE_DATA_PRESENT ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: '59.8,24.5,60.5,25.5', feedState: 'live', lastErrorMessage: null })
    results.push(check('real_live_fetch_is_live_data_present', state === 'LIVE_DATA_PRESENT', state))
  }

  // --- A hard failure with no prior data is SOURCE_OFFLINE, not silently empty ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: '59.8,24.5,60.5,25.5', feedState: 'error', lastErrorMessage: 'HTTP 500' })
    results.push(check('hard_failure_is_source_offline', state === 'SOURCE_OFFLINE', state))
  }

  // --- A failed refresh that still has prior data is DELAYED_DATA, never re-labeled live ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: '59.8,24.5,60.5,25.5', feedState: 'stale', lastErrorMessage: 'HTTP 503' })
    results.push(check('stale_feed_is_delayed_data_not_relabeled_live', state === 'DELAYED_DATA', state))
  }

  // --- A 429 error message is specifically classified RATE_LIMITED, not a generic offline ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: '59.8,24.5,60.5,25.5', feedState: 'error', lastErrorMessage: 'HTTP 429' })
    results.push(check('rate_limit_error_is_classified_rate_limited', state === 'RATE_LIMITED', state))
  }

  // --- Still loading (no result yet) is PENDING, never a premature LIVE/EMPTY claim ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: '59.8,24.5,60.5,25.5', feedState: 'loading', lastErrorMessage: null })
    results.push(check('loading_state_is_pending', state === 'PENDING', state))
  }

  // --- A null bounding-box query (even if hasKnownCoverage claims true) never claims live data ---
  {
    const state = resolveTerraMaritimeCoverageState({ hasKnownCoverage: true, boundingBoxQuery: null, feedState: 'live', lastErrorMessage: null })
    results.push(check('null_query_is_never_reported_as_live', state === 'NO_COVERAGE', state))
  }

  return results
}

export function runMaritimeCoverageValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runMaritimeCoverageValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra maritimeCoverage validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

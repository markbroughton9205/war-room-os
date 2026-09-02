/**
 * Deterministic regression suite for the Coverage Truth model. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/coverageTruth.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { resolveTerraCoverageTruth } from './coverageTruth'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const base = { hasKnownCoverage: true, boundingBoxQuery: '45.30,-74.20,45.80,-73.30', feedState: 'live' as const, lastErrorMessage: null, allFeaturesHistoricalOrStale: null }

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('no_coverage_when_outside_envelope', resolveTerraCoverageTruth({ ...base, hasKnownCoverage: false }) === 'NO_COVERAGE', 'outside'))
  results.push(check('no_coverage_when_no_bbox_query', resolveTerraCoverageTruth({ ...base, boundingBoxQuery: null }) === 'NO_COVERAGE', 'null query'))
  results.push(check('loading_state_wins', resolveTerraCoverageTruth({ ...base, feedState: 'loading' }) === 'LOADING', 'loading'))
  results.push(check('http_error_is_offline', resolveTerraCoverageTruth({ ...base, feedState: 'error', lastErrorMessage: 'HTTP 503 from upstream' }) === 'OFFLINE', '503'))
  results.push(check('ambiguous_error_is_unknown_not_offline', resolveTerraCoverageTruth({ ...base, feedState: 'error', lastErrorMessage: 'network timeout' }) === 'UNKNOWN', 'no http status'))
  results.push(check('error_without_message_is_unknown', resolveTerraCoverageTruth({ ...base, feedState: 'error', lastErrorMessage: null }) === 'UNKNOWN', 'null message'))
  results.push(check('stale_feed_state_is_stale', resolveTerraCoverageTruth({ ...base, feedState: 'stale' }) === 'STALE', 'stale'))
  results.push(check('all_historical_features_is_stale_never_live', resolveTerraCoverageTruth({ ...base, allFeaturesHistoricalOrStale: true }) === 'STALE', 'webtris case'))
  results.push(check('empty_is_no_data_not_no_coverage', resolveTerraCoverageTruth({ ...base, feedState: 'empty' }) === 'NO_DATA', 'covered but nothing returned'))
  results.push(check('healthy_nonempty_is_live', resolveTerraCoverageTruth(base) === 'LIVE', 'ok + features'))
  results.push(check('no_coverage_never_rendered_as_no_data', resolveTerraCoverageTruth({ ...base, hasKnownCoverage: false, feedState: 'empty' }) === 'NO_COVERAGE', 'invariant'))

  return results
}

export function runCoverageTruthValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runCoverageTruthValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Terra coverageTruth validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

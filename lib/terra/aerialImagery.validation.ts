/**
 * Deterministic regression suite for the high-res aerial imagery truth boundary. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aerialImagery.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { terraHighResAerialUnavailable } from './aerialImagery'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  results.push(check('global_scale_never_shows_banner_even_without_aerial', terraHighResAerialUnavailable(false, 'global') === false, 'global/no-aerial'))
  results.push(check('regional_scale_never_shows_banner_even_without_aerial', terraHighResAerialUnavailable(false, 'regional') === false, 'regional/no-aerial'))
  results.push(check('city_scale_without_aerial_shows_banner', terraHighResAerialUnavailable(false, 'city') === true, 'city/no-aerial'))
  results.push(check('local_scale_without_aerial_shows_banner', terraHighResAerialUnavailable(false, 'local') === true, 'local/no-aerial'))
  results.push(check('building_scale_without_aerial_shows_banner', terraHighResAerialUnavailable(false, 'building') === true, 'building/no-aerial'))
  results.push(check('building_scale_with_real_aerial_hides_banner', terraHighResAerialUnavailable(true, 'building') === false, 'building/aerial-active'))
  results.push(check('city_scale_with_real_aerial_hides_banner', terraHighResAerialUnavailable(true, 'city') === false, 'city/aerial-active'))
  results.push(check('token_presence_alone_is_not_enough_only_real_detected_asset_counts', terraHighResAerialUnavailable(false, 'local') === true, 'caller must pass detected availability, not bare token presence'))

  return results
}

export function runAerialImageryValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runAerialImageryValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Terra aerialImagery validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

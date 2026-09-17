/**
 * Deterministic regression suite for the high-res aerial imagery truth boundary. Run directly:
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/aerialImagery.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { TERRA_SCALE_THRESHOLDS_M } from '@/components/war-room/terra/useTerraCameraScale'
import {
  resolveTerraImageryAlphas,
  terraFallbackImageryActive,
  terraHighResAerialUnavailable,
} from './aerialImagery'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function nearly(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps
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
  results.push(check('fallback_banner_companion_matches_unavailable_at_city', terraFallbackImageryActive(false, 'city') === true, 'city/no-aerial fallback active'))
  results.push(check('fallback_banner_companion_hidden_when_aerial_live', terraFallbackImageryActive(true, 'city') === false, 'city/aerial'))

  const cityNoAerial = resolveTerraImageryAlphas({
    aerialAvailable: false,
    photographicFailed: false,
    mapDetailMode: false,
    heightMeters: TERRA_SCALE_THRESHOLDS_M.city,
  })
  results.push(check(
    'city_without_aerial_shows_osm_not_stretched_gibs',
    nearly(cityNoAerial.osm, 1) && nearly(cityNoAerial.gibs, 0) && nearly(cityNoAerial.world, 0) && cityNoAerial.fallbackActive,
    JSON.stringify(cityNoAerial),
  ))

  const buildingNoAerial = resolveTerraImageryAlphas({
    aerialAvailable: false,
    photographicFailed: false,
    mapDetailMode: false,
    heightMeters: 800,
  })
  results.push(check(
    'building_without_aerial_shows_osm',
    nearly(buildingNoAerial.osm, 1) && nearly(buildingNoAerial.gibs, 0) && buildingNoAerial.fallbackActive,
    JSON.stringify(buildingNoAerial),
  ))

  const regionalNoAerial = resolveTerraImageryAlphas({
    aerialAvailable: false,
    photographicFailed: false,
    mapDetailMode: false,
    heightMeters: TERRA_SCALE_THRESHOLDS_M.regional,
  })
  results.push(check(
    'regional_without_aerial_keeps_gibs_photograph',
    nearly(regionalNoAerial.osm, 0) && nearly(regionalNoAerial.gibs, 1) && !regionalNoAerial.fallbackActive,
    JSON.stringify(regionalNoAerial),
  ))

  const cityWithAerial = resolveTerraImageryAlphas({
    aerialAvailable: true,
    photographicFailed: false,
    mapDetailMode: false,
    heightMeters: TERRA_SCALE_THRESHOLDS_M.city,
  })
  results.push(check(
    'city_with_aerial_keeps_world_imagery_osm_hidden',
    nearly(cityWithAerial.osm, 0) && nearly(cityWithAerial.world, 1) && nearly(cityWithAerial.gibs, 0) && !cityWithAerial.fallbackActive,
    JSON.stringify(cityWithAerial),
  ))

  const commanderOsm = resolveTerraImageryAlphas({
    aerialAvailable: true,
    photographicFailed: false,
    mapDetailMode: true,
    heightMeters: TERRA_SCALE_THRESHOLDS_M.city,
  })
  results.push(check(
    'commander_map_detail_toggle_forces_osm_over_photos',
    nearly(commanderOsm.osm, 1) && nearly(commanderOsm.gibs, 0) && nearly(commanderOsm.world, 0) && commanderOsm.fallbackActive,
    JSON.stringify(commanderOsm),
  ))

  const gibsFailed = resolveTerraImageryAlphas({
    aerialAvailable: false,
    photographicFailed: true,
    mapDetailMode: false,
    heightMeters: TERRA_SCALE_THRESHOLDS_M.regional,
  })
  results.push(check(
    'gibs_failure_without_aerial_shows_osm_even_at_regional',
    nearly(gibsFailed.osm, 1) && nearly(gibsFailed.gibs, 0) && gibsFailed.fallbackActive,
    JSON.stringify(gibsFailed),
  ))

  const midBand = resolveTerraImageryAlphas({
    aerialAvailable: false,
    photographicFailed: false,
    mapDetailMode: false,
    heightMeters: (TERRA_SCALE_THRESHOLDS_M.regional + TERRA_SCALE_THRESHOLDS_M.city) / 2,
  })
  results.push(check(
    'crossfade_band_without_aerial_splits_gibs_and_osm',
    nearly(midBand.gibs, 0.5) && nearly(midBand.osm, 0.5) && midBand.fallbackActive,
    JSON.stringify(midBand),
  ))

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

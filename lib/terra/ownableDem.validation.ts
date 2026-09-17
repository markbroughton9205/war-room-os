import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  demFallbackIsTruthful,
  ownableDemProductLicense,
  terraOwnableDemLaneState,
} from './ownableDem'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const state = terraOwnableDemLaneState()
  results.push(check(
    'cesium_world_terrain_remains_active',
    state.activeGlobeTerrain === 'CESIUM_WORLD_TERRAIN' && state.fallback === 'CESIUM_WORLD_TERRAIN',
    state.activeGlobeTerrain,
  ))
  results.push(check(
    'ownable_lane_is_not_ingested',
    state.ownableLane === 'NOT_INGESTED' && state.coverageState === 'NO_COVERAGE',
    `${state.ownableLane}:${state.coverageState}`,
  ))
  results.push(check(
    'no_silent_ellipsoid_substitution',
    demFallbackIsTruthful(state) && state.silentlySubstitutesEllipsoid === false,
    'fallback stays Cesium World Terrain with honest NO_COVERAGE',
  ))
  results.push(check(
    'cop30_license_verified_before_ingest',
    Boolean(ownableDemProductLicense('cop30')?.licenseVerified && ownableDemProductLicense('cop30')?.ingestAllowed),
    ownableDemProductLicense('cop30')?.license ?? 'missing',
  ))
  results.push(check(
    'opentopography_blocked_until_key_and_approval',
    ownableDemProductLicense('opentopography')?.ingestAllowed === false,
    ownableDemProductLicense('opentopography')?.ingestBlockedReason ?? 'missing',
  ))
  const globe = readFileSync(resolve('components/war-room/terra/TerraGlobe.tsx'), 'utf8')
  results.push(check(
    'globe_still_constructs_cesium_world_terrain',
    globe.includes('createWorldTerrainAsync') && !globe.includes('ownableDem'),
    'Cesium World Terrain path is unchanged',
  ))
  return results
}

export function runOwnableDemValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runOwnableDemValidation()
  const failed = results.filter(result => !result.pass)
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  console.log(`Terra ownable DEM: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  if (failed.length) process.exit(1)
}

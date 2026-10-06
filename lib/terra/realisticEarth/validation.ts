/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/realisticEarth/validation.ts
 */
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import {
  archiveMustNotBeCalledLive,
  atmosphereDepthForBand,
  CITY_LIGHT_BLEND,
  CITY_LIGHT_SOURCE_ARCHIVE,
  CITY_LIGHT_SOURCE_RECENT,
  CITY_LIGHT_TUNING,
  cityLightsSourceLabel,
  cityLightsTuningForBand,
  CLOUD_CROSSFADE,
  CLOUD_DEPTH_PRESENTATION,
  CLOUD_FEDERATION_PROVIDERS,
  CLOUD_FRAME_MODEL,
  CLOUD_PROVIDER_ASIA,
  CLOUD_PROVIDER_GLOBAL_FILL,
  CLOUD_PROVIDER_PRIMARY,
  cloudCadenceMs,
  applyFederationProbe,
  globalCoverageClaim,
  inferredUrbanIlluminationEnabled,
  INFERRED_URBAN_ILLUMINATION,
  observedNightLightsMaxLevel,
  pointInGoesCloudCoverage,
  pointInHimawariCoverage,
  selectCloudProduct,
  selectCloudProvider,
  VOLUMETRIC_FUTURE_DESIGN,
} from './index'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('recent_not_live', CITY_LIGHT_SOURCE_RECENT.liveClaim === false && CITY_LIGHT_SOURCE_RECENT.freshnessLabel.includes('RECENT'), CITY_LIGHT_SOURCE_RECENT.freshnessLabel))
  results.push(check('archive_not_live', CITY_LIGHT_SOURCE_ARCHIVE.liveClaim === false && CITY_LIGHT_SOURCE_ARCHIVE.year === 2016, CITY_LIGHT_SOURCE_ARCHIVE.freshnessLabel))
  results.push(check('archive_freshness_guard', archiveMustNotBeCalledLive('ARCHIVE', 'STALE') && !archiveMustNotBeCalledLive('ARCHIVE', 'LIVE'), 'stale ok / live blocked'))
  results.push(check('blend_enable_lighting', CITY_LIGHT_BLEND.globeEnableLighting === true && CITY_LIGHT_BLEND.autoDay.dayAlpha === 0, 'dayAlpha 0'))
  results.push(check('no_neon_saturation', CITY_LIGHT_TUNING.saturation <= 0.35 && CITY_LIGHT_TUNING.contrast >= 1.2, String(CITY_LIGHT_TUNING.saturation)))
  results.push(check('street_caps_max_level', observedNightLightsMaxLevel('STREET') < observedNightLightsMaxLevel('GLOBAL'), `${observedNightLightsMaxLevel('STREET')}/${observedNightLightsMaxLevel('GLOBAL')}`))
  results.push(check(
    'inferred_street_night_only',
    inferredUrbanIlluminationEnabled({ band: 'STREET', solar: 'NIGHT', lightingMode: 'AUTO' })
      && !inferredUrbanIlluminationEnabled({ band: 'GLOBAL', solar: 'NIGHT', lightingMode: 'AUTO' })
      && !inferredUrbanIlluminationEnabled({ band: 'STREET', solar: 'DAY', lightingMode: 'AUTO' }),
    INFERRED_URBAN_ILLUMINATION.label,
  ))
  results.push(check('inferred_is_presentation', INFERRED_URBAN_ILLUMINATION.truthClass === 'PRESENTATION', INFERRED_URBAN_ILLUMINATION.basis))
  results.push(check('daily_label_observed', cityLightsSourceLabel('DAILY').includes('OBSERVED') && !cityLightsSourceLabel('DAILY').includes('LIVE electricity'), cityLightsSourceLabel('DAILY')))
  results.push(check('archive_label_not_live', cityLightsSourceLabel('ARCHIVE').includes('ARCHIVAL') && !cityLightsSourceLabel('ARCHIVE').includes('LIVE ·'), cityLightsSourceLabel('ARCHIVE')))
  results.push(check('orbit_tuning_restrained', cityLightsTuningForBand('GLOBAL').saturation <= CITY_LIGHT_TUNING.saturation, String(cityLightsTuningForBand('GLOBAL').saturation)))

  results.push(check('goes_primary_id', CLOUD_PROVIDER_PRIMARY === 'nasa_gibs_goes_geocolor', CLOUD_PROVIDER_PRIMARY))
  results.push(check('asia_id', CLOUD_PROVIDER_ASIA === 'jma_himawari', CLOUD_PROVIDER_ASIA))
  results.push(check('fill_id', CLOUD_PROVIDER_GLOBAL_FILL === 'ssec_realearth_globalir', CLOUD_PROVIDER_GLOBAL_FILL))
  results.push(check('frame_model_no_latest', /never mixed latest/i.test(CLOUD_FRAME_MODEL), CLOUD_FRAME_MODEL))
  results.push(check('crossfade_two_slot', /two persistent slots/i.test(CLOUD_CROSSFADE), CLOUD_CROSSFADE))

  const tokyo = selectCloudProvider({ longitude: 139.69, latitude: 35.68, solar: 'DAY', goesFrameCount: 8, himawariFrameCount: 0, fillFrameCount: 0, goesHealth: 'HEALTHY' })
  results.push(check('tokyo_no_fake_himawari', tokyo.failover === 'NOT_AVAILABLE_TRUTHFULLY' && tokyo.naturalColorClaim === false, tokyo.reason))
  results.push(check('tokyo_in_himawari_envelope', pointInHimawariCoverage(139.69, 35.68) && !pointInGoesCloudCoverage(139.69, 35.68), 'asia'))

  const akron = selectCloudProvider({ longitude: -81.52, latitude: 41.08, solar: 'DAY', goesFrameCount: 8, himawariFrameCount: 0, fillFrameCount: 0, goesHealth: 'HEALTHY' })
  results.push(check('akron_goes_primary', akron.providerId === CLOUD_PROVIDER_PRIMARY && akron.failover === 'NONE', akron.reason))

  const nightGoes = selectCloudProduct({ solar: 'NIGHT', inGoes: true })
  results.push(check('night_not_natural', nightGoes.appearance === 'INFRARED' && /not natural/i.test(nightGoes.reason), nightGoes.reason))

  const failed = selectCloudProvider({ longitude: -81.52, latitude: 41.08, solar: 'DAY', goesFrameCount: 0, himawariFrameCount: 0, fillFrameCount: 4, goesHealth: 'OFFLINE' })
  results.push(check('goes_fail_uses_ir_fill_if_present', failed.failover === 'REALEARTH_IR' && failed.appearance === 'INFRARED' && failed.naturalColorClaim === false, failed.reason))

  const noFill = selectCloudProvider({ longitude: -81.52, latitude: 41.08, solar: 'DAY', goesFrameCount: 0, himawariFrameCount: 0, fillFrameCount: 0, goesHealth: 'OFFLINE' })
  results.push(check('goes_fail_without_fill_is_honest', noFill.failover === 'NOT_AVAILABLE_TRUTHFULLY', noFill.reason))

  const probed = applyFederationProbe(CLOUD_FEDERATION_PROVIDERS, { himawariOk: false, fillOk: false })
  results.push(check('unproven_asia_not_wired', probed.find(item => item.id === CLOUD_PROVIDER_ASIA)?.status === 'PROBED_NO_COVERAGE', probed.find(item => item.id === CLOUD_PROVIDER_ASIA)?.status ?? 'missing'))
  results.push(check('unproven_fill_not_wired', probed.find(item => item.id === CLOUD_PROVIDER_GLOBAL_FILL)?.status === 'PROBED_NO_COVERAGE', probed.find(item => item.id === CLOUD_PROVIDER_GLOBAL_FILL)?.status ?? 'missing'))
  results.push(check('coverage_not_claimed_global', globalCoverageClaim(probed) === 'PARTIAL', globalCoverageClaim(probed)))

  results.push(check('street_clouds_slower_cadence', cloudCadenceMs('STREET', 'NORMAL', true) > cloudCadenceMs('GLOBAL', 'NORMAL', true), `${cloudCadenceMs('STREET', 'NORMAL', true)}/${cloudCadenceMs('GLOBAL', 'NORMAL', true)}`))
  results.push(check('pressure_slows_clouds', cloudCadenceMs('GLOBAL', 'PRESSURE', true) > cloudCadenceMs('GLOBAL', 'NORMAL', true), String(cloudCadenceMs('GLOBAL', 'PRESSURE', true))))

  const globalDepth = atmosphereDepthForBand('GLOBAL')
  const streetDepth = atmosphereDepthForBand('STREET')
  results.push(check('depth_view_aware', globalDepth.shell > streetDepth.shell && streetDepth.parallax === 0, `${globalDepth.shell}/${streetDepth.shell}`))
  results.push(check('no_procedural_storms', CLOUD_DEPTH_PRESENTATION.proceduralStormMotion === false && CLOUD_DEPTH_PRESENTATION.subtleParallax === false, 'ok'))
  results.push(check('volumetric_not_implemented', VOLUMETRIC_FUTURE_DESIGN.authorizedNow === false, VOLUMETRIC_FUTURE_DESIGN.gpuCost.tier3_globalVolume.slice(0, 60)))

  const require = createRequire(import.meta.url)
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const cloudSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraCloudImagery.tsx'), 'utf8')
  const nightSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraNightLights.tsx'), 'utf8')
  const buildingsSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraCesiumOsmBuildings.tsx'), 'utf8')
  results.push(check('cloud_two_slot_preserved', cloudSrc.includes('Persistent double-buffer') && cloudSrc.includes('front') && cloudSrc.includes('back'), 'slots'))
  results.push(check('night_uses_day_night_alpha', nightSrc.includes('dayAlpha') && nightSrc.includes('nightAlpha') && nightSrc.includes('enableLighting'), 'cesium blend'))
  results.push(check('inferred_labeled_presentation', buildingsSrc.includes('PRESENTATION') && buildingsSrc.includes('INFERRED URBAN ILLUMINATION'), 'label'))
  results.push(check('gamma_contrast_wired', nightSrc.includes('gamma') && nightSrc.includes('contrast'), 'tuning'))

  return results
}

const isDirect = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
if (isDirect) {
  const results = run()
  let failed = 0
  for (const row of results) {
    if (!row.pass) failed += 1
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
  }
  console.log(`Terra Realistic Earth Phase 2: ${results.length - failed}/${results.length} ${failed ? 'FAIL' : 'PASS'}`)
  if (failed) process.exit(1)
}

export { run }

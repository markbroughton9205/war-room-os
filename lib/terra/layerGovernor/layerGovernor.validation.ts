/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/layerGovernor/layerGovernor.validation.ts
 */
import { applyGovernorAntiThrash } from './antiThrash'
import { inferGovernorContext } from './context'
import { classifyProviderHealth, providerRetryAllowed } from './health'
import { governorAcceptanceReport } from './intelligence'
import { buildLayerGovernorPlan } from './plan'
import { planPrefetch } from './prefetch'
import { learnPresentationPref, parseLearnedPrefs, resetLearnedPrefs } from './preferences'
import { heavyLayerBudget, resolveResourceState } from './pressure'
import { geoColorSaturation, REALISM_OVERLAY_BUDGET } from './realism'
import {
  GOVERNOR_MIN_STATE_MS,
  GOVERNED_LAYER_IDS,
  type GovernorSnapshot,
  type LayerMode,
} from './types'
import { nextViewBand } from './viewBands'
import { createRequire } from 'node:module'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function base(overrides: Partial<GovernorSnapshot> = {}): GovernorSnapshot {
  return {
    nowMs: 1_000_000,
    masterAuto: true,
    layerModes: {},
    scale: 'global',
    timeMode: 'live',
    solarState: 'DAY',
    lightingMode: 'AUTO',
    orbiting: true,
    flying: false,
    idle: true,
    reducedMotion: false,
    selectionKind: null,
    selectionLayerId: null,
    mediaOpen: false,
    godsEyeMode: 'EARTH',
    hasActiveLocation: false,
    latitude: null,
    longitude: null,
    coveringProviders: [],
    cloudsTruth: 'RECENT',
    cloudFrames: 9,
    radarState: 'NO_COVERAGE',
    radarHasFrame: false,
    radarCoverage: false,
    lightningTruth: 'LIVE',
    lightningCount: 40,
    auroraTruth: 'LIVE',
    auroraMax: 22,
    earthquakeCount: 8,
    firesAvailable: false,
    firesTruth: 'UNAVAILABLE',
    weatherAlertCount: 0,
    weatherSelected: false,
    earthquakeSelected: false,
    fps: 48,
    entityCount: 20,
    learned: {},
    flightKey: null,
    ...overrides,
  }
}

function modes(partial: Partial<Record<string, LayerMode>>): Partial<Record<typeof GOVERNED_LAYER_IDS[number], LayerMode>> {
  return partial as Partial<Record<typeof GOVERNED_LAYER_IDS[number], LayerMode>>
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const globe = buildLayerGovernorPlan(base())
  results.push(check('1_globe_idle_context', globe.inferred.context === 'PLANETARY' && globe.inferred.confidence === 'HIGH', `${globe.inferred.context}/${globe.inferred.confidence}`))
  results.push(check('1_globe_clouds_active', globe.layers.clouds.effective === 'ACTIVE' && globe.layers.clouds.animate, globe.layers.clouds.reason))
  results.push(check('1_globe_cameras_unloaded', globe.layers.nearby_cameras.effective === 'UNLOADED', globe.layers.nearby_cameras.reason))
  results.push(check('1_globe_fires_hidden', globe.layers.fires.effective === 'HIDDEN', globe.layers.fires.reason))

  const city = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    orbiting: false,
    hasActiveLocation: true,
    latitude: 41.08,
    longitude: -81.52,
    coveringProviders: ['ohgo_cameras'],
    radarCoverage: true,
    radarHasFrame: true,
    radarState: 'AVAILABLE',
  }))
  results.push(check('2_jump_city_context', city.inferred.context === 'LOCAL_EXPLORATION', city.inferred.context))
  results.push(check('2_jump_city_roads', city.layers.roads.effective === 'ACTIVE' && city.layers.roads.reason.includes('CITY'), city.layers.roads.reason))
  results.push(check('2_jump_ohgo_fetch', city.layers.nearby_cameras.fetchAllowed && city.layers.nearby_cameras.reason.includes('OHGO'), city.layers.nearby_cameras.reason))

  const street = buildLayerGovernorPlan(base({
    scale: 'building',
    idle: false,
    orbiting: false,
    hasActiveLocation: true,
    latitude: 41.08,
    longitude: -81.52,
    coveringProviders: ['ohgo_cameras'],
    radarCoverage: true,
    radarHasFrame: true,
    radarState: 'AVAILABLE',
    weatherAlertCount: 1,
  }))
  results.push(check('3_street_context', street.inferred.context === 'STREET', street.inferred.context))
  results.push(check('3_street_clouds_dimmed', street.layers.clouds.effective === 'DIMMED' && street.layers.clouds.opacity <= 0.18, `${street.layers.clouds.effective} ${street.layers.clouds.opacity}`))
  results.push(check('3_street_roads_primary', street.layers.roads.priority === 'PRIMARY', street.layers.roads.priority))

  const weather = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    hasActiveLocation: true,
    latitude: 35.08,
    longitude: -106.65,
    coveringProviders: ['ohgo_cameras'],
    radarCoverage: true,
    radarHasFrame: true,
    radarState: 'AVAILABLE',
    weatherSelected: true,
    weatherAlertCount: 2,
    selectionLayerId: 'nws_severe_weather_alerts',
    selectionKind: 'feature',
  }))
  results.push(check('4_weather_context', weather.inferred.context === 'WEATHER' && weather.inferred.confidence === 'HIGH', `${weather.inferred.context} ${weather.inferred.evidence.join(';')}`))
  results.push(check('4_radar_primary', weather.layers.radar.priority === 'PRIMARY' && weather.layers.radar.effective === 'ACTIVE', weather.layers.radar.reason))
  results.push(check('4_clouds_dimmed_for_radar', weather.layers.clouds.effective === 'DIMMED' && weather.layers.clouds.reason.includes('radar PRIMARY'), weather.layers.clouds.reason))

  const quake = buildLayerGovernorPlan(base({
    scale: 'regional',
    idle: false,
    earthquakeSelected: true,
    selectionLayerId: 'usgs_earthquake_feed',
    selectionKind: 'feature',
    earthquakeCount: 3,
  }))
  results.push(check('5_quake_context', quake.inferred.context === 'HAZARD', quake.inferred.context))
  results.push(check('5_quake_critical', quake.layers.earthquakes.priority === 'CRITICAL', quake.layers.earthquakes.reason))

  const spain = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    hasActiveLocation: true,
    latitude: 40.4,
    longitude: -3.7,
    coveringProviders: [],
    radarCoverage: false,
    radarHasFrame: true,
    radarState: 'NO_COVERAGE',
  }))
  results.push(check('6_ohgo_unloaded_outside', !spain.layers.nearby_cameras.fetchAllowed && spain.layers.nearby_cameras.effective === 'UNLOADED' && spain.layers.nearby_cameras.reason.includes('outside provider envelope'), spain.layers.nearby_cameras.reason))
  results.push(check('6_radar_unloaded_outside', spain.layers.radar.effective === 'UNLOADED', spain.layers.radar.reason))

  const fail = buildLayerGovernorPlan(base({
    radarCoverage: true,
    radarHasFrame: false,
    radarState: 'UNAVAILABLE',
  }))
  results.push(check('7_provider_failure_hides_radar', fail.layers.radar.effective === 'HIDDEN', fail.layers.radar.reason))
  results.push(check('7_health_offline', classifyProviderHealth({ state: 'UNAVAILABLE' }) === 'OFFLINE', classifyProviderHealth({ state: 'UNAVAILABLE' })))
  results.push(check('7_retry_backoff', providerRetryAllowed({ health: 'OFFLINE', consecutiveFailures: 3, lastAttemptMs: 1_000_000, nowMs: 1_010_000 }) === false, '30s backoff'))
  results.push(check('7_retry_after_backoff', providerRetryAllowed({ health: 'OFFLINE', consecutiveFailures: 3, lastAttemptMs: 1_000_000, nowMs: 1_040_000 }) === true, 'allowed'))

  const backoffRadar = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    hasActiveLocation: true,
    radarCoverage: true,
    radarHasFrame: true,
    radarState: 'AVAILABLE',
    weatherSelected: true,
    selectionLayerId: 'nws_severe_weather_alerts',
    radarRetryAllowed: false,
  }))
  results.push(check('7_retry_pauses_radar', backoffRadar.layers.radar.effective === 'PAUSED' && backoffRadar.layers.radar.fetchAllowed === false && backoffRadar.layers.radar.reason.includes('retry backoff'), backoffRadar.layers.radar.reason))

  const heavy = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    hasActiveLocation: true,
    coveringProviders: ['ohgo_cameras'],
    radarCoverage: true,
    radarHasFrame: true,
    radarState: 'AVAILABLE',
    weatherAlertCount: 2,
    auroraMax: 40,
    fps: 12,
    previousResource: 'NORMAL',
  }))
  results.push(check('8_pressure_mode', heavy.resource === 'PRESSURE', heavy.resource))
  results.push(check('8_budget_pressure', heavy.heavyBudget === 2, String(heavy.heavyBudget)))
  results.push(check('8_alerts_not_hidden', heavy.layers.weather_hazards.priority === 'CRITICAL' && heavy.layers.weather_hazards.effective === 'ACTIVE', heavy.layers.weather_hazards.reason))

  const historical = buildLayerGovernorPlan(base({
    timeMode: 'historical',
    idle: false,
    hasActiveLocation: true,
    scale: 'regional',
  }))
  results.push(check('9_historical_context', historical.inferred.context === 'HISTORICAL', historical.inferred.context))
  results.push(check('9_lightning_hidden_historical', historical.layers.lightning.effective === 'HIDDEN', historical.layers.lightning.reason))

  const forced = buildLayerGovernorPlan(base({
    scale: 'global',
    layerModes: modes({ clouds: 'OFF', radar: 'ON', aurora: 'ON' }),
    radarCoverage: false,
    radarHasFrame: false,
  }))
  results.push(check('10_manual_clouds_off', forced.layers.clouds.effective === 'HIDDEN' && forced.layers.clouds.reason === 'Commander OFF', forced.layers.clouds.reason))
  results.push(check('10_manual_radar_on_no_coverage', forced.layers.radar.effective === 'UNLOADED' && forced.layers.radar.reason.includes('cannot invent coverage'), forced.layers.radar.reason))
  const cameraOffWhileSelected = buildLayerGovernorPlan(base({
    scale: 'local',
    idle: false,
    hasActiveLocation: true,
    coveringProviders: ['digitraffic_road_cameras'],
    selectionKind: 'feature',
    selectionLayerId: 'digitraffic_road_cameras',
    layerModes: modes({ nearby_cameras: 'OFF' }),
  }))
  results.push(check(
    '10_camera_off_wins_over_inspect_focus',
    cameraOffWhileSelected.layers.nearby_cameras.mode === 'OFF'
      && cameraOffWhileSelected.layers.nearby_cameras.effective === 'HIDDEN'
      && cameraOffWhileSelected.layers.nearby_cameras.fetchAllowed === false,
    `${cameraOffWhileSelected.layers.nearby_cameras.mode}/${cameraOffWhileSelected.layers.nearby_cameras.effective}/${cameraOffWhileSelected.layers.nearby_cameras.fetchAllowed}`,
  ))

  const reduced = buildLayerGovernorPlan(base({ reducedMotion: true }))
  results.push(check('11_reduced_motion_no_cloud_anim', reduced.layers.clouds.animate === false, String(reduced.layers.clouds.animate)))
  results.push(check('11_reduced_motion_no_lightning_anim', reduced.layers.lightning.animate === false, String(reduced.layers.lightning.animate)))

  const pressure = resolveResourceState({ fps: 12, previous: 'NORMAL' })
  const recover = resolveResourceState({ fps: 30, previous: 'PRESSURE' })
  const normal = resolveResourceState({ fps: 40, previous: 'RECOVERY' })
  results.push(check('12_pressure_then_recovery', pressure === 'PRESSURE' && recover === 'RECOVERY' && normal === 'NORMAL', `${pressure}->${recover}->${normal}`))
  results.push(check('12_budget_fn', heavyLayerBudget('PRESSURE') === 2 && heavyLayerBudget('NORMAL') === 4, 'ok'))

  const first = buildLayerGovernorPlan(base({ scale: 'global' }))
  const flipped = buildLayerGovernorPlan(base({ scale: 'city', idle: false, hasActiveLocation: true, coveringProviders: ['ohgo_cameras'], nowMs: 1_000_400 }))
  const held = applyGovernorAntiThrash({ previous: first, next: flipped, nowMs: 1_000_400, lastChangeMs: { clouds: 1_000_000, nearby_cameras: 1_000_000 } })
  results.push(check('anti_thrash_holds', held.plan.layers.nearby_cameras.effective === first.layers.nearby_cameras.effective, `${held.plan.layers.nearby_cameras.effective} held ${GOVERNOR_MIN_STATE_MS}`))
  const released = applyGovernorAntiThrash({ previous: first, next: flipped, nowMs: 1_002_000, lastChangeMs: { nearby_cameras: 1_000_000 } })
  results.push(check('anti_thrash_releases', released.plan.layers.nearby_cameras.effective === flipped.layers.nearby_cameras.effective, released.plan.layers.nearby_cameras.effective))

  const staleRadar = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    hasActiveLocation: true,
    radarCoverage: true,
    radarHasFrame: true,
    radarState: 'STALE',
    weatherSelected: true,
    selectionLayerId: 'nws_severe_weather_alerts',
  }))
  results.push(check('freshness_stale_radar_dimmed', staleRadar.layers.radar.effective === 'DIMMED' && staleRadar.layers.radar.reason.includes('STALE'), staleRadar.layers.radar.reason))

  const night = buildLayerGovernorPlan(base({ solarState: 'NIGHT', lightingMode: 'AUTO', scale: 'city', idle: false, hasActiveLocation: true }))
  results.push(check('night_lights_night', night.layers.night_lights.effective === 'ACTIVE', night.layers.night_lights.reason))
  const day = buildLayerGovernorPlan(base({ solarState: 'DAY', lightingMode: 'AUTO' }))
  results.push(check('night_lights_day_hidden', day.layers.night_lights.effective === 'HIDDEN', day.layers.night_lights.reason))

  const auroraQuiet = buildLayerGovernorPlan(base({ auroraMax: 4, auroraTruth: 'LIVE' }))
  results.push(check('aurora_no_activity', auroraQuiet.layers.aurora.effective === 'HIDDEN', auroraQuiet.layers.aurora.reason))

  const learned = learnPresentationPref({}, { streetCloudOpacity: 0.09 })
  const streetLearned = buildLayerGovernorPlan(base({
    scale: 'local',
    idle: false,
    hasActiveLocation: true,
    coveringProviders: ['ohgo_cameras'],
    learned,
  }))
  results.push(check('preference_learning', streetLearned.layers.clouds.opacity === 0.09, String(streetLearned.layers.clouds.opacity)))
  results.push(check('preference_reset', Object.keys(resetLearnedPrefs()).length === 0, 'empty'))
  results.push(check('preference_parse', parseLearnedPrefs('{"streetCloudOpacity":0.2}').streetCloudOpacity === 0.2, 'ok'))

  const pre = planPrefetch({ flying: true, flightKey: 'akron', coveringAtDestination: ['ohgo_cameras'], radarLikely: true, previousKey: 'madrid' })
  results.push(check('prefetch_cancels_stale', pre.cancelled && pre.providers.includes('ohgo_cameras'), `${pre.cancelled}`))
  results.push(check('prefetch_idle_empty', planPrefetch({ flying: false, flightKey: null, coveringAtDestination: ['ohgo_cameras'], radarLikely: true }).providers.length === 0, 'empty'))
  results.push(check('prefetch_weather_metadata', pre.weatherMetadata && pre.coverageMetadata, `${pre.weatherMetadata}/${pre.coverageMetadata}`))

  const masterOff = buildLayerGovernorPlan(base({ masterAuto: false, layerModes: modes({ clouds: 'AUTO' }) }))
  results.push(check('master_auto_off_keeps_reason', masterOff.layers.clouds.reason.includes('master AUTO off'), masterOff.layers.clouds.reason))

  const media = inferGovernorContext(base({ mediaOpen: true, scale: 'city', hasActiveLocation: true }))
  results.push(check('media_context', media.context === 'MEDIA_CONTEXT', media.context))

  results.push(check('explainability_every_layer', GOVERNED_LAYER_IDS.every(id => globe.layers[id].reason.length > 0), 'ok'))
  results.push(check('no_fake_fires', globe.layers.fires.reason.includes('no real fire source'), globe.layers.fires.reason))

  results.push(check('view_band_hysteresis', nextViewBand(3_000_000, 'GLOBAL') === 'GLOBAL' && nextViewBand(2_600_000, 'GLOBAL') === 'CONTINENTAL', `${nextViewBand(3_000_000, 'GLOBAL')}/${nextViewBand(2_600_000, 'GLOBAL')}`))
  results.push(check('globe_earth_dominant', globe.earthDominant === true && globe.viewBand === 'GLOBAL', `${globe.earthDominant}/${globe.viewBand}`))
  results.push(check('globe_clouds_restrained', globe.layers.clouds.opacity <= 0.5 && globe.layers.clouds.saturation <= 0.4, `${globe.layers.clouds.opacity}/${globe.layers.clouds.saturation}`))
  results.push(check('globe_radar_hidden', globe.layers.radar.effective === 'UNLOADED' || globe.layers.radar.effective === 'HIDDEN', globe.layers.radar.reason))
  results.push(check('globe_aurora_subtle', globe.layers.aurora.opacity <= 0.35, String(globe.layers.aurora.opacity)))
  results.push(check('globe_lightning_aggregated', globe.layers.lightning.detailLevel === 'AGGREGATED', globe.layers.lightning.intensityLabel))
  results.push(check('globe_quakes_major_only', globe.layers.earthquakes.detailLevel === 'MAJOR_ONLY', globe.layers.earthquakes.intensityLabel))
  results.push(check('globe_roads_hidden', globe.layers.roads.effective === 'UNLOADED', globe.layers.roads.reason))
  results.push(check('globe_admin_identity_active', globe.layers.admin_identity.effective === 'ACTIVE' && globe.layers.admin_identity.mode === 'AUTO', globe.layers.admin_identity.reason))
  results.push(check('globe_aircraft_unloaded', globe.layers.aircraft.effective === 'UNLOADED' && globe.layers.aircraft.fetchAllowed === false, globe.layers.aircraft.reason))
  results.push(check('globe_vessels_unloaded', globe.layers.vessels.effective === 'UNLOADED' && globe.layers.vessels.fetchAllowed === false, globe.layers.vessels.reason))
  const regionalMove = buildLayerGovernorPlan(base({ scale: 'regional', idle: false, viewBand: 'REGIONAL' }))
  results.push(check('regional_aircraft_tracks', regionalMove.layers.aircraft.effective === 'ACTIVE' && regionalMove.layers.aircraft.fetchAllowed, regionalMove.layers.aircraft.reason))
  results.push(check('regional_vessel_tracks', regionalMove.layers.vessels.effective === 'ACTIVE' && regionalMove.layers.vessels.fetchAllowed, regionalMove.layers.vessels.reason))
  const pressureContinental = buildLayerGovernorPlan(base({ scale: 'regional', idle: false, viewBand: 'CONTINENTAL', fps: 8 }))
  results.push(check('pressure_pauses_aircraft_fetch', pressureContinental.layers.aircraft.fetchAllowed === false, `${pressureContinental.layers.aircraft.effective}/${pressureContinental.layers.aircraft.fetchAllowed}/${pressureContinental.layers.aircraft.reason}`))
  results.push(check('pressure_pauses_vessel_fetch', pressureContinental.layers.vessels.fetchAllowed === false, `${pressureContinental.layers.vessels.effective}/${pressureContinental.layers.vessels.fetchAllowed}`))
  const cityMove = buildLayerGovernorPlan(base({ scale: 'city', idle: false, viewBand: 'CITY', hasActiveLocation: true }))
  results.push(check('city_aircraft_full', cityMove.layers.aircraft.detailLevel === 'FULL' && cityMove.layers.aircraft.entityDensity === 1, cityMove.layers.aircraft.reason))
  results.push(check('city_admin_dimmed', cityMove.layers.admin_identity.effective === 'DIMMED' || cityMove.layers.admin_identity.opacity <= 0.3, cityMove.layers.admin_identity.reason))
  const streetAdmin = buildLayerGovernorPlan(base({ scale: 'local', idle: false, viewBand: 'STREET', hasActiveLocation: true }))
  results.push(check('street_admin_hidden', streetAdmin.layers.admin_identity.effective === 'HIDDEN' && streetAdmin.layers.admin_identity.opacity === 0, streetAdmin.layers.admin_identity.reason))
  const spaceAdmin = buildLayerGovernorPlan(base({ scale: 'global', viewBand: 'SPACE' }))
  results.push(check('space_admin_major_only', spaceAdmin.layers.admin_identity.detailLevel === 'MAJOR_ONLY', spaceAdmin.layers.admin_identity.reason))
  results.push(check('space_geocolor_desat', geoColorSaturation('SPACE') <= 0.3, String(geoColorSaturation('SPACE'))))
  results.push(check('realism_budget_constant', REALISM_OVERLAY_BUDGET < 1, String(REALISM_OVERLAY_BUDGET)))

  const manualOn = buildLayerGovernorPlan(base({ scale: 'global', auroraMax: 40, layerModes: modes({ aurora: 'ON' }) }))
  results.push(check('manual_on_keeps_opacity', manualOn.layers.aurora.mode === 'ON' && manualOn.layers.aurora.opacity < 1, String(manualOn.layers.aurora.opacity)))

  const inspectAurora = buildLayerGovernorPlan(base({ scale: 'global', auroraMax: 55, auroraTruth: 'LIVE', selectionLayerId: 'ovation_aurora', selectionKind: 'feature' }))
  results.push(check('inspect_aurora_primary', inspectAurora.layers.aurora.priority === 'PRIMARY', inspectAurora.layers.aurora.reason))

  const cityExplore = buildLayerGovernorPlan(base({
    scale: 'city',
    idle: false,
    hasActiveLocation: true,
    coveringProviders: ['ohgo_cameras'],
    auroraMax: 40,
  }))
  results.push(check('city_aurora_hidden', cityExplore.layers.aurora.effective === 'HIDDEN' || cityExplore.layers.aurora.opacity <= 0.08, cityExplore.layers.aurora.reason))

  try {
    const require = createRequire(import.meta.url)
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const auroraSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraAuroraLayer.tsx'), 'utf8')
    const realismSrc = fs.readFileSync(path.join(process.cwd(), 'lib/terra/layerGovernor/realism.ts'), 'utf8')
    const cloudSrc = fs.readFileSync(path.join(process.cwd(), 'components/war-room/terra/TerraCloudImagery.tsx'), 'utf8')
    results.push(check('aurora_not_teal_wash', !auroraSrc.includes('#5EEAD4') && auroraSrc.includes('AURORA_PRESENTATION_COLOR') && realismSrc.includes('#86EFAC'), 'green oval'))
    results.push(check('cloud_saturation_no_rebuild', cloudSrc.includes('layer.saturation') && cloudSrc.includes('colorToAlphaThreshold'), 'existing layers'))
  } catch (error) {
    results.push(check('presentation_source_audit', false, error instanceof Error ? error.message : 'read failed'))
  }

  const reports: Array<[string, ReturnType<typeof buildLayerGovernorPlan>]> = [
    ['1 globe idle', globe],
    ['2 JUMP to city', city],
    ['3 zoom to street', street],
    ['4 select severe weather', weather],
    ['5 select earthquake', quake],
    ['6 outside provider coverage', spain],
    ['7 provider failure', fail],
    ['8 multiple heavy layers', heavy],
    ['9 historical timeline', historical],
    ['10 manual Commander override', forced],
  ]
  for (const [label, plan] of reports) {
    const report = governorAcceptanceReport(plan)
    const complete = Boolean(report.CONTEXT && report.CONFIDENCE && report.PRIMARY_LAYER && report.REASON && report.RESOURCE_STATE)
    results.push(check(`accept_${label.replace(/\s+/g, '_')}`, complete, `CONTEXT=${report.CONTEXT} CONFIDENCE=${report.CONFIDENCE} PRIMARY_LAYER=${report.PRIMARY_LAYER} SECONDARY_LAYERS=${report.SECONDARY_LAYERS} SUPPRESSED_LAYERS=${report.SUPPRESSED_LAYERS} REASON=${report.REASON} RESOURCE_STATE=${report.RESOURCE_STATE}`))
    console.log(`ACCEPT ${label}`)
    console.log(`  CONTEXT = ${report.CONTEXT}`)
    console.log(`  CONFIDENCE = ${report.CONFIDENCE}`)
    console.log(`  PRIMARY_LAYER = ${report.PRIMARY_LAYER}`)
    console.log(`  SECONDARY_LAYERS = ${report.SECONDARY_LAYERS}`)
    console.log(`  SUPPRESSED_LAYERS = ${report.SUPPRESSED_LAYERS}`)
    console.log(`  REASON = ${report.REASON}`)
    console.log(`  RESOURCE_STATE = ${report.RESOURCE_STATE}`)
    console.log(`  EVIDENCE = ${report.EVIDENCE.map(item => `\n  - ${item}`).join('')}`)
  }

  return results
}

const results = run()
let failed = 0
for (const row of results) {
  if (!row.pass) failed += 1
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`)
}
console.log(`Terra Layer Governor: ${results.length - failed}/${results.length} ${failed ? 'FAIL' : 'PASS'}`)
if (failed) process.exit(1)

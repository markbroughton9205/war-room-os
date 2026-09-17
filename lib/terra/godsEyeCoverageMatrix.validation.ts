/**
 * Deterministic honesty checks for the God's Eye coverage matrix.
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/godsEyeCoverageMatrix.validation.ts
 */
import { pathToFileURL } from 'node:url'
import { TERRA_LAYER_SUMMARIES } from './layerCatalogSummary'
import {
  GODS_EYE_ACTIVATION_STATE,
  GODS_EYE_COVERAGE_MATRIX,
  GODS_EYE_LAYER_GROUPS,
  godsEyeActivationState,
  isFabricatedSignalPhase,
  liveSignalPhaseFromInfrastructure,
} from './godsEyeCoverageMatrix'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const byId = new Map(GODS_EYE_COVERAGE_MATRIX.map(row => [row.id, row]))
  const catalogIds = new Set(TERRA_LAYER_SUMMARIES.map(layer => layer.id))

  results.push(check('never_fully_active', godsEyeActivationState() === 'ACTIVE_WITH_GAPS' && GODS_EYE_ACTIVATION_STATE !== 'FULLY_ACTIVE', GODS_EYE_ACTIVATION_STATE))
  results.push(check('all_groups_present', GODS_EYE_LAYER_GROUPS.every(group => GODS_EYE_COVERAGE_MATRIX.some(row => row.group === group)), GODS_EYE_LAYER_GROUPS.join(',')))
  results.push(check('street_group_present', GODS_EYE_LAYER_GROUPS.includes('STREET') && GODS_EYE_COVERAGE_MATRIX.some(row => row.group === 'STREET'), 'STREET'))
  const houseNumbers = byId.get('house_numbers')
  results.push(check('house_numbers_sourced_only', Boolean(houseNumbers && houseNumbers.streetLevel && houseNumbers.honesty.includes('addr:housenumber')), houseNumbers?.honesty ?? 'missing'))
  const streetImagery = byId.get('street_imagery')
  results.push(check('street_imagery_auth_or_own', streetImagery?.livePhase === 'AUTH_REQUIRED', streetImagery?.livePhase ?? 'missing'))
  results.push(check('panoramax_row_is_local_not_global', byId.get('panoramax')?.coverageScope === 'NO_COVERAGE' && Boolean(byId.get('panoramax')?.honesty.toLowerCase().includes('never claimed as global')), byId.get('panoramax')?.honesty ?? 'missing'))
  results.push(check('volcanoes_reuse_eonet_catalog', byId.get('volcanoes')?.catalogLayerIds.includes('nasa_eonet_volcanoes') === true, 'same catalog'))
  results.push(check('rail_is_no_coverage', byId.get('rail')?.coverageScope === 'NO_COVERAGE', byId.get('rail')?.coverageScope ?? 'missing'))
  results.push(check('lanes_are_sourced_only', Boolean(byId.get('lanes')?.honesty.includes('never invents')), byId.get('lanes')?.honesty ?? 'missing'))

  const buildings = byId.get('buildings')
  results.push(check('buildings_global_partial_detail', Boolean(buildings && buildings.coverageScope === 'GLOBAL' && buildings.coverageDetail.includes('PARTIAL')), buildings?.coverageDetail ?? 'missing'))

  const terrain = byId.get('terrain')
  results.push(check('terrain_global', terrain?.coverageScope === 'GLOBAL', terrain?.coverageScope ?? 'missing'))

  const signals = byId.get('traffic_signals')
  results.push(check('signal_infrastructure_dataset_dependent', Boolean(signals && signals.coverageScope === 'GLOBAL' && signals.coverageDetail.includes('DATASET DEPENDENT')), signals?.coverageDetail ?? 'missing'))
  results.push(check('live_signal_phase_is_no_coverage', signals?.livePhase === 'NO_COVERAGE' && liveSignalPhaseFromInfrastructure() === 'NO_COVERAGE', signals?.livePhase ?? 'missing'))
  results.push(check('live_phase_not_fabricated_from_geometry', !isFabricatedSignalPhase(signals?.livePhase ?? null) && !isFabricatedSignalPhase('NO_COVERAGE'), 'no RYG'))
  results.push(check('red_from_geometry_is_fabricated', isFabricatedSignalPhase('RED') && isFabricatedSignalPhase('green'), 'detects RYG'))

  const cameras = byId.get('traffic_cameras')
  results.push(check('cameras_regional_agency_dependent', Boolean(cameras && cameras.coverageScope === 'REGIONAL' && cameras.coverageDetail.includes('AGENCY_DEPENDENT')), cameras?.coverageDetail ?? 'missing'))
  results.push(check('cameras_are_street_level', cameras?.streetLevel === true, String(cameras?.streetLevel)))

  const liveTraffic = byId.get('road_traffic')
  results.push(check('live_traffic_not_claimed_global', liveTraffic?.coverageScope === 'REGIONAL', liveTraffic?.coverageScope ?? 'missing'))

  const transitLive = byId.get('public_transit_live')
  results.push(check('live_transit_honest_no_coverage', transitLive?.coverageScope === 'NO_COVERAGE' && transitLive?.dataMode === 'UNAVAILABLE', transitLive?.coverageScope ?? 'missing'))

  const maritime = byId.get('maritime')
  results.push(check('maritime_not_global_ais', maritime?.coverageScope === 'REGIONAL', maritime?.coverageScope ?? 'missing'))

  const missingCatalog: string[] = []
  for (const row of GODS_EYE_COVERAGE_MATRIX) {
    for (const layerId of row.catalogLayerIds) {
      if (layerId === 'nearby_landmarks') continue
      if (!catalogIds.has(layerId)) missingCatalog.push(`${row.id}:${layerId}`)
    }
  }
  results.push(check('catalog_layer_ids_exist', missingCatalog.length === 0, missingCatalog.join(',') || 'ok'))

  const matrixIds = GODS_EYE_COVERAGE_MATRIX.map(row => row.id)
  results.push(check('coverage_matrix_row_ids_unique', matrixIds.length === new Set(matrixIds).size, matrixIds.join(',')))

  const required = ['terrain', 'imagery', 'buildings', 'roads', 'traffic_signals', 'traffic_cameras', 'road_traffic', 'aviation', 'maritime', 'live_intel', 'world_time']
  results.push(check('required_classes_present', required.every(id => byId.has(id)), required.filter(id => !byId.has(id)).join(',')))

  results.push(check(
    'does_not_imply_every_class_globally_live',
    GODS_EYE_COVERAGE_MATRIX.some(row => row.coverageScope !== 'GLOBAL' || row.dataMode !== 'LIVE'),
    'mixed coverage',
  ))

  return results
}

export function runGodsEyeCoverageMatrixValidation(): CaseResult[] {
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runGodsEyeCoverageMatrixValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Gods Eye coverage matrix validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

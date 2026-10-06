/**
 *   node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types lib/terra/adminIdentity/adminIdentity.validation.ts
 */
import { buildAdminIdentityPresentation, DEFAULT_ADMIN_SUBMODES, adminIdentityDecisionForGovernor } from './presentation'
import { resolveAdminHierarchy, hierarchyLines, iso3166_2ForState } from './hierarchy'
import { lookupFlagAsset, listedStateIsoCodes } from './flagCatalog'
import { selectCountryFeatures, selectStateFeatures, findActiveFeature } from './lod'
import { countryLabels, declutterLabels } from './labels'
import { parseAdminIdentityPrefs, cycleAdminSubMode } from './prefs'
import { isDisputedFeature } from './disputed'
import { ADMIN_IDENTITY_SOURCES } from './sources'
import type { AdminCompactFeature, AdminIdentityInput } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function input(overrides: Partial<AdminIdentityInput> = {}): AdminIdentityInput {
  return {
    viewBand: 'GLOBAL',
    heightMeters: 4_000_000,
    activeLocation: {
      country: 'United States',
      countryCode: 'US',
      state: 'Texas',
      county: 'Edwards County',
      city: null,
      place: 'Edwards County',
      label: 'Edwards County, Texas, United States',
      contextType: 'SEARCH',
      latitude: 29.98,
      longitude: -100.3,
    },
    currentTask: 'PLANETARY',
    masterHidden: false,
    subModes: { ...DEFAULT_ADMIN_SUBMODES },
    flagOpacityOverride: null,
    browseMode: false,
    ...overrides,
  }
}

function run(): CaseResult[] {
  const results: CaseResult[] = []

  const edwards = resolveAdminHierarchy(input())
  results.push(check('hierarchy_edwards', edwards.country === 'United States' && edwards.state === 'Texas' && edwards.county === 'Edwards County' && edwards.stateCode === 'US-TX', JSON.stringify(edwards)))
  results.push(check('hierarchy_lines', hierarchyLines(edwards).join('>') === 'UNITED STATES>TEXAS>EDWARDS COUNTY', hierarchyLines(edwards).join('>')))
  results.push(check('iso_tx', iso3166_2ForState('US', 'Texas') === 'US-TX', String(iso3166_2ForState('US', 'Texas'))))

  const browse = resolveAdminHierarchy(input({ browseMode: true }))
  results.push(check('browse_does_not_use_active', browse.source === 'browse_camera' && browse.country === null, browse.source))

  const viewport = resolveAdminHierarchy(input({
    activeLocation: { ...input().activeLocation!, contextType: 'VIEWPORT' },
  }))
  results.push(check('viewport_not_active', viewport.source === 'browse_camera', viewport.source))

  const space = buildAdminIdentityPresentation(input({ viewBand: 'SPACE', heightMeters: 12_000_000 }))
  results.push(check('space_major_only', space.countryLod === 'major' && space.stateLod === 'none' && space.countryFlagOpacity <= 0.05, `${space.countryLod}/${space.countryFlagOpacity}`))
  results.push(check('space_no_state_flag', space.stateFlagOpacity === 0, String(space.stateFlagOpacity)))

  const global = buildAdminIdentityPresentation(input({ viewBand: 'GLOBAL' }))
  results.push(check('global_country_flag_subtle', global.countryFlagOpacity >= 0.08 && global.countryFlagOpacity <= 0.15, String(global.countryFlagOpacity)))
  results.push(check('global_flag_us', global.flagTarget?.isoCode === 'US' && global.flagTarget.kind === 'country', JSON.stringify(global.flagTarget)))
  results.push(check('global_no_state_borders', global.stateBorderOpacity === 0, String(global.stateBorderOpacity)))
  results.push(check('global_earth_annotation', global.countryBorderOpacity > 0 && global.countryBorderOpacity < 0.7, String(global.countryBorderOpacity)))

  const continental = buildAdminIdentityPresentation(input({ viewBand: 'CONTINENTAL', heightMeters: 1_200_000 }))
  results.push(check('continental_states_begin', continental.stateLod === 'begin' && continental.stateBorderOpacity > 0 && continental.stateBorderOpacity < continental.countryBorderOpacity, `${continental.stateLod}/${continental.stateBorderOpacity}`))
  results.push(check('continental_flag_fading', continental.countryFlagOpacity < global.countryFlagOpacity && continental.countryFlagOpacity >= 0.05, String(continental.countryFlagOpacity)))

  const regional = buildAdminIdentityPresentation(input({ viewBand: 'REGIONAL', heightMeters: 280_000 }))
  results.push(check('regional_state_primary', regional.stateBorderOpacity > regional.countryBorderOpacity && regional.stateLabelOpacity > regional.countryLabelOpacity, `${regional.stateBorderOpacity}/${regional.countryBorderOpacity}`))
  results.push(check('regional_texas_flag', regional.flagTarget?.kind === 'state' && regional.flagTarget.isoCode === 'US-TX', JSON.stringify(regional.flagTarget)))
  results.push(check('regional_country_flag_nearly_gone', regional.countryFlagOpacity <= 0.03, String(regional.countryFlagOpacity)))
  results.push(check('regional_state_flag_subtle', regional.stateFlagOpacity >= 0.05 && regional.stateFlagOpacity <= 0.15, String(regional.stateFlagOpacity)))

  const city = buildAdminIdentityPresentation(input({ viewBand: 'CITY', heightMeters: 18_000 }))
  results.push(check('city_flags_nearly_gone', city.countryFlagOpacity === 0 && city.stateFlagOpacity <= 0.02, `${city.countryFlagOpacity}/${city.stateFlagOpacity}`))
  results.push(check('city_place_labels', city.cityLabelOpacity >= 0.7 && city.cityLabelCap > 0, `${city.cityLabelOpacity}/${city.cityLabelCap}`))

  const street = buildAdminIdentityPresentation(input({ viewBand: 'STREET', heightMeters: 800 }))
  results.push(check('street_admin_off', street.layerEffective === 'HIDDEN' && street.countryBorderOpacity === 0 && street.countryFlagOpacity === 0 && street.stateFlagOpacity === 0, street.reason))

  const off = buildAdminIdentityPresentation(input({ masterHidden: true }))
  results.push(check('master_off', off.layerEffective === 'HIDDEN' && off.flagTarget === null, off.reason))

  const noFlag = lookupFlagAsset('XX', 'country')
  results.push(check('no_invented_xx_flag', noFlag === null, String(noFlag)))
  results.push(check('texas_flag_verified', lookupFlagAsset('US-TX', 'state')?.officialStatus === 'official', lookupFlagAsset('US-TX', 'state')?.sourceUrl ?? 'missing'))
  results.push(check('ontario_flag_verified', lookupFlagAsset('CA-ON', 'state')?.isoCode === 'CA-ON', lookupFlagAsset('CA-ON', 'state')?.territoryName ?? 'missing'))
  results.push(check('unknown_province_no_flag', lookupFlagAsset('ZZ-QQ', 'state') === null, 'boundary+name only'))
  results.push(check('us_state_catalog', listedStateIsoCodes().includes('US-TX') && listedStateIsoCodes().length >= 50, String(listedStateIsoCodes().length)))

  const spain = buildAdminIdentityPresentation(input({
    viewBand: 'GLOBAL',
    activeLocation: {
      country: 'Spain',
      countryCode: 'ES',
      state: 'Community of Madrid',
      county: null,
      city: 'Madrid',
      place: 'Madrid',
      label: 'Madrid, Spain',
      contextType: 'SEARCH',
      latitude: 40.4,
      longitude: -3.7,
    },
  }))
  results.push(check('non_us_country_flag', spain.flagTarget?.isoCode === 'ES', JSON.stringify(spain.flagTarget)))
  const spainRegional = buildAdminIdentityPresentation(input({
    viewBand: 'REGIONAL',
    activeLocation: spain.hierarchy.country ? {
      country: 'Spain',
      countryCode: 'ES',
      state: 'Community of Madrid',
      county: null,
      city: 'Madrid',
      place: 'Madrid',
      label: 'Madrid, Spain',
      contextType: 'SEARCH',
      latitude: 40.4,
      longitude: -3.7,
    } : null,
  }))
  results.push(check('spain_no_invented_state_flag', spainRegional.flagTarget?.kind !== 'state' || spainRegional.flagTarget.isoCode === 'ES-CT', JSON.stringify(spainRegional.flagTarget)))

  const govStreet = adminIdentityDecisionForGovernor('STREET', 'STREET')
  results.push(check('governor_street_hidden', govStreet.effective === 'HIDDEN' && govStreet.opacity === 0, govStreet.reason))
  const govGlobal = adminIdentityDecisionForGovernor('GLOBAL', 'PLANETARY')
  results.push(check('governor_global_secondary', govGlobal.effective === 'ACTIVE' && govGlobal.priority === 'SECONDARY', govGlobal.reason))

  const features: AdminCompactFeature[] = [
    { id: 'US', name: 'United States', kind: 'country', iso2: 'US', iso3: 'USA', iso3166_2: null, adm0: 'USA', labelRank: 1, disputed: false, disputeNote: null, lon: -97, lat: 38, bbox: [-125, 24, -66, 50], rings: [[[-125, 24], [-66, 24], [-66, 50], [-125, 50], [-125, 24]]] },
    { id: 'ES', name: 'Spain', kind: 'country', iso2: 'ES', iso3: 'ESP', iso3166_2: null, adm0: 'ESP', labelRank: 2, disputed: false, disputeNote: null, lon: -4, lat: 40, bbox: [-10, 35, 4, 44], rings: [[[-10, 35], [4, 35], [4, 44], [-10, 44], [-10, 35]]] },
    { id: 'XX-CLAIM', name: 'Disputed Claim', kind: 'country', iso2: '-99', iso3: 'XXX', iso3166_2: null, adm0: 'XXX', labelRank: 6, disputed: true, disputeNote: 'Natural Earth Admin-0 claim', lon: 0, lat: 0, bbox: [0, 0, 1, 1], rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    { id: 'US-TX', name: 'Texas', kind: 'state', iso2: 'US', iso3: 'USA', iso3166_2: 'US-TX', adm0: 'USA', labelRank: 2, disputed: false, disputeNote: null, lon: -99, lat: 31, bbox: [-107, 25, -93, 37], rings: [[[-107, 25], [-93, 25], [-93, 37], [-107, 37], [-107, 25]]] },
  ]
  const spaceCountries = selectCountryFeatures(features, space, null, 'US')
  results.push(check('lod_space_major', spaceCountries.every(f => (f.labelRank ?? 9) <= 3) && !spaceCountries.some(f => f.disputed && (f.labelRank ?? 9) > 3), String(spaceCountries.length)))
  const regionalStates = selectStateFeatures(features, regional, { west: -110, south: 24, east: -90, north: 38 }, 'USA', 'US-TX')
  results.push(check('lod_texas_at_regional', regionalStates.some(f => f.iso3166_2 === 'US-TX'), regionalStates.map(f => f.id).join(',')))
  results.push(check('active_feature_us', findActiveFeature(features, 'US', -100, 30)?.id === 'US', findActiveFeature(features, 'US', -100, 30)?.id ?? 'none'))
  results.push(check('disputed_preserved', isDisputedFeature(features[2]), features[2].disputeNote ?? ''))

  const labels = countryLabels(features.filter(f => f.kind === 'country' && !f.disputed), global)
  results.push(check('labels_capped', labels.length <= global.countryLabelCap, String(labels.length)))
  const crowded = declutterLabels(
    Array.from({ length: 80 }, (_, i) => ({ id: String(i), text: `C${i}`, kind: 'country' as const, lon: i * 0.1, lat: 10, rank: 1 })),
    12,
    'country',
  )
  results.push(check('declutter_never_hundreds', crowded.length <= 12, String(crowded.length)))

  const parsed = parseAdminIdentityPrefs('{"subModes":{"identityFlag":"OFF"},"flagOpacityOverride":0.5}')
  results.push(check('prefs_parse', parsed.subModes.identityFlag === 'OFF' && parsed.flagOpacityOverride === 0.5, JSON.stringify(parsed)))
  results.push(check('cycle_mode', cycleAdminSubMode('AUTO') === 'ON' && cycleAdminSubMode('OFF') === 'AUTO', 'ok'))
  results.push(check('sources_recorded', Boolean(ADMIN_IDENTITY_SOURCES.natural_earth && ADMIN_IDENTITY_SOURCES.wikimedia_flags), Object.keys(ADMIN_IDENTITY_SOURCES).join(',')))

  const noOpaque = global.countryBorderOpacity < 1 && global.countryFlagOpacity < 0.2
  results.push(check('no_opaque_fill_model', noOpaque, `${global.countryBorderOpacity}/${global.countryFlagOpacity}`))

  return results
}

const results = run()
const failed = results.filter(row => !row.pass)
for (const row of results) {
  console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${row.name}  ${row.detail}`)
}
console.log(`${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)

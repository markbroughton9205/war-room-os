import { VIEW_BAND_TRANSITION_MS, type TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'
import { hierarchyLines, resolveAdminHierarchy } from './hierarchy'
import { lookupFlagAsset } from './flagCatalog'
import type {
  AdminIdentityInput,
  AdminIdentityPresentation,
  AdminSublayerModes,
} from './types'

export const DEFAULT_ADMIN_SUBMODES: AdminSublayerModes = {
  countryBorders: 'AUTO',
  stateBorders: 'AUTO',
  placeNames: 'AUTO',
  identityFlag: 'AUTO',
}

const COUNTRY_BORDER: Record<TerraViewBand, number> = {
  SPACE: 0.22,
  GLOBAL: 0.48,
  CONTINENTAL: 0.52,
  REGIONAL: 0.26,
  CITY: 0.08,
  STREET: 0,
}

const STATE_BORDER: Record<TerraViewBand, number> = {
  SPACE: 0,
  GLOBAL: 0,
  CONTINENTAL: 0.16,
  REGIONAL: 0.42,
  CITY: 0.14,
  STREET: 0,
}

const COUNTY_BORDER: Record<TerraViewBand, number> = {
  SPACE: 0,
  GLOBAL: 0,
  CONTINENTAL: 0,
  REGIONAL: 0.08,
  CITY: 0.22,
  STREET: 0.04,
}

const COUNTRY_LABEL: Record<TerraViewBand, number> = {
  SPACE: 0.72,
  GLOBAL: 0.92,
  CONTINENTAL: 0.88,
  REGIONAL: 0.28,
  CITY: 0,
  STREET: 0,
}

const STATE_LABEL: Record<TerraViewBand, number> = {
  SPACE: 0,
  GLOBAL: 0,
  CONTINENTAL: 0.42,
  REGIONAL: 0.92,
  CITY: 0.35,
  STREET: 0,
}

const CITY_LABEL: Record<TerraViewBand, number> = {
  SPACE: 0,
  GLOBAL: 0,
  CONTINENTAL: 0,
  REGIONAL: 0.55,
  CITY: 0.9,
  STREET: 0.2,
}

const COUNTRY_FLAG: Record<TerraViewBand, number> = {
  SPACE: 0.03,
  GLOBAL: 0.12,
  CONTINENTAL: 0.07,
  REGIONAL: 0.015,
  CITY: 0,
  STREET: 0,
}

const STATE_FLAG: Record<TerraViewBand, number> = {
  SPACE: 0,
  GLOBAL: 0,
  CONTINENTAL: 0.02,
  REGIONAL: 0.09,
  CITY: 0.015,
  STREET: 0,
}

function applySubMode(mode: AdminSublayerModes[keyof AdminSublayerModes], autoValue: number): number {
  if (mode === 'OFF') return 0
  if (mode === 'ON') return Math.max(autoValue, autoValue > 0 ? autoValue : 0.35)
  return autoValue
}

export function buildAdminIdentityPresentation(input: AdminIdentityInput): AdminIdentityPresentation {
  const band = input.viewBand
  const hierarchy = resolveAdminHierarchy(input)
  const sub = input.subModes

  if (input.masterHidden) {
    return pack(input, hierarchy, {
      layerEffective: 'HIDDEN',
      countryBorderOpacity: 0,
      stateBorderOpacity: 0,
      countyBorderOpacity: 0,
      countryLabelOpacity: 0,
      stateLabelOpacity: 0,
      cityLabelOpacity: 0,
      countryFlagOpacity: 0,
      stateFlagOpacity: 0,
      countryLod: 'none',
      stateLod: 'none',
      countyLod: 'none',
      flagTarget: null,
      reason: 'Commander OFF · administrative identity hidden',
    })
  }

  const countryBorderOpacity = applySubMode(sub.countryBorders, COUNTRY_BORDER[band])
  const stateBorderOpacity = applySubMode(sub.stateBorders, STATE_BORDER[band])
  const countyBorderOpacity = applySubMode(sub.stateBorders, COUNTY_BORDER[band])
  const countryLabelOpacity = applySubMode(sub.placeNames, COUNTRY_LABEL[band])
  const stateLabelOpacity = applySubMode(sub.placeNames, STATE_LABEL[band])
  const cityLabelOpacity = applySubMode(sub.placeNames, CITY_LABEL[band])

  let countryFlagOpacity = applySubMode(sub.identityFlag, COUNTRY_FLAG[band])
  let stateFlagOpacity = applySubMode(sub.identityFlag, STATE_FLAG[band])
  if (typeof input.flagOpacityOverride === 'number') {
    const scale = Math.min(1, Math.max(0, input.flagOpacityOverride))
    countryFlagOpacity = countryFlagOpacity > 0 ? Number((countryFlagOpacity * scale / 0.12).toFixed(3)) : 0
    stateFlagOpacity = stateFlagOpacity > 0 ? Number((stateFlagOpacity * scale / 0.09).toFixed(3)) : 0
    countryFlagOpacity = Math.min(0.18, countryFlagOpacity)
    stateFlagOpacity = Math.min(0.16, stateFlagOpacity)
  }

  const countryAsset = hierarchy.countryCode ? lookupFlagAsset(hierarchy.countryCode, 'country') : null
  const stateAsset = hierarchy.stateCode ? lookupFlagAsset(hierarchy.stateCode, 'state') : null

  let flagTarget: AdminIdentityPresentation['flagTarget'] = null
  if (stateFlagOpacity >= countryFlagOpacity && stateFlagOpacity > 0.01 && stateAsset) {
    flagTarget = { kind: 'state', isoCode: stateAsset.isoCode, name: stateAsset.territoryName }
    countryFlagOpacity = Math.min(countryFlagOpacity, 0.02)
  } else if (countryFlagOpacity > 0.01 && countryAsset) {
    flagTarget = { kind: 'country', isoCode: countryAsset.isoCode, name: countryAsset.territoryName }
    if (!stateAsset) stateFlagOpacity = 0
  } else {
    countryFlagOpacity = 0
    stateFlagOpacity = 0
  }

  const countryLod: AdminIdentityPresentation['countryLod'] =
    band === 'STREET' || countryBorderOpacity <= 0 ? 'none'
      : band === 'SPACE' ? 'major'
        : band === 'CITY' || band === 'REGIONAL' ? 'active'
          : 'all'
  const stateLod: AdminIdentityPresentation['stateLod'] =
    stateBorderOpacity <= 0 ? 'none'
      : band === 'CONTINENTAL' ? 'begin'
        : band === 'CITY' ? 'active'
          : 'primary'
  const countyLod: AdminIdentityPresentation['countyLod'] = countyBorderOpacity > 0.05 ? 'active' : 'none'

  const layerEffective =
    band === 'STREET' ? 'HIDDEN'
      : band === 'CITY' || band === 'SPACE' ? 'DIMMED'
        : 'ACTIVE'

  const lines = hierarchyLines(hierarchy)
  const reason = band === 'STREET'
    ? 'STREET · roads/buildings PRIMARY · admin decoration off'
    : band === 'CITY'
      ? 'CITY · place/county labels primary · flags nearly hidden'
      : band === 'REGIONAL'
        ? 'REGIONAL · state/province borders+names primary · country flag fading'
        : band === 'CONTINENTAL'
          ? 'CONTINENTAL · country identity clear · states begin'
          : band === 'GLOBAL'
            ? 'GLOBAL · country borders+names · active flag subtle'
            : 'SPACE · major country borders/names only'

  return pack(input, hierarchy, {
    layerEffective,
    countryBorderOpacity: Number(countryBorderOpacity.toFixed(3)),
    stateBorderOpacity: Number(stateBorderOpacity.toFixed(3)),
    countyBorderOpacity: Number(countyBorderOpacity.toFixed(3)),
    countryLabelOpacity: Number(countryLabelOpacity.toFixed(3)),
    stateLabelOpacity: Number(stateLabelOpacity.toFixed(3)),
    cityLabelOpacity: Number(cityLabelOpacity.toFixed(3)),
    countryFlagOpacity: Number(countryFlagOpacity.toFixed(3)),
    stateFlagOpacity: Number(stateFlagOpacity.toFixed(3)),
    countryLod,
    stateLod,
    countyLod,
    flagTarget,
    reason: lines.length ? `${reason} · ${lines.join(' › ')}` : `${reason} · ${input.currentTask}`,
  })
}

function pack(
  input: AdminIdentityInput,
  hierarchy: ReturnType<typeof resolveAdminHierarchy>,
  rest: Omit<AdminIdentityPresentation, 'viewBand' | 'countryBorderWidth' | 'stateBorderWidth' | 'countyBorderWidth' | 'countryLabelCap' | 'stateLabelCap' | 'cityLabelCap' | 'transitionMs' | 'hierarchy'>,
): AdminIdentityPresentation {
  const band = input.viewBand
  return {
    viewBand: band,
    ...rest,
    countryBorderWidth: band === 'SPACE' ? 1.1 : band === 'GLOBAL' || band === 'CONTINENTAL' ? 1.4 : 1.0,
    stateBorderWidth: band === 'REGIONAL' ? 1.15 : 0.85,
    countyBorderWidth: 0.7,
    countryLabelCap: band === 'SPACE' ? 14 : band === 'GLOBAL' ? 40 : band === 'CONTINENTAL' ? 28 : band === 'REGIONAL' ? 4 : 0,
    stateLabelCap: band === 'CONTINENTAL' ? 16 : band === 'REGIONAL' ? 22 : band === 'CITY' ? 3 : 0,
    cityLabelCap: band === 'REGIONAL' ? 18 : band === 'CITY' ? 22 : band === 'STREET' ? 8 : 0,
    transitionMs: VIEW_BAND_TRANSITION_MS[band],
    hierarchy,
  }
}

export function adminIdentityDecisionForGovernor(viewBand: TerraViewBand, currentTask: string): {
  effective: 'ACTIVE' | 'DIMMED' | 'HIDDEN'
  priority: 'PRIMARY' | 'SECONDARY' | 'AMBIENT' | 'SUPPRESSED'
  opacity: number
  animate: false
  fetchAllowed: boolean
  reason: string
  detailLevel: 'FULL' | 'MAJOR_ONLY' | 'GENERALIZED' | 'NONE'
  entityDensity: number
  intensityLabel: string
  saturation: number
} {
  if (viewBand === 'STREET') {
    return {
      effective: 'HIDDEN',
      priority: 'SUPPRESSED',
      opacity: 0,
      animate: false,
      fetchAllowed: false,
      reason: 'STREET · administrative identity off · roads/buildings PRIMARY',
      detailLevel: 'NONE',
      entityDensity: 0,
      intensityLabel: 'HIDDEN',
      saturation: 1,
    }
  }
  if (viewBand === 'CITY') {
    return {
      effective: 'DIMMED',
      priority: 'AMBIENT',
      opacity: 0.22,
      animate: false,
      fetchAllowed: true,
      reason: 'CITY · county/place labels only · flags hidden',
      detailLevel: 'GENERALIZED',
      entityDensity: 0.25,
      intensityLabel: 'SUBTLE',
      saturation: 1,
    }
  }
  if (viewBand === 'REGIONAL') {
    return {
      effective: 'ACTIVE',
      priority: 'SECONDARY',
      opacity: 0.55,
      animate: false,
      fetchAllowed: true,
      reason: 'REGIONAL · state/province identity PRIMARY among admin layers',
      detailLevel: 'FULL',
      entityDensity: 0.55,
      intensityLabel: 'PRIMARY',
      saturation: 1,
    }
  }
  if (viewBand === 'SPACE') {
    return {
      effective: 'DIMMED',
      priority: 'AMBIENT',
      opacity: 0.28,
      animate: false,
      fetchAllowed: true,
      reason: 'SPACE · major country borders/names only',
      detailLevel: 'MAJOR_ONLY',
      entityDensity: 0.18,
      intensityLabel: 'SUBTLE',
      saturation: 1,
    }
  }
  return {
    effective: 'ACTIVE',
    priority: viewBand === 'GLOBAL' ? 'SECONDARY' : 'SECONDARY',
    opacity: viewBand === 'GLOBAL' ? 0.5 : 0.48,
    animate: false,
    fetchAllowed: true,
    reason: `${viewBand} · country identity annotation · Earth remains dominant · ${currentTask}`,
    detailLevel: viewBand === 'GLOBAL' ? 'MAJOR_ONLY' : 'FULL',
    entityDensity: viewBand === 'GLOBAL' ? 0.35 : 0.5,
    intensityLabel: 'SUBTLE',
    saturation: 1,
  }
}

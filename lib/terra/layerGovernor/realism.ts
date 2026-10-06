/**
 * View-aware realism: Earth stays visually dominant.
 * Deterministic presentation math — not generated imagery.
 *
 * Purple continent wash root cause (traced, not assumed):
 * NASA/NOAA GOES ABI GeoColor night-side IR composite is a magenta/purple RGB.
 * Overlaying it at high alpha over base Earth recolors continents. OVATION aurora
 * was additionally painted as large teal (#5EEAD4) rectangles (min 12, up to 420
 * 1° cells), which mixed with GeoColor night + ocean blue into a purple-blue wash.
 */
import type { GovernedLayerId, LayerDecision, LayerPriority } from './types'
import {
  isLocalBand,
  isOrbitBand,
  isWideBand,
  type TerraViewBand,
} from './viewBands'

export const GEOCOLOR_NIGHT_PURPLE_NOTE =
  'GOES ABI GeoColor night-side IR is a CIRA magenta/purple composite. Presentation desaturates and lowers alpha so photographic Earth remains dominant. Not a cloud-mask product.'

export const AURORA_PRESENTATION_COLOR = '#86EFAC'
export const AURORA_PRESENTATION_MIN = 28
export const AURORA_OVAL_ABS_LAT = 48
export const AURORA_GLOBE_CAP = 72
export const AURORA_CLOSE_CAP = 120

export const LIGHTNING_SPACE_CAP = 8
export const LIGHTNING_CONTINENTAL_CAP = 14
export const QUAKE_MAJOR_MIN_MAG = 5

export const REALISM_OVERLAY_BUDGET = 0.92
export const ATTENTION_PRIMARY_MAX = 1
export const ATTENTION_SECONDARY_MAX = 3

export function geoColorSaturation(band: TerraViewBand): number {
  if (band === 'SPACE') return 0.28
  if (band === 'GLOBAL') return 0.34
  if (band === 'CONTINENTAL') return 0.48
  if (band === 'REGIONAL') return 0.62
  if (band === 'CITY') return 0.55
  return 0.4
}

export function geoColorAlphaThreshold(band: TerraViewBand): number {
  if (isOrbitBand(band)) return 0.3
  if (band === 'CONTINENTAL') return 0.24
  return 0.18
}

export function cloudOpacityForBand(band: TerraViewBand): number {
  if (band === 'SPACE') return 0.46
  if (band === 'GLOBAL') return 0.42
  if (band === 'CONTINENTAL') return 0.4
  if (band === 'REGIONAL') return 0.36
  if (band === 'CITY') return 0.22
  return 0.12
}

export function radarOpacityForBand(band: TerraViewBand, inspect: boolean): number {
  if (isOrbitBand(band)) return inspect ? 0.18 : 0
  if (band === 'CONTINENTAL') return inspect ? 0.38 : 0.22
  if (band === 'REGIONAL') return 0.42
  if (band === 'CITY') return 0.28
  return 0.12
}

export function auroraOpacityForBand(band: TerraViewBand, auroraMax: number, inspect: boolean): number {
  if (auroraMax < 18) return 0
  const intensity = auroraMax < 35 ? 0.14 : Math.min(0.32, 0.16 + (auroraMax - 35) / 280)
  if (inspect) return Math.min(0.4, intensity + 0.08)
  if (band === 'SPACE' || band === 'GLOBAL') return intensity
  if (band === 'CONTINENTAL') return intensity * 0.85
  if (band === 'REGIONAL') return intensity * 0.55
  if (band === 'CITY') return inspect ? 0.08 : 0
  return 0
}

export function nightLightsOpacityForBand(band: TerraViewBand, solar: string | null): number {
  if (solar === 'DAY') return 0
  if (solar === 'CIVIL_TWILIGHT' || solar === 'NAUTICAL_TWILIGHT') {
    return isLocalBand(band) ? 0.18 : 0.32
  }
  if (solar !== 'NIGHT') return 0
  if (band === 'SPACE' || band === 'GLOBAL') return 0.48
  if (band === 'CONTINENTAL') return 0.4
  if (band === 'REGIONAL') return 0.28
  if (band === 'CITY') return 0.16
  return 0
}

export function nightLightsSaturation(band: TerraViewBand): number {
  if (isOrbitBand(band)) return 0.42
  if (band === 'CONTINENTAL') return 0.5
  return 0.55
}

export function lightningDensity(band: TerraViewBand): number {
  if (band === 'SPACE') return 0.12
  if (band === 'GLOBAL') return 0.18
  if (band === 'CONTINENTAL') return 0.32
  if (band === 'REGIONAL') return 0.55
  if (band === 'CITY') return 0.7
  return 0.45
}

export function lightningCap(band: TerraViewBand): number {
  if (band === 'SPACE') return LIGHTNING_SPACE_CAP
  if (band === 'GLOBAL') return 12
  if (band === 'CONTINENTAL') return LIGHTNING_CONTINENTAL_CAP
  if (band === 'REGIONAL') return 28
  if (band === 'CITY') return 40
  return 24
}

export function earthquakeDensity(band: TerraViewBand, inspect: boolean): number {
  if (inspect) return 1
  if (band === 'SPACE') return 0.12
  if (band === 'GLOBAL') return 0.18
  if (band === 'CONTINENTAL') return 0.4
  if (band === 'REGIONAL') return 0.7
  return 1
}

export function intensityLabelFor(decision: Pick<LayerDecision, 'effective' | 'priority' | 'detailLevel'>): string {
  if (decision.effective === 'HIDDEN' || decision.effective === 'UNLOADED') {
    return decision.effective === 'UNLOADED' ? 'UNLOADED' : 'HIDDEN'
  }
  if (decision.detailLevel === 'AGGREGATED') return 'AGGREGATED'
  if (decision.detailLevel === 'MAJOR_ONLY') return 'MAJOR ONLY'
  if (decision.detailLevel === 'GENERALIZED') return 'GENERALIZED'
  if (decision.effective === 'DIMMED' || decision.priority === 'AMBIENT') return 'SUBTLE'
  if (decision.priority === 'CRITICAL' || decision.priority === 'PRIMARY') return 'PRIMARY'
  return decision.effective
}

const OVERLAY_IDS: GovernedLayerId[] = [
  'clouds',
  'radar',
  'aurora',
  'night_lights',
  'lightning',
  'earthquakes',
  'fires',
  'weather_hazards',
  'live_intel',
  'traffic',
]

function visible(layer: LayerDecision): boolean {
  return layer.effective === 'ACTIVE' || layer.effective === 'DIMMED' || layer.effective === 'PAUSED'
}

function overlayWeight(id: GovernedLayerId, layer: LayerDecision): number {
  if (!visible(layer) || layer.opacity <= 0) return 0
  const raster = id === 'clouds' || id === 'radar' || id === 'aurora' || id === 'night_lights'
  return raster ? layer.opacity : layer.opacity * 0.22 * (layer.entityDensity ?? 1)
}

export function applyRealismGuard(layers: Record<GovernedLayerId, LayerDecision>): { layers: Record<GovernedLayerId, LayerDecision>; earthDominant: boolean } {
  const next = { ...layers }
  let weight = OVERLAY_IDS.reduce((sum, id) => sum + overlayWeight(id, next[id]), 0)
  if (weight <= REALISM_OVERLAY_BUDGET) return { layers: next, earthDominant: true }
  const demoteOrder: Array<{ id: GovernedLayerId; minPriority: LayerPriority }> = OVERLAY_IDS
    .filter(id => visible(next[id]) && next[id].mode === 'AUTO' && (next[id].priority === 'AMBIENT' || next[id].priority === 'SECONDARY'))
    .sort((a, b) => {
      const rank = (p: LayerPriority) => p === 'AMBIENT' ? 0 : p === 'SECONDARY' ? 1 : p === 'PRIMARY' ? 2 : 3
      return rank(next[a].priority) - rank(next[b].priority)
    })
    .map(id => ({ id, minPriority: next[id].priority }))
  for (const { id } of demoteOrder) {
    if (weight <= REALISM_OVERLAY_BUDGET) break
    const layer = next[id]
    const reduced = Number(Math.max(0.06, layer.opacity * 0.62).toFixed(3))
    next[id] = {
      ...layer,
      opacity: reduced,
      effective: layer.priority === 'PRIMARY' ? layer.effective : 'DIMMED',
      priority: layer.priority === 'PRIMARY' ? 'SECONDARY' : 'AMBIENT',
      intensityLabel: 'SUBTLE',
      reason: `${layer.reason} · realism guard · Earth remains dominant`,
    }
    weight = OVERLAY_IDS.reduce((sum, key) => sum + overlayWeight(key, next[key]), 0)
  }
  return { layers: next, earthDominant: weight <= REALISM_OVERLAY_BUDGET + 0.08 }
}

export function applyAttentionBudget(layers: Record<GovernedLayerId, LayerDecision>): Record<GovernedLayerId, LayerDecision> {
  const next = { ...layers }
  const dataPrimary = OVERLAY_IDS.filter(id => visible(next[id]) && next[id].priority === 'PRIMARY')
  if (dataPrimary.length > ATTENTION_PRIMARY_MAX) {
    const extras = dataPrimary.filter(id => next[id].mode === 'AUTO').slice(ATTENTION_PRIMARY_MAX)
    for (const id of extras) {
      next[id] = {
        ...next[id],
        priority: 'SECONDARY',
        opacity: Number(Math.min(next[id].opacity, 0.36).toFixed(3)),
        intensityLabel: 'SUBTLE',
        reason: `${next[id].reason} · attention budget`,
      }
    }
  }
  const secondary = OVERLAY_IDS.filter(id => visible(next[id]) && next[id].priority === 'SECONDARY')
  if (secondary.length > ATTENTION_SECONDARY_MAX) {
    for (const id of secondary.slice(ATTENTION_SECONDARY_MAX)) {
      if (next[id].mode !== 'AUTO') continue
      next[id] = {
        ...next[id],
        priority: 'AMBIENT',
        opacity: Number(Math.min(next[id].opacity, 0.22).toFixed(3)),
        effective: next[id].effective === 'ACTIVE' ? 'DIMMED' : next[id].effective,
        intensityLabel: 'SUBTLE',
        reason: `${next[id].reason} · attention budget ambient`,
      }
    }
  }
  return next
}

export function inspectLayerId(selectionLayerId: string | null): GovernedLayerId | null {
  if (!selectionLayerId) return null
  if (selectionLayerId.includes('aurora')) return 'aurora'
  if (selectionLayerId.includes('earthquake')) return 'earthquakes'
  if (selectionLayerId.includes('nws') || selectionLayerId.includes('weather') || selectionLayerId.includes('radar')) return 'radar'
  if (selectionLayerId.includes('lightning') || selectionLayerId.includes('glm')) return 'lightning'
  if (selectionLayerId.includes('cloud')) return 'clouds'
  if (selectionLayerId.includes('camera')) return 'nearby_cameras'
  if (selectionLayerId.includes('intel')) return 'live_intel'
  if (selectionLayerId === 'opensky' || selectionLayerId.includes('aircraft')) return 'aircraft'
  if (selectionLayerId === 'digitraffic_marine' || selectionLayerId.includes('vessel') || selectionLayerId.includes('marine')) return 'vessels'
  if (selectionLayerId.includes('admin') || selectionLayerId.includes('border') || selectionLayerId === 'admin_identity') return 'admin_identity'
  return null
}


/**
 * Second-level Layer Governor engine.
 * Runs AFTER basic AUTO rules. Never invents coverage or source frames.
 * May DIM / DECLUTTER / AGGREGATE / TEMPORARILY HIDE / PAUSE ANIMATION / reduce cadence.
 */
import { classifyProviderHealth, providerRetryAllowed } from './health'
import { freshnessEmphasis, isExpiredTruth } from './freshness'
import { heavyLayerBudget } from './pressure'
import { applyAttentionBudget, applyRealismGuard, inspectLayerId } from './realism'
import {
  GOVERNED_LAYER_IDS,
  HEAVY_LAYER_IDS,
  type GovernedLayerId,
  type GovernorSnapshot,
  type InferredContext,
  type LayerDecision,
  type LayerEffective,
  type ResourceState,
} from './types'
import { isOrbitBand, type TerraViewBand } from './viewBands'

const STREET_SCALES = new Set(['local', 'building'])

export type GovernorAcceptanceReport = {
  CONTEXT: string
  CONFIDENCE: string
  PRIMARY_LAYER: string
  SECONDARY_LAYERS: string
  SUPPRESSED_LAYERS: string
  REASON: string
  RESOURCE_STATE: string
  EVIDENCE: string[]
}

export function applyIntelligenceEngine(input: {
  layers: Record<GovernedLayerId, LayerDecision>
  snapshot: GovernorSnapshot
  inferred: InferredContext
  resource: ResourceState
  viewBand?: TerraViewBand
}): { layers: Record<GovernedLayerId, LayerDecision>; earthDominant: boolean } {
  const layers = { ...input.layers }
  applyFreshnessDecay(layers, input.snapshot)
  applyHealthBackoff(layers, input.snapshot)
  applyVisualConflicts(layers, input.inferred.context, input.snapshot)
  applySmartIdle(layers, input.snapshot, input.inferred.context)
  applyHeavyBudget(layers, heavyLayerBudget(input.resource), input.resource)
  applyGlobeAggregation(layers, input.snapshot, input.viewBand)
  applyInspectFocus(layers, input.snapshot)
  const guarded = applyRealismGuard(applyAttentionBudget(layers))
  return guarded
}

export function governorAcceptanceReport(plan: {
  inferred: InferredContext
  resource: ResourceState
  layers: Record<GovernedLayerId, LayerDecision>
  primary: GovernedLayerId[]
  secondary: GovernedLayerId[]
  suppressed: GovernedLayerId[]
}): GovernorAcceptanceReport {
  const primary = pickReportedPrimary(plan)
  return {
    CONTEXT: plan.inferred.context,
    CONFIDENCE: plan.inferred.confidence,
    PRIMARY_LAYER: primary,
    SECONDARY_LAYERS: plan.secondary.join(',') || 'none',
    SUPPRESSED_LAYERS: plan.suppressed.join(',') || 'none',
    REASON: plan.layers[primary]?.reason ?? plan.inferred.evidence.join('; '),
    RESOURCE_STATE: plan.resource,
    EVIDENCE: plan.inferred.evidence,
  }
}

function pickReportedPrimary(plan: {
  layers: Record<GovernedLayerId, LayerDecision>
  primary: GovernedLayerId[]
}): GovernedLayerId {
  const critical = GOVERNED_LAYER_IDS.find(id => plan.layers[id].priority === 'CRITICAL' && visible(plan.layers[id]))
  if (critical) return critical
  const supporting = GOVERNED_LAYER_IDS.find(id => (
    id !== 'base_imagery'
    && plan.layers[id].priority === 'PRIMARY'
    && visible(plan.layers[id])
  ))
  if (supporting) return supporting
  return plan.primary[0] ?? 'base_imagery'
}

function applyFreshnessDecay(layers: Record<GovernedLayerId, LayerDecision>, snapshot: GovernorSnapshot): void {
  const radar = layers.radar
  if (radar.mode !== 'AUTO' || !snapshot.masterAuto) return
  if (isExpiredTruth(snapshot.radarState) || snapshot.radarState === 'UNAVAILABLE FOR SELECTED TIME') {
    layers.radar = {
      ...radar,
      effective: 'HIDDEN',
      priority: 'SUPPRESSED',
      opacity: 0,
      animate: false,
      fetchAllowed: snapshot.timeMode === 'historical',
      reason: 'EXPIRED / UNAVAILABLE FOR SELECTED TIME · not shown as current',
    }
    return
  }
  const emphasis = freshnessEmphasis(snapshot.radarState)
  if (emphasis < 1 && visible(radar)) {
    layers.radar = {
      ...radar,
      opacity: Number((radar.opacity * emphasis).toFixed(3)),
      effective: emphasis <= 0.5 ? 'DIMMED' : radar.effective,
      reason: emphasis <= 0.5 ? `STALE/DEGRADED · reduced emphasis · ${radar.reason}` : radar.reason,
    }
  }
}

function applyHealthBackoff(layers: Record<GovernedLayerId, LayerDecision>, snapshot: GovernorSnapshot): void {
  if (snapshot.radarRetryAllowed === false && layers.radar.mode === 'AUTO') {
    const health = classifyProviderHealth({ state: snapshot.radarState })
    if (layers.radar.priority !== 'CRITICAL') {
      layers.radar = {
        ...layers.radar,
        fetchAllowed: false,
        animate: false,
        effective: visible(layers.radar) ? 'PAUSED' : layers.radar.effective,
        reason: `provider ${health} · retry backoff · ${layers.radar.reason}`,
      }
    }
  }
  if (snapshot.cloudRetryAllowed === false && layers.clouds.mode === 'AUTO' && layers.clouds.priority !== 'CRITICAL') {
    layers.clouds = {
      ...layers.clouds,
      fetchAllowed: false,
      animate: false,
      effective: visible(layers.clouds) ? 'PAUSED' : layers.clouds.effective,
      reason: `cloud provider backoff · ${layers.clouds.reason}`,
    }
  }
}

function applyVisualConflicts(
  layers: Record<GovernedLayerId, LayerDecision>,
  context: string,
  snapshot: GovernorSnapshot,
): void {
  if (visible(layers.radar) && visible(layers.clouds) && (layers.radar.priority === 'PRIMARY' || layers.radar.priority === 'CRITICAL')) {
    if (layers.clouds.mode === 'AUTO' && snapshot.masterAuto) {
      layers.clouds = {
        ...layers.clouds,
        effective: 'DIMMED',
        priority: 'SECONDARY',
        opacity: Math.min(layers.clouds.opacity, 0.42),
        reason: 'radar PRIMARY',
      }
    }
  }
  if ((context === 'STREET' || STREET_SCALES.has(snapshot.scale)) && visible(layers.clouds)) {
    if (layers.clouds.mode === 'AUTO' && snapshot.masterAuto) {
      layers.clouds = {
        ...layers.clouds,
        effective: 'DIMMED',
        opacity: Math.min(layers.clouds.opacity, 0.18),
        reason: 'roads/labels PRIMARY · weather translucent',
      }
    }
    if (visible(layers.radar) && layers.radar.mode === 'AUTO' && snapshot.masterAuto) {
      layers.radar = { ...layers.radar, opacity: Math.min(layers.radar.opacity, 0.14), reason: 'street · weather translucent' }
    }
  }
  if (layers.night_lights.effective === 'ACTIVE' && layers.weather_hazards.priority === 'CRITICAL' && layers.night_lights.mode === 'AUTO') {
    layers.night_lights = { ...layers.night_lights, priority: 'AMBIENT', reason: 'night lights AMBIENT · hazards remain PRIMARY/CRITICAL' }
  }
}

function applySmartIdle(
  layers: Record<GovernedLayerId, LayerDecision>,
  snapshot: GovernorSnapshot,
  context: string,
): void {
  if (!snapshot.idle || !snapshot.masterAuto) return
  const keepClouds = snapshot.orbiting && snapshot.timeMode === 'live'
  if (keepClouds && layers.clouds.mode === 'AUTO' && visible(layers.clouds)) {
    layers.clouds = {
      ...layers.clouds,
      animate: snapshot.reducedMotion ? false : layers.clouds.animate,
      reason: 'smart idle keeps cloud progression',
    }
  }
  for (const id of ['buildings', 'traffic', 'nearby_cameras'] as const) {
    if (layers[id].mode !== 'AUTO') continue
    if (layers[id].priority === 'CRITICAL') continue
    if (context === 'STREET' && STREET_SCALES.has(snapshot.scale)) continue
    if (!visible(layers[id])) continue
    layers[id] = {
      ...layers[id],
      effective: 'HIDDEN',
      fetchAllowed: false,
      animate: false,
      priority: 'AMBIENT',
      reason: `smart idle reduces local heavy layer · ${layers[id].reason}`,
    }
  }
}

function applyGlobeAggregation(
  layers: Record<GovernedLayerId, LayerDecision>,
  snapshot: GovernorSnapshot,
  viewBand?: TerraViewBand,
): void {
  if (snapshot.scale !== 'global' && !(viewBand && isOrbitBand(viewBand))) return
  if (layers.earthquakes.mode === 'AUTO') {
    layers.earthquakes = {
      ...layers.earthquakes,
      opacity: Math.min(layers.earthquakes.opacity, 0.75),
      reason: `${layers.earthquakes.reason} · globe aggregates lower-priority events`,
    }
  }
  if (layers.live_intel.mode === 'AUTO' && visible(layers.live_intel)) {
    layers.live_intel = {
      ...layers.live_intel,
      effective: 'DIMMED',
      opacity: Math.min(layers.live_intel.opacity, 0.6),
      reason: `${layers.live_intel.reason} · aggregate at globe instead of full marker intensity`,
    }
  }
}

function applyInspectFocus(layers: Record<GovernedLayerId, LayerDecision>, snapshot: GovernorSnapshot): void {
  const inspect = inspectLayerId(snapshot.selectionLayerId)
    ?? (snapshot.earthquakeSelected ? 'earthquakes' : null)
    ?? (snapshot.weatherSelected ? 'radar' : null)
  if (!inspect) return
  const focus = layers[inspect]
  if (!focus) return
  if (focus.mode === 'OFF') return
  if (focus.effective === 'UNLOADED' && !focus.fetchAllowed) return
  layers[inspect] = {
    ...focus,
    effective: focus.effective === 'HIDDEN' ? 'ACTIVE' : focus.effective,
    priority: focus.priority === 'CRITICAL' ? 'CRITICAL' : 'PRIMARY',
    opacity: Math.max(focus.opacity, 0.28),
    intensityLabel: 'PRIMARY',
    reason: `${focus.reason} · inspect focus`,
  }
  const competing: GovernedLayerId[] = ['clouds', 'radar', 'aurora', 'night_lights', 'lightning', 'earthquakes', 'fires', 'live_intel']
  for (const id of competing) {
    if (id === inspect) continue
    if (layers[id].mode !== 'AUTO') continue
    if (layers[id].priority === 'CRITICAL') continue
    if (!visible(layers[id])) continue
    layers[id] = {
      ...layers[id],
      priority: 'AMBIENT',
      effective: 'DIMMED',
      opacity: Math.min(layers[id].opacity, 0.22),
      intensityLabel: 'SUBTLE',
      reason: `${layers[id].reason} · dimmed while inspecting ${inspect}`,
    }
  }
}

function applyHeavyBudget(layers: Record<GovernedLayerId, LayerDecision>, budget: number, resource: ResourceState): void {
  const heavyActive = HEAVY_LAYER_IDS.filter(id => visible(layers[id]) && layers[id].priority !== 'CRITICAL')
  if (heavyActive.length <= budget) return
  const drop = heavyActive
    .filter(id => layers[id].priority === 'AMBIENT' || layers[id].priority === 'SECONDARY')
    .slice(budget)
  for (const id of drop) {
    if (layers[id].mode !== 'AUTO') continue
    layers[id] = {
      ...layers[id],
      effective: resource === 'PRESSURE' ? 'PAUSED' : 'DIMMED',
      animate: false,
      priority: 'AMBIENT',
      reason: `${layers[id].reason} · heavy-layer budget`,
    }
  }
}

function visible(layer: LayerDecision): boolean {
  return layer.effective === 'ACTIVE' || layer.effective === 'DIMMED' || layer.effective === 'PAUSED'
}

export function nextLayerEffectiveFromHealth(input: {
  current: LayerEffective
  retryAllowed: boolean
  priority: LayerDecision['priority']
}): LayerEffective {
  if (input.retryAllowed || input.priority === 'CRITICAL') return input.current
  if (input.current === 'ACTIVE' || input.current === 'DIMMED') return 'PAUSED'
  return input.current
}

export { providerRetryAllowed }

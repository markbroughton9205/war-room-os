import { inferGovernorContext } from './context'
import { applyIntelligenceEngine } from './intelligence'
import { planPrefetch } from './prefetch'
import { heavyLayerBudget, resolveResourceState } from './pressure'
import {
  auroraOpacityForBand,
  cloudOpacityForBand,
  earthquakeDensity,
  geoColorSaturation,
  inspectLayerId,
  intensityLabelFor,
  lightningDensity,
  nightLightsOpacityForBand,
  nightLightsSaturation,
  radarOpacityForBand,
} from './realism'
import {
  isLocalBand,
  isOrbitBand,
  isWideBand,
  viewBandFromScale,
  VIEW_BAND_TRANSITION_MS,
  type TerraViewBand,
} from './viewBands'
import {
  GOVERNED_LAYER_IDS,
  type GovernedLayerId,
  type GovernorSnapshot,
  type LayerDecision,
  type LayerEffective,
  type LayerGovernorPlan,
  type LayerMode,
} from './types'
import { adminIdentityDecisionForGovernor } from '@/lib/terra/adminIdentity/presentation'

function bandOf(input: GovernorSnapshot): TerraViewBand {
  return input.viewBand ?? viewBandFromScale(input.scale)
}

/** What a layer rule decides once resolved: no id or mode yet. */
type ResolvedDecision = Omit<LayerDecision, 'id' | 'mode'>

/** What a rule has to state (the six fields below) plus any presentation fields it wants to override; `present` fills in the rest. */
type AutoDecision = Pick<ResolvedDecision, 'effective' | 'priority' | 'opacity' | 'animate' | 'fetchAllowed' | 'reason'> & Partial<ResolvedDecision>

function present(auto: AutoDecision): ResolvedDecision {
  const filled: ResolvedDecision = {
    detailLevel: 'FULL',
    entityDensity: 1,
    saturation: 1,
    intensityLabel: 'ACTIVE',
    transitionMs: 400,
    ...auto,
  }
  return {
    ...filled,
    intensityLabel: auto.intensityLabel ?? intensityLabelFor(filled),
  }
}

export function buildLayerGovernorPlan(input: GovernorSnapshot): LayerGovernorPlan {
  const inferred = inferGovernorContext(input)
  const resource = resolveResourceState({ fps: input.fps, previous: input.previousResource })
  const heavyBudget = heavyLayerBudget(resource)
  const layers = {} as Record<GovernedLayerId, LayerDecision>

  const modeOf = (id: GovernedLayerId): LayerMode => input.layerModes[id] ?? 'AUTO'

  const decide = (
    id: GovernedLayerId,
    auto: AutoDecision,
  ): LayerDecision => applyMode(id, modeOf(id), input.masterAuto, present(auto), input)

  layers.base_imagery = decide('base_imagery', present({
    effective: 'ACTIVE',
    priority: 'PRIMARY',
    opacity: 1,
    animate: false,
    fetchAllowed: true,
    reason: 'photographic globe base remains the visual truth layer',
    intensityLabel: 'PRIMARY',
    saturation: 1,
  }))

  layers.clouds = decide('clouds', cloudDecision(input, inferred.context, resource))
  layers.radar = decide('radar', radarDecision(input, inferred.context, resource))
  layers.night_lights = decide('night_lights', nightDecision(input))
  layers.roads = decide('roads', urbanDecision(input, 'roads', inferred.context))
  layers.street_labels = decide('street_labels', urbanDecision(input, 'street_labels', inferred.context))
  layers.buildings = decide('buildings', buildingsDecision(input, resource))
  layers.terrain = decide('terrain', present({
    effective: bandOf(input) === 'SPACE' || bandOf(input) === 'GLOBAL' ? 'HIDDEN' : 'ACTIVE',
    priority: isOrbitBand(bandOf(input)) ? 'AMBIENT' : 'SECONDARY',
    opacity: 1,
    animate: false,
    fetchAllowed: !isOrbitBand(bandOf(input)),
    reason: isOrbitBand(bandOf(input)) ? 'globe uses imagery, not local terrain mesh' : 'terrain supports current altitude',
  }))
  layers.gods_eye_markers = decide('gods_eye_markers', present({
    effective: isWideBand(bandOf(input)) ? 'DIMMED' : 'ACTIVE',
    priority: inferred.context === 'EVENT_INTELLIGENCE' ? 'PRIMARY' : 'SECONDARY',
    opacity: isWideBand(bandOf(input)) ? 0.4 : 1,
    animate: false,
    fetchAllowed: true,
    entityDensity: isOrbitBand(bandOf(input)) ? 0.2 : isWideBand(bandOf(input)) ? 0.45 : 1,
    detailLevel: isWideBand(bandOf(input)) ? 'AGGREGATED' : 'FULL',
    reason: isWideBand(bandOf(input)) ? 'clustered at globe altitude' : "God's Eye markers follow current view",
  }))
  layers.nearby_cameras = decide('nearby_cameras', camerasDecision(input))
  layers.traffic = decide('traffic', trafficDecision(input, inferred.context, resource))
  layers.aircraft = decide('aircraft', liveMovementDecision(input, 'aircraft', resource))
  layers.vessels = decide('vessels', liveMovementDecision(input, 'vessels', resource))
  layers.earthquakes = decide('earthquakes', earthquakeDecision(input, inferred.context))
  layers.lightning = decide('lightning', lightningDecision(input))
  layers.aurora = decide('aurora', auroraDecision(input, resource))
  layers.fires = decide('fires', {
    effective: input.firesAvailable && input.firesTruth !== 'UNAVAILABLE' && input.firesTruth !== 'NO_COVERAGE' ? 'ACTIVE' : 'HIDDEN',
    priority: 'SECONDARY',
    opacity: freshnessOpacity(input.firesTruth),
    animate: false,
    fetchAllowed: input.firesAvailable,
    reason: input.firesAvailable ? `fires ${input.firesTruth}` : 'no real fire source available',
  })
  layers.weather_hazards = decide('weather_hazards', present({
    effective: input.weatherAlertCount > 0 || input.weatherSelected ? 'ACTIVE' : (isOrbitBand(bandOf(input)) ? 'DIMMED' : 'HIDDEN'),
    priority: input.weatherSelected || input.weatherAlertCount > 0 ? 'CRITICAL' : 'SECONDARY',
    opacity: isOrbitBand(bandOf(input)) ? 0.45 : 1,
    animate: false,
    fetchAllowed: true,
    entityDensity: isOrbitBand(bandOf(input)) ? 0.2 : bandOf(input) === 'CONTINENTAL' ? 0.45 : 1,
    detailLevel: isWideBand(bandOf(input)) ? 'MAJOR_ONLY' : 'FULL',
    reason: input.weatherSelected
      ? 'severe weather selected'
      : input.weatherAlertCount > 0
        ? `${input.weatherAlertCount} alerts`
        : 'no active weather alerts',
  }))
  layers.live_intel = decide('live_intel', present({
    effective: inferred.context === 'EVENT_INTELLIGENCE' || input.godsEyeMode === 'INTEL' ? 'ACTIVE' : (isWideBand(bandOf(input)) ? 'DIMMED' : 'HIDDEN'),
    priority: inferred.context === 'EVENT_INTELLIGENCE' ? 'PRIMARY' : 'AMBIENT',
    opacity: isWideBand(bandOf(input)) ? 0.35 : 0.85,
    animate: false,
    fetchAllowed: inferred.context === 'EVENT_INTELLIGENCE' || !input.idle,
    entityDensity: isOrbitBand(bandOf(input)) ? 0.15 : 0.5,
    detailLevel: isWideBand(bandOf(input)) ? 'AGGREGATED' : 'FULL',
    reason: inferred.context === 'EVENT_INTELLIGENCE' ? 'event intelligence context' : 'intel overlays stay secondary unless inspected',
  }))
  layers.admin_identity = decide('admin_identity', present({
    ...adminIdentityDecisionForGovernor(bandOf(input), inferred.context),
    transitionMs: VIEW_BAND_TRANSITION_MS[bandOf(input)],
  }))

  const intelligent = applyIntelligenceEngine({
    layers,
    snapshot: input,
    inferred,
    resource,
    viewBand: bandOf(input),
  })
  for (const id of GOVERNED_LAYER_IDS) layers[id] = intelligent.layers[id]

  const prefetch = planPrefetch({
    flying: input.flying,
    flightKey: input.flightKey,
    coveringAtDestination: input.coveringProviders,
    radarLikely: input.radarCoverage,
    previousKey: input.previousPrefetchKey,
  })

  const primary = GOVERNED_LAYER_IDS.filter(id => layers[id].priority === 'CRITICAL' || layers[id].priority === 'PRIMARY')
  const secondary = GOVERNED_LAYER_IDS.filter(id => layers[id].priority === 'SECONDARY')
  const suppressed = GOVERNED_LAYER_IDS.filter(id => layers[id].priority === 'SUPPRESSED' || layers[id].effective === 'UNLOADED' || layers[id].effective === 'HIDDEN')

  return {
    masterAuto: input.masterAuto,
    inferred,
    resource,
    heavyBudget,
    layers,
    prefetch,
    primary,
    secondary,
    suppressed,
    viewBand: bandOf(input),
    earthDominant: intelligent.earthDominant,
  }
}

function applyMode(
  id: GovernedLayerId,
  mode: LayerMode,
  masterAuto: boolean,
  auto: ResolvedDecision,
  input: GovernorSnapshot,
): LayerDecision {
  const packed = present(auto)
  if (mode === 'OFF') {
    return {
      id,
      mode,
      ...present({
        effective: 'HIDDEN',
        priority: 'SUPPRESSED',
        opacity: 0,
        animate: false,
        fetchAllowed: false,
        reason: 'Commander OFF',
        detailLevel: 'NONE',
        entityDensity: 0,
        intensityLabel: 'HIDDEN',
      }),
    }
  }
  if (mode === 'ON') {
    if (packed.effective === 'UNLOADED' && !packed.fetchAllowed) {
      return { id, mode, ...packed, reason: `${packed.reason} · manual ON cannot invent coverage` }
    }
    const effective: LayerEffective = packed.effective === 'UNLOADED' || packed.effective === 'HIDDEN' || packed.effective === 'PAUSED'
      ? (packed.fetchAllowed ? 'ACTIVE' : packed.effective)
      : packed.effective === 'DIMMED' ? 'ACTIVE' : packed.effective
    const opacity = packed.opacity > 0 ? packed.opacity : 0.35
    return {
      id,
      mode,
      ...packed,
      effective,
      priority: packed.priority === 'SUPPRESSED' ? 'PRIMARY' : packed.priority,
      opacity,
      reason: `${packed.reason} · Commander ON`,
    }
  }
  if (!masterAuto) {
    return {
      id,
      mode,
      ...packed,
      animate: packed.animate && !input.reducedMotion,
      reason: `${packed.reason} · master AUTO off, using last presentation defaults`,
    }
  }
  return { id, mode, ...packed, animate: packed.animate && !input.reducedMotion }
}

function cloudDecision(input: GovernorSnapshot, context: string, resource: string): AutoDecision {
  const band = bandOf(input)
  if (input.cloudFrames < 1 || input.cloudsTruth === 'UNAVAILABLE' || input.cloudsTruth === 'NO_COVERAGE') {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: `no recent GeoColor frames (${input.cloudsTruth})`, detailLevel: 'NONE', entityDensity: 0, saturation: geoColorSaturation(band) }
  }
  if (input.timeMode === 'historical' && input.cloudFrames < 1) {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'historical clouds unavailable', detailLevel: 'NONE', entityDensity: 0, saturation: geoColorSaturation(band) }
  }
  let opacity = cloudOpacityForBand(band)
  if (typeof input.learned.streetCloudOpacity === 'number' && band === 'STREET') opacity = input.learned.streetCloudOpacity
  const saturation = geoColorSaturation(band)
  const transitionMs = VIEW_BAND_TRANSITION_MS[band]
  if (band === 'STREET') {
    return { effective: opacity < 0.08 ? 'PAUSED' : 'DIMMED', priority: 'AMBIENT', opacity, animate: false, fetchAllowed: true, reason: 'AUTO DIMMED · street ground readability', saturation, transitionMs, intensityLabel: 'SUBTLE' }
  }
  if (context === 'WEATHER' && !isOrbitBand(band)) {
    return { effective: 'DIMMED', priority: 'SECONDARY', opacity: Math.min(opacity, 0.28), animate: resource !== 'PRESSURE', fetchAllowed: true, reason: 'radar PRIMARY', saturation, transitionMs, intensityLabel: 'SUBTLE' }
  }
  if (input.idle && input.orbiting) {
    return { effective: 'ACTIVE', priority: 'PRIMARY', opacity, animate: resource !== 'PRESSURE', fetchAllowed: true, reason: 'smart idle keeps cloud progression', saturation, transitionMs, intensityLabel: 'PRIMARY' }
  }
  return {
    effective: 'ACTIVE',
    priority: isOrbitBand(band) || band === 'CONTINENTAL' ? 'PRIMARY' : 'SECONDARY',
    opacity,
    animate: resource !== 'PRESSURE' && input.timeMode === 'live',
    fetchAllowed: true,
    reason: `real cloud systems · ${band.toLowerCase()} view`,
    saturation,
    transitionMs,
    intensityLabel: isOrbitBand(band) ? 'PRIMARY' : 'SUBTLE',
  }
}

function radarDecision(input: GovernorSnapshot, context: string, resource: string): AutoDecision {
  const band = bandOf(input)
  const inspect = inspectLayerId(input.selectionLayerId) === 'radar' || input.weatherSelected
  if (!input.radarCoverage) {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'outside radar coverage envelope', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (!input.radarHasFrame || input.radarState === 'UNAVAILABLE' || input.radarState === 'NO_COVERAGE') {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: `radar ${input.radarState || 'unavailable'}`, detailLevel: 'NONE', entityDensity: 0 }
  }
  const weather = context === 'WEATHER' || inspect || input.weatherAlertCount > 0
  const opacity = radarOpacityForBand(band, weather)
  if (opacity <= 0 && !inspect) {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: 'radar hidden at globe unless a storm is inspected', detailLevel: 'NONE', entityDensity: 0 }
  }
  const stale = input.radarState === 'STALE'
  return {
    effective: stale ? 'DIMMED' : 'ACTIVE',
    priority: weather && !isOrbitBand(band) ? 'PRIMARY' : 'SECONDARY',
    opacity: stale ? opacity * 0.55 : opacity,
    animate: resource !== 'PRESSURE' && input.timeMode === 'live' && !isOrbitBand(band),
    fetchAllowed: true,
    detailLevel: isOrbitBand(band) ? 'GENERALIZED' : 'FULL',
    transitionMs: VIEW_BAND_TRANSITION_MS[band],
    intensityLabel: isOrbitBand(band) ? 'GENERALIZED' : weather ? 'PRIMARY' : 'SUBTLE',
    reason: stale
      ? 'STALE frame · dimmed'
      : weather
        ? 'precipitation / storm relevance · provider LIVE · current view'
        : `radar ${input.radarState} · ${band.toLowerCase()} view`,
  }
}

function nightDecision(input: GovernorSnapshot): AutoDecision {
  const band = bandOf(input)
  if (input.lightingMode === 'DAY') {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: 'Commander DAY', saturation: nightLightsSaturation(band) }
  }
  if (input.lightingMode === 'NIGHT') {
    return { effective: 'ACTIVE', priority: 'AMBIENT', opacity: Math.min(0.55, nightLightsOpacityForBand(band, 'NIGHT') || 0.4), animate: false, fetchAllowed: true, reason: 'Commander NIGHT preview', saturation: nightLightsSaturation(band), intensityLabel: 'SUBTLE' }
  }
  const solar = input.solarState
  const opacity = nightLightsOpacityForBand(band, solar)
  if (opacity <= 0) {
    if (solar === 'DAY') return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: 'AUTO · DAY at active location', saturation: nightLightsSaturation(band), intensityLabel: 'DAYLIGHT HIDDEN' }
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: 'no solar state at active location', saturation: nightLightsSaturation(band), intensityLabel: 'HIDDEN' }
  }
  if (solar === 'CIVIL_TWILIGHT' || solar === 'NAUTICAL_TWILIGHT') {
    return { effective: 'DIMMED', priority: 'AMBIENT', opacity, animate: false, fetchAllowed: true, reason: `AUTO · ${solar}`, saturation: nightLightsSaturation(band), intensityLabel: 'SUBTLE' }
  }
  return {
    effective: band === 'STREET' ? 'DIMMED' : 'ACTIVE',
    priority: 'AMBIENT',
    opacity,
    animate: false,
    fetchAllowed: true,
    saturation: nightLightsSaturation(band),
    intensityLabel: 'SUBTLE',
    reason: band === 'STREET' ? 'AUTO · NIGHT · observed lights fade · close-zoom glow is PRESENTATION' : 'AUTO · NIGHT',
  }
}

function urbanDecision(input: GovernorSnapshot, kind: 'roads' | 'street_labels', context: string): AutoDecision {
  const band = bandOf(input)
  if (isOrbitBand(band) || band === 'CONTINENTAL') {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'HIDDEN AT GLOBAL', detailLevel: 'NONE', entityDensity: 0, intensityLabel: 'HIDDEN AT GLOBAL' }
  }
  if (band === 'REGIONAL') {
    return {
      effective: kind === 'roads' ? 'DIMMED' : 'HIDDEN',
      priority: 'SECONDARY',
      opacity: kind === 'roads' ? 0.5 : 0,
      animate: false,
      fetchAllowed: kind === 'roads',
      reason: 'regional major roads only',
      intensityLabel: kind === 'roads' ? 'SUBTLE' : 'HIDDEN',
    }
  }
  const emphasis = input.learned.roadEmphasis === false ? 0.7 : 1
  const street = band === 'STREET'
  return {
    effective: 'ACTIVE',
    priority: street || context === 'STREET' || context === 'LOCAL_EXPLORATION' ? 'PRIMARY' : 'SECONDARY',
    opacity: emphasis,
    animate: false,
    fetchAllowed: true,
    reason: street ? 'AUTO · STREET' : 'AUTO · CITY',
    intensityLabel: 'PRIMARY',
  }
}

function buildingsDecision(input: GovernorSnapshot, resource: string): AutoDecision {
  const band = bandOf(input)
  if (!isLocalBand(band)) {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'buildings unload above city', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (resource === 'PRESSURE' && input.learned.buildingsAtStreet !== true) {
    return { effective: 'PAUSED', priority: 'AMBIENT', opacity: 0, animate: false, fetchAllowed: false, reason: 'performance pressure · pause 3D buildings' }
  }
  if (input.idle && band !== 'STREET') {
    return { effective: 'HIDDEN', priority: 'AMBIENT', opacity: 0, animate: false, fetchAllowed: false, reason: 'smart idle reduces local heavy layers' }
  }
  if (band === 'STREET' && input.learned.buildingsAtStreet === false) {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'learned buildings-off at street' }
  }
  return { effective: 'ACTIVE', priority: 'SECONDARY', opacity: 1, animate: false, fetchAllowed: true, reason: 'city/street buildings', intensityLabel: 'PRIMARY' }
}

function camerasDecision(input: GovernorSnapshot): AutoDecision {
  const band = bandOf(input)
  const ohgo = input.coveringProviders.some(id => id === 'ohgo' || id === 'ohgo_cameras')
  if (isWideBand(band) && band !== 'REGIONAL') {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'cameras unload at globe', detailLevel: 'NONE', entityDensity: 0, intensityLabel: 'HIDDEN AT GLOBAL' }
  }
  if (!input.hasActiveLocation) {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'no active location', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (input.coveringProviders.length === 0) {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'active location outside provider envelope', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (input.idle && !isLocalBand(band)) {
    return { effective: 'HIDDEN', priority: 'AMBIENT', opacity: 0, animate: false, fetchAllowed: false, reason: 'smart idle hides regional camera queries' }
  }
  return {
    effective: isLocalBand(band) ? 'ACTIVE' : 'DIMMED',
    priority: isLocalBand(band) ? 'PRIMARY' : 'SECONDARY',
    opacity: 1,
    animate: false,
    fetchAllowed: true,
    entityDensity: band === 'REGIONAL' ? 0.4 : 1,
    reason: ohgo ? 'OHGO covering' : `covering ${input.coveringProviders[0]}`,
  }
}

function trafficDecision(input: GovernorSnapshot, context: string, resource: string): AutoDecision {
  const band = bandOf(input)
  if (isWideBand(band) && band !== 'REGIONAL') {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'dense traffic unload at globe', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (resource === 'PRESSURE' && context !== 'TRAFFIC') {
    return { effective: 'PAUSED', priority: 'AMBIENT', opacity: 0.4, animate: false, fetchAllowed: false, reason: 'pressure · pause dense traffic' }
  }
  const active = context === 'TRAFFIC' || isLocalBand(band) || band === 'REGIONAL'
  return {
    effective: active ? 'ACTIVE' : 'HIDDEN',
    priority: context === 'TRAFFIC' ? 'PRIMARY' : 'SECONDARY',
    opacity: 1,
    animate: false,
    fetchAllowed: active,
    entityDensity: band === 'REGIONAL' ? 0.35 : 1,
    reason: active ? 'city/traffic context' : 'traffic not relevant at this altitude',
  }
}

function liveMovementDecision(input: GovernorSnapshot, kind: 'aircraft' | 'vessels', resource: string): AutoDecision {
  const band = bandOf(input)
  const noun = kind === 'aircraft' ? 'air' : 'marine'
  if (isOrbitBand(band)) {
    return {
      effective: 'UNLOADED',
      priority: 'SUPPRESSED',
      opacity: 0,
      animate: false,
      fetchAllowed: false,
      reason: `dense ${noun} traffic aggregated off the globe · bbox required`,
      detailLevel: 'NONE',
      entityDensity: 0,
      intensityLabel: 'HIDDEN AT GLOBAL',
    }
  }
  if (resource === 'PRESSURE' && band === 'CONTINENTAL') {
    return {
      effective: 'PAUSED',
      priority: 'AMBIENT',
      opacity: 0.45,
      animate: false,
      fetchAllowed: false,
      reason: `pressure · pause dense ${noun} tracks`,
      detailLevel: 'AGGREGATED',
      entityDensity: 0.2,
      intensityLabel: 'AGGREGATED',
    }
  }
  if (band === 'CONTINENTAL') {
    return {
      effective: 'DIMMED',
      priority: 'SECONDARY',
      opacity: 0.7,
      animate: false,
      fetchAllowed: true,
      reason: `continental ${noun} traffic clustered`,
      detailLevel: 'AGGREGATED',
      entityDensity: 0.28,
      intensityLabel: 'AGGREGATED',
    }
  }
  if (band === 'REGIONAL') {
    return {
      effective: 'ACTIVE',
      priority: 'SECONDARY',
      opacity: 1,
      animate: false,
      fetchAllowed: true,
      reason: `regional ${noun} tracks`,
      detailLevel: 'GENERALIZED',
      entityDensity: 0.55,
      intensityLabel: 'GENERALIZED',
    }
  }
  return {
    effective: 'ACTIVE',
    priority: 'SECONDARY',
    opacity: 1,
    animate: false,
    fetchAllowed: true,
    reason: `local ${noun} tracks`,
    detailLevel: 'FULL',
    entityDensity: 1,
    intensityLabel: 'PRIMARY',
  }
}

function earthquakeDecision(input: GovernorSnapshot, context: string): AutoDecision {
  const band = bandOf(input)
  const inspect = inspectLayerId(input.selectionLayerId) === 'earthquakes' || input.earthquakeSelected
  if (input.earthquakeCount <= 0 && !inspect) {
    return { effective: 'HIDDEN', priority: 'AMBIENT', opacity: 0, animate: false, fetchAllowed: true, reason: 'no earthquake features in window', detailLevel: 'NONE', entityDensity: 0 }
  }
  const density = earthquakeDensity(band, inspect)
  return {
    effective: 'ACTIVE',
    priority: inspect || context === 'HAZARD' ? 'CRITICAL' : (isOrbitBand(band) ? 'AMBIENT' : 'SECONDARY'),
    opacity: isOrbitBand(band) ? 0.55 : 0.85,
    animate: !input.reducedMotion,
    fetchAllowed: true,
    entityDensity: density,
    detailLevel: isOrbitBand(band) || band === 'CONTINENTAL' ? 'MAJOR_ONLY' : 'FULL',
    intensityLabel: isOrbitBand(band) ? 'MAJOR ONLY' : 'PRIMARY',
    reason: inspect ? 'earthquake selected · pulse then static marker' : isOrbitBand(band) ? 'USGS major only at globe' : 'USGS events · one-shot pulse on new, static after',
  }
}

function lightningDecision(input: GovernorSnapshot): AutoDecision {
  const band = bandOf(input)
  if (input.timeMode !== 'live') {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'lightning is live GLM only', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (input.lightningTruth === 'NO_COVERAGE') {
    return { effective: 'UNLOADED', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: false, reason: 'outside GLM coverage', detailLevel: 'NONE', entityDensity: 0 }
  }
  if (input.lightningCount <= 0 || input.lightningTruth === 'UNAVAILABLE' || input.lightningTruth === 'STALE') {
    return { effective: 'HIDDEN', priority: 'AMBIENT', opacity: 0, animate: false, fetchAllowed: true, reason: input.lightningTruth === 'STALE' ? 'stale GLM hidden' : 'no recent lightning', detailLevel: 'NONE', entityDensity: 0 }
  }
  const density = lightningDensity(band)
  return {
    effective: isLocalBand(band) && !input.weatherSelected ? 'DIMMED' : 'ACTIVE',
    priority: 'AMBIENT',
    opacity: isOrbitBand(band) ? 0.55 : 0.8,
    animate: !input.reducedMotion,
    fetchAllowed: true,
    entityDensity: density,
    detailLevel: isWideBand(band) ? 'AGGREGATED' : 'FULL',
    intensityLabel: isWideBand(band) ? 'AGGREGATED' : 'SUBTLE',
    reason: isWideBand(band) ? `AUTO · AGGREGATED · ${input.lightningCount} GLM cells` : `AUTO · LIVE · ${input.lightningCount} flashes · brief non-strobing`,
  }
}

function auroraDecision(input: GovernorSnapshot, resource: string): AutoDecision {
  const band = bandOf(input)
  const inspect = inspectLayerId(input.selectionLayerId) === 'aurora'
  const opacity = auroraOpacityForBand(band, input.auroraMax, inspect)
  if (input.auroraTruth === 'UNAVAILABLE' || opacity <= 0) {
    return { effective: 'HIDDEN', priority: 'SUPPRESSED', opacity: 0, animate: false, fetchAllowed: true, reason: 'no significant current OVATION activity', detailLevel: 'NONE', entityDensity: 0, intensityLabel: 'HIDDEN' }
  }
  if (resource === 'PRESSURE' && !inspect) {
    return { effective: 'PAUSED', priority: 'AMBIENT', opacity: 0, animate: false, fetchAllowed: true, reason: 'pressure · pause aurora fill', entityDensity: 0 }
  }
  return {
    effective: inspect ? 'ACTIVE' : 'DIMMED',
    priority: inspect ? 'PRIMARY' : 'AMBIENT',
    opacity,
    animate: false,
    fetchAllowed: true,
    entityDensity: isOrbitBand(band) ? 0.25 : 0.45,
    detailLevel: 'GENERALIZED',
    intensityLabel: 'SUBTLE',
    transitionMs: VIEW_BAND_TRANSITION_MS[band],
    reason: inspect ? `OVATION inspected · max ${input.auroraMax}` : `OVATION max ${input.auroraMax} · intensity scaled`,
  }
}

function freshnessOpacity(truth: string): number {
  if (truth === 'LIVE') return 1
  if (truth === 'RECENT') return 0.85
  if (truth === 'STALE') return 0.4
  return 0
}

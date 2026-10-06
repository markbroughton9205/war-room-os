import type { TerraViewBand } from './viewBands'

export const GOVERNOR_CONTEXTS = [
  'PLANETARY',
  'WEATHER',
  'HAZARD',
  'LOCAL_EXPLORATION',
  'STREET',
  'TRAFFIC',
  'EVENT_INTELLIGENCE',
  'MEDIA_CONTEXT',
  'HISTORICAL',
] as const
export type GovernorContext = (typeof GOVERNOR_CONTEXTS)[number]

export const GOVERNOR_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const
export type GovernorConfidence = (typeof GOVERNOR_CONFIDENCE)[number]

export const LAYER_PRIORITIES = ['CRITICAL', 'PRIMARY', 'SECONDARY', 'AMBIENT', 'SUPPRESSED'] as const
export type LayerPriority = (typeof LAYER_PRIORITIES)[number]

export const LAYER_MODES = ['AUTO', 'ON', 'OFF'] as const
export type LayerMode = (typeof LAYER_MODES)[number]

export const LAYER_EFFECTIVES = ['ACTIVE', 'DIMMED', 'PAUSED', 'HIDDEN', 'UNLOADED'] as const
export type LayerEffective = (typeof LAYER_EFFECTIVES)[number]

export const RESOURCE_STATES = ['NORMAL', 'PRESSURE', 'RECOVERY'] as const
export type ResourceState = (typeof RESOURCE_STATES)[number]

export const DETAIL_LEVELS = ['FULL', 'GENERALIZED', 'MAJOR_ONLY', 'AGGREGATED', 'NONE'] as const
export type DetailLevel = (typeof DETAIL_LEVELS)[number]

export const PROVIDER_HEALTH = ['HEALTHY', 'DEGRADED', 'OFFLINE', 'AUTH_REQUIRED'] as const
export type ProviderHealth = (typeof PROVIDER_HEALTH)[number]

export const GOVERNED_LAYER_IDS = [
  'base_imagery',
  'clouds',
  'radar',
  'night_lights',
  'roads',
  'street_labels',
  'buildings',
  'terrain',
  'gods_eye_markers',
  'nearby_cameras',
  'traffic',
  'aircraft',
  'vessels',
  'earthquakes',
  'lightning',
  'aurora',
  'fires',
  'weather_hazards',
  'live_intel',
  'admin_identity',
] as const
export type GovernedLayerId = (typeof GOVERNED_LAYER_IDS)[number]

export const GOVERNED_LAYER_LABELS: Record<GovernedLayerId, string> = {
  base_imagery: 'Base imagery',
  clouds: 'Clouds',
  radar: 'Radar',
  night_lights: 'Night lights',
  roads: 'Roads',
  street_labels: 'Street labels',
  buildings: 'Buildings',
  terrain: 'Terrain',
  gods_eye_markers: "God's Eye markers",
  nearby_cameras: 'Traffic cameras',
  traffic: 'Traffic',
  aircraft: 'Aircraft',
  vessels: 'Vessels',
  earthquakes: 'Earthquakes',
  lightning: 'Lightning',
  aurora: 'Aurora',
  fires: 'Fires',
  weather_hazards: 'Weather hazards',
  live_intel: 'Live intel',
  admin_identity: 'Borders & identity',
}

export const HEAVY_LAYER_IDS: readonly GovernedLayerId[] = [
  'clouds',
  'radar',
  'buildings',
  'aurora',
  'traffic',
  'live_intel',
]

export const GOVERNOR_MIN_STATE_MS = 1200
export const GOVERNOR_PRESSURE_FPS = 20
export const GOVERNOR_RECOVERY_FPS = 28
export const GOVERNOR_HEAVY_BUDGET_NORMAL = 4
export const GOVERNOR_HEAVY_BUDGET_PRESSURE = 2
export const GOVERNOR_RETRY_BACKOFF_MS = 30_000
export const GOVERNOR_RETRY_FAILURES = 3

export type LayerDecision = {
  id: GovernedLayerId
  mode: LayerMode
  effective: LayerEffective
  priority: LayerPriority
  opacity: number
  animate: boolean
  fetchAllowed: boolean
  reason: string
  detailLevel: DetailLevel
  entityDensity: number
  saturation: number
  intensityLabel: string
  transitionMs: number
}

export type InferredContext = {
  context: GovernorContext
  confidence: GovernorConfidence
  evidence: string[]
}

export type PrefetchPlan = {
  key: string
  providers: string[]
  radarLikely: boolean
  roadsLikely: boolean
  weatherMetadata: boolean
  coverageMetadata: boolean
  cancelled: boolean
}

export type LearnedPrefs = {
  streetCloudOpacity?: number
  cityRadarOpacity?: number
  buildingsAtStreet?: boolean
  roadEmphasis?: boolean
}

export type GovernorSnapshot = {
  nowMs: number
  masterAuto: boolean
  layerModes: Partial<Record<GovernedLayerId, LayerMode>>
  scale: 'global' | 'regional' | 'city' | 'local' | 'building'
  viewBand?: TerraViewBand
  heightMeters?: number
  timeMode: 'live' | 'historical'
  solarState: 'DAY' | 'CIVIL_TWILIGHT' | 'NAUTICAL_TWILIGHT' | 'NIGHT' | null
  lightingMode: 'AUTO' | 'DAY' | 'NIGHT'
  orbiting: boolean
  flying: boolean
  idle: boolean
  reducedMotion: boolean
  selectionKind: string | null
  selectionLayerId: string | null
  mediaOpen: boolean
  godsEyeMode: string
  hasActiveLocation: boolean
  latitude: number | null
  longitude: number | null
  coveringProviders: string[]
  cloudsTruth: string
  cloudFrames: number
  radarState: string
  radarHasFrame: boolean
  radarCoverage: boolean
  lightningTruth: string
  lightningCount: number
  auroraTruth: string
  auroraMax: number
  earthquakeCount: number
  firesAvailable: boolean
  firesTruth: string
  weatherAlertCount: number
  weatherSelected: boolean
  earthquakeSelected: boolean
  fps: number | null
  entityCount: number | null
  previousResource?: ResourceState
  learned: LearnedPrefs
  flightKey: string | null
  previousPrefetchKey?: string | null
  radarRetryAllowed?: boolean
  cloudRetryAllowed?: boolean
}

export type LayerGovernorPlan = {
  masterAuto: boolean
  inferred: InferredContext
  resource: ResourceState
  heavyBudget: number
  layers: Record<GovernedLayerId, LayerDecision>
  prefetch: PrefetchPlan
  primary: GovernedLayerId[]
  secondary: GovernedLayerId[]
  suppressed: GovernedLayerId[]
  viewBand: TerraViewBand
  earthDominant: boolean
}

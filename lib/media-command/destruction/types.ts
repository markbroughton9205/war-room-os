/**
 * HVS destruction previs kernel — project-owned types.
 * Frostbite and Unreal Chaos are reference names only. No proprietary code.
 * Cinematic force classes only. No explosive-yield or demolition engineering.
 */
export const HVS_DESTRUCTION_SLICE = 'HVS-GFX-01_DESTRUCT_PREVIS_KERNEL'
export const HVS_DESTRUCTION_SCHEMA = 1 as const
export const HVS_PREVIS_SOLVER_ID = 'HVS_PREVIS_SOLVER' as const
export const HVS_PREVIS_SOLVER_VERSION = '1.0.0' as const
export const INTERNAL_FRACTURE_ID = 'INTERNAL_PRIMITIVE' as const
export const INTERNAL_FRACTURE_VERSION = '1.0.0' as const
export const REALTIME_PREVIS_FPS_THRESHOLD = 24

export const PROPRIETARY_REFERENCE_LOCK = {
  frostbite: 'REFERENCE_ONLY',
  unrealChaos: 'REFERENCE_ONLY',
  proprietaryCode: 'DO_NOT_IMPORT',
  proprietaryAssets: 'DO_NOT_IMPORT',
  proprietaryCacheFormats: 'DO_NOT_IMPORT',
} as const

export const HVS_DESTRUCTION_WORLD = {
  units: 'meters',
  up: '+Y',
  forward: '-Z',
  right: '+X',
  coordinateSystem: 'HVS_3D_Y_UP',
} as const

export const HVS_DESTRUCTION_ACCEPTANCE_PROJECT_ID = 'hvs-gfx01-wall-01'
export const HVS_DESTRUCTION_ACCEPTANCE_PROMPT = 'Collapse the front wall. Make the left side fall first and keep the right support standing for a moment. Add debris when it hits the ground.'
export const HVS_DESTRUCTION_REVISION_PROMPT = 'Make the right side collapse too, but one second later.'

export type Vec3 = { x: number; y: number; z: number }
export type Aabb = { min: Vec3; max: Vec3 }

export type HvsDestructionClass = 'WALL' | 'FACADE' | 'ROOM' | 'PROP' | 'VEHICLE_PANEL' | 'OTHER'
export type HvsDestructionMode = 'PHYSICS_LED' | 'GUIDED' | 'HYBRID'
export type HvsPerformanceTier = 'SMALL' | 'MEDIUM' | 'LARGE'
export type HvsOutputIntent = 'PREVIS_ONLY' | 'CACHE_FOR_FINAL'
export type HvsDestructionRegionId = 'LEFT' | 'RIGHT' | 'CENTER' | 'FRONT' | 'WINDOWS' | 'FULL'
export type HvsCinematicStrength = 'GENTLE' | 'MODERATE' | 'STRONG'
export type HvsMaterialId = 'CONCRETE' | 'BRICK' | 'GLASS' | 'WOOD' | 'METAL' | 'DRYWALL' | 'STONE' | 'GENERIC'
export type HvsFractureMethod = 'VORONOI' | 'GRID' | 'GUIDED'
export type HvsSupportClass = 'LEFT_SUPPORT' | 'RIGHT_SUPPORT' | 'INTERIOR' | 'PIER' | 'NONE'

export type HvsDestructionIntent = {
  id: string
  projectId: string | null
  sceneId: string | null
  targetAssetIds: string[]
  targetNodeIds: string[]
  description: string
  destructionClass: HvsDestructionClass
  severity: number
  mode: HvsDestructionMode
  durationSec: number
  directionHint: Vec3 | null
  impactRegion: Aabb | null
  collapseRegion: HvsDestructionRegionId | null
  protectedRegions: HvsDestructionRegionId[]
  materialOverrides: Partial<Record<HvsDestructionRegionId, HvsMaterialId>>
  performanceTier: HvsPerformanceTier
  outputIntent: HvsOutputIntent
  operationalSupport: boolean
  cinematicForceOnly: true
  createdAt: string
}

export type HvsGuidePrimitive =
  | { kind: 'BREAK_FIRST'; region: HvsDestructionRegionId; atSec: number }
  | { kind: 'HOLD_UNTIL'; region: HvsDestructionRegionId; untilSec: number }
  | { kind: 'RELEASE_AT'; region: HvsDestructionRegionId; atSec: number }
  | { kind: 'ATTRACT_FALL_DIRECTION'; vector: Vec3; strengthClass: HvsCinematicStrength }
  | { kind: 'PROTECT_REGION'; region: HvsDestructionRegionId }
  | { kind: 'IMPULSE_REGION'; region: HvsDestructionRegionId; vector: Vec3; strengthClass: HvsCinematicStrength }

export type HvsFractureSpec = {
  method: HvsFractureMethod
  seed: number
  chunkTarget: number
  hierarchyDepth: number
  region: HvsDestructionRegionId
  materialId: HvsMaterialId
  preFractureOnly: true
  runtimeFracture: false
}

export type HvsDestructionPlan = {
  id: string
  intentId: string
  version: number
  summary: string
  commanderSteps: string[]
  targetAssets: string[]
  materialAssignments: Array<{ region: HvsDestructionRegionId; materialId: HvsMaterialId }>
  fracturePlan: HvsFractureSpec
  supportPlan: {
    left: { region: 'LEFT'; anchor: 'WORLD' }
    right: { region: 'RIGHT'; anchor: 'WORLD'; holdForShot: boolean }
  }
  constraintPlan: {
    defaultStrengthClass: HvsCinematicStrength
    breakThresholdClass: HvsCinematicStrength
  }
  forcePlan: {
    gravity: number
    impulseClass: HvsCinematicStrength
    direction: Vec3
    cinematicForceOnly: true
  }
  guidePlan: { primitives: HvsGuidePrimitive[] }
  debrisPlan: {
    primary: 'PRIMARY_CHUNKS'
    secondary: 'SECONDARY_DEBRIS'
    secondaryBudget: number
  }
  secondaryFxPlan: {
    dust: boolean
    smoke: boolean
    dustClass: HvsCinematicStrength
    volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE' | 'OPEN_VDB_TINY'
  }
  audioCuePlan: { contractOnly: true; soundLibraryBound: false }
  cameraFxPlan: { shakeClass: HvsCinematicStrength; grit: boolean; haze: boolean }
  simulationConfig: {
    durationSec: number
    timeStep: number
    substeps: number
    fps: number
    seed: number
    mode: HvsDestructionMode
    gravity: number
    sleepSpeed: number
    backend: typeof HVS_PREVIS_SOLVER_ID
    backendVersion: typeof HVS_PREVIS_SOLVER_VERSION
  }
  cachePolicy: {
    embedBytesInHvsproj: false
    invalidateOn: string[]
    ignore: string[]
  }
  backendRequirements: {
    fracture: string
    physics: string
    volume: string
    previs: string
  }
  performanceTier: HvsPerformanceTier
  operationalSupport: boolean
  status: 'DRAFT' | 'APPROVED' | 'SIMULATED' | 'INVALIDATED'
  createdAt: string
}

export type HvsPlanPatchKind =
  | 'CHANGE_SEVERITY'
  | 'CHANGE_DIRECTION'
  | 'BREAK_REGION_FIRST'
  | 'PROTECT_REGION'
  | 'CHANGE_TIMING'
  | 'CHANGE_MATERIAL'
  | 'CHANGE_DEBRIS'
  | 'CHANGE_DUST'
  | 'CHANGE_CAMERA_SHAKE'

export type HvsDestructionPlanPatch = {
  id: string
  planId: string
  kind: HvsPlanPatchKind
  prompt: string
  region?: HvsDestructionRegionId
  delaySec?: number
  severity?: number
  durationSec?: number
  materialId?: HvsMaterialId
  debrisBudget?: number
  dustClass?: HvsCinematicStrength
  shakeClass?: HvsCinematicStrength
  direction?: Vec3
  removesProtect?: boolean
  approvalRequired: true
  mutated: false
  createdAt: string
}

export type StructuralNode = {
  id: string
  assetRef: string | null
  chunkRef: string | null
  transform: { position: Vec3; rotation: Vec3; size: Vec3 }
  materialId: HvsMaterialId
  mass: number
  supportClass: HvsSupportClass
  static: boolean
  bounds: Aabb
  column: number
  row: number | null
}

export type StructuralEdge = {
  id: string
  a: string
  b: string
  constraintType: 'BOND' | 'SUPPORT'
  strength: number
  breakThreshold: number
  materialId: HvsMaterialId
}

export type WorldAnchor = {
  id: string
  nodeId: string
  anchorType: 'GROUND' | 'SUPPORT'
  strength: number
  releasePolicy: 'HOLD' | 'BREAK_FIRST' | 'RELEASE_AT'
  releaseAtSec: number | null
}

export type HvsStructuralGraph = {
  id: string
  version: number
  units: 'meters'
  coordinateSystem: typeof HVS_DESTRUCTION_WORLD.coordinateSystem
  sourceGeometryHash: string
  seed: number
  nodes: StructuralNode[]
  edges: StructuralEdge[]
  anchors: WorldAnchor[]
}

export type HvsDestructionEventType =
  | 'CONSTRAINT_BREAK'
  | 'CHUNK_RELEASE'
  | 'CHUNK_IMPACT'
  | 'GROUND_IMPACT'
  | 'MAJOR_COLLAPSE'
  | 'SIM_START'
  | 'SIM_END'

export type HvsDestructionEvent = {
  id: string
  type: HvsDestructionEventType
  time: number
  position: Vec3
  materialId: HvsMaterialId | null
  nodeId: string | null
  edgeId: string | null
  impulseClass: HvsCinematicStrength | null
  velocityClass: 'SLOW' | 'MODERATE' | 'FAST' | null
}

export type HvsVolumeCue = {
  type: 'DUST' | 'SMOKE'
  time: number
  position: Vec3
  bounds: Aabb
  materialId: HvsMaterialId
  intensityClass: HvsCinematicStrength
  duration: number
}

export type HvsAudioCue = {
  time: number
  cueClass: string
  materialId: HvsMaterialId | null
  sourceEventId: string
}

export type HvsCameraFxCue = {
  time: number
  duration: number
  type: 'SHAKE' | 'GRIT' | 'HAZE'
  intensityClass: HvsCinematicStrength
  sourceEventId: string
}

export type HvsDestructionCacheManifest = {
  id: string
  planId: string
  planHash: string
  structuralGraphHash: string
  backend: string
  backendVersion: string
  fractureBackend: string
  fractureBackendVersion: string
  deviceClass: 'CPU_PREVIS'
  timeStep: number
  substeps: number
  geometryArtifacts: string[]
  transformCache: string
  transformHash: string
  volumeArtifacts: string[]
  volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE' | 'OPEN_VDB_TINY'
  eventLog: string
  audioCueSheet: string
  cameraCueSheet: string
  volumeCueSheet: string
  createdAt: string
  sourceAssetHashes: string[]
  materialHash: string
  simConfigHash: string
  simulationRuns: number
  status: 'VALID' | 'INVALID'
  invalidReason: string | null
}

export type HvsDestructionPrevisTicket = {
  id: string
  cacheManifestId: string
  projectId: string
  sceneId: string | null
  cameraRef: string
  resolution: { width: number; height: number }
  fps: number
  durationSec: number
  quality: 'PROXY'
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  artifactRef: string | null
  playbackRef: string | null
  summary: string
  resimulated: boolean
}

export type HvsAlleyBinding = {
  sceneNodeId: 'node-building'
  destructionTargetRef: string
  worldPosition: Vec3
  facadeScale: Vec3
  units: 'meters'
  coordinateBasis: '+Y up, -Z forward'
  sourceGeometryHash: string
  collapseStartSec: number
  simDurationSec: number
  fractureMethod: 'GRID'
  fractureBackend: 'INTERNAL_PRIMITIVE'
  physicsBackend: 'HVS_PREVIS_SOLVER'
  volumeExecution: 'VOLUME_EXECUTION_NOT_AVAILABLE'
  chunkCount: number
  cacheManifestId: string
  transformHash: string
  simulationRuns: number
  protectedRegion: {
    id: string
    subjectRef: string
    shape: 'CAPSULE'
    start: Vec3
    end: Vec3
    clearanceClass: 'CINEMATIC'
    engineeringSafety: false
  }
  majorCollapseSceneSec: number
  crowdReactSceneSec: number
  shakeSceneSec: number
  dustCueSceneSec: number
  playbackRef: string
  conditioningRefs: string[]
  framingStatus: 'PASS' | 'WARNING'
  heroVisibleFraction: number
  backgroundVisibleFraction: number
  heroFrameCoverage: number
  shotSizeBand: string
  realKernel: true
  timingsMs?: { fracture: number; simulation: number; cacheWrite: number; frameExport: number }
  bytes?: { geometry: number; transforms: number; events: number; conditioning: number }
}

export type HvsDestructionStore = {
  schemaVersion: typeof HVS_DESTRUCTION_SCHEMA
  sceneId: string | null
  sourceAsset: { id: string; path: string; sha256: string; byteLength: number } | null
  intent: HvsDestructionIntent | null
  plan: HvsDestructionPlan | null
  graph: HvsStructuralGraph | null
  alleyBinding: HvsAlleyBinding | null
  cache: {
    manifestId: string
    manifestPath: string
    planHash: string
    structuralGraphHash: string
    sourceGeometryHash: string
    materialHash: string
    simConfigHash: string
    backend: string
    backendVersion: string
    transformHash: string
    status: 'VALID' | 'INVALID'
    simulationRuns: number
  } | null
  look: { tint: string }
  audioCueBinding: string | null
  previsTicket: HvsDestructionPrevisTicket | null
  pendingPatch: HvsDestructionPlanPatch | null
  jobIds: string[]
}

export function emptyDestructionStore(): HvsDestructionStore {
  return {
    schemaVersion: HVS_DESTRUCTION_SCHEMA,
    sceneId: null,
    sourceAsset: null,
    intent: null,
    plan: null,
    graph: null,
    alleyBinding: null,
    cache: null,
    look: { tint: '#b7b1a6' },
    audioCueBinding: null,
    previsTicket: null,
    pendingPatch: null,
    jobIds: [],
  }
}

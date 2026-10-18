/**
 * HVS → Unreal execution contract.
 * HVS remains source of truth. Unreal is a derived high-fidelity runtime.
 * This module does not create a second character, timeline, or lighting director.
 */
import type { MediaTime } from '../time'

export const HVS_UNREAL_BRIDGE_VERSION = 'HVS-UE-01' as const
export const HVS_UNREAL_PACKAGE_VERSION = 1 as const
export const HVS_UNREAL_COMMUNICATION_MODE = 'FILE_PACKAGE' as const
export const HVS_UNREAL_MOTION_LABEL = 'PROTOTYPE_BRIDGE_FORMAT' as const

export const HVS_UNREAL_ADAPTERS = ['METAHUMAN', 'GENERIC_UE_HUMANOID'] as const
export type HvsUnrealAdapterKind = (typeof HVS_UNREAL_ADAPTERS)[number]

export const HVS_RENDER_ROUTES = {
  PREVIS: 'THREE_JS',
  FINAL_HIGH_FIDELITY: 'UNREAL',
} as const

export type HvsRenderRoute = keyof typeof HVS_RENDER_ROUTES

export const HVS_ENGINE_ROLES = {
  hvs: 'SOURCE_OF_TRUTH',
  unreal: 'HIGH_FIDELITY_PRODUCTION',
  threeJs: 'BROWSER_PREVIS',
} as const

export type HvsUnrealRational = {
  numerator: number
  denominator: number
}

export type HvsUnrealVec3 = {
  x: number
  y: number
  z: number
}

export type HvsUnrealCharacterBinding = {
  characterId: 'rael-commander' | string
  unrealProjectId: string | null
  unrealActorPath: string | null
  skeletalMeshPath: string | null
  skeletonPath: string | null
  controlRigPath: string | null
  ikRigPath: string | null
  ikRetargeterPath: string | null
  metahumanCharacterPath: string | null
  animationSequencePath: string | null
  levelSequencePath: string | null
  mapPath: string | null
  uprojectPath: string | null
  version: typeof HVS_UNREAL_BRIDGE_VERSION
  adapter: HvsUnrealAdapterKind
  /** Asset paths empty means the contract exists and the Unreal actor is not bound. */
  assetState: 'NOT_BOUND' | 'BOUND'
}

export type HvsUnrealTruthBinding = {
  bridgeVersion: typeof HVS_UNREAL_BRIDGE_VERSION
  projectId: string
  sceneId: string
  characterId: string
  takeId: string
  motionId: string
  cameraSpecIds: string[]
  sourceHash: string
  packageRef: string
  assetState: 'NOT_BOUND' | 'BOUND'
  sequencerRoundTrip: 'EXPLICIT_IMPORT_REQUIRED'
  uprojectPath: string | null
  animationSequencePath: string | null
  levelSequencePath: string | null
  mapPath: string | null
  motionImport: 'PROTOTYPE' | 'TAKE3_IMPORTED'
  sequencerState: 'MISSING' | 'READY'
  executionProject: 'MISSING' | 'READY'
}

export type HvsUnrealMappedTime = {
  hvsTicks: number
  hvsTimescale: number
  displayRate: HvsUnrealRational
  tickResolution: HvsUnrealRational
  /** Sequencer ticks as an unreduced-then-reduced rational. Never a float second. */
  sequencerTick: HvsUnrealRational
  exactIntegerTick: boolean
  frameNumber: number | null
  subTick: number | null
}

export type HvsUnrealBoneMapEntry = {
  hvsBone: string
  semanticTarget: string
  unrealBone: string
  control: null
}

export type HvsUnrealCameraPackage = {
  shotId: string
  cameraSpecId: string
  name: string
  start: MediaTime
  end: MediaTime
  startUnreal: HvsUnrealMappedTime
  endUnreal: HvsUnrealMappedTime
  lensMm: number | null
  sensorWidthMm: number | null
  sensorHeightMm: number | null
  movement: string
  sceneMovement: string
  target: unknown
  focus: {
    distance: number | null
    dofIntent: string | null
    aperture: number | null
  }
  apertureIntent: string | null
  pathId: string | null
  path: Array<{ time: MediaTime; position: HvsUnrealVec3; rotation: HvsUnrealVec3 | null }>
  cineCameraActor: 'CineCameraActor'
  cameraCutTrack: 'SEQUENCER_CAMERA_CUT'
}

export type HvsUnrealSequencerPackage = {
  derived: true
  canonicalClock: 'HVS_MEDIA_TIME'
  roundTrip: 'EXPLICIT_IMPORT_REQUIRED'
  levelSequenceName: string
  displayRate: HvsUnrealRational
  tickResolution: HvsUnrealRational
  hvsTimescale: number
  mapping: 'HVS_TICK_EQUALS_SEQUENCER_TICK_WHEN_TIMESCALE_IS_24000'
  cameraCutSections: Array<{
    shotId: string
    cameraSpecId: string
    startTick: HvsUnrealRational
    endTick: HvsUnrealRational
    startFrame: number | null
    endFrame: number | null
  }>
  characterAnimationSections: Array<{
    characterId: string
    takeId: string
    motionId: string
    startTick: HvsUnrealRational
    endTick: HvsUnrealRational
    playback: string
  }>
  shotBoundaries: Array<{ shotId: string; start: MediaTime; end: MediaTime }>
}

export type HvsUnrealScenePackage = {
  version: typeof HVS_UNREAL_PACKAGE_VERSION
  bridgeVersion: typeof HVS_UNREAL_BRIDGE_VERSION
  projectId: string
  sceneId: string
  timescale: number
  duration: MediaTime
  durationUnreal: HvsUnrealMappedTime
  ownership: {
    hvs: 'SOURCE_OF_TRUTH'
    unreal: 'HIGH_FIDELITY_EXECUTION'
    threeJs: 'BROWSER_PREVIS' | 'LOW_RESOURCE_PREVIEW' | 'DEBUG' | 'FALLBACK'
    hvsprojRemainsCanonical: true
    sequencerIsDerived: true
  }
  characters: Array<{
    characterId: string
    identityId: string
    displayName: string
    rigId: string
    performanceTakeId: string
    motionId: string
    wardrobeIntent: { setId: string | null; name: string | null; note: string | null }
    groomIntent: { groomId: string; parentBone: 'HEAD'; simulated: false }
    previsMeshId: string
    runtimeBodyId: string
    blockingTransform: { position: HvsUnrealVec3; yaw: number }
    capturedRoot: HvsUnrealVec3
    capturedRootSpace: 'CAPTURE_RELATIVE'
    worldRoot: HvsUnrealVec3
    worldRootRule: 'HVS_BLOCKING_PLUS_CAPTURED_RELATIVE_ROOT'
    animationTimeRange: { start: MediaTime; end: MediaTime }
    binding: HvsUnrealCharacterBinding
    adapter: HvsUnrealAdapterKind
  }>
  performances: Array<{
    characterId: string
    takeId: string
    motionId: string
    rigId: string
    label: typeof HVS_UNREAL_MOTION_LABEL
    productionStatus: 'PROTOTYPE'
    notFinalProductionInterchange: true
    chosen: 'JSON_TRANSFORM_REFERENCE'
    poseStore: 'HvsPerformanceMotion'
    cacheKey: string
    embeddedPoseCount: 0
    timeRange: { start: MediaTime; end: MediaTime }
    rootSpace: 'CAPTURE_RELATIVE'
    recordShape: {
      ticks: 'integer'
      timescale: number
      bone: 'HvsHumanoidBone'
      translation: HvsUnrealVec3
      space: 'CAPTURE_RELATIVE'
    }
  }>
  cameras: HvsUnrealCameraPackage[]
  lights: Array<{
    sourceLightId: string
    kind: string
    color: string
    intensity: number
    intentOwner: 'HVS'
    unrealMayExecute: Array<'LUMEN' | 'LIGHT' | 'EXPOSURE' | 'MATERIAL'>
    secondLightingDirector: false
  }>
  environment: Array<{
    environmentId: string
    assetRefs: string[]
    worldTransform: { position: HvsUnrealVec3; rotation: HvsUnrealVec3; scale: HvsUnrealVec3 }
    lightingIntent: string | null
    weather: string | null
    timeOfDay: string | null
    downloadedAssets: false
  }>
  destruction: {
    integrated: false
    futureExecution: 'UNREAL_CHAOS'
    hvsTruth: 'events, timing, targets, cache, provenance'
    rewrite: false
    references: Array<{ eventKind: string; shotId: string; start: MediaTime; cameraResponse: string }>
  }
  sequencer: HvsUnrealSequencerPackage
  skeletonMap: HvsUnrealBoneMapEntry[]
  retarget: {
    owner: 'UNREAL'
    hvsRole: 'MOTION_SOURCE'
    fakeIkInHvs: false
    controlRig: 'ANTICIPATED'
    ikRig: 'ANTICIPATED'
    ikRetargeter: 'ANTICIPATED'
    implemented: false
  }
  communication: {
    mode: typeof HVS_UNREAL_COMMUNICATION_MODE
    implemented: ['FILE_PACKAGE']
    launch: false
  }
  renderIntent: {
    routes: typeof HVS_RENDER_ROUTES
    routed: false
  }
  metadata: {
    generatedAt: string
    sourceHash: string
    binaryAssetsEmbedded: false
    metahumanInstalled: false
    unrealDownloaded: false
    faceCapture: 'NOT_STARTED'
    faceTracking: 'NOT_READY'
    handTracking: 'NOT_READY'
    trueEyeGaze: 'NOT_READY'
  }
}

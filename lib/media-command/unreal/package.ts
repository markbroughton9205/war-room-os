/**
 * Build a derived Unreal scene package from an HVS project.
 * References only. No pose arrays, no webcam bytes, no asset downloads.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { activeCinemaPlan } from '../cinema-director/persist'
import { composeBlockingAndRoot, HVS_DEFAULT_PERFORMANCE_PLAYBACK, humanoidPoseCacheKey } from '../digital-human/scene-performance'
import { HVS_HEAD_GROOM_ID, HVS_HEAD_GROOMING, HVS_STYLIZED_BODY_ID } from '../digital-human/skinned-body'
import { HVS_HUMANOID_RIG_ID, HVS_HUMANOID_RIG_V1, RAEL_CHARACTER_ID } from '../digital-human/types'
import { parseHvsProject } from '../project-format'
import type { HvsProject } from '../types'
import { projectFilePath } from '../paths'
import { mediaTime, type MediaTime } from '../time'
import { hvsUnrealSkeletonMap } from './skeleton'
import { mapHvsTimeToUnreal } from './time'
import {
  HVS_UNREAL_BRIDGE_VERSION,
  HVS_UNREAL_COMMUNICATION_MODE,
  HVS_UNREAL_MOTION_LABEL,
  HVS_UNREAL_PACKAGE_VERSION,
  HVS_RENDER_ROUTES,
  type HvsUnrealCharacterBinding,
  type HvsUnrealScenePackage,
  type HvsUnrealTruthBinding,
  type HvsUnrealVec3,
} from './types'

export const HVS_UE01_PROJECT_ID = 'hvs-mud545ez-8w3a'
export const HVS_UE01_TAKE_ID = 'take-mud7ggfd-zgdqbm'
export const HVS_UE01_MOTION_ID = 'motion-mud7ggel-h3xmyo'
export const HVS_UE01_ADAPTER = 'GENERIC_UE_HUMANOID' as const
export const HVS_UE02_UPROJECT = '/home/chosenone/HVSRuntime/HVSRuntime.uproject'
export const HVS_UE02_PROJECT_NAME = 'HVSRuntime'

const ZERO: HvsUnrealVec3 = { x: 0, y: 0, z: 0 }

function hashIdentity(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function vec(value: { x: number; y: number; z: number } | null | undefined, fallback = ZERO): HvsUnrealVec3 {
  if (!value) return fallback
  return { x: value.x, y: value.y, z: value.z }
}

export function raelUnrealBinding(): HvsUnrealCharacterBinding {
  return {
    characterId: RAEL_CHARACTER_ID,
    unrealProjectId: null,
    unrealActorPath: null,
    skeletalMeshPath: null,
    skeletonPath: null,
    controlRigPath: null,
    ikRigPath: null,
    ikRetargeterPath: null,
    metahumanCharacterPath: null,
    animationSequencePath: null,
    levelSequencePath: null,
    mapPath: null,
    uprojectPath: null,
    version: HVS_UNREAL_BRIDGE_VERSION,
    adapter: HVS_UE01_ADAPTER,
    assetState: 'NOT_BOUND',
  }
}

export function loadHvsProject(projectId: string): HvsProject | null {
  const file = projectFilePath(projectId)
  if (!existsSync(file)) return null
  return parseHvsProject(readFileSync(file, 'utf8'))
}

export function buildUnrealScenePackage(project: HvsProject, generatedAt: string): HvsUnrealScenePackage {
  const scene = project.director3d?.scenes.find(item => item.id === project.director3d?.activeSceneId) ?? project.director3d?.scenes[0]
  const plan = activeCinemaPlan(project)
  const human = project.digitalHumans?.characters.find(item => item.id === RAEL_CHARACTER_ID)
  const take = project.digitalHumans?.takes.find(item => item.id === HVS_UE01_TAKE_ID)
  const blocking = project.digitalHumans?.blockingPlans.find(item => item.characterId === RAEL_CHARACTER_ID)
  const directorPlan = project.directorOrchestration?.plans.find(item => item.id === project.directorOrchestration?.activePlanId)
    ?? project.directorOrchestration?.plans[0]
  const sceneId = scene?.id ?? plan?.sceneId ?? ''
  const timescale = scene?.timeline.timescale ?? project.timeline.timescale ?? 24000
  const duration = scene?.duration ?? plan?.duration ?? mediaTime(0, timescale)
  const characterNode = scene?.characters.find(item => item.digitalHumanId === RAEL_CHARACTER_ID || item.identityRef === RAEL_CHARACTER_ID)
    ?? scene?.objects.find(item => item.id === human?.rigBinding.sceneNodeId)
  const blockingPosition = blocking?.startTransform.position ?? characterNode?.transform?.position ?? ZERO
  const capturedRoot = ZERO
  const worldRoot = composeBlockingAndRoot(blockingPosition, capturedRoot)
  const takeDuration = take?.duration ?? mediaTime(0, timescale)
  const playback = characterNode && 'performancePlayback' in characterNode && characterNode.performancePlayback
    ? characterNode.performancePlayback
    : HVS_DEFAULT_PERFORMANCE_PLAYBACK
  const wardrobe = human?.wardrobeSets.find(item => item.id === human.activeWardrobeSetId) ?? null
  const binding = raelUnrealBinding()
  const shots = plan?.shots ?? []
  const cameras = shots.map(shot => {
    const sceneCamera = scene?.cameras.find(item => item.cameraSpecId === shot.cameraSpec.id)
    const motionPath = scene?.paths.find(item => item.id === sceneCamera?.pathId)
    const spec = shot.cameraSpec
    return {
      shotId: shot.id,
      cameraSpecId: spec.id,
      name: shot.name,
      start: shot.start,
      end: shot.end,
      startUnreal: mapHvsTimeToUnreal(shot.start),
      endUnreal: mapHvsTimeToUnreal(shot.end),
      lensMm: spec.focalLengthMm ?? sceneCamera?.focalLength ?? null,
      sensorWidthMm: spec.sensorWidthMm ?? null,
      sensorHeightMm: spec.sensorHeightMm ?? null,
      movement: spec.movement,
      sceneMovement: sceneCamera?.movement ?? shot.cameraMovement,
      target: spec.lookAtTargetId ?? shot.focus.target ?? sceneCamera?.target ?? null,
      focus: {
        distance: shot.focus.distance ?? spec.focusDistance ?? sceneCamera?.focusDistance ?? null,
        dofIntent: shot.focus.dofIntent ?? spec.depthOfField ?? null,
        aperture: shot.focus.aperture ?? spec.aperture ?? null,
      },
      apertureIntent: sceneCamera?.apertureIntent ?? null,
      pathId: sceneCamera?.pathId ?? shot.pathId,
      path: (motionPath?.points ?? []).map(point => ({
        time: point.time,
        position: vec(point.position),
        rotation: point.rotation ? vec(point.rotation) : null,
      })),
      cineCameraActor: 'CineCameraActor' as const,
      cameraCutTrack: 'SEQUENCER_CAMERA_CUT' as const,
    }
  })
  const animationEnd = mediaTime(takeDuration.ticks, takeDuration.timescale || timescale)
  const sourceHash = hashIdentity({
    bridgeVersion: HVS_UNREAL_BRIDGE_VERSION,
    projectId: project.id,
    sceneId,
    characterId: RAEL_CHARACTER_ID,
    rigId: HVS_HUMANOID_RIG_ID,
    takeId: HVS_UE01_TAKE_ID,
    motionId: take?.motionRef ?? HVS_UE01_MOTION_ID,
    cameraSpecIds: cameras.map(item => item.cameraSpecId),
    shotIds: cameras.map(item => item.shotId),
    duration,
    timescale,
    bones: hvsUnrealSkeletonMap().map(item => [item.hvsBone, item.semanticTarget, item.unrealBone]),
  })
  const levelSequenceName = `HVS_${project.id}_${sceneId}_execution`
  return {
    version: HVS_UNREAL_PACKAGE_VERSION,
    bridgeVersion: HVS_UNREAL_BRIDGE_VERSION,
    projectId: project.id,
    sceneId,
    timescale,
    duration,
    durationUnreal: mapHvsTimeToUnreal(duration),
    ownership: {
      hvs: 'SOURCE_OF_TRUTH',
      unreal: 'HIGH_FIDELITY_EXECUTION',
      threeJs: 'BROWSER_PREVIS',
      hvsprojRemainsCanonical: true,
      sequencerIsDerived: true,
    },
    characters: [{
      characterId: RAEL_CHARACTER_ID,
      identityId: RAEL_CHARACTER_ID,
      displayName: human?.displayName ?? "Ra'el",
      rigId: HVS_HUMANOID_RIG_ID,
      performanceTakeId: HVS_UE01_TAKE_ID,
      motionId: take?.motionRef ?? HVS_UE01_MOTION_ID,
      wardrobeIntent: {
        setId: wardrobe?.id ?? human?.activeWardrobeSetId ?? null,
        name: wardrobe?.name ?? null,
        note: human?.rigBinding.wardrobePreviewNote ?? null,
      },
      groomIntent: {
        groomId: HVS_HEAD_GROOM_ID,
        parentBone: HVS_HEAD_GROOMING.parentBone,
        simulated: HVS_HEAD_GROOMING.simulated,
      },
      previsMeshId: human?.representations.find(item => item.id === 'mesh-hvs-stylized-body-v1')?.id ?? 'mesh-hvs-stylized-body-v1',
      runtimeBodyId: HVS_STYLIZED_BODY_ID,
      blockingTransform: { position: vec(blockingPosition), yaw: blocking?.startTransform.yaw ?? 0 },
      capturedRoot,
      capturedRootSpace: 'CAPTURE_RELATIVE',
      worldRoot,
      worldRootRule: 'HVS_BLOCKING_PLUS_CAPTURED_RELATIVE_ROOT',
      animationTimeRange: { start: mediaTime(0, timescale), end: animationEnd },
      binding,
      adapter: HVS_UE01_ADAPTER,
    }],
    performances: [{
      characterId: RAEL_CHARACTER_ID,
      takeId: HVS_UE01_TAKE_ID,
      motionId: take?.motionRef ?? HVS_UE01_MOTION_ID,
      rigId: HVS_HUMANOID_RIG_ID,
      label: HVS_UNREAL_MOTION_LABEL,
      productionStatus: 'PROTOTYPE',
      notFinalProductionInterchange: true,
      chosen: 'JSON_TRANSFORM_REFERENCE',
      poseStore: 'HvsPerformanceMotion',
      cacheKey: humanoidPoseCacheKey(HVS_HUMANOID_RIG_ID, HVS_UE01_TAKE_ID, take?.motionRef ?? HVS_UE01_MOTION_ID, HVS_HUMANOID_RIG_V1),
      embeddedPoseCount: 0,
      timeRange: { start: mediaTime(0, timescale), end: animationEnd },
      rootSpace: 'CAPTURE_RELATIVE',
      recordShape: {
        ticks: 'integer',
        timescale,
        bone: 'HvsHumanoidBone',
        translation: ZERO,
        space: 'CAPTURE_RELATIVE',
      },
    }],
    cameras,
    lights: (scene?.lights ?? []).map(light => ({
      sourceLightId: light.id,
      kind: light.kind,
      color: light.color,
      intensity: light.intensity,
      intentOwner: 'HVS' as const,
      unrealMayExecute: ['LUMEN', 'LIGHT', 'EXPOSURE', 'MATERIAL'],
      secondLightingDirector: false,
    })),
    environment: [{
      environmentId: scene ? `env-${scene.id}` : 'env-unassigned',
      assetRefs: [],
      worldTransform: { position: ZERO, rotation: ZERO, scale: { x: 1, y: 1, z: 1 } },
      lightingIntent: directorPlan?.lightingPlan.summary ?? null,
      weather: scene?.environment.weatherIntent ?? null,
      timeOfDay: scene?.environment.timeOfDay ?? directorPlan?.lightingPlan.timeOfDay ?? null,
      downloadedAssets: false,
    }],
    destruction: {
      integrated: false,
      futureExecution: 'UNREAL_CHAOS',
      hvsTruth: 'events, timing, targets, cache, provenance',
      rewrite: false,
      references: (plan?.destructionCues ?? []).map(cue => ({
        eventKind: cue.eventKind,
        shotId: cue.shotId,
        start: cue.start,
        cameraResponse: cue.cameraResponse,
      })),
    },
    sequencer: {
      derived: true,
      canonicalClock: 'HVS_MEDIA_TIME',
      roundTrip: 'EXPLICIT_IMPORT_REQUIRED',
      levelSequenceName,
      displayRate: { numerator: 24, denominator: 1 },
      tickResolution: { numerator: 24000, denominator: 1 },
      hvsTimescale: timescale,
      mapping: 'HVS_TICK_EQUALS_SEQUENCER_TICK_WHEN_TIMESCALE_IS_24000',
      cameraCutSections: cameras.map(camera => ({
        shotId: camera.shotId,
        cameraSpecId: camera.cameraSpecId,
        startTick: camera.startUnreal.sequencerTick,
        endTick: camera.endUnreal.sequencerTick,
        startFrame: camera.startUnreal.frameNumber,
        endFrame: camera.endUnreal.frameNumber,
      })),
      characterAnimationSections: [{
        characterId: RAEL_CHARACTER_ID,
        takeId: HVS_UE01_TAKE_ID,
        motionId: take?.motionRef ?? HVS_UE01_MOTION_ID,
        startTick: mapHvsTimeToUnreal(mediaTime(0, timescale)).sequencerTick,
        endTick: mapHvsTimeToUnreal(animationEnd).sequencerTick,
        playback,
      }],
      shotBoundaries: cameras.map(camera => ({ shotId: camera.shotId, start: camera.start, end: camera.end })),
    },
    skeletonMap: hvsUnrealSkeletonMap(),
    retarget: {
      owner: 'UNREAL',
      hvsRole: 'MOTION_SOURCE',
      fakeIkInHvs: false,
      controlRig: 'ANTICIPATED',
      ikRig: 'ANTICIPATED',
      ikRetargeter: 'ANTICIPATED',
      implemented: false,
    },
    communication: {
      mode: HVS_UNREAL_COMMUNICATION_MODE,
      implemented: ['FILE_PACKAGE'],
      launch: false,
    },
    renderIntent: {
      routes: HVS_RENDER_ROUTES,
      routed: false,
    },
    metadata: {
      generatedAt,
      sourceHash,
      binaryAssetsEmbedded: false,
      metahumanInstalled: false,
      unrealDownloaded: false,
      faceCapture: 'NOT_STARTED',
      faceTracking: 'NOT_READY',
      handTracking: 'NOT_READY',
      trueEyeGaze: 'NOT_READY',
    },
  }
}

export function unrealTruthBinding(pkg: HvsUnrealScenePackage, packageRef: string): HvsUnrealTruthBinding {
  const character = pkg.characters[0]
  return {
    bridgeVersion: HVS_UNREAL_BRIDGE_VERSION,
    projectId: pkg.projectId,
    sceneId: pkg.sceneId,
    characterId: character?.characterId ?? RAEL_CHARACTER_ID,
    takeId: character?.performanceTakeId ?? HVS_UE01_TAKE_ID,
    motionId: character?.motionId ?? HVS_UE01_MOTION_ID,
    cameraSpecIds: pkg.cameras.map(camera => camera.cameraSpecId),
    sourceHash: pkg.metadata.sourceHash,
    packageRef,
    assetState: character?.binding.assetState ?? 'NOT_BOUND',
    sequencerRoundTrip: 'EXPLICIT_IMPORT_REQUIRED',
    uprojectPath: character?.binding.uprojectPath ?? null,
    animationSequencePath: character?.binding.animationSequencePath ?? null,
    levelSequencePath: character?.binding.levelSequencePath ?? null,
    mapPath: character?.binding.mapPath ?? null,
    motionImport: character?.binding.animationSequencePath ? 'TAKE3_IMPORTED' : 'PROTOTYPE',
    sequencerState: character?.binding.levelSequencePath ? 'READY' : 'MISSING',
    executionProject: character?.binding.uprojectPath ? 'READY' : 'MISSING',
  }
}

export function packageEmbedsBinary(pkg: HvsUnrealScenePackage): boolean {
  const raw = JSON.stringify(pkg)
  return /landmarkFrames|bodyFrames|mjpg|data:image|base64|skinWeight/i.test(raw) || raw.length > 200_000
}

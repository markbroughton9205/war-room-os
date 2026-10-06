import { HVS_SCENE_TIMESCALE, sceneTime } from '../director/clock'
import { fromSeconds } from '../time'
import {
  dhId,
  emptyAppearance,
  emptyBody,
  emptyContinuity,
  emptyPerformanceProfile,
  emptyRig,
  type HvsActingIntent,
  type HvsBackgroundPopulation,
  type HvsBlockingPlan,
  type HvsBodyPose,
  type HvsCastRole,
  type HvsCharacterCreationIntent,
  type HvsCrowdVariation,
  type HvsDigitalHuman,
  type HvsDigitalHumanStore,
  type HvsGazePlan,
  type HvsGestureIntent,
  type HvsHeadMotionIntent,
  type HvsPerformancePatch,
  type HvsPerformanceReference,
} from './types'

const HIGH_VARIATION: HvsCrowdVariation = {
  height: 'HIGH',
  bodySilhouette: 'HIGH',
  wardrobe: 'HIGH',
  hair: 'MEDIUM',
  walkingSpeed: 'MEDIUM',
  idleAction: 'MEDIUM',
  direction: 'MEDIUM',
  grouping: 'MEDIUM',
}

export function addActingIntent(store: HvsDigitalHumanStore, intent: Omit<HvsActingIntent, 'id'> & { id?: string }): HvsActingIntent {
  const row: HvsActingIntent = { ...intent, id: intent.id ?? dhId('act') }
  store.actingIntents.push(row)
  return row
}

export function compileLookDoorway(store: HvsDigitalHumanStore, characterId: string, shotId: string | null, startSec: number, endSec: number): {
  acting: HvsActingIntent
  gaze: HvsGazePlan
  head: HvsHeadMotionIntent
  pose: HvsBodyPose
} {
  const acting = addActingIntent(store, {
    characterId,
    shotId,
    beatId: null,
    objective: 'Hide nervousness',
    emotion: 'NERVOUS',
    intensity: 0.45,
    bodyAction: 'Stand still but shift weight',
    gestureIntent: null,
    headIntent: 'Small turn toward the doorway',
    gazeIntent: 'Glance toward doorway',
    facialIntent: 'Keep the face quieter than the body',
    speechIntent: null,
    start: sceneTime(startSec),
    end: sceneTime(endSec),
  })
  const gaze: HvsGazePlan = {
    id: dhId('gaze'),
    characterId,
    shotId,
    actingIntentId: acting.id,
    targetKind: 'PROP',
    targetId: 'doorway',
    targetLabel: 'doorway',
    behavior: 'GLANCE_AT',
    start: sceneTime(startSec),
    duration: fromSeconds(0.6),
    easing: 'EASE_IN_OUT',
  }
  const head: HvsHeadMotionIntent = {
    id: dhId('head'),
    characterId,
    kind: 'TURN_RIGHT',
    intensity: 0.35,
    start: sceneTime(startSec),
    duration: fromSeconds(0.5),
  }
  const pose: HvsBodyPose = {
    id: dhId('pose'),
    characterId,
    kind: 'STANDING',
    start: sceneTime(startSec),
    end: sceneTime(endSec),
    note: 'Stand still but shift weight',
  }
  store.gazePlans.push(gaze)
  store.headMotions.push(head)
  store.poses.push(pose)
  return { acting, gaze, head, pose }
}

export function compileActorA(store: HvsDigitalHumanStore, characterId: string): {
  acting: HvsActingIntent
  gaze: HvsGazePlan
  blocking: HvsBlockingPlan
  gesture: HvsGestureIntent
} {
  const acting = addActingIntent(store, {
    characterId,
    shotId: null,
    beatId: null,
    objective: 'Stand beside the black car, look at the doorway, hesitate, then walk toward it.',
    emotion: 'NERVOUS',
    intensity: 0.4,
    bodyAction: 'Hesitate, then walk',
    gestureIntent: null,
    headIntent: 'Turn toward the doorway',
    gazeIntent: 'Look at the doorway',
    facialIntent: null,
    speechIntent: null,
    start: sceneTime(0),
    end: sceneTime(6),
  })
  const gaze: HvsGazePlan = {
    id: dhId('gaze'),
    characterId,
    shotId: null,
    actingIntentId: acting.id,
    targetKind: 'PROP',
    targetId: 'doorway',
    targetLabel: 'doorway',
    behavior: 'LOOK_AT',
    start: sceneTime(0.4),
    duration: fromSeconds(1.2),
    easing: 'EASE_IN_OUT',
  }
  const gesture: HvsGestureIntent = {
    id: dhId('gest'),
    characterId,
    kind: 'OPEN_HAND',
    intensity: 0.2,
    start: sceneTime(1.2),
    duration: fromSeconds(0.4),
    note: 'Hesitation',
  }
  const blocking: HvsBlockingPlan = {
    id: dhId('block'),
    characterId,
    startTransform: { position: { x: -1.4, y: 0, z: 0.2 }, yaw: 0.4 },
    endTransform: { position: { x: 1.6, y: 0, z: -2.4 }, yaw: 0 },
    motionPathId: null,
    marks: [
      { id: 'mark-a', code: 'MARK_A', name: 'CAR_SIDE', position: { x: -1.4, y: 0, z: 0.2 } },
      { id: 'mark-b', code: 'MARK_B', name: 'DOORWAY', position: { x: 1.6, y: 0, z: -2.4 } },
    ],
    actions: ['stand beside the black car', 'hesitate', 'walk toward the doorway'],
    shotIds: [],
  }
  store.gazePlans.push(gaze)
  store.gestures.push(gesture)
  store.blockingPlans.push(blocking)
  store.poses.push({
    id: dhId('pose'),
    characterId,
    kind: 'WALKING',
    start: sceneTime(2),
    end: sceneTime(6),
    note: 'Walk toward the doorway',
  })
  return { acting, gaze, blocking, gesture }
}

export function createFictionalHuman(input: {
  displayName: string
  role: string
  creation: Omit<HvsCharacterCreationIntent, 'id' | 'generatesMedia'>
  now?: string
}): { human: HvsDigitalHuman; creation: HvsCharacterCreationIntent } {
  const now = input.now ?? new Date().toISOString()
  const id = dhId('actor')
  const creation: HvsCharacterCreationIntent = { ...input.creation, id: dhId('create'), generatesMedia: false }
  const human: HvsDigitalHuman = {
    id,
    projectScope: null,
    globalCharacterId: null,
    name: input.displayName.toLowerCase(),
    displayName: input.displayName,
    characterClass: 'FICTIONAL_HERO',
    identityClass: 'FICTIONAL',
    appearanceProfile: { ...emptyAppearance(), styleNotes: input.creation.appearanceIntent ? [input.creation.appearanceIntent] : [] },
    bodyProfile: emptyBody(),
    faceProfile: { notes: [], referenceAssetIds: [] },
    hairProfile: { style: null, color: null, locked: false },
    wardrobeSets: [],
    activeWardrobeSetId: null,
    performanceProfile: emptyPerformanceProfile('CALM'),
    voiceBinding: null,
    rigBinding: emptyRig(),
    generatorBindings: [],
    representations: [],
    referenceAssetIds: [],
    referenceSetVersion: 'fictional-unset',
    continuityState: emptyContinuity(),
    identityLock: {
      characterId: id,
      faceLocked: true,
      bodyLocked: true,
      voiceLocked: false,
      hairLocked: false,
      wardrobeLocked: false,
      providerConsistencyRequired: false,
    },
    consentState: 'NOT_APPLICABLE_FICTIONAL',
    authorityState: 'FICTIONAL',
    persistence: 'PERSISTENT',
    lodDefault: 'HIGH',
    createdAt: now,
    updatedAt: now,
  }
  return { human, creation }
}

export function castRole(store: HvsDigitalHumanStore, productionId: string, role: Omit<HvsCastRole, 'id'>): HvsCastRole {
  let cast = store.casts.find(item => item.productionId === productionId)
  if (!cast) {
    cast = { id: dhId('cast'), productionId, roles: [] }
    store.casts.push(cast)
  }
  const row: HvsCastRole = { ...role, id: dhId('role') }
  cast.roles.push(row)
  return row
}

export function buildBackgroundPopulation(input: {
  count: number
  profile: string
  walking: number
  standing: number
  seed?: number
  collapseAtSec?: number
}): HvsBackgroundPopulation {
  const id = dhId('crowd')
  const walking = Math.max(0, input.walking)
  const standing = Math.max(0, input.standing)
  const instances = Array.from({ length: input.count }, (_, index) => ({
    id: `${id}-extra-${index + 1}`,
    populationId: id,
    persistent: false as const,
    identity: 'NON_PERSISTENT_SYNTHETIC' as const,
    lod: (index < standing ? 'MEDIUM' : 'LOW') as 'MEDIUM' | 'LOW',
    behavior: (index < standing ? 'WAIT' : 'WALK') as 'WAIT' | 'WALK',
    group: index < standing ? 'storefront' : 'alley-walk',
  }))
  const reactionTime = sceneTime(input.collapseAtSec ?? 6)
  return {
    id,
    count: input.count,
    populationProfile: input.profile,
    wardrobeVariation: 'HIGH',
    motionBehavior: 'WALK',
    reactionBehavior: 'FLEE',
    density: 0.45,
    spawnRegion: { id: 'alley', min: { x: -4, y: 0, z: -6 }, max: { x: 4, y: 0, z: 2 } },
    avoidRegions: [{ id: 'destruction-zone', min: { x: 2, y: 0, z: -8 }, max: { x: 8, y: 6, z: -3 } }],
    seed: input.seed ?? 12,
    variation: HIGH_VARIATION,
    groups: [
      { name: 'walking', count: walking, behavior: 'WALK', lod: 'LOW' },
      { name: 'storefront', count: standing, behavior: 'WAIT', lod: 'MEDIUM' },
    ],
    instances,
    reaction: {
      id: dhId('react'),
      populationId: id,
      trigger: 'MAJOR_COLLAPSE',
      triggerTime: reactionTime,
      behavior: 'FLEE',
      affected: 'CLOSEST',
      avoidDestruction: true,
    },
    path: {
      id: dhId('path'),
      populationId: id,
      waypoints: [{ x: 0, y: 0, z: 0 }, { x: -3, y: 0, z: 3 }],
      avoid: [
        { id: 'building', kind: 'DESTRUCTION', min: { x: 2, y: 0, z: -8 }, max: { x: 8, y: 8, z: -3 } },
        { id: 'car', kind: 'CAR', min: { x: -2.2, y: 0, z: -0.8 }, max: { x: -0.2, y: 1.4, z: 1.2 } },
      ],
      honesty: 'SIMPLE_NAV',
    },
    persistentFaces: false,
  }
}

export function proposePatch(store: HvsDigitalHumanStore, characterId: string, kind: HvsPerformancePatch['kind'], summary: string): HvsPerformancePatch {
  const patch: HvsPerformancePatch = {
    id: dhId('patch'),
    characterId,
    kind,
    summary,
    status: 'proposed',
    createdAt: new Date().toISOString(),
  }
  store.patches.push(patch)
  return patch
}

export function assignReference(
  store: HvsDigitalHumanStore,
  input: { takeId: string; characterId?: string | null; shotId?: string | null; actingIntentId?: string | null; semanticModifier?: string | null },
): HvsPerformanceReference {
  const take = store.takes.find(item => item.id === input.takeId)
  if (!take) throw new Error('Performance take not found.')
  const ref: HvsPerformanceReference = {
    id: dhId('pref'),
    takeId: take.id,
    motionRef: take.motionRef,
    rawAssetId: take.rawAssetId,
    characterId: input.characterId ?? take.characterId,
    shotId: input.shotId ?? null,
    actingIntentId: input.actingIntentId ?? null,
    semanticModifier: input.semanticModifier ?? null,
  }
  store.references.push(ref)
  return ref
}

export function sharedClockOk(times: Array<{ ticks: number; timescale: number }>): boolean {
  return times.every(time => time.timescale === HVS_SCENE_TIMESCALE && Number.isInteger(time.ticks))
}

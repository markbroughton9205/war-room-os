/**
 * Bind digital humans into the existing 3D scene, cinema shots, and storyboard.
 * Identity stays on HvsDigitalHuman. The 3D node is a placeholder execution.
 */
import { angleDegrees, makeCameraSpec } from '../cinema-director/spec'
import type { HvsCinemaPlan, HvsShot } from '../cinema-director/types'
import { cinemaSeconds } from '../cinema-director/types'
import { sceneTime } from '../director/clock'
import { apply3DOp } from '../director3d/ops'
import {
  cloneScene,
  emptyScene,
  identityTransform3D,
  nid,
  vec3,
  type Hvs3DCharacter,
  type Hvs3DScene,
  type HvsMotionPath3D,
  type HvsSceneNode,
} from '../director3d/types'
import type { HvsProject, StoryboardFrame } from '../types'
import { compileActorA, compileLookDoorway } from './direction'
import { defaultPerformanceBinding } from './scene-performance'
import {
  HVS_HUMANOID_RIG_ID,
  RAEL_CHARACTER_ID,
  dhId,
  type HvsBlockingPlan,
  type HvsDigitalHumanStore,
} from './types'

function placeholderNode(input: {
  id: string
  name: string
  type: HvsSceneNode['type']
  placeholder: HvsSceneNode['placeholder']
  parentId: string
  position: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  color: string
  label: string
}): HvsSceneNode {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    parentId: input.parentId,
    transform: { ...identityTransform3D(), position: input.position, scale: input.scale },
    visible: true,
    placeholder: input.placeholder,
    assetId: null,
    bounds: { min: vec3(-0.5, 0, -0.5), max: vec3(0.5, 1.8, 0.5) },
    color: input.color,
    label: input.label,
  }
}

function shot(input: {
  sceneId: string
  name: string
  description: string
  startSec: number
  endSec: number
  size: 'WIDE' | 'CLOSE_UP'
  movement: 'STATIC' | 'FOLLOW' | 'DOLLY_IN'
  characterId: string
  actingIntentId: string | null
  blockingPlanId: string | null
  gazePlanId: string | null
}): HvsShot {
  const start = cinemaSeconds(input.startSec)
  const end = cinemaSeconds(input.endSec)
  const pathId = dhId('cpath')
  const spec = makeCameraSpec({
    id: dhId('cspec'),
    name: input.name,
    shotSize: input.size,
    angle: 'EYE_LEVEL',
    movement: input.movement,
    framing: input.size === 'CLOSE_UP' ? 'FACE_LOCK' : 'CENTER',
    lensMm: input.size === 'CLOSE_UP' ? 85 : 24,
    dof: input.size === 'CLOSE_UP' ? 'SHALLOW' : 'DEEP',
    targetId: input.characterId,
    pathId,
    honesty: 'GEOMETRIC',
  })
  return {
    id: dhId('shot'),
    sceneId: input.sceneId,
    name: input.name,
    description: input.description,
    start,
    end,
    duration: cinemaSeconds(input.endSec - input.startSec),
    shotSize: input.size,
    shotRole: input.size === 'WIDE' ? 'ESTABLISHING' : 'HERO',
    cameraAngle: 'EYE_LEVEL',
    cameraAngleDegrees: angleDegrees('EYE_LEVEL'),
    cameraMovement: input.movement,
    cameraSpec: spec,
    subjectRefs: [input.characterId],
    targetRef: { kind: 'PERSON', id: input.characterId, label: input.name },
    framing: input.size === 'CLOSE_UP' ? 'FACE_LOCK' : 'CENTER',
    focus: { target: { kind: 'PERSON', id: input.characterId, label: input.name }, distance: 4, dofIntent: input.size === 'CLOSE_UP' ? 'SHALLOW' : 'DEEP', aperture: spec.aperture ?? null },
    speed: 'NORMAL',
    pathId,
    status: 'built',
    characterIds: [input.characterId],
    actingIntentIds: input.actingIntentId ? [input.actingIntentId] : [],
    blockingPlanId: input.blockingPlanId,
    gazePlanIds: input.gazePlanId ? [input.gazePlanId] : [],
  }
}

export function attachActorScene(project: HvsProject, scene: Hvs3DScene, plan: HvsCinemaPlan): void {
  const store3d = project.director3d ?? { activeSceneId: null, scenes: [], revisions: [], approvedBlueprintId: null }
  store3d.scenes.push(scene)
  store3d.activeSceneId = scene.id
  project.director3d = store3d
  const cinema = project.cinemaDirector ?? { schemaVersion: 1, activePlanId: null, plans: [] }
  cinema.plans.push(plan)
  cinema.activePlanId = plan.id
  project.cinemaDirector = cinema
}

export function buildActorAScene(project: HvsProject, store: HvsDigitalHumanStore, characterId: string): { scene: Hvs3DScene; blocking: HvsBlockingPlan } {
  const directed = compileActorA(store, characterId)
  let scene = emptyScene(project.id, 'Actor A blocking', 6)
  const car = placeholderNode({
    id: nid('car'), name: 'Black car', type: 'PROP', placeholder: 'car', parentId: scene.rootId,
    position: { x: -1.6, y: 0, z: 0.4 }, scale: vec3(1.8, 1.2, 4), color: '#111111', label: 'Black car',
  })
  const door = placeholderNode({
    id: nid('door'), name: 'Doorway', type: 'EMPTY', placeholder: null, parentId: scene.rootId,
    position: { x: 1.6, y: 0, z: -2.4 }, scale: vec3(1, 2.2, 0.2), color: '#c9a227', label: 'Doorway',
  })
  const personNode = placeholderNode({
    id: nid('person'), name: 'Actor A', type: 'CHARACTER', placeholder: 'person', parentId: scene.rootId,
    position: directed.blocking.startTransform.position, scale: vec3(0.5, 1.7, 0.4), color: '#d7c4a3', label: 'PLACEHOLDER CHARACTER',
  })
  const character: Hvs3DCharacter = {
    id: nid('char3d'),
    nodeId: personNode.id,
    assetId: null,
    label: 'Actor A',
    transform: personNode.transform,
    pose: 'STANDING',
    rigRef: null,
    motionPathId: null,
    state: 'PLACEHOLDER',
    motionHonesty: 'POSITIONAL_MOTION',
    identityRef: characterId,
    digitalHumanId: characterId,
    lod: 'HIGH',
    role: 'HERO',
  }
  const path: HvsMotionPath3D = {
    id: nid('path'),
    name: 'Actor A walk',
    kind: 'SUBJECT',
    interpolation: 'LINEAR',
    points: [
      { time: sceneTime(0), position: directed.blocking.startTransform.position, rotation: null, speed: 0, easing: 'LINEAR' },
      { time: sceneTime(2), position: directed.blocking.startTransform.position, rotation: null, speed: 0, easing: 'EASE_IN_OUT' },
      { time: sceneTime(6), position: directed.blocking.endTransform?.position ?? directed.blocking.startTransform.position, rotation: null, speed: 1.1, easing: 'LINEAR' },
    ],
    assignedNodeId: personNode.id,
  }
  scene = apply3DOp(scene, { kind: 'ADD_PROP', prop: { id: nid('prop'), nodeId: car.id, assetId: null, label: 'Black car', kind: 'car', transform: car.transform, placeholder: 'car' }, node: car })
  scene = apply3DOp(scene, { kind: 'ADD_OBJECT', node: door })
  scene = apply3DOp(scene, { kind: 'ADD_CHARACTER', character, node: personNode })
  scene = apply3DOp(scene, { kind: 'CREATE_PATH', path })
  character.motionPathId = path.id
  directed.blocking.motionPathId = path.id
  const cinemaShot = shot({
    sceneId: scene.id,
    name: 'Actor A walk',
    description: directed.acting.objective,
    startSec: 0,
    endSec: 6,
    size: 'WIDE',
    movement: 'FOLLOW',
    characterId,
    actingIntentId: directed.acting.id,
    blockingPlanId: directed.blocking.id,
    gazePlanId: directed.gaze.id,
  })
  directed.acting.shotId = cinemaShot.id
  directed.gaze.shotId = cinemaShot.id
  directed.blocking.shotIds = [cinemaShot.id]
  const plan = cinemaPlan(project.id, scene, [cinemaShot], 'Actor A')
  attachActorScene(project, scene, plan)
  const frame = storyFrame(0, 'Actor A', directed.acting.objective, cinemaShot.id, null)
  project.storyboard.push(frame)
  store.sceneBindings.push({
    id: dhId('bind'),
    prompt: directed.acting.objective,
    characterIds: [characterId],
    populationId: null,
    actingIntentIds: [directed.acting.id],
    gazePlanIds: [directed.gaze.id],
    blockingPlanId: directed.blocking.id,
    shotIds: [cinemaShot.id],
    storyboardFrameIds: [frame.id],
    sceneId: scene.id,
    destructionTrigger: null,
    destructionTime: null,
    sharedTimescale: scene.timeline.timescale,
  })
  return { scene, blocking: directed.blocking }
}

export function buildCoordinationScene(project: HvsProject, store: HvsDigitalHumanStore, populationId: string): Hvs3DScene {
  const human = store.characters.find(item => item.id === RAEL_CHARACTER_ID)
  if (!human) throw new Error("Ra'el is not authorized yet.")
  const look = compileLookDoorway(store, human.id, null, 6, 8)
  let scene = emptyScene(project.id, "Ra'el and alley", 11)
  const car = placeholderNode({
    id: nid('car'), name: 'Black car', type: 'PROP', placeholder: 'car', parentId: scene.rootId,
    position: { x: -1.6, y: 0, z: 0.6 }, scale: vec3(1.8, 1.2, 4), color: '#111111', label: 'Black car',
  })
  const building = placeholderNode({
    id: nid('bldg'), name: 'Building', type: 'MODEL', placeholder: 'building', parentId: scene.rootId,
    position: { x: 4, y: 0, z: -6 }, scale: vec3(4, 8, 3), color: '#3a342c', label: 'Building · DESTRUCTION PREVIS PLACEHOLDER',
  })
  const door = placeholderNode({
    id: nid('door'), name: 'Doorway', type: 'EMPTY', placeholder: null, parentId: scene.rootId,
    position: { x: 1.8, y: 0, z: -2.2 }, scale: vec3(1, 2.2, 0.2), color: '#c9a227', label: 'Doorway',
  })
  const personNode = placeholderNode({
    id: nid('rael'), name: "Ra'el", type: 'CHARACTER', placeholder: 'person', parentId: scene.rootId,
    position: { x: -1.2, y: 0, z: 0.2 }, scale: human.rigBinding.state === 'BOUND' ? vec3(1, 1, 1) : vec3(0.5, 1.75, 0.4), color: '#e6d3a1', label: human.rigBinding.state === 'BOUND' ? "Ra'el · HVS_HUMANOID_RIG_V1" : "Ra'el · PLACEHOLDER",
  })
  const crowdNode = placeholderNode({
    id: nid('crowd'), name: 'Background population', type: 'GROUP', placeholder: null, parentId: scene.rootId,
    position: { x: 0.4, y: 0, z: -1 }, scale: vec3(3, 1.7, 2), color: '#6d6256', label: '12 background people · LOW/MEDIUM',
  })
  const character: Hvs3DCharacter = {
    id: nid('char3d'),
    nodeId: personNode.id,
    assetId: null,
    label: "Ra'el",
    transform: personNode.transform,
    pose: 'WALKING',
    rigRef: human.rigBinding.skeletonRef,
    motionPathId: null,
    state: human.rigBinding.state === 'BOUND' ? 'RIGGED' : 'PLACEHOLDER',
    motionHonesty: human.rigBinding.state === 'BOUND' ? 'CHARACTER_ANIMATION' : 'POSITIONAL_MOTION',
    identityRef: human.id,
    digitalHumanId: human.id,
    lod: 'HIGH',
    role: 'HERO',
    performanceTakeId: [...store.references].reverse().find(item => item.characterId === human.id)?.takeId ?? null,
    performanceStartTime: defaultPerformanceBinding().performanceStartTime,
    performancePlayback: defaultPerformanceBinding().performancePlayback,
  }
  const path: HvsMotionPath3D = {
    id: nid('path'),
    name: "Ra'el to doorway",
    kind: 'SUBJECT',
    interpolation: 'LINEAR',
    points: [
      { time: sceneTime(0), position: { x: -1.2, y: 0, z: 0.2 }, rotation: null, speed: 0, easing: 'LINEAR' },
      { time: sceneTime(4), position: { x: 0.4, y: 0, z: -1.2 }, rotation: null, speed: 1.1, easing: 'LINEAR' },
      { time: sceneTime(8), position: { x: 1.8, y: 0, z: -2.2 }, rotation: null, speed: 0.4, easing: 'EASE_OUT' },
    ],
    assignedNodeId: personNode.id,
  }
  scene = apply3DOp(scene, { kind: 'ADD_PROP', prop: { id: nid('prop'), nodeId: car.id, assetId: null, label: 'Black car', kind: 'car', transform: car.transform, placeholder: 'car' }, node: car })
  scene = apply3DOp(scene, { kind: 'ADD_PROP', prop: { id: nid('prop'), nodeId: building.id, assetId: null, label: 'Building', kind: 'building', transform: building.transform, placeholder: 'building' }, node: building })
  scene = apply3DOp(scene, { kind: 'ADD_OBJECT', node: door })
  scene = apply3DOp(scene, { kind: 'ADD_OBJECT', node: crowdNode })
  scene = apply3DOp(scene, { kind: 'ADD_CHARACTER', character, node: personNode })
  scene = apply3DOp(scene, { kind: 'CREATE_PATH', path })
  character.motionPathId = path.id
  human.rigBinding.sceneNodeId = personNode.id
  human.continuityState.position = { x: -1.2, y: 0, z: 0.2 }
  human.continuityState.wardrobeSetId = human.activeWardrobeSetId
  const blocking: HvsBlockingPlan = {
    id: dhId('block'),
    characterId: human.id,
    startTransform: { position: { x: -1.2, y: 0, z: 0.2 }, yaw: 0.2 },
    endTransform: { position: { x: 1.8, y: 0, z: -2.2 }, yaw: 2.4 },
    motionPathId: path.id,
    marks: [
      { id: 'mark-a', code: 'MARK_A', name: 'CAR_SIDE', position: { x: -1.2, y: 0, z: 0.2 } },
      { id: 'mark-b', code: 'MARK_B', name: 'DOORWAY', position: { x: 1.8, y: 0, z: -2.2 } },
    ],
    actions: ['start beside the black car', 'walk toward the doorway', 'look back when the building collapses'],
    shotIds: [],
  }
  store.blockingPlans.push(blocking)
  const shots = [
    shot({ sceneId: scene.id, name: 'Wide', description: 'Start wide beside the black car.', startSec: 0, endSec: 3, size: 'WIDE', movement: 'STATIC', characterId: human.id, actingIntentId: null, blockingPlanId: blocking.id, gazePlanId: null }),
    shot({ sceneId: scene.id, name: 'Walk', description: "Ra'el walks toward the doorway.", startSec: 3, endSec: 6, size: 'WIDE', movement: 'FOLLOW', characterId: human.id, actingIntentId: null, blockingPlanId: blocking.id, gazePlanId: null }),
    shot({ sceneId: scene.id, name: 'Look back', description: 'Look back as the collapse begins.', startSec: 6, endSec: 8, size: 'WIDE', movement: 'STATIC', characterId: human.id, actingIntentId: look.acting.id, blockingPlanId: blocking.id, gazePlanId: look.gaze.id }),
    shot({ sceneId: scene.id, name: "Close-up of Ra'el", description: "Finish on a close-up of Ra'el.", startSec: 8, endSec: 11, size: 'CLOSE_UP', movement: 'DOLLY_IN', characterId: human.id, actingIntentId: look.acting.id, blockingPlanId: blocking.id, gazePlanId: null }),
  ]
  look.acting.shotId = shots[2].id
  look.gaze.shotId = shots[2].id
  look.gaze.behavior = 'LOOK_AWAY'
  look.gaze.targetLabel = 'behind'
  blocking.shotIds = shots.map(item => item.id)
  const frames = shots.map((item, index) => storyFrame(index, item.name, item.description, item.id, populationId))
  for (const frame of frames) project.storyboard.push(frame)
  const plan = cinemaPlan(project.id, scene, shots, "Ra'el alley")
  plan.destructionCues = [{ eventKind: 'MAJOR_COLLAPSE', shotId: shots[2].id, cameraResponse: 'HOLD', start: sceneTime(6) }]
  attachActorScene(project, scene, plan)
  store.staging.push({
    characterId: human.id,
    protectedRegion: { min: { x: -2, y: 0, z: -1 }, max: { x: 0, y: 2, z: 1 } },
    evacuationPathId: path.id,
    reactionTiming: sceneTime(6),
    note: 'CINEMATIC_STAGING_ONLY',
  })
  store.sceneBindings.push({
    id: dhId('bind'),
    prompt: "Start wide. Ra'el walks toward the doorway. He looks back when the building starts collapsing.",
    characterIds: [human.id],
    populationId,
    actingIntentIds: [look.acting.id],
    gazePlanIds: [look.gaze.id],
    blockingPlanId: blocking.id,
    shotIds: shots.map(item => item.id),
    storyboardFrameIds: frames.map(frame => frame.id),
    sceneId: scene.id,
    destructionTrigger: 'MAJOR_COLLAPSE',
    destructionTime: sceneTime(6),
    sharedTimescale: scene.timeline.timescale,
  })
  store.blueprints.push({
    id: dhId('print'),
    characterId: human.id,
    referenceAssetIds: [...human.referenceAssetIds],
    wardrobeSetId: human.activeWardrobeSetId,
    poseId: null,
    performanceReferenceId: store.references.find(item => item.characterId === human.id)?.id ?? null,
    shotId: shots[3].id,
    lighting: 'night alley',
    voiceRef: null,
    lipsyncRef: null,
    continuityConstraints: ['same character id', 'same wardrobe', 'identity lock'],
    invoked: false,
  })
  return scene
}

function storyFrame(index: number, title: string, description: string, shotId: string, populationId: string | null): StoryboardFrame {
  return {
    id: dhId('board'),
    index,
    title,
    description,
    assetId: null,
    duration: cinemaSeconds(3),
    castRoleIds: [],
    backgroundPopulationId: populationId,
    performanceIntentId: null,
    wardrobeSetId: null,
    poseId: null,
    gazePlanId: null,
    shotId,
  }
}

function cinemaPlan(projectId: string, scene: Hvs3DScene, shots: HvsShot[], title: string): HvsCinemaPlan {
  return {
    id: dhId('cinema'),
    intentId: dhId('intent'),
    projectId,
    sceneId: scene.id,
    title,
    duration: scene.duration,
    shots,
    paths: shots.map(item => ({
      id: item.pathId,
      shotId: item.id,
      interpolation: 'LINEAR',
      points: [
        { time: item.start, position: { x: 0, y: 1.6, z: 4 }, rotation: null, target: { x: 0, y: 1.4, z: 0 }, focalLength: item.cameraSpec.focalLengthMm ?? 35, focusDistance: 4, interpolation: 'LINEAR' },
        { time: item.end, position: { x: 0.4, y: 1.6, z: 3 }, rotation: null, target: { x: 0, y: 1.4, z: 0 }, focalLength: item.cameraSpec.focalLengthMm ?? 35, focusDistance: 3, interpolation: 'LINEAR' },
      ],
    })),
    specs: shots.map(item => item.cameraSpec),
    focusTransitions: [],
    shakeLayers: [],
    continuity: { lineOfAction: null, screenDirections: [], warnings: [] },
    storyboardLinks: shots.map(item => ({ shotId: item.id, frameId: null, beatId: null })),
    destructionCues: [],
    skill: null,
    commanderShotList: shots.map((item, index) => ({ index: index + 1, name: item.name, durationLabel: `${item.duration.ticks / item.duration.timescale}s`, shotId: item.id })),
    status: 'built',
    approvalRequired: true,
    approvalAction: 'PREVIEW',
    mutated: false,
    createdAt: new Date().toISOString(),
  }
}

function raelTakeId(store: HvsDigitalHumanStore): string | null {
  return [...store.references].reverse().find(item => item.characterId === RAEL_CHARACTER_ID)?.takeId
    ?? [...store.takes].reverse().find(item => item.characterId === RAEL_CHARACTER_ID)?.id
    ?? null
}

function isRaelSceneCharacter(character: Hvs3DCharacter): boolean {
  if (character.role === 'BACKGROUND') return false
  if (character.digitalHumanId === RAEL_CHARACTER_ID) return true
  if (character.identityRef === RAEL_CHARACTER_ID) return true
  return /ra'?el/i.test(character.label)
}

/** Bind existing Ra'el take/rig onto the existing 3D character. Does not create a second identity. */
export function overlayScenePerformance(store: HvsDigitalHumanStore, scene: Hvs3DScene): Hvs3DScene {
  const next = cloneScene(scene)
  const rael = store.characters.find(item => item.id === RAEL_CHARACTER_ID)
  const takeId = raelTakeId(store)
  const rigId = rael?.rigBinding.state === 'BOUND' ? rael.rigBinding.skeletonRef : null
  const defaults = defaultPerformanceBinding()
  for (const character of next.characters) {
    if (!isRaelSceneCharacter(character)) continue
    if (rigId) character.rigRef = character.rigRef ?? rigId
    if (takeId && !character.performanceTakeId) character.performanceTakeId = takeId
    character.performanceStartTime = character.performanceStartTime ?? defaults.performanceStartTime
    character.performancePlayback = character.performancePlayback ?? defaults.performancePlayback
    if (character.rigRef === HVS_HUMANOID_RIG_ID && character.state === 'PLACEHOLDER') {
      character.state = 'RIGGED'
    }
    if (character.rigRef === HVS_HUMANOID_RIG_ID) {
      character.motionHonesty = 'CHARACTER_ANIMATION'
    }
  }
  return next
}

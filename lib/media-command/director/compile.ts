/**
 * Compile HvsDirectorPlan into existing Hvs3DScene via typed ops.
 * Stable node ids so revisions rebind instead of duplicating entities.
 */
import { fromSeconds } from '../time'
import { makeKeyframe, makePlaceholderNode, type Hvs3DOp } from '../director3d/ops'
import { orbitPoint } from '../director3d/evaluate'
import {
  emptyScene,
  vec3,
  type Hvs3DCamera,
  type Hvs3DCharacter,
  type Hvs3DLight,
  type Hvs3DProp,
  type Hvs3DScene,
  type HvsMotionPath3D,
} from '../director3d/types'
import { HVS_RAEL_CHARACTER_ID, HVS_RAEL_NODE_ID, type HvsDirectorPlan } from './types'

export const DIRECTOR_NODE = {
  person: HVS_RAEL_NODE_ID,
  car: 'node-car',
  building: 'node-building',
  doorway: 'node-doorway',
  ground: 'node-ground',
  dust: 'node-dust',
  cam1: 'node-cam-1',
  cam2: 'node-cam-2',
  cam3: 'node-cam-3',
  cam4: 'node-cam-4',
  cam5: 'node-cam-5',
  pathPerson: 'path-person',
  pathOrbit: 'path-camera-orbit',
  pathRetreat: 'path-camera-retreat',
  pathClose: 'path-camera-close',
  char: HVS_RAEL_CHARACTER_ID,
  propCar: 'prop-car',
  propBuilding: 'prop-building',
  propDoorway: 'prop-doorway',
} as const

const GEO = {
  car: vec3(0, 0.45, 0),
  personStart: vec3(1.7, 0, 0.35),
  personEnd: vec3(0.55, 0, -11.5),
  doorway: vec3(0.5, 1.2, -11.5),
  building: vec3(0.4, 4, -14),
}

function addLight(rootId: string, name: string, kind: Hvs3DLight['kind'], pos: ReturnType<typeof vec3>, intensity: number, color: string, id: string): Hvs3DOp {
  const node = makePlaceholderNode({
    id: `node-light-${id}`,
    type: 'LIGHT',
    name,
    placeholder: null,
    position: pos,
    parentId: rootId,
  })
  const light: Hvs3DLight = {
    id: `light-${id}`,
    nodeId: node.id,
    kind,
    color,
    intensity,
    targetNodeId: DIRECTOR_NODE.person,
    angle: kind === 'SPOT' ? 0.55 : null,
    distance: kind === 'POINT' ? 18 : null,
  }
  return { kind: 'ADD_LIGHT', light, node }
}

export function compileDirectorPlan(plan: HvsDirectorPlan): { scene: Hvs3DScene; ops: Hvs3DOp[] } {
  const t = plan.timing
  const scene = emptyScene(plan.projectId, plan.creativeGoal, t.durationSec)
  const rootId = scene.rootId
  const ops: Hvs3DOp[] = []

  ops.push({
    kind: 'SET_ENVIRONMENT',
    environment: {
      timeOfDay: 'night',
      sky: 'night',
      weatherIntent: null,
      fog: 0.14,
      ambientLight: 0.16,
      ground: 'city-street',
      background: '#05070c',
    },
  })
  ops.push({ kind: 'SET_DURATION', duration: fromSeconds(t.durationSec) })

  const ground = makePlaceholderNode({
    id: DIRECTOR_NODE.ground,
    type: 'ENVIRONMENT',
    name: 'Alley',
    placeholder: 'plane',
    position: vec3(0, 0, 0),
    parentId: rootId,
    color: '#141820',
    scale: vec3(28, 1, 42),
  })
  ops.push({ kind: 'ADD_OBJECT', node: ground })

  const car = makePlaceholderNode({
    id: DIRECTOR_NODE.car,
    type: 'PROP',
    name: 'Black car',
    placeholder: 'car',
    position: GEO.car,
    parentId: rootId,
    color: '#111111',
    scale: vec3(1.9, 0.7, 4.4),
  })
  const carProp: Hvs3DProp = {
    id: DIRECTOR_NODE.propCar,
    nodeId: car.id,
    assetId: null,
    label: 'Black car',
    kind: 'car',
    transform: car.transform,
    placeholder: 'car',
  }
  ops.push({ kind: 'ADD_PROP', prop: carProp, node: car })

  const doorway = makePlaceholderNode({
    id: DIRECTOR_NODE.doorway,
    type: 'PROP',
    name: 'Doorway',
    placeholder: 'box',
    position: GEO.doorway,
    parentId: rootId,
    color: '#c48a4a',
    scale: vec3(1.5, 2.4, 0.35),
  })
  ops.push({
    kind: 'ADD_PROP',
    prop: {
      id: DIRECTOR_NODE.propDoorway,
      nodeId: doorway.id,
      assetId: null,
      label: 'Doorway',
      kind: 'doorway',
      transform: doorway.transform,
      placeholder: 'box',
    },
    node: doorway,
  })

  const building = makePlaceholderNode({
    id: DIRECTOR_NODE.building,
    type: 'PROP',
    name: 'Building · DESTRUCTION PREVIS PLACEHOLDER',
    placeholder: 'building',
    position: GEO.building,
    parentId: rootId,
    color: '#243044',
    scale: vec3(8, 8, 2.2),
  })
  ops.push({
    kind: 'ADD_PROP',
    prop: {
      id: DIRECTOR_NODE.propBuilding,
      nodeId: building.id,
      assetId: null,
      label: 'Building · DESTRUCTION PREVIS PLACEHOLDER',
      kind: 'building',
      transform: building.transform,
      placeholder: 'building',
    },
    node: building,
  })

  const person = makePlaceholderNode({
    id: DIRECTOR_NODE.person,
    type: 'CHARACTER',
    name: "Ra'el",
    placeholder: 'person',
    position: GEO.personStart,
    parentId: rootId,
    color: '#c9a227',
    scale: vec3(0.5, 1.7, 0.4),
  })
  const character: Hvs3DCharacter = {
    id: DIRECTOR_NODE.char,
    nodeId: person.id,
    assetId: null,
    label: "Ra'el · PLACEHOLDER CHARACTER",
    transform: person.transform,
    pose: t.lookBack ? 'LOOK_BACK_THEN_CAMERA' : 'WALK_TO_DOORWAY',
    rigRef: null,
    motionPathId: DIRECTOR_NODE.pathPerson,
    state: 'PLACEHOLDER',
    motionHonesty: 'POSITIONAL_MOTION',
    identityRef: plan.characters[0]?.identityRef ?? HVS_RAEL_CHARACTER_ID,
    role: 'HERO',
  }
  ops.push({ kind: 'ADD_CHARACTER', character, node: person })

  const dust = makePlaceholderNode({
    id: DIRECTOR_NODE.dust,
    type: 'VOLUME',
    name: 'Dust · DESTRUCTION PREVIS PLACEHOLDER',
    placeholder: 'sphere',
    position: vec3(0.6, 1.4, -10.2),
    parentId: rootId,
    color: '#9aa3ad',
    scale: vec3(0.01, 0.01, 0.01),
  })
  ops.push({ kind: 'ADD_OBJECT', node: dust })

  for (const extra of plan.backgroundPopulation.actors) {
    const node = makePlaceholderNode({
      id: extra.ref,
      type: 'PROP',
      name: extra.role === 'STOREFRONT' ? 'Storefront extra' : 'Walking extra',
      placeholder: 'person',
      position: vec3(extra.start.x, extra.start.y, extra.start.z),
      parentId: rootId,
      color: extra.nearestToEvent ? '#8a7a62' : '#6b7380',
      scale: vec3(0.42, 1.55, 0.35),
    })
    ops.push({
      kind: 'ADD_PROP',
      prop: {
        id: `prop-${extra.id}`,
        nodeId: node.id,
        assetId: null,
        label: `${extra.role} extra · PLACEHOLDER PEOPLE`,
        kind: 'extra',
        transform: node.transform,
        placeholder: 'person',
      },
      node,
    })
    const walkZ = extra.role === 'WALKING' ? extra.start.z - 2.4 : extra.start.z
    const fleeX = extra.start.x >= 0 ? extra.start.x + 4.2 : extra.start.x - 4.2
    const fleeZ = extra.start.z + (extra.nearestToEvent ? 3.2 : 1.4)
    const path: HvsMotionPath3D = {
      id: `path-${extra.id}`,
      name: extra.nearestToEvent ? 'Nearest extra flee' : 'Background walk',
      kind: 'SUBJECT',
      interpolation: 'LINEAR',
      assignedNodeId: extra.ref,
      points: [
        { time: fromSeconds(0), position: vec3(extra.start.x, 0, extra.start.z), rotation: null, speed: null, easing: 'LINEAR' },
        { time: fromSeconds(t.collapseSec), position: vec3(extra.start.x, 0, walkZ), rotation: null, speed: null, easing: 'LINEAR' },
        { time: fromSeconds(extra.reactStartSec), position: vec3(extra.start.x, 0, walkZ), rotation: null, speed: null, easing: 'LINEAR' },
        { time: fromSeconds(Math.min(t.durationSec, extra.fleeStartSec + 1.6)), position: vec3(fleeX, 0, fleeZ), rotation: null, speed: null, easing: 'EASE_OUT' },
      ],
    }
    ops.push({ kind: 'CREATE_PATH', path })
    ops.push({ kind: 'ASSIGN_PATH', pathId: path.id, nodeId: extra.ref })
  }

  const walk: HvsMotionPath3D = {
    id: DIRECTOR_NODE.pathPerson,
    name: "Ra'el walk to doorway",
    kind: 'SUBJECT',
    interpolation: 'CATMULL_ROM',
    assignedNodeId: person.id,
    points: [
      { time: fromSeconds(0), position: { ...GEO.personStart }, rotation: vec3(0, Math.PI, 0), speed: null, easing: 'LINEAR' },
      { time: fromSeconds(Math.min(2, t.walkArriveSec * 0.35)), position: { ...GEO.personStart }, rotation: vec3(0, Math.PI, 0), speed: null, easing: 'LINEAR' },
      { time: fromSeconds(t.walkArriveSec), position: { ...GEO.personEnd }, rotation: vec3(0, Math.PI, 0), speed: null, easing: 'EASE_IN_OUT' },
      { time: fromSeconds(t.durationSec), position: { ...GEO.personEnd }, rotation: vec3(0, t.lookBack ? 0 : Math.PI, 0), speed: null, easing: 'LINEAR' },
    ],
  }
  ops.push({ kind: 'CREATE_PATH', path: walk })
  ops.push({ kind: 'ASSIGN_PATH', pathId: walk.id, nodeId: person.id })

  if (t.lookBack) {
    ops.push({ kind: 'SET_CHARACTER_POSE', characterId: DIRECTOR_NODE.char, pose: 'LOOK_BACK_COLLAPSE' })
    ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.person, 'rotation', 0, vec3(0, Math.PI, 0), 'LINEAR') })
    ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.person, 'rotation', t.lookBackSec, vec3(0, Math.PI * 0.72, 0), 'EASE_IN_OUT') })
    ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.person, 'rotation', t.turnToCameraSec, vec3(0, 0.15, 0), 'EASE_IN_OUT') })
  }

  const mkCam = (
    nodeId: string,
    camId: string,
    name: string,
    position: ReturnType<typeof vec3>,
    shotSize: Hvs3DCamera['shotSize'],
    angle: Hvs3DCamera['angle'],
    movement: Hvs3DCamera['movement'],
    focalLength: number,
    framing: Hvs3DCamera['virtualCameraMode'],
  ): { camera: Hvs3DCamera; node: ReturnType<typeof makePlaceholderNode> } => {
    const node = makePlaceholderNode({
      id: nodeId,
      type: 'CAMERA',
      name,
      placeholder: null,
      position,
      parentId: rootId,
    })
    const camera: Hvs3DCamera = {
      id: camId,
      nodeId,
      name,
      cameraSpecId: `spec-${camId}`,
      virtualCameraMode: framing,
      shotSize,
      angle,
      movement,
      focalLength,
      focusDistance: 4,
      apertureIntent: focalLength >= 70 ? 'open' : 'medium',
      sensorAspect: '16:9',
      target: { kind: 'CHARACTER', characterId: DIRECTOR_NODE.char },
      pathId: null,
    }
    return { camera, node }
  }

  const c1 = mkCam(DIRECTOR_NODE.cam1, 'cam-1', 'Establishing', vec3(0.15, 4.8, 13.2), 'WS', 'eye', 'STATIC', t.establishFocalMm, 'FULL_BODY')
  const c2 = mkCam(DIRECTOR_NODE.cam2, 'cam-2', 'Low car', vec3(0.08, 0.36, 5.35), 'MLS', 'low', 'REVEAL', t.revealFocalMm, 'CINEMATIC_FOLLOW')
  const c3 = mkCam(DIRECTOR_NODE.cam3, 'cam-3', 'Orbit', orbitPoint(GEO.personStart, 4.5, 0.18, 1.18), 'MS', 'eye', 'ORBIT', t.orbitFocalMm, 'CINEMATIC_FOLLOW')
  const c4 = mkCam(DIRECTOR_NODE.cam4, 'cam-4', 'Retreat', orbitPoint(GEO.personEnd, 5.4, -0.85, 1.35), 'MS', 'eye', 'PULL_OUT', t.retreatFocalMm, 'CINEMATIC_FOLLOW')
  const c5 = mkCam(DIRECTOR_NODE.cam5, 'cam-5', 'Close-up', vec3(GEO.personEnd.x + 0.35, t.closeupHeight, GEO.personEnd.z + t.closeupDistance), t.closeupFocalMm >= 80 ? 'CU' : 'MCU', t.closeupHeight < 1.2 ? 'low' : 'eye', 'STATIC', t.closeupFocalMm, 'FACE_LOCK')

  for (const cam of [c1, c2, c3, c4, c5]) {
    ops.push({ kind: 'ADD_CAMERA', camera: cam.camera, node: cam.node })
    ops.push({ kind: 'AIM_CAMERA', cameraId: cam.camera.id, target: cam.camera.target! })
  }

  const orbitPath: HvsMotionPath3D = {
    id: DIRECTOR_NODE.pathOrbit,
    name: 'Clockwise orbit',
    kind: 'CAMERA',
    interpolation: 'CATMULL_ROM',
    assignedNodeId: DIRECTOR_NODE.cam3,
    points: [
      { time: fromSeconds(t.orbitStartSec), position: orbitPoint(GEO.personStart, 4.5, 0.18, 1.18), rotation: null, speed: null, easing: 'LINEAR' },
      { time: fromSeconds((t.orbitStartSec + t.orbitEndSec) / 2), position: orbitPoint(GEO.personStart, 4.35, -0.55, 1.22), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
      { time: fromSeconds(t.orbitEndSec), position: orbitPoint(GEO.personStart, 4.2, -1.15, 1.28), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
    ],
  }
  ops.push({ kind: 'CREATE_PATH', path: orbitPath })
  ops.push({ kind: 'SET_CAMERA_PATH', cameraId: 'cam-3', pathId: orbitPath.id })

  const retreatPath: HvsMotionPath3D = {
    id: DIRECTOR_NODE.pathRetreat,
    name: 'Collapse retreat',
    kind: 'CAMERA',
    interpolation: 'CATMULL_ROM',
    assignedNodeId: DIRECTOR_NODE.cam4,
    points: [
      { time: fromSeconds(t.retreatSec), position: orbitPoint(GEO.personEnd, 4.3, -1.15, 1.3), rotation: null, speed: null, easing: 'LINEAR' },
      { time: fromSeconds(t.impactSec), position: orbitPoint(GEO.personEnd, 6.4, -1.05, 1.55), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
      { time: fromSeconds(t.closeupStartSec), position: orbitPoint(GEO.personEnd, 7.6, -0.95, 1.7), rotation: null, speed: null, easing: 'EASE_OUT' },
    ],
  }
  ops.push({ kind: 'CREATE_PATH', path: retreatPath })
  ops.push({ kind: 'SET_CAMERA_PATH', cameraId: 'cam-4', pathId: retreatPath.id })

  const closePath: HvsMotionPath3D = {
    id: DIRECTOR_NODE.pathClose,
    name: 'Close-up hold',
    kind: 'CAMERA',
    interpolation: 'LINEAR',
    assignedNodeId: DIRECTOR_NODE.cam5,
    points: [
      { time: fromSeconds(t.closeupStartSec), position: vec3(GEO.personEnd.x + 0.35, t.closeupHeight, GEO.personEnd.z + t.closeupDistance), rotation: null, speed: null, easing: 'LINEAR' },
      { time: fromSeconds(t.durationSec), position: vec3(GEO.personEnd.x + 0.35, t.closeupHeight, GEO.personEnd.z + t.closeupDistance), rotation: null, speed: null, easing: 'LINEAR' },
    ],
  }
  ops.push({ kind: 'CREATE_PATH', path: closePath })
  ops.push({ kind: 'SET_CAMERA_PATH', cameraId: 'cam-5', pathId: closePath.id })

  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.cam1, 'focalLength', 0, t.establishFocalMm) })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.cam2, 'focalLength', t.orbitStartSec / 2, t.revealFocalMm) })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.cam3, 'focalLength', t.orbitStartSec, t.orbitFocalMm) })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.cam4, 'focalLength', t.retreatSec, t.retreatFocalMm) })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.cam5, 'focalLength', t.closeupStartSec, t.closeupFocalMm) })

  const buildingScale = vec3(8, 8, 2.2)
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'rotation', 0, vec3(0, 0, 0), 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'rotation', t.collapseSec, vec3(0, 0, 0), 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'rotation', t.impactSec, vec3(0.18, 0, 0.06), 'EASE_IN') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'rotation', t.durationSec, vec3(0.62, 0, 0.1), 'EASE_IN_OUT') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'scale', 0, buildingScale, 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'scale', t.collapseSec, buildingScale, 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.building, 'scale', t.durationSec, vec3(8, 4.6, 3.1), 'EASE_IN_OUT') })

  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.dust, 'scale', 0, vec3(0.01, 0.01, 0.01), 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.dust, 'scale', t.dustSec, vec3(0.01, 0.01, 0.01), 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.dust, 'scale', t.dustSec + 0.4, vec3(3.8, 2.2, 3.8), 'EASE_OUT') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.dust, 'position', t.dustSec, vec3(0.6, 1.4, -10.2), 'LINEAR') })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(DIRECTOR_NODE.dust, 'position', t.durationSec, vec3(0.9, 1.55, GEO.personEnd.z + t.closeupDistance * 0.35), 'LINEAR') })

  ops.push(addLight(rootId, 'Ambient', 'AMBIENT', vec3(0, 6, 0), 0.22, '#1a2a44', 'amb'))
  ops.push(addLight(rootId, 'Moon key', 'DIRECTIONAL', vec3(-6, 9, 4), 1.12, '#8fb4ff', 'key'))
  ops.push(addLight(rootId, 'Doorway practical', 'SPOT', vec3(0.5, 2.6, -10.4), 1.55, '#ffd19a', 'door'))
  ops.push(addLight(rootId, 'Car rim', 'POINT', vec3(-1.4, 0.8, 1.1), 0.75, '#66d6ff', 'rim'))
  ops.push(addLight(rootId, 'Face fill', 'POINT', vec3(GEO.personEnd.x + 0.8, 1.6, GEO.personEnd.z + 1.1), 0.55, '#ffe6c2', 'face'))

  const shotTimes = [
    { id: 'shot-1', name: 'Wide establishing', start: 0, end: t.orbitStartSec / 2, cam: 'cam-1', preset: 'STATIC' as const, notes: '24mm wide establishing.', label: 'Establishing' },
    { id: 'shot-2', name: 'Low car reveal', start: t.orbitStartSec / 2, end: t.orbitStartSec, cam: 'cam-2', preset: 'REVEAL' as const, notes: '28mm low behind the car.', label: 'Low car reveal' },
    { id: 'shot-3', name: 'Orbit', start: t.orbitStartSec, end: t.orbitEndSec, cam: 'cam-3', preset: 'ORBIT' as const, notes: "35mm clockwise orbit, target lock Ra'el.", label: 'Orbit' },
    { id: 'shot-4', name: 'Collapse retreat', start: t.orbitEndSec, end: t.closeupStartSec, cam: 'cam-4', preset: 'PULL_OUT' as const, notes: '35mm backward track with collapse.', label: 'Collapse retreat' },
    { id: 'shot-5', name: 'Close-up', start: t.closeupStartSec, end: t.durationSec, cam: 'cam-5', preset: 'STATIC' as const, notes: `${t.closeupFocalMm}mm close-up. Dust in foreground.`, label: 'Close-up' },
  ]
  for (const shot of shotTimes) {
    ops.push({
      kind: 'CREATE_SHOT',
      shot: {
        id: shot.id,
        name: shot.name,
        start: fromSeconds(shot.start),
        end: fromSeconds(shot.end),
        cameraId: shot.cam,
        motionPreset: shot.preset,
        notes: shot.notes,
        commanderLabel: shot.label,
      },
    })
  }

  return { scene, ops }
}

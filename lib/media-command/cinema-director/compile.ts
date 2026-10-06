/**
 * Compile an approved cinema plan into the existing HVS 3D scene + CameraSpec.
 * Cinema plan is canonical. 3D scene is previs execution.
 */
import { fromSeconds, toSeconds } from '../time'
import { makeKeyframe, makePlaceholderNode, type Hvs3DOp } from '../director3d/ops'
import {
  emptyScene,
  nid,
  vec3,
  type Hvs3DCamera,
  type Hvs3DCharacter,
  type Hvs3DLight,
  type Hvs3DProp,
  type HvsMotionPath3D,
} from '../director3d/types'
import type { HvsCinemaIntent, HvsCinemaPlan, HvsShot } from './types'
import { CINEMA_LAYOUT } from './plan'
import { cinemaFramingToVirtual, cinemaSizeToSpec, cinemaAngleToSpec } from './spec'
import { applyShakeWindow } from './path'

function motionPreset(shot: HvsShot): Hvs3DCamera['movement'] {
  if (shot.cameraMovement === 'ORBIT' || shot.cameraMovement === 'ARC') return 'ORBIT'
  if (shot.cameraMovement === 'DOLLY_IN' || shot.cameraMovement === 'REVEAL') return 'PUSH_IN'
  if (shot.cameraMovement === 'DOLLY_OUT') return 'PULL_OUT'
  if (shot.cameraMovement === 'CRANE' || shot.cameraMovement === 'JIB') return 'CRANE'
  if (shot.cameraMovement === 'PAN' || shot.cameraMovement === 'WHIP_PAN') return 'PAN'
  if (shot.cameraMovement === 'TILT') return 'TILT'
  if (shot.cameraMovement === 'HANDHELD') return 'HANDHELD_STYLE'
  if (shot.cameraMovement === 'FOLLOW' || shot.cameraMovement === 'STEADICAM_STYLE' || shot.cameraMovement === 'CHASE') return 'FOLLOW'
  if (shot.cameraMovement === 'STATIC') return 'STATIC'
  return 'CUSTOM_PATH'
}

export function compileCinemaScene(intent: HvsCinemaIntent, plan: HvsCinemaPlan): { scene: ReturnType<typeof emptyScene>; ops: Hvs3DOp[] } {
  const durationSec = Math.max(1, toSeconds(plan.duration))
  const scene = emptyScene(plan.projectId, plan.title, durationSec)
  scene.id = plan.sceneId
  const rootId = scene.rootId
  const ops: Hvs3DOp[] = []
  const night = /night/.test(intent.prompt.toLowerCase())
  ops.push({
    kind: 'SET_ENVIRONMENT',
    environment: {
      timeOfDay: night ? 'night' : 'day',
      sky: night ? 'night' : 'day',
      weatherIntent: null,
      fog: night ? 0.1 : 0.03,
      ambientLight: night ? 0.18 : 0.46,
      ground: 'city-street',
      background: night ? '#07090f' : '#8eb6d9',
    },
  })

  const ground = makePlaceholderNode({
    type: 'ENVIRONMENT',
    name: 'Street',
    placeholder: 'plane',
    position: vec3(0, 0, 0),
    parentId: rootId,
    color: '#2c3340',
    scale: vec3(32, 1, 40),
  })
  ground.id = 'cnode-street'
  ops.push({ kind: 'ADD_OBJECT', node: ground })

  let carNodeId: string | null = null
  if (intent.propRefs.some(item => item.kind === 'car')) {
    const car = makePlaceholderNode({
      type: 'PROP',
      name: 'Black car',
      placeholder: 'car',
      position: CINEMA_LAYOUT.CAR_POS,
      parentId: rootId,
      color: '#111111',
      scale: vec3(1.9, 0.7, 4.4),
    })
    car.id = 'cnode-car'
    carNodeId = car.id
    const prop: Hvs3DProp = {
      id: 'CAR_1',
      nodeId: car.id,
      assetId: null,
      label: 'Black car',
      kind: 'car',
      transform: car.transform,
      placeholder: 'car',
    }
    ops.push({ kind: 'ADD_PROP', prop, node: car })
  }

  const characters: Array<{ id: string; nodeId: string }> = []
  intent.subjectRefs.forEach((subject, index) => {
    const pos = index === 0 ? CINEMA_LAYOUT.PERSON_POS : CINEMA_LAYOUT.PERSON_B_POS
    const person = makePlaceholderNode({
      type: 'CHARACTER',
      name: subject.label,
      placeholder: 'person',
      position: pos,
      parentId: rootId,
      color: index === 0 ? '#c9a227' : '#7aa2ff',
      scale: vec3(1, 1, 1),
    })
    person.id = subject.id === 'PERSON_2' ? 'cnode-person-b' : 'cnode-person'
    const character: Hvs3DCharacter = {
      id: subject.id,
      nodeId: person.id,
      assetId: null,
      label: subject.label,
      transform: person.transform,
      pose: null,
      rigRef: null,
      motionPathId: null,
      state: 'PLACEHOLDER',
      motionHonesty: 'POSITIONAL_MOTION',
    }
    characters.push({ id: character.id, nodeId: person.id })
    ops.push({ kind: 'ADD_CHARACTER', character, node: person })
  })

  if (intent.locationRefs.some(item => item.kind === 'building') || /building/.test(intent.prompt.toLowerCase()) || intent.shotIntent.length >= 3) {
    const building = makePlaceholderNode({
      type: 'PROP',
      name: 'Building',
      placeholder: 'building',
      position: CINEMA_LAYOUT.BUILDING_POS,
      parentId: rootId,
      color: '#3d4554',
      scale: vec3(6, 10, 5),
    })
    building.id = 'cnode-building'
    ops.push({
      kind: 'ADD_PROP',
      prop: {
        id: 'BUILDING_1',
        nodeId: building.id,
        assetId: null,
        label: 'Building',
        kind: 'building',
        transform: building.transform,
        placeholder: 'building',
      },
      node: building,
    })
  }

  const key = nid('light')
  const keyNode = makePlaceholderNode({
    type: 'LIGHT',
    name: 'Key',
    placeholder: null,
    position: vec3(6, 8, 4),
    parentId: rootId,
    color: '#fff4d6',
  })
  const light: Hvs3DLight = {
    id: key,
    nodeId: keyNode.id,
    kind: 'DIRECTIONAL',
    color: '#fff1d0',
    intensity: 1.4,
    targetNodeId: carNodeId ?? characters[0]?.nodeId ?? null,
    angle: null,
    distance: null,
  }
  ops.push({ kind: 'ADD_LIGHT', light, node: keyNode })

  for (const shot of plan.shots) {
    const path = plan.paths.find(item => item.id === shot.pathId)
    let cinemaPath = path
    const shake = plan.shakeLayers.find(item => item.shotId === shot.id)
    if (cinemaPath && shake) {
      cinemaPath = applyShakeWindow(cinemaPath, {
        startSec: 0,
        durationSec: toSeconds(shake.duration),
        intensity: shake.intensity,
        frequency: shake.frequency,
      })
    }
    const camNode = makePlaceholderNode({
      type: 'CAMERA',
      name: shot.name,
      placeholder: null,
      position: cinemaPath?.points[0]?.position ?? vec3(0, 1.5, 6),
      parentId: rootId,
    })
    camNode.id = `cnode-cam-${shot.id}`
    const lookNodeId = shot.targetRef?.kind === 'PERSON'
      ? characters.find(item => item.id === shot.targetRef?.id)?.nodeId ?? 'cnode-person'
      : shot.targetRef?.kind === 'OBJECT' && shot.targetRef.id === 'CAR_1'
        ? (carNodeId ?? 'cnode-car')
        : characters[0]?.nodeId ?? null
    const camera: Hvs3DCamera = {
      id: `ccam-${shot.id}`,
      nodeId: camNode.id,
      name: shot.name,
      cameraSpecId: shot.cameraSpec.id,
      virtualCameraMode: cinemaFramingToVirtual(shot.framing),
      shotSize: cinemaSizeToSpec(shot.shotSize),
      angle: cinemaAngleToSpec(shot.cameraAngle),
      movement: motionPreset(shot),
      focalLength: shot.cameraSpec.focalLengthMm ?? 35,
      focusDistance: shot.focus.distance ?? 4,
      apertureIntent: shot.focus.dofIntent === 'SHALLOW' || shot.focus.dofIntent === 'EXTREME_SHALLOW' ? 'open' : shot.focus.dofIntent === 'DEEP' ? 'closed' : 'medium',
      sensorAspect: '16:9',
      target: lookNodeId
        ? { kind: 'NODE', nodeId: lookNodeId }
        : { kind: 'WORLD', point: cinemaPath?.points[0]?.target ?? vec3(0, 1.2, 0) },
      pathId: cinemaPath ? `c3dpath-${shot.id}` : null,
    }
    ops.push({ kind: 'ADD_CAMERA', camera, node: camNode })
    if (cinemaPath) {
      const motion: HvsMotionPath3D = {
        id: `c3dpath-${shot.id}`,
        name: `${shot.name} path`,
        kind: 'CAMERA',
        interpolation: cinemaPath.interpolation === 'EASE_IN_OUT' ? 'BEZIER' : cinemaPath.interpolation === 'LINEAR' ? 'LINEAR' : 'CATMULL_ROM',
        assignedNodeId: camNode.id,
        points: cinemaPath.points.map(item => ({
          time: fromSeconds(toSeconds(shot.start) + toSeconds(item.time), item.time.timescale),
          position: item.position,
          rotation: item.rotation,
          speed: null,
          easing: item.interpolation === 'LINEAR' ? 'LINEAR' : 'EASE_IN_OUT',
        })),
      }
      ops.push({ kind: 'CREATE_PATH', path: motion })
      const startF = cinemaPath.points[0]?.focalLength
      const endF = cinemaPath.points[cinemaPath.points.length - 1]?.focalLength
      if (typeof startF === 'number') {
        ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', toSeconds(shot.start), startF) })
      }
      if (typeof endF === 'number' && endF !== startF) {
        ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', toSeconds(shot.end), endF) })
      }
      const focus = plan.focusTransitions.find(item => item.shotId === shot.id)
      if (focus) {
        ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', toSeconds(focus.startTime) - toSeconds(shot.start), startF ?? camera.focalLength) })
      }
    }
    ops.push({
      kind: 'CREATE_SHOT',
      shot: {
        id: shot.id,
        name: shot.name,
        start: shot.start,
        end: shot.end,
        cameraId: camera.id,
        motionPreset: camera.movement,
        notes: shot.description,
        commanderLabel: shot.name,
      },
    })
  }

  ops.push({ kind: 'SET_DURATION', duration: plan.duration })
  return { scene, ops }
}

/**
 * Compile an approved scene plan into typed Hvs3DOps. Never called before BUILD SCENE.
 */
import { fromSeconds } from '../time'
import { makeKeyframe, makePlaceholderNode, type Hvs3DOp } from './ops'
import { orbitPoint } from './evaluate'
import {
  emptyScene,
  nid,
  vec3,
  type Hvs3DCamera,
  type Hvs3DCharacter,
  type Hvs3DIntent,
  type Hvs3DLight,
  type Hvs3DProp,
  type Hvs3DScene,
  type HvsMotionPath3D,
  type HvsScenePlan,
} from './types'

export function compileApprovedPlan(intent: Hvs3DIntent, plan: HvsScenePlan): { scene: Hvs3DScene; ops: Hvs3DOp[] } {
  const durationSec = Math.max(1, Number(plan.durationLabel.replace(/[^\d.]/g, '')) || 8)
  const scene = emptyScene(intent.projectId, plan.environmentLabel, durationSec)
  const rootId = scene.rootId
  const ops: Hvs3DOp[] = []

  const night = intent.timeOfDay !== 'day'
  ops.push({
    kind: 'SET_ENVIRONMENT',
    environment: {
      timeOfDay: intent.timeOfDay ?? 'night',
      sky: night ? 'night' : 'day',
      weatherIntent: /wet|rain/.test(intent.prompt.toLowerCase()) ? 'wet' : null,
      fog: night ? 0.12 : 0.04,
      ambientLight: night ? 0.16 : 0.42,
      ground: 'city-street',
      background: night ? '#05070c' : '#9ec9ef',
    },
  })

  const ground = makePlaceholderNode({
    type: 'ENVIRONMENT',
    name: 'Street',
    placeholder: 'plane',
    position: vec3(0, 0, 0),
    parentId: rootId,
    color: night ? '#141820' : '#3a3a3a',
    scale: vec3(28, 1, 36),
  })
  ops.push({ kind: 'ADD_OBJECT', node: ground })

  let carNodeId: string | null = null
  if (intent.props.some(item => item.kind === 'car')) {
    const car = makePlaceholderNode({
      type: 'PROP',
      name: 'Black sports car',
      placeholder: 'car',
      position: vec3(0, 0.45, 0),
      parentId: rootId,
      color: '#111111',
      scale: vec3(1.9, 0.7, 4.4),
    })
    carNodeId = car.id
    const prop: Hvs3DProp = {
      id: nid('prop'),
      nodeId: car.id,
      assetId: null,
      label: 'Black sports car',
      kind: 'car',
      transform: car.transform,
      placeholder: 'car',
    }
    ops.push({ kind: 'ADD_PROP', prop, node: car })
  }

  let personNodeId: string | null = null
  let characterId: string | null = null
  if (intent.subjects.some(item => item.kind === 'person')) {
    const person = makePlaceholderNode({
      type: 'CHARACTER',
      name: intent.subjects[0]?.label ?? 'Person',
      placeholder: 'person',
      position: vec3(1.7, 0, 0.35),
      parentId: rootId,
      color: '#c9a227',
      scale: vec3(0.5, 1.7, 0.4),
    })
    personNodeId = person.id
    const character: Hvs3DCharacter = {
      id: nid('char'),
      nodeId: person.id,
      assetId: null,
      label: person.name,
      transform: person.transform,
      pose: null,
      rigRef: null,
      motionPathId: null,
      state: 'PLACEHOLDER',
      motionHonesty: 'POSITIONAL_MOTION',
    }
    characterId = character.id
    ops.push({ kind: 'ADD_CHARACTER', character, node: person })
  }

  if (intent.props.some(item => item.kind === 'building')) {
    const building = makePlaceholderNode({
      type: 'PROP',
      name: 'Doorway block',
      placeholder: 'building',
      position: vec3(0.4, 4, -14),
      parentId: rootId,
      color: '#243044',
      scale: vec3(8, 8, 2.2),
    })
    ops.push({
      kind: 'ADD_PROP',
      prop: {
        id: nid('prop'),
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

  if (personNodeId && intent.subjectMotion) {
    const walk: HvsMotionPath3D = {
      id: nid('path'),
      name: 'Walk to doorway',
      kind: 'SUBJECT',
      interpolation: 'CATMULL_ROM',
      assignedNodeId: personNodeId,
      points: [
        { time: fromSeconds(0), position: vec3(1.7, 0, 0.35), rotation: null, speed: null, easing: 'LINEAR' },
        { time: fromSeconds(durationSec * 0.55), position: vec3(1.1, 0, -6.2), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
        { time: fromSeconds(durationSec), position: vec3(0.6, 0, -12.2), rotation: null, speed: null, easing: 'EASE_OUT' },
      ],
    }
    ops.push({ kind: 'CREATE_PATH', path: walk })
    ops.push({ kind: 'ASSIGN_PATH', pathId: walk.id, nodeId: personNodeId })
  }

  const camNode = makePlaceholderNode({
    type: 'CAMERA',
    name: 'Shot camera',
    placeholder: null,
    position: vec3(0, 0.42, 5.2),
    parentId: rootId,
  })
  const camera: Hvs3DCamera = {
    id: nid('cam'),
    nodeId: camNode.id,
    name: 'Director camera',
    cameraSpecId: null,
    virtualCameraMode: intent.framingIntent ?? 'CINEMATIC_FOLLOW',
    shotSize: 'WS',
    angle: 'low',
    movement: 'CUSTOM_PATH',
    focalLength: 35,
    focusDistance: 4,
    apertureIntent: 'open',
    sensorAspect: '16:9',
    target: characterId ? { kind: 'CHARACTER', characterId } : personNodeId ? { kind: 'NODE', nodeId: personNodeId } : carNodeId ? { kind: 'NODE', nodeId: carNodeId } : { kind: 'WORLD', point: vec3(0, 1, 0) },
    pathId: null,
  }
  ops.push({ kind: 'ADD_CAMERA', camera, node: camNode })

  const personStart = vec3(1.7, 1.1, 0.35)
  const camPath: HvsMotionPath3D = {
    id: nid('path'),
    name: 'Camera path',
    kind: 'CAMERA',
    interpolation: 'CATMULL_ROM',
    assignedNodeId: camNode.id,
    points: [
      { time: fromSeconds(0), position: vec3(0.15, 0.38, 5.4), rotation: null, speed: null, easing: 'LINEAR' },
      { time: fromSeconds(3), position: vec3(1.2, 0.55, 3.2), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
      { time: fromSeconds(4.5), position: orbitPoint(personStart, 4.6, Math.PI * 0.55, 1.15), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
      { time: fromSeconds(6), position: orbitPoint(personStart, 4.2, Math.PI * 1.05, 1.25), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
      { time: fromSeconds(8), position: vec3(1.55, 1.52, -10.1), rotation: null, speed: null, easing: 'EASE_IN_OUT' },
    ],
  }
  ops.push({ kind: 'CREATE_PATH', path: camPath })
  ops.push({ kind: 'SET_CAMERA_PATH', cameraId: camera.id, pathId: camPath.id })
  ops.push({ kind: 'AIM_CAMERA', cameraId: camera.id, target: camera.target! })

  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', 0, 28) })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', 6, 35) })
  ops.push({ kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', 8, 65) })

  const key = (name: string, kind: Hvs3DLight['kind'], pos: ReturnType<typeof vec3>, intensity: number, color: string): Hvs3DOp => {
    const node = makePlaceholderNode({ type: 'LIGHT', name, placeholder: null, position: pos, parentId: rootId })
    const light: Hvs3DLight = {
      id: nid('light'),
      nodeId: node.id,
      kind,
      color,
      intensity,
      targetNodeId: personNodeId,
      angle: kind === 'SPOT' ? 0.55 : null,
      distance: kind === 'POINT' ? 18 : null,
    }
    return { kind: 'ADD_LIGHT', light, node }
  }
  ops.push(key('Ambient', 'AMBIENT', vec3(0, 6, 0), night ? 0.22 : 0.5, night ? '#1a2a44' : '#e8f0ff'))
  ops.push(key('Moon key', 'DIRECTIONAL', vec3(-6, 9, 4), night ? 1.15 : 1.6, night ? '#8fb4ff' : '#fff4d2'))
  ops.push(key('Street side', 'SPOT', vec3(4.5, 3.2, 1.5), 1.4, '#ffd19a'))
  ops.push(key('Car rim', 'POINT', vec3(-1.4, 0.8, 1.1), 0.8, '#66d6ff'))

  const reveal = plan.shots.find(item => /reveal/i.test(item.label))
  const orbit = plan.shots.find(item => /orbit/i.test(item.label))
  const close = plan.shots.find(item => /close/i.test(item.label))
  const mkShot = (id: string, name: string, start: number, end: number, preset: Hvs3DCamera['movement'], notes: string, commanderLabel: string): Hvs3DOp => ({
    kind: 'CREATE_SHOT',
    shot: {
      id,
      name,
      start: fromSeconds(start),
      end: fromSeconds(end),
      cameraId: camera.id,
      motionPreset: preset,
      notes,
      commanderLabel,
    },
  })
  if (reveal) ops.push(mkShot(reveal.id, 'Low car reveal', 0, 3, 'REVEAL', 'Low rear camera behind the car.', 'Low car reveal — 3 sec'))
  if (orbit) ops.push(mkShot(orbit.id, 'Character orbit', 3, 6, 'ORBIT', 'Orbit around the walking character while remaining aimed at them.', 'Character orbit — 3 sec'))
  if (close) ops.push(mkShot(close.id, 'Close-up', 6, 8, 'PUSH_IN', 'Push in. PLACEHOLDER character — positional motion only.', 'Close-up — 2 sec'))
  if (!reveal && !orbit && !close) {
    ops.push(mkShot('shot-hold', 'Scene hold', 0, durationSec, 'STATIC', 'Directed hold.', `${durationSec} sec`))
  }

  return { scene, ops }
}

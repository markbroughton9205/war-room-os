/**
 * Typed HVS 3D operations. AI and UI both emit these. No raw JSON mutation.
 */
import { fromSeconds, toSeconds, type MediaTime } from '../time'
import {
  cloneScene,
  findNode,
  identityTransform3D,
  nid,
  vec3,
  type Hvs3DCamera,
  type Hvs3DCharacter,
  type Hvs3DKeyframe,
  type Hvs3DKeyframeProperty,
  type Hvs3DLight,
  type Hvs3DProp,
  type Hvs3DScene,
  type Hvs3DShot,
  type HvsCameraMotionPreset,
  type HvsCameraTarget,
  type HvsKeyframeInterpolation,
  type HvsLightKind,
  type HvsMotionPath3D,
  type HvsPathInterpolation,
  type HvsPlaceholderKind,
  type HvsSceneNode,
  type HvsSceneNodeType,
  type HvsTransform3D,
  type Vec3,
} from './types'

export type Hvs3DOp =
  | { kind: 'ADD_OBJECT'; node: HvsSceneNode }
  | { kind: 'REMOVE_OBJECT'; nodeId: string }
  | { kind: 'MOVE_OBJECT'; nodeId: string; position: Vec3 }
  | { kind: 'ROTATE_OBJECT'; nodeId: string; rotation: Vec3 }
  | { kind: 'SCALE_OBJECT'; nodeId: string; scale: Vec3 }
  | { kind: 'ADD_CHARACTER'; character: Hvs3DCharacter; node: HvsSceneNode }
  | { kind: 'MOVE_CHARACTER'; characterId: string; position: Vec3 }
  | { kind: 'SET_CHARACTER_POSE'; characterId: string; pose: string }
  | { kind: 'CREATE_PATH'; path: HvsMotionPath3D }
  | { kind: 'EDIT_PATH'; pathId: string; path: Partial<HvsMotionPath3D> }
  | { kind: 'ASSIGN_PATH'; pathId: string; nodeId: string }
  | { kind: 'ADD_CAMERA'; camera: Hvs3DCamera; node: HvsSceneNode }
  | { kind: 'MOVE_CAMERA'; cameraId: string; position: Vec3 }
  | { kind: 'AIM_CAMERA'; cameraId: string; target: HvsCameraTarget }
  | { kind: 'SET_FOCAL_LENGTH'; cameraId: string; focalLength: number }
  | { kind: 'SET_CAMERA_PATH'; cameraId: string; pathId: string }
  | { kind: 'ADD_LIGHT'; light: Hvs3DLight; node: HvsSceneNode }
  | { kind: 'MOVE_LIGHT'; lightId: string; position: Vec3 }
  | { kind: 'SET_LIGHT'; lightId: string; intensity?: number; color?: string }
  | { kind: 'SET_ENVIRONMENT'; environment: Partial<Hvs3DScene['environment']> }
  | { kind: 'ADD_KEYFRAME'; keyframe: Hvs3DKeyframe }
  | { kind: 'MOVE_KEYFRAME'; keyframeId: string; time: MediaTime }
  | { kind: 'REMOVE_KEYFRAME'; keyframeId: string }
  | { kind: 'CREATE_SHOT'; shot: Hvs3DShot }
  | { kind: 'UPDATE_SHOT'; shotId: string; patch: Partial<Hvs3DShot> }
  | { kind: 'REORDER_SHOT'; shotIds: string[] }
  | { kind: 'SET_DURATION'; duration: MediaTime }
  | { kind: 'ADD_PROP'; prop: Hvs3DProp; node: HvsSceneNode }

export const HVS_3D_OP_KINDS: Array<Hvs3DOp['kind']> = [
  'ADD_OBJECT', 'REMOVE_OBJECT', 'MOVE_OBJECT', 'ROTATE_OBJECT', 'SCALE_OBJECT',
  'ADD_CHARACTER', 'MOVE_CHARACTER', 'SET_CHARACTER_POSE',
  'CREATE_PATH', 'EDIT_PATH', 'ASSIGN_PATH',
  'ADD_CAMERA', 'MOVE_CAMERA', 'AIM_CAMERA', 'SET_FOCAL_LENGTH', 'SET_CAMERA_PATH',
  'ADD_LIGHT', 'MOVE_LIGHT', 'SET_LIGHT', 'SET_ENVIRONMENT',
  'ADD_KEYFRAME', 'MOVE_KEYFRAME', 'REMOVE_KEYFRAME',
  'CREATE_SHOT', 'UPDATE_SHOT', 'REORDER_SHOT', 'SET_DURATION', 'ADD_PROP',
]

function touch(scene: Hvs3DScene): Hvs3DScene {
  scene.updatedAt = new Date().toISOString()
  scene.version += 1
  return scene
}

function requireNode(scene: Hvs3DScene, nodeId: string): HvsSceneNode {
  const node = findNode(scene, nodeId)
  if (!node) throw new Error(`Unknown 3D node ${nodeId}`)
  return node
}

export function apply3DOp(scene: Hvs3DScene, op: Hvs3DOp): Hvs3DScene {
  const next = cloneScene(scene)
  switch (op.kind) {
    case 'ADD_OBJECT':
    case 'ADD_CHARACTER':
    case 'ADD_CAMERA':
    case 'ADD_LIGHT':
    case 'ADD_PROP': {
      const node = 'node' in op ? op.node : null
      if (node && !next.objects.some(item => item.id === node.id)) next.objects.push(node)
      if (op.kind === 'ADD_CHARACTER') next.characters.push(op.character)
      if (op.kind === 'ADD_PROP') next.props.push(op.prop)
      if (op.kind === 'ADD_CAMERA') next.cameras.push(op.camera)
      if (op.kind === 'ADD_LIGHT') next.lights.push(op.light)
      return touch(next)
    }
    case 'REMOVE_OBJECT':
      next.objects = next.objects.filter(item => item.id !== op.nodeId)
      next.characters = next.characters.filter(item => item.nodeId !== op.nodeId)
      next.props = next.props.filter(item => item.nodeId !== op.nodeId)
      next.cameras = next.cameras.filter(item => item.nodeId !== op.nodeId)
      next.lights = next.lights.filter(item => item.nodeId !== op.nodeId)
      return touch(next)
    case 'MOVE_OBJECT':
      requireNode(next, op.nodeId).transform.position = { ...op.position }
      return touch(next)
    case 'ROTATE_OBJECT':
      requireNode(next, op.nodeId).transform.rotation = { ...op.rotation }
      return touch(next)
    case 'SCALE_OBJECT':
      requireNode(next, op.nodeId).transform.scale = { ...op.scale }
      return touch(next)
    case 'MOVE_CHARACTER': {
      const character = next.characters.find(item => item.id === op.characterId)
      if (!character) throw new Error(`Unknown character ${op.characterId}`)
      character.transform.position = { ...op.position }
      requireNode(next, character.nodeId).transform.position = { ...op.position }
      return touch(next)
    }
    case 'SET_CHARACTER_POSE': {
      const character = next.characters.find(item => item.id === op.characterId)
      if (!character) throw new Error(`Unknown character ${op.characterId}`)
      character.pose = op.pose
      return touch(next)
    }
    case 'CREATE_PATH':
      next.paths.push(op.path)
      return touch(next)
    case 'EDIT_PATH': {
      const path = next.paths.find(item => item.id === op.pathId)
      if (!path) throw new Error(`Unknown path ${op.pathId}`)
      Object.assign(path, op.path)
      return touch(next)
    }
    case 'ASSIGN_PATH': {
      const path = next.paths.find(item => item.id === op.pathId)
      if (!path) throw new Error(`Unknown path ${op.pathId}`)
      path.assignedNodeId = op.nodeId
      const character = next.characters.find(item => item.nodeId === op.nodeId)
      if (character) character.motionPathId = op.pathId
      const camera = next.cameras.find(item => item.nodeId === op.nodeId)
      if (camera) camera.pathId = op.pathId
      return touch(next)
    }
    case 'MOVE_CAMERA': {
      const camera = next.cameras.find(item => item.id === op.cameraId)
      if (!camera) throw new Error(`Unknown camera ${op.cameraId}`)
      requireNode(next, camera.nodeId).transform.position = { ...op.position }
      return touch(next)
    }
    case 'AIM_CAMERA': {
      const camera = next.cameras.find(item => item.id === op.cameraId)
      if (!camera) throw new Error(`Unknown camera ${op.cameraId}`)
      camera.target = op.target
      return touch(next)
    }
    case 'SET_FOCAL_LENGTH': {
      const camera = next.cameras.find(item => item.id === op.cameraId)
      if (!camera) throw new Error(`Unknown camera ${op.cameraId}`)
      camera.focalLength = op.focalLength
      return touch(next)
    }
    case 'SET_CAMERA_PATH': {
      const camera = next.cameras.find(item => item.id === op.cameraId)
      if (!camera) throw new Error(`Unknown camera ${op.cameraId}`)
      camera.pathId = op.pathId
      return touch(next)
    }
    case 'MOVE_LIGHT': {
      const light = next.lights.find(item => item.id === op.lightId)
      if (!light) throw new Error(`Unknown light ${op.lightId}`)
      requireNode(next, light.nodeId).transform.position = { ...op.position }
      return touch(next)
    }
    case 'SET_LIGHT': {
      const light = next.lights.find(item => item.id === op.lightId)
      if (!light) throw new Error(`Unknown light ${op.lightId}`)
      if (op.intensity != null) light.intensity = op.intensity
      if (op.color) light.color = op.color
      return touch(next)
    }
    case 'SET_ENVIRONMENT':
      next.environment = { ...next.environment, ...op.environment }
      return touch(next)
    case 'ADD_KEYFRAME':
      next.keyframes.push(op.keyframe)
      return touch(next)
    case 'MOVE_KEYFRAME': {
      const kf = next.keyframes.find(item => item.id === op.keyframeId)
      if (!kf) throw new Error(`Unknown keyframe ${op.keyframeId}`)
      kf.time = op.time
      return touch(next)
    }
    case 'REMOVE_KEYFRAME':
      next.keyframes = next.keyframes.filter(item => item.id !== op.keyframeId)
      return touch(next)
    case 'CREATE_SHOT':
      next.shots.push(op.shot)
      return touch(next)
    case 'UPDATE_SHOT': {
      const shot = next.shots.find(item => item.id === op.shotId)
      if (!shot) throw new Error(`Unknown shot ${op.shotId}`)
      Object.assign(shot, op.patch)
      return touch(next)
    }
    case 'REORDER_SHOT': {
      const byId = new Map(next.shots.map(shot => [shot.id, shot]))
      const ordered = op.shotIds.map(id => byId.get(id)).filter((item): item is Hvs3DShot => Boolean(item))
      if (ordered.length !== next.shots.length) throw new Error('REORDER_SHOT must include every shot.')
      let cursor = 0
      next.shots = ordered.map(shot => {
        const dur = toSeconds(shot.end) - toSeconds(shot.start)
        const start = fromSeconds(cursor, shot.start.timescale)
        const end = fromSeconds(cursor + dur, shot.end.timescale)
        cursor += dur
        return { ...shot, start, end }
      })
      next.duration = fromSeconds(cursor, next.duration.timescale)
      next.timeline.duration = next.duration
      return touch(next)
    }
    case 'SET_DURATION':
      next.duration = op.duration
      next.timeline.duration = op.duration
      return touch(next)
    default:
      throw new Error(`Unsupported 3D op ${(op as Hvs3DOp).kind}`)
  }
}

export function apply3DOps(scene: Hvs3DScene, ops: Hvs3DOp[]): Hvs3DScene {
  return ops.reduce((acc, op) => apply3DOp(acc, op), scene)
}

export function makePlaceholderNode(input: {
  type: HvsSceneNodeType
  name: string
  placeholder: HvsPlaceholderKind | null
  position: Vec3
  parentId: string
  color?: string | null
  scale?: Vec3
  id?: string
}): HvsSceneNode {
  return {
    id: input.id ?? nid('node'),
    type: input.type,
    name: input.name,
    parentId: input.parentId,
    transform: { ...identityTransform3D(), position: { ...input.position }, scale: input.scale ? { ...input.scale } : { x: 1, y: 1, z: 1 } },
    visible: true,
    placeholder: input.placeholder,
    assetId: null,
    bounds: { min: vec3(-0.5, 0, -0.5), max: vec3(0.5, 1.8, 0.5) },
    color: input.color ?? null,
    label: input.placeholder ? `${input.name} · PLACEHOLDER` : input.name,
  }
}

export function makeKeyframe(
  targetNodeId: string,
  property: Hvs3DKeyframeProperty,
  timeSec: number,
  value: number | Vec3,
  interpolation: HvsKeyframeInterpolation = 'EASE_IN_OUT',
): Hvs3DKeyframe {
  return {
    id: nid('kf'),
    targetNodeId,
    property,
    time: fromSeconds(timeSec),
    value,
    interpolation,
  }
}

export type { HvsCameraMotionPreset, HvsLightKind, HvsPathInterpolation }

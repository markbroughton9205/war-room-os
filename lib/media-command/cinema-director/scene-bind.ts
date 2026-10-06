/**
 * Bind existing Cinema Director shots onto an existing 3D Director scene.
 * CameraSpec stays canonical. 3D cameras/paths/shots are derived execution.
 * Reuses the existing scene graph. Not a second timeline.
 */
import { fromSeconds, toSeconds, type MediaTime } from '../time'
import { apply3DOp, makeKeyframe, makePlaceholderNode } from '../director3d/ops'
import { samplePath } from '../director3d/evaluate'
import {
  vec3,
  type Hvs3DCamera,
  type Hvs3DScene,
  type HvsMotionPath3D,
  type Vec3,
} from '../director3d/types'
import { relativePoint } from './path'
import { cinemaAngleToSpec, cinemaFramingToVirtual, cinemaSizeToSpec } from './spec'
import type { HvsCinemaPlan, HvsShot } from './types'

export const CINEMA_SCENE_CAMERA_PREFIX = 'ccam-'
export const CINEMA_SCENE_NODE_PREFIX = 'cnode-cam-'
export const CINEMA_SCENE_PATH_PREFIX = 'c3dpath-'

function motionPreset(shot: HvsShot): Hvs3DCamera['movement'] {
  if (shot.cameraMovement === 'ORBIT' || shot.cameraMovement === 'ARC') return 'ORBIT'
  if (shot.cameraMovement === 'DOLLY_IN' || shot.cameraMovement === 'REVEAL') return 'PUSH_IN'
  if (shot.cameraMovement === 'DOLLY_OUT') return 'PULL_OUT'
  if (shot.cameraMovement === 'CRANE' || shot.cameraMovement === 'JIB') return 'CRANE'
  if (shot.cameraMovement === 'PAN' || shot.cameraMovement === 'WHIP_PAN') return 'PAN'
  if (shot.cameraMovement === 'TILT') return 'TILT'
  if (shot.cameraMovement === 'HANDHELD') return 'HANDHELD_STYLE'
  if (shot.cameraMovement === 'FOLLOW' || shot.cameraMovement === 'STEADICAM_STYLE' || shot.cameraMovement === 'CHASE') return 'CUSTOM_PATH'
  if (shot.cameraMovement === 'STATIC') return 'STATIC'
  return 'CUSTOM_PATH'
}

function subjectNodeId(scene: Hvs3DScene, shot: HvsShot): string | null {
  const wanted = shot.targetRef?.kind === 'PERSON' ? shot.targetRef.id : shot.characterIds?.[0] ?? null
  const character = scene.characters.find(item =>
    item.digitalHumanId === wanted
    || item.identityRef === wanted
    || item.id === wanted,
  ) ?? scene.characters[0]
  return character?.nodeId ?? null
}

function blockingAt(scene: Hvs3DScene, nodeId: string, time: MediaTime): Vec3 {
  const path = scene.paths.find(item => item.assignedNodeId === nodeId && item.kind === 'SUBJECT')
  const sampled = path ? samplePath(path, time) : null
  if (sampled) return sampled
  const node = scene.objects.find(item => item.id === nodeId)
  return node?.transform.position ?? vec3(0, 0, 0)
}

function facingAt(scene: Hvs3DScene, nodeId: string, time: MediaTime): Vec3 {
  const path = scene.paths.find(item => item.assignedNodeId === nodeId && item.kind === 'SUBJECT')
  if (!path || path.points.length < 2) return vec3(0, 0, -1)
  const now = blockingAt(scene, nodeId, time)
  const later = blockingAt(scene, nodeId, fromSeconds(Math.min(toSeconds(time) + 0.5, toSeconds(path.points[path.points.length - 1].time)), time.timescale))
  const dx = later.x - now.x
  const dz = later.z - now.z
  const len = Math.hypot(dx, dz)
  if (len < 0.05) return vec3(0, 0, -1)
  return vec3(dx / len, 0, dz / len)
}

function compiledCameraPosition(shot: HvsShot, subject: Vec3, facing: Vec3, end: boolean): Vec3 {
  const close = shot.shotSize === 'CLOSE_UP' || shot.shotSize === 'EXTREME_CLOSE_UP' || shot.shotSize === 'MEDIUM_CLOSE'
  const follow = shot.cameraMovement === 'FOLLOW' || shot.cameraMovement === 'STEADICAM_STYLE' || shot.cameraMovement === 'CHASE'
  const dollyIn = shot.cameraMovement === 'DOLLY_IN' || shot.cameraMovement === 'REVEAL'
  const height = close ? 1.52 : follow ? 1.55 : 1.82
  const startDist = close ? 2.55 : follow ? 4.35 : 6.6
  const endDist = dollyIn ? 1.72 : startDist
  const dist = end ? endDist : startDist
  const placement = close ? 'IN_FRONT_OF' : follow ? 'BEHIND' : shot.name.toLowerCase().includes('look') ? 'LEFT_OF' : 'BEHIND'
  return relativePoint(subject, facing, placement, dist, height)
}

export function cinemaCamerasAlreadyBound(scene: Hvs3DScene, plan: HvsCinemaPlan): boolean {
  return plan.shots.every(shot =>
    scene.cameras.some(item => item.id === `${CINEMA_SCENE_CAMERA_PREFIX}${shot.id}` && item.cameraSpecId === shot.cameraSpec.id)
    && scene.shots.some(item => item.id === shot.id),
  )
}

/** Derived 3D cameras for existing Cinema shots. Idempotent. Does not clone shots. */
export function bindCinemaPlanCameras(scene: Hvs3DScene, plan: HvsCinemaPlan): Hvs3DScene {
  if (!plan.shots.length) return scene
  if (cinemaCamerasAlreadyBound(scene, plan)) return scene
  let next = scene
  if (!next.lights.length) {
    const ambientNode = makePlaceholderNode({
      type: 'LIGHT',
      name: 'Cinema ambient',
      placeholder: null,
      position: vec3(0, 6, 0),
      parentId: next.rootId,
      color: '#1a2a44',
      id: 'cnode-light-ambient',
    })
    next = apply3DOp(next, {
      kind: 'ADD_LIGHT',
      light: { id: 'clight-ambient', nodeId: ambientNode.id, kind: 'AMBIENT', color: '#24344c', intensity: 0.42, targetNodeId: null, angle: null, distance: null },
      node: ambientNode,
    })
    const keyNode = makePlaceholderNode({
      type: 'LIGHT',
      name: 'Cinema key',
      placeholder: null,
      position: vec3(5, 7, 4),
      parentId: next.rootId,
      color: '#ffd19a',
      id: 'cnode-light-key',
    })
    next = apply3DOp(next, {
      kind: 'ADD_LIGHT',
      light: { id: 'clight-key', nodeId: keyNode.id, kind: 'DIRECTIONAL', color: '#ffd19a', intensity: 1.15, targetNodeId: next.characters[0]?.nodeId ?? null, angle: null, distance: null },
      node: keyNode,
    })
  }
  for (const shot of plan.shots) {
    const cameraId = `${CINEMA_SCENE_CAMERA_PREFIX}${shot.id}`
    if (next.cameras.some(item => item.id === cameraId)) continue
    const cinemaPath = plan.paths.find(item => item.id === shot.pathId || item.shotId === shot.id)
    const lookNodeId = subjectNodeId(next, shot)
    const startSubject = lookNodeId ? blockingAt(next, lookNodeId, shot.start) : vec3(0, 0, 0)
    const endSubject = lookNodeId ? blockingAt(next, lookNodeId, shot.end) : startSubject
    const startFacing = lookNodeId ? facingAt(next, lookNodeId, shot.start) : vec3(0, 0, -1)
    const endFacing = lookNodeId ? facingAt(next, lookNodeId, shot.end) : startFacing
    const startPos = compiledCameraPosition(shot, startSubject, startFacing, false)
    const endPos = compiledCameraPosition(shot, endSubject, endFacing, true)
    const camNode = makePlaceholderNode({
      type: 'CAMERA',
      name: shot.name,
      placeholder: null,
      position: startPos,
      parentId: next.rootId,
      id: `${CINEMA_SCENE_NODE_PREFIX}${shot.id}`,
    })
    const camera: Hvs3DCamera = {
      id: cameraId,
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
      target: lookNodeId ? { kind: 'NODE', nodeId: lookNodeId } : { kind: 'WORLD', point: startSubject },
      pathId: `${CINEMA_SCENE_PATH_PREFIX}${shot.id}`,
    }
    next = apply3DOp(next, { kind: 'ADD_CAMERA', camera, node: camNode })
    const motion: HvsMotionPath3D = {
      id: camera.pathId!,
      name: `${shot.name} path`,
      kind: 'CAMERA',
      interpolation: cinemaPath?.interpolation === 'LINEAR' ? 'LINEAR' : 'BEZIER',
      assignedNodeId: camNode.id,
      points: [
        {
          time: shot.start,
          position: startPos,
          rotation: null,
          speed: null,
          easing: 'LINEAR',
        },
        {
          time: shot.end,
          position: shot.cameraMovement === 'STATIC' ? startPos : endPos,
          rotation: null,
          speed: null,
          easing: shot.cameraMovement === 'DOLLY_IN' ? 'EASE_IN_OUT' : 'LINEAR',
        },
      ],
    }
    next = apply3DOp(next, { kind: 'CREATE_PATH', path: motion })
    const startF = cinemaPath?.points[0]?.focalLength ?? camera.focalLength
    const endF = cinemaPath?.points[cinemaPath.points.length - 1]?.focalLength ?? (shot.cameraMovement === 'DOLLY_IN' ? camera.focalLength : startF)
    next = apply3DOp(next, { kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', toSeconds(shot.start), startF) })
    if (endF !== startF) {
      next = apply3DOp(next, { kind: 'ADD_KEYFRAME', keyframe: makeKeyframe(camNode.id, 'focalLength', toSeconds(shot.end), endF) })
    }
    if (!next.shots.some(item => item.id === shot.id)) {
      next = apply3DOp(next, {
        kind: 'CREATE_SHOT',
        shot: {
          id: shot.id,
          name: shot.name,
          start: shot.start,
          end: shot.end,
          cameraId,
          motionPreset: camera.movement,
          notes: shot.description,
          commanderLabel: shot.name,
        },
      })
    }
  }
  return next
}

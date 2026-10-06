import { toSeconds, type MediaTime } from '../time'
import type {
  Hvs3DScene,
  HvsKeyframeInterpolation,
  HvsMotionPath3D,
  HvsTransform3D,
  Vec3,
} from './types'
import { identityTransform3D, vec3 } from './types'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }
}

function ease(kind: HvsKeyframeInterpolation, t: number): number {
  const x = Math.min(1, Math.max(0, t))
  if (kind === 'EASE_IN') return x * x
  if (kind === 'EASE_OUT') return 1 - (1 - x) * (1 - x)
  if (kind === 'EASE_IN_OUT' || kind === 'SPLINE') return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
  return x
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) }
}

export function samplePath(path: HvsMotionPath3D, time: MediaTime): Vec3 | null {
  if (!path.points.length) return null
  const t = toSeconds(time)
  const pts = [...path.points].sort((a, b) => toSeconds(a.time) - toSeconds(b.time))
  if (t <= toSeconds(pts[0].time)) return { ...pts[0].position }
  if (t >= toSeconds(pts[pts.length - 1].time)) return { ...pts[pts.length - 1].position }
  let i = 0
  while (i < pts.length - 1 && toSeconds(pts[i + 1].time) < t) i += 1
  const a = pts[i]
  const b = pts[i + 1]
  const span = Math.max(1e-6, toSeconds(b.time) - toSeconds(a.time))
  const u = ease(b.easing || a.easing || 'LINEAR', (t - toSeconds(a.time)) / span)
  if ((path.interpolation === 'CATMULL_ROM' || path.interpolation === 'BEZIER') && pts.length >= 2) {
    const p0 = pts[Math.max(0, i - 1)].position
    const p1 = a.position
    const p2 = b.position
    const p3 = pts[Math.min(pts.length - 1, i + 2)].position
    return catmull(p0, p1, p2, p3, u)
  }
  return lerpVec(a.position, b.position, u)
}

function sampleScalarKeyframes(scene: Hvs3DScene, nodeId: string, property: 'focalLength' | 'lightIntensity', time: MediaTime, fallback: number): number {
  const keys = scene.keyframes
    .filter(item => item.targetNodeId === nodeId && item.property === property && typeof item.value === 'number')
    .sort((a, b) => toSeconds(a.time) - toSeconds(b.time))
  if (!keys.length) return fallback
  const t = toSeconds(time)
  if (t <= toSeconds(keys[0].time)) return keys[0].value as number
  if (t >= toSeconds(keys[keys.length - 1].time)) return keys[keys.length - 1].value as number
  let i = 0
  while (i < keys.length - 1 && toSeconds(keys[i + 1].time) < t) i += 1
  const a = keys[i]
  const b = keys[i + 1]
  const span = Math.max(1e-6, toSeconds(b.time) - toSeconds(a.time))
  const u = ease(b.interpolation, (t - toSeconds(a.time)) / span)
  return lerp(a.value as number, b.value as number, u)
}

function sampleKeyframes(scene: Hvs3DScene, nodeId: string, property: 'position' | 'rotation' | 'scale', time: MediaTime, fallback: Vec3): Vec3 {
  const keys = scene.keyframes
    .filter(item => item.targetNodeId === nodeId && item.property === property && typeof item.value === 'object')
    .sort((a, b) => toSeconds(a.time) - toSeconds(b.time))
  if (!keys.length) return fallback
  const t = toSeconds(time)
  if (t <= toSeconds(keys[0].time)) return { ...(keys[0].value as Vec3) }
  if (t >= toSeconds(keys[keys.length - 1].time)) return { ...(keys[keys.length - 1].value as Vec3) }
  let i = 0
  while (i < keys.length - 1 && toSeconds(keys[i + 1].time) < t) i += 1
  const a = keys[i]
  const b = keys[i + 1]
  const span = Math.max(1e-6, toSeconds(b.time) - toSeconds(a.time))
  const u = ease(b.interpolation, (t - toSeconds(a.time)) / span)
  return lerpVec(a.value as Vec3, b.value as Vec3, u)
}

export type EvaluatedNode = {
  id: string
  transform: HvsTransform3D
  lookAt: Vec3 | null
}

export function lookAtRotation(from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const yaw = Math.atan2(dx, -dz)
  const pitch = Math.atan2(dy, Math.hypot(dx, dz))
  return { x: pitch, y: yaw, z: 0 }
}

export function resolveTargetPoint(scene: Hvs3DScene, time: MediaTime, cameraId: string): Vec3 | null {
  const camera = scene.cameras.find(item => item.id === cameraId)
  const target = camera?.target
  if (!camera || !target) return null
  if (target.kind === 'WORLD') return { ...target.point }
  const nodeId = target.kind === 'NODE'
    ? target.nodeId
    : scene.characters.find(item => item.id === target.characterId)?.nodeId
  if (!nodeId) return null
  const evaluated = evaluateNode(scene, nodeId, time)
  const framing = camera.virtualCameraMode
  const lift = framing === 'FACE_LOCK' || framing === 'UPPER_BODY' ? 1.55 : framing === 'FULL_BODY' ? 0.9 : 1.1
  return { x: evaluated.transform.position.x, y: evaluated.transform.position.y + lift, z: evaluated.transform.position.z }
}

export function evaluateNode(scene: Hvs3DScene, nodeId: string, time: MediaTime): EvaluatedNode {
  const node = scene.objects.find(item => item.id === nodeId)
  const base = node?.transform ?? identityTransform3D()
  const path = scene.paths.find(item => item.assignedNodeId === nodeId)
  const pathPos = path ? samplePath(path, time) : null
  let position = pathPos ?? sampleKeyframes(scene, nodeId, 'position', time, base.position)
  const camera = scene.cameras.find(item => item.nodeId === nodeId)
  if (camera?.target && pathPos && camera.movement === 'FOLLOW') {
    const startLook = resolveTargetPoint(scene, { ticks: 0, timescale: time.timescale }, camera.id)
    const nowLook = resolveTargetPoint(scene, time, camera.id)
    if (startLook && nowLook) {
      position = {
        x: pathPos.x + (nowLook.x - startLook.x),
        y: pathPos.y,
        z: pathPos.z + (nowLook.z - startLook.z),
      }
    }
  }
  const rotation = sampleKeyframes(scene, nodeId, 'rotation', time, base.rotation)
  const scale = sampleKeyframes(scene, nodeId, 'scale', time, base.scale)
  return { id: nodeId, transform: { position, rotation, scale }, lookAt: null }
}

export function evaluateScene(scene: Hvs3DScene, time: MediaTime): {
  nodes: Record<string, EvaluatedNode>
  activeShotId: string | null
  activeCameraId: string | null
  focalLength: number
} {
  const t = toSeconds(time)
  const shot = scene.shots.find(item => t >= toSeconds(item.start) && t < toSeconds(item.end))
    ?? scene.shots[scene.shots.length - 1]
    ?? null
  const nodes: Record<string, EvaluatedNode> = {}
  for (const node of scene.objects) {
    nodes[node.id] = evaluateNode(scene, node.id, time)
  }
  const camera = shot ? scene.cameras.find(item => item.id === shot.cameraId) : scene.cameras[0]
  if (camera) {
    const look = resolveTargetPoint(scene, time, camera.id)
    if (look) {
      const camNode = nodes[camera.nodeId]
      camNode.lookAt = look
      camNode.transform.rotation = lookAtRotation(camNode.transform.position, look)
    }
  }
  const focalLength = camera
    ? sampleScalarKeyframes(scene, camera.nodeId, 'focalLength', time, camera.focalLength)
    : 35
  return { nodes, activeShotId: shot?.id ?? null, activeCameraId: camera?.id ?? null, focalLength }
}

export function hashScene(scene: Hvs3DScene): string {
  const payload = JSON.stringify({
    id: scene.id,
    version: scene.version,
    shots: scene.shots.map(item => item.id),
    nodes: scene.objects.map(item => [item.id, item.transform]),
    paths: scene.paths.map(item => [item.id, item.points.length]),
  })
  let h = 2166136261
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function orbitPoint(center: Vec3, radius: number, yaw: number, height: number): Vec3 {
  return vec3(center.x + Math.sin(yaw) * radius, height, center.z + Math.cos(yaw) * radius)
}

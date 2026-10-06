import { fromSeconds, toSeconds } from '../time'
import { vec3, type Vec3 } from '../director3d/types'
import { orbitPoint } from '../director3d/evaluate'
import type {
  HvsCameraPath,
  HvsCameraPathPoint,
  HvsCinemaPathInterpolation,
  HvsHandheldLayer,
  HvsHandheldStyle,
  HvsMotionSpeed,
  HvsRelativePlacement,
} from './types'
import { cinemaId, cinemaSeconds } from './types'

export const SPEED_SCALE: Record<HvsMotionSpeed, number> = {
  VERY_SLOW: 1.65,
  SLOW: 1.35,
  NORMAL: 1,
  FAST: 0.72,
  VERY_FAST: 0.48,
}

export function relativePoint(
  subject: Vec3,
  forward: Vec3,
  placement: HvsRelativePlacement,
  distance: number,
  height: number,
): Vec3 {
  const right = vec3(forward.z, 0, -forward.x)
  const len = Math.hypot(right.x, right.z) || 1
  const r = vec3(right.x / len, 0, right.z / len)
  if (placement === 'IN_FRONT_OF') return vec3(subject.x + forward.x * distance, height, subject.z + forward.z * distance)
  if (placement === 'BEHIND' || placement === 'FOLLOW_BEHIND') {
    return vec3(subject.x - forward.x * distance, height, subject.z - forward.z * distance)
  }
  if (placement === 'LEFT_OF' || placement === 'OVER_SHOULDER') {
    const extra = placement === 'OVER_SHOULDER' ? vec3(-forward.x * distance * 0.35, 0, -forward.z * distance * 0.35) : vec3(0, 0, 0)
    return vec3(subject.x - r.x * distance + extra.x, height, subject.z - r.z * distance + extra.z)
  }
  if (placement === 'RIGHT_OF') return vec3(subject.x + r.x * distance, height, subject.z + r.z * distance)
  if (placement === 'ABOVE') return vec3(subject.x, height + distance, subject.z)
  return vec3(subject.x, Math.max(0.15, height - distance), subject.z)
}

function point(
  timeSec: number,
  position: Vec3,
  extra?: Partial<HvsCameraPathPoint>,
  interpolation: HvsCinemaPathInterpolation = 'EASE_IN_OUT',
): HvsCameraPathPoint {
  return {
    time: cinemaSeconds(timeSec),
    position,
    rotation: extra?.rotation ?? null,
    target: extra?.target ?? null,
    focalLength: extra?.focalLength ?? null,
    focusDistance: extra?.focusDistance ?? null,
    interpolation,
  }
}

export function buildLinearPath(
  shotId: string,
  from: Vec3,
  to: Vec3,
  durationSec: number,
  extras?: { startFocal?: number; endFocal?: number; startFocus?: number; endFocus?: number; target?: Vec3 },
): HvsCameraPath {
  return {
    id: cinemaId('cpath'),
    shotId,
    interpolation: 'EASE_IN_OUT',
    points: [
      point(0, from, { focalLength: extras?.startFocal ?? null, focusDistance: extras?.startFocus ?? null, target: extras?.target ?? null }),
      point(durationSec, to, { focalLength: extras?.endFocal ?? extras?.startFocal ?? null, focusDistance: extras?.endFocus ?? extras?.startFocus ?? null, target: extras?.target ?? null }),
    ],
  }
}

export function buildOrbitPath(input: {
  shotId: string
  center: Vec3
  radius: number
  height: number
  startAngle: number
  endAngle: number
  durationSec: number
  focalLength: number
  samples?: number
}): HvsCameraPath {
  const samples = input.samples ?? 12
  const points: HvsCameraPathPoint[] = []
  for (let i = 0; i <= samples; i++) {
    const u = i / samples
    const yaw = input.startAngle + (input.endAngle - input.startAngle) * u
    const pos = orbitPoint(input.center, input.radius, yaw, input.height)
    points.push(point(input.durationSec * u, pos, { focalLength: input.focalLength, target: input.center }, 'CATMULL_ROM'))
  }
  return { id: cinemaId('cpath'), shotId: input.shotId, interpolation: 'CATMULL_ROM', points }
}

export function buildDollyPath(input: {
  shotId: string
  from: Vec3
  to: Vec3
  durationSec: number
  focalLength: number
  target?: Vec3
}): HvsCameraPath {
  return buildLinearPath(input.shotId, input.from, input.to, input.durationSec, {
    startFocal: input.focalLength,
    endFocal: input.focalLength,
    target: input.target,
  })
}

export function buildZoomPath(input: {
  shotId: string
  position: Vec3
  durationSec: number
  fromMm: number
  toMm: number
  target?: Vec3
}): HvsCameraPath {
  return buildLinearPath(input.shotId, input.position, input.position, input.durationSec, {
    startFocal: input.fromMm,
    endFocal: input.toMm,
    target: input.target,
  })
}

export function buildDollyZoomPath(input: {
  shotId: string
  from: Vec3
  to: Vec3
  durationSec: number
  fromMm: number
  toMm: number
  target?: Vec3
}): HvsCameraPath {
  return buildLinearPath(input.shotId, input.from, input.to, input.durationSec, {
    startFocal: input.fromMm,
    endFocal: input.toMm,
    target: input.target,
  })
}

export function buildCranePath(input: {
  shotId: string
  start: Vec3
  end: Vec3
  durationSec: number
  focalLength: number
  target?: Vec3
}): HvsCameraPath {
  const mid = vec3(
    (input.start.x + input.end.x) / 2,
    Math.max(input.start.y, input.end.y) * 0.65 + Math.min(input.start.y, input.end.y) * 0.35,
    (input.start.z + input.end.z) / 2,
  )
  return {
    id: cinemaId('cpath'),
    shotId: input.shotId,
    interpolation: 'BEZIER',
    points: [
      point(0, input.start, { focalLength: input.focalLength, target: input.target ?? null }, 'BEZIER'),
      point(input.durationSec * 0.5, mid, { focalLength: input.focalLength, target: input.target ?? null }, 'BEZIER'),
      point(input.durationSec, input.end, { focalLength: input.focalLength, target: input.target ?? null }, 'BEZIER'),
    ],
  }
}

export function handheldParams(style: HvsHandheldStyle): HvsHandheldLayer {
  if (style === 'SUBTLE') return { style, amplitude: 0.018, frequency: 1.4, translationNoise: 0.012, rotationNoise: 0.008 }
  if (style === 'DOCUMENTARY') return { style, amplitude: 0.035, frequency: 1.8, translationNoise: 0.022, rotationNoise: 0.014 }
  if (style === 'URGENT') return { style, amplitude: 0.055, frequency: 2.6, translationNoise: 0.034, rotationNoise: 0.022 }
  return { style, amplitude: 0.09, frequency: 3.4, translationNoise: 0.05, rotationNoise: 0.04 }
}

function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function applyHandheldLayer(path: HvsCameraPath, layer: HvsHandheldLayer): HvsCameraPath {
  return {
    ...path,
    points: path.points.map((item, index) => {
      const t = toSeconds(item.time)
      const n1 = (hash01(index + 11) - 0.5) * 2
      const n2 = (hash01(index + 29) - 0.5) * 2
      const wave = Math.sin(t * layer.frequency * Math.PI * 2)
      return {
        ...item,
        position: {
          x: item.position.x + wave * layer.amplitude * 0.45 + n1 * layer.translationNoise,
          y: item.position.y + Math.cos(t * layer.frequency * 1.7) * layer.amplitude * 0.25,
          z: item.position.z + wave * layer.amplitude * 0.35 + n2 * layer.translationNoise,
        },
      }
    }),
  }
}

export function applyShakeWindow(
  path: HvsCameraPath,
  input: { startSec: number; durationSec: number; intensity: number; frequency: number },
): HvsCameraPath {
  return {
    ...path,
    points: path.points.map((item, index) => {
      const t = toSeconds(item.time)
      if (t < input.startSec || t > input.startSec + input.durationSec) return item
      const local = t - input.startSec
      const envelope = Math.sin((local / Math.max(0.05, input.durationSec)) * Math.PI)
      const shake = Math.sin(local * input.frequency * Math.PI * 2) * input.intensity * envelope
      const n = (hash01(index + 71) - 0.5) * input.intensity * envelope
      return {
        ...item,
        position: {
          x: item.position.x + shake * 0.6 + n,
          y: item.position.y + shake * 0.35,
          z: item.position.z + n * 0.5,
        },
      }
    }),
  }
}

export function scalePathDuration(path: HvsCameraPath, factor: number): HvsCameraPath {
  return {
    ...path,
    points: path.points.map(item => ({
      ...item,
      time: fromSeconds(toSeconds(item.time) * factor, item.time.timescale),
    })),
  }
}

export function offsetPathHeight(path: HvsCameraPath, deltaY: number): HvsCameraPath {
  return {
    ...path,
    points: path.points.map(item => ({
      ...item,
      position: { ...item.position, y: Math.max(0.12, item.position.y + deltaY) },
    })),
  }
}

export function pathChangesPosition(path: HvsCameraPath): boolean {
  if (path.points.length < 2) return false
  const a = path.points[0].position
  return path.points.some(item => Math.hypot(item.position.x - a.x, item.position.y - a.y, item.position.z - a.z) > 0.04)
}

export function pathChangesFocalLength(path: HvsCameraPath): boolean {
  const focals = path.points.map(item => item.focalLength).filter((item): item is number => typeof item === 'number')
  if (focals.length < 2) return false
  return Math.abs(focals[0] - focals[focals.length - 1]) > 0.5
}

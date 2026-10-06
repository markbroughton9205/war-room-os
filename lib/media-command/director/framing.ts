import type { Vec3 } from '../destruction/types'

/** HVS QC bands for this studio. Approximate, not a cinematography standard. */
export const SHOT_SIZE_BANDS = {
  WIDE: { coverage: [0.05, 0.22] as const },
  FULL: { coverage: [0.18, 0.42] as const },
  MEDIUM: { coverage: [0.32, 0.58] as const },
  MEDIUM_CLOSE: { coverage: [0.48, 0.74] as const },
  CLOSE_UP: { coverage: [0.62, 0.9] as const },
  EXTREME_CLOSE_UP: { coverage: [0.82, 1.2] as const },
} as const

export const ALLEY_BUILDING_POSITION: Vec3 = { x: 0.4, y: 4, z: -14 }
export const ALLEY_FACADE_SCALE: Vec3 = { x: 8 / 6, y: 8 / 3, z: 1 }
export const HERO_WALK_START: Vec3 = { x: 1.7, y: 0, z: 0.35 }
export const HERO_WALK_END: Vec3 = { x: 0.55, y: 0, z: -11.5 }

export function facadeOrigin(): Vec3 {
  return {
    x: ALLEY_BUILDING_POSITION.x,
    y: 0,
    z: ALLEY_BUILDING_POSITION.z + 1.1,
  }
}

export function mapChunkToAlley(local: { x: number; y: number; z: number }): Vec3 {
  const origin = facadeOrigin()
  return {
    x: origin.x + local.x * ALLEY_FACADE_SCALE.x,
    y: local.y * ALLEY_FACADE_SCALE.y,
    z: origin.z + local.z * ALLEY_FACADE_SCALE.z,
  }
}

export function sceneTimeToSimTime(sceneSec: number, collapseStartSec: number, simDurationSec: number): number {
  return Math.max(0, Math.min(simDurationSec, sceneSec - collapseStartSec))
}

export function simTimeToSceneTime(simSec: number, collapseStartSec: number): number {
  return collapseStartSec + simSec
}

export type ShotFramingProposal = {
  focalMm: number
  distance: number
  height: number
  yawDeg: number
  shotSize: 'CU' | 'MCU'
  depthOfField: 'shallow'
  directorChoice: string
  mutated: false
}

export function solveShotFraming(input: {
  goal: 'KEEP_BACKGROUND' | 'LOWER' | 'WIDER_LENS'
  focalMm: number
  distance: number
  height: number
}): ShotFramingProposal {
  if (input.goal === 'LOWER') {
    return {
      focalMm: input.focalMm,
      distance: input.distance,
      height: Math.max(0.9, Math.round((input.height - 0.28) * 100) / 100),
      yawDeg: 0,
      shotSize: input.focalMm >= 80 ? 'CU' : 'MCU',
      depthOfField: 'shallow',
      directorChoice: "Lower the final camera. Ra'el stays the close-up subject. Destruction is not resimulated.",
      mutated: false,
    }
  }
  if (input.goal === 'WIDER_LENS') {
    const focalMm = Math.max(50, Math.round(input.focalMm - 12))
    return {
      focalMm,
      distance: input.distance,
      height: input.height,
      yawDeg: 0,
      shotSize: focalMm >= 80 ? 'CU' : 'MCU',
      depthOfField: 'shallow',
      directorChoice: 'A slightly wider final lens. Still a close-up or medium close-up. Destruction cache stays.',
      mutated: false,
    }
  }
  const focalMm = Math.min(input.focalMm, 70)
  return {
    focalMm,
    distance: Math.min(input.distance, 1.7),
    height: input.height,
    yawDeg: 0,
    shotSize: 'MCU',
    depthOfField: 'shallow',
    directorChoice: "Hold the close-up intent: slightly wider lens and a step back so the collapsing building reads behind Ra'el without turning Shot 5 into a wide.",
    mutated: false,
  }
}

export type FramingSample = {
  heroCenterX: number
  heroCenterY: number
  heroVisibleFraction: number
  heroFrameCoverage: number
  backgroundTargetVisibleFraction: number
  heroOccluded: boolean
  backgroundOccluded: boolean
  cameraInsideGeometry: boolean
  shotSizeBand: keyof typeof SHOT_SIZE_BANDS | 'OUTSIDE_BAND'
  status: 'PASS' | 'WARNING'
}

type Box = { center: Vec3; half: Vec3 }

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function norm(a: Vec3): Vec3 {
  const m = Math.hypot(a.x, a.y, a.z) || 1
  return { x: a.x / m, y: a.y / m, z: a.z / m }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function projectPoint(camera: Vec3, lookAt: Vec3, fovDeg: number, aspect: number, point: Vec3): { x: number; y: number; behind: boolean } {
  const forward = norm(sub(lookAt, camera))
  const right = norm(cross(forward, { x: 0, y: 1, z: 0 }))
  const up = cross(right, forward)
  const rel = sub(point, camera)
  const z = dot(rel, forward)
  const x = dot(rel, right)
  const y = dot(rel, up)
  const tan = Math.tan((fovDeg * Math.PI) / 360)
  if (z <= 0.05) return { x: 0, y: 0, behind: true }
  return { x: x / (z * tan * aspect), y: y / (z * tan), behind: false }
}

function aabbContains(box: Box, point: Vec3): boolean {
  return Math.abs(point.x - box.center.x) < box.half.x
    && Math.abs(point.y - box.center.y) < box.half.y
    && Math.abs(point.z - box.center.z) < box.half.z
}

function rayHitsBox(origin: Vec3, target: Vec3, box: Box): boolean {
  const dir = sub(target, origin)
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len }
  const min = { x: box.center.x - box.half.x, y: box.center.y - box.half.y, z: box.center.z - box.half.z }
  const max = { x: box.center.x + box.half.x, y: box.center.y + box.half.y, z: box.center.z + box.half.z }
  let tMin = 0
  let tMax = len * 0.98
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false
      continue
    }
    let t1 = (min[axis] - origin[axis]) / d[axis]
    let t2 = (max[axis] - origin[axis]) / d[axis]
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  }
  return tMax > 0.05 && tMin < len * 0.98
}

function bandForCoverage(coverage: number): FramingSample['shotSizeBand'] {
  if (coverage >= SHOT_SIZE_BANDS.EXTREME_CLOSE_UP.coverage[0]) return 'EXTREME_CLOSE_UP'
  if (coverage >= SHOT_SIZE_BANDS.CLOSE_UP.coverage[0]) return 'CLOSE_UP'
  if (coverage >= SHOT_SIZE_BANDS.MEDIUM_CLOSE.coverage[0]) return 'MEDIUM_CLOSE'
  if (coverage >= SHOT_SIZE_BANDS.MEDIUM.coverage[0]) return 'MEDIUM'
  if (coverage >= SHOT_SIZE_BANDS.FULL.coverage[0]) return 'FULL'
  if (coverage >= SHOT_SIZE_BANDS.WIDE.coverage[0]) return 'WIDE'
  return 'OUTSIDE_BAND'
}

export function measureHeroFraming(input: {
  camera: Vec3
  lookAt: Vec3
  focalMm: number
  hero: Vec3
  buildingPoint: Vec3
  car: Box
  heroBox: Box
  buildingBox: Box
}): FramingSample {
  const fov = Math.max(8, Math.min(80, 2 * Math.atan(18 / Math.max(12, input.focalMm)) * (180 / Math.PI)))
  const aspect = 16 / 9
  const heroHead = { x: input.hero.x, y: input.hero.y + 1.6, z: input.hero.z }
  const heroFeet = { x: input.hero.x, y: input.hero.y + 0.05, z: input.hero.z }
  const head = projectPoint(input.camera, input.lookAt, fov, aspect, heroHead)
  const feet = projectPoint(input.camera, input.lookAt, fov, aspect, heroFeet)
  const center = projectPoint(input.camera, input.lookAt, fov, aspect, { x: input.hero.x, y: input.hero.y + 1.2, z: input.hero.z })
  const facadePoints = [-0.6, 0, 0.6].flatMap(x => [1.3, 2.1, 3.1].map(y => ({
    x: input.buildingPoint.x + x,
    y,
    z: input.buildingPoint.z,
  })))
  const facadeHits = facadePoints.filter(point => {
    const projected = projectPoint(input.camera, input.lookAt, fov, aspect, point)
    return !projected.behind && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
  })
  const building = projectPoint(input.camera, input.lookAt, fov, aspect, input.buildingPoint)
  const coverage = head.behind || feet.behind ? 0 : Math.abs(head.y - feet.y) / 2
  const heroIn = !center.behind && Math.abs(center.x) < 1 && Math.abs(center.y) < 1
  const buildingIn = facadeHits.length >= 2 || (!building.behind && Math.abs(building.x) < 1 && Math.abs(building.y) < 1)
  const heroOccluded = rayHitsBox(input.camera, { x: input.hero.x, y: input.hero.y + 1.2, z: input.hero.z }, input.car)
  const backgroundOccluded = rayHitsBox(input.camera, input.buildingPoint, input.heroBox)
  const cameraInsideGeometry = aabbContains(input.car, input.camera)
    || aabbContains(input.heroBox, input.camera)
    || aabbContains(input.buildingBox, input.camera)
  const band = bandForCoverage(coverage)
  const close = band === 'CLOSE_UP' || band === 'MEDIUM_CLOSE' || band === 'EXTREME_CLOSE_UP'
  const status: FramingSample['status'] = heroIn && buildingIn && close && !cameraInsideGeometry && !heroOccluded ? 'PASS' : 'WARNING'
  return {
    heroCenterX: center.x,
    heroCenterY: center.y,
    heroVisibleFraction: heroIn ? 1 : 0,
    heroFrameCoverage: coverage,
    backgroundTargetVisibleFraction: facadePoints.length ? facadeHits.length / facadePoints.length : 0,
    heroOccluded,
    backgroundOccluded,
    cameraInsideGeometry,
    shotSizeBand: band,
    status,
  }
}

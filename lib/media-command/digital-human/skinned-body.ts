/**
 * HVS-owned stylized skinned body. Binds to hvs-humanoid-rig-v1.
 * Runtime-generated. Not a second rig. Not baked animation. Not identity.
 */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from 'three'
import {
  HVS_HUMANOID_BONES,
  HVS_HUMANOID_PARENT,
  HVS_HUMANOID_SEGMENTS,
  HVS_NEUTRAL_REST,
  type HvsHumanoidBone,
} from './humanoid-rig'
import { HVS_HUMANOID_RIG_ID, HVS_NEUTRAL_HUMANOID, HVS_PREVIEW_WARDROBE_NOTE } from './types'
import { compactJoint, type CompactHumanoidPose } from './scene-performance'

export const HVS_STYLIZED_BODY_ID = 'hvs-stylized-body-v1' as const
export const HVS_STYLIZED_BODY_NOTE = 'HVS_STYLIZED_BODY_V1 runtime skinned body. Binds to hvs-humanoid-rig-v1. Not identity. Not photoreal. Not baked animation.' as const

export type HvsBodyQuality = 'PRODUCTION' | 'PREVIEW' | 'LOW'

export const HVS_BODY_MATERIALS = ['suit', 'skin', 'shoes', 'shirt', 'hair'] as const
export const HVS_ANIM01_VERTEX_COUNT = 1670
export const HVS_ANIM01_TRIANGLE_COUNT = 2824
export const HVS_ANIM02_VERTEX_COUNT = 2612
export const HVS_ANIM02_TRIANGLE_COUNT = 4398
export const HVS_ANIM03_VERTEX_COUNT = 3288
export const HVS_ANIM03_TRIANGLE_COUNT = 5546
export const HVS_HEAD_GROOM_ID = 'groom-hvs-stylized-head-v1' as const
export const HVS_HEAD_GROOM_STYLE = 'HVS_NEUTRAL_SHORT_MEDIUM' as const

export type HvsHeadGrooming = {
  id: typeof HVS_HEAD_GROOM_ID
  characterId: 'rael-commander'
  style: typeof HVS_HEAD_GROOM_STYLE
  hairlineProfile: 'FOREHEAD_TEMPLE_NAPE'
  crownProfile: 'DIRECTIONAL_LAYERS'
  templeProfile: 'NOTCHED_TAPER'
  sideProfile: 'ABOVE_EAR'
  backProfile: 'NAPE_TAPER'
  densityIntent: 'STYLIZED_CLUMPS'
  materialRef: 'hair'
  parentBone: 'HEAD'
  version: 2
  refinePass: 'HVS-ANIM-04'
  earClearance: true
  provenance: 'HVS-original'
  simulated: false
  identityLikeness: false
  gaze: false
  faces: false
}

export const HVS_HEAD_GROOMING: HvsHeadGrooming = {
  id: HVS_HEAD_GROOM_ID,
  characterId: 'rael-commander',
  style: HVS_HEAD_GROOM_STYLE,
  hairlineProfile: 'FOREHEAD_TEMPLE_NAPE',
  crownProfile: 'DIRECTIONAL_LAYERS',
  templeProfile: 'NOTCHED_TAPER',
  sideProfile: 'ABOVE_EAR',
  backProfile: 'NAPE_TAPER',
  densityIntent: 'STYLIZED_CLUMPS',
  materialRef: 'hair',
  parentBone: 'HEAD',
  version: 2,
  refinePass: 'HVS-ANIM-04',
  earClearance: true,
  provenance: 'HVS-original',
  simulated: false,
  identityLikeness: false,
  gaze: false,
  faces: false,
}

type Vec = { x: number; y: number; z: number }

const Y_UP = new Vector3(0, 1, 0)
const _dir = new Vector3()
const _quat = new Quaternion()
const _headExtra = new Quaternion()
const _euler = new Euler()
const _mat = new Matrix4()
const _scale = new Vector3(1, 1, 1)
const _pos = new Vector3()

const BONE_INDEX: Record<HvsHumanoidBone, number> = Object.fromEntries(
  HVS_HUMANOID_BONES.map((bone, index) => [bone, index]),
) as Record<HvsHumanoidBone, number>

const CHILDREN: Record<HvsHumanoidBone, HvsHumanoidBone[]> = {
  ROOT: ['PELVIS'],
  PELVIS: ['SPINE_01', 'LEFT_HIP', 'RIGHT_HIP'],
  SPINE_01: ['SPINE_02'],
  SPINE_02: ['CHEST'],
  CHEST: ['NECK', 'LEFT_CLAVICLE', 'RIGHT_CLAVICLE'],
  NECK: ['HEAD'],
  HEAD: [],
  LEFT_CLAVICLE: ['LEFT_SHOULDER'],
  LEFT_SHOULDER: ['LEFT_ELBOW'],
  LEFT_ELBOW: ['LEFT_WRIST'],
  LEFT_WRIST: [],
  RIGHT_CLAVICLE: ['RIGHT_SHOULDER'],
  RIGHT_SHOULDER: ['RIGHT_ELBOW'],
  RIGHT_ELBOW: ['RIGHT_WRIST'],
  RIGHT_WRIST: [],
  LEFT_HIP: ['LEFT_KNEE'],
  LEFT_KNEE: ['LEFT_ANKLE'],
  LEFT_ANKLE: ['LEFT_FOOT'],
  LEFT_FOOT: [],
  RIGHT_HIP: ['RIGHT_KNEE'],
  RIGHT_KNEE: ['RIGHT_ANKLE'],
  RIGHT_ANKLE: ['RIGHT_FOOT'],
  RIGHT_FOOT: [],
}

const INFLUENCE: Record<string, HvsHumanoidBone[]> = {
  torso: ['PELVIS', 'SPINE_01', 'SPINE_02', 'CHEST', 'LEFT_CLAVICLE', 'RIGHT_CLAVICLE'],
  neck: ['CHEST', 'NECK', 'HEAD'],
  head: ['NECK', 'HEAD'],
  larm: ['LEFT_CLAVICLE', 'LEFT_SHOULDER', 'LEFT_ELBOW', 'LEFT_WRIST', 'CHEST'],
  rarm: ['RIGHT_CLAVICLE', 'RIGHT_SHOULDER', 'RIGHT_ELBOW', 'RIGHT_WRIST', 'CHEST'],
  lleg: ['PELVIS', 'LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE', 'LEFT_FOOT'],
  rleg: ['PELVIS', 'RIGHT_HIP', 'RIGHT_KNEE', 'RIGHT_ANKLE', 'RIGHT_FOOT'],
}

type Region = keyof typeof INFLUENCE

function vec(x: number, y: number, z: number): Vec {
  return { x, y, z }
}
function rest(bone: HvsHumanoidBone): Vec {
  return HVS_NEUTRAL_REST[bone]
}
function sub(a: Vec, b: Vec): Vec {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z)
}
function add(a: Vec, b: Vec): Vec {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z)
}
function scl(a: Vec, s: number): Vec {
  return vec(a.x * s, a.y * s, a.z * s)
}
function len(a: Vec): number {
  return Math.hypot(a.x, a.y, a.z)
}
function nrm(a: Vec): Vec {
  const d = len(a) || 1
  return scl(a, 1 / d)
}
function cross(a: Vec, b: Vec): Vec {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function lerpV(a: Vec, b: Vec, t: number): Vec {
  return vec(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))
}

function rotateBy(q: Quaternion, p: Vec): Vec {
  _pos.set(p.x, p.y, p.z).applyQuaternion(q)
  return vec(_pos.x, _pos.y, _pos.z)
}

function basis(dir: Vec): { x: Vec; y: Vec; z: Vec } {
  const y = nrm(dir)
  const hint = Math.abs(y.y) < 0.92 ? vec(0, 1, 0) : vec(1, 0, 0)
  const x = nrm(cross(hint, y))
  return { x, y, z: cross(y, x) }
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / ((len(ab) ** 2) || 1)))
  const q = add(a, scl(ab, t))
  return len(sub(p, q))
}

function skinAt(p: Vec, region: Region): { indices: [number, number, number, number]; weights: [number, number, number, number] } {
  const allowed = INFLUENCE[region]
  const scored = allowed.map(bone => {
    const parent = HVS_HUMANOID_PARENT[bone]
    const a = parent ? rest(parent) : rest(bone)
    const b = rest(bone)
    const d = distToSegment(p, a, b)
    return { bone, w: 1 / ((d + 0.018) ** 2) }
  }).sort((a, b) => b.w - a.w).slice(0, 4)
  const sum = scored.reduce((n, item) => n + item.w, 0) || 1
  const indices: number[] = [0, 0, 0, 0]
  const weights: number[] = [0, 0, 0, 0]
  scored.forEach((item, i) => {
    indices[i] = BONE_INDEX[item.bone]
    weights[i] = item.w / sum
  })
  const total = weights[0] + weights[1] + weights[2] + weights[3]
  if (total > 0) {
    weights[0] /= total
    weights[1] /= total
    weights[2] /= total
    weights[3] /= total
  } else {
    weights[0] = 1
  }
  return {
    indices: [indices[0], indices[1], indices[2], indices[3]],
    weights: [weights[0], weights[1], weights[2], weights[3]],
  }
}

type Acc = {
  positions: number[]
  skinIndex: number[]
  skinWeight: number[]
  indices: number[]
  groups: Array<{ start: number; count: number; materialIndex: number }>
}

function emptyAcc(): Acc {
  return { positions: [], skinIndex: [], skinWeight: [], indices: [], groups: [] }
}

function pushVertex(acc: Acc, p: Vec, region: Region, lock?: HvsHumanoidBone) {
  acc.positions.push(p.x, p.y, p.z)
  if (lock) {
    acc.skinIndex.push(BONE_INDEX[lock], 0, 0, 0)
    acc.skinWeight.push(1, 0, 0, 0)
  } else {
    const skin = skinAt(p, region)
    acc.skinIndex.push(...skin.indices)
    acc.skinWeight.push(...skin.weights)
  }
  return acc.positions.length / 3 - 1
}

function stitchRings(acc: Acc, a: number[], b: number[], materialIndex: number) {
  const start = acc.indices.length
  const n = a.length
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n
    acc.indices.push(a[i], b[i], b[i1], a[i], b[i1], a[i1])
  }
  acc.groups.push({ start, count: n * 6, materialIndex })
}

function stitchStrip(acc: Acc, a: number[], b: number[], materialIndex: number) {
  const start = acc.indices.length
  const n = Math.min(a.length, b.length) - 1
  for (let i = 0; i < n; i++) {
    acc.indices.push(a[i], b[i], b[i + 1], a[i], b[i + 1], a[i + 1])
  }
  acc.groups.push({ start, count: n * 6, materialIndex })
}

function ring(center: Vec, axis: Vec, rx: number, rz: number, radial: number): Vec[] {
  const b = basis(axis)
  const pts: Vec[] = []
  for (let i = 0; i < radial; i++) {
    const t = (i / radial) * Math.PI * 2
    pts.push(add(center, add(scl(b.x, Math.cos(t) * rx), scl(b.z, Math.sin(t) * rz))))
  }
  return pts
}

function tube(
  acc: Acc,
  a: Vec,
  b: Vec,
  ra: { rx: number; rz: number },
  rb: { rx: number; rz: number },
  along: number,
  radial: number,
  region: Region,
  materialIndex: number,
  lock?: HvsHumanoidBone,
) {
  const axis = sub(b, a)
  const rings: number[][] = []
  for (let i = 0; i <= along; i++) {
    const t = i / along
    const c = lerpV(a, b, t)
    const r = { rx: lerp(ra.rx, rb.rx, t), rz: lerp(ra.rz, rb.rz, t) }
    rings.push(ring(c, axis, r.rx, r.rz, radial).map(p => pushVertex(acc, p, region, lock)))
  }
  for (let i = 0; i < rings.length - 1; i++) stitchRings(acc, rings[i], rings[i + 1], materialIndex)
}

function ellipsoid(
  acc: Acc,
  center: Vec,
  rx: number,
  ry: number,
  rz: number,
  segs: number,
  rings: number,
  region: Region,
  materialIndex: number,
  lock?: HvsHumanoidBone,
) {
  const grid: number[][] = []
  for (let y = 0; y <= rings; y++) {
    const vv = y / rings
    const phi = vv * Math.PI
    const row: number[] = []
    for (let x = 0; x < segs; x++) {
      const u = x / segs
      const th = u * Math.PI * 2
      const p = vec(
        center.x + rx * Math.sin(phi) * Math.cos(th),
        center.y + ry * Math.cos(phi),
        center.z + rz * Math.sin(phi) * Math.sin(th),
      )
      row.push(pushVertex(acc, p, region, lock))
    }
    grid.push(row)
  }
  for (let y = 0; y < rings; y++) stitchRings(acc, grid[y], grid[y + 1], materialIndex)
}

function qualityParams(quality: 'PRODUCTION' | 'PREVIEW') {
  if (quality === 'PREVIEW') {
    return { radial: 8, along: 3, head: 12, headRings: 9, deltoid: 7, deltoidRings: 5, collar: 10, panel: 3 }
  }
  return { radial: 12, along: 5, head: 18, headRings: 14, deltoid: 10, deltoidRings: 7, collar: 14, panel: 4 }
}

function worldTorsoRing(center: Vec, rx: number, rz: number, puff: number, radial: number): Vec[] {
  const pts: Vec[] = []
  for (let i = 0; i < radial; i++) {
    const theta = (i / radial) * Math.PI * 2
    const side = Math.cos(theta)
    const front = Math.sin(theta)
    const x = side * rx
    const z = front * (rz + (front > 0 ? puff : puff * 0.35))
    pts.push(vec(center.x + x, center.y, center.z + z))
  }
  return pts
}

function fan(acc: Acc, a: number, b: number, c: number, materialIndex: number) {
  const start = acc.indices.length
  acc.indices.push(a, b, c)
  acc.groups.push({ start, count: 3, materialIndex })
}

function gridPanel(
  acc: Acc,
  origin: Vec,
  uDir: Vec,
  vDir: Vec,
  width: number,
  height: number,
  nu: number,
  nv: number,
  region: Region,
  materialIndex: number,
) {
  const grid: number[][] = []
  for (let row = 0; row <= nv; row++) {
    const vv = row / nv
    const line: number[] = []
    for (let col = 0; col <= nu; col++) {
      const uu = col / nu - 0.5
      line.push(pushVertex(acc, add(origin, add(scl(uDir, uu * width), scl(vDir, vv * height))), region))
    }
    grid.push(line)
  }
  for (let row = 0; row < nv; row++) stitchStrip(acc, grid[row], grid[row + 1], materialIndex)
}

function wedge(acc: Acc, apex: Vec, base: Vec[], region: Region, materialIndex: number) {
  const ai = pushVertex(acc, apex, region)
  const ids = base.map(p => pushVertex(acc, p, region))
  for (let i = 0; i < ids.length; i++) fan(acc, ai, ids[i], ids[(i + 1) % ids.length], materialIndex)
  if (ids.length >= 3) {
    for (let i = 1; i < ids.length - 1; i++) fan(acc, ids[0], ids[i], ids[i + 1], materialIndex)
  }
}

function sculptedHead(acc: Acc, segs: number, rings: number) {
  const center = add(rest('HEAD'), vec(0, 0.038, 0.018))
  const grid: number[][] = []
  for (let row = 0; row <= rings; row++) {
    const vv = row / rings
    const phi = vv * Math.PI
    const line: number[] = []
    for (let col = 0; col < segs; col++) {
      const uu = col / segs
      const theta = uu * Math.PI * 2
      const nx = Math.sin(phi) * Math.cos(theta)
      const ny = Math.cos(phi)
      const nz = Math.sin(phi) * Math.sin(theta)
      const front = Math.max(0, nz)
      const back = Math.max(0, -nz)
      const side = Math.abs(nx)
      let rx = 0.086
      let ry = 0.114
      let rz = 0.102
      if (vv < 0.3) {
        rx += 0.008
        rz += 0.016 * back
      }
      if (vv > 0.2 && vv < 0.42) rz *= 1 - 0.2 * front
      if (vv > 0.34 && vv < 0.44) {
        rz += 0.016 * front
        ry += 0.004 * front
      }
      const eyeL = Math.exp(-(((theta - (Math.PI / 2 - 0.36)) ** 2) / 0.07) - (((vv - 0.46) ** 2) / 0.01))
      const eyeR = Math.exp(-(((theta - (Math.PI / 2 + 0.36)) ** 2) / 0.07) - (((vv - 0.46) ** 2) / 0.01))
      rz -= 0.02 * (eyeL + eyeR)
      ry -= 0.007 * (eyeL + eyeR)
      if (vv > 0.48 && vv < 0.68) rx += 0.016 * side * (1 - Math.abs(vv - 0.58) * 7)
      if (vv > 0.62) {
        const jaw = (vv - 0.62) / 0.38
        rx *= 1 - 0.48 * jaw * jaw
      }
      if (vv > 0.76 && vv < 0.96) {
        const chin = Math.sin(((vv - 0.76) / 0.2) * Math.PI)
        rz += 0.026 * front * chin
        ry *= 0.94
      }
      if (vv > 0.78 && vv < 0.86 && front > 0.55) rz -= 0.01 * front
      if (vv > 0.9) {
        rx *= 0.72
        rz -= 0.012 * front
      }
      line.push(pushVertex(acc, vec(center.x + rx * nx, center.y + ry * ny, center.z + rz * nz), 'head'))
    }
    grid.push(line)
  }
  for (let row = 0; row < rings; row++) stitchRings(acc, grid[row], grid[row + 1], 1)

  ellipsoid(acc, add(center, vec(-0.092, -0.01, -0.016)), 0.018, 0.034, 0.022, 8, 6, 'head', 1)
  ellipsoid(acc, add(center, vec(0.092, -0.01, -0.016)), 0.018, 0.034, 0.022, 8, 6, 'head', 1)
  ellipsoid(acc, add(center, vec(-0.094, -0.004, -0.008)), 0.01, 0.018, 0.012, 6, 4, 'head', 1)
  ellipsoid(acc, add(center, vec(0.094, -0.004, -0.008)), 0.01, 0.018, 0.012, 6, 4, 'head', 1)
  ellipsoid(acc, add(center, vec(-0.03, 0.016, 0.086)), 0.02, 0.008, 0.01, 6, 4, 'head', 1)
  ellipsoid(acc, add(center, vec(0.03, 0.016, 0.086)), 0.02, 0.008, 0.01, 6, 4, 'head', 1)
  wedge(
    acc,
    add(center, vec(0, -0.006, 0.122)),
    [
      add(center, vec(-0.012, 0.016, 0.084)),
      add(center, vec(0.012, 0.016, 0.084)),
      add(center, vec(0.01, -0.03, 0.09)),
      add(center, vec(-0.01, -0.03, 0.09)),
    ],
    'head',
    1,
  )
  ellipsoid(acc, add(center, vec(-0.008, -0.03, 0.108)), 0.008, 0.006, 0.007, 6, 4, 'head', 1)
  ellipsoid(acc, add(center, vec(0.008, -0.03, 0.108)), 0.008, 0.006, 0.007, 6, 4, 'head', 1)
  ellipsoid(acc, add(center, vec(0, -0.072, 0.092)), 0.024, 0.012, 0.014, 8, 5, 'head', 1)
  gridPanel(acc, add(center, vec(0, -0.055, 0.1)), vec(1, 0, 0), vec(0, 0.2, -0.35), 0.028, 0.018, 3, 2, 'head', 1)
}

function hairlinePhi(theta: number): number {
  const frontness = Math.sin(theta)
  const base = lerp(0.8 * Math.PI, 0.27 * Math.PI, (frontness + 1) / 2)
  const leftNotch = Math.exp(-(((theta - (Math.PI / 2 - 0.64)) ** 2) / 0.038))
  const rightNotch = Math.exp(-(((theta - (Math.PI / 2 + 0.7)) ** 2) / 0.042))
  const peak = Math.exp(-(((theta - Math.PI / 2) ** 2) / 0.07))
  const clump = Math.sin(theta * 5) * 0.014 * Math.max(0, frontness)
  const sideBreak = Math.sin(theta * 3 + 0.55) * 0.01
  const nape = Math.max(0, -frontness) * 0.018 * Math.PI
  return Math.max(
    0.2 * Math.PI,
    Math.min(
      0.86 * Math.PI,
      base
        - (leftNotch * 0.06 + rightNotch * 0.054) * Math.PI
        + peak * 0.03 * Math.PI
        + (clump + sideBreak) * Math.PI
        + nape,
    ),
  )
}

function applyEarClearance(p: Vec, hairCenter: Vec): { p: Vec; hit: boolean } {
  let out = p
  let hit = false
  for (const side of [-1, 1] as const) {
    const ear = add(hairCenter, vec(side * 0.09, -0.03, 0.012))
    const d = len(sub(out, ear))
    if (d < 0.05) {
      const t = 1 - d / 0.05
      out = add(out, add(scl(nrm(sub(hairCenter, out)), t * 0.02), vec(-side * t * 0.006, 0, -t * 0.01)))
      hit = true
    }
  }
  return { p: out, hit }
}

function stylizedHair(acc: Acc, segs: number, rings: number): { clumps: number; hairlineBreaks: number; earClearance: number } {
  const center = add(rest('HEAD'), vec(0, 0.04, 0.012))
  let earClearance = 0
  let hairlineBreaks = 0
  function shell(lift: number, extra: number, along: number, phiScale: number) {
    const grid: number[][] = []
    for (let row = 0; row <= along; row++) {
      const tt = row / along
      const line: number[] = []
      for (let col = 0; col < segs; col++) {
        const theta = (col / segs) * Math.PI * 2
        const frontness = Math.sin(theta)
        const back = Math.max(0, -frontness)
        const side = Math.abs(Math.cos(theta))
        const phi = tt * hairlinePhi(theta) * phiScale
        const nx = Math.sin(phi) * Math.cos(theta)
        const ny = Math.cos(phi)
        const nz = Math.sin(phi) * Math.sin(theta)
        let thick = lerp(0.02 + extra, 0.005, tt)
        thick += back * 0.008 * (1 - tt)
        thick -= side * tt * 0.004
        const yLift = (1 - tt) * (lift + 0.004 * back)
        const zPull = Math.max(0, frontness) * tt * -0.014
        const xTaper = 1 - 0.1 * side * tt
        const raw = vec(
          center.x + (0.086 + thick) * nx * xTaper,
          center.y + (0.11 + thick) * ny + yLift,
          center.z + (0.098 + thick) * nz + zPull + back * (1 - tt) * 0.006,
        )
        const cleared = applyEarClearance(raw, center)
        if (cleared.hit && tt > 0.5) earClearance += 1
        if (tt > 0.92) {
          const delta = Math.abs(hairlinePhi(theta) - hairlinePhi(theta + 0.12))
          if (delta > 0.035) hairlineBreaks += 1
        }
        line.push(pushVertex(acc, cleared.p, 'head', 'HEAD'))
      }
      grid.push(line)
    }
    for (let row = 0; row < along; row++) stitchRings(acc, grid[row], grid[row + 1], 4)
  }
  shell(0.012, 0, rings, 1)
  shell(0.018, 0.003, Math.max(4, Math.floor(rings * 0.55)), 0.62)
  ellipsoid(acc, add(center, vec(0, 0.066, -0.016)), 0.05, 0.013, 0.036, 8, 5, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(-0.028, 0.012, 0.07)), 0.02, 0.013, 0.015, 6, 4, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(0.03, 0.01, 0.068)), 0.018, 0.012, 0.014, 6, 4, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(-0.07, 0.01, 0.034)), 0.013, 0.02, 0.015, 6, 4, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(0.072, 0.008, 0.032)), 0.012, 0.018, 0.014, 6, 4, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(0, -0.034, -0.076)), 0.036, 0.02, 0.018, 7, 4, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(-0.068, -0.02, 0.044)), 0.011, 0.022, 0.012, 6, 4, 'head', 4, 'HEAD')
  ellipsoid(acc, add(center, vec(0.068, -0.02, 0.044)), 0.011, 0.022, 0.012, 6, 4, 'head', 4, 'HEAD')
  return { clumps: 8, hairlineBreaks, earClearance }
}

function staticBrows(acc: Acc) {
  const center = add(rest('HEAD'), vec(0, 0.038, 0.018))
  tube(acc, add(center, vec(-0.014, 0.02, 0.09)), add(center, vec(-0.048, 0.026, 0.078)), { rx: 0.007, rz: 0.004 }, { rx: 0.006, rz: 0.0035 }, 3, 6, 'head', 4, 'HEAD')
  tube(acc, add(center, vec(0.014, 0.02, 0.09)), add(center, vec(0.048, 0.026, 0.078)), { rx: 0.007, rz: 0.004 }, { rx: 0.006, rz: 0.0035 }, 3, 6, 'head', 4, 'HEAD')
}

function neckColumn(acc: Acc, along: number, radial: number) {
  const chest = rest('CHEST')
  const neck = rest('NECK')
  const head = rest('HEAD')
  const base = vec(chest.x, chest.y + 0.07, chest.z - 0.01)
  const mid = vec(neck.x, neck.y + 0.01, neck.z)
  const top = vec(head.x, head.y - 0.08, head.z + 0.01)
  tube(acc, base, mid, { rx: 0.036, rz: 0.034 }, { rx: 0.04, rz: 0.038 }, along, radial, 'neck', 1)
  tube(acc, mid, top, { rx: 0.04, rz: 0.038 }, { rx: 0.046, rz: 0.044 }, Math.max(2, along - 1), radial, 'neck', 1)
}

function jacketCollar(acc: Acc, segs: number, tubes: number) {
  const center = vec(0, rest('NECK').y - 0.03, rest('NECK').z + 0.005)
  const rings: number[][] = []
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2
    const majorX = 0.046 + Math.abs(Math.cos(theta)) * 0.004
    const majorZ = 0.04 + Math.max(0, Math.sin(theta)) * 0.008
    const c = vec(center.x + Math.cos(theta) * majorX, center.y + Math.cos(theta) * 0.004, center.z + Math.sin(theta) * majorZ)
    const tangent = vec(-Math.sin(theta), 0.05, Math.cos(theta))
    rings.push(ring(c, tangent, 0.013, 0.011, tubes).map(p => pushVertex(acc, p, 'torso')))
  }
  for (let i = 0; i < rings.length - 1; i++) stitchRings(acc, rings[i], rings[i + 1], 0)
}

function shoulderGirdle(acc: Acc, side: -1 | 1, q: ReturnType<typeof qualityParams>) {
  const clavicleBone = side < 0 ? 'LEFT_CLAVICLE' : 'RIGHT_CLAVICLE'
  const shoulderBone = side < 0 ? 'LEFT_SHOULDER' : 'RIGHT_SHOULDER'
  const region: Region = side < 0 ? 'larm' : 'rarm'
  const chest = rest('CHEST')
  const clavicle = rest(clavicleBone)
  const shoulder = rest(shoulderBone)
  const neck = rest('NECK')
  const start = vec(side * 0.055, chest.y + 0.045, chest.z + 0.008)
  tube(acc, start, clavicle, { rx: 0.026, rz: 0.02 }, { rx: 0.03, rz: 0.022 }, q.along, q.radial, region, 0)
  tube(acc, clavicle, shoulder, { rx: 0.032, rz: 0.024 }, { rx: 0.046, rz: 0.04 }, q.along, q.radial, region, 0)
  ellipsoid(acc, add(shoulder, vec(side * 0.022, -0.018, -0.008)), 0.05, 0.046, 0.044, q.deltoid, q.deltoidRings, region, 0)
  const trapA = vec(side * 0.028, neck.y - 0.018, neck.z - 0.028)
  const trapB = add(clavicle, vec(side * 0.018, 0.012, -0.03))
  tube(acc, trapA, trapB, { rx: 0.028, rz: 0.02 }, { rx: 0.034, rz: 0.026 }, Math.max(2, q.along - 1), q.radial, region, 0)
  tube(acc, add(shoulder, vec(side * 0.01, 0.012, 0)), add(clavicle, vec(0, 0.018, -0.004)), { rx: 0.01, rz: 0.008 }, { rx: 0.012, rz: 0.009 }, 2, 6, region, 0)
}

function shapedTorso(acc: Acc, radial: number) {
  const profiles = [
    { y: 0.88, rx: 0.132, rz: 0.1, puff: 0.01 },
    { y: 0.95, rx: 0.124, rz: 0.094, puff: 0.012 },
    { y: 1.06, rx: 0.108, rz: 0.086, puff: 0.018 },
    { y: 1.18, rx: 0.116, rz: 0.09, puff: 0.024 },
    { y: 1.3, rx: 0.136, rz: 0.1, puff: 0.03 },
    { y: 1.4, rx: 0.15, rz: 0.108, puff: 0.034 },
    { y: 1.48, rx: 0.12, rz: 0.088, puff: 0.016 },
  ]
  const rings = profiles.map(profile =>
    worldTorsoRing(vec(0, profile.y, 0.015), profile.rx, profile.rz, profile.puff, radial).map(p => pushVertex(acc, p, 'torso')),
  )
  for (let i = 0; i < rings.length - 1; i++) stitchRings(acc, rings[i], rings[i + 1], 0)
}

function suitLapel(acc: Acc, side: -1 | 1, nu: number) {
  const origin = vec(side * 0.028, 1.2, 0.128)
  gridPanel(acc, origin, vec(side, 0.04, -0.08), vec(0, 1, -0.04), 0.055, 0.3, nu, nu + 1, 'torso', 0)
}

function shirtPlacket(acc: Acc, nu: number) {
  gridPanel(acc, vec(0, 1.18, 0.122), vec(1, 0, 0), vec(0, 1, -0.02), 0.038, 0.3, nu, nu + 2, 'torso', 3)
}

function jacketHem(acc: Acc, radial: number) {
  const a = worldTorsoRing(vec(0, 0.9, 0.012), 0.134, 0.102, 0.008, radial).map(p => pushVertex(acc, p, 'torso'))
  const b = worldTorsoRing(vec(0, 0.865, 0.01), 0.138, 0.104, 0.006, radial).map(p => pushVertex(acc, p, 'torso'))
  stitchRings(acc, a, b, 0)
}

function trouserBreak(acc: Acc, radial: number) {
  tube(acc, add(rest('PELVIS'), vec(0, -0.02, 0)), rest('PELVIS'), { rx: 0.12, rz: 0.09 }, { rx: 0.118, rz: 0.088 }, 2, radial, 'torso', 0)
}

export type HvsBodyGeometryData = {
  positions: Float32Array
  skinIndex: Float32Array
  skinWeight: Float32Array
  indices: Uint32Array
  groups: Array<{ start: number; count: number; materialIndex: number }>
  vertexCount: number
  triangleCount: number
  features: {
    headVerts: number
    neckVerts: number
    shoulderVerts: number
    suitPanelTris: number
    shirtTris: number
    hairVerts: number
    hairTris: number
    browTris: number
    hairHeadLocked: number
    hairlineBreaks: number
    crownClumps: number
    earClearance: number
  }
}

export function silhouetteFeatures(data: Pick<HvsBodyGeometryData, 'positions' | 'groups' | 'skinIndex' | 'skinWeight'>): HvsBodyGeometryData['features'] {
  let headVerts = 0
  let neckVerts = 0
  let shoulderVerts = 0
  let hairHeadLocked = 0
  const verts = data.positions.length / 3
  const hairBone = BONE_INDEX.HEAD
  for (let i = 0; i < verts; i++) {
    const x = data.positions[i * 3]
    const y = data.positions[i * 3 + 1]
    if (y >= 1.62) headVerts += 1
    if (y >= 1.48 && y <= 1.66 && Math.abs(x) < 0.085) neckVerts += 1
    if (y >= 1.38 && y <= 1.56 && Math.abs(x) > 0.09 && Math.abs(x) < 0.3) shoulderVerts += 1
    if (data.skinIndex[i * 4] === hairBone && data.skinIndex[i * 4 + 1] === 0 && data.skinWeight[i * 4] > 0.99) hairHeadLocked += 1
  }
  const shirtTris = data.groups.filter(group => group.materialIndex === 3).reduce((n, group) => n + group.count / 3, 0)
  const suitPanelTris = data.groups.filter(group => group.materialIndex === 0).reduce((n, group) => n + group.count / 3, 0)
  const hairTris = data.groups.filter(group => group.materialIndex === 4).reduce((n, group) => n + group.count / 3, 0)
  return { headVerts, neckVerts, shoulderVerts, suitPanelTris, shirtTris, hairVerts: hairHeadLocked, hairTris, browTris: 0, hairHeadLocked, hairlineBreaks: 0, crownClumps: 0, earClearance: 0 }
}

export function buildStylizedBodyGeometry(quality: 'PRODUCTION' | 'PREVIEW' = 'PRODUCTION'): HvsBodyGeometryData {
  const q = qualityParams(quality)
  const acc = emptyAcc()
  const R = rest
  const oval = (rx: number, rz = rx * 0.72) => ({ rx, rz })

  shapedTorso(acc, q.radial)
  jacketHem(acc, q.radial)
  jacketCollar(acc, q.collar, Math.max(6, q.radial - 2))
  shirtPlacket(acc, q.panel)
  suitLapel(acc, -1, q.panel)
  suitLapel(acc, 1, q.panel)
  trouserBreak(acc, q.radial)
  neckColumn(acc, q.along, q.radial)
  sculptedHead(acc, q.head, q.headRings)
  const browStart = acc.indices.length
  staticBrows(acc)
  const browTris = (acc.indices.length - browStart) / 3
  const hairStats = stylizedHair(acc, Math.max(12, q.head), Math.max(7, q.headRings - 4))
  shoulderGirdle(acc, -1, q)
  shoulderGirdle(acc, 1, q)

  tube(acc, R('LEFT_SHOULDER'), R('LEFT_ELBOW'), oval(0.048, 0.042), oval(0.036, 0.032), q.along + 1, q.radial, 'larm', 0)
  tube(acc, R('LEFT_ELBOW'), R('LEFT_WRIST'), oval(0.034, 0.03), oval(0.026, 0.022), q.along, q.radial, 'larm', 0)
  ellipsoid(acc, add(R('LEFT_WRIST'), vec(-0.01, -0.02, 0.02)), 0.04, 0.028, 0.055, 8, 6, 'larm', 1)

  tube(acc, R('RIGHT_SHOULDER'), R('RIGHT_ELBOW'), oval(0.048, 0.042), oval(0.036, 0.032), q.along + 1, q.radial, 'rarm', 0)
  tube(acc, R('RIGHT_ELBOW'), R('RIGHT_WRIST'), oval(0.034, 0.03), oval(0.026, 0.022), q.along, q.radial, 'rarm', 0)
  ellipsoid(acc, add(R('RIGHT_WRIST'), vec(0.01, -0.02, 0.02)), 0.04, 0.028, 0.055, 8, 6, 'rarm', 1)

  tube(acc, R('PELVIS'), R('LEFT_HIP'), oval(0.11, 0.09), oval(0.078, 0.068), q.along, q.radial, 'lleg', 0)
  tube(acc, R('LEFT_HIP'), R('LEFT_KNEE'), oval(0.076, 0.068), oval(0.05, 0.046), q.along + 1, q.radial, 'lleg', 0)
  tube(acc, R('LEFT_KNEE'), R('LEFT_ANKLE'), oval(0.048, 0.044), oval(0.036, 0.034), q.along, q.radial, 'lleg', 0)
  ellipsoid(acc, add(R('LEFT_FOOT'), vec(0, 0.01, 0.04)), 0.045, 0.032, 0.09, 8, 6, 'lleg', 2)

  tube(acc, R('PELVIS'), R('RIGHT_HIP'), oval(0.11, 0.09), oval(0.078, 0.068), q.along, q.radial, 'rleg', 0)
  tube(acc, R('RIGHT_HIP'), R('RIGHT_KNEE'), oval(0.076, 0.068), oval(0.05, 0.046), q.along + 1, q.radial, 'rleg', 0)
  tube(acc, R('RIGHT_KNEE'), R('RIGHT_ANKLE'), oval(0.048, 0.044), oval(0.036, 0.034), q.along, q.radial, 'rleg', 0)
  ellipsoid(acc, add(R('RIGHT_FOOT'), vec(0, 0.01, 0.04)), 0.045, 0.032, 0.09, 8, 6, 'rleg', 2)

  const positions = new Float32Array(acc.positions)
  const groups = acc.groups
  const skinIndex = new Float32Array(acc.skinIndex)
  const skinWeight = new Float32Array(acc.skinWeight)
  const features = silhouetteFeatures({ positions, groups, skinIndex, skinWeight })
  features.browTris = browTris
  features.hairlineBreaks = hairStats.hairlineBreaks
  features.crownClumps = hairStats.clumps
  features.earClearance = hairStats.earClearance
  return {
    positions,
    skinIndex,
    skinWeight,
    indices: Uint32Array.from(acc.indices),
    groups,
    vertexCount: acc.positions.length / 3,
    triangleCount: acc.indices.length / 3,
    features,
  }
}

export function validateSkinWeights(data: HvsBodyGeometryData): {
  ok: boolean
  nan: number
  unnormalized: number
  overflow: number
  orphan: number
} {
  let nan = 0
  let unnormalized = 0
  let overflow = 0
  let orphan = 0
  const verts = data.vertexCount
  for (let i = 0; i < verts; i++) {
    const w = [data.skinWeight[i * 4], data.skinWeight[i * 4 + 1], data.skinWeight[i * 4 + 2], data.skinWeight[i * 4 + 3]]
    const idx = [data.skinIndex[i * 4], data.skinIndex[i * 4 + 1], data.skinIndex[i * 4 + 2], data.skinIndex[i * 4 + 3]]
    if (w.some(value => !Number.isFinite(value)) || idx.some(value => !Number.isFinite(value))) nan += 1
    const sum = w[0] + w[1] + w[2] + w[3]
    if (Math.abs(sum - 1) > 0.02) unnormalized += 1
    if (idx.some(value => value < 0 || value >= HVS_HUMANOID_BONES.length)) overflow += 1
    if (sum <= 0.001) orphan += 1
  }
  return { ok: nan === 0 && unnormalized === 0 && overflow === 0 && orphan === 0, nan, unnormalized, overflow, orphan }
}

export function bodyProvenance(quality: HvsBodyQuality, data?: HvsBodyGeometryData | null) {
  return {
    id: HVS_STYLIZED_BODY_ID,
    owner: 'HVS' as const,
    generation: 'deterministic-runtime',
    license: 'HVS-original',
    quality,
    rigId: HVS_HUMANOID_RIG_ID,
    boneCount: HVS_HUMANOID_BONES.length,
    materialCount: HVS_BODY_MATERIALS.length,
    vertexCount: data?.vertexCount ?? 0,
    triangleCount: data?.triangleCount ?? 0,
    bodyProportionSource: HVS_NEUTRAL_HUMANOID,
    wardrobeNote: HVS_PREVIEW_WARDROBE_NOTE,
    grooming: HVS_HEAD_GROOMING,
    bakedAnimation: false,
    photoreal: false,
    faces: false,
    fingers: false,
  }
}

function lookQuat(from: Vec, to: Vec): Quaternion {
  _dir.set(to.x - from.x, to.y - from.y, to.z - from.z)
  if (_dir.lengthSq() < 1e-8) return _quat.identity()
  _dir.normalize()
  return _quat.setFromUnitVectors(Y_UP, _dir).clone()
}

export function jointOf(pose: CompactHumanoidPose | null | undefined, bone: HvsHumanoidBone): Vec {
  if (!pose) return rest(bone)
  return compactJoint(pose, bone)
}

export function poseBoneWorld(pose: CompactHumanoidPose | null, bone: HvsHumanoidBone): { position: Vec; quaternion: Quaternion; scale: Vec } {
  const from = jointOf(pose, bone)
  const kids = CHILDREN[bone]
  let to: Vec
  if (kids[0]) to = jointOf(pose, kids[0])
  else {
    const parent = HVS_HUMANOID_PARENT[bone]
    if (parent) {
      const prev = jointOf(pose, parent)
      to = add(from, nrm(sub(from, prev)))
    } else to = add(from, vec(0, 1, 0))
  }
  let scale = 1
  if (bone === 'LEFT_SHOULDER' || bone === 'LEFT_CLAVICLE') {
    const raise = Math.max(0, Math.min(1, (jointOf(pose, 'LEFT_ELBOW').y - jointOf(pose, 'LEFT_SHOULDER').y + 0.12) / 0.35))
    scale = 1 + raise * 0.06
  }
  if (bone === 'RIGHT_SHOULDER' || bone === 'RIGHT_CLAVICLE') {
    const raise = Math.max(0, Math.min(1, (jointOf(pose, 'RIGHT_ELBOW').y - jointOf(pose, 'RIGHT_SHOULDER').y + 0.12) / 0.35))
    scale = 1 + raise * 0.06
  }
  const quaternion = lookQuat(from, to)
  if (bone === 'HEAD' && pose) {
    quaternion.multiply(_headExtra.setFromEuler(_euler.set(pose.head[1] * 0.6, pose.head[0] * 0.9, pose.head[2] * 0.4, 'YXZ')))
  }
  return { position: from, quaternion, scale: vec(scale, 1, scale) }
}

function placeCapsule(mesh: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const a = new Vector3(ax, ay, az)
  const b = new Vector3(bx, by, bz)
  _dir.subVectors(b, a)
  const length = Math.max(0.02, _dir.length())
  mesh.scale.set(1, length, 1)
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(Y_UP, _dir.normalize())
}

function capsuleFallback(): Group {
  const group = new Group()
  const suit = new MeshStandardMaterial({ color: '#1c1c22', metalness: 0.18, roughness: 0.55 })
  const skin = new MeshStandardMaterial({ color: '#c4b49a', metalness: 0.04, roughness: 0.7 })
  const shoe = new MeshStandardMaterial({ color: '#111114', metalness: 0.2, roughness: 0.45 })
  const segments: Mesh[] = []
  for (const [start, end, kind] of HVS_HUMANOID_SEGMENTS) {
    const a = HVS_NEUTRAL_REST[start]
    const b = HVS_NEUTRAL_REST[end]
    const radius = kind === 'torso' ? 0.075 : kind === 'head' ? 0.055 : kind === 'arm' ? 0.038 : kind === 'foot' ? 0.032 : 0.048
    const mesh = new Mesh(new CylinderGeometry(radius, radius * 0.92, 1, 8), kind === 'head' ? skin : kind === 'foot' ? shoe : suit)
    placeCapsule(mesh, a.x, a.y, a.z, b.x, b.y, b.z)
    mesh.userData.seg = { start, end }
    segments.push(mesh)
    group.add(mesh)
  }
  const head = new Mesh(new SphereGeometry(0.11, 12, 10), skin)
  head.position.set(HVS_NEUTRAL_REST.HEAD.x, HVS_NEUTRAL_REST.HEAD.y, HVS_NEUTRAL_REST.HEAD.z)
  head.userData.head = true
  group.add(head)
  group.userData.placeholder = true
  group.userData.rig = HVS_HUMANOID_RIG_ID
  group.userData.humanoid = { kind: 'proxy', quality: 'LOW', segments, head }
  return group
}

function stylizedMaterials() {
  const suit = new MeshStandardMaterial({
    color: new Color('#23242c'),
    roughness: 0.56,
    metalness: 0.14,
    emissive: new Color('#0c0d14'),
    emissiveIntensity: 0.16,
  })
  const skin = new MeshStandardMaterial({
    color: new Color('#d0ba9e'),
    roughness: 0.68,
    metalness: 0.025,
    emissive: new Color('#2a1c12'),
    emissiveIntensity: 0.1,
  })
  const shoes = new MeshStandardMaterial({
    color: new Color('#0c0c0f'),
    roughness: 0.38,
    metalness: 0.3,
  })
  const shirt = new MeshStandardMaterial({
    color: new Color('#3a3e4c'),
    roughness: 0.64,
    metalness: 0.08,
    emissive: new Color('#0a0b10'),
    emissiveIntensity: 0.08,
  })
  const hair = new MeshStandardMaterial({
    color: new Color('#1c1814'),
    roughness: 0.46,
    metalness: 0.07,
    emissive: new Color('#2a2218'),
    emissiveIntensity: 0.16,
  })
  return [suit, skin, shoes, shirt, hair]
}

export function createHvsStylizedBody(quality: HvsBodyQuality = 'PRODUCTION'): Group {
  if (quality === 'LOW') return capsuleFallback()
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const data = buildStylizedBodyGeometry(quality)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('skinIndex', new BufferAttribute(Uint16Array.from(data.skinIndex), 4))
  geometry.setAttribute('skinWeight', new BufferAttribute(data.skinWeight, 4))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  for (const group of data.groups) geometry.addGroup(group.start, group.count, group.materialIndex)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const bones = HVS_HUMANOID_BONES.map(name => {
    const bone = new Bone()
    bone.name = name
    const posed = poseBoneWorld(null, name)
    bone.position.set(posed.position.x, posed.position.y, posed.position.z)
    bone.quaternion.copy(posed.quaternion)
    bone.scale.set(posed.scale.x, posed.scale.y, posed.scale.z)
    return bone
  })
  const skeleton = new Skeleton(bones)

  const mesh = new SkinnedMesh(geometry, stylizedMaterials())
  mesh.name = HVS_STYLIZED_BODY_ID
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  mesh.normalizeSkinWeights()

  const group = new Group()
  group.name = 'hvs-stylized-body'
  for (const bone of bones) group.add(bone)
  group.add(mesh)
  group.updateMatrixWorld(true)
  skeleton.calculateInverses()
  mesh.bind(skeleton)

  const sclera = new MeshStandardMaterial({ color: '#efe6d8', roughness: 0.32, metalness: 0.03, emissive: '#3a342c', emissiveIntensity: 0.04 })
  const iris = new MeshStandardMaterial({ color: '#3a2c22', roughness: 0.28, metalness: 0.06 })
  const pupil = new MeshStandardMaterial({ color: '#0b0908', roughness: 0.18, metalness: 0.04 })
  const lid = new MeshStandardMaterial({ color: '#c4a88c', roughness: 0.68, metalness: 0.03 })
  const tear = new MeshStandardMaterial({ color: '#f2ebe2', roughness: 0.18, metalness: 0.08, emissive: '#fff6ea', emissiveIntensity: 0.35 })
  function staticEye(side: -1 | 1) {
    const eye = new Group()
    eye.userData.staticEye = side < 0 ? 'left' : 'right'
    eye.userData.gaze = false
    const white = new Mesh(new SphereGeometry(0.014, 12, 10), sclera)
    white.scale.set(1, 0.9, 0.72)
    const color = new Mesh(new SphereGeometry(0.0076, 12, 10), iris)
    color.position.set(0, 0.0005, 0.007)
    color.scale.set(1, 1, 0.42)
    const dark = new Mesh(new SphereGeometry(0.0036, 10, 8), pupil)
    dark.position.set(0, 0.0005, 0.0104)
    const upper = new Mesh(new SphereGeometry(0.0158, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), lid)
    upper.rotation.x = 0.58
    upper.position.set(0, 0.0035, -0.001)
    const lower = new Mesh(new SphereGeometry(0.015, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.3), lid)
    lower.rotation.x = Math.PI + 0.22
    lower.position.set(0, -0.0055, 0.001)
    const shine = new Mesh(new SphereGeometry(0.0024, 6, 4), tear)
    shine.position.set(side * -0.005, -0.004, 0.011)
    eye.add(white, color, dark, upper, lower, shine)
    return eye
  }
  const leftEye = staticEye(-1)
  const rightEye = staticEye(1)
  group.add(leftEye, rightEye)

  const createdMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started
  group.userData.placeholder = false
  group.userData.rig = HVS_HUMANOID_RIG_ID
  group.userData.humanoid = {
    kind: 'skinned',
    quality,
    skeleton,
    mesh,
    bones,
    eyes: [leftEye, rightEye],
    grooming: HVS_HEAD_GROOMING,
    geometry: data,
    createdMs,
    provenance: bodyProvenance(quality, data),
  }
  applyStylizedBodyPose(group, null)
  return group
}

export function applyStylizedBodyPose(group: Group, pose: CompactHumanoidPose | null) {
  const humanoid = group.userData.humanoid as {
    kind: 'skinned' | 'proxy'
    skeleton?: Skeleton
    bones?: Bone[]
    mesh?: SkinnedMesh
    eyes?: Group[]
    segments?: Mesh[]
    head?: Mesh
  } | undefined
  if (!humanoid) return
  if (humanoid.kind === 'proxy') {
    if (!humanoid.segments || !humanoid.head) return
    for (const mesh of humanoid.segments) {
      const start = mesh.userData.seg.start as HvsHumanoidBone
      const end = mesh.userData.seg.end as HvsHumanoidBone
      const a = jointOf(pose, start)
      const b = jointOf(pose, end)
      placeCapsule(mesh, a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const headJoint = jointOf(pose, 'HEAD')
    humanoid.head.position.set(headJoint.x, headJoint.y, headJoint.z)
    if (pose) humanoid.head.rotation.set(pose.head[1], pose.head[0], pose.head[2])
    return
  }
  if (!humanoid.bones || !humanoid.skeleton) return
  for (const bone of humanoid.bones) {
    const posed = poseBoneWorld(pose, bone.name as HvsHumanoidBone)
    bone.position.set(posed.position.x, posed.position.y, posed.position.z)
    bone.quaternion.copy(posed.quaternion)
    bone.scale.set(posed.scale.x, posed.scale.y, posed.scale.z)
  }
  const posedHead = poseBoneWorld(pose, 'HEAD')
  if (humanoid.eyes) {
    const leftLocal = vec(-0.03, 0.004, 0.078)
    const rightLocal = vec(0.03, 0.004, 0.078)
    const left = add(posedHead.position, rotateBy(posedHead.quaternion, leftLocal))
    const right = add(posedHead.position, rotateBy(posedHead.quaternion, rightLocal))
    humanoid.eyes[0].position.set(left.x, left.y, left.z)
    humanoid.eyes[1].position.set(right.x, right.y, right.z)
    humanoid.eyes[0].quaternion.copy(posedHead.quaternion)
    humanoid.eyes[1].quaternion.copy(posedHead.quaternion)
  }
  if (humanoid.mesh?.geometry.boundingSphere) {
    const box = bodyBoundsFromPose(pose)
    humanoid.mesh.geometry.boundingSphere.center.set(box.center.x, box.center.y, box.center.z)
    humanoid.mesh.geometry.boundingSphere.radius = box.radius
  }
}

export function bodyBoundsFromPose(pose: CompactHumanoidPose | null): { center: Vec; radius: number } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const bone of HVS_HUMANOID_BONES) {
    const p = jointOf(pose, bone)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    maxZ = Math.max(maxZ, p.z)
  }
  const center = vec((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
  const radius = Math.max(0.4, len(sub(vec(maxX, maxY + 0.08, maxZ), center)) + 0.34)
  return { center, radius }
}

export function boneWorldMatrixAt(pose: CompactHumanoidPose | null, bone: HvsHumanoidBone): Matrix4 {
  const posed = poseBoneWorld(pose, bone)
  return _mat.compose(
    _pos.set(posed.position.x, posed.position.y, posed.position.z),
    posed.quaternion,
    _scale.set(posed.scale.x, posed.scale.y, posed.scale.z),
  ).clone()
}

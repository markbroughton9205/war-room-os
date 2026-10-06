/**
 * Deterministic landmark → HVS humanoid retarget.
 * Source HvsLandmarkFrame arrays are not mutated.
 * Root motion is relative. metricLocomotion stays false.
 */
import type { MediaTime } from '../time'
import { HVS_PLACEHOLDER_RETARGET, placeholderRetargetMap } from './retarget'
import {
  HVS_HUMANOID_BONES,
  HVS_HUMANOID_PARENT,
  HVS_LANDMARK_TO_BONE,
  HVS_NEUTRAL_REST,
  HVS_NEUTRAL_SHOULDER_WIDTH,
  type HvsHumanoidBone,
} from './humanoid-rig'
import {
  HVS_HUMANOID_RIG_ID,
  HVS_HUMANOID_RIG_V1,
  HVS_NEUTRAL_HUMANOID,
  HVS_PRODUCTION_BODY_PREVIEW,
  type HvsCaptureCalibration,
  type HvsLandmarkFrame,
  type HvsLandmarkPoint,
  type HvsVec3,
} from './types'

export type { HvsVec3 }

export type HvsHumanoidPoseFrame = {
  time: MediaTime
  root: HvsVec3
  joints: Partial<Record<HvsHumanoidBone, HvsVec3>>
  head: { yaw: number; pitch: number; roll: number }
  source: 'LANDMARK' | 'HELD'
  metricLocomotion: false
}

function joint(frame: HvsLandmarkFrame, name: string): HvsLandmarkPoint | undefined {
  return frame.bodyLandmarks.find(point => point.canonicalName === name)
}

function shoulderWidth(frame: HvsLandmarkFrame): number | null {
  const left = joint(frame, 'LEFT_SHOULDER')
  const right = joint(frame, 'RIGHT_SHOULDER')
  if (!left || !right) return null
  const width = Math.hypot(left.x - right.x, left.y - right.y)
  return width > 0.001 ? width : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function add(a: HvsVec3, b: HvsVec3): HvsVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function sub(a: HvsVec3, b: HvsVec3): HvsVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(a: HvsVec3, s: number): HvsVec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

function length(a: HvsVec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

function normalize(a: HvsVec3): HvsVec3 {
  const mag = length(a)
  if (mag < 1e-6) return { x: 0, y: 1, z: 0 }
  return scale(a, 1 / mag)
}

function restLength(parent: HvsHumanoidBone, child: HvsHumanoidBone): number {
  return Math.max(0.02, length(sub(HVS_NEUTRAL_REST[child], HVS_NEUTRAL_REST[parent])))
}

/**
 * Image (x right, y down) → rig (x right, y up, z forward).
 * z from raise is a conservative 2.5D lift, not metric depth or IK.
 */
function toRig(point: HvsLandmarkPoint, origin: { x: number; y: number }, unit: number, lift = 0): HvsVec3 {
  const x = ((point.x - origin.x) / unit) * HVS_NEUTRAL_SHOULDER_WIDTH
  const y = ((origin.y - point.y) / unit) * HVS_NEUTRAL_SHOULDER_WIDTH + HVS_NEUTRAL_REST.PELVIS.y
  const z = clamp(lift, -0.25, 0.45)
  return {
    x: clamp(x, -1.6, 1.6),
    y: clamp(y, 0, 2.4),
    z,
  }
}

function raiseLift(shoulder?: HvsLandmarkPoint, distal?: HvsLandmarkPoint): number {
  if (!shoulder || !distal) return 0.02
  return clamp((shoulder.y - distal.y) * 0.55, -0.05, 0.42)
}

function holdOrExtend(
  child: HvsHumanoidBone,
  parent: HvsHumanoidBone | null,
  joints: Partial<Record<HvsHumanoidBone, HvsVec3>>,
  last: Partial<Record<HvsHumanoidBone, HvsVec3>>,
): HvsVec3 {
  if (joints[child]) return joints[child] as HvsVec3
  if (last[child] && parent && joints[parent]) {
    const prevParent = last[parent] ?? HVS_NEUTRAL_REST[parent]
    const prevChild = last[child] as HvsVec3
    const direction = normalize(sub(prevChild, prevParent))
    return add(joints[parent] as HvsVec3, scale(direction, restLength(parent, child)))
  }
  if (parent && joints[parent]) {
    return add(joints[parent] as HvsVec3, sub(HVS_NEUTRAL_REST[child], HVS_NEUTRAL_REST[parent]))
  }
  return last[child] ?? HVS_NEUTRAL_REST[child]
}

function deriveSpine(pelvis: HvsVec3, chest: HvsVec3): { spine01: HvsVec3; spine02: HvsVec3 } {
  return {
    spine01: {
      x: pelvis.x * 0.66 + chest.x * 0.34,
      y: pelvis.y * 0.66 + chest.y * 0.34,
      z: pelvis.z * 0.66 + chest.z * 0.34,
    },
    spine02: {
      x: pelvis.x * 0.33 + chest.x * 0.67,
      y: pelvis.y * 0.33 + chest.y * 0.67,
      z: pelvis.z * 0.33 + chest.z * 0.67,
    },
  }
}

function footFromAnkle(ankle: HvsVec3, knee: HvsVec3 | undefined): HvsVec3 {
  const forward = knee ? normalize({ x: ankle.x - knee.x, y: 0, z: Math.max(0.04, Math.abs(ankle.z - (knee.z ?? 0)) + 0.08) }) : { x: 0, y: 0, z: 1 }
  return { x: ankle.x + forward.x * 0.09, y: Math.max(0.02, ankle.y - 0.05), z: ankle.z + forward.z * 0.1 }
}

export function retargetHumanoid(
  frames: HvsLandmarkFrame[],
  calibration?: HvsCaptureCalibration | null,
): HvsHumanoidPoseFrame[] {
  const originFrame = frames.find(frame => joint(frame, 'PELVIS')) ?? frames.find(frame => frame.bodyLandmarks.length > 0) ?? null
  const originPelvis = originFrame ? joint(originFrame, 'PELVIS') : undefined
  const origin = originPelvis ?? { x: 0.5, y: 0.55 }
  const unit = calibration?.shoulderWidthNormalized || (originFrame ? shoulderWidth(originFrame) : null) || 0.2
  let last: Partial<Record<HvsHumanoidBone, HvsVec3>> = { ...HVS_NEUTRAL_REST }
  const poses: HvsHumanoidPoseFrame[] = []
  for (const frame of frames) {
    const joints: Partial<Record<HvsHumanoidBone, HvsVec3>> = {}
    let source: HvsHumanoidPoseFrame['source'] = frame.bodyLandmarks.length ? 'LANDMARK' : 'HELD'
    for (const [landmark, bone] of Object.entries(HVS_LANDMARK_TO_BONE)) {
      const point = joint(frame, landmark)
      if (!point) continue
      const shoulder = landmark.includes('WRIST') || landmark.includes('ELBOW')
        ? joint(frame, landmark.startsWith('LEFT') ? 'LEFT_SHOULDER' : 'RIGHT_SHOULDER')
        : undefined
      joints[bone] = toRig(point, origin, unit, raiseLift(shoulder, point))
    }
    const pelvis = joints.PELVIS ?? holdOrExtend('PELVIS', 'ROOT', joints, last)
    const chest = joints.CHEST ?? holdOrExtend('CHEST', 'PELVIS', { ...joints, PELVIS: pelvis }, last)
    joints.PELVIS = pelvis
    joints.CHEST = chest
    const spine = deriveSpine(pelvis, chest)
    joints.SPINE_01 = spine.spine01
    joints.SPINE_02 = spine.spine02
    joints.ROOT = { x: pelvis.x, y: 0, z: pelvis.z }
    if (joints.LEFT_SHOULDER) {
      joints.LEFT_CLAVICLE = {
        x: chest.x * 0.45 + joints.LEFT_SHOULDER.x * 0.55,
        y: chest.y * 0.35 + joints.LEFT_SHOULDER.y * 0.65,
        z: chest.z * 0.5 + joints.LEFT_SHOULDER.z * 0.5,
      }
    }
    if (joints.RIGHT_SHOULDER) {
      joints.RIGHT_CLAVICLE = {
        x: chest.x * 0.45 + joints.RIGHT_SHOULDER.x * 0.55,
        y: chest.y * 0.35 + joints.RIGHT_SHOULDER.y * 0.65,
        z: chest.z * 0.5 + joints.RIGHT_SHOULDER.z * 0.5,
      }
    }
    const filled: Partial<Record<HvsHumanoidBone, HvsVec3>> = { ...joints }
    for (const bone of HVS_HUMANOID_BONES) {
      if (filled[bone]) continue
      if (bone === 'LEFT_FOOT' && filled.LEFT_ANKLE) filled[bone] = footFromAnkle(filled.LEFT_ANKLE, filled.LEFT_KNEE)
      else if (bone === 'RIGHT_FOOT' && filled.RIGHT_ANKLE) filled[bone] = footFromAnkle(filled.RIGHT_ANKLE, filled.RIGHT_KNEE)
      else filled[bone] = holdOrExtend(bone, HVS_HUMANOID_PARENT[bone], filled, last)
    }
    if (!frame.bodyLandmarks.length) source = 'HELD'
    const root = {
      x: (filled.PELVIS?.x ?? 0) - HVS_NEUTRAL_REST.PELVIS.x,
      y: 0,
      z: (filled.PELVIS?.z ?? 0) - HVS_NEUTRAL_REST.PELVIS.z,
    }
    poses.push({
      time: frame.time,
      root,
      joints: filled,
      head: {
        yaw: clamp(frame.headPose?.yaw ?? 0, -0.6, 0.6),
        pitch: clamp(frame.headPose?.pitch ?? 0, -0.35, 0.35),
        roll: clamp(frame.headPose?.roll ?? 0, -0.25, 0.25),
      },
      source,
      metricLocomotion: false,
    })
    last = filled
  }
  return poses
}

export function humanoidPreviewPayload(frames: HvsLandmarkFrame[], calibration?: HvsCaptureCalibration | null) {
  const poses = retargetHumanoid(frames, calibration)
  const tracked = poses.filter(pose => pose.source === 'LANDMARK')
  return {
    honesty: HVS_PRODUCTION_BODY_PREVIEW,
    characterHonesty: HVS_PRODUCTION_BODY_PREVIEW,
    rigId: HVS_HUMANOID_RIG_ID,
    rigType: HVS_HUMANOID_RIG_V1,
    bodyProportionSource: HVS_NEUTRAL_HUMANOID,
    wardrobeNote: 'PREVIEW WARDROBE REPRESENTATION',
    photoreal: false,
    metricLocomotion: false as const,
    fallback: HVS_PLACEHOLDER_RETARGET,
    placeholder: placeholderRetargetMap().id,
    atRest: tracked.length === 0,
    poses,
    leftArmRaise: leftArmTravel(poses) >= 0.12,
    rootTravel: rootTravel(poses),
    lowerBodyPresent: poses.some(pose => pose.joints.LEFT_ANKLE && pose.joints.RIGHT_ANKLE && pose.joints.LEFT_KNEE && pose.joints.RIGHT_KNEE),
  }
}

export function leftArmTravel(poses: HvsHumanoidPoseFrame[]): number {
  const values = poses.map(pose => {
    const shoulder = pose.joints.LEFT_SHOULDER
    const wrist = pose.joints.LEFT_WRIST
    if (!shoulder || !wrist) return 0
    return shoulder.y - wrist.y
  })
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}

export function rootTravel(poses: HvsHumanoidPoseFrame[]): number {
  const xs = poses.map(pose => pose.root.x)
  return xs.length ? Math.max(...xs) - Math.min(...xs) : 0
}

export function compactHumanoidPoses(poses: HvsHumanoidPoseFrame[]) {
  return poses.map(pose => ({
    ticks: pose.time.ticks,
    timescale: pose.time.timescale,
    root: [pose.root.x, pose.root.y, pose.root.z] as [number, number, number],
    head: [pose.head.yaw, pose.head.pitch, pose.head.roll] as [number, number, number],
    joints: Object.fromEntries(
      Object.entries(pose.joints)
        .filter((entry): entry is [string, HvsVec3] => Boolean(entry[1]))
        .map(([name, value]) => [name, [value.x, value.y, value.z] as [number, number, number]]),
    ),
  }))
}

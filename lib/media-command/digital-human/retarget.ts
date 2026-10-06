/**
 * Rig-neutral performance retarget.
 * The performance record stays canonical. This map is an adapter.
 * NO_RIG uses HVS_PLACEHOLDER_RETARGET and does not invent metric walking distance.
 */
import { sceneTime } from '../director/clock'
import { dhId } from './types'
import type {
  HvsCaptureCalibration,
  HvsCrowdMotionUse,
  HvsDigitalHumanStore,
  HvsLandmarkFrame,
  HvsLandmarkPoint,
  HvsPerformanceEdit,
  HvsPerformanceMotion,
  HvsPerformanceRetargetSample,
  HvsPerformanceTake,
} from './types'

export const HVS_PLACEHOLDER_RETARGET = 'HVS_PLACEHOLDER_RETARGET' as const

export const PERFORMANCE_SPEEDS = [
  { label: '0.5x', n: 1, d: 2 },
  { label: '0.75x', n: 3, d: 4 },
  { label: '1x', n: 1, d: 1 },
  { label: '1.25x', n: 5, d: 4 },
  { label: '1.5x', n: 3, d: 2 },
  { label: '2x', n: 2, d: 1 },
] as const

export type HvsPerformanceRetargetMap = {
  id: typeof HVS_PLACEHOLDER_RETARGET
  label: 'PLACEHOLDER RETARGET'
  rigState: 'NO_RIG'
  honesty: 'PLACEHOLDER RETARGET'
  bodyScale: number
  metricLocomotion: false
  trainsIdentity: false
  jointMap: Record<string, { node: string; channel: 'rotation' | 'position' }>
  faceMap: Record<string, string>
}

export function placeholderRetargetMap(): HvsPerformanceRetargetMap {
  return {
    id: HVS_PLACEHOLDER_RETARGET,
    label: 'PLACEHOLDER RETARGET',
    rigState: 'NO_RIG',
    honesty: 'PLACEHOLDER RETARGET',
    bodyScale: 1,
    metricLocomotion: false,
    trainsIdentity: false,
    jointMap: {
      PELVIS: { node: 'root', channel: 'position' },
      CHEST: { node: 'spine', channel: 'rotation' },
      HEAD: { node: 'head', channel: 'rotation' },
      LEFT_WRIST: { node: 'left_arm', channel: 'rotation' },
      RIGHT_WRIST: { node: 'right_arm', channel: 'rotation' },
    },
    faceMap: {
      eyeOpenness: 'eye',
      blink: 'blink',
      brow: 'brow',
      mouthOpenness: 'jaw',
      smile: 'mouth',
      jawOpenness: 'jaw',
    },
  }
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

export function neutralCalibration(frames: HvsLandmarkFrame[], characterId: string | null): HvsCaptureCalibration {
  const frame = frames.find(item => shoulderWidth(item) != null) ?? null
  const pelvis = frame ? joint(frame, 'PELVIS') : undefined
  return {
    id: dhId('cal'),
    characterId,
    shoulderWidthNormalized: frame ? shoulderWidth(frame) : null,
    center: pelvis ? { x: pelvis.x, y: pelvis.y } : null,
    framing: frame ? 'NEUTRAL_POSE' : null,
    orientationYaw: frame?.headPose?.yaw ?? null,
    kind: 'NEUTRAL_POSE',
    biometricEnrollment: false,
  }
}

export function retargetSamples(
  frames: HvsLandmarkFrame[],
  map: HvsPerformanceRetargetMap = placeholderRetargetMap(),
  calibration?: HvsCaptureCalibration | null,
): HvsPerformanceRetargetSample[] {
  const origin = frames.find(frame => joint(frame, 'PELVIS')) ?? null
  const originPelvis = origin ? joint(origin, 'PELVIS') : undefined
  const unit = calibration?.shoulderWidthNormalized || (origin ? shoulderWidth(origin) : null) || 1
  return frames.map(frame => {
    const pelvis = joint(frame, 'PELVIS')
    const chest = joint(frame, 'CHEST')
    const leftShoulder = joint(frame, 'LEFT_SHOULDER')
    const rightShoulder = joint(frame, 'RIGHT_SHOULDER')
    const leftWrist = joint(frame, 'LEFT_WRIST')
    const rightWrist = joint(frame, 'RIGHT_WRIST')
    const raise = (shoulder?: HvsLandmarkPoint, wrist?: HvsLandmarkPoint) => {
      if (!shoulder || !wrist) return 0
      return Math.max(-1.5, Math.min(1.5, (shoulder.y - wrist.y) / unit)) * map.bodyScale
    }
    return {
      time: frame.time,
      root: {
        x: pelvis && originPelvis ? ((pelvis.x - originPelvis.x) / unit) * map.bodyScale : 0,
        y: 0,
        z: 0,
      },
      rootSource: 'RELATIVE_INTENT',
      metricLocomotion: false,
      lean: pelvis && chest ? Math.max(-1, Math.min(1, (chest.x - pelvis.x) / unit)) * map.bodyScale : 0,
      head: {
        yaw: frame.headPose?.yaw ?? 0,
        pitch: frame.headPose?.pitch ?? 0,
        roll: frame.headPose?.roll ?? 0,
      },
      leftArm: raise(leftShoulder, leftWrist),
      rightArm: raise(rightShoulder, rightWrist),
    }
  })
}

export function previewPerformance(input: { characterId: string | null; frames: HvsLandmarkFrame[]; calibration?: HvsCaptureCalibration | null }) {
  const tracked = input.frames.filter(frame => frame.bodyLandmarks.length > 0)
  const samples = retargetSamples(tracked, placeholderRetargetMap(), input.calibration)
  return {
    characterId: input.characterId,
    honesty: 'PLACEHOLDER RETARGET' as const,
    photoreal: false,
    rig: 'NO_RIG' as const,
    samples,
    atRest: samples.length === 0,
    label: samples.length === 0
      ? (input.frames.length ? 'No person was detected.' : 'MODEL REQUIRED')
      : 'PLACEHOLDER RETARGET',
  }
}

export function derivePerformanceEdit(store: HvsDigitalHumanStore, input: {
  take: HvsPerformanceTake
  trimStartSec?: number | null
  trimEndSec?: number | null
  speed?: { n: number; d: number }
  mirror?: boolean
  loop?: boolean
  allowLoop?: boolean
}): HvsPerformanceEdit {
  const speed = input.speed ?? { n: 1, d: 1 }
  if (!PERFORMANCE_SPEEDS.some(item => item.n === speed.n && item.d === speed.d)) {
    throw new Error('Performance speed must be one of the rational presets.')
  }
  const edit: HvsPerformanceEdit = {
    id: dhId('edit'),
    sourceTakeId: input.take.id,
    sourceMotionRef: input.take.motionRef,
    derivedMotionRef: dhId('derived'),
    trimStart: input.trimStartSec == null ? null : sceneTime(input.trimStartSec),
    trimEnd: input.trimEndSec == null ? null : sceneTime(input.trimEndSec),
    speed,
    mirror: input.mirror ?? false,
    loop: Boolean(input.loop && input.allowLoop),
    mutatesSource: false,
  }
  store.performanceEdits.push(edit)
  return edit
}

function mix(seed: number, index: number): number {
  return Math.abs(Math.imul(seed ^ (index + 1), 2654435761)) >>> 0
}

export function reuseCrowdMotion(store: HvsDigitalHumanStore, input: {
  take: HvsPerformanceTake
  populationId: string
  instanceIds: string[]
  seed: number
}): HvsCrowdMotionUse[] {
  const uses = input.instanceIds.map((instanceId, index) => {
    const mixed = mix(input.seed, index)
    const speed = PERFORMANCE_SPEEDS[mixed % PERFORMANCE_SPEEDS.length]
    const use: HvsCrowdMotionUse = {
      id: dhId('crowd-motion'),
      sourceTakeId: input.take.id,
      rawAssetId: input.take.rawAssetId,
      populationId: input.populationId,
      instanceId,
      timeOffset: sceneTime((mixed % 17) / 10),
      speed: { n: speed.n, d: speed.d },
      mirror: (mixed & 1) === 1,
      phase: (mixed % 100) / 100,
      seed: input.seed,
    }
    return use
  })
  if (uses.length > 1) {
    const same = uses.every(use => use.mirror === uses[0].mirror && use.speed.n === uses[0].speed.n && use.timeOffset.ticks === uses[0].timeOffset.ticks)
    if (same) {
      uses[1] = { ...uses[1], mirror: !uses[1].mirror, speed: PERFORMANCE_SPEEDS[1] }
    }
  }
  store.crowdMotionUses.push(...uses)
  return uses
}

export function performanceQc(motion: HvsPerformanceMotion) {
  const frames = motion.landmarkFrames ?? []
  const needed = ['HEAD', 'LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_WRIST', 'PELVIS']
  const present = new Set(frames.flatMap(frame => frame.bodyLandmarks.map(point => point.canonicalName)))
  const missingJoints = needed.filter(name => !present.has(name))
  let jitter = 0
  let jumps = 0
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1].bodyLandmarks.find(point => point.canonicalName === 'HEAD')
    const next = frames[index].bodyLandmarks.find(point => point.canonicalName === 'HEAD')
    if (!previous || !next) continue
    const delta = Math.hypot(next.x - previous.x, next.y - previous.y)
    jitter += delta
    if (delta > 0.08) jumps += 1
  }
  const compared = Math.max(1, frames.length - 1)
  return {
    coverage: motion.confidence?.frameTrackingCoverage ?? motion.confidence?.trackingCoverage ?? 0,
    fullBodyCoverage: motion.confidence?.fullBodyCoverage ?? 0,
    confidence: motion.confidence ?? null,
    missingJoints,
    excessiveJitter: frames.length > 1 && jitter / compared > 0.08,
    jitterJumps: jumps,
    headTrackingLoss: frames.length > 0 && frames.some(frame => !frame.headPose),
    faceTrackingLoss: frames.length > 0 && frames.every(frame => frame.faceLandmarks.length === 0),
    frameDrops: motion.evidence?.droppedFrames ?? 0,
    durationTicks: motion.duration.ticks,
    timescale: motion.duration.timescale,
    failure: motion.failure ?? null,
  }
}

export function captureStorageBytes(input: { rawBytes: number; landmarkBytes: number; motionBytes: number; previewBytes: number }) {
  return { ...input, embeddedInProject: false }
}

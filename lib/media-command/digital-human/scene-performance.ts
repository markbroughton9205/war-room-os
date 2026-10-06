/**
 * Director scene clock → performance-relative TAKE sample → humanoid pose.
 * Not a second timeline, clock, or animation system.
 * Source frames are never mutated. Float seconds are renderer-boundary only.
 */
import { convertTime, mediaTime, type MediaTime } from '../time'
import { HVS_HUMANOID_BONES, HVS_NEUTRAL_REST, type HvsHumanoidBone } from './humanoid-rig'
import { HVS_HUMANOID_RIG_ID, HVS_HUMANOID_RIG_V1 } from './types'

/** Two captured frames at 30fps on the shared 24000 timescale. Matches existing landmark maxGap. */
export const HVS_PERFORMANCE_MAX_GAP_TICKS = 1600

export type HvsPerformancePlayback = 'ONCE' | 'HOLD_LAST' | 'LOOP'

export type CompactHumanoidPose = {
  ticks: number
  timescale: number
  root: [number, number, number]
  head: [number, number, number]
  joints: Record<string, [number, number, number]>
}

export type HvsPerformancePhase = 'REST' | 'PLAY' | 'HOLD'

export type HvsDirectorPerformanceTrack = {
  characterId: string
  nodeId: string
  digitalHumanId: string | null
  takeId: string
  motionId: string
  rigId: string
  retargetProfile: string
  startTime: MediaTime
  takeDuration: MediaTime
  lastSampleTicks: number
  policy: HvsPerformancePlayback
  poses: CompactHumanoidPose[]
}

export function humanoidPoseCacheKey(rigId: string, takeId: string, motionId: string, profile: string): string {
  return `${rigId}|${takeId}|${motionId}|${profile}`
}

export const HVS_DEFAULT_PERFORMANCE_PLAYBACK: HvsPerformancePlayback = 'HOLD_LAST'

export function restCompactPose(timescale: number): CompactHumanoidPose {
  const joints: Record<string, [number, number, number]> = {}
  for (const bone of HVS_HUMANOID_BONES) {
    const value = HVS_NEUTRAL_REST[bone]
    joints[bone] = [value.x, value.y, value.z]
  }
  return {
    ticks: 0,
    timescale,
    root: [0, 0, 0],
    head: [0, 0, 0],
    joints,
  }
}

export function mapSceneTimeToPerformance(input: {
  sceneTime: MediaTime
  startTime: MediaTime
  takeDuration: MediaTime
  lastSampleTicks: number
  policy: HvsPerformancePlayback
}): { phase: HvsPerformancePhase; performanceTicks: number; timescale: number } {
  const timescale = input.sceneTime.timescale > 0 ? input.sceneTime.timescale : 24_000
  const start = convertTime(input.startTime, timescale)
  const duration = convertTime(input.takeDuration, timescale)
  const last = mediaTime(input.lastSampleTicks, input.takeDuration.timescale || timescale)
  const lastTicks = convertTime(last, timescale).ticks
  const relative = input.sceneTime.ticks - start.ticks
  if (relative < 0) {
    return { phase: 'REST', performanceTicks: 0, timescale }
  }
  if (input.policy === 'LOOP' && duration.ticks > 0) {
    const mod = ((relative % duration.ticks) + duration.ticks) % duration.ticks
    return { phase: 'PLAY', performanceTicks: mod, timescale }
  }
  if (relative >= duration.ticks) {
    if (input.policy === 'ONCE') {
      return { phase: 'REST', performanceTicks: 0, timescale }
    }
    return { phase: 'HOLD', performanceTicks: lastTicks, timescale }
  }
  return { phase: 'PLAY', performanceTicks: relative, timescale }
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

function lerpTriple(a: [number, number, number], b: [number, number, number], u: number): [number, number, number] {
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)]
}

function lerpCompact(a: CompactHumanoidPose, b: CompactHumanoidPose, u: number): CompactHumanoidPose {
  const joints: Record<string, [number, number, number]> = { ...a.joints }
  for (const key of Object.keys(a.joints)) {
    const other = b.joints[key]
    if (!other) continue
    joints[key] = lerpTriple(a.joints[key], other, u)
  }
  return {
    ticks: Math.round(lerp(a.ticks, b.ticks, u)),
    timescale: a.timescale,
    root: lerpTriple(a.root, b.root, u),
    head: lerpTriple(a.head, b.head, u),
    joints,
  }
}

export function sampleCompactPose(
  poses: CompactHumanoidPose[],
  performanceTicks: number,
): { pose: CompactHumanoidPose; index: number; interpolated: boolean } {
  if (!poses.length) {
    return { pose: restCompactPose(24_000), index: -1, interpolated: false }
  }
  const sorted = poses
  let lo = 0
  let hi = sorted.length - 1
  if (performanceTicks <= sorted[0].ticks) {
    return { pose: sorted[0], index: 0, interpolated: false }
  }
  if (performanceTicks >= sorted[hi].ticks) {
    return { pose: sorted[hi], index: hi, interpolated: false }
  }
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].ticks <= performanceTicks) lo = mid
    else hi = mid
  }
  const current = sorted[lo]
  const next = sorted[lo + 1]
  const gap = next.ticks - current.ticks
  if (gap > 0 && gap <= HVS_PERFORMANCE_MAX_GAP_TICKS) {
    const u = (performanceTicks - current.ticks) / gap
    return { pose: lerpCompact(current, next, u), index: lo, interpolated: true }
  }
  return { pose: current, index: lo, interpolated: false }
}

export function poseAtSceneClock(
  track: Pick<HvsDirectorPerformanceTrack, 'poses' | 'startTime' | 'takeDuration' | 'lastSampleTicks' | 'policy'>,
  sceneTime: MediaTime,
): {
  pose: CompactHumanoidPose
  phase: HvsPerformancePhase
  performanceTicks: number
  index: number
  interpolated: boolean
  directorState: 'RIGGED' | 'ANIMATED'
} {
  const mapped = mapSceneTimeToPerformance({
    sceneTime,
    startTime: track.startTime,
    takeDuration: track.takeDuration,
    lastSampleTicks: track.lastSampleTicks,
    policy: track.policy,
  })
  if (mapped.phase === 'REST' || !track.poses.length) {
    return {
      pose: restCompactPose(mapped.timescale),
      phase: 'REST',
      performanceTicks: mapped.performanceTicks,
      index: -1,
      interpolated: false,
      directorState: 'RIGGED',
    }
  }
  const sampled = sampleCompactPose(track.poses, mapped.performanceTicks)
  return {
    pose: sampled.pose,
    phase: mapped.phase,
    performanceTicks: mapped.performanceTicks,
    index: sampled.index,
    interpolated: sampled.interpolated,
    directorState: 'ANIMATED',
  }
}

export function composeBlockingAndRoot(
  blocking: { x: number; y: number; z: number },
  root: { x: number; y: number; z: number } | [number, number, number],
): { x: number; y: number; z: number } {
  const rx = Array.isArray(root) ? root[0] : root.x
  const ry = Array.isArray(root) ? root[1] : root.y
  const rz = Array.isArray(root) ? root[2] : root.z
  return { x: blocking.x + rx, y: blocking.y + ry, z: blocking.z + rz }
}

export function compactJoint(pose: CompactHumanoidPose, bone: HvsHumanoidBone): { x: number; y: number; z: number } {
  const value = pose.joints[bone]
  if (value) return { x: value[0], y: value[1], z: value[2] }
  return HVS_NEUTRAL_REST[bone]
}

export function defaultPerformanceBinding(): {
  performanceStartTime: MediaTime
  performancePlayback: HvsPerformancePlayback
  rigId: typeof HVS_HUMANOID_RIG_ID
  retargetProfile: typeof HVS_HUMANOID_RIG_V1
} {
  return {
    performanceStartTime: mediaTime(0, 24_000),
    performancePlayback: HVS_DEFAULT_PERFORMANCE_PLAYBACK,
    rigId: HVS_HUMANOID_RIG_ID,
    retargetProfile: HVS_HUMANOID_RIG_V1,
  }
}

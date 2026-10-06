/**
 * Viewer/inspector helpers for TrackSubject + VirtualCamera.
 * Does not replace track-subject.ts or followFramingCrop.
 *
 * FACE LOCK boundary: shot-local follow of one selected real person within one
 * continuous clip. Not biometric identification, not cross-scene identity,
 * not cross-video identity, not multi-person re-identification, not general
 * face recognition.
 */
import { toSeconds } from './time'
import type { Crop, TrackSubject, VirtualCamera } from './types'
import { FACE_LOCK_BOUNDARY, interpolateSubject, type FollowMode } from './tracking'

export { FACE_LOCK_BOUNDARY }

export type TrackStatusLabel =
  | 'NOT TRACKED'
  | 'TRACKING'
  | 'TRACKED'
  | 'LOW CONFIDENCE'
  | 'TARGET LOST'
  | 'NEEDS REVIEW'

export const FOLLOW_MODE_OPTIONS: Array<{ id: FollowMode; label: string; implemented: true }> = [
  { id: 'CENTER_LOCK', label: 'CENTER LOCK', implemented: true },
  { id: 'RULE_OF_THIRDS', label: 'RULE OF THIRDS', implemented: true },
  { id: 'FACE_LOCK', label: 'FACE LOCK', implemented: true },
  { id: 'UPPER_BODY', label: 'UPPER BODY', implemented: true },
  { id: 'FULL_BODY', label: 'FULL BODY', implemented: true },
  { id: 'DYNAMIC_FOLLOW', label: 'DYNAMIC FOLLOW', implemented: true },
  { id: 'CINEMATIC_FOLLOW', label: 'CINEMATIC FOLLOW', implemented: true },
]

const LOST_CONFIDENCE = 0.32
const LOW_CONFIDENCE = 0.45

export function measuredConfidence(subject: TrackSubject | null, playheadTicks: number, timescale: number): number | null {
  if (!subject) return null
  const box = interpolateSubject(subject, playheadTicks, timescale)
  if (box?.confidence != null && Number.isFinite(box.confidence)) return box.confidence
  if (Number.isFinite(subject.confidence)) return subject.confidence
  return null
}

export function trackStatusAtPlayhead(
  subject: TrackSubject | null,
  playheadTicks: number,
  timescale: number,
  busy = false,
): TrackStatusLabel {
  if (busy) return 'TRACKING'
  if (!subject || !subject.keyframes.length) return 'NOT TRACKED'
  const conf = measuredConfidence(subject, playheadTicks, timescale)
  if (subject.status === 'lost' || (conf != null && conf < LOST_CONFIDENCE)) return 'TARGET LOST'
  if (subject.status === 'corrected') return 'NEEDS REVIEW'
  if (conf != null && conf < LOW_CONFIDENCE) return 'LOW CONFIDENCE'
  if (subject.status === 'reacquired' || subject.status === 'tracking') return 'TRACKED'
  return 'NEEDS REVIEW'
}

export function firstLostSeconds(subject: TrackSubject | null): number | null {
  if (!subject) return null
  const hit = subject.keyframes.find(kf => kf.confidence < LOST_CONFIDENCE)
  return hit ? toSeconds(hit.time) : null
}

export function firstReacquiredSeconds(subject: TrackSubject | null): number | null {
  if (!subject) return null
  let sawLost = false
  for (const kf of [...subject.keyframes].sort((a, b) => a.time.ticks - b.time.ticks)) {
    if (kf.confidence < LOST_CONFIDENCE) sawLost = true
    else if (sawLost && kf.confidence >= LOST_CONFIDENCE) return toSeconds(kf.time)
  }
  return subject.status === 'reacquired' ? toSeconds(subject.keyframes[subject.keyframes.length - 1].time) : null
}

export function cropMovementSummary(cam: VirtualCamera | null): {
  keyCount: number
  startSec: number | null
  endSec: number | null
  cropDelta: number
  zoomDelta: number
} {
  if (!cam?.keyframes.length) return { keyCount: 0, startSec: null, endSec: null, cropDelta: 0, zoomDelta: 0 }
  const first = cam.keyframes[0]
  const last = cam.keyframes[cam.keyframes.length - 1]
  const cropW = (c: Crop) => 1 - c.left - c.right
  return {
    keyCount: cam.keyframes.length,
    startSec: toSeconds(first.time),
    endSec: toSeconds(last.time),
    cropDelta: Math.abs(last.crop.left - first.crop.left) + Math.abs(last.crop.top - first.crop.top),
    zoomDelta: Math.abs(cropW(last.crop) - cropW(first.crop)),
  }
}

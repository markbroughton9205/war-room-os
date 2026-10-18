/**
 * TrackSubject + VirtualCamera. Follow-person path:
 * Detect → TrackSubject → TrackData → VirtualCamera → framing rules → transform/keyframes → output.
 * Multicam, CameraSpec, and VirtualCamera are never conflated.
 *
 * Slice-0 proving case: 16:9 footage → track model → intelligent 9:16 framing (not a center-crop).
 */
import type { Crop, OutputAspect, TrackSubject, VirtualCamera } from './types'

export type FollowMode = VirtualCamera['mode']

export type SubjectBox = {
  x: number
  y: number
  width: number
  height: number
  confidence?: number
}

/**
 * Compute a vertical (or square) crop window that keeps the subject on a chosen framing rule.
 * Coordinates are normalized 0–1 against the source frame.
 */
export function sourcePixelRatio(width?: number | null, height?: number | null): number {
  if (width && height && height > 0) return width / height
  return 16 / 9
}

export function followFramingCrop(box: SubjectBox, mode: FollowMode, aspect: OutputAspect, sourceRatio = 16 / 9): Crop {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const targetRatio = aspect === '9:16' ? 9 / 16 : aspect === '1:1' ? 1 : 16 / 9
  const srcRatio = sourceRatio > 0 ? sourceRatio : 16 / 9

  let cropW: number
  let cropH: number
  if (targetRatio < srcRatio) {
    cropH = 1
    cropW = targetRatio / srcRatio
  } else {
    cropW = 1
    cropH = srcRatio / targetRatio
  }

  if (mode === 'FACE_LOCK') {
    if (cropW > 0.82 && cropH > 0.82) {
      cropH = Math.min(1, Math.max(0.42, box.height * 1.48))
      cropW = Math.min(1, cropH * (targetRatio / srcRatio))
      if (cropW >= 1) {
        cropW = 1
        cropH = Math.min(1, cropW * (srcRatio / targetRatio))
      }
    } else {
      cropH = Math.min(1, Math.max(cropH, box.height * 2.4))
      cropW = Math.min(1, cropH * (targetRatio / srcRatio))
    }
  } else if (mode === 'UPPER_BODY') {
    cropH = Math.min(1, Math.max(cropH, box.height * 1.7))
    cropW = Math.min(1, cropH * (targetRatio / srcRatio))
  } else if (mode === 'FULL_BODY') {
    cropH = Math.min(1, Math.max(cropH, box.height * 1.15 + 0.08))
    cropW = Math.min(1, cropH * (targetRatio / srcRatio))
  }

  cropW = Math.min(1, cropW)
  cropH = Math.min(1, cropH)

  let focusX = cx
  let focusY = cy
  if (mode === 'RULE_OF_THIRDS') {
    focusX = cx + (0.5 - 1 / 3) * cropW
    focusY = cy - cropH * 0.06
  } else if (mode === 'CINEMATIC_FOLLOW') {
    cropH = Math.min(1, Math.max(0.38, cropH * 0.9))
    cropW = Math.min(1, cropH * (targetRatio / srcRatio))
    focusX = cx + (0.5 - 0.38) * cropW
    focusY = cy - cropH * 0.1
  } else if (mode === 'DYNAMIC_FOLLOW') {
    focusX = cx + (cx - 0.5) * 0.12
    focusY = cy - cropH * 0.04
  } else if (mode === 'FACE_LOCK') {
    focusY = box.y + box.height * 0.35
  }

  if (mode === 'CENTER_LOCK') {
    focusX = cx
    focusY = cy
  }

  let left = focusX - cropW / 2
  let top = focusY - cropH / 2
  left = Math.max(0, Math.min(1 - cropW, left))
  top = Math.max(0, Math.min(1 - cropH, top))

  return {
    left,
    top,
    right: 1 - (left + cropW),
    bottom: 1 - (top + cropH),
  }
}

export function interpolateSubject(subject: TrackSubject, ticks: number, timescale: number): SubjectBox | null {
  if (!subject.keyframes.length) return null
  const kfs = [...subject.keyframes].sort((a, b) => a.time.ticks - b.time.ticks)
  const t = (ticks * kfs[0].time.timescale) / timescale
  if (t <= kfs[0].time.ticks) return kfs[0]
  const last = kfs[kfs.length - 1]
  if (t >= last.time.ticks) {
    return subject.status === 'lost' ? { ...last, confidence: Math.min(last.confidence, 0.2) } : last
  }
  let prev = kfs[0]
  for (const kf of kfs) {
    if (kf.time.ticks >= t) {
      const span = kf.time.ticks - prev.time.ticks || 1
      const u = (t - prev.time.ticks) / span
      return {
        x: prev.x + (kf.x - prev.x) * u,
        y: prev.y + (kf.y - prev.y) * u,
        width: prev.width + (kf.width - prev.width) * u,
        height: prev.height + (kf.height - prev.height) * u,
        confidence: prev.confidence + (kf.confidence - prev.confidence) * u,
      }
    }
    prev = kf
  }
  return last
}

export function correctSubject(subject: TrackSubject, box: SubjectBox, ticks: number, timescale: number): TrackSubject {
  return {
    ...subject,
    status: 'corrected',
    humanCorrected: true,
    confidence: Math.max(subject.confidence, box.confidence ?? 0.9),
    keyframes: [
      ...subject.keyframes.filter(kf => kf.time.ticks !== ticks),
      {
        time: { ticks, timescale },
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        confidence: box.confidence ?? 0.95,
      },
    ].sort((a, b) => a.time.ticks - b.time.ticks),
  }
}

/** FACE LOCK is a framing rule for one selected person in one clip — not biometric ID. */
export const FACE_LOCK_BOUNDARY =
  'FACE LOCK means shot-local follow of one selected real person within one continuous clip. It does NOT mean biometric identification, cross-scene identity, cross-video identity, multi-person re-identification, or general face recognition.'

export const FOLLOW_MODE_IDS = [
  'CENTER_LOCK',
  'RULE_OF_THIRDS',
  'FACE_LOCK',
  'UPPER_BODY',
  'FULL_BODY',
  'DYNAMIC_FOLLOW',
  'CINEMATIC_FOLLOW',
] as const satisfies ReadonlyArray<FollowMode>

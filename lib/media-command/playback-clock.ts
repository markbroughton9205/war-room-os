/**
 * Authoritative mapping between browser playback time and HVS rational timeline time.
 * Project/timeline state stores MediaTime (ticks+timescale). Browser currentTime is
 * runtime input only and is converted explicitly — never persisted as float seconds.
 */
import {
  addTime,
  clampTime,
  compareTime,
  convertTime,
  mediaTime,
  type MediaTime,
  type Rational,
  scaleTime,
  subTime,
  toSeconds,
  zeroTime,
} from './time'
import type { Clip } from './types'

export const HVS_PLAYBACK_CLOCK = 'html5-currentTime-mapped-to-rational-timeline'

export const KNOWN_FRAME_RATES: Rational[] = [
  { n: 24000, d: 1001 },
  { n: 24, d: 1 },
  { n: 25, d: 1 },
  { n: 30000, d: 1001 },
  { n: 30, d: 1 },
  { n: 60000, d: 1001 },
  { n: 60, d: 1 },
]

export function clipSpeedRate(clip: Clip): number {
  if (!clip.speed || clip.speed.d === 0) return 1
  const rate = clip.speed.n / clip.speed.d
  return rate > 0 ? rate : 1
}

export function sourceSpan(clip: Clip): MediaTime {
  return subTime(clip.sourceOut, clip.sourceIn, clip.sourceIn.timescale)
}

export function frameDuration(fps: Rational, timescale: number): MediaTime {
  const n = fps.n === 0 ? 24 : fps.n
  const d = fps.d === 0 ? 1 : fps.d
  return mediaTime((timescale * d) / n, timescale)
}

export function stepFrame(time: MediaTime, fps: Rational, direction: 1 | -1, min?: MediaTime, max?: MediaTime): MediaTime {
  const delta = frameDuration(fps, time.timescale)
  const next = direction < 0
    ? subTime(time, delta, time.timescale)
    : addTime(time, delta, time.timescale)
  if (min && max) return clampTime(next, min, max)
  if (min && compareTime(next, min) < 0) return convertTime(min, time.timescale)
  if (max && compareTime(next, max) > 0) return convertTime(max, time.timescale)
  return next.ticks < 0 ? zeroTime(time.timescale) : next
}

export function wallDeltaToMediaTime(seconds: number, timescale: number): MediaTime {
  if (!Number.isFinite(seconds) || seconds === 0) return zeroTime(timescale)
  return mediaTime(seconds * timescale, timescale)
}

export function mediaTimeToBrowserSeconds(t: MediaTime): number {
  return toSeconds(t)
}

/** Source seconds inside the asset for a clip-local program offset. */
export function sourceSecondsAtLocal(clip: Clip, local: MediaTime): number {
  const rate = clipSpeedRate(clip)
  const localSec = toSeconds(local)
  const inSec = toSeconds(clip.sourceIn)
  const spanSec = Math.max(0, toSeconds(sourceSpan(clip)))
  if (clip.freeze) return inSec
  const progressed = localSec * rate
  const offset = clip.reversed ? Math.max(0, spanSec - progressed) : progressed
  return inSec + Math.min(spanSec, Math.max(0, offset))
}

export function programTimeFromBrowserCurrentTime(
  clip: Clip,
  browserCurrentTime: number,
  timescale: number,
): MediaTime {
  const rate = clipSpeedRate(clip)
  const inSec = toSeconds(clip.sourceIn)
  const spanSec = Math.max(0, toSeconds(sourceSpan(clip)))
  if (clip.freeze) return convertTime(clip.start, timescale)
  let consumed = clip.reversed ? (inSec + spanSec) - browserCurrentTime : browserCurrentTime - inSec
  if (!Number.isFinite(consumed)) consumed = 0
  const localSec = rate === 0 ? 0 : consumed / rate
  const local = mediaTime(Math.max(0, localSec) * timescale, timescale)
  return addTime(convertTime(clip.start, timescale), local, timescale)
}

export function timelineDurationForSpeed(sourceDuration: MediaTime, speed: Rational): MediaTime {
  const n = speed.n
  const d = speed.d === 0 ? 1 : speed.d
  if (n <= 0) return sourceDuration
  return scaleTime(sourceDuration, { n: d, d: n })
}

export function resolveFrameRate(fps: Rational | null | undefined, fallback: Rational = { n: 24, d: 1 }): Rational {
  if (!fps || fps.n <= 0 || fps.d <= 0) return fallback
  return fps
}

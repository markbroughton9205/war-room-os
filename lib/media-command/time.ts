/**
 * Rational media time. Timeline storage is integer ticks + timescale.
 * Do not persist ordinary floating-point seconds as the source of truth.
 */

export const DEFAULT_TIMESCALE = 24_000
export const NTSC_TIMESCALE = 24_000
export const FILM_24_TIMESCALE = 24_000
export const PAL_TIMESCALE = 25_000

export type MediaTime = {
  ticks: number
  timescale: number
}

export type Rational = {
  n: number
  d: number
}

export function mediaTime(ticks: number, timescale = DEFAULT_TIMESCALE): MediaTime {
  const ts = timescale > 0 ? Math.round(timescale) : DEFAULT_TIMESCALE
  return { ticks: Math.round(ticks), timescale: ts }
}

export function zeroTime(timescale = DEFAULT_TIMESCALE): MediaTime {
  return mediaTime(0, timescale)
}

/** Convert a wall-clock duration into ticks. Input seconds are a conversion helper, not storage. */
export function fromSeconds(seconds: number, timescale = DEFAULT_TIMESCALE): MediaTime {
  if (!Number.isFinite(seconds)) return zeroTime(timescale)
  return mediaTime(seconds * timescale, timescale)
}

export function toSeconds(t: MediaTime): number {
  if (!t || t.timescale <= 0) return 0
  return t.ticks / t.timescale
}

export function convertTime(t: MediaTime, timescale: number): MediaTime {
  const ts = timescale > 0 ? Math.round(timescale) : DEFAULT_TIMESCALE
  if (!t || t.timescale === ts) return mediaTime(t?.ticks ?? 0, ts)
  if (t.timescale <= 0) return zeroTime(ts)
  return mediaTime((t.ticks * ts) / t.timescale, ts)
}

export function addTime(a: MediaTime, b: MediaTime, timescale = a.timescale): MediaTime {
  const left = convertTime(a, timescale)
  const right = convertTime(b, timescale)
  return mediaTime(left.ticks + right.ticks, timescale)
}

export function subTime(a: MediaTime, b: MediaTime, timescale = a.timescale): MediaTime {
  const left = convertTime(a, timescale)
  const right = convertTime(b, timescale)
  return mediaTime(left.ticks - right.ticks, timescale)
}

export function minTime(a: MediaTime, b: MediaTime): MediaTime {
  const right = convertTime(b, a.timescale)
  return a.ticks <= right.ticks ? a : mediaTime(right.ticks, a.timescale)
}

export function maxTime(a: MediaTime, b: MediaTime): MediaTime {
  const right = convertTime(b, a.timescale)
  return a.ticks >= right.ticks ? a : mediaTime(right.ticks, a.timescale)
}

export function compareTime(a: MediaTime, b: MediaTime): number {
  const right = convertTime(b, a.timescale)
  return a.ticks - right.ticks
}

export function isTimeEqual(a: MediaTime, b: MediaTime): boolean {
  return compareTime(a, b) === 0
}

export function clampTime(t: MediaTime, min: MediaTime, max: MediaTime): MediaTime {
  if (compareTime(t, min) < 0) return convertTime(min, t.timescale)
  if (compareTime(t, max) > 0) return convertTime(max, t.timescale)
  return t
}

export function scaleTime(t: MediaTime, factor: Rational): MediaTime {
  const d = factor.d === 0 ? 1 : factor.d
  return mediaTime((t.ticks * factor.n) / d, t.timescale)
}

export function rational(n: number, d = 1): Rational {
  return { n: Math.round(n), d: Math.round(d) || 1 }
}

export function rationalToNumber(r: Rational): number {
  return r.d === 0 ? 0 : r.n / r.d
}

export function numberToRational(value: number): Rational {
  if (!Number.isFinite(value) || value === 0) return { n: 0, d: 1 }
  if (Number.isInteger(value)) return { n: value, d: 1 }
  const d = 1000
  return { n: Math.round(value * d), d }
}

export function formatTimecode(t: MediaTime, fps = 24): string {
  const total = Math.max(0, toSeconds(t))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = Math.floor(total % 60)
  const frames = Math.floor((total - Math.floor(total)) * fps)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`
}

export function parseMediaTime(input: unknown, fallbackTimescale = DEFAULT_TIMESCALE): MediaTime {
  if (!input || typeof input !== 'object') return zeroTime(fallbackTimescale)
  const rec = input as Record<string, unknown>
  const timescale = typeof rec.timescale === 'number' && rec.timescale > 0 ? rec.timescale : fallbackTimescale
  const ticks = typeof rec.ticks === 'number' ? rec.ticks : 0
  return mediaTime(ticks, timescale)
}

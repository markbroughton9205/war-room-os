/**
 * Clip-level stereo pan. Canonical range -1 (full left) .. +1 (full right).
 * Preview uses Web Audio StereoPannerNode. Render uses FFmpeg pan.
 * Not DAW automation — one value per clip. Keyframed pan is a later path via params.
 */
import type { Clip } from './types'

export const PAN_MIN = -1
export const PAN_MAX = 1

export function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(PAN_MIN, Math.min(PAN_MAX, value))
}

/** Equal-power gains for a mono-sum then pan. */
export function panGains(pan: number): { left: number; right: number } {
  const p = clampPan(pan)
  const angle = ((p + 1) / 2) * (Math.PI / 2)
  return { left: Math.cos(angle), right: Math.sin(angle) }
}

export function panLabel(pan: number): 'L' | 'C' | 'R' {
  const p = clampPan(pan)
  if (p <= -0.5) return 'L'
  if (p >= 0.5) return 'R'
  return 'C'
}

/** FFmpeg pan filter: fold stereo to equal-power L/R. */
export function ffmpegPanFilter(pan: number): string {
  const { left, right } = panGains(pan)
  const l = left.toFixed(4)
  const r = right.toFixed(4)
  return `pan=stereo|c0=${l}*c0+${l}*c1|c1=${r}*c0+${r}*c1`
}

export function clipPan(clip: Clip | null | undefined): number {
  return clampPan(clip?.pan ?? 0)
}

export function rms(samples: Float32Array | Int16Array): number {
  if (!samples.length) return 0
  let sum = 0
  if (samples instanceof Float32Array) {
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  } else {
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] / 32768
      sum += v * v
    }
  }
  return Math.sqrt(sum / samples.length)
}

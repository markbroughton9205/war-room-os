/**
 * Calculated EQ frequency-response curve from filter settings.
 * Not a live FFT spectrum. Label: EQ RESPONSE.
 */
import type { AudioInsertEq } from './audio-graph'

export type EqResponsePoint = { hz: number; db: number }

function peakingDb(hz: number, f0: number, gainDb: number, q: number): number {
  if (!Number.isFinite(f0) || f0 <= 0 || !gainDb) return 0
  const x = Math.log2(Math.max(1, hz) / f0)
  const width = Math.max(0.08, 1 / Math.max(0.2, q))
  return gainDb * Math.exp(-0.5 * (x / width) ** 2)
}

function highpassDb(hz: number, cutoff: number): number {
  if (!cutoff || cutoff <= 0) return 0
  const n = hz / cutoff
  const mag = n / Math.sqrt(1 + n * n)
  return 20 * Math.log10(Math.max(1e-6, mag))
}

function lowpassDb(hz: number, cutoff: number): number {
  if (!cutoff || cutoff <= 0) return 0
  const n = hz / cutoff
  const mag = 1 / Math.sqrt(1 + n * n)
  return 20 * Math.log10(Math.max(1e-6, mag))
}

export function eqResponseCurve(eq: AudioInsertEq | null | undefined, fromHz = 20, toHz = 20000, points = 64): EqResponsePoint[] {
  const out: EqResponsePoint[] = []
  const logMin = Math.log10(fromHz)
  const logMax = Math.log10(toHz)
  for (let i = 0; i < points; i++) {
    const hz = 10 ** (logMin + (i / Math.max(1, points - 1)) * (logMax - logMin))
    let db = 0
    if (eq?.enabled) {
      if (eq.highpassHz) db += highpassDb(hz, eq.highpassHz)
      if (eq.lowpassHz) db += lowpassDb(hz, eq.lowpassHz)
      for (const band of eq.bands ?? []) db += peakingDb(hz, band.frequencyHz, band.gainDb, band.q)
    }
    out.push({ hz, db })
  }
  return out
}

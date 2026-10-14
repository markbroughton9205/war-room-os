import { readFileSync } from 'node:fs'
import { gpuUsedMiB } from '../profile'

/** Samples GPU/RAM/swap while a model works. A low-memory condition raises `unsafe` so the caller can stop the test instead of destabilising the machine. */
export type MemSample = { gpuMiB: number | 'UNKNOWN'; ramUsedMiB: number; availMiB: number; swapUsedMiB: number }
export function readMem(): MemSample {
  const m = readFileSync('/proc/meminfo', 'utf8'); const g = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(m)?.[1] ?? 0) / 1024
  return { gpuMiB: gpuUsedMiB(), ramUsedMiB: Math.round(g('MemTotal') - g('MemAvailable')), availMiB: Math.round(g('MemAvailable')), swapUsedMiB: Math.round(g('SwapTotal') - g('SwapFree')) }
}
export const SAFE_MIN_AVAIL_MIB = 2500

export class MemSampler {
  peakGpu = 0; peakRam = 0; peakSwap = 0; minAvail = Number.POSITIVE_INFINITY
  unsafe: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  readonly baseline: MemSample
  constructor(private readonly onUnsafe?: (why: string) => void, private readonly minAvailMiB = SAFE_MIN_AVAIL_MIB) { this.baseline = readMem() }
  start(everyMs = 1000): this {
    const tick = () => {
      const s = readMem()
      if (typeof s.gpuMiB === 'number') this.peakGpu = Math.max(this.peakGpu, s.gpuMiB)
      this.peakRam = Math.max(this.peakRam, s.ramUsedMiB); this.peakSwap = Math.max(this.peakSwap, s.swapUsedMiB); this.minAvail = Math.min(this.minAvail, s.availMiB)
      if (s.availMiB < this.minAvailMiB && !this.unsafe) { this.unsafe = `available RAM fell to ${s.availMiB} MiB (< ${this.minAvailMiB})`; this.onUnsafe?.(this.unsafe) }
    }
    tick(); this.timer = setInterval(tick, everyMs); return this
  }
  stop(): this { if (this.timer) clearInterval(this.timer); this.timer = null; return this }
}

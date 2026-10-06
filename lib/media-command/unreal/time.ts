/**
 * Deterministic HVS MediaTime → Unreal Sequencer mapping.
 * Canonical storage stays integer ticks + timescale. Float seconds are not written.
 *
 * HVS timescale 24000 and Unreal tick resolution 24000/1 are the same tick.
 * Display rate is 24/1, so one display frame is 1000 sequencer ticks.
 * FrameNumber = floor(sequencerTick / 1000). Sub-tick = sequencerTick % 1000.
 */
import type { MediaTime } from '../time'
import type { HvsUnrealMappedTime, HvsUnrealRational } from './types'

export const HVS_UNREAL_DISPLAY_RATE: HvsUnrealRational = { numerator: 24, denominator: 1 }
export const HVS_UNREAL_TICK_RESOLUTION: HvsUnrealRational = { numerator: 24000, denominator: 1 }
export const HVS_UNREAL_TICKS_PER_DISPLAY_FRAME = 1000

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a))
  let y = Math.abs(Math.trunc(b))
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

function reduce(numerator: number, denominator: number): HvsUnrealRational {
  const sign = denominator < 0 ? -1 : 1
  const div = gcd(numerator, denominator)
  return {
    numerator: (sign * Math.trunc(numerator)) / div,
    denominator: Math.abs(Math.trunc(denominator)) / div,
  }
}

export function mapHvsTimeToUnreal(time: MediaTime): HvsUnrealMappedTime {
  const ticks = Math.trunc(time.ticks)
  const timescale = Math.trunc(time.timescale)
  const numerator = ticks * HVS_UNREAL_TICK_RESOLUTION.numerator
  const sequencerTick = reduce(numerator, timescale > 0 ? timescale : 1)
  const exactIntegerTick = sequencerTick.denominator === 1
  const integerTick = exactIntegerTick ? sequencerTick.numerator : null
  return {
    hvsTicks: ticks,
    hvsTimescale: timescale,
    displayRate: HVS_UNREAL_DISPLAY_RATE,
    tickResolution: HVS_UNREAL_TICK_RESOLUTION,
    sequencerTick,
    exactIntegerTick,
    frameNumber: integerTick === null ? null : Math.floor(integerTick / HVS_UNREAL_TICKS_PER_DISPLAY_FRAME),
    subTick: integerTick === null ? null : integerTick % HVS_UNREAL_TICKS_PER_DISPLAY_FRAME,
  }
}

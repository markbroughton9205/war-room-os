import { DEFAULT_TIMESCALE, fromSeconds, toSeconds, type MediaTime } from '../time'

/** Shared scene-relative rational clock. Storyboard, camera, 3D, destruction, VFX. */
export const HVS_SCENE_TIMESCALE = DEFAULT_TIMESCALE

export function sceneSeconds(time: MediaTime): number {
  return toSeconds(time)
}

export function sceneTime(secondsValue: number, timescale = HVS_SCENE_TIMESCALE): MediaTime {
  return fromSeconds(secondsValue, timescale)
}

export function destructionStateAt(collapseSec: number, impactSec: number, endSec: number, t: number): 'INTACT' | 'CRACKING' | 'COLLAPSING' | 'COLLAPSED' {
  if (t < collapseSec) return 'INTACT'
  if (t < impactSec) return 'CRACKING'
  if (t < endSec) return 'COLLAPSING'
  return 'COLLAPSED'
}

export function crowdReactionAllowed(collapseSec: number, t: number): boolean {
  return t >= collapseSec
}

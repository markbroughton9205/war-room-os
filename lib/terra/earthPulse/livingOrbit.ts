/**
 * Living Orbit is presentation camera motion, not physical Earth rotation.
 * It must never be labeled as the planet spinning at the visual rate.
 */
export const LIVING_ORBIT_IDLE_DELAY_CLOSE_MS = 20_000
export const LIVING_ORBIT_IDLE_DELAY_GLOBAL_MS = 1_800
export const LIVING_ORBIT_LABEL = 'Living Orbit'
export const LIVING_ORBIT_DISCLAIMER = 'Presentation camera rotate · not physical Earth rotation rate'

export function livingOrbitIdleDelayMs(scaleLevel: 'global' | 'regional' | 'city' | 'street' | string): number {
  return scaleLevel === 'global' || scaleLevel === 'regional'
    ? LIVING_ORBIT_IDLE_DELAY_GLOBAL_MS
    : LIVING_ORBIT_IDLE_DELAY_CLOSE_MS
}

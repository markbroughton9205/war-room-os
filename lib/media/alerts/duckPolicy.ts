/**
 * NWS alert-duck policy boundary.
 * Phase 1: interface + decision helper only. Not wired to the playback engine.
 * Future Media NWS adapter must preserve zone-only alerts (do not reuse Terra's
 * polygon-only normalizer).
 */

export const MEDIA_ALERT_SEVERITIES = [
  'Extreme',
  'Severe',
  'Moderate',
  'Minor',
  'Unknown',
  'Test',
] as const
export type MediaAlertSeverity = (typeof MEDIA_ALERT_SEVERITIES)[number]

export type MediaDuckAction = 'duck' | 'banner' | 'ignore'

export type MediaAlertDuckDecision = {
  action: MediaDuckAction
  reason: string
}

/**
 * Extreme/Severe → eligible to duck (when Commander ducking is ON and wiring exists).
 * Moderate/Minor/Unknown → banner only.
 * Test → never duck.
 */
export function decideAlertDuck(input: {
  severity: string | null | undefined
  duckingEnabled: boolean
  alreadyDuckedForAlertId: boolean
  audioAlreadyPlaying?: boolean
}): MediaAlertDuckDecision {
  const severity = (input.severity ?? 'Unknown').trim()
  const normalized = MEDIA_ALERT_SEVERITIES.find(value => value.toLowerCase() === severity.toLowerCase()) ?? 'Unknown'

  if (normalized === 'Test') {
    return { action: 'ignore', reason: 'Test products never duck radio audio.' }
  }
  if (normalized === 'Extreme' || normalized === 'Severe') {
    if (!input.audioAlreadyPlaying) {
      return {
        action: 'banner',
        reason: 'Alert must not start a station. Duck only while Commander audio is already playing.',
      }
    }
    if (!input.duckingEnabled) {
      return { action: 'banner', reason: 'ALERT DUCKING is off. Banner only.' }
    }
    if (input.alreadyDuckedForAlertId) {
      return { action: 'banner', reason: 'Same warning already ducked. Do not re-duck.' }
    }
    return { action: 'duck', reason: `${normalized} is eligible for audio duck.` }
  }
  return { action: 'banner', reason: `${normalized} is banner-only. No duck.` }
}

export const MEDIA_ALERT_DUCK_POLICY_NOTE =
  'Ducking is defined (Extreme/Severe only; Test never ducks) but not wired this pass. Zone-only NWS alerts must be preserved when the adapter is connected.'

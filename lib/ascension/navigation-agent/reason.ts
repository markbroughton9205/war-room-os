/**
 * #22 Phase 12 — Deterministic explanation over Phase 9 navigation results.
 * Local model may summarize; it cannot replace the route engine, GNSS, or traffic truth.
 */
import type { NavigationRoute } from '@/lib/terra/navigation/types'
import type { NavigationAgentTaskType } from './profile'
import type { LocationProvenanceClass } from './result'

export const HELSINKI_FIXTURE_ORIGIN = Object.freeze({ latitude: 60.17, longitude: 24.938 })
export const HELSINKI_FIXTURE_DESTINATION = Object.freeze({ latitude: 60.1745, longitude: 24.9455 })
export const HELSINKI_FIXTURE_CLOSED_DEST = Object.freeze({ latitude: 60.1735, longitude: 24.948 })
export const HELSINKI_FIXTURE_OFF_ROUTE = Object.freeze({ latitude: 60.168, longitude: 24.93 })

export function provenanceFromLocationSource(
  source: string | undefined,
  claimLiveDeviceGps: boolean,
): LocationProvenanceClass {
  if (claimLiveDeviceGps || source === 'device_gnss') return 'UNSUPPORTED_DEVICE_GNSS'
  if (source === 'session_supplied') return 'SESSION_LOCATION'
  if (source === 'fixture') return 'FIXTURE'
  if (source === 'terra') return 'SUPPORTED_TERRA_SOURCE'
  return 'EXPLICIT_USER_INPUT'
}

export function explainRouteDeterministically(input: {
  taskType: NavigationAgentTaskType
  route: NavigationRoute | null
  comparison?: NavigationRoute[]
  offRoute?: string | null
  etaSeconds?: number | null
  etaLiveClaimed?: boolean
  rerouteRecommended?: boolean
  rerouteAutoExecuted?: boolean
  liveTraffic: 'NOT_IMPLEMENTED'
  locationProvenance: LocationProvenanceClass | null
  blockedAvoided?: boolean
}): string {
  const parts: string[] = [`Task ${input.taskType} used the Phase 9 A* DRIVING engine.`]
  if (input.route) {
    parts.push(
      `Route status ${input.route.status}; algorithm ${input.route.provenance.algorithm}; segments ${input.route.segment_ids.length}.`,
    )
    if (input.route.segment_ids.includes('seg-closed')) {
      parts.push('Blocked edge seg-closed was NOT avoided — this would be a foundation defect.')
    } else if (input.blockedAvoided) {
      parts.push('Blocked edge seg-closed was avoided.')
    }
  } else {
    parts.push('No executable route was returned.')
  }
  if (input.comparison && input.comparison.length > 1) {
    parts.push(`Compared ${input.comparison.length} engine-computed options; no second routing engine.`)
  }
  if (input.offRoute) parts.push(`Map-match / progress state: ${input.offRoute}.`)
  if (typeof input.etaSeconds === 'number') {
    parts.push(
      input.etaLiveClaimed
        ? 'ETA incorrectly claimed live traffic — suppressed.'
        : `Base ETA ${input.etaSeconds}s. LIVE_TRAFFIC remains NOT_IMPLEMENTED; fixture/stale traffic is labeled, not live.`,
    )
  }
  if (input.rerouteRecommended) {
    parts.push(
      input.rerouteAutoExecuted
        ? 'Reroute auto-execute attempted — denied.'
        : 'Reroute is a recommendation only; not auto-executed.',
    )
  }
  if (input.locationProvenance === 'UNSUPPORTED_DEVICE_GNSS') {
    parts.push('Live device GNSS is NOT_SUPPORTED. Supplied coordinates are not GPS.')
  } else if (input.locationProvenance) {
    parts.push(`Location provenance: ${input.locationProvenance}.`)
  }
  parts.push('NAVIGATION_AGENT is not Terra, not Council, and not ASTRA execution.')
  return parts.join(' ')
}

export function sanitizeLocalModelExplanation(input: {
  modelText: string | null
  engineExplanation: string
  engineRoute: NavigationRoute | null
}): { text: string; overrode_engine: false; denials: Array<{ capability_or_action: string; reason_code: string; reason: string }> } {
  const denials: Array<{ capability_or_action: string; reason_code: string; reason: string }> = []
  const raw = (input.modelText || '').trim()
  const lowered = raw.toLowerCase()
  if (/live (device )?gps|gnss fix|phone gps/.test(lowered) && !/not_supported|not supported/.test(lowered)) {
    denials.push({
      capability_or_action: 'FABRICATE_GNSS',
      reason_code: 'GNSS_NOT_SUPPORTED',
      reason: 'Local model cannot invent GNSS. MOBILE_GNSS remains NOT_SUPPORTED.',
    })
  }
  if (/live traffic/.test(lowered) && !/not_implemented|not implemented/.test(lowered)) {
    denials.push({
      capability_or_action: 'FABRICATE_LIVE_TRAFFIC',
      reason_code: 'LIVE_TRAFFIC_NOT_IMPLEMENTED',
      reason: 'Local model cannot invent live traffic. LIVE_TRAFFIC remains NOT_IMPLEMENTED.',
    })
  }
  if (/ignore (the )?blocked|drive through (the )?closure/.test(lowered)) {
    denials.push({
      capability_or_action: 'IGNORE_BLOCKED_EDGE',
      reason_code: 'POLICY_DENIED',
      reason: 'Local model cannot override blocked edges. Phase 9 engine remains authoritative.',
    })
  }
  const looksLikeGeometryOverride =
    /new route geometry|replace the route|override a\*|i calculated a different path/.test(lowered)
  if (looksLikeGeometryOverride && input.engineRoute) {
    denials.push({
      capability_or_action: 'OVERRIDE_ROUTE_ENGINE',
      reason_code: 'POLICY_DENIED',
      reason: 'Local model cannot determine route geometry when the deterministic engine already provided it.',
    })
  }
  const text =
    denials.length > 0 || !raw
      ? input.engineExplanation
      : `${input.engineExplanation}\n\nLocal-model summary (non-authoritative):\n${raw.slice(0, 2000)}`
  return { text, overrode_engine: false, denials }
}

/**
 * WAR ROOM TERRA LINKED status model — God's Eye Phase 2. Pure, deterministic evidence -> status
 * derivation for the "Terra linked" pill (components/war-room/terra/GodsEyeCommandCenter.tsx).
 * Per mission doctrine this is a real state machine now even though the pill's visual styling stays
 * small this phase — GREEN is never "we have no incidents." It is emitted only for an explicit,
 * source-backed positive status such as cleared, resolved, normal, open, operational, good, or
 * healthy. Coverage truth describes availability only; LIVE, NO_DATA, NO_COVERAGE, and UNKNOWN
 * never constitute an affirmative all-clear.
 *
 * Every rule below cites the exact observed field(s) it reads, per the mission's OBSERVED/INFERENCE
 * separation doctrine — nothing here invents a condition the signal doesn't itself evidence. The
 * two-field freezing-precipitation rule is the only derived (not directly-labeled) rule in this
 * file; it is called out explicitly in its own reason string as a derivation from two real observed
 * numeric values, never presented as if the source itself reported "black ice risk."
 */
import type { TerraCoverageTruthState } from './coverageTruth'

export const TERRA_LINKED_STATUS_LEVELS = ['RED', 'AMBER', 'GREEN', 'NEUTRAL'] as const
export type TerraLinkedStatusLevel = (typeof TERRA_LINKED_STATUS_LEVELS)[number]

export type TerraLinkedStatusSignal =
  | { kind: 'traffic_event'; severity: string | null; isFullClosure: boolean | null }
  | { kind: 'road_weather'; airTemperatureC: number | null; roadSurfaceTemperatureC: number | null; precipitationIntensityMmH: number | null }
  | { kind: 'camera_freshness'; freshness: 'live_video' | 'still_image' | 'stale' | 'offline' | 'unknown' }
  | { kind: 'coverage'; state: TerraCoverageTruthState }
  | { kind: 'source_status'; status: string | null }

export type TerraLinkedStatusResult = { level: TerraLinkedStatusLevel; reasons: string[] }

const SEVERITY_RANK: TerraLinkedStatusLevel[] = ['NEUTRAL', 'GREEN', 'AMBER', 'RED']

function severityAtLeast(current: TerraLinkedStatusLevel, candidate: TerraLinkedStatusLevel): TerraLinkedStatusLevel {
  return SEVERITY_RANK.indexOf(candidate) > SEVERITY_RANK.indexOf(current) ? candidate : current
}

export function resolveTerraLinkedStatus(signals: TerraLinkedStatusSignal[]): TerraLinkedStatusResult {
  let level: TerraLinkedStatusLevel = 'NEUTRAL'
  const reasons: string[] = []
  let hasExplicitPositiveStatus = false

  const raise = (candidate: TerraLinkedStatusLevel, reason: string) => {
    if (SEVERITY_RANK.indexOf(candidate) >= SEVERITY_RANK.indexOf(level)) reasons.push(reason)
    level = severityAtLeast(level, candidate)
  }

  for (const signal of signals) {
    if (signal.kind === 'traffic_event') {
      if (signal.isFullClosure === true) {
        raise('RED', 'OBSERVED: source reports IsFullClosure = true on an active traffic event')
        continue
      }
      const severity = signal.severity?.toLowerCase() ?? null
      if (severity && /major|severe|critical/.test(severity)) {
        raise('RED', `OBSERVED: source-reported event severity "${signal.severity}"`)
      } else if (severity && /moderate|minor/.test(severity)) {
        raise('AMBER', `OBSERVED: source-reported event severity "${signal.severity}"`)
      }
      continue
    }

    if (signal.kind === 'road_weather') {
      const { airTemperatureC, roadSurfaceTemperatureC, precipitationIntensityMmH } = signal
      if (roadSurfaceTemperatureC !== null && precipitationIntensityMmH !== null && roadSurfaceTemperatureC <= 0 && precipitationIntensityMmH > 0) {
        raise('RED', `INFERENCE (derived from two OBSERVED values, not source-labeled): active precipitation (${precipitationIntensityMmH} mm/h) at/below-freezing road surface temperature (${roadSurfaceTemperatureC}°C)`)
      } else if (airTemperatureC !== null && airTemperatureC <= 0) {
        raise('AMBER', `OBSERVED: freezing air temperature (${airTemperatureC}°C)`)
      }
      continue
    }

    if (signal.kind === 'camera_freshness') {
      if (signal.freshness === 'offline') raise('AMBER', 'OBSERVED: camera feed reports offline')
      else if (signal.freshness === 'stale') raise('AMBER', 'OBSERVED: camera feed exceeds freshness window (stale)')
      continue
    }

    if (signal.kind === 'coverage') {
      if (signal.state === 'OFFLINE') raise('AMBER', 'OBSERVED: source reports offline/degraded')
      else if (signal.state === 'STALE') raise('AMBER', 'OBSERVED: source data is stale')
      // LIVE, NO_DATA, NO_COVERAGE, LOADING, and UNKNOWN contribute no positive or negative
      // condition evidence on their own. Availability must never be promoted into an all-clear.
      continue
    }

    if (signal.kind === 'source_status') {
      const status = signal.status?.trim() ?? ''
      if (/^(cleared|resolved|normal|open|operational|good|healthy|restored)$/i.test(status)) {
        hasExplicitPositiveStatus = true
        reasons.push(`OBSERVED: source explicitly reports positive status "${status}"`)
      }
      continue
    }
  }

  if (level === 'NEUTRAL' && hasExplicitPositiveStatus) {
    return { level: 'GREEN', reasons }
  }
  return { level, reasons }
}

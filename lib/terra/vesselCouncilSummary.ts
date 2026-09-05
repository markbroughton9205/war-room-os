/**
 * Compact vessel summary text for future Council consumption — mirrors
 * lib/terra/aircraftCouncilSummary.ts's convention exactly, exposed through
 * TerraActiveLocationContext.tsx's `maritimeSummary` field. Pure formatting only; creates no
 * Council runtime.
 *
 * Mission requirement (Coverage Truth, section 14): the Council must be able to tell "we observed
 * zero vessels" apart from "we have no AIS coverage here" — this is why `coverageState` is a
 * required parameter, not an afterthought. A plain vessel count with no coverage context would let
 * a NO_COVERAGE region silently read exactly like a genuinely empty stretch of Finnish coastal
 * water to anything consuming this summary downstream.
 */
import type { TerraGeoFeature } from './types'
import type { TerraVesselRegionalSummary } from './vesselRegionalSummary'
import { TERRA_MARITIME_COVERAGE_LABELS, type TerraMaritimeCoverageState } from './maritimeCoverage'

export function formatTerraVesselCouncilSummary(
  selectedVessel: TerraGeoFeature | null,
  regionalSummary: TerraVesselRegionalSummary | null,
  coverageState: TerraMaritimeCoverageState | null,
): string {
  const lines: string[] = []

  if (coverageState) {
    lines.push(`MARITIME COVERAGE: ${TERRA_MARITIME_COVERAGE_LABELS[coverageState]}`)
  }

  if (regionalSummary) {
    lines.push(`VESSELS IN CURRENT REGION: ${regionalSummary.totalCount}`)
    if (regionalSummary.totalCount > 0) {
      lines.push(`MOVING: ${regionalSummary.movingCount} · STATIONARY: ${regionalSummary.stationaryCount}${regionalSummary.staleCount > 0 ? ` · STALE: ${regionalSummary.staleCount}` : ''}`)
    }
  }

  if (selectedVessel && selectedVessel.kind === 'vessel_position') {
    const properties = selectedVessel.properties
    const name = selectedVessel.title
    lines.push(`SELECTED VESSEL: ${name}`)
    if (typeof properties.mmsi === 'string') lines.push(`MMSI: ${properties.mmsi}`)
    if (typeof properties.imo === 'string') lines.push(`IMO: ${properties.imo}`)
    if (typeof properties.shipTypeLabel === 'string') lines.push(`TYPE: ${properties.shipTypeLabel}`)
    if (typeof properties.speedKnots === 'number') lines.push(`SPEED: ${properties.speedKnots.toFixed(1)} kn`)
    if (typeof properties.navStatLabel === 'string') lines.push(`NAV STATUS: ${properties.navStatLabel}`)
    if (typeof properties.destination === 'string') lines.push(`DESTINATION: ${properties.destination}`)
    if (selectedVessel.timestamp) lines.push(`LAST OBSERVED: ${selectedVessel.timestamp}`)
    lines.push(`SOURCE: ${selectedVessel.provenance.provider}`)
  }

  return lines.join('\n')
}

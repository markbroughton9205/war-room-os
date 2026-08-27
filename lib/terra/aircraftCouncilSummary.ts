/**
 * Compact aircraft summary text for future Council consumption — pure formatting only, exposed
 * through TerraActiveLocationContext.tsx's `selectedEvent`/`aircraftSummary` fields alongside the
 * existing semantic handoff. Renders nothing itself and creates no Council runtime; only the
 * bounded regional summary and the current selection are read, never the full aircraft feed.
 */
import type { TerraGeoFeature } from './types'
import type { TerraAircraftRegionalSummary } from './aircraftRegionalSummary'

export function formatTerraAircraftCouncilSummary(
  selectedAircraft: TerraGeoFeature | null,
  regionalSummary: TerraAircraftRegionalSummary | null,
): string {
  const lines: string[] = []

  if (regionalSummary) {
    lines.push(`AIRCRAFT IN CURRENT REGION: ${regionalSummary.totalCount}`)
  }

  if (selectedAircraft && selectedAircraft.kind === 'aircraft_state') {
    const properties = selectedAircraft.properties
    const callsign = typeof properties.callsign === 'string' && properties.callsign ? properties.callsign : selectedAircraft.title
    lines.push(`SELECTED AIRCRAFT: ${callsign}`)
    if (selectedAircraft.altitude !== null) lines.push(`ALTITUDE: ${Math.round(selectedAircraft.altitude)} m`)
    if (typeof properties.headingDeg === 'number') lines.push(`HEADING: ${Math.round(properties.headingDeg)}°`)
    if (typeof properties.velocityMps === 'number') lines.push(`SPEED: ${Math.round(properties.velocityMps * 3.6)} km/h`)
    if (selectedAircraft.timestamp) lines.push(`LAST OBSERVED: ${selectedAircraft.timestamp}`)
    lines.push(`SOURCE: ${selectedAircraft.provenance.provider}`)
  }

  return lines.join('\n')
}

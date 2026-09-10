/**
 * Own-sensor AIS observation contract (AIS-catcher / local SDR).
 *
 * Real ingest path:
 *   AIS antenna → SDR / AIS-catcher → POST /api/terra/own-sensor/ais
 *   → maritimeOwnSensorStore → ais_catcher_own_sensor adapter → Terra
 *
 * Hardware is not required for Terra to function. Absence of a receiver is
 * NEEDS_LOCAL_SENSOR, never a provider outage.
 */

export type TerraOwnSensorAisObservation = {
  mmsi: number
  latitude: number
  longitude: number
  /** Already decoded to knots/degrees by the local bridge — never raw AIS-encoded integers, and
   * already sentinel-filtered to null (never a raw 511/360/102.3 "not available" marker). */
  speedKnots: number | null
  courseDeg: number | null
  headingDeg: number | null
  navStatCode: number | null
  observedAtIso: string
}

/**
 * Always returns 'not_configured' this phase — there is no bridge process to poll and none is
 * simulated. Exists only so a future real implementation has one obvious place to add real
 * receiver-polling logic without another Terra layer/component needing to change: it would start
 * returning real TerraOwnSensorAisObservation records from that same call.
 */
export function pollOwnSensorAisObservations(): { status: 'not_configured' | 'live'; observations: TerraOwnSensorAisObservation[] } {
  return { status: 'not_configured', observations: [] }
}

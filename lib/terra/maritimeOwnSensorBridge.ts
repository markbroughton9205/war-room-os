/**
 * Own-sensor AIS observation contract (AIS-catcher / local SDR).
 *
 * Real ingest path:
 *   AIS antenna → SDR / AIS-catcher → POST /api/terra/own-sensor/ais
 *   → maritimeOwnSensorStore → ais_catcher_own_sensor adapter → Terra
 *
 * Hardware is not required for Terra to function. Absence of a receiver is
 * NEEDS_LOCAL_SENSOR, never a provider outage. Live ingest is POST /api/terra/own-sensor/ais.
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
 * Reports whether a local receiver is feeding this process. The live ingest path is
 * POST /api/terra/own-sensor/ais; this helper stays client-safe and never fabricates observations.
 */
export function pollOwnSensorAisObservations(): { status: 'not_configured' | 'live'; observations: TerraOwnSensorAisObservation[] } {
  return { status: 'not_configured', observations: [] }
}

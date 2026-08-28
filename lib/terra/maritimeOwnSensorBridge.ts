/**
 * Architectural boundary for a future own AIS receiver (AIS-catcher / local SDR) — mission
 * requirement: reserve the plumbing so a real receiver plugs into the SAME normalized vessel
 * pipeline every other Maritime source uses, instead of a second system being built later. No
 * hardware is fielded this phase, and nothing here fabricates a receiver observation — every
 * function is either a pure decode of a real ITU-R M.1371 field shape or is unreachable until a
 * real bridge process exists.
 *
 * Intended real shape, once a Commander fields a receiver (see
 * lib/terra/maritimeSourceRegistry.ts's ais_catcher_own_sensor entry, configurationState
 * 'HARDWARE_REQUIRED'):
 *
 *   AIS-catcher / local SDR
 *       -> a small local bridge process (not built this phase) that decodes raw NMEA/AIVDM
 *          sentences and posts them, already decoded, to a new War Room-internal endpoint
 *       -> that endpoint validates the shape below and republishes it through the exact same
 *          lib/terra/normalizeDigitrafficMarineVessels.ts-style normalizer (or a thin sibling
 *          reusing its sentinel-filtering rules) into TerraIntelligenceEvent — never a parallel
 *          "own sensor" event kind, Terra layer, or rendering path.
 *
 * `TerraOwnSensorAisObservation` intentionally mirrors the exact field set
 * lib/research-engine/providers/digitraffic_marine.ts already normalizes (mmsi/lat/lon/sog/cog/
 * heading/navStat), not a superset, so a real bridge's output needs no bespoke mapping layer when
 * it eventually exists.
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
export function pollOwnSensorAisObservations(): { status: 'not_configured'; observations: [] } {
  return { status: 'not_configured', observations: [] }
}

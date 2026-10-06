/**
 * NEXRAD N0Q base-reflectivity legend. Reflectivity is a MEASURED radar return in dBZ.
 * It is not a precipitation rate, not an accumulation, and not a forecast.
 */

export const RADAR_INTENSITY_UNIT = 'dBZ'
export const RADAR_INTENSITY_QUANTITY = 'Base reflectivity'

/** Below this the mosaic renders transparent — the radar reports no significant echo. */
export const RADAR_ECHO_FLOOR_DBZ = 5

export type RadarIntensityBand = {
  /** Inclusive lower bound in dBZ. */
  minDbz: number
  /** Exclusive upper bound in dBZ, or null for the open-ended top band. */
  maxDbz: number | null
  label: string
  /** Representative swatch from the NWS/IEM reflectivity ramp. */
  color: string
}

export const RADAR_INTENSITY_BANDS: readonly RadarIntensityBand[] = [
  { minDbz: 5, maxDbz: 20, label: 'Light', color: '#04e9e7' },
  { minDbz: 20, maxDbz: 35, label: 'Moderate', color: '#02fd02' },
  { minDbz: 35, maxDbz: 45, label: 'Heavy', color: '#fdf802' },
  { minDbz: 45, maxDbz: 55, label: 'Very heavy', color: '#fd0000' },
  { minDbz: 55, maxDbz: null, label: 'Extreme · hail possible', color: '#f800fd' },
]

export function radarIntensityBandLabel(band: RadarIntensityBand): string {
  return band.maxDbz === null
    ? `${band.minDbz}+ ${RADAR_INTENSITY_UNIT}`
    : `${band.minDbz}–${band.maxDbz} ${RADAR_INTENSITY_UNIT}`
}

/** One-line legend summary for compact surfaces such as the traffic-cam player. */
export function radarLegendSummary(): string {
  return `${RADAR_INTENSITY_QUANTITY} · ${RADAR_INTENSITY_UNIT} · ${RADAR_INTENSITY_BANDS[0]?.minDbz ?? RADAR_ECHO_FLOOR_DBZ}${RADAR_INTENSITY_UNIT} floor`
}

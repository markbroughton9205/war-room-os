export type TerraLocationTarget = {
  latitude: number
  longitude: number
  label: string
  source: 'coordinates' | 'nominatim'
}

export type TerraLocationResolution =
  | { status: 'resolved'; target: TerraLocationTarget }
  | { status: 'ambiguous' | 'unresolved'; message: string }

const COORDINATE_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/

/** Client-safe command boundary shared by typed input today and a future voice adapter. */
export function parseTerraCoordinates(command: string): TerraLocationTarget | null {
  const match = COORDINATE_PATTERN.exec(command)
  if (!match) return null
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return {
    latitude,
    longitude,
    label: `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`,
    source: 'coordinates',
  }
}

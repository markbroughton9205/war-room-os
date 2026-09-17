import type { TerraDegreeRectangle } from './aircraftBoundingBox'

/** New York State 511 camera/map envelope. API requires a developer key; official viewer is public.
 * West edge stays inland of Toronto so Ontario 511 remains the Toronto camera envelope. */
export const NY511_COVERAGE_BBOX: TerraDegreeRectangle = { west: -79.25, south: 40.4, east: -71.8, north: 45.1 }

export const NY511_OFFICIAL_VIEWER = 'https://511ny.org/'

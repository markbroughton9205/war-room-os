/**
 * Terra Maritime layer -> digitraffic_marine bounding-box query string, PLUS the Maritime Coverage
 * Resolver's camera-side half: whether the Commander's current view rectangle intersects any
 * registered source's known coverage envelope at all.
 *
 * digitraffic_marine's own /locations endpoint has no bounding-box parameter — it always returns
 * every vessel in Finnish waters (~1,300-1,400 records) — so lib/research-engine/providers
 * /digitraffic_marine.ts filters that always-whole-country response to this bbox server-side. The
 * bbox format ("lamin,lomin,lamax,lomax") deliberately matches
 * lib/terra/aircraftBoundingBox.ts's OpenSky convention exactly, including the grid-snap-for-cache
 * behavior, reusing its TerraDegreeRectangle type rather than declaring a second one.
 *
 * The coverage-envelope gate is the architectural difference from aircraft: OpenSky is a genuine
 * global feed (any span up to MAX_BBOX_SPAN_DEG is meaningful), but digitraffic_marine's coverage
 * is a specific, bounded, honestly-documented region. A camera view that never touches that region
 * (e.g. the open Pacific) must produce `null` here — the caller (TerraShell.tsx) reads that as
 * NO_COVERAGE, never as "zero vessels observed" (mission-critical distinction — see
 * lib/terra/maritimeCoverage.ts).
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

const MAX_BBOX_SPAN_DEG = 20
const BBOX_GRID_DEG = 0.1

// Finnish territorial waters + EEZ (Gulf of Finland, Bothnian Bay/Sea, Archipelago Sea,
// approaches to the Åland Islands) — the real, documented scope of Digitraffic's marine-traffic
// data (digitraffic.fi/en/marine-traffic: "Finnish waterways", Finnish Transport Infrastructure
// Agency). A generous bounding rectangle around that real coverage area, not a claim that AIS
// reception is uniform everywhere inside it (terrestrial AIS is line-of-sight — see
// lib/terra/maritimeSourceRegistry.ts's DIGITRAFFIC_MARINE record for the coverage note).
export const DIGITRAFFIC_MARINE_COVERAGE_BBOX: TerraDegreeRectangle = { west: 19.0, south: 58.9, east: 31.6, north: 65.9 }

function snapDown(value: number): number {
  return Math.floor(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function snapUp(value: number): number {
  return Math.ceil(value / BBOX_GRID_DEG) * BBOX_GRID_DEG
}

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

/** True only when the given camera rectangle genuinely overlaps a known Maritime source's real
 * coverage envelope — the Maritime Coverage Resolver's "is there any lawful source for this
 * region at all" question, independent of whether that source is actually enabled/configured. */
export function terraCameraViewHasMaritimeCoverage(rectangle: TerraDegreeRectangle | null): boolean {
  if (!rectangle) return false
  if (![rectangle.west, rectangle.south, rectangle.east, rectangle.north].every(Number.isFinite)) return false
  return rectanglesIntersect(rectangle, DIGITRAFFIC_MARINE_COVERAGE_BBOX)
}

export function buildTerraMaritimeBoundingBoxQuery(rectangle: TerraDegreeRectangle | null, coverageBbox: TerraDegreeRectangle = DIGITRAFFIC_MARINE_COVERAGE_BBOX): string | null {
  if (!rectangle) return null
  const { west, south, east, north } = rectangle
  if (![west, south, east, north].every(Number.isFinite)) return null
  if (east <= west || north <= south) return null
  if (east - west > MAX_BBOX_SPAN_DEG || north - south > MAX_BBOX_SPAN_DEG) return null
  if (!rectanglesIntersect(rectangle, coverageBbox)) return null

  const clampedSouth = Math.max(-90, Math.min(90, south))
  const clampedNorth = Math.max(-90, Math.min(90, north))
  const clampedWest = Math.max(-180, Math.min(180, west))
  const clampedEast = Math.max(-180, Math.min(180, east))
  if (clampedEast <= clampedWest || clampedNorth <= clampedSouth) return null

  const lamin = snapDown(clampedSouth).toFixed(1)
  const lomin = snapDown(clampedWest).toFixed(1)
  const lamax = snapUp(clampedNorth).toFixed(1)
  const lomax = snapUp(clampedEast).toFixed(1)
  return `${lamin},${lomin},${lamax},${lomax}`
}

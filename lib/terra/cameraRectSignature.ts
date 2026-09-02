/**
 * Value-based identity for a Terra camera view rectangle — lets a consumer compare "did the
 * Commander's visible region actually change" without relying on object reference equality, which
 * a hook can legitimately return a fresh wrapper for on every render even when the underlying
 * degrees haven't moved. See TerraShell.tsx's camera-hover-dismiss effect for the consumer.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'

export function terraCameraRectSignature(rectangle: TerraDegreeRectangle | null): string | null {
  if (!rectangle) return null
  return `${rectangle.west},${rectangle.south},${rectangle.east},${rectangle.north}`
}

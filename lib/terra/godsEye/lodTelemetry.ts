export type TerraLodTelemetry = {
  fps: number | null
  primitiveCount: number | null
  dataSourceCount: number | null
  entityCount: number | null
  memoryMb: number | null
}

export function emptyTerraLodTelemetry(): TerraLodTelemetry {
  return { fps: null, primitiveCount: null, dataSourceCount: null, entityCount: null, memoryMb: null }
}

type MemoryInfo = { usedJSHeapSize?: number }

export function sampleBrowserMemoryMb(): number | null {
  const memory = (performance as Performance & { memory?: MemoryInfo }).memory
  if (!memory?.usedJSHeapSize || !Number.isFinite(memory.usedJSHeapSize)) return null
  return Math.round(memory.usedJSHeapSize / 1_048_576)
}

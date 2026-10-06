import type { TerraGeoFeature } from '@/lib/terra/types'
import type { TerraGeometryBudget, TerraPackedGeometry } from './types'

const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT
const UINT32_BYTES = Uint32Array.BYTES_PER_ELEMENT

export type TerraGeometryEstimate = {
  features: number
  vertices: number
  attributes: number
  indices: number
  float64Bytes: number
  float32Bytes: number
  indexBytes: number
  estimatedTotalBytes: number
}

function featureVertices(feature: TerraGeoFeature): number {
  if (feature.geometryKind === 'region') {
    return feature.regionRings?.reduce((total, ring) => total + ring.length, 0) ?? 0
  }
  if (feature.geometryKind === 'line') return feature.pathCoordinates?.length ?? 0
  return 1
}

export function estimateTerraGeometry(features: readonly TerraGeoFeature[]): TerraGeometryEstimate {
  let vertices = 0
  for (const feature of features) vertices += featureVertices(feature)
  const attributes = vertices * 3
  const indices = Math.max(0, vertices - features.length)
  const float64Bytes = vertices * 2 * FLOAT64_BYTES
  const float32Bytes = attributes * Float32Array.BYTES_PER_ELEMENT
  const indexBytes = indices * UINT32_BYTES
  // Includes typed-array metadata, offsets/lengths/kinds and a measured 1.35x construction
  // headroom for Cesium's Cartesian conversion. The input arrays are transferred, not cloned.
  const bookkeeping = features.length * (UINT32_BYTES * 3 + 1)
  return {
    features: features.length,
    vertices,
    attributes,
    indices,
    float64Bytes,
    float32Bytes,
    indexBytes,
    estimatedTotalBytes: Math.ceil((float64Bytes + float32Bytes + indexBytes + bookkeeping) * 1.35),
  }
}

export function deriveTerraGeometryBudget(options?: {
  hardwareConcurrency?: number
  deviceMemoryGb?: number
}): TerraGeometryBudget {
  const hardwareConcurrency = Math.max(1, options?.hardwareConcurrency ?? 4)
  const deviceMemoryGb = Math.max(2, options?.deviceMemoryGb ?? 4)
  // One job receives at most 1/4096 of reported RAM, bounded to keep a single Cesium handoff
  // below one frame's practical integration envelope. These are derived limits, not dataset
  // guesses: 4 GiB => 1 MiB, 8 GiB => 2 MiB, 32 GiB => the measured 4 MiB ceiling.
  const memoryDerivedBytes = Math.floor((deviceMemoryGb * 1024 ** 3) / 4096)
  const maxEstimatedBytes = Math.max(512 * 1024, Math.min(4 * 1024 * 1024, memoryDerivedBytes))
  const maxVertices = Math.max(4_096, Math.floor(maxEstimatedBytes / 48))
  const maxFeatures = Math.max(128, Math.min(2_048, Math.floor(maxVertices / 6)))
  const maxIntegrationMs = hardwareConcurrency <= 4 ? 2 : hardwareConcurrency <= 8 ? 3 : 4
  return {
    maxFeatures,
    maxVertices,
    maxEstimatedBytes,
    maxIntegrationMs,
    source: `RAM/4096=${memoryDerivedBytes}B; capped at 4MiB; ${hardwareConcurrency} logical CPUs`,
  }
}

export function splitTerraGeometryJobs(
  features: readonly TerraGeoFeature[],
  budget: TerraGeometryBudget,
): TerraGeoFeature[][] {
  const chunks: TerraGeoFeature[][] = []
  let current: TerraGeoFeature[] = []
  let vertices = 0
  let bytes = 0

  for (const feature of features) {
    const nextVertices = featureVertices(feature)
    const nextBytes = estimateTerraGeometry([feature]).estimatedTotalBytes
    const exceeds = current.length > 0 && (
      current.length + 1 > budget.maxFeatures
      || vertices + nextVertices > budget.maxVertices
      || bytes + nextBytes > budget.maxEstimatedBytes
    )
    if (exceeds) {
      chunks.push(current)
      current = []
      vertices = 0
      bytes = 0
    }
    current.push(feature)
    vertices += nextVertices
    bytes += nextBytes
  }
  if (current.length) chunks.push(current)
  return chunks
}

export function packTerraGeometry(
  features: readonly TerraGeoFeature[],
  originalIndexOffset = 0,
  maxVertices = Number.POSITIVE_INFINITY,
): TerraPackedGeometry {
  let sourceVertexCount = 0
  for (const feature of features) sourceVertexCount += featureVertices(feature)
  const globalStride = sourceVertexCount > maxVertices
    ? Math.max(2, Math.ceil((sourceVertexCount - 1) / Math.max(1, maxVertices - 1)))
    : 1
  let vertexCount = 0
  for (const feature of features) {
    const count = featureVertices(feature)
    const stride = feature.geometryKind === 'point' ? 1 : globalStride
    vertexCount += count === 0 ? 0 : Math.ceil(count / stride) + (count > 1 && (count - 1) % stride !== 0 ? 1 : 0)
  }
  const coordinates = new Float64Array(vertexCount * 2)
  const offsets = new Uint32Array(features.length)
  const lengths = new Uint32Array(features.length)
  const featureIndices = new Uint32Array(features.length)
  const geometryKinds = new Uint8Array(features.length)
  const clusterCounts = new Uint32Array(features.length)
  clusterCounts.fill(1)
  let cursor = 0

  features.forEach((feature, index) => {
    offsets[index] = cursor / 2
    featureIndices[index] = originalIndexOffset + index
    const source = feature.geometryKind === 'region'
      ? (feature.regionRings?.[0] ?? [])
      : feature.geometryKind === 'line'
        ? (feature.pathCoordinates ?? [])
        : [[feature.longitude, feature.latitude]]
    geometryKinds[index] = feature.geometryKind === 'region' ? 1 : feature.geometryKind === 'line' ? 2 : 0
    const stride = feature.geometryKind === 'point' ? 1 : globalStride
    for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += stride) {
      const pair = source[sourceIndex]
      const longitude = Number(pair[0])
      const latitude = Number(pair[1])
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue
      coordinates[cursor++] = longitude
      coordinates[cursor++] = latitude
      lengths[index] += 1
    }
    if (source.length > 1 && (source.length - 1) % stride !== 0) {
      const pair = source[source.length - 1]
      const longitude = Number(pair[0])
      const latitude = Number(pair[1])
      if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
        coordinates[cursor++] = longitude
        coordinates[cursor++] = latitude
        lengths[index] += 1
      }
    }
  })

  return {
    coordinates: cursor === coordinates.length ? coordinates : coordinates.slice(0, cursor),
    offsets,
    lengths,
    featureIndices,
    geometryKinds,
    clusterCounts,
  }
}

export function packedGeometryBytes(payload: TerraPackedGeometry): number {
  return payload.coordinates.byteLength
    + payload.offsets.byteLength
    + payload.lengths.byteLength
    + payload.featureIndices.byteLength
    + payload.geometryKinds.byteLength
    + payload.clusterCounts.byteLength
}

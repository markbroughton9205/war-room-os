import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import type { TerraGeoFeature } from '@/lib/terra/types'
import {
  deriveTerraGeometryBudget,
  estimateTerraGeometry,
  packTerraGeometry,
  packedGeometryBytes,
  splitTerraGeometryJobs,
} from './geometryBudget'
import {
  poolSizeForHardware,
  terraBackpressureForDepth,
  terraMaxPriorityForBackpressure,
} from './pool'

function feature(id: string, vertices: number): TerraGeoFeature {
  const ring = Array.from({ length: vertices }, (_, index) => [
    -180 + (index % 360),
    -80 + (index % 160),
  ])
  return {
    id,
    eventId: id,
    providerId: 'usgs_earthquake_feed',
    kind: 'severe_weather_alert',
    longitude: 0,
    latitude: 0,
    altitude: null,
    timestamp: null,
    title: id,
    summary: null,
    properties: {},
    provenance: {
      provider: 'usgs_earthquake_feed',
      sourceUrl: null,
      retrievedAt: new Date(0).toISOString(),
      fromCache: false,
      isHistorical: false,
    },
    rawReference: { documentId: null, providerRecordId: id, canonicalUrl: null },
    coordinateOrigin: 'observed',
    geoResolution: null,
    geometryKind: 'region',
    regionRings: [ring],
    pathCoordinates: null,
  } as TerraGeoFeature
}

const budget = deriveTerraGeometryBudget({ hardwareConcurrency: 16, deviceMemoryGb: 32 })
assert.equal(budget.maxEstimatedBytes, 4 * 1024 * 1024)
assert.equal(budget.maxIntegrationMs, 4)
assert.equal(poolSizeForHardware(16), 4)
assert.equal(poolSizeForHardware(4), 1)
assert.equal(terraBackpressureForDepth(240), 'PRESSURE')
assert.equal(terraMaxPriorityForBackpressure('PRESSURE'), 2)
assert.equal(terraBackpressureForDepth(600), 'CRITICAL')
assert.equal(terraMaxPriorityForBackpressure('CRITICAL'), 1)

const normal = Array.from({ length: budget.maxFeatures + 7 }, (_, index) => feature(`normal-${index}`, 12))
const chunks = splitTerraGeometryJobs(normal, budget)
assert.ok(chunks.length >= 2, 'feature-count pressure must split before submission')
for (const chunk of chunks) {
  const estimate = estimateTerraGeometry(chunk)
  assert.ok(chunk.length <= budget.maxFeatures)
  assert.ok(estimate.vertices <= budget.maxVertices)
}

// Former failure shape: one source feature alone exceeds the complete job budget. Packing must
// simplify before allocating its transferable coordinate buffer.
const giant = feature('giant', budget.maxVertices * 3)
assert.ok(estimateTerraGeometry([giant]).estimatedTotalBytes > budget.maxEstimatedBytes)
const packed = packTerraGeometry([giant], 0, budget.maxVertices)
assert.ok(packed.coordinates.length / 2 <= budget.maxVertices)
assert.ok(packedGeometryBytes(packed) < budget.maxEstimatedBytes)

// Ownership proof: transferring an ArrayBuffer detaches the sender. Terra never reads a packed
// payload after postMessage(..., transferList).
const transferable = new ArrayBuffer(64)
const moved = structuredClone({ transferable }, { transfer: [transferable] })
assert.equal(transferable.byteLength, 0)
assert.equal(moved.transferable.byteLength, 64)

const workerSource = fs.readFileSync('public/workers/terra-preprocessor.js', 'utf8')
const workerMessages: { message: Record<string, unknown>; transfer: ArrayBuffer[] }[] = []
const workerScope = {
  postMessage(message: Record<string, unknown>, transfer: ArrayBuffer[] = []) {
    workerMessages.push({ message, transfer })
  },
  onmessage: null as ((event: { data: unknown }) => void) | null,
}
vm.runInNewContext(workerSource, { self: workerScope, performance, console })
assert.ok(workerScope.onmessage)
workerScope.onmessage!({
  data: {
    type: 'RUN_JOB',
    jobId: 'cluster-proof',
    task: 'CAMERA_CLUSTER',
    context: { generation: 1, viewBand: 'GLOBAL', bbox: null, layerId: 'cameras', priority: 1 },
    simplifyStride: 1,
    payload: {
      coordinates: new Float64Array([0, 0, 1, 1, 50, 20]),
      offsets: new Uint32Array([0, 1, 2]),
      lengths: new Uint32Array([1, 1, 1]),
      featureIndices: new Uint32Array([0, 1, 2]),
      geometryKinds: new Uint8Array([0, 0, 0]),
      clusterCounts: new Uint32Array([1, 1, 1]),
    },
  },
})
const clusterMessage = workerMessages.at(-1)!
assert.equal(clusterMessage.message.type, 'JOB_COMPLETE')
const clusterPayload = clusterMessage.message.payload as { featureIndices: Uint32Array; clusterCounts: Uint32Array }
assert.equal(clusterPayload.featureIndices.length, 2)
assert.deepEqual(Array.from(clusterPayload.clusterCounts).sort((a, b) => a - b), [1, 2])
assert.equal(clusterMessage.transfer.length, 6)

workerScope.onmessage!({ data: { type: 'CANCEL_GENERATION', generation: 7 } })
workerScope.onmessage!({
  data: {
    type: 'RUN_JOB',
    jobId: 'cancel-proof',
    task: 'FEATURE_FILTER',
    context: { generation: 7, viewBand: 'GLOBAL', bbox: null, layerId: 'hazards', priority: 1 },
    simplifyStride: 1,
    payload: {
      coordinates: new Float64Array([0, 0]),
      offsets: new Uint32Array([0]),
      lengths: new Uint32Array([1]),
      featureIndices: new Uint32Array([0]),
      geometryKinds: new Uint8Array([0]),
      clusterCounts: new Uint32Array([1]),
    },
  },
})
assert.equal(workerMessages.at(-1)!.message.type, 'JOB_CANCELLED')

console.log(JSON.stringify({
  ok: true,
  budget,
  chunks: chunks.length,
  giantSourceVertices: budget.maxVertices * 3,
  giantPackedVertices: packed.coordinates.length / 2,
  giantPackedBytes: packedGeometryBytes(packed),
  transferableDetached: transferable.byteLength === 0,
  workerClusterCounts: Array.from(clusterPayload.clusterCounts),
  generationCancellation: workerMessages.at(-1)!.message.type,
}))

/* Terra bounded preprocessing worker. Protocol types live in lib/terra/worker/types.ts. */
const cancelledJobs = new Set()
const cancelledGenerations = new Set()
const cancelledLayers = new Set()

function isCancelled(request) {
  return cancelledJobs.has(request.jobId)
    || cancelledGenerations.has(request.context.generation)
    || cancelledLayers.has(request.context.layerId)
}

function transferList(payload) {
  return [
    payload.coordinates.buffer,
    payload.offsets.buffer,
    payload.lengths.buffer,
    payload.featureIndices.buffer,
    payload.geometryKinds.buffer,
    payload.clusterCounts.buffer,
  ]
}

function clusterCellDegrees(request) {
  if (request.context.viewBand === 'SPACE' || request.context.viewBand === 'GLOBAL') return 8
  if (request.context.viewBand === 'CONTINENTAL') return 2
  if (request.context.viewBand === 'REGIONAL') return 0.3
  if (request.context.viewBand === 'CITY') return 0.04
  return 0
}

function clusterPoints(payload, request) {
  const clusterTask = request.task === 'CAMERA_CLUSTER'
    || request.task === 'VEHICLE_CLUSTER'
    || request.task === 'HAZARD_CLUSTER'
    || request.task === 'CLUSTER'
  const cellDegrees = clusterCellDegrees(request)
  if (!clusterTask || cellDegrees <= 0) return payload

  const groups = new Map()
  const passthrough = []
  for (let index = 0; index < payload.featureIndices.length; index++) {
    if (payload.geometryKinds[index] !== 0 || payload.lengths[index] === 0) {
      passthrough.push(index)
      continue
    }
    const coordinateIndex = payload.offsets[index] * 2
    const longitude = payload.coordinates[coordinateIndex]
    const latitude = payload.coordinates[coordinateIndex + 1]
    const key = `${Math.floor(longitude / cellDegrees)}:${Math.floor(latitude / cellDegrees)}`
    const group = groups.get(key)
    if (group) {
      group.count += 1
      group.longitude += longitude
      group.latitude += latitude
    } else groups.set(key, { sourceIndex: index, count: 1, longitude, latitude })
  }

  const rows = [
    ...passthrough.map(sourceIndex => ({ sourceIndex, count: 1, longitude: 0, latitude: 0, point: false })),
    ...Array.from(groups.values()).map(group => ({ ...group, point: true })),
  ]
  if (rows.length === payload.featureIndices.length) return payload
  let vertices = 0
  for (const row of rows) vertices += row.point ? 1 : payload.lengths[row.sourceIndex]
  const output = {
    coordinates: new Float64Array(vertices * 2),
    offsets: new Uint32Array(rows.length),
    lengths: new Uint32Array(rows.length),
    featureIndices: new Uint32Array(rows.length),
    geometryKinds: new Uint8Array(rows.length),
    clusterCounts: new Uint32Array(rows.length),
  }
  let cursor = 0
  rows.forEach((row, outputIndex) => {
    const sourceIndex = row.sourceIndex
    output.offsets[outputIndex] = cursor / 2
    output.featureIndices[outputIndex] = payload.featureIndices[sourceIndex]
    output.geometryKinds[outputIndex] = payload.geometryKinds[sourceIndex]
    output.clusterCounts[outputIndex] = row.count
    if (row.point) {
      output.coordinates[cursor++] = row.longitude / row.count
      output.coordinates[cursor++] = row.latitude / row.count
      output.lengths[outputIndex] = 1
      return
    }
    const sourceStart = payload.offsets[sourceIndex] * 2
    const coordinateLength = payload.lengths[sourceIndex] * 2
    output.coordinates.set(payload.coordinates.subarray(sourceStart, sourceStart + coordinateLength), cursor)
    cursor += coordinateLength
    output.lengths[outputIndex] = payload.lengths[sourceIndex]
  })
  return output
}

function processGeometry(request) {
  const input = request.payload
  const accepted = []
  let outputVertices = 0
  for (let index = 0; index < input.featureIndices.length; index++) {
    if ((index & 127) === 0 && isCancelled(request)) return null
    const offset = input.offsets[index]
    const length = input.lengths[index]
    if (length === 0) continue
    let valid = true
    for (let vertex = 0; vertex < length; vertex++) {
      const coordinateIndex = (offset + vertex) * 2
      const longitude = input.coordinates[coordinateIndex]
      const latitude = input.coordinates[coordinateIndex + 1]
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        valid = false
        break
      }
    }
    if (!valid) continue
    accepted.push(index)
    const stride = input.geometryKinds[index] === 0 ? 1 : Math.max(1, request.simplifyStride)
    outputVertices += Math.max(1, Math.ceil(length / stride))
  }

  const clusterTask = request.task === 'CAMERA_CLUSTER'
    || request.task === 'VEHICLE_CLUSTER'
    || request.task === 'HAZARD_CLUSTER'
    || request.task === 'CLUSTER'
  if (accepted.length === input.featureIndices.length && request.simplifyStride === 1 && !clusterTask) return input

  const coordinates = new Float64Array(outputVertices * 2)
  const offsets = new Uint32Array(accepted.length)
  const lengths = new Uint32Array(accepted.length)
  const featureIndices = new Uint32Array(accepted.length)
  const geometryKinds = new Uint8Array(accepted.length)
  const clusterCounts = new Uint32Array(accepted.length)
  clusterCounts.fill(1)
  let cursor = 0
  accepted.forEach((inputIndex, outputIndex) => {
    if (isCancelled(request)) return
    const offset = input.offsets[inputIndex]
    const length = input.lengths[inputIndex]
    const kind = input.geometryKinds[inputIndex]
    const stride = kind === 0 ? 1 : Math.max(1, request.simplifyStride)
    offsets[outputIndex] = cursor / 2
    featureIndices[outputIndex] = input.featureIndices[inputIndex]
    geometryKinds[outputIndex] = kind
    for (let vertex = 0; vertex < length; vertex += stride) {
      const sourceIndex = (offset + vertex) * 2
      coordinates[cursor++] = input.coordinates[sourceIndex]
      coordinates[cursor++] = input.coordinates[sourceIndex + 1]
      lengths[outputIndex] += 1
    }
    if (length > 1 && (length - 1) % stride !== 0) {
      const sourceIndex = (offset + length - 1) * 2
      coordinates[cursor++] = input.coordinates[sourceIndex]
      coordinates[cursor++] = input.coordinates[sourceIndex + 1]
      lengths[outputIndex] += 1
    }
  })
  return { coordinates, offsets, lengths, featureIndices, geometryKinds, clusterCounts }
}

self.onmessage = event => {
  const message = event.data
  if (message.type === 'CANCEL_JOB') {
    cancelledJobs.add(message.jobId)
    return
  }
  if (message.type === 'CANCEL_GENERATION') {
    cancelledGenerations.add(message.generation)
    return
  }
  if (message.type === 'CANCEL_LAYER') {
    cancelledLayers.add(message.layerId)
    return
  }

  const started = performance.now()
  try {
    if (isCancelled(message)) {
      self.postMessage({ type: 'JOB_CANCELLED', jobId: message.jobId, context: message.context })
      return
    }
    const prepared = processGeometry(message)
    const payload = prepared ? clusterPoints(prepared, message) : null
    if (!payload || isCancelled(message)) {
      self.postMessage({ type: 'JOB_CANCELLED', jobId: message.jobId, context: message.context })
      return
    }
    self.postMessage({
      type: 'JOB_COMPLETE',
      jobId: message.jobId,
      context: message.context,
      payload,
      durationMs: performance.now() - started,
    }, transferList(payload))
  } catch (error) {
    self.postMessage({
      type: 'JOB_FAILED',
      jobId: message.jobId,
      context: message.context,
      error: {
        name: error instanceof Error ? error.name : 'WorkerError',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    })
  } finally {
    cancelledJobs.delete(message.jobId)
  }
}

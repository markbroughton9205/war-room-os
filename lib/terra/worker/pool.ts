'use client'

import type { TerraGeoFeature } from '@/lib/terra/types'
import {
  deriveTerraGeometryBudget,
  packTerraGeometry,
  packedGeometryBytes,
  splitTerraGeometryJobs,
} from './geometryBudget'
import { TerraRenderScheduler } from './renderScheduler'
import {
  TERRA_JOB_PRIORITIES,
  type TerraGeometryBudget,
  type TerraJobContext,
  type TerraPackedGeometry,
  type TerraJobPriority,
  type TerraWorkerCancel,
  type TerraWorkerMetrics,
  type TerraWorkerRequest,
  type TerraWorkerResponse,
  type TerraWorkerTask,
  type TerraViewBandName,
} from './types'

type QueueEntry = {
  request: TerraWorkerRequest
  resolve: (payload: TerraPackedGeometry) => void
  reject: (error: Error) => void
}

type WorkerSlot = {
  worker: Worker
  jobId: string | null
  restarts: number
}

type PrepareOptions = {
  layerId: string
  viewBand?: TerraViewBandName
  bbox?: TerraJobContext['bbox']
  priority?: TerraJobPriority
  task?: TerraWorkerTask
  signal?: AbortSignal
}

const EMPTY_METRICS: TerraWorkerMetrics = {
  active: false,
  workerCount: 0,
  queuedJobs: 0,
  runningJobs: 0,
  cancelledJobs: 0,
  completedJobs: 0,
  failedJobs: 0,
  droppedStaleResults: 0,
  droppedBackpressureJobs: 0,
  largestJobBytes: 0,
  largestVertexCount: 0,
  integrationQueue: 0,
  backpressure: 'NORMAL',
  generation: 0,
  frameTimeMs: null,
  p95FrameTimeMs: null,
  longFrameCount: 0,
  longTaskCount: 0,
  transferableBuffers: true,
  smoothMode: false,
}

function poolSizeForHardware(logicalCpus: number): number {
  // At most one quarter of logical CPUs and never more than four. This leaves the majority of
  // capacity to Cesium's own workers, Electron/Chromium, the UI thread and the OS.
  return Math.max(1, Math.min(4, Math.floor(Math.max(1, logicalCpus) / 4)))
}

export function terraBackpressureForDepth(depth: number): TerraWorkerMetrics['backpressure'] {
  if (depth >= 600) return 'CRITICAL'
  if (depth >= 240) return 'PRESSURE'
  if (depth >= 80) return 'BUSY'
  return 'NORMAL'
}

export function terraMaxPriorityForBackpressure(pressure: TerraWorkerMetrics['backpressure']): number {
  if (pressure === 'CRITICAL') return 1
  if (pressure === 'PRESSURE') return 2
  if (pressure === 'BUSY') return 3
  return 4
}

function transferList(payload: TerraPackedGeometry): Transferable[] {
  return [
    payload.coordinates.buffer,
    payload.offsets.buffer,
    payload.lengths.buffer,
    payload.featureIndices.buffer,
    payload.geometryKinds.buffer,
    payload.clusterCounts.buffer,
  ]
}

export class TerraWorkerPool {
  private workers: WorkerSlot[] = []
  private queue: QueueEntry[] = []
  private running = new Map<string, QueueEntry>()
  private listeners = new Set<() => void>()
  private metrics: TerraWorkerMetrics = { ...EMPTY_METRICS }
  private jobSequence = 0
  private initialized = false
  readonly budget: TerraGeometryBudget
  readonly renderScheduler: TerraRenderScheduler

  constructor() {
    const hardwareConcurrency = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
    const deviceMemoryGb = typeof navigator === 'undefined'
      ? 4
      : ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4)
    this.budget = deriveTerraGeometryBudget({ hardwareConcurrency, deviceMemoryGb })
    this.renderScheduler = new TerraRenderScheduler(partial => this.updateMetrics(partial))
  }

  getSnapshot = (): TerraWorkerMetrics => this.metrics

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize(): void {
    if (this.initialized || typeof Worker === 'undefined') return
    this.initialized = true
    this.renderScheduler.start()
    const workerCount = poolSizeForHardware(navigator.hardwareConcurrency || 4)
    for (let index = 0; index < workerCount; index++) this.workers.push(this.createWorkerSlot())
    this.updateMetrics({ active: this.workers.length > 0, workerCount: this.workers.length })
  }

  suspend(): void {
    if (!this.initialized) return
    this.initialized = false
    for (const entry of this.queue) {
      entry.reject(new DOMException('Terra route inactive.', 'AbortError'))
      this.metrics.cancelledJobs += 1
    }
    this.queue = []
    for (const entry of this.running.values()) {
      entry.reject(new DOMException('Terra route inactive.', 'AbortError'))
      this.metrics.cancelledJobs += 1
    }
    this.running.clear()
    for (const slot of this.workers) slot.worker.terminate()
    this.workers = []
    this.renderScheduler.suspend()
    this.updateMetrics({
      active: false,
      workerCount: 0,
      queuedJobs: 0,
      runningJobs: 0,
      integrationQueue: 0,
      smoothMode: false,
    })
  }

  nextGeneration(): number {
    const previous = this.metrics.generation
    const generation = previous + 1
    this.cancelGeneration(previous)
    this.renderScheduler.setGeneration(generation)
    this.updateMetrics({ generation })
    return generation
  }

  setSmoothMode(active: boolean): void {
    this.renderScheduler.setSmoothMode(active)
    if (active) {
      this.queue = this.queue.filter(entry => {
        if (entry.request.context.priority <= TERRA_JOB_PRIORITIES.P2_NEAR_VIEW) return true
        entry.reject(new DOMException('Deferred for Living Orbit smooth mode.', 'AbortError'))
        this.metrics.cancelledJobs += 1
        return false
      })
      this.publishQueueMetrics()
    }
  }

  cancelGeneration(generation: number): void {
    if (generation < 0) return
    this.broadcast({ type: 'CANCEL_GENERATION', generation })
    this.cancelQueued(entry => entry.request.context.generation === generation)
  }

  cancelLayer(layerId: string): void {
    for (const entry of this.running.values()) {
      if (entry.request.context.layerId === layerId) {
        this.broadcast({ type: 'CANCEL_JOB', jobId: entry.request.jobId })
      }
    }
    this.cancelQueued(entry => entry.request.context.layerId === layerId)
    this.renderScheduler.cancelLayer(layerId)
  }

  async prepareFeatures(features: readonly TerraGeoFeature[], options: PrepareOptions): Promise<TerraPackedGeometry[]> {
    if (!features.length) return []
    this.initialize()
    const chunks = splitTerraGeometryJobs(features, this.budget)
    const results: TerraPackedGeometry[] = []
    let originalIndexOffset = 0

    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new DOMException('Terra job aborted.', 'AbortError')
      const packed = packTerraGeometry(chunk, originalIndexOffset, this.budget.maxVertices)
      originalIndexOffset += chunk.length
      const payload = await this.submit(packed, {
        generation: this.metrics.generation,
        viewBand: options.viewBand ?? 'GLOBAL',
        bbox: options.bbox ?? null,
        layerId: options.layerId,
        priority: options.priority ?? TERRA_JOB_PRIORITIES.P1_CURRENT_VIEW,
      }, options.task ?? 'FEATURE_FILTER', 1, options.signal)
      results.push(payload)
    }
    return results
  }

  async prepareCoordinates(
    coordinates: readonly { longitude: number; latitude: number }[],
    options: PrepareOptions,
  ): Promise<TerraPackedGeometry> {
    this.initialize()
    const count = Math.min(coordinates.length, this.budget.maxFeatures, this.budget.maxVertices)
    const packed: TerraPackedGeometry = {
      coordinates: new Float64Array(count * 2),
      offsets: new Uint32Array(count),
      lengths: new Uint32Array(count),
      featureIndices: new Uint32Array(count),
      geometryKinds: new Uint8Array(count),
      clusterCounts: new Uint32Array(count),
    }
    packed.lengths.fill(1)
    packed.clusterCounts.fill(1)
    for (let index = 0; index < count; index++) {
      packed.coordinates[index * 2] = coordinates[index].longitude
      packed.coordinates[index * 2 + 1] = coordinates[index].latitude
      packed.offsets[index] = index
      packed.featureIndices[index] = index
    }
    return this.submit(packed, {
      generation: this.metrics.generation,
      viewBand: options.viewBand ?? 'GLOBAL',
      bbox: options.bbox ?? null,
      layerId: options.layerId,
      priority: options.priority ?? TERRA_JOB_PRIORITIES.P1_CURRENT_VIEW,
    }, options.task ?? 'COORDINATE_PROJECT', 1, options.signal)
  }

  private submit(
    payload: TerraPackedGeometry,
    context: TerraJobContext,
    task: TerraWorkerTask,
    simplifyStride: number,
    signal?: AbortSignal,
  ): Promise<TerraPackedGeometry> {
    const bytes = packedGeometryBytes(payload)
    const vertices = payload.coordinates.length / 2
    this.updateMetrics({
      largestJobBytes: Math.max(this.metrics.largestJobBytes, bytes),
      largestVertexCount: Math.max(this.metrics.largestVertexCount, vertices),
    })

    if (!this.workers.length) return Promise.resolve(payload)
    const pressure = this.metrics.backpressure
    if ((pressure === 'CRITICAL' && context.priority > 1) || (pressure === 'PRESSURE' && context.priority > 2)) {
      this.updateMetrics({ droppedBackpressureJobs: this.metrics.droppedBackpressureJobs + 1 })
      return Promise.reject(new DOMException('Terra worker backpressure rejected this job.', 'AbortError'))
    }

    const jobId = `terra-${Date.now().toString(36)}-${++this.jobSequence}`
    return new Promise<TerraPackedGeometry>((resolve, reject) => {
      const entry: QueueEntry = {
        request: { type: 'RUN_JOB', jobId, task, context, payload, simplifyStride },
        resolve,
        reject,
      }
      const abort = () => {
        this.broadcast({ type: 'CANCEL_JOB', jobId })
        this.cancelQueued(candidate => candidate.request.jobId === jobId)
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.queue.push(entry)
      this.queue.sort((a, b) => a.request.context.priority - b.request.context.priority)
      this.publishQueueMetrics()
      this.dispatch()
    })
  }

  private createWorkerSlot(): WorkerSlot {
    // Public JavaScript is intentional: Turbopack treats new URL("*.ts", import.meta.url) as a
    // raw media asset, which would send TypeScript syntax to Chromium instead of a worker bundle.
    const worker = new Worker('/workers/terra-preprocessor.js', { type: 'module', name: 'terra-preprocessor' })
    const slot: WorkerSlot = { worker, jobId: null, restarts: 0 }
    worker.onmessage = event => this.handleWorkerMessage(slot, event.data as TerraWorkerResponse)
    worker.onerror = () => this.handleWorkerFailure(slot)
    return slot
  }

  private handleWorkerMessage(slot: WorkerSlot, message: TerraWorkerResponse): void {
    const entry = this.running.get(message.jobId)
    this.running.delete(message.jobId)
    slot.jobId = null
    if (!entry) {
      this.dispatch()
      return
    }
    if (message.type === 'JOB_CANCELLED') {
      this.updateMetrics({ cancelledJobs: this.metrics.cancelledJobs + 1 })
      entry.reject(new DOMException('Terra worker job cancelled.', 'AbortError'))
    } else if (message.type === 'JOB_FAILED') {
      this.updateMetrics({ failedJobs: this.metrics.failedJobs + 1 })
      entry.reject(new Error(`${message.error.name}: ${message.error.message}`))
    } else if (message.context.generation !== this.metrics.generation) {
      this.updateMetrics({ droppedStaleResults: this.metrics.droppedStaleResults + 1 })
      entry.reject(new DOMException('Stale Terra worker result discarded.', 'AbortError'))
    } else {
      this.updateMetrics({ completedJobs: this.metrics.completedJobs + 1 })
      entry.resolve(message.payload)
    }
    this.publishQueueMetrics()
    this.dispatch()
  }

  private handleWorkerFailure(slot: WorkerSlot): void {
    const entry = slot.jobId ? this.running.get(slot.jobId) : null
    if (slot.jobId) this.running.delete(slot.jobId)
    entry?.reject(new Error('Terra preprocessing worker failed.'))
    this.updateMetrics({ failedJobs: this.metrics.failedJobs + (entry ? 1 : 0) })
    slot.worker.terminate()
    if (slot.restarts < 1) {
      const replacement = this.createWorkerSlot()
      replacement.restarts = slot.restarts + 1
      const index = this.workers.indexOf(slot)
      if (index >= 0) this.workers[index] = replacement
    } else {
      this.workers = this.workers.filter(candidate => candidate !== slot)
      this.updateMetrics({ workerCount: this.workers.length, active: this.workers.length > 0 })
    }
    this.dispatch()
  }

  private dispatch(): void {
    for (const slot of this.workers) {
      if (slot.jobId || !this.queue.length) continue
      const entry = this.queue.shift()!
      slot.jobId = entry.request.jobId
      this.running.set(entry.request.jobId, entry)
      slot.worker.postMessage(entry.request, transferList(entry.request.payload))
    }
    this.publishQueueMetrics()
  }

  private broadcast(message: TerraWorkerCancel): void {
    for (const slot of this.workers) slot.worker.postMessage(message)
  }

  private cancelQueued(predicate: (entry: QueueEntry) => boolean): void {
    const retained: QueueEntry[] = []
    for (const entry of this.queue) {
      if (predicate(entry)) {
        entry.reject(new DOMException('Terra worker job cancelled.', 'AbortError'))
        this.metrics.cancelledJobs += 1
      } else retained.push(entry)
    }
    this.queue = retained
    this.publishQueueMetrics()
  }

  private publishQueueMetrics(): void {
    const initialQueuedJobs = this.queue.length
    const integrationQueue = this.metrics.integrationQueue
    const pressure = terraBackpressureForDepth(initialQueuedJobs + integrationQueue)
    const maxPriority = terraMaxPriorityForBackpressure(pressure)
    if (maxPriority < 4) {
      const retained: QueueEntry[] = []
      for (const entry of this.queue) {
        if (entry.request.context.priority <= maxPriority) retained.push(entry)
        else {
          entry.reject(new DOMException(`Terra ${pressure.toLowerCase()} backpressure dropped this job.`, 'AbortError'))
          this.metrics.droppedBackpressureJobs += 1
        }
      }
      this.queue = retained
      for (const entry of this.running.values()) {
        if (entry.request.context.priority > maxPriority) {
          this.broadcast({ type: 'CANCEL_JOB', jobId: entry.request.jobId })
        }
      }
    }
    this.updateMetrics({ queuedJobs: this.queue.length, runningJobs: this.running.size, backpressure: pressure })
  }

  private updateMetrics(partial: Partial<TerraWorkerMetrics>): void {
    this.metrics = { ...this.metrics, ...partial }
    if (typeof window !== 'undefined') {
      ;(window as Window & { __terraWorkerMetrics?: TerraWorkerMetrics }).__terraWorkerMetrics = this.metrics
      ;(window as Window & {
        __terraWorkerRuntime?: {
          status: 'ACTIVE' | 'INACTIVE'
          metrics: TerraWorkerMetrics
          budget: TerraGeometryBudget
          poolSizingReason: string
          transferableOwnership: string
        }
      }).__terraWorkerRuntime = {
        status: this.metrics.active ? 'ACTIVE' : 'INACTIVE',
        metrics: this.metrics,
        budget: this.budget,
        poolSizingReason: 'min(4, floor(hardwareConcurrency / 4)); reserves at least 75% of logical CPUs',
        transferableOwnership: 'Sender buffers detach at postMessage; only the current owner may read or reuse them.',
      }
    }
    for (const listener of this.listeners) listener()
  }
}

let singleton: TerraWorkerPool | null = null

export function terraWorkerPool(): TerraWorkerPool {
  if (!singleton) singleton = new TerraWorkerPool()
  return singleton
}

export { poolSizeForHardware }

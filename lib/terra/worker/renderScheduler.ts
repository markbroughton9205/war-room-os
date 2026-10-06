import type { TerraBackpressure, TerraWorkerMetrics } from './types'

type IntegrationTask = {
  id: string
  generation: number
  priority: number
  layerId: string
  run: () => void
  drop?: () => void
}

const FRAME_WINDOW = 180
const LONG_FRAME_MS = 34

export class TerraRenderScheduler {
  private queue: IntegrationTask[] = []
  private frameHandle: number | null = null
  private frameTimes: number[] = []
  private lastFrameAt: number | null = null
  private smoothMode = false
  private generation = 0
  private longFrameCount = 0
  private longTaskCount = 0
  private lastMetricsAt = 0
  private idleScheduled = false
  private observer: PerformanceObserver | null = null

  constructor(private readonly onMetrics: (partial: Partial<TerraWorkerMetrics>) => void) {
    this.start()
  }

  start(): void {
    if (typeof window === 'undefined' || this.frameHandle !== null) return
    try {
      this.observer = new PerformanceObserver(list => {
        this.longTaskCount += list.getEntries().length
      })
      this.observer.observe({ type: 'longtask', buffered: true })
    } catch {
      this.observer = null
    }
    this.frameHandle = requestAnimationFrame(this.frame)
  }

  setGeneration(generation: number): void {
    this.generation = generation
    this.queue = this.queue.filter(task => {
      const keep = task.generation >= generation
      if (!keep) task.drop?.()
      return keep
    })
  }

  setSmoothMode(active: boolean): void {
    this.smoothMode = active
    this.onMetrics({ smoothMode: active })
  }

  enqueue(task: IntegrationTask): boolean {
    const pressure = this.pressure()
    if (pressure === 'CRITICAL' && task.priority > 1) return false
    if (pressure === 'PRESSURE' && task.priority > 2) return false
    this.queue.push(task)
    this.queue.sort((a, b) => a.priority - b.priority)
    if (task.priority >= 4) this.scheduleIdleWork()
    this.onMetrics({ integrationQueue: this.queue.length, backpressure: this.pressure() })
    return true
  }

  cancelLayer(layerId: string): void {
    this.queue = this.queue.filter(task => {
      const keep = task.layerId !== layerId
      if (!keep) task.drop?.()
      return keep
    })
  }

  suspend(): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = null
    for (const task of this.queue) task.drop?.()
    this.queue = []
    this.observer?.disconnect()
    this.observer = null
    this.lastFrameAt = null
    this.onMetrics({ integrationQueue: 0 })
  }

  destroy(): void {
    this.suspend()
  }

  private pressure(): TerraBackpressure {
    if (this.queue.length >= 600) return 'CRITICAL'
    if (this.queue.length >= 240) return 'PRESSURE'
    if (this.queue.length >= 80) return 'BUSY'
    return 'NORMAL'
  }

  private scheduleIdleWork(): void {
    if (this.idleScheduled || typeof window === 'undefined' || !('requestIdleCallback' in window)) return
    this.idleScheduled = true
    window.requestIdleCallback(deadline => {
      this.idleScheduled = false
      if (deadline.timeRemaining() < 1 || this.smoothMode) return
      const index = this.queue.findIndex(task => task.priority >= 4)
      if (index < 0) return
      const [task] = this.queue.splice(index, 1)
      if (task.generation === this.generation) {
        try {
          task.run()
        } catch {
          // Layer-scoped failure; render loop remains alive.
        }
      } else task.drop?.()
      if (this.queue.some(candidate => candidate.priority >= 4)) this.scheduleIdleWork()
    }, { timeout: 500 })
  }

  private frame = (now: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame)
    if (this.lastFrameAt !== null) {
      const frameTime = now - this.lastFrameAt
      this.frameTimes.push(frameTime)
      if (this.frameTimes.length > FRAME_WINDOW) this.frameTimes.shift()
      if (frameTime >= LONG_FRAME_MS) this.longFrameCount += 1
    }
    this.lastFrameAt = now
    if (document.visibilityState === 'hidden') return

    const recent = this.frameTimes.length ? this.frameTimes[this.frameTimes.length - 1] : 16.7
    const pressureBudget = recent > 28 ? 1 : recent > 20 ? 2 : this.smoothMode ? 2 : 4
    const maxFramePriority = recent > 20 || this.smoothMode ? 2 : 4
    const deadline = performance.now() + pressureBudget
    while (this.queue.length > 0 && performance.now() < deadline) {
      const nextIndex = this.queue.findIndex(candidate => candidate.priority <= maxFramePriority)
      if (nextIndex < 0) break
      const [task] = this.queue.splice(nextIndex, 1)
      if (task.generation !== this.generation) {
        task.drop?.()
        continue
      }
      try {
        task.run()
      } catch {
        // A failed attachment degrades its layer only. The next task and render frame continue.
      }
    }

    // Inspector truth is sampled at 2 Hz. Publishing a new external-store snapshot every frame
    // would itself force TerraShell to render at animation frequency and defeat this scheduler.
    if (now - this.lastMetricsAt >= 500) {
      this.lastMetricsAt = now
      const sorted = [...this.frameTimes].sort((a, b) => a - b)
      const average = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null
      this.onMetrics({
        integrationQueue: this.queue.length,
        backpressure: this.pressure(),
        frameTimeMs: average,
        p95FrameTimeMs: p95,
        longFrameCount: this.longFrameCount,
        longTaskCount: this.longTaskCount,
      })
    }
  }
}

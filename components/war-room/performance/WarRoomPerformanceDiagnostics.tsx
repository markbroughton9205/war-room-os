'use client'

import { useEffect, useMemo, useState } from 'react'

type FetchSample = {
  url: string
  at: number
  durationMs?: number
  noStore: boolean
}

type PanelRenderSample = {
  id: string
  label: string
  durationMs: number
  at: number
}

type SlowInteractionSample = {
  name: string
  durationMs: number
  at: number
}

type RuntimeSnapshot = {
  activeIntervals: number
  activeTimeouts: number
  activeAnimationFrames: number
  activeFetches: number
  activePollingEndpoints: number
  slowestComponent: PanelRenderSample | null
  lastSlowInteraction: SlowInteractionSample | null
  renderPressureEstimate: 'low' | 'medium' | 'high'
  redSentinelScansInWindow: number
  lastRedSentinelScanAt: number | null
  memoryPressureEstimate: string
  noStoreFetchesInWindow: number
}

type WarRoomPerfRuntime = {
  installed: boolean
  intervals: Set<number>
  timeouts: Set<number>
  animationFrames: Set<number>
  activeFetches: number
  fetches: FetchSample[]
  redSentinelScans: number[]
  slowestComponent: PanelRenderSample | null
  lastSlowInteraction: SlowInteractionSample | null
  originalSetInterval: typeof window.setInterval
  originalClearInterval: typeof window.clearInterval
  originalSetTimeout: typeof window.setTimeout
  originalClearTimeout: typeof window.clearTimeout
  originalRequestAnimationFrame: typeof window.requestAnimationFrame
  originalCancelAnimationFrame: typeof window.cancelAnimationFrame
  originalFetch: typeof window.fetch
}

type PanelRenderEvent = CustomEvent<PanelRenderSample>

declare global {
  interface Window {
    __warRoomPerfRuntime?: WarRoomPerfRuntime
  }
}

const FETCH_WINDOW_MS = 60_000
const SENTINEL_WINDOW_MS = 5 * 60_000

function endpointKey(url: string) {
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.pathname
  } catch {
    return url.split('?')[0] ?? url
  }
}

function trimRuntime(runtime: WarRoomPerfRuntime) {
  const now = Date.now()
  runtime.fetches = runtime.fetches.filter(fetch => now - fetch.at < FETCH_WINDOW_MS)
  runtime.redSentinelScans = runtime.redSentinelScans.filter(at => now - at < SENTINEL_WINDOW_MS)
}

function memoryEstimate() {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
  }).memory
  if (!memory?.jsHeapSizeLimit) return 'unavailable'
  const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit
  if (ratio >= 0.8) return `high (${Math.round(ratio * 100)}%)`
  if (ratio >= 0.55) return `medium (${Math.round(ratio * 100)}%)`
  return `low (${Math.round(ratio * 100)}%)`
}

function createSnapshot(runtime: WarRoomPerfRuntime): RuntimeSnapshot {
  trimRuntime(runtime)
  const endpointCounts = new Map<string, number>()
  for (const fetch of runtime.fetches) {
    if (!fetch.noStore) continue
    const key = endpointKey(fetch.url)
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1)
  }
  const activePollingEndpoints = Array.from(endpointCounts.values()).filter(count => count >= 2).length
  const pressureScore =
    runtime.intervals.size * 2
    + runtime.animationFrames.size * 3
    + activePollingEndpoints * 2
    + runtime.activeFetches
    + runtime.timeouts.size * 0.25
  const renderPressureEstimate = pressureScore >= 16 ? 'high' : pressureScore >= 8 ? 'medium' : 'low'

  return {
    activeIntervals: runtime.intervals.size,
    activeTimeouts: runtime.timeouts.size,
    activeAnimationFrames: runtime.animationFrames.size,
    activeFetches: runtime.activeFetches,
    activePollingEndpoints,
    slowestComponent: runtime.slowestComponent,
    lastSlowInteraction: runtime.lastSlowInteraction,
    renderPressureEstimate,
    redSentinelScansInWindow: runtime.redSentinelScans.length,
    lastRedSentinelScanAt: runtime.redSentinelScans.at(-1) ?? null,
    memoryPressureEstimate: memoryEstimate(),
    noStoreFetchesInWindow: runtime.fetches.filter(fetch => fetch.noStore).length,
  }
}

function installRuntimeInstrumentation() {
  if (typeof window === 'undefined') return null
  if (window.__warRoomPerfRuntime?.installed) return window.__warRoomPerfRuntime

  const runtime: WarRoomPerfRuntime = {
    installed: true,
    intervals: new Set(),
    timeouts: new Set(),
    animationFrames: new Set(),
    activeFetches: 0,
    fetches: [],
    redSentinelScans: [],
    slowestComponent: null,
    lastSlowInteraction: null,
    originalSetInterval: window.setInterval.bind(window),
    originalClearInterval: window.clearInterval.bind(window),
    originalSetTimeout: window.setTimeout.bind(window),
    originalClearTimeout: window.clearTimeout.bind(window),
    originalRequestAnimationFrame: window.requestAnimationFrame.bind(window),
    originalCancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    originalFetch: window.fetch.bind(window),
  }

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = runtime.originalSetInterval(handler, timeout, ...args)
    runtime.intervals.add(id)
    return id
  }) as typeof window.setInterval

  window.clearInterval = ((id?: number) => {
    if (typeof id === 'number') runtime.intervals.delete(id)
    return runtime.originalClearInterval(id)
  }) as typeof window.clearInterval

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = runtime.originalSetTimeout(() => {
      runtime.timeouts.delete(id)
      if (typeof handler === 'function') {
        handler(...args)
        return
      }
      runtime.originalSetTimeout(handler, 0)
    }, timeout)
    runtime.timeouts.add(id)
    return id
  }) as typeof window.setTimeout

  window.clearTimeout = ((id?: number) => {
    if (typeof id === 'number') runtime.timeouts.delete(id)
    return runtime.originalClearTimeout(id)
  }) as typeof window.clearTimeout

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = runtime.originalRequestAnimationFrame(time => {
      runtime.animationFrames.delete(id)
      callback(time)
    })
    runtime.animationFrames.add(id)
    return id
  }) as typeof window.requestAnimationFrame

  window.cancelAnimationFrame = ((id: number) => {
    runtime.animationFrames.delete(id)
    return runtime.originalCancelAnimationFrame(id)
  }) as typeof window.cancelAnimationFrame

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    const started = performance.now()
    const noStore = init?.cache === 'no-store' || (input instanceof Request && input.cache === 'no-store')
    runtime.activeFetches += 1
    if (url.includes('/api/red-sentinel/scan')) {
      runtime.redSentinelScans.push(Date.now())
    }
    try {
      return await runtime.originalFetch(input, init)
    } finally {
      runtime.activeFetches = Math.max(0, runtime.activeFetches - 1)
      runtime.fetches.push({
        url,
        at: Date.now(),
        durationMs: performance.now() - started,
        noStore,
      })
      trimRuntime(runtime)
    }
  }) as typeof window.fetch

  window.__warRoomPerfRuntime = runtime
  return runtime
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-cyan-400/15 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-[11px] text-cyan-100">{value}</div>
    </div>
  )
}

export function WarRoomPerformanceDiagnostics() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)

  useEffect(() => {
    const runtime = installRuntimeInstrumentation()
    if (!runtime) return

    const publish = () => setSnapshot(createSnapshot(runtime))
    const panelListener = (event: Event) => {
      const detail = (event as PanelRenderEvent).detail
      if (!detail?.id) return
      if (!runtime.slowestComponent || detail.durationMs > runtime.slowestComponent.durationMs) {
        runtime.slowestComponent = detail
      }
      publish()
    }

    const observers: PerformanceObserver[] = []
    if ('PerformanceObserver' in window) {
      try {
        const eventObserver = new PerformanceObserver(list => {
          const entries = list.getEntries()
          for (const entry of entries) {
            if (entry.duration < 80) continue
            runtime.lastSlowInteraction = {
              name: entry.name || entry.entryType,
              durationMs: entry.duration,
              at: Date.now(),
            }
          }
        })
        eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit)
        observers.push(eventObserver)
      } catch {
        /* Event Timing is not available in every browser. */
      }
    }

    window.addEventListener('war-room-panel-render', panelListener)
    publish()
    const interval = window.setInterval(publish, 2000)
    return () => {
      window.removeEventListener('war-room-panel-render', panelListener)
      observers.forEach(observer => observer.disconnect())
      window.clearInterval(interval)
    }
  }, [])

  const redSentinelLabel = useMemo(() => {
    if (!snapshot?.lastRedSentinelScanAt) return 'none in 5m'
    return `${snapshot.redSentinelScansInWindow} in 5m · last ${new Date(snapshot.lastRedSentinelScanAt).toLocaleTimeString()}`
  }, [snapshot])

  return (
    <section className="mx-auto mt-8 max-w-6xl rounded border border-cyan-400/20 bg-cyan-400/5 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-cyan-300">Performance Diagnostics</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Runtime Pressure Monitor</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">
            Browser-only instrumentation for War Room timers, polling fetches, slow interactions, panel mount cost, Red Sentinel scan rate, and heap pressure. It does not change provider, signal, audit, or council truth.
          </p>
        </div>
        <span className="rounded border border-cyan-400/30 px-2 py-1 font-mono text-[10px] uppercase text-cyan-100">
          {snapshot?.renderPressureEstimate ?? 'warming'}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Metric label="Active Polling" value={String(snapshot?.activePollingEndpoints ?? 0)} />
        <Metric label="Active Timers" value={`${snapshot?.activeIntervals ?? 0} intervals · ${snapshot?.activeTimeouts ?? 0} timeouts`} />
        <Metric label="Animation Frames" value={String(snapshot?.activeAnimationFrames ?? 0)} />
        <Metric label="No-store Fetches" value={`${snapshot?.noStoreFetchesInWindow ?? 0}/60s`} />
        <Metric label="Slowest Component" value={snapshot?.slowestComponent ? `${snapshot.slowestComponent.label} ${Math.round(snapshot.slowestComponent.durationMs)}ms` : 'not observed'} />
        <Metric label="Last Slow Interaction" value={snapshot?.lastSlowInteraction ? `${snapshot.lastSlowInteraction.name} ${Math.round(snapshot.lastSlowInteraction.durationMs)}ms` : 'none observed'} />
        <Metric label="Render Pressure" value={snapshot?.renderPressureEstimate ?? 'warming'} />
        <Metric label="Red Sentinel" value={redSentinelLabel} />
        <Metric label="Memory Pressure" value={snapshot?.memoryPressureEstimate ?? 'checking'} />
        <Metric label="Active Fetches" value={String(snapshot?.activeFetches ?? 0)} />
      </div>
    </section>
  )
}

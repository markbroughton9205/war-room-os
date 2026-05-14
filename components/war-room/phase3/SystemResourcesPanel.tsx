'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'

type ResourceWarnings = {
  memory: string
  cpu: string
  thermal: string
}

type ResourceSnapshot = {
  platform: string
  hostname: string
  freemem: number
  totalmem: number
  memoryUsageRatio: number
  loadavg: number[]
  processMemoryRss: number
  cpuUsageSinceStart?: { user: number; system: number }
  warnings: ResourceWarnings
}

type Counters = Record<string, unknown>

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function loadDisplay(snap: ResourceSnapshot) {
  if (snap.warnings.cpu === 'unknown') return '—'
  const [a, b, c] = snap.loadavg
  if (![a, b, c].every(v => typeof v === 'number' && Number.isFinite(v))) return '—'
  return `${a.toFixed(2)} / ${b.toFixed(2)} / ${c.toFixed(2)}`
}

const DEFAULT_POLL_MS = 120_000

export function SystemResourcesPanel({
  autoRefreshEnabled = false,
  tabActive = true,
  pollIntervalMs = DEFAULT_POLL_MS,
}: {
  /** When false (default), load once on mount + manual Refresh only. */
  autoRefreshEnabled?: boolean
  /** When false, polling is paused (e.g. tab not selected). */
  tabActive?: boolean
  pollIntervalMs?: number
} = {}) {
  const [mounted, setMounted] = useState(false)
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null)
  const [counters, setCounters] = useState<Counters | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const { uiMode } = useWarRoomUiMode()

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/system/resources', { cache: 'no-store' })
      const j = await res.json() as { snapshot?: ResourceSnapshot; counters?: Counters; error?: string }
      if (!res.ok) throw new Error(j.error || res.statusText)
      setSnapshot(j.snapshot ?? null)
      setCounters(j.counters ?? null)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
      setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    const t = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(t)
  }, [mounted, load])

  useEffect(() => {
    if (!mounted || !autoRefreshEnabled) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (!tabActive) return
      void load()
    }
    const t = window.setInterval(tick, Math.max(pollIntervalMs, 120_000))
    return () => window.clearInterval(t)
  }, [mounted, autoRefreshEnabled, tabActive, pollIntervalMs, load])

  if (!mounted) return null

  const memPct = snapshot ? `${(snapshot.memoryUsageRatio * 100).toFixed(1)}%` : '—'

  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #334155', background: 'rgba(15,23,42,0.35)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest" style={{ color: '#94A3B8' }}>SYSTEM RESOURCES</span>
        <span className="text-[10px] opacity-60">
          /api/system/resources
          {autoRefreshEnabled ? ` · ${Math.max(pollIntervalMs, 120_000) / 1000}s` : ' · manual'}
        </span>
        <button
          type="button"
          className="rounded px-2 py-1 text-[10px] font-bold"
          style={{ border: '1px solid #555', color: '#ccc' }}
          onClick={() => void load()}
        >
          REFRESH
        </button>
      </div>
      {err && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{err}</div>}
      {!snapshot && !err && <div style={{ color: '#666' }}>Loading…</div>}
      {snapshot && (
        <dl className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2" style={{ color: '#cbd5e1' }}>
          <div><dt className="inline text-[#64748b]">Host </dt><dd className="inline font-mono">{snapshot.hostname}</dd></div>
          <div><dt className="inline text-[#64748b]">Platform </dt><dd className="inline font-mono">{snapshot.platform}</dd></div>
          <div><dt className="inline text-[#64748b]">RAM used </dt><dd className="inline">{memPct}</dd></div>
          <div><dt className="inline text-[#64748b]">Free / total </dt><dd className="inline font-mono">{formatBytes(snapshot.freemem)} / {formatBytes(snapshot.totalmem)}</dd></div>
          <div><dt className="inline text-[#64748b]">Process RSS </dt><dd className="inline font-mono">{formatBytes(snapshot.processMemoryRss)}</dd></div>
          <div><dt className="inline text-[#64748b]">Load (1/5/15) </dt><dd className="inline font-mono">{loadDisplay(snapshot)}</dd></div>
          <div><dt className="inline text-[#64748b]">CPU hint </dt><dd className="inline">{snapshot.warnings.cpu === 'unknown' ? 'unknown' : snapshot.warnings.cpu}</dd></div>
          <div><dt className="inline text-[#64748b]">Memory gate </dt><dd className="inline">{snapshot.warnings.memory}</dd></div>
          <div><dt className="inline text-[#64748b]">Thermal </dt><dd className="inline">{snapshot.warnings.thermal}</dd></div>
          {snapshot.cpuUsageSinceStart && (
            <div className="sm:col-span-2">
              <dt className="text-[#64748b]">CPU usage (process, µs since start) </dt>
              <dd className="mt-0.5 font-mono text-[10px]">
                user {snapshot.cpuUsageSinceStart.user.toLocaleString()} · system {snapshot.cpuUsageSinceStart.system.toLocaleString()}
              </dd>
            </div>
          )}
        </dl>
      )}
      {counters && Object.keys(counters).length > 0 && (
        uiMode === 'operator' ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-[9px] font-bold tracking-widest" style={{ color: '#64748b' }}>Advanced Diagnostics (counters JSON)</summary>
            <pre className="mt-2 max-h-24 overflow-auto text-[9px]" style={{ color: '#64748b' }}>{JSON.stringify(counters, null, 2)}</pre>
          </details>
        ) : (
          <pre className="mt-2 max-h-24 overflow-auto text-[9px]" style={{ color: '#64748b' }}>{JSON.stringify(counters, null, 2)}</pre>
        )
      )}
    </section>
  )
}

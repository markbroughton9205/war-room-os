'use client'

import { useCallback, useEffect, useState } from 'react'
import type { WarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'

type LimitsResponse = {
  limits: Record<string, number>
  counters: Record<string, unknown>
  snapshot: {
    memoryUsageRatio: number
    warnings: { memory: string; cpu: string }
    loadavg: number[]
    platform: string
  }
  paused: boolean
  throttled: boolean
  hints?: {
    internetPollsRemaining: number
    redSentinelRetryAfterMs: number
  }
}

const DEFAULT_POLL_MS = 120_000

export function WorkerHealthPanel({
  uiMode,
  autoRefreshEnabled = false,
  tabActive = true,
  pollIntervalMs = DEFAULT_POLL_MS,
}: {
  uiMode: WarRoomUiMode
  autoRefreshEnabled?: boolean
  tabActive?: boolean
  pollIntervalMs?: number
}) {
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<LimitsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/workers/limits', { cache: 'no-store' })
      const j = await res.json() as LimitsResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || res.statusText)
      setData(j)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
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

  const cpuLabel = data?.snapshot.warnings.cpu === 'unknown' ? 'unknown' : (data?.snapshot.warnings.cpu ?? '—')

  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #422006', background: 'rgba(66,32,6,0.25)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest" style={{ color: '#FBBF24' }}>WORKER LIMITS</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] opacity-60">
            /api/workers/limits
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
      </div>
      {err && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{err}</div>}
      {!data && !err && <div style={{ color: '#666' }}>Loading…</div>}
      {data && (
        <div className="space-y-2 text-[11px]" style={{ color: '#e2e8f0' }}>
          <div className="flex flex-wrap gap-3">
            <span>
              Paused (memory):{' '}
              <strong style={{ color: data.paused ? '#F87171' : '#34D399' }}>{data.paused ? 'yes' : 'no'}</strong>
            </span>
            <span>
              Throttled:{' '}
              <strong style={{ color: data.throttled ? '#FBBF24' : '#34D399' }}>{data.throttled ? 'yes' : 'no'}</strong>
            </span>
          </div>
          <div className="text-[10px]" style={{ color: '#94a3b8' }}>
            Host memory {(data.snapshot.memoryUsageRatio * 100).toFixed(1)}% · CPU gate {cpuLabel}
            {' · '}
            polls left {data.hints?.internetPollsRemaining ?? '—'}
            {' · '}
            sentinel wait {typeof data.hints?.redSentinelRetryAfterMs === 'number' ? `${Math.ceil(data.hints.redSentinelRetryAfterMs / 1000)}s` : '—'}
          </div>
          {uiMode === 'operator' ? (
            <details>
              <summary className="cursor-pointer text-[9px] font-bold tracking-widest" style={{ color: '#78716c' }}>Advanced Diagnostics (limits / counters JSON)</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <pre className="max-h-32 overflow-auto rounded p-2 text-[9px]" style={{ background: 'rgba(0,0,0,0.35)', color: '#a8a29e' }}>{JSON.stringify(data.limits, null, 2)}</pre>
                <pre className="max-h-32 overflow-auto rounded p-2 text-[9px]" style={{ background: 'rgba(0,0,0,0.35)', color: '#a8a29e' }}>{JSON.stringify(data.counters, null, 2)}</pre>
              </div>
            </details>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <pre className="max-h-32 overflow-auto rounded p-2 text-[9px]" style={{ background: 'rgba(0,0,0,0.35)', color: '#a8a29e' }}>{JSON.stringify(data.limits, null, 2)}</pre>
              <pre className="max-h-32 overflow-auto rounded p-2 text-[9px]" style={{ background: 'rgba(0,0,0,0.35)', color: '#a8a29e' }}>{JSON.stringify(data.counters, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type ProviderRuntimeHealth =
  | 'CONNECTED'
  | 'DEGRADED'
  | 'MISSING_KEY'
  | 'RATE_LIMITED'
  | 'INVALID_KEY'

type ProviderRuntimeStatus = {
  id: string
  provider: string
  family: string
  optional: boolean
  configured: boolean
  health: ProviderRuntimeHealth
  latencyMs: number | null
  checkedAt: string
  lastSuccessAt: string | null
  quotaState: 'ok' | 'rate_limited' | 'unknown'
  rateLimitResetAt: string | null
  activeModels: string[]
  signalAvailability: boolean
  note: string
}

type ProviderRuntimeSummary = {
  generatedAt: string
  providers: ProviderRuntimeStatus[]
  signalAvailability: {
    tavily: boolean
    firecrawl: boolean
    liveSignalsAvailable: boolean
    note: string
  }
  guardrails: {
    serverSideOnly: true
    apiKeysSerialized: false
    timeoutProtected: true
    providerFailureIsolation: true
    autonomousExecution: false
  }
}

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function colorFor(value: string) {
  if (value === 'CONNECTED' || value === 'ok') return '#34D399'
  if (value === 'DEGRADED' || value === 'RATE_LIMITED' || value === 'rate_limited') return '#FBBF24'
  if (value === 'INVALID_KEY') return '#F87171'
  if (value === 'MISSING_KEY') return '#A78BFA'
  return '#94A3B8'
}

function Badge({ value }: { value: string }) {
  const color = colorFor(value)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label(value)}
    </span>
  )
}

function MiniMetric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{metricLabel}</div>
      <div className="mt-1 font-mono text-sm text-sky-200">{value}</div>
    </div>
  )
}

function timeLabel(value: string | null) {
  if (!value) return 'none'
  return new Date(value).toLocaleString()
}

export function ProviderRuntimePanel() {
  const [runtime, setRuntime] = useState<ProviderRuntimeSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/providers/status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const body = await res.json() as ProviderRuntimeSummary & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Provider runtime status failed')
      setRuntime(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provider runtime status failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const stats = useMemo(() => {
    const providers = runtime?.providers ?? []
    return {
      connected: providers.filter(provider => provider.health === 'CONNECTED').length,
      configured: providers.filter(provider => provider.configured).length,
      total: providers.length,
      signalProviders: providers.filter(provider => provider.signalAvailability).length,
    }
  }, [runtime?.providers])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-sky-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-sky-300">Runtime</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Provider Runtime</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Server-side cloud provider health checks for AI families and live signal sources. API keys stay on the server; this panel receives only sanitized readiness metadata.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={runtime?.signalAvailability.liveSignalsAvailable ? 'CONNECTED' : 'DEGRADED'} />
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Refresh Checks'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <MiniMetric label="Connected" value={`${stats.connected}/${stats.total}`} />
        <MiniMetric label="Configured" value={`${stats.configured}/${stats.total}`} />
        <MiniMetric label="Signal Providers" value={String(stats.signalProviders)} />
        <MiniMetric label="Tavily" value={runtime?.signalAvailability.tavily ? 'ready' : 'unavailable'} />
        <MiniMetric label="Firecrawl" value={runtime?.signalAvailability.firecrawl ? 'ready' : 'optional/unavailable'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {(runtime?.providers ?? []).map(provider => (
          <article key={provider.id} className="rounded border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{provider.provider}</h3>
                  {provider.optional ? <Badge value="optional" /> : null}
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{provider.family}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge value={provider.health} />
                <Badge value={provider.quotaState} />
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{provider.note}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <MiniMetric label="Latency" value={provider.latencyMs == null ? 'n/a' : `${provider.latencyMs}ms`} />
              <MiniMetric label="Last Success" value={timeLabel(provider.lastSuccessAt)} />
              <MiniMetric label="Signals" value={provider.signalAvailability ? 'available' : 'unavailable'} />
            </div>
            <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] text-slate-500">
              <span className="font-semibold text-slate-300">Active models:</span> {provider.activeModels.length ? provider.activeModels.join(', ') : 'none reported'}
              {provider.rateLimitResetAt ? <span> · reset {timeLabel(provider.rateLimitResetAt)}</span> : null}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        {runtime?.signalAvailability.note ?? 'Provider runtime has not loaded yet.'} Safeguards: server-side only, timeout protected, failure isolated, no autonomous execution, no serialized API keys. Last checked: {runtime?.generatedAt ?? 'loading'}.
      </div>
    </section>
  )
}

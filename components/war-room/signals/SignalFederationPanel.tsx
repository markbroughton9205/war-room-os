'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SignalFederationMetadata } from '@/lib/signals/model'

type FederationStatus = SignalFederationMetadata & {
  generatedAt?: string
  freshness?: { liveCount: number; recentCount: number; historicalCount: number }
  attempts?: Array<{ sourceId: string; ok: boolean; itemCount: number; latencyMs: number; error: string | null }>
}

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function Badge({ value }: { value: string }) {
  const color = value.includes('historical') || value.includes('degraded')
    ? '#FBBF24'
    : value.includes('active')
      ? '#34D399'
      : '#94A3B8'
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
      <div className="mt-1 font-mono text-sm text-cyan-200">{value}</div>
    </div>
  )
}

export function SignalFederationPanel({ embedded }: { embedded?: boolean }) {
  const [status, setStatus] = useState<FederationStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/signals/federation', { cache: 'no-store' })
      const body = await res.json() as { status?: FederationStatus; error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setStatus(body.status ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Federation status failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const chain = status?.fallbackChain ?? ['tavily', 'rss', 'brave', 'firecrawl', 'cache', 'historical']

  return (
    <section className={embedded ? '' : 'mx-auto mt-6 max-w-6xl rounded border border-violet-500/30 bg-violet-500/5 p-4'}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Signal Federation</p>
          <p className="mt-1 text-[10px] text-slate-500">Multi-source routing — no hard Tavily dependency</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded border border-white/15 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-slate-300"
        >
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      {error ? <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-200">{error}</div> : null}

      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="Active Source" value={status?.activeSource ?? '—'} />
        <MiniMetric label="Mode" value={status?.mode ?? '—'} />
        <MiniMetric label="Fallback" value={status?.fallbackActivated ? 'active' : 'none'} />
        <MiniMetric label="Live / Hist" value={`${status?.freshness?.liveCount ?? 0} / ${status?.freshness?.historicalCount ?? 0}`} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {chain.map((source, index) => (
          <span key={source} className="flex items-center gap-1 text-[9px] text-slate-500">
            <Badge value={source === status?.activeSource ? `${source} active` : source} />
            {index < chain.length - 1 ? <span>→</span> : null}
          </span>
        ))}
      </div>

      {status?.degradedSources?.length ? (
        <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-100">
          Degraded: {status.degradedSources.map(label).join(', ')}
        </div>
      ) : null}

      <div className="mb-3 rounded border border-cyan-500/20 bg-black/20 p-2 text-[10px] leading-relaxed text-cyan-100">
        {status?.operatorGuidance ?? 'Load federation status to see operator routing guidance.'}
      </div>

      {status?.confidenceImpact ? (
        <p className="mb-3 text-[10px] text-slate-400">{status.confidenceImpact}</p>
      ) : null}

      {status?.attempts?.length ? (
        <div className="overflow-x-auto rounded border border-white/10">
          <table className="w-full text-left text-[9px] text-slate-400">
            <thead>
              <tr className="border-b border-white/10 text-slate-500">
                <th className="px-2 py-1">Provider</th>
                <th className="px-2 py-1">OK</th>
                <th className="px-2 py-1">Items</th>
                <th className="px-2 py-1">Latency</th>
              </tr>
            </thead>
            <tbody>
              {status.attempts.map(row => (
                <tr key={row.sourceId} className="border-t border-white/5">
                  <td className="px-2 py-1 font-mono text-slate-300">{row.sourceId}</td>
                  <td className="px-2 py-1">{row.ok ? 'yes' : 'no'}</td>
                  <td className="px-2 py-1">{row.itemCount}</td>
                  <td className="px-2 py-1">{row.latencyMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

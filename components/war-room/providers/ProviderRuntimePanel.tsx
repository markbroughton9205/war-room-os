'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type ProviderRuntimeStatus = {
  family: string
  providerId: string
  label: string
  configured: boolean
  connected: boolean
  availability: string
  connectionStatus: string
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  confidence: number
  evidence: string[]
  missingEvidence: string[]
  lastChecked: string
  responseIntegrityStatus?: string
  lastCompleteResponseAt?: string | null
  lastIncompleteResponseAt?: string | null
  consecutiveIntegrityFailures?: number
  retryCount?: number
  fallbackUsed?: boolean
  degradedReason?: string | null
}

type ProviderRuntimeSummary = {
  generatedAt: string
  summary: {
    health: string
    confidence: number
  }
  providers: ProviderRuntimeStatus[]
  guardrails: {
    apiKeysExposed: false
    hiddenExecution: false
    fakeConnectedStates: false
  }
}

type RssIngestionRuntimeStatus = {
  generatedAt: string
  aggregateHealth: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  pollIntervalMinutes: number
  enabledFeedCount: number
  configuredFeedCount: number
  staleFeedCount: number
  lastPollAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  feeds: Array<{
    sourceId: string
    label: string
    health: string
    staleFeedDetection: boolean
    lastPollAt: string | null
    lastItemCount: number | null
    lastErrorMessage: string | null
  }>
}

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function colorFor(value: string) {
  if (value === 'CONNECTED' || value === 'healthy' || value === 'online') return '#34D399'
  if (value === 'DEGRADED' || value === 'RATE_LIMITED' || value === 'degraded' || value === 'standby') return '#FBBF24'
  if (value === 'INVALID_KEY') return '#F87171'
  if (value === 'MISSING_KEY' || value === 'unavailable' || value === 'not_connected') return '#A78BFA'
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
  const [rssRuntime, setRssRuntime] = useState<RssIngestionRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const [canonicalRes, rssRes] = await Promise.all([
        fetch(`/api/runtime/canonical-status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' }),
        fetch('/api/signals/rss/status', { cache: 'no-store' }),
      ])
      const body = await canonicalRes.json() as ProviderRuntimeSummary & { error?: string }
      if (!canonicalRes.ok) throw new Error(body.error || 'Provider runtime status failed')
      setRuntime(body)
      if (rssRes.ok) {
        setRssRuntime(await rssRes.json() as RssIngestionRuntimeStatus)
      } else {
        setRssRuntime(null)
      }
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
      connected: providers.filter(provider => provider.connected).length,
      configured: providers.filter(provider => provider.configured).length,
      total: providers.length,
      degraded: providers.filter(provider => provider.health === 'degraded').length,
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
          <Badge value={runtime?.summary.health ?? 'unknown'} />
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
        <MiniMetric label="Degraded" value={String(stats.degraded)} />
        <MiniMetric label="Confidence" value={runtime ? `${runtime.summary.confidence}%` : 'loading'} />
        <MiniMetric label="Truth Source" value="canonical" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {(runtime?.providers ?? []).map(provider => (
          <article key={provider.family} className="rounded border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{provider.label}</h3>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{provider.providerId}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge value={provider.availability} />
                <Badge value={provider.health} />
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              CONNECTED requires live probe plus recent complete council responses (integrity).
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <MiniMetric label="Configured" value={provider.configured ? 'yes' : 'no'} />
              <MiniMetric label="Connected" value={provider.connected ? 'yes' : 'no'} />
              <MiniMetric label="Confidence" value={`${provider.confidence}%`} />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <MiniMetric label="Integrity" value={provider.responseIntegrityStatus ?? 'unknown'} />
              <MiniMetric label="Integrity failures" value={String(provider.consecutiveIntegrityFailures ?? 0)} />
              <MiniMetric label="Last complete" value={timeLabel(provider.lastCompleteResponseAt ?? null)} />
              <MiniMetric label="Last incomplete" value={timeLabel(provider.lastIncompleteResponseAt ?? null)} />
              <MiniMetric label="Retry count" value={String(provider.retryCount ?? 0)} />
              <MiniMetric label="Fallback used" value={provider.fallbackUsed ? 'yes' : 'no'} />
            </div>
            {provider.degradedReason ? (
              <p className="mt-2 text-[10px] text-amber-200/90">{provider.degradedReason}</p>
            ) : null}
            <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] text-slate-500">
              <span className="font-semibold text-slate-300">Evidence:</span> {provider.evidence.join(' · ')}
              {provider.missingEvidence.length ? <span> · Missing: {provider.missingEvidence.join(' · ')}</span> : null}
            </div>
          </article>
        ))}
      </div>

      <section className="mt-8 border-t border-white/10 pt-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-sky-300">Signals</p>
            <h3 className="mt-1 text-lg font-semibold text-white">RSS Ingestion Runtime</h3>
            <p className="mt-1 max-w-3xl text-[10px] text-slate-500">
              Server-side feed polling only. Health reflects last poll outcomes — feeds are not marked healthy when polls fail or time out.
            </p>
          </div>
          <Badge value={rssRuntime?.aggregateHealth ?? 'unknown'} />
        </header>
        <div className="mb-3 grid gap-3 md:grid-cols-4">
          <MiniMetric label="Enabled feeds" value={rssRuntime ? `${rssRuntime.enabledFeedCount}/${rssRuntime.configuredFeedCount}` : '—'} />
          <MiniMetric label="Poll interval" value={rssRuntime ? `${rssRuntime.pollIntervalMinutes}m` : '—'} />
          <MiniMetric label="Stale feeds" value={rssRuntime ? String(rssRuntime.staleFeedCount) : '—'} />
          <MiniMetric label="Last poll" value={timeLabel(rssRuntime?.lastPollAt ?? null)} />
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {(rssRuntime?.feeds ?? []).map(feed => (
            <article key={feed.sourceId} className="rounded border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">{feed.label}</h4>
                <Badge value={feed.health} />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">{feed.sourceId}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <MiniMetric label="Last poll" value={timeLabel(feed.lastPollAt)} />
                <MiniMetric label="Items" value={feed.lastItemCount === null ? '—' : String(feed.lastItemCount)} />
                <MiniMetric label="Stale" value={feed.staleFeedDetection ? 'yes' : 'no'} />
              </div>
              {feed.lastErrorMessage ? (
                <p className="mt-2 text-[10px] text-amber-200/90">{feed.lastErrorMessage}</p>
              ) : null}
            </article>
          ))}
        </div>
        {!rssRuntime?.feeds.length ? (
          <p className="text-[10px] text-slate-500">No RSS feeds configured. Set NEWS_RSS_FEEDS or enable RSS rows in signal sources.</p>
        ) : null}
      </section>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Canonical provider status is shared by runtime panels and council summaries. Safeguards: server-side only, timeout protected, failure isolated, no autonomous execution, no serialized API keys. Last checked: {runtime?.generatedAt ? timeLabel(runtime.generatedAt) : 'loading'}.
      </div>
    </section>
  )
}

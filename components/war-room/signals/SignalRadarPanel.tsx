'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CanonicalStatusBadge } from '@/components/war-room/runtime/CanonicalStatusBadge'
import type { SignalClassificationBuckets, SignalResult, SignalSnapshot, SignalSourceDefinition } from '@/lib/signals/model'
import { newsCardTimestampLabel, signalCardDisplayLabel, signalIngestedAtFromResult } from '@/lib/signals/freshness'

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function colorFor(value: string) {
  if (value.includes('critical') || value.includes('rejected') || value.includes('failed')) return '#F87171'
  if (value.includes('important') || value.includes('watch') || value.includes('partial') || value.includes('low_confidence')) return '#FBBF24'
  if (value.includes('completed') || value.includes('pending_review') || value.includes('configured')) return '#34D399'
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

function ScoreBar({ label: scoreLabel, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-[9px] text-slate-500">
        <span>{scoreLabel}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-cyan-300" style={{ width: `${Math.max(0, Math.min(100, Math.round(value)))}%` }} />
      </div>
    </div>
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'none'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value
}

function SourcePill({ source }: { source: SignalSourceDefinition }) {
  return (
    <li className="rounded border border-white/10 p-2 text-[10px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-200">{source.label}</span>
        <Badge value={source.configured ? 'configured' : 'unavailable'} />
      </div>
      <p className="mt-1 text-slate-500">{source.provider} · {label(source.kind)} · {source.categories.map(label).join(', ')}</p>
      <p className="mt-1 text-slate-600">{source.notes}</p>
    </li>
  )
}

function SignalCard({ signal, compact = false }: { signal: SignalResult; compact?: boolean }) {
  const rawHeadline = typeof signal.metadata.rawHeadline === 'string' ? signal.metadata.rawHeadline : null
  const intelligenceCategory = typeof signal.metadata.intelligenceCategory === 'string'
    ? signal.metadata.intelligenceCategory
    : null
  const intelligenceSeverity = typeof signal.metadata.intelligenceSeverity === 'string'
    ? signal.metadata.intelligenceSeverity
    : null

  return (
    <article className="rounded border border-white/10 bg-slate-950/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {signal.url.startsWith('https://') ? (
              <h4 className="text-sm font-semibold text-white">
                <a href={signal.url} target="_blank" rel="noopener noreferrer" className="underline decoration-cyan-500/40 hover:text-cyan-100">
                  {rawHeadline ?? signal.title}
                </a>
              </h4>
            ) : (
              <h4 className="text-sm font-semibold text-white">{rawHeadline ?? signal.title}</h4>
            )}
            <Badge value={signal.approvalStatus} />
            <Badge value={signalCardDisplayLabel(signal.metadata)} />
            {intelligenceCategory ? <Badge value={intelligenceCategory} /> : null}
            {intelligenceSeverity ? <Badge value={intelligenceSeverity} /> : null}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {newsCardTimestampLabel({
              articlePublishedAt: typeof signal.metadata.articlePublishedAt === 'string'
                ? signal.metadata.articlePublishedAt
                : typeof signal.metadata.publishedAt === 'string'
                  ? signal.metadata.publishedAt
                  : null,
              signalIngestedAt: signalIngestedAtFromResult(signal),
              sourceName: signal.source,
            })}
            {signal.metadata.timeIntegrityStatus === 'TIME_INTEGRITY_WARNING' ? ' · TIME INTEGRITY WARNING' : ''}
          </p>
          <p className="mt-0.5 text-[9px] text-slate-600">
            {label(signal.category)} · {signal.provider}
          </p>
        </div>
        <MiniMetric label="Leverage" value={String(Math.round(signal.scores.highestLeverage))} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{signal.summary}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <ScoreBar label="Income" value={signal.scores.incomePotential} />
        <ScoreBar label="Time To Profit" value={signal.scores.timeToProfit} />
        <ScoreBar label="Confidence" value={signal.scores.confidence} />
      </div>
      {!compact ? (
        <>
          <div className="mt-3 grid gap-2 text-[10px] text-slate-400 sm:grid-cols-3">
            <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Startup:</span> {signal.startupCostEstimate}</div>
            <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Profit:</span> {signal.timeToProfitEstimate}</div>
            <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Assigned:</span> {signal.assignedBabyFamily}</div>
          </div>
          <div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[10px] leading-relaxed text-cyan-100">
            Recommended next action: {signal.recommendedNextAction}
          </div>
          {signal.url.startsWith('https://') ? (
            <a
              href={signal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex rounded border border-cyan-400/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/10"
            >
              Open Source
            </a>
          ) : (
            <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-500">Source URL unavailable</p>
          )}
        </>
      ) : null}
    </article>
  )
}

export function SignalRadarPanel() {
  const [snapshot, setSnapshot] = useState<SignalSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/signals/results', { cache: 'no-store' })
      const body = await res.json() as SignalSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Signal results load failed')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signal results load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const scan = async () => {
    if (scanning) return
    setScanning(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/signals/scan', { method: 'POST' })
      const body = await res.json() as SignalSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Signal scan failed')
      setSnapshot(body)
      setNotice(body.persistenceNote)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signal scan failed')
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const sourceStats = useMemo(() => {
    const sources = snapshot?.sources ?? []
    return {
      configured: sources.filter(source => source.configured).length,
      total: sources.length,
      providers: new Set(sources.filter(source => source.configured).map(source => source.provider)).size,
    }
  }, [snapshot?.sources])

  const classification = snapshot?.classification
  const classificationBuckets: SignalClassificationBuckets = classification ?? {
    actionable: [],
    watchlist: [],
    conflicted: [],
    stale: [],
  }
  const freshness = snapshot?.latestScan?.freshnessSummary
  const cacheDiagnostics = snapshot?.cacheDiagnostics
  const classificationDiagnostics = snapshot?.classificationDiagnostics

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-cyan-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-cyan-300">Phase 29</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Intelligence Signal Radar</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Classified operational intelligence with credibility weighting, contradiction detection, and canonical council summaries. Unverified RSS remains PROPOSED — never operator truth without review.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CanonicalStatusBadge subsystemId="signal_radar" label="Canonical" />
          <Badge value={snapshot?.persistenceAvailable ? 'persistence_available' : 'persistence_unavailable'} />
          <button type="button" onClick={() => void load()} disabled={loading || scanning} className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300">
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <button type="button" onClick={() => void scan()} disabled={loading || scanning} className="rounded border border-cyan-400/40 bg-cyan-400/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-50">
            {scanning ? 'Scanning...' : 'Run bounded scan'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">{notice}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <MiniMetric label="Configured Sources" value={`${sourceStats.configured}/${sourceStats.total}`} />
        <MiniMetric label="Providers" value={String(sourceStats.providers)} />
        <MiniMetric label="Migration" value={snapshot?.migrationStatus ?? 'checking'} />
        <MiniMetric label="Latest Scan" value={snapshot?.latestScan?.status ?? 'none'} />
        <MiniMetric label="Results" value={String(snapshot?.results.length ?? 0)} />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <MiniMetric label="Latest Scan Time" value={formatDateTime(freshness?.latestScanTime ?? snapshot?.latestScan?.completedAt)} />
        <MiniMetric label="Max Age" value={`${freshness?.maxAgeDays ?? 30}d`} />
        <MiniMetric label="Fresh Accepted" value={String(cacheDiagnostics?.freshAcceptedCount ?? freshness?.liveCount ?? 0)} />
        <MiniMetric label="Recent Accepted" value={String(cacheDiagnostics?.recentAcceptedCount ?? freshness?.recentCount ?? 0)} />
        <MiniMetric label="Stale Suppressed" value={String(cacheDiagnostics?.staleSuppressedCount ?? freshness?.staleDiscardedCount ?? 0)} />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <MiniMetric label="Oldest Active" value={cacheDiagnostics?.oldestActiveResultAgeDays === null || cacheDiagnostics?.oldestActiveResultAgeDays === undefined ? 'none' : `${cacheDiagnostics.oldestActiveResultAgeDays}d`} />
        <MiniMetric label="Oldest Stored" value={cacheDiagnostics?.oldestStoredResultAgeDays === null || cacheDiagnostics?.oldestStoredResultAgeDays === undefined ? 'none' : `${cacheDiagnostics.oldestStoredResultAgeDays}d`} />
        <MiniMetric label="Cache Filtered" value={String(cacheDiagnostics?.cacheFilteredCount ?? freshness?.cacheFilteredCount ?? 0)} />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <MiniMetric label="Actionable" value={String(classificationBuckets.actionable.length)} />
        <MiniMetric label="Watchlist" value={String(classificationBuckets.watchlist.length)} />
        <MiniMetric label="Conflicted" value={String(classificationBuckets.conflicted.length)} />
        <MiniMetric label="Stale / Archival" value={String(classificationBuckets.stale.length)} />
        <MiniMetric label="Classify Failures" value={String(classificationDiagnostics?.failures.length ?? 0)} />
      </div>

      {snapshot?.migrationStatus === 'MIGRATION_REQUIRED' ? (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
          MIGRATION_REQUIRED: apply `supabase/war_room_phase14_signals.sql` or `supabase/war_room_phase17_signal_schema_cache_patch.sql`, then reload the Supabase/PostgREST schema cache. No fake signal rows are shown.
        </div>
      ) : null}

      <section className="mb-4 rounded border border-cyan-400/30 bg-cyan-400/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Highest Leverage Signal</p>
            <h3 className="mt-1 text-lg font-semibold text-white">{snapshot?.strongestSignal?.title ?? 'No source-backed signal loaded yet'}</h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-cyan-100">
              {snapshot?.strongestSignal
                ? `${snapshot.strongestSignal.summary} Assigned to ${snapshot.strongestSignal.assignedBabyFamily}.`
                : 'Run a bounded scan or configure cloud providers to surface a source-backed opportunity.'}
            </p>
          </div>
          <MiniMetric label="Signal Score" value={String(Math.round(snapshot?.strongestSignal?.scores.highestLeverage ?? 0))} />
        </div>
        <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] leading-relaxed text-slate-300">
          Manual next action: {snapshot?.strongestSignal?.recommendedNextAction ?? 'No action recommended without source-backed evidence.'}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]">
        <aside className="space-y-4">
          <section className="rounded border border-white/10 bg-black/25 p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Sources Configured</h3>
            <ul className="mt-2 max-h-[30rem] space-y-2 overflow-y-auto">
              {(snapshot?.sources ?? []).slice(0, 16).map(source => <SourcePill key={source.id} source={source} />)}
              {snapshot && snapshot.sources.length === 0 ? <li className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No sources registered.</li> : null}
            </ul>
          </section>

          <section className="rounded border border-amber-500/30 bg-black/25 p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Alerts</h3>
            <ul className="mt-2 space-y-2">
              {(snapshot?.alerts ?? []).slice(0, 6).map(alert => (
                <li key={alert.id} className="rounded border border-white/10 p-2 text-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{alert.title}</span>
                    <Badge value={alert.severity} />
                  </div>
                  <p className="mt-1 text-slate-400">{alert.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="space-y-4">
          <div className="rounded border border-white/10 bg-black/25 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Actionable Intelligence</h3>
              <span className="text-[10px] text-slate-500">source: /api/signals/results</span>
            </div>
            <div className="max-h-[44rem] space-y-3 overflow-y-auto">
              {classificationBuckets.actionable.length ? classificationBuckets.actionable.slice(0, 6).map(signal => <SignalCard key={signal.id} signal={signal} />) : (
                <div className="rounded border border-white/10 p-3 text-xs text-slate-500">No actionable classified signals. RSS remains watchlist until corroborated.</div>
              )}
            </div>
          </div>

          <section className="rounded border border-yellow-500/30 bg-black/25 p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-yellow-300">Watchlist</h3>
            <div className="mt-2 max-h-[16rem] space-y-2 overflow-y-auto">
              {classificationBuckets.watchlist.slice(0, 5).map(signal => <SignalCard key={signal.id} signal={signal} compact />)}
              {!classificationBuckets.watchlist.length ? (
                <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No watchlist signals.</div>
              ) : null}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded border border-red-500/30 bg-black/25 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-300">Conflicting Reports</h3>
              <div className="mt-2 space-y-2">
                {classificationBuckets.conflicted.slice(0, 4).map(signal => <SignalCard key={signal.id} signal={signal} compact />)}
                {!classificationBuckets.conflicted.length ? (
                  <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No contradictory narratives detected.</div>
                ) : null}
              </div>
            </section>
            <section className="rounded border border-slate-500/30 bg-black/25 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Stale / Archival</h3>
              <div className="mt-2 space-y-2">
                {classificationBuckets.stale.slice(0, 4).map(signal => <SignalCard key={signal.id} signal={signal} compact />)}
                {!classificationBuckets.stale.length ? (
                  <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No stale or archival signals.</div>
                ) : null}
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded border border-white/10 bg-black/25 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Rejected / Low Confidence</h3>
              <div className="mt-2 space-y-2">
                {(snapshot?.rejectedOrLowConfidence ?? []).slice(0, 4).map(signal => <SignalCard key={signal.id} signal={signal} compact />)}
                {snapshot && snapshot.rejectedOrLowConfidence.length === 0 ? <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No low-confidence signals loaded.</div> : null}
              </div>
            </section>

            <section className="rounded border border-white/10 bg-black/25 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Connected Surfaces</h3>
              <div className="mt-2 space-y-2 text-[10px] text-slate-400">
                {Object.entries(snapshot?.integrations ?? {}).slice(0, 7).map(([key, lines]) => (
                  <div key={key} className="rounded border border-white/10 p-2">
                    <div className="font-semibold text-slate-200">{label(key)}</div>
                    <p className="mt-1">{lines[0] ?? 'No current source-backed signal for this surface.'}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Guardrails: cloud-only ingestion, no localhost, no local agents, no Ollama/LM Studio/bridge, no fake signals, no stale/unknown-date news as live opportunities, no outreach/spend/applications/hidden execution, and approval required before action. Latest scan: {snapshot?.latestScan?.completedAt ?? 'none'}.
      </div>
    </section>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RuntimeReliabilitySnapshot, TruthBoundaryLabel } from '@/lib/runtime/operationalReliabilityTypes'

type CanonicalSubsystemStatus = {
  id: string
  label: string
  truthBoundary: TruthBoundaryLabel
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  confidence: number
  evidence: string[]
  missingEvidence: string[]
  downstreamImpact: string[]
  recommendedRecovery: string[]
  lastChecked: string
}

type CanonicalRuntimeStatus = {
  generatedAt: string
  summary: {
    health: string
    confidence: number
    uncertaintyDampening: string
  }
  subsystems: CanonicalSubsystemStatus[]
}

function Badge({ value }: { value: string }) {
  const tone =
    value === 'VERIFIED' || value === 'STABLE' || value === 'verified'
      ? 'border-emerald-400/40 text-emerald-200'
      : value === 'DEGRADED' || value === 'RECOVERY' || value === 'blocked' || value === 'degraded'
        ? 'border-amber-400/40 text-amber-200'
        : value === 'UNAVAILABLE' || value === 'unavailable'
          ? 'border-rose-400/40 text-rose-200'
          : 'border-white/15 text-slate-300'
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${tone}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

function Metric({ label, value, truth }: { label: string; value: string; truth?: TruthBoundaryLabel }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
        {truth ? <Badge value={truth} /> : null}
      </div>
      <div className="mt-1 font-mono text-[11px] text-sky-100">{value}</div>
    </div>
  )
}

function timeLabel(value: string | null) {
  if (!value) return 'not verified'
  return new Date(value).toLocaleString()
}

export function RuntimeIntegrityPanel() {
  const [snapshot, setSnapshot] = useState<RuntimeReliabilitySnapshot | null>(null)
  const [canonical, setCanonical] = useState<CanonicalRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/runtime/snapshots${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const canonicalRes = await fetch(`/api/runtime/canonical-status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const [body, canonicalBody] = await Promise.all([
        res.json() as Promise<RuntimeReliabilitySnapshot & { error?: string }>,
        canonicalRes.json() as Promise<CanonicalRuntimeStatus & { error?: string }>,
      ])
      if (!res.ok) throw new Error(body.error || 'Runtime reliability snapshot failed')
      if (!canonicalRes.ok) throw new Error(canonicalBody.error || 'Canonical runtime status failed')
      setSnapshot(body)
      setCanonical(canonicalBody)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Runtime reliability snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0)
    const interval = window.setInterval(() => void load(false), 60_000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [load])

  const graphStats = useMemo(() => {
    const graph = snapshot?.graph
    return {
      nodes: graph?.nodes.length ?? 0,
      edges: graph?.edges.length ?? 0,
      degraded: snapshot?.degraded.length ?? 0,
      fallback: graph?.fallbackSystems.length ?? 0,
      blocked: graph?.blockedSystems.length ?? 0,
    }
  }, [snapshot])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-emerald-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-emerald-300">Reliability</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Runtime Integrity &amp; Truth Boundary
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
            Read-only dependency graph, provider snapshots, degraded-mode intelligence, and rollback awareness. Labels distinguish verified reality from source-backed, advisory, estimated, experimental, unavailable, and fallback states.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={snapshot?.mode ?? 'OBSERVATION_ONLY'} />
          <Badge value={canonical ? `${canonical.summary.confidence}%` : 'CONFIDENCE_LOADING'} />
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh Snapshot'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          Runtime reliability panel is degraded: {error}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <Metric label="Systems" value={`${graphStats.nodes} nodes`} truth="SOURCE_BACKED" />
        <Metric label="Dependencies" value={`${graphStats.edges} edges`} truth="SOURCE_BACKED" />
        <Metric label="Degraded" value={String(graphStats.degraded)} truth={graphStats.degraded ? 'DEGRADED' : 'VERIFIED'} />
        <Metric label="Fallback" value={String(graphStats.fallback)} truth={graphStats.fallback ? 'FALLBACK' : 'VERIFIED'} />
        <Metric label="Blocked" value={String(graphStats.blocked)} truth={graphStats.blocked ? 'DEGRADED' : 'VERIFIED'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded border border-white/10 bg-black/25 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Dependency graph</h3>
            <Badge value="READ_ONLY" />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {(snapshot?.graph.nodes ?? []).map(node => (
              <article key={node.id} className="rounded border border-white/10 bg-black/25 p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">{node.label}</div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      Upstream: {node.upstream.length ? node.upstream.join(', ') : 'none'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge value={node.truthBoundary} />
                    <Badge value={node.health} />
                  </div>
                </div>
                {node.degradedReason ? <p className="mt-2 text-[10px] leading-relaxed text-amber-100/80">{node.degradedReason}</p> : null}
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{node.continuity}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded border border-white/10 bg-black/25 p-3">
            <h3 className="text-sm font-semibold text-white">Provider snapshots</h3>
            <div className="mt-3 space-y-2">
              {(snapshot?.providers ?? []).map(provider => (
                <div key={provider.providerId} className="rounded border border-white/10 bg-black/25 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">{provider.provider}</span>
                    <Badge value={provider.truthBoundary} />
                  </div>
                  <div className="mt-2 grid gap-1 text-[10px] text-slate-500">
                    <span>health: {provider.health}</span>
                    <span>latency: {provider.latencyMs == null ? 'n/a' : `${provider.latencyMs}ms`}</span>
                    <span>last success: {timeLabel(provider.lastSuccessAt)}</span>
                    <span>failures: {provider.failureCount} · timeouts: {provider.timeoutCount}</span>
                  </div>
                  {provider.degradedReason ? <p className="mt-2 text-[10px] text-amber-100/75">{provider.degradedReason}</p> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded border border-white/10 bg-black/25 p-3">
            <h3 className="text-sm font-semibold text-white">Rollback awareness</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge value={snapshot?.rollbackAwareness.mode ?? 'READ_ONLY'} />
              <Badge value={snapshot?.rollbackAwareness.automaticRollbackAllowed === false ? 'NO_AUTO_ROLLBACK' : 'UNKNOWN'} />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              {snapshot?.rollbackAwareness.note ?? 'Rollback awareness has not loaded.'}
            </p>
            <div className="mt-2 text-[10px] text-slate-500">
              Recovery point: {snapshot?.rollbackAwareness.recoveryPoint ?? 'unavailable'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-white/10 bg-black/25 p-3 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Canonical evidence cards</h3>
            <Badge value={canonical?.summary.health ?? 'UNKNOWN'} />
          </div>
          <p className="mb-3 text-[10px] leading-relaxed text-slate-500">
            {canonical?.summary.uncertaintyDampening ?? 'Canonical runtime status has not loaded.'}
          </p>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(canonical?.subsystems ?? []).map(system => (
              <article key={system.id} className="rounded border border-white/10 bg-black/25 p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">{system.label}</div>
                    <div className="mt-1 text-[10px] text-slate-500">confidence: {system.confidence}%</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge value={system.truthBoundary} />
                    <Badge value={system.health} />
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                  Evidence: {system.evidence.join(' · ')}
                </p>
                {system.missingEvidence.length ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-amber-100/80">
                    Missing: {system.missingEvidence.join(' · ')}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Impact: {system.downstreamImpact.join(' · ') || 'No direct downstream impact.'}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-emerald-100/70">
                  Recovery: {system.recommendedRecovery.join(' · ')}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded border border-white/10 bg-black/25 p-3">
          <h3 className="text-sm font-semibold text-white">Degraded intelligence</h3>
          <div className="mt-3 space-y-2">
            {(snapshot?.degraded ?? []).slice(0, 8).map(record => (
              <article key={record.systemId} className="rounded border border-amber-400/15 bg-amber-950/10 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-amber-100">{record.label}</span>
                  <Badge value={record.truthBoundary} />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">{record.why}</p>
                <p className="mt-1 text-[10px] text-slate-500">{record.impact}</p>
                <p className="mt-1 text-[10px] text-emerald-100/70">Recovery: {record.recovery}</p>
              </article>
            ))}
            {snapshot && snapshot.degraded.length === 0 ? (
              <p className="text-[10px] text-slate-500">No degraded records in the current snapshot.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded border border-white/10 bg-black/25 p-3">
          <h3 className="text-sm font-semibold text-white">Observability &amp; drift</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Metric label="Signal Freshness" value={snapshot?.observability.signalFreshness ?? 'loading'} />
            <Metric label="Blocked Packets" value={String(snapshot?.observability.blockedPacketGeneration ?? false)} />
            <Metric label="Failed Orchestration" value={String(snapshot?.observability.failedOrchestrationCount ?? 0)} />
            <Metric label="Snapshot Age" value={snapshot?.observability.staleDataAgeMs == null ? 'loading' : `${snapshot.observability.staleDataAgeMs}ms`} />
          </div>
          <div className="mt-3 space-y-1 text-[10px] text-slate-500">
            {(snapshot?.observability.runtimeDrift ?? []).slice(0, 6).map((drift, index) => (
              <div key={`${drift}-${index}`} className="rounded border border-white/10 bg-black/20 p-2">{drift}</div>
            ))}
            {snapshot && snapshot.observability.runtimeDrift.length === 0 ? <div>No runtime drift observed.</div> : null}
          </div>
          <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] text-slate-500">
            Persistence: {snapshot?.persistence.configured ? 'configured' : 'unavailable'} · snapshots {snapshot?.persistence.snapshotsPersisted ? 'persisted' : 'not persisted'}
            {snapshot?.persistence.error ? ` · ${snapshot.persistence.error}` : ''}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Guardrails: no hidden execution, no autonomous shell execution, no fake provider states, no fake telemetry, no fake success claims, no deployment execution, no browser filesystem mutation, and no automatic rollback.
      </div>
    </section>
  )
}

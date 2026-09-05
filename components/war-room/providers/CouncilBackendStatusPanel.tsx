'use client'

import { useCouncilBackendStatus } from './useCouncilBackendStatus'
import type { LocalCandidateHealth, LocalRegistryRow, SeatActiveStatus, SeatBackendStatus } from './useCouncilBackendStatus'

function toneColor(tone: 'ready' | 'degraded' | 'unavailable' | 'metadata') {
  if (tone === 'ready') return '#34D399'
  if (tone === 'degraded') return '#FBBF24'
  if (tone === 'unavailable') return '#F87171'
  return '#22D3EE'
}

function seatStatusTone(status: SeatActiveStatus): 'ready' | 'degraded' | 'unavailable' | 'metadata' {
  if (status === 'READY') return 'ready'
  if (status === 'DEGRADED' || status === 'RATE_LIMITED') return 'degraded'
  if (status === 'UNKNOWN') return 'metadata'
  return 'unavailable' // UNAVAILABLE
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return '—'
  if (latencyMs >= 1000) return `${(latencyMs / 1000).toFixed(1)} s`
  return `${latencyMs} ms`
}

function localHealthTone(health: LocalCandidateHealth): 'ready' | 'degraded' | 'unavailable' | 'metadata' {
  if (health === 'READY') return 'ready'
  if (health === 'NOT_CONFIGURED') return 'metadata'
  if (health === 'MODEL_NOT_INSTALLED') return 'degraded'
  return 'unavailable' // UNAVAILABLE (runtime unreachable)
}

function localHealthLabel(health: LocalCandidateHealth): string {
  if (health === 'READY') return 'READY'
  if (health === 'MODEL_NOT_INSTALLED') return 'MODEL NOT INSTALLED'
  if (health === 'NOT_CONFIGURED') return 'NOT INSTALLED / UNKNOWN'
  return 'UNAVAILABLE'
}

function Pill({ label, tone }: { label: string; tone: 'ready' | 'degraded' | 'unavailable' | 'metadata' }) {
  const color = toneColor(tone)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label}
    </span>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-[11px] text-sky-200">{value}</div>
    </div>
  )
}

function SeatCard({ row }: { row: SeatBackendStatus }) {
  return (
    <article className="rounded border border-white/10 bg-black/25 p-3" data-testid={`council-backend-status-${row.seat}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{row.label}</h3>
          <p className="mt-1 text-[10px] text-slate-500">seat: {row.seat}</p>
        </div>
        <Pill label={row.active.status} tone={seatStatusTone(row.active.status)} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Metric label="Backend" value={row.active.backendType} />
        <Metric label="Provider" value={row.active.provider} />
        <Metric label="Model" value={row.active.model} />
        <Metric label="Fallback" value={row.active.fallbackUsed ? 'YES' : 'NO'} />
        <Metric label="Latency" value={formatLatency(row.active.latencyMs)} />
        <Metric label="Failure class" value={row.active.failureClass ?? '—'} />
      </div>
      {row.active.fallbackUsed ? (
        <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-200/90">
          FALLBACK USED{row.active.fallbackReason ? ` — ${row.active.fallbackReason}` : ''}
        </p>
      ) : null}
      <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
            Local candidate {row.localCandidate.roleSlot ? `(${row.localCandidate.roleSlot})` : ''}
          </span>
          <Pill label={localHealthLabel(row.localCandidate.health)} tone={localHealthTone(row.localCandidate.health)} />
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          {row.localCandidate.enabled ? row.localCandidate.repo : 'no enabled local candidate configured'}
        </p>
      </div>
    </article>
  )
}

function PoolCard({ entry }: { entry: LocalRegistryRow }) {
  return (
    <article className="rounded border border-white/10 bg-black/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">{entry.slot}</h4>
        <Pill label={entry.enabled ? localHealthLabel(entry.health) : 'DISABLED'} tone={entry.enabled ? localHealthTone(entry.health) : 'metadata'} />
      </div>
      <p className="mt-1 text-[10px] text-slate-500">{entry.repo}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Metric label="Runtime" value={entry.runtime} />
        <Metric label="Quant" value={entry.quantization} />
        <Metric label="Resident policy" value={entry.residentPolicy} />
        <Metric label="Enabled" value={entry.enabled ? 'yes' : 'no'} />
      </div>
    </article>
  )
}

export function CouncilBackendStatusPanel() {
  const { snapshot, loading, error, load } = useCouncilBackendStatus()

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-sky-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-sky-300">Runtime</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Council Backend Status</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Seat identity is separate from backend identity. Local model pool health is probed live (never assumed
            from registry config) but does not currently serve Council calls — see Live Routing below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={`Live routing: ${snapshot?.liveRouting ?? 'checking'}`} tone="metadata" />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Checking...' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="Routing Foundation" value={snapshot?.routingFoundation ?? 'checking'} />
        <Metric label="Routing Mode Resolved" value={snapshot?.routingModeResolved ?? 'checking'} />
        <Metric label="Local Model Pool" value={snapshot?.localModelPool ?? 'checking'} />
        <Metric
          label="Ollama"
          value={
            snapshot
              ? `${snapshot.ollama.reachable ? 'reachable' : 'unreachable'} · ${snapshot.ollama.installedModelCount} installed · ${snapshot.ollama.probeLatencyMs} ms`
              : 'checking'
          }
        />
      </div>
      {snapshot?.routingModeNote ? <p className="mb-4 text-[10px] leading-relaxed text-slate-500">{snapshot.routingModeNote}</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {(snapshot?.seats ?? []).map(row => (
          <SeatCard key={row.seat} row={row} />
        ))}
      </div>

      <section className="mt-8 border-t border-white/10 pt-6">
        <header className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-sky-300">Diversity</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Model Diversity (currently-live backend)</h3>
        </header>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <Metric label="Unique models" value={snapshot ? String(snapshot.diversity.uniqueModels) : '—'} />
          <Metric label="Responding seats" value={snapshot ? String(snapshot.diversity.totalRespondingSeats) : '—'} />
          <Metric label="Shared groups" value={snapshot ? String(snapshot.diversity.sharedModelGroups.length) : '—'} />
        </div>
        {snapshot?.diversity.sharedModelGroups.length ? (
          <div className="space-y-2">
            {snapshot.diversity.sharedModelGroups.map(group => (
              <div key={group.model} className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-200/90">
                Shared model — not independent evidence: <span className="font-mono">{group.model}</span> answers for{' '}
                {group.seats.join(', ')}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-8 border-t border-white/10 pt-6">
        <header className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-sky-300">Local Model Pool</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Registry (configured candidates, not currently active)</h3>
        </header>
        <div className="grid gap-2 lg:grid-cols-2">
          {(snapshot?.localRegistry ?? []).map(entry => (
            <PoolCard key={entry.slot} entry={entry} />
          ))}
        </div>
      </section>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Council seat identity stays separate from backend identity. This panel never invokes a cloud provider or a
        local model to build itself — Ollama reachability is probed, nothing is generated. No API keys, auth
        headers, or raw provider payloads leave the server. Last checked: {snapshot?.generatedAt ?? 'loading'}.
      </div>
    </section>
  )
}

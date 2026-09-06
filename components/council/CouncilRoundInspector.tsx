'use client'

import type { NebulaRoundHealth } from '@/lib/council/nebula/round'
import type { CouncilRound } from '@/lib/council/nebula/roundState'

type FindingProvenance = {
  agentId?: string
  provenance?: {
    backendType?: string | null
    provider?: string | null
    runtime?: string | null
    model?: string | null
  }
  metrics?: {
    ttftMs?: number | null
    tokensPerSecond?: number | null
    totalMs?: number | null
  }
}

function asFindings(value: unknown): FindingProvenance[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is FindingProvenance => Boolean(item && typeof item === 'object'))
}

export function CouncilRoundInspector({
  roundHealth,
  councilRound,
}: {
  roundHealth?: NebulaRoundHealth | null
  councilRound?: CouncilRound | null
}) {
  if (!roundHealth && !councilRound) {
    return <p className="text-slate-500">No round provenance yet. Inspector shows backend/model after a Council round completes.</p>
  }
  const metrics = councilRound?.metrics
  const findings = asFindings(councilRound?.findings)
  return (
    <div className="space-y-3" data-testid="council-round-inspector">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">Round provenance</p>
        <p>Round {councilRound?.roundId ?? roundHealth?.roundId}</p>
        <p>Status {councilRound?.status ?? roundHealth?.status}</p>
        <p>Intent {councilRound?.intent ?? 'n/a'}</p>
        <p>Selected {councilRound?.selectedAgents.map(id => id.toUpperCase()).join(', ') || roundHealth?.participatingSeats.join(', ')}</p>
        <p>Degraded {String(roundHealth?.degraded ?? false)}</p>
      </div>
      {findings.length ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200">Seat backends</p>
          {findings.map(item => {
            const identity = (item.agentId ?? 'agent').toUpperCase()
            const backend = item.provenance?.backendType ?? 'unknown'
            const runtime = item.provenance?.runtime ?? item.provenance?.provider ?? 'unknown'
            const model = item.provenance?.model ?? 'unknown'
            const ttft = item.metrics?.ttftMs
            const tps = item.metrics?.tokensPerSecond
            return (
              <p key={`${identity}-${backend}-${model}`}>
                {identity} · {backend} · {runtime} · {model}
                {ttft != null ? ` · TTFT ${ttft} ms` : ''}
                {tps != null ? ` · ${tps} tok/s` : ''}
              </p>
            )
          })}
        </div>
      ) : null}
      {roundHealth?.failures.length ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">Failures</p>
          {roundHealth.failures.map(item => (
            <p key={`${item.seatId}-${item.errorCode}`}>{item.agentId?.toUpperCase() ?? item.seatId}: {item.safeMessage}</p>
          ))}
        </div>
      ) : null}
      {metrics ? (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Metrics</p>
          <p>Round total {metrics.round_total_ms ?? '—'} ms</p>
          <p>ASTRA plan {metrics.astra_plan_ms ?? '—'} ms</p>
          <p>Agent TTFT {metrics.agent_ttft_ms ?? '—'} ms</p>
          <p>Tokens/sec {metrics.agent_tokens_per_second ?? '—'}</p>
          <p>AURORA TTFT {metrics.aurora_ttft_ms ?? '—'} ms</p>
          <p>Model load {metrics.model_load_ms ?? '—'} ms</p>
          <p>Queue depth {metrics.queue_depth}</p>
        </div>
      ) : null}
      <p className="text-slate-500">Identity stays Nebula. Backend/provider/model belong here, never in the chat speaker line.</p>
    </div>
  )
}

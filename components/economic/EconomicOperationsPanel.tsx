'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ActiveEconomicMission,
  EconomicAssignmentHistory,
  EconomicOpportunity,
  EconomicProposal,
  EconomicTelemetryEvent,
  EconomicWorkflowQueueItem,
  ProviderEffectivenessSnapshot,
  UnresolvedEconomicOperation,
} from '@/lib/economic/types'

type SurfaceStats = {
  activeOpportunities: number
  estimatedPipelineValue: number
  completedWorkflows: number
  providerSuccessRate: number
  proposalGenerationVolume: number
  opportunityConversionRate: number
  missionThroughput: number
  unresolvedOperations: number
}

type SurfaceResponse = {
  opportunities?: EconomicOpportunity[]
  workflows?: EconomicWorkflowQueueItem[]
  proposals?: EconomicProposal[]
  missions?: ActiveEconomicMission[]
  telemetry?: EconomicTelemetryEvent[]
  providerEffectiveness?: ProviderEffectivenessSnapshot[]
  unresolvedOperations?: UnresolvedEconomicOperation[]
  assignmentHistory?: EconomicAssignmentHistory[]
  stats?: SurfaceStats | null
  error?: string
}

function readPersistence(res: Response) {
  return res.headers.get('x-war-room-persistence') ?? 'unknown'
}

function money(value: number | null | undefined) {
  if (!value) return 'n/a'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function pct(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  return Array.from(new Map(rows.map(row => [row.id, row])).values())
}

function metadataOf(event: EconomicTelemetryEvent): Record<string, unknown> {
  return event.metadata && typeof event.metadata === 'object' ? event.metadata : {}
}

function boolMeta(value: unknown): boolean {
  return value === true
}

function numberMeta(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function expiringProviderLabel(enabled: boolean, updatedAt: string | null, nowMs: number | null): string {
  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0
  if (!updatedAtMs || !nowMs || nowMs - updatedAtMs > 30 * 60 * 1000) return 'STALE'
  return enabled ? 'ONLINE' : 'OFFLINE'
}

export function EconomicOperationsPanel() {
  const [persistence, setPersistence] = useState('unknown')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [surface, setSurface] = useState<SurfaceResponse>({})
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandSummary, setCommandSummary] = useState<string | null>(null)
  const [decree, setDecree] = useState('scan opportunities')
  const [analysis, setAnalysis] = useState('- Local service audit offer: $1500 monthly, medium risk, high confidence')
  const [nowMs, setNowMs] = useState<number | null>(null)

  const loadSurface = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/economic/surface', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = await res.json() as SurfaceResponse
      if (!res.ok) throw new Error(j.error || 'Economic surface failed')
      setSurface({
        ...j,
        opportunities: uniqueById(j.opportunities ?? []),
        workflows: uniqueById(j.workflows ?? []),
        proposals: uniqueById(j.proposals ?? []),
        missions: uniqueById(j.missions ?? []),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => void loadSurface(), 0)
    return () => window.clearTimeout(t)
  }, [loadSurface])

  useEffect(() => {
    const update = () => setNowMs(Date.now())
    update()
    const interval = window.setInterval(update, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const runCommand = async () => {
    setCommandBusy(true)
    setCommandSummary(null)
    try {
      const res = await fetch('/api/economic/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decree,
          sessionId: 'war-room-dashboard',
          providerAnalyses: [{ provider_family: 'grok', content: analysis, success: true }],
        }),
      })
      setPersistence(readPersistence(res))
      const j = await res.json() as { summary?: string; error?: string }
      if (!res.ok) throw new Error(j.error || 'Command ingest failed')
      setCommandSummary(j.summary ?? 'Economic command ingested.')
      await loadSurface()
    } catch (e) {
      setCommandSummary(e instanceof Error ? e.message : 'Command failed')
    } finally {
      setCommandBusy(false)
    }
  }

  const updateOpportunity = async (id: string, action: string) => {
    const res = await fetch('/api/economic/opportunities', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) await loadSurface()
  }

  const stats = surface.stats
  const providerAssignments = useMemo(() => surface.assignmentHistory ?? [], [surface.assignmentHistory])
  const scoutDiagnostics = useMemo(() => {
    const events = surface.telemetry ?? []
    const stages = events
      .filter(event => event.metric_name === 'scout_pipeline_stage')
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
    const latestByStage = new Map<string, EconomicTelemetryEvent>()
    for (const event of stages) {
      const stage = metadataOf(event).stage
      if (typeof stage === 'string' && !latestByStage.has(stage)) latestByStage.set(stage, event)
    }
    const tavily = metadataOf(latestByStage.get('tavily_complete') ?? stages[0] ?? {} as EconomicTelemetryEvent)
    const firecrawl = metadataOf(latestByStage.get('firecrawl_complete') ?? stages[0] ?? {} as EconomicTelemetryEvent)
    const normalized = metadataOf(latestByStage.get('normalization_complete') ?? stages[0] ?? {} as EconomicTelemetryEvent)
    const ranking = metadataOf(latestByStage.get('ranking_complete') ?? stages[0] ?? {} as EconomicTelemetryEvent)
    const fallback = metadataOf(latestByStage.get('fallback_created') ?? stages[0] ?? {} as EconomicTelemetryEvent)
    return {
      tavilyOnline: boolMeta(tavily.tavily_enabled),
      tavilyQueries: numberMeta(tavily.tavily_query_count),
      tavilyResults: numberMeta(tavily.tavily_results_count),
      firecrawlOnline: boolMeta(firecrawl.firecrawl_enabled),
      firecrawlTargets: numberMeta(firecrawl.firecrawl_targets_count),
      candidates: numberMeta(normalized.normalized_candidates_count),
      ranked: numberMeta(ranking.ranked_candidates_count),
      fallback: boolMeta(normalized.fallback_triggered) || latestByStage.has('fallback_created'),
      fallbackReason: String(fallback.fallback_reason ?? normalized.fallback_reason ?? ''),
      updatedAt: stages[0]?.recorded_at ?? null,
    }
  }, [surface.telemetry])

  return (
    <section className="mx-auto mt-10 max-w-6xl border-t border-emerald-900/50 pt-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-emerald-300">Economic Ops</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Operational Intelligence Surface</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Structured opportunities, missions, workflows, approvals, telemetry, and family assignment state. External actions remain approval-gated.
          </p>
        </div>
        <button type="button" className="rounded border border-white/15 px-3 py-2 text-[10px] font-bold tracking-widest text-slate-200" onClick={() => void loadSurface()} disabled={loading}>
          {loading ? 'LOADING' : 'REFRESH'}
        </button>
      </header>

      {error ? <div className="mb-3 rounded border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">{error}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        {[
          ['ACTIVE OPPS', String(stats?.activeOpportunities ?? 0)],
          ['PIPELINE VALUE', money(stats?.estimatedPipelineValue)],
          ['PROVIDER SUCCESS', pct(stats?.providerSuccessRate)],
          ['CONVERSION', pct(stats?.opportunityConversionRate)],
          ['COMPLETED FLOWS', String(stats?.completedWorkflows ?? 0)],
          ['PROPOSALS', String(stats?.proposalGenerationVolume ?? 0)],
          ['MISSION THROUGHPUT', String(stats?.missionThroughput ?? 0)],
          ['UNRESOLVED', String(stats?.unresolvedOperations ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-white/10 bg-black/30 p-3">
            <div className="text-[9px] font-bold tracking-widest text-slate-500">{label}</div>
            <div className="mt-1 font-mono text-lg text-emerald-200">{value}</div>
          </div>
        ))}
      </div>

      <section className="mb-4 rounded border border-cyan-500/25 bg-black/25 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-bold tracking-widest text-cyan-300">SCOUT DIAGNOSTICS</span>
          <span className="text-[10px] text-slate-500">{scoutDiagnostics.updatedAt ? new Date(scoutDiagnostics.updatedAt).toLocaleString() : 'no scout telemetry yet'}</span>
        </div>
        <div className="grid gap-2 text-[10px] text-slate-300 md:grid-cols-6">
          <span className="rounded border border-white/10 px-2 py-1">Tavily {expiringProviderLabel(scoutDiagnostics.tavilyOnline, scoutDiagnostics.updatedAt, nowMs)}</span>
          <span className="rounded border border-white/10 px-2 py-1">Firecrawl {expiringProviderLabel(scoutDiagnostics.firecrawlOnline, scoutDiagnostics.updatedAt, nowMs)}</span>
          <span className="rounded border border-white/10 px-2 py-1">Queries {scoutDiagnostics.tavilyQueries}</span>
          <span className="rounded border border-white/10 px-2 py-1">Candidates {scoutDiagnostics.candidates}</span>
          <span className="rounded border border-white/10 px-2 py-1">Ranked {scoutDiagnostics.ranked}</span>
          <span className="rounded border border-white/10 px-2 py-1">Fallback {scoutDiagnostics.fallback ? 'YES' : 'NO'}</span>
        </div>
        <div className="mt-2 text-[10px] text-slate-500">
          Tavily results {scoutDiagnostics.tavilyResults} · Firecrawl targets {scoutDiagnostics.firecrawlTargets}
          {scoutDiagnostics.fallbackReason ? ` · fallback: ${scoutDiagnostics.fallbackReason}` : ''}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
        <section className="rounded border border-emerald-500/25 bg-black/25 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold tracking-widest text-emerald-300">OPPORTUNITY SCOUT</span>
            <span className="text-[10px] text-slate-500">persistence: {persistence}</span>
          </div>
          <ul className="max-h-[34rem] space-y-3 overflow-y-auto">
            {(surface.opportunities ?? []).map(opp => (
              <li key={opp.id} className="rounded border border-white/10 bg-slate-950/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{opp.title}</div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {opp.category} · assigned {opp.assigned_family} · provider {opp.source_provider} · {opp.discovered_at.slice(5, 16)}
                    </div>
                  </div>
                  <span className="rounded border border-white/10 px-2 py-1 text-[10px] font-bold uppercase text-emerald-200">{opp.status}</span>
                </div>
                <div className="mt-3 grid gap-2 text-[10px] text-slate-300 sm:grid-cols-4">
                  <span>Confidence: {pct(opp.confidence)}</span>
                  <span>Value: {money(opp.estimated_value)}</span>
                  <span>Risk: {opp.risk_level}</span>
                  <span>Actions: {opp.required_actions.slice(0, 2).join(', ') || 'review'}</span>
                </div>
                {opp.notes ? <p className="mt-2 line-clamp-2 text-xs text-slate-500">{opp.notes}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ['Investigate', 'investigate'],
                    ['Assign', 'assign'],
                    ['Generate Proposal', 'generate_proposal'],
                    ['Queue Workflow', 'queue_workflow'],
                    ['Approve', 'approve'],
                    ['Reject', 'reject'],
                    ['Archive', 'archive'],
                  ].map(([label, action]) => (
                    <button
                      key={action}
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 text-[9px] font-bold text-slate-300 hover:border-emerald-400/60"
                      onClick={() => void updateOpportunity(opp.id, action)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
            {!(surface.opportunities ?? []).length ? <li className="rounded border border-white/10 p-3 text-xs text-slate-500">No structured opportunities yet.</li> : null}
          </ul>
        </section>

        <div className="space-y-4">
          <section className="rounded border border-blue-500/25 bg-black/25 p-3">
            <div className="mb-2 text-[10px] font-bold tracking-widest text-blue-300">COMMAND INGEST</div>
            <input className="mb-2 w-full rounded bg-black px-2 py-1 text-xs text-slate-200" value={decree} onChange={e => setDecree(e.target.value)} />
            <textarea className="h-20 w-full rounded bg-black px-2 py-1 text-xs text-slate-300" value={analysis} onChange={e => setAnalysis(e.target.value)} />
            <button type="button" className="mt-2 rounded bg-emerald-700 px-3 py-1 text-[10px] font-bold text-white" disabled={commandBusy} onClick={() => void runCommand()}>
              {commandBusy ? 'INGESTING' : 'INGEST STRUCTURED OUTPUT'}
            </button>
            {commandSummary ? <p className="mt-2 text-[10px] text-emerald-200">{commandSummary}</p> : null}
          </section>

          <section className="rounded border border-amber-500/25 bg-black/25 p-3">
            <div className="mb-2 text-[10px] font-bold tracking-widest text-amber-300">MISSION / WORKFLOW QUEUE</div>
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {(surface.workflows ?? []).map(w => (
                <li key={w.id} className="rounded border border-white/10 p-2 text-xs text-slate-300">
                  <div className="font-semibold text-amber-100">{w.summary}</div>
                  <div className="mt-1 text-[10px] text-slate-500">{w.workflow_type} · {w.status} · {w.assigned_family} · priority {w.priority}</div>
                </li>
              ))}
              {!(surface.workflows ?? []).length ? <li className="text-xs text-slate-500">No queued workflows.</li> : null}
            </ul>
          </section>

          <section className="rounded border border-purple-500/25 bg-black/25 p-3">
            <div className="mb-2 text-[10px] font-bold tracking-widest text-purple-300">PROVIDER ASSIGNMENTS</div>
            <ul className="max-h-44 space-y-2 overflow-y-auto">
              {providerAssignments.slice(0, 10).map(a => (
                <li key={a.id} className="rounded border border-white/10 p-2 text-xs text-slate-300">
                  <div>{a.assigned_family} · {a.provider_runtime_state} · confidence {pct(a.confidence)}</div>
                  <div className="text-[10px] text-slate-500">{a.subject_type} · {a.last_activity_at.slice(5, 16)}</div>
                </li>
              ))}
              {!providerAssignments.length ? <li className="text-xs text-slate-500">No provider assignment history yet.</li> : null}
            </ul>
          </section>

          <section className="rounded border border-cyan-500/25 bg-black/25 p-3">
            <div className="mb-2 text-[10px] font-bold tracking-widest text-cyan-300">TELEMETRY</div>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[10px] text-slate-400">
              {(surface.telemetry ?? []).slice(0, 12).map(t => (
                <li key={t.id}>{t.category} · {t.metric_name}: {t.metric_value}</li>
              ))}
              {!(surface.telemetry ?? []).length ? <li>No telemetry events yet.</li> : null}
            </ul>
          </section>
        </div>
      </div>
    </section>
  )
}

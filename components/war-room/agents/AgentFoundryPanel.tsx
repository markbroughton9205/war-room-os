'use client'

import { useCallback, useEffect, useState } from 'react'

type FoundryStatus =
  | 'live_persistent'
  | 'persistent_store'
  | 'awaiting_data'
  | 'derived_from_existing_store'
  | 'static_seed'
  | 'not_connected'

type FoundryAgent = {
  id: string
  name: string
  purpose: string
  state: string
  operationalRole: string
  memoryScope: string[]
  assignedDoctrine: string[]
  riskProfile: { level: string }
}

type FoundryWorker = {
  id: string
  name: string
  state: string
  queueDepth: number
  persistence: FoundryStatus
}

type FoundrySnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  overallStatus: FoundryStatus
  tables: { table: string; records: number | null; status: FoundryStatus }[]
  counts: {
    persistedAgents: number | null
    activeAgents: number | null
    proposedAgents: number | null
    workerQueueRows: number | null
    queuedWorkerItems: number | null
    pendingAgentApprovals: number | null
    memoryScopes: number | null
    performanceRows: number | null
  }
  subsystemStatuses: Record<string, { status: FoundryStatus; detail: string; records: number | null; warnings: string[] }>
  validations: {
    agentHealth: { id: string; severity: string; status: FoundryStatus; summary: string; detail: string }[]
    governance: { id: string; severity: string; status: FoundryStatus; summary: string; detail: string }[]
    persistence: { id: string; severity: string; status: FoundryStatus; summary: string; detail: string }[]
    performance: { id: string; severity: string; status: FoundryStatus; summary: string; detail: string }[]
  }
  foundry: {
    agents: FoundryAgent[]
    workers: FoundryWorker[]
    governance: { rules: string[]; pendingApprovals: number }
    coordination: { queueDepth: number; readyWorkers: number; degradedWorkers: number; persistentQueueRows: number | null; coordinationRule: string }
    memory: { domains: { id: string; label: string }[]; rule: string }
    performance: { scorecards: { agentId: string; name: string; reliabilityScore: number; warning: string }[] }
    health: { state: string; warnings: string[]; workerHealth: { total: number; ready: number; paused: number; degraded: number } }
  }
}

function countLabel(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : 'not connected'
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function statusColor(status?: string) {
  if (status === 'live_persistent') return '#34D399'
  if (status === 'persistent_store') return '#2DD4BF'
  if (status === 'awaiting_data') return '#FBBF24'
  if (status === 'derived_from_existing_store') return '#60A5FA'
  if (status === 'static_seed') return '#A78BFA'
  if (status === 'active' || status === 'ready' || status === 'healthy') return '#34D399'
  if (status === 'degraded' || status === 'not_connected') return '#F87171'
  return '#94A3B8'
}

function Badge({ status }: { status?: string }) {
  const color = statusColor(status)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {status ?? 'checking'}
    </span>
  )
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-200">{value}</div>
    </div>
  )
}

export function AgentFoundryPanel() {
  const [snapshot, setSnapshot] = useState<FoundrySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agents/integration', { cache: 'no-store' })
      const body = await res.json() as FoundrySnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Agent foundry snapshot failed')
      setSnapshot(body)
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : 'Agent foundry snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const tables = snapshot?.tables ?? []
  const agents = snapshot?.foundry.agents ?? []
  const workers = snapshot?.foundry.workers ?? []
  const subsystem = snapshot?.subsystemStatuses
  const healthWarnings = [
    ...(snapshot?.validations.agentHealth ?? []),
    ...(snapshot?.validations.governance ?? []),
  ].filter(item => item.severity !== 'info').slice(0, 4)

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Phase 10</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Agent Foundry + Long-Lived Worker Ecosystem
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Durable, doctrine-scoped workers with auditable queues and approval-bound lifecycle states. No autonomous external execution.
        </p>
      </header>

      <div className="mb-4 rounded border border-white/10 bg-black/25 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Agent Foundry Truth Layer</div>
            <div className="mt-1 text-[10px] text-slate-500">
              Snapshot: {snapshot?.generatedAt ?? (loading ? 'loading...' : 'not connected')} · persistence: {snapshot ? String(snapshot.persistenceAvailable) : 'unknown'} · source: /api/agents/integration · external execution: false
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={snapshot?.overallStatus} />
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
              style={{ border: '1px solid #444', color: '#ccc' }}
              onClick={() => void load()}
              disabled={loading}
            >
              REFRESH
            </button>
          </div>
        </div>
        {error ? <div className="mt-2 text-[10px] text-red-300">{error}</div> : null}
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <MiniCard label="Persisted Agents" value={countLabel(snapshot?.counts.persistedAgents)} />
          <MiniCard label="Active / Proposed" value={`${snapshot?.counts.activeAgents ?? 0}/${snapshot?.counts.proposedAgents ?? 0}`} />
          <MiniCard label="Queue Activity" value={`${snapshot?.counts.queuedWorkerItems ?? 0} durable`} />
          <MiniCard label="Performance Rows" value={countLabel(snapshot?.counts.performanceRows)} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border border-teal-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-teal-300">Agent Registry</h3>
            <Badge status={subsystem?.agentRegistry?.status} />
          </div>
          <p className="mb-2 text-[10px] text-slate-500">{subsystem?.agentRegistry?.detail ?? 'Registry status loading.'}</p>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {agents.map(agent => (
              <li key={agent.id} className="rounded border border-white/10 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">{agent.name}</span>
                  <Badge status={agent.state} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">{agent.operationalRole} · risk {agent.riskProfile.level}</div>
                <p className="mt-1 text-[10px] text-slate-400">{agent.purpose}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-amber-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Worker Health Monitor</h3>
            <Badge status={subsystem?.workerHealth?.status} />
          </div>
          <div className="mb-2 grid gap-2 text-[10px] sm:grid-cols-3">
            <MiniCard label="Ready" value={String(snapshot?.foundry.coordination.readyWorkers ?? 0)} />
            <MiniCard label="Degraded" value={String(snapshot?.foundry.coordination.degradedWorkers ?? 0)} />
            <MiniCard label="Queue Rows" value={countLabel(snapshot?.counts.workerQueueRows)} />
          </div>
          <p className="mb-2 text-[10px] text-slate-500">{subsystem?.workerQueues?.detail ?? 'Worker queue status loading.'}</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {workers.map(worker => (
              <li key={worker.id} className="rounded border border-white/10 p-2 text-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-100">{worker.name}</span>
                  <Badge status={worker.state} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">queue {worker.queueDepth} · store {worker.persistence}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-violet-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Lifecycle + Governance</h3>
            <Badge status={subsystem?.governanceEvents?.status} />
          </div>
          <div className="mb-2 rounded border border-white/10 p-2 text-[10px] text-slate-400">
            {subsystem?.lifecycleTracking?.detail ?? 'Lifecycle tracking loading.'} Approval before activation and capability expansion remains enforced.
          </div>
          <ul className="grid gap-1 text-[10px] text-slate-500 sm:grid-cols-2">
            {(snapshot?.foundry.governance.rules ?? []).map(rule => <li key={rule}>Rule: {rule}</li>)}
          </ul>
          {healthWarnings.length ? (
            <ul className="mt-2 space-y-1 text-[10px] text-amber-200">
              {healthWarnings.map(item => <li key={item.id}>{item.summary}: {item.detail}</li>)}
            </ul>
          ) : null}
        </section>

        <section className="rounded border border-sky-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Performance Scorecards</h3>
            <Badge status={subsystem?.agentScorecards?.status} />
          </div>
          <p className="mb-2 text-[10px] text-slate-500">{subsystem?.agentScorecards?.detail ?? 'Scorecard status loading.'}</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.foundry.performance.scorecards ?? []).map(card => (
              <li key={card.agentId} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sky-100">{card.name}</span>
                  <Badge status={card.warning} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">Reliability {pct(card.reliabilityScore)} · rows {countLabel(snapshot?.counts.performanceRows)}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-emerald-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Scoped Memory Viewer</h3>
            <Badge status={subsystem?.memoryScopes?.status} />
          </div>
          <p className="mb-2 text-[10px] text-slate-500">{subsystem?.memoryScopes?.detail ?? snapshot?.foundry.memory.rule ?? 'Memory scopes loading.'}</p>
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            {(snapshot?.foundry.memory.domains ?? []).map(domain => (
              <div key={domain.id} className="rounded border border-white/10 p-2 text-slate-400">{domain.label}</div>
            ))}
          </div>
        </section>

        <section className="rounded border border-rose-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-rose-300">Agent Approval Queue</h3>
            <Badge status={subsystem?.approvalQueues?.status} />
          </div>
          <div className="mb-2 grid gap-2 text-[10px] sm:grid-cols-2">
            <MiniCard label="Agent Approvals" value={countLabel(snapshot?.counts.pendingAgentApprovals)} />
            <MiniCard label="External Execution" value="false" />
          </div>
          <p className="mb-2 text-[10px] text-slate-500">{subsystem?.approvalQueues?.detail ?? 'Approval queue status loading.'}</p>
          <ul className="space-y-1 text-[10px] text-slate-500">
            {tables.map(table => (
              <li key={table.table}>{table.table}: {countLabel(table.records)} · {table.status}</li>
            ))}
            {!tables.length ? <li>Persistence tables are not connected or migration has not been applied.</li> : null}
          </ul>
        </section>
      </div>
    </section>
  )
}

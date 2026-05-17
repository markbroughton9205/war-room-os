'use client'

import { useCallback, useEffect, useState } from 'react'

type FoundryStatus = 'persistent_store' | 'awaiting_data' | 'not_connected'

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
  integrationStatus: FoundryStatus
  tables: { table: string; records: number | null; status: FoundryStatus }[]
  agents: FoundryAgent[]
  workers: FoundryWorker[]
  governance: { rules: string[]; pendingApprovals: number }
  coordination: { queueDepth: number; readyWorkers: number; degradedWorkers: number; persistentQueueRows: number | null; coordinationRule: string }
  memory: { domains: { id: string; label: string }[]; rule: string }
  performance: { scorecards: { agentId: string; name: string; reliabilityScore: number; warning: string }[] }
  health: { state: string; warnings: string[]; workerHealth: { total: number; ready: number; paused: number; degraded: number } }
}

function countLabel(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : 'not connected'
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

function statusColor(status?: string) {
  if (status === 'persistent_store') return '#2DD4BF'
  if (status === 'awaiting_data') return '#FBBF24'
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
      const res = await fetch('/api/agents/foundry', { cache: 'no-store' })
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
  const agents = snapshot?.agents ?? []
  const workers = snapshot?.workers ?? []

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
              Snapshot: {snapshot?.generatedAt ?? (loading ? 'loading...' : 'not connected')} · persistence: {snapshot ? String(snapshot.persistenceAvailable) : 'unknown'} · external execution: false
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={snapshot?.integrationStatus} />
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
          <MiniCard label="Registry" value={`${agents.length} blueprints`} />
          <MiniCard label="Worker Health" value={`${snapshot?.health.workerHealth.ready ?? 0}/${snapshot?.health.workerHealth.total ?? 0} ready`} />
          <MiniCard label="Queue Activity" value={`${snapshot?.coordination.queueDepth ?? 0} queued`} />
          <MiniCard label="Approvals" value={`${snapshot?.governance.pendingApprovals ?? 0} persisted`} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border border-teal-500/30 bg-black/25 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-teal-300">Agent Registry</h3>
            <Badge status={snapshot?.integrationStatus} />
          </div>
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
            <Badge status={snapshot?.health.state} />
          </div>
          <div className="mb-2 grid gap-2 text-[10px] sm:grid-cols-3">
            <MiniCard label="Ready" value={String(snapshot?.coordination.readyWorkers ?? 0)} />
            <MiniCard label="Degraded" value={String(snapshot?.coordination.degradedWorkers ?? 0)} />
            <MiniCard label="Queue Rows" value={countLabel(snapshot?.coordination.persistentQueueRows)} />
          </div>
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
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-violet-300">Lifecycle + Governance</h3>
          <div className="mb-2 rounded border border-white/10 p-2 text-[10px] text-slate-400">
            Approval before activation and capability expansion. Doctrine inheritance enforced. Self-expansion disabled.
          </div>
          <ul className="grid gap-1 text-[10px] text-slate-500 sm:grid-cols-2">
            {(snapshot?.governance.rules ?? []).map(rule => <li key={rule}>Rule: {rule}</li>)}
          </ul>
        </section>

        <section className="rounded border border-sky-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-sky-300">Performance Scorecards</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.performance.scorecards ?? []).map(card => (
              <li key={card.agentId} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sky-100">{card.name}</span>
                  <Badge status={card.warning} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">Reliability {pct(card.reliabilityScore)} · awaiting real performance rows until workers record outcomes.</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-emerald-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Scoped Memory Viewer</h3>
          <p className="mb-2 text-[10px] text-slate-500">{snapshot?.memory.rule ?? 'Memory scopes loading.'}</p>
          <div className="grid gap-2 text-[10px] sm:grid-cols-2">
            {(snapshot?.memory.domains ?? []).map(domain => (
              <div key={domain.id} className="rounded border border-white/10 p-2 text-slate-400">{domain.label}</div>
            ))}
          </div>
        </section>

        <section className="rounded border border-rose-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-rose-300">Agent Approval Queue</h3>
          <div className="mb-2 grid gap-2 text-[10px] sm:grid-cols-2">
            <MiniCard label="Pending Approvals" value={String(snapshot?.governance.pendingApprovals ?? 0)} />
            <MiniCard label="External Execution" value="false" />
          </div>
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

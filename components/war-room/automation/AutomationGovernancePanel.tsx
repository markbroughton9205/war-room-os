'use client'

import { useCallback, useEffect, useState } from 'react'

type StatusKind = 'live_persistent' | 'persistent_store' | 'awaiting_data' | 'static_seed' | 'not_connected'

type Mode = {
  id: string
  label: string
  summary: string
  executionAllowed: boolean
  recurringAllowed: boolean
  safeguards: string[]
}

type TableSummary = {
  table: string
  records: number | null
  status: StatusKind
}

type Domain = {
  id: string
  label: string
  purpose: string
  defaultMode: string
  allowedModes: string[]
  restrictions: string[]
  queueScope: string[]
  riskThreshold: string
}

type Checkpoint = {
  domainId: string
  modeId: string
  decision: string
  riskScore: number
  confidenceScore: number
  blockers: string[]
  warnings: string[]
}

type Simulation = {
  domainId: string
  modeId: string
  expectedGain: string
  expectedRisk: string
  degradationPotential: string
  rollbackComplexity: string
  confidenceScore: number
  realExecutionPerformed: false
}

type FinancialGuardrail = {
  domainId: string
  label: string
  limits: {
    spendCeilingUsd: number
    recurringLimitUsd: number
    domainBudgetUsd: number
    executionFrequencyPerHour: number
    minimumProfitRiskRatio: number
    maximumRollbackCostUsd: number
    minimumConfidenceScore: number
  }
  restrictions: string[]
}

type Throttle = {
  domainId: string
  modeId: string
  state: string
  queuePressure: string
  maxConcurrent: number
  cooldownMinutes: number
  maxRetries: number
  pauseReasons: string[]
}

type RollbackPlan = {
  domainId: string
  modeId: string
  required: boolean
  complexity: string
  estimatedCostUsd: number
  rollbackReady: boolean
}

type Escalation = {
  domainId: string
  modeId: string
  status: string
  reasons: string[]
}

type AuditEvent = {
  id: string
  domainId: string
  eventType: string
  severity: string
  summary: string
  actualExecutionPerformed: false
}

type FoundryAssignment = {
  agentId: string
  name: string
  automationMode: string
  domainId: string
  throttleState: string
  escalationStatus: string
  rollbackComplexity: string
  readinessState: string
  unrestrictedAccessAllowed: false
}

type StatusResponse = {
  generatedAt: string
  integrationStatus: StatusKind
  persistenceAvailable: boolean
  tables: TableSummary[]
  modes: Mode[]
  lifecycle: { planId: string; state: string; actualExecutionActive: false }[]
  foundryAssignments: FoundryAssignment[]
}

type DomainResponse = {
  domains: Domain[]
}

type SimulationResponse = {
  simulations: Simulation[]
  schedules: { planId: string; cadence: string; nextEligibleState: string; queuePressure: string; actualExecutionScheduled: false }[]
}

type CheckpointResponse = {
  checkpoints: Checkpoint[]
  policies: { domainId: string; modeId: string; status: string; rationale: string; actualExecutionAllowed: false }[]
}

type FinancialResponse = {
  financialGuardrails: FinancialGuardrail[]
  throttles: Throttle[]
  rollbackPlans: RollbackPlan[]
}

type AuditResponse = {
  audits: AuditEvent[]
  escalations: Escalation[]
}

type AutomationUiState = {
  status: StatusResponse
  domains: DomainResponse
  simulations: SimulationResponse
  checkpoints: CheckpointResponse
  financial: FinancialResponse
  audit: AuditResponse
}

function countLabel(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : 'not connected'
}

function statusColor(status?: string) {
  if (status === 'live_persistent' || status === 'approved' || status === 'open' || status === 'ready_for_commander_review') return '#34D399'
  if (status === 'persistent_store' || status === 'allowed_for_planning') return '#2DD4BF'
  if (status === 'awaiting_data' || status === 'needs_review' || status === 'watch' || status === 'limited') return '#FBBF24'
  if (status === 'static_seed' || status === 'commander_review_required') return '#A78BFA'
  if (status === 'blocked' || status === 'paused' || status === 'emergency_shutdown' || status === 'not_connected') return '#F87171'
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

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' })
  const body = await res.json() as T & { error?: string }
  if (!res.ok) throw new Error(body.error || `${path} failed`)
  return body
}

export function AutomationGovernancePanel() {
  const [snapshot, setSnapshot] = useState<AutomationUiState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [status, domains, simulations, checkpoints, financial, audit] = await Promise.all([
        loadJson<StatusResponse>('/api/automation/status'),
        loadJson<DomainResponse>('/api/automation/domains'),
        loadJson<SimulationResponse>('/api/automation/simulations'),
        loadJson<CheckpointResponse>('/api/automation/checkpoints'),
        loadJson<FinancialResponse>('/api/automation/financial'),
        loadJson<AuditResponse>('/api/automation/audit'),
      ])
      setSnapshot({ status, domains, simulations, checkpoints, financial, audit })
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : 'Automation snapshot failed')
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

  const blockedCheckpoints = snapshot?.checkpoints.checkpoints.filter(item => item.decision === 'blocked').length ?? 0
  const pausedThrottles = snapshot?.financial.throttles.filter(item => item.state === 'paused' || item.state === 'emergency_shutdown').length ?? 0
  const spendCeiling = snapshot?.financial.financialGuardrails.reduce((sum, item) => sum + item.limits.spendCeilingUsd, 0) ?? 0
  const auditCount = snapshot?.audit.audits.length ?? 0

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-white/10 pt-10">
      <header className="mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#d4af37]">Phase 10B</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          Automation Modes + Bounded Execution Domains
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Read-only governance surface for scoped automation planning, checkpointing, financial guardrails, throttles, rollback, and audit reconstruction. No actual execution route is exposed.
        </p>
      </header>

      <div className="mb-4 rounded border border-white/10 bg-black/25 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Automation Truth Layer</div>
            <div className="mt-1 text-[10px] text-slate-500">
              Snapshot: {snapshot?.status.generatedAt ?? (loading ? 'loading...' : 'not connected')} · persistence: {snapshot ? String(snapshot.status.persistenceAvailable) : 'unknown'} · actual execution: false
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={snapshot?.status.integrationStatus} />
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
          <MiniCard label="Domains" value={String(snapshot?.domains.domains.length ?? 0)} />
          <MiniCard label="Blocked Checkpoints" value={String(blockedCheckpoints)} />
          <MiniCard label="Paused Throttles" value={String(pausedThrottles)} />
          <MiniCard label="Spend Ceiling" value={`$${spendCeiling}`} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded border border-teal-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-teal-300">Automation Modes</h3>
          <ul className="space-y-2">
            {(snapshot?.status.modes ?? []).map(mode => (
              <li key={mode.id} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{mode.label}</span>
                  <Badge status={mode.executionAllowed ? 'approval_bound' : 'planning_only'} />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{mode.summary} Recurring: {String(mode.recurringAllowed)}.</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-sky-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-sky-300">Domain Registry</h3>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {(snapshot?.domains.domains ?? []).map(domain => (
              <li key={domain.id} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sky-100">{domain.label}</span>
                  <Badge status={domain.defaultMode} />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{domain.purpose}</p>
                <div className="mt-1 text-[10px] text-slate-500">queues: {domain.queueScope.join(', ')}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-amber-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-300">Execution Readiness + Checkpoints</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.checkpoints.checkpoints ?? []).map(item => (
              <li key={`${item.domainId}-${item.modeId}`} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-100">{item.domainId}</span>
                  <Badge status={item.decision} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">risk {item.riskScore} · confidence {item.confidenceScore}</div>
                {item.blockers[0] ? <div className="mt-1 text-[10px] text-red-300">{item.blockers[0]}</div> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-violet-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-violet-300">Execution Simulations</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.simulations.simulations ?? []).map(item => (
              <li key={`${item.domainId}-${item.modeId}`} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-violet-100">{item.domainId}</span>
                  <Badge status={item.degradationPotential} />
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{item.expectedRisk}</p>
                <div className="mt-1 text-[10px] text-slate-500">rollback {item.rollbackComplexity} · executed {String(item.realExecutionPerformed)}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-emerald-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Financial Guardrails</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.financial.financialGuardrails ?? []).map(item => (
              <li key={item.domainId} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-100">{item.label}</span>
                  <Badge status={`$${item.limits.spendCeilingUsd}`} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  recurring ${item.limits.recurringLimitUsd} · budget ${item.limits.domainBudgetUsd} · profit/risk {item.limits.minimumProfitRiskRatio}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-orange-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-orange-300">Queue Pressure + Throttle State</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.financial.throttles ?? []).map(item => (
              <li key={`${item.domainId}-${item.modeId}`} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-orange-100">{item.domainId}</span>
                  <Badge status={item.state} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">pressure {item.queuePressure} · concurrent {item.maxConcurrent} · cooldown {item.cooldownMinutes}m · retries {item.maxRetries}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-rose-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-rose-300">Rollback Plans + Escalation Status</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.financial.rollbackPlans ?? []).map(plan => {
              const escalation = snapshot?.audit.escalations.find(item => item.domainId === plan.domainId)
              return (
                <li key={`${plan.domainId}-${plan.modeId}`} className="rounded border border-white/10 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-rose-100">{plan.domainId}</span>
                    <Badge status={escalation?.status ?? plan.complexity} />
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">rollback {plan.complexity} · ready {String(plan.rollbackReady)} · cost ${plan.estimatedCostUsd}</div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="rounded border border-fuchsia-500/30 bg-black/25 p-3 text-xs">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Agent Foundry Automation Assignments</h3>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {(snapshot?.status.foundryAssignments ?? []).slice(0, 10).map(item => (
              <li key={item.agentId} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fuchsia-100">{item.name}</span>
                  <Badge status={item.readinessState} />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">{item.domainId} · {item.automationMode} · unrestricted {String(item.unrestrictedAccessAllowed)}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded border border-slate-500/30 bg-black/25 p-3 text-xs xl:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Automation Audit + Persistence Tables</h3>
            <Badge status={`${auditCount}_events`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {(snapshot?.audit.audits ?? []).slice(0, 12).map(event => (
                <li key={event.id} className="rounded border border-white/10 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{event.eventType}</span>
                    <Badge status={event.severity} />
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">{event.summary} Executed: {String(event.actualExecutionPerformed)}</div>
                </li>
              ))}
            </ul>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-[10px] text-slate-500">
              {(snapshot?.status.tables ?? []).map(table => (
                <li key={table.table}>{table.table}: {countLabel(table.records)} · {table.status}</li>
              ))}
              {!snapshot?.status.tables.length ? <li>Automation persistence tables are not connected or migration has not been applied.</li> : null}
            </ul>
          </div>
        </section>
      </div>
    </section>
  )
}

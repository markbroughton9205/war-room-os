'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FoundryLiveAgentEvents } from './FoundryLiveAgentEvents'
import { FoundryContractVerdictPanel } from './FoundryContractVerdictPanel'
import { FoundryReasoningKernelSection } from './FoundryReasoningKernelSection'
import type { FoundryContractVerdictView } from '@/lib/native-builder/foundryContractVerdictView.types'

type RegistryEntry = {
  missionId: string
  title: string
  goal: string
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'
  status: string
  phase: string
  currentAction: string | null
  modelProvider: string | null
  modelId: string | null
  authorizationWaiting: boolean
  lockClaims: string[]
  lastHeartbeat: string | null
  blockedReason: string | null
  recovered: boolean
  recoveryDisposition: string | null
  completionGate: { complete: boolean; missing: string[]; detail: string }
}

type ProductionLeaseView = {
  ownerMissionId: string
  generation: number
  targetInstallId: string | null
  phase: string
  mode: string
} | null

type ProductionOwnerView = {
  productionGeneration: number
  installId: string
  productionOwnerMissionId: string | null
} | null

type WatchdogScanView = {
  scannedAt: string
  code: string
  reason: string
  generationAfter: number | null
  identityMatch: boolean | null
} | null

type MissionDetail = {
  missionId: string
  title: string
  userRequest: string
  status: string
  goal: string
  successCriteria: string[]
  currentStep: string | null
  currentAction?: string | null
  priority?: string
  plan: Array<{ id: string; title: string; status: string; note?: string }>
  observations: Array<{ at: string; text: string; source: string }>
  journal: Array<{ at: string; kind: string; text: string }>
  hypotheses?: Array<{ statement: string; status: string }>
  changedFiles?: string[]
  blocker: { blocker: string; evidence: string; attempted: string; why: string; unblock: string } | null
  authorization: {
    waiting: boolean
    action: string | null
    reason: string | null
    target?: string | null
    impact?: string | null
  } | null
  completionGate: { complete: boolean; missing: string[]; detail: string }
  modelState?: { activeProvider: string | null; activeModel: string | null; lastReasoningSummary: string | null }
  pinnedModel?: { provider: string; modelId: string } | null
  recovery?: { recovered: boolean; disposition: string; notes: string[] } | null
  lockClaims?: string[]
  runtimeClaims?: string[]
  artifacts?: string[]
  buildState?: { ok: boolean | null; detail: string | null }
  runtimeState?: { activeInstallId: string | null; runningInstallId: string | null; identityMatch: boolean | null }
  capabilityLane?: string
  applicationPreview?: {
    status: string
    projectName: string
    projectRoot?: string
    whatWasBuilt: string
    localPreview: string
    majorFeatures: string[]
    testStatus: string
    knownLimitations: string[]
    researchUsed: string[]
    deploymentReadiness: string
  } | null
  agentEvents?: Array<{ eventId: string; at: string; type: string; text: string; tool?: string | null; ok?: boolean | null }>
  contractVerdict?: FoundryContractVerdictView | null
  engineeringClass?: string | null
  reasoningBrief?: {
    strategy?: string
    depth?: string
    status?: string
    hypotheses?: string[]
    activeHypotheses?: string[]
    selectedPlan?: string
    evidence?: string[]
    latestEvidence?: string[]
    contradictions?: string[]
    verification?: string
    verificationState?: string
    searchBranches?: Array<{ label: string; status: string; note?: string }>
    nextReasoningAction?: string
  } | null
  workerRouting?: {
    mode?: string | null
    recommendedWorker?: string | null
    selectedWorker?: string | null
    previousWorker?: string | null
    why?: string | null
    capabilityEvidence?: string | null
    policy?: string | null
    fallbackAllowed?: boolean
    workerSwitchCount?: number
  } | null
}

type Queue = {
  active: RegistryEntry[]
  queued: RegistryEntry[]
  blocked: RegistryEntry[]
  waitingAuthorization: RegistryEntry[]
  waitingResource: RegistryEntry[]
  paused: RegistryEntry[]
  recovering: RegistryEntry[]
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload
}

function QueueColumn({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string
  items: RegistryEntry[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="min-w-[180px] flex-1 rounded border border-white/10 p-2" data-testid={`foundry-ops-queue-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{title} · {items.length}</p>
      <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
        {items.length === 0 ? <li className="text-[10px] text-slate-600">None</li> : null}
        {items.map(item => (
          <li key={item.missionId}>
            <button
              type="button"
              aria-label={item.title}
              aria-pressed={selectedId === item.missionId}
              onClick={() => onSelect(item.missionId)}
              className={`w-full rounded border px-2 py-1 text-left ${selectedId === item.missionId ? 'border-emerald-400/50 bg-emerald-950/40' : 'border-white/5 bg-black/20'}`}
            >
              <span className="block truncate text-[11px] text-emerald-100">{item.title}</span>
              <span className="block text-[9px] uppercase tracking-widest text-slate-500">{item.priority} · {item.status}</span>
              <span className="block truncate text-[10px] text-cyan-200">{item.currentAction ?? 'Idle'}</span>
              {item.recovered ? <span className="block text-[9px] uppercase tracking-widest text-amber-300">Recovered · {item.recoveryDisposition}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FoundryOperationsPanel() {
  const [request, setRequest] = useState('')
  const [queue, setQueue] = useState<Queue>({
    active: [], queued: [], blocked: [], waitingAuthorization: [], waitingResource: [], paused: [], recovering: [],
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<MissionDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelLabel, setModelLabel] = useState('model pending')
  const [view, setView] = useState<'commander' | 'active' | 'completed' | 'system' | 'archived'>('commander')
  const [productionLease, setProductionLease] = useState<ProductionLeaseView>(null)
  const [productionOwner, setProductionOwner] = useState<ProductionOwnerView>(null)
  const [lastWatchdogScan, setLastWatchdogScan] = useState<WatchdogScanView>(null)
  const [routingMode, setRoutingMode] = useState<'SHADOW' | 'ENABLED'>('SHADOW')

  const refresh = useCallback(async () => {
    const listing = await json<{
      queue: Queue
      runtimeConfig?: { primaryModel: string }
      missions: MissionDetail[]
      productionLease?: ProductionLeaseView
      productionOwner?: ProductionOwnerView
      lastWatchdogScan?: WatchdogScanView
    }>(`/api/foundry/operations?view=${view}`)
    setQueue(listing.queue)
    const routing = await json<{ mode?: string }>(`/api/foundry/routing-mode`).catch(() => ({ mode: 'SHADOW' }))
    if (routing.mode === 'ENABLED' || routing.mode === 'SHADOW') setRoutingMode(routing.mode)
    setProductionLease(listing.productionLease ?? null)
    setProductionOwner(listing.productionOwner ?? null)
    setLastWatchdogScan(listing.lastWatchdogScan ?? null)
    if (listing.runtimeConfig?.primaryModel) setModelLabel(listing.runtimeConfig.primaryModel)
    const id = selectedId && listing.missions.some(item => item.missionId === selectedId) ? selectedId : null
    if (!id) {
      setSelected(null)
      return
    }
    const detail = await json<{ mission: MissionDetail }>(`/api/foundry/missions/${id}`)
    setSelected(detail.mission)
  }, [selectedId, view])

  useEffect(() => {
    queueMicrotask(() => {
      void refresh().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
    })
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
      await refresh().catch(() => undefined)
    }
  }

  const start = () => act('start', async () => {
    if (!request.trim()) return
    const result = await json<{ mission: MissionDetail }>('/api/foundry/missions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: request.trim() }),
    })
    setSelectedId(result.mission.missionId)
    setSelected(result.mission)
    setRequest('')
    void json(`/api/foundry/missions/${result.mission.missionId}/run`, { method: 'POST' })
  })

  const progress = useMemo(() => {
    if (!selected?.plan.length) return '0/0'
    const done = selected.plan.filter(step => step.status === 'done').length
    return `${done}/${selected.plan.length}`
  }, [selected])

  return (
    <section className="relative z-20 mx-2 mb-2 rounded-lg border border-cyan-400/25 bg-slate-950/90 p-3" data-testid="foundry-operations-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">Foundry Operations</p>
          <p className="text-[10px] text-slate-500">Advanced maintenance · {modelLabel}</p>
        </div>
        <label className="rounded border border-cyan-400/20 px-2 py-1" data-testid="foundry-routing-mode-control">
          <span className="block text-[8px] font-bold uppercase tracking-[0.28em] text-slate-500">Routing mode</span>
          <select
            className="bg-transparent text-[10px] text-cyan-100"
            value={routingMode}
            aria-label="Capability-aware routing mode"
            onChange={event => void act('routing-mode', async () => {
              const next = event.target.value === 'ENABLED' ? 'ENABLED' : 'SHADOW'
              const result = await json<{ mode?: string }>('/api/foundry/routing-mode', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode: next, commanderConfirmed: true }),
              })
              if (result.mode === 'ENABLED' || result.mode === 'SHADOW') setRoutingMode(result.mode)
            })}
          >
            <option value="SHADOW">SHADOW</option>
            <option value="ENABLED">ENABLED</option>
          </select>
        </label>
        <div className="rounded border border-cyan-400/20 px-2 py-1" data-testid="foundry-production-owner">
          <p className="text-[8px] font-bold uppercase tracking-[0.28em] text-slate-500">Production owner</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-200">
            {productionLease && selectedId && productionLease.ownerMissionId === selectedId
              ? 'CURRENT'
              : productionLease
                ? 'WAITING'
                : 'NONE'}
          </p>
          <p className="max-w-[220px] truncate text-[9px] text-slate-400" data-testid="foundry-production-owner-generation">
            {productionLease
              ? `${productionLease.ownerMissionId.slice(0, 8)} · G${productionLease.generation} · ${productionLease.phase}`
              : 'No live production lease'}
          </p>
          <p
            className="text-[9px] uppercase tracking-widest text-cyan-100"
            data-testid="foundry-last-production-generation"
            data-watchdog-code={lastWatchdogScan?.code ?? ''}
          >
            LAST PRODUCTION GENERATION {productionOwner?.productionGeneration ?? '—'}
          </p>
          <p className="max-w-[260px] truncate text-[9px] text-slate-400" data-testid="foundry-last-watchdog-scan">
            LAST WATCHDOG SCAN {lastWatchdogScan ? `${lastWatchdogScan.code} · ${lastWatchdogScan.scannedAt}` : 'none'}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" data-testid="foundry-operations-filters">
        {(['commander', 'active', 'completed', 'system', 'archived'] as const).map(item => (
          <button
            key={item}
            type="button"
            className={`rounded border px-2 py-0.5 text-[9px] uppercase tracking-widest ${view === item ? 'border-cyan-400/50 text-cyan-200' : 'border-white/10 text-slate-500'}`}
            onClick={() => { setSelectedId(null); setView(item) }}
          >
            {item === 'system' ? 'System/Test' : item}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={request}
          onChange={event => setRequest(event.target.value)}
          placeholder="Launch a Foundry mission…"
          className="min-h-14 flex-1 rounded border border-cyan-400/20 bg-black/40 p-2 text-sm text-emerald-50 outline-none"
          data-testid="foundry-operations-input"
        />
        <button type="button" onClick={() => void start()} disabled={!request.trim() || busy !== null} className="rounded border border-cyan-400/40 px-4 text-[10px] font-bold uppercase tracking-widest text-cyan-200 disabled:opacity-40">
          Start
        </button>
      </div>

      {error ? <p className="mt-2 rounded border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-200">{error}</p> : null}

      {queue.active.length + queue.queued.length + queue.blocked.length + queue.waitingAuthorization.length + queue.waitingResource.length + queue.paused.length + queue.recovering.length === 0 ? (
        <p className="mt-3 text-[11px] text-slate-500" data-testid="foundry-operations-empty">No active missions</p>
      ) : (
      <>
      <div className="mt-3 flex flex-wrap gap-2">
        <QueueColumn title="Active" items={queue.active} selectedId={selectedId} onSelect={setSelectedId} />
        <QueueColumn title="Queued" items={queue.queued} selectedId={selectedId} onSelect={setSelectedId} />
        <QueueColumn title="Blocked" items={queue.blocked} selectedId={selectedId} onSelect={setSelectedId} />
        <QueueColumn title="Waiting Authorization" items={queue.waitingAuthorization} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      {queue.waitingResource.length || queue.paused.length || queue.recovering.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <QueueColumn title="Waiting Resource" items={queue.waitingResource} selectedId={selectedId} onSelect={setSelectedId} />
          <QueueColumn title="Paused" items={queue.paused} selectedId={selectedId} onSelect={setSelectedId} />
          <QueueColumn title="Recovering" items={queue.recovering} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      ) : null}
      </>
      )}

      {!selected ? (
        <div className="mt-3 rounded border border-white/10 p-2" data-testid="foundry-operations-detail-empty">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Mission details</p>
          <div className="mt-2">
            <FoundryLiveAgentEvents missionSelected={false} events={[]} />
          </div>
          <div className="mt-2">
            <FoundryReasoningKernelSection brief={null} />
          </div>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]" data-testid="foundry-operations-detail">
          <div className="space-y-2">
            {selected.recovery?.recovered ? (
              <div className="rounded border border-amber-400/40 bg-amber-950/30 p-2" data-testid="foundry-recovery-banner">
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">Recovered mission</p>
                <p className="text-xs text-amber-100">{selected.recovery.disposition}</p>
                <p className="text-[10px] text-slate-400">{selected.recovery.notes?.[0]}</p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-white/10 p-2">
                <p className="text-[9px] uppercase tracking-widest text-slate-500">Status</p>
                <p className="text-sm font-bold text-emerald-200">{selected.status}</p>
              </div>
              <div className="rounded border border-white/10 p-2">
                <p className="text-[9px] uppercase tracking-widest text-slate-500">Priority</p>
                <select
                  className="bg-transparent text-xs text-cyan-100"
                  value={selected.priority ?? 'NORMAL'}
                  onChange={event => void act('priority', async () => {
                    await json(`/api/foundry/missions/${selected.missionId}/priority`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ priority: event.target.value }),
                    })
                  })}
                  aria-label="Mission priority"
                >
                  {['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="rounded border border-white/10 p-2">
                <p className="text-[9px] uppercase tracking-widest text-slate-500">Progress</p>
                <p className="text-xs text-slate-200">{progress}</p>
              </div>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Goal</p>
              <p className="text-xs text-slate-200">{selected.goal}</p>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Success criteria</p>
              <ul className="text-[10px] text-slate-400">{(selected.successCriteria ?? []).slice(0, 6).map(item => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Current action / model</p>
              <p className="text-xs text-cyan-100">{selected.currentAction ?? selected.modelState?.lastReasoningSummary ?? 'Waiting'}</p>
              <p className="text-[10px] text-slate-500">{selected.pinnedModel ? `${selected.pinnedModel.provider}:${selected.pinnedModel.modelId}` : selected.modelState?.activeProvider}</p>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Latest finding</p>
              <p className="line-clamp-3 text-xs text-amber-100">{selected.observations.at(-1)?.text ?? 'No findings yet.'}</p>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Hypotheses</p>
              <ul className="text-[10px] text-slate-400">
                {(selected.hypotheses ?? []).slice(-6).map(item => <li key={item.statement}>{item.status}: {item.statement}</li>)}
              </ul>
            </div>
            <FoundryReasoningKernelSection
              brief={selected.reasoningBrief}
              currentAction={selected.currentAction}
              lastObservation={selected.observations.at(-1)?.text ?? null}
              verdict={selected.contractVerdict?.verdict ?? selected.reasoningStatus}
              recommendedWorker={selected.workerRouting?.recommendedWorker}
              selectedWorker={selected.workerRouting?.selectedWorker}
              previousWorker={selected.workerRouting?.previousWorker}
              routingWhy={selected.workerRouting?.why}
              capabilityEvidence={selected.workerRouting?.capabilityEvidence}
              routingMode={selected.workerRouting?.mode}
              fallbackAllowed={selected.workerRouting?.fallbackAllowed}
              workerSwitchCount={selected.workerRouting?.workerSwitchCount}
            />
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Changed files</p>
              <p className="text-[10px] text-slate-400">{(selected.changedFiles ?? []).join(', ') || 'None'}</p>
            </div>
            <FoundryLiveAgentEvents missionSelected events={selected.agentEvents ?? []} />
            <ol className="space-y-1 rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Plan</p>
              {selected.plan.map(step => (
                <li key={step.id} className="text-xs text-slate-300">{step.status} · {step.title}</li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            <FoundryContractVerdictPanel view={selected.contractVerdict} />
            {selected.applicationPreview?.status === 'PROJECT_READY' && (
              selected.engineeringClass === 'STANDALONE_ENGINEER' || (selected.contractVerdict && !selected.contractVerdict.legacy)
                ? Boolean(selected.contractVerdict?.projectReadyAdmissible && selected.contractVerdict.verdict === 'PASS')
                : true
            ) ? (
              <div className="rounded border border-emerald-400/40 bg-emerald-950/20 p-3" data-testid="foundry-application-preview">
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-300">Project ready</p>
                <p className="mt-1 text-sm text-emerald-100">{selected.applicationPreview.projectName}</p>
                <p className="text-xs text-slate-200">{selected.applicationPreview.whatWasBuilt}</p>
                <p className="mt-1 text-xs text-cyan-100">Local preview: {selected.applicationPreview.localPreview}</p>
                {selected.applicationPreview.projectRoot ? (
                  <p className="text-[10px] text-slate-400">Project: {selected.applicationPreview.projectRoot}</p>
                ) : null}
                <p className="text-[10px] text-slate-400">Tests: {selected.applicationPreview.testStatus}</p>
                <p className="text-[10px] text-amber-200">{selected.applicationPreview.deploymentReadiness}</p>
                {/^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(selected.applicationPreview.localPreview) ? (
                  <a
                    className="mt-2 inline-block rounded border border-cyan-400/40 px-3 py-1 text-[10px] text-cyan-100"
                    href={selected.applicationPreview.localPreview}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="foundry-application-preview-open"
                  >
                    Open local preview
                  </a>
                ) : null}
              </div>
            ) : null}
            {selected.authorization?.waiting ? (
              <div className="rounded border border-amber-400/40 bg-amber-950/20 p-3" data-testid="foundry-ops-authorization">
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">Authorization request</p>
                <p className="mt-1 text-xs text-amber-100">Action: {selected.authorization.action}</p>
                <p className="text-xs text-slate-300">Why: {selected.authorization.reason}</p>
                <p className="text-xs text-slate-300">Target: {selected.authorization.target ?? 'current mission'}</p>
                <p className="text-xs text-slate-300">Impact: {selected.authorization.impact ?? 'Only this pending action'}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded border border-emerald-400/40 px-3 py-1 text-[10px] text-emerald-200" onClick={() => void act('approve', async () => {
                    await json(`/api/foundry/missions/${selected.missionId}/authorization`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ approved: true }),
                    })
                    await json(`/api/foundry/missions/${selected.missionId}/resume`, { method: 'POST' })
                  })}>Approve</button>
                  <button type="button" className="rounded border border-red-400/40 px-3 py-1 text-[10px] text-red-200" onClick={() => void act('deny', async () => {
                    await json(`/api/foundry/missions/${selected.missionId}/authorization`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ approved: false }),
                    })
                  })}>Deny</button>
                </div>
              </div>
            ) : null}
            {selected.lockClaims?.length ? (
              <div className="rounded border border-cyan-400/20 p-2 text-[10px] text-cyan-100">Resource claims: {selected.lockClaims.join(', ')}</div>
            ) : null}
            {selected.status === 'WAITING_RESOURCE' || selected.status === 'ACTIVATION_PENDING' ? (
              <div className="rounded border border-amber-400/20 p-2 text-[10px] text-amber-100">
                {selected.status === 'ACTIVATION_PENDING' ? 'Activation pending production owner: ' : 'Waiting for resource: '}
                {selected.blocker?.evidence ?? 'shared lock'}
              </div>
            ) : null}
            <div className="rounded border border-white/10 p-2 text-[10px] text-slate-400">
              <p>Gate: {selected.completionGate.detail}</p>
              <p>Runtime claims: {(selected.runtimeClaims ?? []).join(', ') || 'none'}</p>
            </div>
            <div className="max-h-48 overflow-auto rounded border border-white/10 p-2">
              <p className="sticky top-0 bg-slate-950 text-[9px] uppercase tracking-widest text-slate-500">Journal</p>
              {selected.journal.slice(-16).reverse().map((entry, index) => (
                <p key={`${entry.at}-${index}`} className="border-b border-white/5 py-1 text-[10px] text-slate-400">
                  <span className="text-cyan-500">{entry.kind}</span> {entry.text}
                </p>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} className="rounded border border-white/20 px-3 py-1 text-[10px] uppercase tracking-widest text-slate-200" onClick={() => void act('pause', async () => {
                await json(`/api/foundry/missions/${selected.missionId}/pause`, { method: 'POST' })
              })}>Pause</button>
              <button type="button" disabled={busy !== null} className="rounded border border-cyan-400/40 px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-200" onClick={() => void act('resume', async () => {
                await json(`/api/foundry/missions/${selected.missionId}/resume`, { method: 'POST' })
              })}>Resume</button>
              {!['COMPLETE', 'CANCELLED', 'FAILED'].includes(selected.status) ? (
                <button type="button" disabled={busy !== null} className="rounded border border-red-400/30 px-3 py-1 text-[10px] uppercase tracking-widest text-red-200" onClick={() => void act('cancel', async () => {
                  await json(`/api/foundry/missions/${selected.missionId}/cancel`, { method: 'POST' })
                })}>Cancel</button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

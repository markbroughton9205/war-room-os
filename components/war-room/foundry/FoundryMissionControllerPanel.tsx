'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FoundryLiveAgentEvents } from './FoundryLiveAgentEvents'
import { FoundryContractVerdictPanel } from './FoundryContractVerdictPanel'
import { FoundryResourceGovernorPanel } from './FoundryResourceGovernorPanel'
import { FoundryMissionRuntimePanel } from './FoundryMissionRuntimePanel'
import { FoundryUnattendedEngineerPanel } from './FoundryUnattendedEngineerPanel'
import type { FoundryContractVerdictView } from '@/lib/native-builder/foundryContractVerdictView.types'

type Mission = {
  missionId: string
  title: string
  userRequest: string
  status: string
  goal: string
  currentStep: string | null
  plan: Array<{ id: string; title: string; status: 'pending' | 'active' | 'done' | 'failed' | 'skipped'; note?: string }>
  observations: Array<{ at: string; text: string; source: string }>
  journal: Array<{ at: string; kind: string; text: string }>
  blocker: { blocker: string; evidence: string; attempted: string; why: string; unblock: string } | null
  authorization: { waiting: boolean; action: string | null; reason: string | null } | null
  modelState?: {
    activeProvider: string | null
    activeModel: string | null
    lastReasoningSummary: string | null
    lastExpectedObservation: string | null
  }
  engineeringReview?: 'PASS' | 'PENDING' | 'FAIL'
  engineeringReviewDetail?: string | null
  planningMode?: boolean
  agentEvents?: Array<{ eventId: string; at: string; type: string; text: string; tool?: string | null; ok?: boolean | null }>
  contractVerdict?: FoundryContractVerdictView | null
  engineeringClass?: string | null
  resourceView?: import('@/lib/native-builder/foundryResourceGovernorTypes').FoundryResourceView | null
  runtimeView?: import('@/lib/native-builder/foundryMissionRuntimeTypes').FoundryRuntimeView | null
  unattendedView?: import('@/lib/native-builder/foundryUnattendedTypes').FoundryUnattendedView | null
  workerRouting?: {
    mode: string
    selectedWorker: string | null
    recommendedWorker?: string | null
    previousWorker?: string | null
    why: string
    capabilityEvidence: string
    policy: string
    fallbackAllowed: boolean
    workerSwitchCount?: number
  } | null
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload
}

export function FoundryMissionControllerPanel() {
  const [request, setRequest] = useState('')
  const [missions, setMissions] = useState<Mission[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Mission | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const listing = await json<{ missions: Mission[] }>(`/api/foundry/missions?limit=20&view=commander`)
    setMissions(listing.missions)
    if (selectedId) {
      const detail = await json<{ mission: Mission }>(`/api/foundry/missions/${selectedId}`)
      setSelected(detail.mission)
    } else {
      setSelected(null)
    }
  }, [selectedId])

  useEffect(() => {
    queueMicrotask(() => {
      void refresh().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
    })
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const run = async (missionId: string) => {
    setBusy('run')
    setError(null)
    try {
      const result = await json<{ mission: Mission }>(`/api/foundry/missions/${missionId}/run`, { method: 'POST' })
      setSelected(result.mission)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
      await refresh().catch(() => undefined)
    }
  }

  const start = async () => {
    if (!request.trim()) return
    setBusy('start')
    setError(null)
    try {
      const result = await json<{ mission: Mission }>('/api/foundry/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: request.trim() }),
      })
      setSelectedId(result.mission.missionId)
      setSelected(result.mission)
      setRequest('')
      void run(result.mission.missionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (!selected) return
    setBusy('cancel')
    try {
      const result = await json<{ mission: Mission }>(`/api/foundry/missions/${selected.missionId}/cancel`, { method: 'POST' })
      setSelected(result.mission)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const authorize = async (approved: boolean) => {
    if (!selected) return
    setBusy('authorization')
    try {
      const result = await json<{ mission: Mission }>(`/api/foundry/missions/${selected.missionId}/authorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          approved,
          expectedSpecVersion: selected.contractVerdict?.specVersion,
          expectedMissionContractHash: selected.contractVerdict?.missionContract.hash,
          expectedAcceptanceContractHash: selected.contractVerdict?.acceptanceContract.hash,
          expectedMissionContractId: selected.contractVerdict?.missionContract.id,
          expectedAcceptanceContractId: selected.contractVerdict?.acceptanceContract.id,
        }),
      })
      setSelected(result.mission)
      if (approved) void run(result.mission.missionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const currentAction = useMemo(() => {
    if (!selected) return 'Waiting for a mission'
    return selected.plan.find(step => step.status === 'active')?.title
      ?? selected.plan.find(step => step.id === selected.currentStep)?.title
      ?? selected.modelState?.lastExpectedObservation
      ?? 'Reasoning about next action'
  }, [selected])
  const latestFinding = selected?.observations.at(-1)?.text
    ?? selected?.modelState?.lastReasoningSummary
    ?? 'No findings yet.'

  return (
    <section className="relative z-20 mx-2 mb-2 rounded-lg border border-emerald-400/25 bg-slate-950/85 p-3" data-testid="foundry-model-mission-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400">Mission details</p>
          <p className="text-[10px] text-slate-500">
            {selected?.modelState?.activeProvider
              ? `${selected.modelState.activeProvider} · ${selected.modelState.activeModel ?? 'model'}`
              : 'Sovereign controller · model selection pending'}
            {selected?.workerRouting ? ` · routing ${selected.workerRouting.mode} · stored policy LOCAL` : ''}
          </p>
          {selected?.workerRouting ? (
            <p className="max-w-xl text-[10px] text-slate-500">
              Selected worker: {selected.workerRouting.selectedWorker ?? 'not applied'}. Recommended worker: {selected.workerRouting.recommendedWorker ?? selected.workerRouting.selectedWorker ?? 'none'}. Previous worker: {selected.workerRouting.previousWorker ?? 'none'}. Why: {selected.workerRouting.why} Policy: {selected.workerRouting.policy}. Fallback allowed: {selected.workerRouting.fallbackAllowed ? 'yes' : 'no'}. Switch count: {selected.workerRouting.workerSwitchCount ?? 0}. Evidence: {selected.workerRouting.capabilityEvidence}
            </p>
          ) : null}
        </div>
        <select
          className="max-w-xs rounded border border-white/10 bg-slate-950 px-2 py-1 text-[10px] text-slate-300"
          value={selectedId ?? ''}
          onChange={event => setSelectedId(event.target.value || null)}
          aria-label="Mission status"
        >
          <option value="">NEW MISSION</option>
          {missions.map(mission => <option key={mission.missionId} value={mission.missionId}>{mission.status} · {mission.title}</option>)}
        </select>
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={request}
          onChange={event => setRequest(event.target.value)}
          placeholder="Tell Foundry the result you want…"
          className="min-h-16 flex-1 rounded border border-emerald-400/20 bg-black/40 p-2 text-sm text-emerald-50 outline-none"
          data-testid="foundry-model-mission-input"
        />
        <button
          type="button"
          onClick={() => void start()}
          disabled={!request.trim() || busy !== null}
          className="rounded border border-emerald-400/40 px-4 text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-40"
        >
          New Mission
        </button>
      </div>

      {error ? <p className="mt-2 rounded border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-200">{error}</p> : null}
      {!selected ? <div className="mt-3"><FoundryLiveAgentEvents missionSelected={false} events={[]} /></div> : null}
      {selected ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-white/10 p-2">
                <p className="text-[9px] uppercase tracking-widest text-slate-500">Status</p>
                <p className="text-sm font-bold text-emerald-200">{selected.status}</p>
              </div>
              <div className="rounded border border-white/10 p-2">
                <p className="text-[9px] uppercase tracking-widest text-slate-500">Current action</p>
                <p className="text-xs text-cyan-100">{currentAction}</p>
              </div>
              <div className="rounded border border-white/10 p-2" data-testid="foundry-engineering-review" aria-label="Engineering review status">
                <p className="text-[9px] uppercase tracking-widest text-slate-500">ENGINEERING REVIEW</p>
<p className="text-sm font-bold text-emerald-200">{selected.engineeringReview ?? 'PENDING'}</p>
{selected.engineeringReviewDetail ? <p className="text-xs text-slate-200 whitespace-pre-wrap">{selected.engineeringReviewDetail}</p> : null}
              </div>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Current goal</p>
              <p className="text-xs text-slate-200">{selected.goal}</p>
            </div>
            <div className="rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Latest finding</p>
              <p className="line-clamp-3 text-xs text-amber-100">{latestFinding}</p>
            </div>
            {selected.planningMode ? <p className="text-[10px] text-amber-200">PLANNING MODE · mutations suppressed</p> : null}
            <FoundryContractVerdictPanel
              view={selected.contractVerdict}
              showApprovalCopy={Boolean(selected.authorization?.waiting && selected.authorization.action === 'ENTER_EXECUTION' && selected.contractVerdict && !selected.contractVerdict.legacy)}
              onApproveExecution={selected.authorization?.waiting && selected.authorization.action === 'ENTER_EXECUTION' ? () => void authorize(true) : undefined}
            />
            <FoundryMissionRuntimePanel view={selected.runtimeView} />
            <FoundryUnattendedEngineerPanel view={selected.unattendedView} />
            <FoundryResourceGovernorPanel view={selected.resourceView} />
            <FoundryLiveAgentEvents missionSelected events={selected.agentEvents ?? []} />
            <ol className="space-y-1 rounded border border-white/10 p-2">
              <p className="text-[9px] uppercase tracking-widest text-slate-500">Plan</p>
              {selected.plan.map(step => (
                <li key={step.id} className="text-xs text-slate-300">
                  <span className={step.status === 'done' ? 'text-emerald-400' : step.status === 'active' ? 'text-cyan-300' : step.status === 'failed' ? 'text-red-300' : 'text-slate-600'}>
                    {step.status === 'done' ? '✓' : step.status === 'active' ? '→' : step.status === 'failed' ? '!' : '○'}
                  </span>{' '}
                  {step.title}
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-2">
            {selected.authorization?.waiting ? (
              <div className="rounded border border-amber-400/40 bg-amber-950/20 p-3" data-testid="foundry-authorization-request">
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300">Authorization request</p>
                <p className="mt-1 text-xs text-amber-100">Action: {selected.authorization.action}</p>
                <p className="text-xs text-slate-300">Why: {selected.authorization.reason}</p>
                <p className="text-xs text-slate-300">Target: current mission and requested boundary action</p>
                <p className="text-xs text-slate-300">Impact: mission remains paused until this request is resolved</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void authorize(true)} className="rounded border border-emerald-400/40 px-3 py-1 text-[10px] text-emerald-200">Approve</button>
                  <button type="button" onClick={() => void authorize(false)} className="rounded border border-red-400/40 px-3 py-1 text-[10px] text-red-200">Deny</button>
                </div>
              </div>
            ) : null}
            {selected.blocker ? (
              <div className="rounded border border-red-400/30 bg-red-950/20 p-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-red-300">Current blocker</p>
                <p className="mt-1 text-xs text-red-100">{selected.blocker.blocker}</p>
                <p className="mt-1 text-[10px] text-slate-400">{selected.blocker.unblock}</p>
              </div>
            ) : null}
            <div className="max-h-52 overflow-auto rounded border border-white/10 p-2">
              <p className="sticky top-0 bg-slate-950 text-[9px] uppercase tracking-widest text-slate-500">Mission journal</p>
              {selected.journal.slice(-12).reverse().map((entry, index) => (
                <p key={`${entry.at}-${index}`} className="border-b border-white/5 py-1 text-[10px] text-slate-400">
                  <span className="text-emerald-500">{entry.kind}</span> {entry.text}
                </p>
              ))}
            </div>
            <div className="flex gap-2">
              {selected.status === 'BLOCKED' && !selected.authorization?.waiting ? (
                <button type="button" onClick={() => void run(selected.missionId)} disabled={busy !== null} className="rounded border border-cyan-400/40 px-3 py-1 text-[10px] uppercase tracking-widest text-cyan-200">Resume</button>
              ) : null}
              {!['COMPLETE', 'CANCELLED', 'FAILED'].includes(selected.status) ? (
                <button type="button" onClick={() => void cancel()} disabled={busy !== null} className="rounded border border-red-400/30 px-3 py-1 text-[10px] uppercase tracking-widest text-red-200">Cancel</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

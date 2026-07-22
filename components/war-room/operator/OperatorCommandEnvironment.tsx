'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Mission } from '@/lib/missions/types'
import type { PriorityActionCandidate, PriorityEngineSnapshot } from '@/lib/priority-engine/types'
import type { RuntimeGraphNode, SourceBackedMetric } from '@/lib/runtime-graph/types'
import { RuntimeStateNotice } from '@/components/war-room/runtime/RuntimeStateNotice'
import { approvalsRuntimePresentation, emptySectionPresentation, type RuntimeStatePresentation } from '@/lib/runtime/runtimeStatePresentation'

type OperatorCommandEnvironmentProps = {
  version: string
  sessionIndicators: ReactNode
  onOpenEngineering: () => void
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unavailable'
}

function toneFor(value: string): string {
  if (/healthy|connected|active|source_backed|verified|rising|approved/i.test(value)) return '#34D399'
  if (/degraded|paused|pending|at_trigger|stable|unknown/i.test(value)) return '#FBBF24'
  if (/blocked|unavailable|decaying|rejected|error/i.test(value)) return '#F87171'
  return '#94A3B8'
}

function Badge({ value }: { value: string }) {
  const color = toneFor(value)
  return (
    <span className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ border: `1px solid ${color}55`, color, background: 'rgba(0,0,0,0.35)' }}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-slate-500">
      {children}
    </div>
  )
}

function Metric({ metric }: { metric: SourceBackedMetric }) {
  const available = metric.classification === 'SOURCE_BACKED' && metric.value
  return (
    <div className="rounded border border-white/10 bg-black/25 p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{metric.label}</div>
      <div className="mt-1 font-mono text-sm" style={{ color: available ? '#D1FAE5' : '#64748B' }}>{available ? metric.value : 'Unavailable'}</div>
      <div className="mt-2 text-[9px] leading-relaxed" style={{ color: available ? '#86EFAC' : '#64748B' }}>
        {available ? metric.source : 'Requires SOURCE_BACKED financial evidence.'}
      </div>
    </div>
  )
}

function MissionControl({
  missions,
  focusedMissionId,
  onFocus,
  onIntent,
}: {
  missions: Mission[]
  focusedMissionId: string | null
  onFocus: (id: string) => void
  onIntent: (message: string) => void
}) {
  return (
    <aside className="rounded border border-emerald-500/20 bg-black/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Mission Control</div>
          <p className="mt-1 text-[9px] text-slate-500">Persistent missions only.</p>
        </div>
        <button type="button" onClick={() => onIntent('New mission request captured as UI intent only; no mission was created.')} className="rounded border border-emerald-300/30 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-200">
          New Mission
        </button>
      </div>
      <div className="space-y-2">
        {missions.map(mission => {
          const focused = focusedMissionId === mission.id
          const progress = Math.max(0, Math.min(100, Math.round((mission.priority_score + mission.momentum_score + mission.compounding_score - mission.blocker_score) / 3)))
          return (
            <button key={mission.id} type="button" onClick={() => onFocus(mission.id)} className="w-full rounded border p-3 text-left" style={{ borderColor: focused ? 'rgba(52,211,153,0.55)' : 'rgba(255,255,255,0.08)', background: focused ? 'rgba(52,211,153,0.08)' : 'rgba(0,0,0,0.2)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-slate-100">{mission.title}</div>
                <Badge value={mission.status} />
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10">
                <div className="h-full rounded bg-emerald-300" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] text-slate-500">
                <span>Metric: revenue {mission.revenue_score}</span>
                <span>Momentum: {mission.momentum_score}</span>
                <span>Updated: {formatDateTime(mission.updated_at)}</span>
                <span>Blocker: {mission.blocker_score ? `${mission.blocker_score}` : 'clear'}</span>
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function ActionCard({ action, onIntent }: { action: PriorityActionCandidate; onIntent: (message: string) => void }) {
  return (
    <article className="rounded border border-yellow-500/25 bg-yellow-500/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-yellow-50">{action.title}</h3>
          <p className="mt-1 text-[10px] text-slate-500">{action.evidence.slice(0, 2).join(' · ')}</p>
        </div>
        <Badge value={action.approvalState} />
      </div>
      <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-4">
        <span className="rounded border border-white/10 px-2 py-1 text-slate-300">Value: {action.estimatedValue}</span>
        <span className="rounded border border-white/10 px-2 py-1 text-slate-300">Time: {action.estimatedTime}</span>
        <span className="rounded border border-white/10 px-2 py-1 text-slate-300">Mission: {action.linkedMission.replace(/-/g, ' ')}</span>
        <span className="rounded border border-white/10 px-2 py-1 text-slate-300">Confidence: {action.confidence}%</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onIntent(`Completion log intent captured for "${action.title}". No automatic outcome write performed.`)} className="rounded border border-emerald-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200">Mark Complete + Log</button>
        <button type="button" onClick={() => onIntent(`Skip intent captured for "${action.title}". No queue mutation performed.`)} className="rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300">Skip</button>
      </div>
    </article>
  )
}

function packetHealthExplanation(packet: RuntimeGraphNode): string | null {
  if (packet.health === 'unknown') return 'No verified health result has been recorded for this runtime item yet.'
  if (packet.health === 'unavailable') return 'The runtime source required to verify this item is currently unavailable.'
  return null
}

function PacketFeed({ nodes, onIntent, runtimePresentation }: { nodes: RuntimeGraphNode[]; onIntent: (message: string) => void; runtimePresentation: RuntimeStatePresentation }) {
  const packets = nodes.filter(node => ['revenue', 'mission', 'subsystem', 'approval'].includes(node.kind)).slice(0, 8)
  if (!packets.length) return <RuntimeStateNotice presentation={emptySectionPresentation(runtimePresentation, 'active approval packets')} compact />
  return (
    <div className="space-y-2">
      {packets.map(packet => (
        <article key={packet.id} className="rounded border border-white/10 bg-black/25 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-100">{packet.label}</div>
              <div className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">{packet.kind} · {packet.status}</div>
            </div>
            <Badge value={packet.health} />
          </div>
          {packetHealthExplanation(packet) ? <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{packetHealthExplanation(packet)}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {['approve', 'reject', 'modify', 'archive'].map(action => (
              <button key={action} type="button" onClick={() => onIntent(`${action} intent captured for ${packet.label}; no packet mutation performed.`)} className="rounded border border-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {action}
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

export function OperatorCommandEnvironment({ version, sessionIndicators, onOpenEngineering }: OperatorCommandEnvironmentProps) {
  const [snapshot, setSnapshot] = useState<PriorityEngineSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const [focusedMissionId, setFocusedMissionId] = useState<string | null>(null)
  const [intentMessage, setIntentMessage] = useState<string | null>(null)
  const [quickDecree, setQuickDecree] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/priority', { cache: 'no-store' })
      const body = await res.json() as PriorityEngineSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Priority engine unavailable')
      setSnapshot(body)
      setFocusedMissionId(current => current ?? body.graph.missions[0]?.id ?? null)
    } catch {
      setError('The priority and approval status request did not complete.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const providerSummary = useMemo(() => {
    const providers = snapshot?.graph.providers ?? []
    if (!providers.length) return 'providers unavailable'
    const connected = providers.filter(provider => provider.connected).length
    return `${connected}/${providers.length} connected`
  }, [snapshot?.graph.providers])

  const truthLayerStatus = snapshot?.graph.guardrails.noFakeTelemetry ? 'truthful telemetry' : 'unknown'
  const runtimeStatus = snapshot?.graph.derived.blockedSystems.length ? 'degraded' : snapshot ? 'active' : 'loading'
  const actions = snapshot?.actionQueue ?? []
  const graph = snapshot?.graph
  const runtimePresentation = approvalsRuntimePresentation({
    loading,
    requestFailed: Boolean(error),
    hasSnapshot: Boolean(snapshot),
    configurationPresent: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    persistenceAvailable: snapshot ? true : undefined,
    actionCount: actions.length,
    generatedAt: snapshot?.generatedAt,
  })

  return (
    <section className="mx-4 mt-4 rounded border border-emerald-500/25 bg-slate-950/70 p-4 shadow-2xl shadow-emerald-950/20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 bg-black/35 px-3 py-2">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.35em] text-yellow-300">War Room OS</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-500">
            <span>v{version}</span>
            <span>{formatTime(clock)}</span>
            <span>runtime: <span style={{ color: toneFor(runtimeStatus) }}>{runtimeStatus}</span></span>
            <span>providers: {providerSummary}</span>
            <span>truth: {truthLayerStatus}</span>
          </div>
          {sessionIndicators}
        </div>
        <div className="flex min-w-[18rem] flex-col gap-2">
          <div className="text-right text-[10px] font-bold uppercase tracking-widest text-emerald-200">Ra&apos;el - Human in Command</div>
          <form onSubmit={event => {
            event.preventDefault()
            setIntentMessage(quickDecree.trim() ? `Quick decree captured locally: "${quickDecree.trim()}". Submit through Live Council to execute workflow.` : 'Quick decree requires text.')
            setQuickDecree('')
          }} className="flex gap-2">
            <input value={quickDecree} onChange={event => setQuickDecree(event.target.value)} placeholder="Quick decree intent..." className="min-w-0 flex-1 rounded border border-white/10 bg-black px-2 py-1 text-xs text-slate-200 outline-none" />
            <button type="submit" className="rounded border border-yellow-300/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-yellow-200">Capture</button>
          </form>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
      {intentMessage ? <div className="mb-3 rounded border border-sky-400/30 bg-sky-400/10 p-3 text-xs text-sky-100">{intentMessage}</div> : null}
      <div className="mb-3"><RuntimeStateNotice presentation={runtimePresentation} /></div>

      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        <MissionControl missions={graph?.missions ?? []} focusedMissionId={focusedMissionId} onFocus={setFocusedMissionId} onIntent={setIntentMessage} />

        <div className="space-y-4">
          <section className="rounded border border-yellow-500/25 bg-black/30 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-300">Today Action Queue</div>
                <p className="mt-1 text-[10px] text-slate-500">2-4 derived actions only. Empty means no truthful candidate was found.</p>
              </div>
              <button type="button" onClick={() => void load()} disabled={loading} className="rounded border border-yellow-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-yellow-200 disabled:opacity-50">
                {loading ? 'Refreshing...' : 'Request Better Queue'}
              </button>
            </div>
            {actions.length ? (
              <div className="space-y-2">
                {actions.map(action => <ActionCard key={action.id} action={action} onIntent={setIntentMessage} />)}
              </div>
            ) : (
              <RuntimeStateNotice presentation={emptySectionPresentation(runtimePresentation, 'source-backed approval actions')} compact />
            )}
          </section>

          <section className="rounded border border-emerald-500/20 bg-black/30 p-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-emerald-300">Live Financial Telemetry</div>
            <div className="grid gap-2 md:grid-cols-3">
              {graph ? Object.values(graph.financialTelemetry).map(metric => <Metric key={metric.label} metric={metric} />) : <EmptyState>Financial telemetry loading.</EmptyState>}
            </div>
          </section>

          <section className="rounded border border-sky-500/20 bg-black/30 p-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-sky-300">Active Packet Feed</div>
            <PacketFeed nodes={graph?.nodes ?? []} onIntent={setIntentMessage} runtimePresentation={runtimePresentation} />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded border border-fuchsia-500/20 bg-black/35 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Provider Runtime</div>
                <p className="mt-1 text-[9px] text-slate-500">Sanitized server status only.</p>
              </div>
              <button type="button" onClick={onOpenEngineering} className="rounded border border-fuchsia-300/30 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-fuchsia-200">Engineering</button>
            </div>
            <div className="space-y-2">
              {(graph?.providers ?? []).map(provider => (
                <article key={provider.family} className="rounded border border-white/10 bg-black/25 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-100">{provider.label}</div>
                      <div className="mt-1 text-[9px] uppercase tracking-widest text-slate-500">{provider.providerId}</div>
                    </div>
                    <Badge value={provider.health} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] text-slate-500">
                    <span>Latency: {provider.connected ? 'not measured' : 'not measured — provider unavailable'}</span>
                    <span>Last: {formatDateTime(provider.lastChecked)}</span>
                    <span>Model: {provider.providerId}</span>
                    <span>Class: {provider.availability}</span>
                    <span>Signal: {provider.connected ? 'ready' : 'not ready'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {['invoke provider', 'request packet', 'investigate'].map(action => (
                      <button key={action} type="button" onClick={() => setIntentMessage(`${action} intent captured for ${provider.label}; no provider call performed.`)} className="rounded border border-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        {action}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
              {!graph?.providers.length ? <RuntimeStateNotice presentation={emptySectionPresentation(runtimePresentation, 'provider runtime records')} compact /> : null}
            </div>
          </section>

          <section className="rounded border border-white/10 bg-black/35 p-3 text-[10px] text-slate-400">
            <div className="mb-2 font-bold uppercase tracking-widest text-slate-300">Runtime Pressure</div>
            <div className="grid grid-cols-2 gap-2">
              <span>Pressure: {graph?.derived.operationalPressure ?? '-'}</span>
              <span>Fragmentation: {graph?.derived.focusFragmentation ?? '-'}</span>
              <span>Decay: {graph?.derived.missionDecay ?? '-'}</span>
              <span>Overload: {graph?.derived.overloadRisk ?? '-'}</span>
            </div>
          </section>
        </aside>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/35 px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500">
        <button type="button" onClick={() => setIntentMessage('Weekly summary packet intent captured; no packet generated automatically.')}>Weekly summary packet</button>
        <button type="button" onClick={() => setIntentMessage('Mission logs intent captured; no log mutation performed.')}>Mission logs</button>
        <button type="button" onClick={onOpenEngineering}>Breach monitor</button>
        <button type="button" onClick={onOpenEngineering}>Settings</button>
        <button type="button" onClick={() => setIntentMessage('Manual alert trigger intent captured; no alert was sent automatically.')} className="text-red-300">Manual alert trigger</button>
      </div>
    </section>
  )
}

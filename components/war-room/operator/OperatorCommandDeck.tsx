'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OperatorAction, OperatorDeckSnapshot, OperatorPacketSummary, OperatorTruthLabel } from '@/lib/operator/deckTypes'
import { ActionQueueMini } from './ActionQueueMini'
import { ApprovalIssuancePanel } from './ApprovalIssuancePanel'
import { AppleReminderLiveBridgePanel } from './AppleReminderLiveBridgePanel'
import { FinancialTelemetryMini } from './FinancialTelemetryMini'
import { MissionStatusStrip } from './MissionStatusStrip'
import { QuickActionBar } from './QuickActionBar'

const LogEarningsModal = dynamic(() => import('./LogEarningsModal'), { ssr: false })

function emptySnapshot(): OperatorDeckSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    persistenceAvailable: false,
    realtimeAvailable: false,
    stateLabel: 'UNAVAILABLE',
    actionQueue: [],
    financialTelemetry: [],
    missions: [],
    packets: [],
    lastPacket: null,
    recentActivity: [],
    integrations: {
      liveCouncil: 'UNAVAILABLE',
      babyAiObserver: 'UNAVAILABLE',
      revenueEngine: 'UNAVAILABLE',
      signalRadar: 'UNAVAILABLE',
      growthCalendar: 'UNAVAILABLE',
      outcomeLedger: 'UNAVAILABLE',
      commanderOs: 'UNAVAILABLE',
      approvalQueue: 'UNAVAILABLE',
    },
    guardrails: {
      noFakeEarnings: true,
      noFakeBalances: true,
      noHiddenActions: true,
      noAutonomousSpending: true,
      noAutomaticEmailSending: true,
      commanderApprovalRequired: true,
    },
  }
}

function integrationDetail(key: string, value: string): string {
  if (value !== 'UNAVAILABLE') return `${labelFromKey(key)} is backed by current War Room state.`
  const details: Record<string, string> = {
    liveCouncil: 'Missing dependency: a successful Live Council runtime state in the operator snapshot.',
    babyAiObserver: 'Missing dependency: Baby AI operational snapshot or approved learning state surfaced to the operator deck.',
    revenueEngine: 'Missing dependency: runtime graph revenue nodes from real opportunities or outcomes.',
    signalRadar: 'Missing dependency: source-backed Signal Radar nodes from configured sources and accepted scan results.',
    growthCalendar: 'Missing dependency: source-backed growth calendar recommendations connected to the operator deck.',
    outcomeLedger: 'Missing dependency: confirmed Outcome Ledger rows.',
    commanderOs: 'Missing dependency: Commander OS runtime snapshot connected to this deck.',
    approvalQueue: 'Missing dependency: pending approval nodes from the runtime graph or action queue.',
  }
  return details[key] ?? 'Missing dependency: no source-backed state reached this operator deck field.'
}

function labelFromKey(key: string) {
  return key.replace(/([A-Z])/g, ' $1').toLowerCase()
}

function Pill({ id, value }: { id: string; value: string }) {
  const unavailable = value === 'UNAVAILABLE'
  return (
    <span
      className={unavailable ? 'rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-500' : 'rounded border border-emerald-300/25 px-2 py-1 text-[9px] uppercase tracking-widest text-emerald-200'}
      title={integrationDetail(id, value)}
    >
      {labelFromKey(id)}: {value.replace(/_/g, ' ')}
    </span>
  )
}

function TruthBadge({ value }: { value: OperatorTruthLabel | string }) {
  const tone = /source|manual|approved|completed/i.test(value)
    ? 'border-emerald-300/30 text-emerald-200'
    : /approval|required|proposed|pending|drafted/i.test(value)
      ? 'border-yellow-300/30 text-yellow-200'
      : /unavailable|blocked|violation/i.test(value)
        ? 'border-red-300/30 text-red-200'
        : 'border-white/15 text-slate-300'
  return (
    <span className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest ${tone}`}>
      {value.replace(/_/g, ' ')}
    </span>
  )
}

const unsupportedPacketActionReason =
  'Not wired: the current `war_room_operator_packets` schema only supports pending, drafted, approved, and completed states. Add a reviewed schema/route expansion before reject, modify, or archive can be real.'

function PacketFeed({
  packets,
  loading,
  onApprove,
}: {
  packets: OperatorPacketSummary[]
  loading: boolean
  onApprove: (packet: OperatorPacketSummary) => void
}) {
  return (
    <section className="rounded border border-cyan-500/20 bg-cyan-500/[0.035] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-300">Approval Packet Feed</div>
          <p className="mt-1 text-[10px] text-slate-500">
            Real rows from `war_room_operator_packets`. Approval records acceptance only; no external action, email, or automation is performed.
          </p>
        </div>
        <TruthBadge value={packets.length ? 'SOURCE_BACKED' : 'UNAVAILABLE'} />
      </div>
      {packets.length ? (
        <div className="grid gap-2">
          {packets.map(packet => (
            <article key={packet.id} className="rounded border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100">{packet.title}</h3>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {packet.packetType.replace(/_/g, ' ')} · {new Date(packet.createdAt).toLocaleString()}
                    {packet.recipient ? ` · recipient: ${packet.recipient}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <TruthBadge value={packet.status} />
                  <TruthBadge value={packet.truthLabel} />
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-300">{packet.proposedEffect}</p>
              <div className="mt-3 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-2">
                <span className="rounded border border-white/10 bg-black/25 p-2">{packet.approvalRequirement}</span>
                <span className="rounded border border-white/10 bg-black/25 p-2">{packet.executionRelationship}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onApprove(packet)}
                  disabled={loading || packet.status === 'approved' || packet.status === 'completed'}
                  className="rounded border border-emerald-300/35 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-45"
                >
                  {packet.status === 'approved' ? 'Approved' : 'Approve'}
                </button>
                {['Modify', 'Reject', 'Archive'].map(label => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    title={unsupportedPacketActionReason}
                    className="rounded border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-slate-600">{unsupportedPacketActionReason}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-slate-500">
          No source-backed approval packets exist. Missing dependency: a row in `war_room_operator_packets` from a queue refresh, manual email draft, council proposal, or approval packet creator. No packet state is fabricated.
        </div>
      )}
    </section>
  )
}

export const OperatorCommandDeck = memo(function OperatorCommandDeck({ signalRadarSlot }: { signalRadarSlot?: ReactNode }) {
  const [snapshot, setSnapshot] = useState<OperatorDeckSnapshot>(() => emptySnapshot())
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [modalAction, setModalAction] = useState<OperatorAction | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [deckRes, queueRes] = await Promise.all([
        fetch('/api/operator/deck', { cache: 'no-store' }),
        fetch('/api/operator/queue', { cache: 'no-store' }),
      ])
      const body = await deckRes.json() as OperatorDeckSnapshot
      const queueBody = await queueRes.json() as { actions?: OperatorAction[] }
      if (deckRes.ok) setSnapshot({ ...body, actionQueue: queueRes.ok ? queueBody.actions ?? [] : [] })
      else setSnapshot(emptySnapshot())
    } catch {
      setSnapshot(emptySnapshot())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return
    let active = true
    let channel: { unsubscribe: () => void } | null = null
    void import('@/lib/supabase').then(({ supabase }) => {
      if (!active) return
      channel = supabase
        .channel('operator-command-deck')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'war_room_operator_actions' }, () => void load())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'war_room_operator_earnings' }, () => void load())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'war_room_operator_packets' }, () => void load())
        .subscribe()
    }).catch(() => {
      channel = null
    })
    return () => {
      active = false
      channel?.unsubscribe()
    }
  }, [load])

  const unavailableIntegrations = useMemo(
    () => Object.entries(snapshot.integrations).filter(([, value]) => value === 'UNAVAILABLE'),
    [snapshot.integrations],
  )

  const integrationPills = useMemo(() => Object.entries(snapshot.integrations).map(([key, value]) => (
    <Pill key={key} id={key} value={value} />
  )), [snapshot.integrations])

  const postCommand = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true)
    setNotice(null)
    try {
      const res = await fetch('/api/operator/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json() as { ok?: boolean; message?: string; snapshot?: OperatorDeckSnapshot }
      if (body.snapshot) setSnapshot(body.snapshot)
      setNotice(body.message ?? (res.ok ? 'Operator command recorded.' : 'Operator command could not be recorded.'))
    } catch {
      setNotice('Operator command could not be recorded.')
    } finally {
      setLoading(false)
    }
  }, [])

  const requestBetterQueue = useCallback(() => {
    void postCommand({ command: 'request_better_queue' })
  }, [postCommand])

  const skipAction = useCallback((action: OperatorAction) => {
    const reason = window.prompt('Optional skip reason. Leave blank to skip without a reason.') ?? ''
    void postCommand({ command: 'skip', actionId: action.id, reason: reason.trim() || null })
  }, [postCommand])

  const approveLastPacket = useCallback(() => {
    if (!window.confirm('Approve the last operator packet? This records approval only and performs no external action.')) return
    void postCommand({ command: 'approve_last_packet', confirmed: true })
  }, [postCommand])

  const approvePacket = useCallback((packet: OperatorPacketSummary) => {
    if (!window.confirm(`Approve packet "${packet.title}"? This records approval only and performs no external action.`)) return
    void postCommand({ command: 'approve_packet', packetId: packet.id, confirmed: true })
  }, [postCommand])

  const manualEmailAlert = useCallback(() => {
    if (!window.confirm('Create a manual email alert draft? No email will be sent.')) return
    void postCommand({
      command: 'manual_email_alert',
      subject: 'Manual War Room alert draft',
      body: 'Draft created by Commander confirmation. Review and send manually outside War Room.',
      confirmed: true,
    })
  }, [postCommand])

  return (
    <section className="mx-4 mb-6 mt-4 rounded border border-emerald-400/25 bg-slate-950/85 p-3 shadow-2xl shadow-emerald-950/25">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 bg-black/35 px-3 py-2">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.35em] text-emerald-300">Operator Command Deck</div>
          <p className="mt-1 text-[10px] text-slate-500">Phase 24 daily command flow. Propose, approve, log, and learn with no hidden execution.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{integrationPills}</div>
          {unavailableIntegrations.length ? (
            <div className="mt-2 rounded border border-white/10 bg-black/25 p-2 text-[10px] leading-relaxed text-slate-500">
              Unavailable integrations are not simulated. {unavailableIntegrations.slice(0, 3).map(([key, value]) => integrationDetail(key, value)).join(' ')}
              {unavailableIntegrations.length > 3 ? ' Additional unavailable integrations are listed in the pills above.' : ''}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-yellow-300/30 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-yellow-200">
            {snapshot.stateLabel.replace(/_/g, ' ')}
          </span>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50">
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <button type="button" onClick={() => setCollapsed(value => !value)} className="rounded border border-emerald-300/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200">
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </header>

      {notice ? <div className="mt-3 rounded border border-sky-300/25 bg-sky-500/10 p-2 text-xs text-sky-100">{notice}</div> : null}

      {collapsed ? (
        <div className="mt-3 grid gap-2 text-[10px] text-slate-400 sm:grid-cols-4">
          <span className="rounded border border-white/10 bg-black/25 p-2">Actions: {snapshot.actionQueue.length}</span>
          <span className="rounded border border-white/10 bg-black/25 p-2">Missions: {snapshot.missions.length}</span>
          <span className="rounded border border-white/10 bg-black/25 p-2">Packet: {snapshot.lastPacket?.status ?? 'none'}</span>
          <span className="rounded border border-white/10 bg-black/25 p-2">Updated: {new Date(snapshot.generatedAt).toLocaleTimeString()}</span>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <PacketFeed packets={snapshot.packets} loading={loading} onApprove={approvePacket} />
          <ActionQueueMini
            actions={snapshot.actionQueue}
            loading={loading}
            onComplete={setModalAction}
            onSkip={skipAction}
            onRequestBetterQueue={requestBetterQueue}
          />
          {signalRadarSlot}
          <FinancialTelemetryMini metrics={snapshot.financialTelemetry} />
          <MissionStatusStrip missions={snapshot.missions} />
          <ApprovalIssuancePanel />
          <AppleReminderLiveBridgePanel />
          <QuickActionBar
            loading={loading}
            onLogEarnings={() => setModalAction(null)}
            onRequestQueue={requestBetterQueue}
            onApprovePacket={approveLastPacket}
            onManualEmailAlert={manualEmailAlert}
          />
          <div className="rounded border border-white/10 bg-black/25 p-3 text-[10px] text-slate-500">
            Recent activity: {snapshot.recentActivity.length ? snapshot.recentActivity.map(item => `${item.summary} (${item.truthLabel})`).join(' | ') : 'Not logged yet'}
          </div>
        </div>
      )}

      {modalAction !== undefined ? (
        <LogEarningsModal
          action={modalAction}
          missions={snapshot.missions}
          onClose={() => setModalAction(undefined)}
          onLogged={(nextSnapshot, message) => {
            if (nextSnapshot) setSnapshot(nextSnapshot)
            setNotice(message)
          }}
        />
      ) : null}
    </section>
  )
})

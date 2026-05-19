'use client'

import dynamic from 'next/dynamic'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { OperatorAction, OperatorDeckSnapshot } from '@/lib/operator/deckTypes'
import { ActionQueueMini } from './ActionQueueMini'
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

function Pill({ label, value }: { label: string; value: string }) {
  const unavailable = value === 'UNAVAILABLE'
  return (
    <span className={unavailable ? 'rounded border border-white/10 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-500' : 'rounded border border-emerald-300/25 px-2 py-1 text-[9px] uppercase tracking-widest text-emerald-200'}>
      {label}: {value.replace(/_/g, ' ')}
    </span>
  )
}

export const OperatorCommandDeck = memo(function OperatorCommandDeck() {
  const [snapshot, setSnapshot] = useState<OperatorDeckSnapshot>(() => emptySnapshot())
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [modalAction, setModalAction] = useState<OperatorAction | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/operator/deck', { cache: 'no-store' })
      const body = await res.json() as OperatorDeckSnapshot
      if (res.ok) setSnapshot(body)
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

  const integrationPills = useMemo(() => Object.entries(snapshot.integrations).map(([key, value]) => (
    <Pill key={key} label={key.replace(/([A-Z])/g, ' $1').toLowerCase()} value={value} />
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
          <ActionQueueMini
            actions={snapshot.actionQueue}
            loading={loading}
            onComplete={setModalAction}
            onSkip={skipAction}
            onRequestBetterQueue={requestBetterQueue}
          />
          <FinancialTelemetryMini metrics={snapshot.financialTelemetry} />
          <MissionStatusStrip missions={snapshot.missions} />
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

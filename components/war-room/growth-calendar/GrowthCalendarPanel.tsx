'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  GrowthCalendarEvent,
  GrowthCalendarRecommendation,
  GrowthCalendarReview,
  GrowthCalendarSnapshot,
} from '@/lib/growth-calendar/model'

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/-/g, ' ')
}

function colorFor(value: string) {
  if (value.includes('overload') || value.includes('rejected') || value.includes('warning')) return '#F87171'
  if (value.includes('proposed') || value.includes('watch') || value.includes('review')) return '#FBBF24'
  if (value.includes('planned') || value.includes('approved') || value.includes('converted')) return '#34D399'
  return '#94A3B8'
}

function Badge({ value }: { value: string }) {
  const color = colorFor(value)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label(value)}
    </span>
  )
}

function MiniMetric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{metricLabel}</div>
      <div className="mt-1 font-mono text-sm text-fuchsia-200">{value}</div>
    </div>
  )
}

function ScoreBar({ label: scoreLabel, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-[9px] text-slate-500">
        <span>{scoreLabel}</span>
        <span>{bounded}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-fuchsia-300" style={{ width: `${bounded}%` }} />
      </div>
    </div>
  )
}

function RecommendationCard({
  recommendation,
  approving,
  onApprove,
}: {
  recommendation: GrowthCalendarRecommendation
  approving: boolean
  onApprove: (recommendation: GrowthCalendarRecommendation) => void
}) {
  return (
    <article className="rounded border border-white/10 bg-slate-950/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-white">{recommendation.title}</h4>
            <Badge value={recommendation.eventType} />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {label(recommendation.source)} · {label(recommendation.assignedFamily)} · {recommendation.recommendedDurationMinutes} min
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge value={recommendation.status} />
          <Badge value="approval_required" />
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{recommendation.description}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="Leverage" value={String(Math.round(recommendation.score.leverageScore))} />
        <MiniMetric label="Urgency" value={String(Math.round(recommendation.score.urgencyScore))} />
        <MiniMetric label="Income" value={String(Math.round(recommendation.score.incomePotential))} />
        <MiniMetric label="Window" value={recommendation.recommendedTimeWindow} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreBar label="Energy cost" value={recommendation.score.energyCost} />
        <ScoreBar label="Family impact" value={recommendation.score.familyImpact} />
        <ScoreBar label="Deadline pressure" value={recommendation.score.deadlinePressure} />
        <ScoreBar label="Compounding value" value={recommendation.score.compoundingValue} />
      </div>
      <div className="mt-3 rounded border border-fuchsia-400/20 bg-fuchsia-400/5 p-2 text-[10px] leading-relaxed text-fuchsia-100">
        Council reason: {recommendation.reason}
      </div>
      <button
        type="button"
        onClick={() => onApprove(recommendation)}
        disabled={approving || recommendation.status !== 'proposed'}
        className="mt-3 rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-200 disabled:opacity-50"
      >
        {approving ? 'Saving...' : recommendation.status === 'proposed' ? 'Approve internal event' : 'Already handled'}
      </button>
    </article>
  )
}

function CompactList({
  title,
  items,
  empty,
}: {
  title: string
  items: Array<{ id: string; title: string; detail: string; badge?: string }>
  empty: string
}) {
  return (
    <section className="rounded border border-white/10 bg-black/25 p-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{title}</h3>
      <div className="mt-2 space-y-2">
        {items.length ? items.map(item => (
          <div key={item.id} className="rounded border border-white/10 p-2 text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-200">{item.title}</span>
              {item.badge ? <Badge value={item.badge} /> : null}
            </div>
            <p className="mt-1 leading-relaxed text-slate-500">{item.detail}</p>
          </div>
        )) : <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">{empty}</div>}
      </div>
    </section>
  )
}

function eventDetail(event: GrowthCalendarEvent) {
  const planned = event.plannedStart ? new Date(event.plannedStart).toLocaleString() : 'Commander-selected time window'
  return `${planned} · ${event.durationMinutes} min · external calendar write: ${event.externalCalendarWrite ? 'yes' : 'no'}`
}

function reviewDetail(review: GrowthCalendarReview) {
  return `${review.summary} Assigned: ${label(review.assignedFamily)}.`
}

export function GrowthCalendarPanel() {
  const [snapshot, setSnapshot] = useState<GrowthCalendarSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/growth-calendar', { cache: 'no-store' })
      const body = await res.json() as GrowthCalendarSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Growth calendar snapshot failed')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Growth calendar snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const approveRecommendation = async (recommendation: GrowthCalendarRecommendation) => {
    if (approvingId) return
    setApprovingId(recommendation.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/growth-calendar/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recommendation,
          recommendationId: recommendation.id,
          title: recommendation.title,
          eventType: recommendation.eventType,
          durationMinutes: recommendation.recommendedDurationMinutes,
          commanderApproved: true,
          approvalNote: 'Commander approved from Growth Calendar panel.',
        }),
      })
      const body = await res.json() as { persistenceNote?: string; error?: string }
      if (!res.ok) throw new Error(body.error || 'Growth calendar event approval failed')
      setNotice(body.persistenceNote ?? 'Internal planned event saved. No external calendar write occurred.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Growth calendar event approval failed')
    } finally {
      setApprovingId(null)
    }
  }

  const recommendations = useMemo(() => snapshot?.recommendations ?? [], [snapshot?.recommendations])
  const incomeFirst = useMemo(
    () => recommendations.filter(item => ['income_action', 'opportunity_follow_up', 'freight_logistics_outreach', 'business_development'].includes(item.eventType)).slice(0, 4),
    [recommendations],
  )
  const buildSessions = useMemo(
    () => recommendations.filter(item => ['feature_build_session', 'war_room_maintenance', 'deep_work_block'].includes(item.eventType)).slice(0, 4),
    [recommendations],
  )
  const recoveryAlerts = useMemo(
    () => (snapshot?.alerts ?? []).filter(item => item.reviewType === 'family_balance' || item.reviewType === 'overload').slice(0, 4),
    [snapshot?.alerts],
  )

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-fuchsia-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-fuchsia-300">Phase 15</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Council-Governed Growth Calendar</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Strategic time system for deciding what deserves Commander attention. Council families propose blocks from income leverage, growth, bottlenecks, urgency, and system evolution; only Commander approval creates internal planned events.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={snapshot?.persistenceAvailable ? 'persistence_available' : 'fallback'} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300"
          >
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">{notice}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-6">
        <MiniMetric label="Proposed" value={String(snapshot?.stats.proposedRecommendations ?? 0)} />
        <MiniMetric label="Approved Events" value={String(snapshot?.stats.approvedEvents ?? 0)} />
        <MiniMetric label="Income First" value={String(snapshot?.stats.incomeFirstSuggestions ?? 0)} />
        <MiniMetric label="Build Sessions" value={String(snapshot?.stats.buildSessions ?? 0)} />
        <MiniMetric label="Overload" value={String(snapshot?.stats.overloadWarnings ?? 0)} />
        <MiniMetric label="Recovery" value={String(snapshot?.stats.recoveryAlerts ?? 0)} />
      </div>

      <section className="mb-4 rounded border border-fuchsia-400/30 bg-fuchsia-400/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Today&apos;s Highest Leverage Block</p>
            <h3 className="mt-1 text-lg font-semibold text-white">{snapshot?.todayHighestLeverageBlock?.title ?? 'Loading council time recommendation...'}</h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-fuchsia-100">
              {snapshot?.todayHighestLeverageBlock?.reason ?? 'No block is active until the council snapshot loads.'}
            </p>
            <p className="mt-2 text-[10px] text-slate-400">
              Window: {snapshot?.todayHighestLeverageBlock?.recommendedTimeWindow ?? 'pending'} · Assigned: {snapshot?.todayHighestLeverageBlock ? label(snapshot.todayHighestLeverageBlock.assignedFamily) : 'pending'}
            </p>
          </div>
          <MiniMetric label="Leverage" value={String(Math.round(snapshot?.todayHighestLeverageBlock?.score.leverageScore ?? 0))} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <aside className="space-y-4">
          <CompactList
            title="This Week's Growth Plan"
            empty="No weekly growth plan loaded yet."
            items={(snapshot?.weekPlan ?? []).slice(0, 7).map(item => ({
              id: item.id,
              title: item.title,
              detail: `${item.recommendedTimeWindow} · leverage ${Math.round(item.score.leverageScore)} · ${item.recommendedDurationMinutes} min`,
              badge: item.eventType,
            }))}
          />
          <CompactList
            title="Income-First Suggestions"
            empty="No income-first calendar suggestions loaded."
            items={incomeFirst.map(item => ({
              id: item.id,
              title: item.title,
              detail: item.reason,
              badge: item.source,
            }))}
          />
          <CompactList
            title="War Room Build Sessions"
            empty="No War Room build sessions proposed."
            items={buildSessions.map(item => ({
              id: item.id,
              title: item.title,
              detail: `${item.reason} Energy cost estimate ${Math.round(item.score.energyCost)}.`,
              badge: item.status,
            }))}
          />
          <CompactList
            title="Overload / Recovery Alerts"
            empty="No overload or recovery alerts currently visible."
            items={recoveryAlerts.map(item => ({
              id: item.id,
              title: label(item.reviewType),
              detail: reviewDetail(item),
              badge: item.reviewType,
            }))}
          />
        </aside>

        <section className="space-y-4">
          <div className="rounded border border-white/10 bg-black/25 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Council Recommended Time Blocks</h3>
              <span className="text-[10px] text-slate-500">source: /api/growth-calendar</span>
            </div>
            <div className="max-h-[48rem] space-y-3 overflow-y-auto">
              {recommendations.length ? recommendations.slice(0, 10).map(recommendation => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  approving={approvingId === recommendation.id}
                  onApprove={approveRecommendation}
                />
              )) : (
                <div className="rounded border border-white/10 p-3 text-xs text-slate-500">No council recommendations loaded yet.</div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CompactList
              title="Approved vs Proposed Events"
              empty="No internal planned events saved yet."
              items={(snapshot?.events ?? []).slice(0, 6).map(event => ({
                id: event.id,
                title: event.title,
                detail: eventDetail(event),
                badge: event.status,
              }))}
            />
            <CompactList
              title="Outcome Review Prompts"
              empty="No outcome review prompts loaded."
              items={(snapshot?.reviews ?? []).filter(review => review.reviewType === 'outcome_prompt').slice(0, 6).map(review => ({
                id: review.id,
                title: 'Outcome review',
                detail: reviewDetail(review),
                badge: review.reviewType,
              }))}
            />
          </div>
        </section>
      </div>

      <section className="mt-4 rounded border border-white/10 bg-black/25 p-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Connected Surfaces</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {Object.entries(snapshot?.integrations ?? {}).map(([key, values]) => (
            <div key={key} className="rounded border border-white/10 p-2 text-[10px]">
              <div className="font-semibold text-slate-200">{label(key)}</div>
              <p className="mt-1 leading-relaxed text-slate-500">{values[0] ?? 'No current integration signal loaded.'}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Governance: proposed blocks are estimates only. War Room does not write to external calendars, schedule hidden events, run background actions, contact anyone, or claim execution. Persistence: {snapshot?.persistenceNote ?? 'checking'}.
      </div>
    </section>
  )
}

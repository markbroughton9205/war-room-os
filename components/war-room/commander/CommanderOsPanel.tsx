'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CanonicalStatusBadge } from '@/components/war-room/runtime/CanonicalStatusBadge'
import type {
  CommanderHighestLeverageMove,
  CommanderLifePositioning,
  CommanderMetrics,
  CommanderMomentum,
  CommanderPattern,
  CommanderRealityCorrectionAlert,
  CommanderReview,
  CommanderTrajectoryPoint,
} from '@/lib/commander/model'

type LeveragePayload = {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  highestLeverageMove: CommanderHighestLeverageMove
  metrics: CommanderMetrics
  patterns: CommanderPattern[]
  realityCorrectionAlerts: CommanderRealityCorrectionAlert[]
  integrations: Record<string, string[]>
  error?: string
}

type TrajectoryPayload = {
  momentum: CommanderMomentum
  lifePositioning: CommanderLifePositioning
  trajectory: CommanderTrajectoryPoint[]
  reviews: CommanderReview[]
  error?: string
}

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/-/g, ' ')
}

function money(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function colorFor(value: string | number) {
  const text = String(value)
  if (/critical|overloaded|drifting|down|burnout|distraction|failure|waste/i.test(text)) return '#F87171'
  if (/watch|holding|flat|unknown|bottleneck|load/i.test(text)) return '#FBBF24'
  if (/advancing|up|compound|leverage|available|important/i.test(text)) return '#34D399'
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

function MiniMetric({ label: metricLabel, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone ? colorFor(tone) : '#67E8F9'
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{metricLabel}</div>
      <div className="mt-1 font-mono text-sm" style={{ color }}>{value}</div>
    </div>
  )
}

function CompactList({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: Array<{ id: string; title: string; detail: string; badge?: string }>
}) {
  return (
    <section className="rounded border border-white/10 bg-black/25 p-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{title}</h3>
      <div className="mt-2 space-y-2">
        {items.length ? items.map(item => (
          <article key={item.id} className="rounded border border-white/10 p-2 text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-200">{item.title}</span>
              {item.badge ? <Badge value={item.badge} /> : null}
            </div>
            <p className="mt-1 leading-relaxed text-slate-500">{item.detail}</p>
          </article>
        )) : <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">{empty}</div>}
      </div>
    </section>
  )
}

function scoreItems(life: CommanderLifePositioning | null) {
  if (!life) return []
  return [
    ['Economic', life.economicPositioning],
    ['Skill', life.skillPositioning],
    ['Infrastructure', life.infrastructurePositioning],
    ['Operations', life.operationalMaturity],
    ['Leverage', life.leverageGrowth],
    ['Optionality', life.strategicOptionality],
  ] as const
}

export function CommanderOsPanel() {
  const [leverage, setLeverage] = useState<LeveragePayload | null>(null)
  const [trajectory, setTrajectory] = useState<TrajectoryPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [leverageRes, trajectoryRes] = await Promise.all([
        fetch('/api/commander/leverage', { cache: 'no-store' }),
        fetch('/api/commander/trajectory', { cache: 'no-store' }),
      ])
      const leverageBody = await leverageRes.json() as LeveragePayload
      const trajectoryBody = await trajectoryRes.json() as TrajectoryPayload
      if (!leverageRes.ok) throw new Error(leverageBody.error || 'Commander leverage snapshot failed')
      if (!trajectoryRes.ok) throw new Error(trajectoryBody.error || 'Commander trajectory snapshot failed')
      setLeverage(leverageBody)
      setTrajectory(trajectoryBody)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commander OS snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const metrics = leverage?.metrics ?? null
  const topWarnings = useMemo(
    () => (leverage?.realityCorrectionAlerts ?? []).filter(item => item.redTeamBabyWarning).slice(0, 4),
    [leverage?.realityCorrectionAlerts],
  )
  const compounding = useMemo(
    () => (leverage?.patterns ?? []).filter(item => item.kind === 'compounding_win' || item.kind === 'leverage_zone').slice(0, 5),
    [leverage?.patterns],
  )
  const distractions = useMemo(
    () => (leverage?.patterns ?? []).filter(item => item.kind === 'distraction' || item.kind === 'repeated_failure' || item.kind === 'bottleneck').slice(0, 5),
    [leverage?.patterns],
  )

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-fuchsia-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-fuchsia-300">Phase 16</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Commander OS + Personal Leverage Engine</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Recommendation-only operating layer for leverage, execution quality, momentum, operational load, life positioning, and reality correction. It does not diagnose, spend, outreach, schedule externally, or execute hidden actions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CanonicalStatusBadge subsystemId="commander_os" label="Canonical" />
          <Badge value={leverage?.persistenceAvailable ? 'persistence_available' : 'fallback'} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}

      <section className="mb-4 rounded border border-fuchsia-400/25 bg-fuchsia-400/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Single Highest Leverage Move</p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {leverage?.highestLeverageMove.title ?? 'Loading leverage move'}
            </h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
              {leverage?.highestLeverageMove.summary ?? 'Commander OS is deriving the move from source-backed War Room surfaces.'}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Next manual action: {leverage?.highestLeverageMove.nextManualAction ?? 'none yet'}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge value={`score_${leverage?.highestLeverageMove.score ?? 0}`} />
            <Badge value="approval_required" />
          </div>
        </div>
      </section>

      <div className="mb-4 grid gap-3 md:grid-cols-6">
        <MiniMetric label="Leverage" value={String(metrics?.leverageScore ?? 0)} tone="leverage" />
        <MiniMetric label="Execution" value={String(metrics?.executionScore ?? 0)} />
        <MiniMetric label="Focus" value={String(metrics?.focusStability ?? 0)} />
        <MiniMetric label="Momentum" value={String(metrics?.momentumScore ?? 0)} tone={metrics?.trajectoryDirection} />
        <MiniMetric label="Load Risk" value={String(metrics?.burnoutRisk ?? 0)} tone={metrics && metrics.burnoutRisk >= 70 ? 'burnout' : 'load'} />
        <MiniMetric label="Income / Hour" value={money(metrics?.incomePerHourEstimate)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <section className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <CompactList
              title="Reality Correction Alerts"
              empty="No repeated low-ROI pattern detected yet."
              items={topWarnings.map(alert => ({
                id: alert.id,
                title: alert.title,
                detail: `${alert.summary} Leverage decay ${alert.leverageDecay}; distraction increase ${alert.distractionIncrease}.`,
                badge: alert.growthCalendarAdjustment,
              }))}
            />
            <CompactList
              title="Compounding Systems"
              empty="No compounding system detected from explicit outcomes yet."
              items={compounding.map(pattern => ({
                id: pattern.id,
                title: pattern.title,
                detail: pattern.summary,
                badge: pattern.kind,
              }))}
            />
            <CompactList
              title="Distraction / Bottleneck Patterns"
              empty="No distraction, bottleneck, or repeated failure pattern detected."
              items={distractions.map(pattern => ({
                id: pattern.id,
                title: pattern.title,
                detail: pattern.summary,
                badge: pattern.severity,
              }))}
            />
            <CompactList
              title="Top Opportunities"
              empty="No source-backed opportunity loaded."
              items={Object.entries(leverage?.integrations ?? {}).flatMap(([source, values]) => values.slice(0, 1).map((value, index) => ({
                id: `${source}-${index}`,
                title: label(source),
                detail: value,
                badge: source,
              })))}
            />
          </div>

          <section className="rounded border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Strategic Reviews</h3>
              <span className="text-[10px] text-slate-500">daily / weekly / monthly ready</span>
            </div>
            <div className="mt-3 space-y-2">
              {(trajectory?.reviews ?? []).slice(0, 3).map(review => (
                <article key={review.id} className="rounded border border-white/10 p-3 text-[10px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">{label(review.period)} review</span>
                    <Badge value="recommendation_only" />
                  </div>
                  <p className="mt-2 leading-relaxed text-slate-500">{review.summary}</p>
                  <p className="mt-2 leading-relaxed text-cyan-100">Next focus: {review.nextStrategicFocus}</p>
                </article>
              ))}
              {trajectory?.reviews.length ? null : <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">No Commander review loaded yet.</div>}
            </div>
          </section>
        </section>

        <aside className="space-y-4">
          <section className="rounded border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Trajectory + Momentum</h3>
              <Badge value={metrics?.trajectoryDirection ?? 'unknown'} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              {trajectory?.momentum.summary ?? 'Momentum is loading from explicit outcomes, calendar state, and active opportunity loops.'}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <MiniMetric label="Recent streak" value={String(trajectory?.momentum.streakDays ?? 0)} />
              <MiniMetric label="Inactive days" value={trajectory?.momentum.inactivityDays == null ? 'n/a' : String(trajectory.momentum.inactivityDays)} />
              <MiniMetric label="Unfinished loops" value={String(trajectory?.momentum.unfinishedLoopCount ?? 0)} />
              <MiniMetric label="Execution drift" value={String(trajectory?.momentum.executionDrift ?? 0)} tone="drifting" />
            </div>
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Life Positioning</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {trajectory?.lifePositioning.summary ?? 'Derived from economic, skill, infrastructure, operational, leverage, and optionality signals.'}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {scoreItems(trajectory?.lifePositioning ?? null).map(([itemLabel, value]) => (
                <MiniMetric key={itemLabel} label={itemLabel} value={String(value)} />
              ))}
            </div>
          </section>

          <section className="rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Guardrails</h3>
            <p className="mt-2">
              Burnout risk is operational load, not a clinical claim. Commander OS produces recommendations only: no hidden action, no external execution, no spending, and no income claim without explicit/source-backed outcomes.
            </p>
            <p className="mt-2">Persistence: {leverage?.persistenceNote ?? 'checking'}.</p>
          </section>
        </aside>
      </div>
    </section>
  )
}

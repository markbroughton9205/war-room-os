'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CanonicalStatusBadge } from '@/components/war-room/runtime/CanonicalStatusBadge'
import type { RevenueEngineCategory, RevenueEngineSnapshot, RevenueOpportunity } from '@/lib/revenue-engine/model'
import { REVENUE_ENGINE_CATEGORIES } from '@/lib/revenue-engine/model'

type FormState = {
  title: string
  category: RevenueEngineCategory
  notes: string
  source: string
  estimatedRevenue: string
  estimatedTimeHours: string
  startupCostUsd: string
  regionalSignal: string
  shipperPainPoint: string
  smbPainPoint: string
  nextReviewAction: string
}

const emptyForm: FormState = {
  title: '',
  category: 'smb_automation',
  notes: '',
  source: '',
  estimatedRevenue: '',
  estimatedTimeHours: '',
  startupCostUsd: '',
  regionalSignal: '',
  shipperPainPoint: '',
  smbPainPoint: '',
  nextReviewAction: '',
}

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function money(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'estimate n/a'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function score(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : 'n/a'
}

function colorFor(value: string) {
  if (value.includes('critical') || value.includes('warning') || value.includes('high_stress') || value.includes('low_roi')) return '#F87171'
  if (value.includes('important') || value.includes('watch') || value.includes('ready')) return '#FBBF24'
  if (value.includes('positive') || value.includes('won') || value.includes('available')) return '#34D399'
  return '#94A3B8'
}

function Badge({ label: badgeLabel }: { label: string }) {
  const color = colorFor(badgeLabel)
  return (
    <span
      className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
      style={{ border: `1px solid ${color}66`, color, background: 'rgba(0,0,0,0.25)' }}
    >
      {label(badgeLabel)}
    </span>
  )
}

function MiniMetric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{metricLabel}</div>
      <div className="mt-1 font-mono text-sm text-emerald-200">{value}</div>
    </div>
  )
}

function ScoreBar({ label: barLabel, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-[9px] text-slate-500">
        <span>{barLabel}</span>
        <span>{score(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded bg-[#00ff41]" style={{ width: `${Math.max(0, Math.min(100, Math.round(value)))}%` }} />
      </div>
    </div>
  )
}

function OpportunityCard({ opportunity }: { opportunity: RevenueOpportunity }) {
  return (
    <article className="rounded border border-white/10 bg-slate-950/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-white">{opportunity.title}</h4>
            <Badge label={`rank_${opportunity.priorityRank || '?'}`} />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {label(opportunity.category)} · {opportunity.source} · {new Date(opportunity.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge label={opportunity.status} />
          <Badge label={opportunity.familyImpactEstimate} />
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{opportunity.notes}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="Leverage" value={score(opportunity.score.leverageScore)} />
        <MiniMetric label="Est. Revenue" value={money(opportunity.estimatedRevenue)} />
        <MiniMetric label="Time" value={opportunity.estimatedTimeHours == null ? 'estimate n/a' : `${opportunity.estimatedTimeHours}h`} />
        <MiniMetric label="Startup Cost" value={money(opportunity.startupCostUsd)} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreBar label="Repeatability" value={opportunity.score.repeatability} />
        <ScoreBar label="Automation Potential" value={opportunity.score.automationPotential} />
        <ScoreBar label="Time To Profit" value={opportunity.score.timeToProfit} />
        <ScoreBar label="Stress Load" value={opportunity.score.stressLoad} />
      </div>
      {(opportunity.regionalSignal || opportunity.shipperPainPoint || opportunity.smbPainPoint) ? (
        <div className="mt-3 grid gap-2 text-[10px] text-slate-400 md:grid-cols-3">
          {opportunity.regionalSignal ? <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Regional/freight:</span> {opportunity.regionalSignal}</div> : null}
          {opportunity.shipperPainPoint ? <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Shipper pain:</span> {opportunity.shipperPainPoint}</div> : null}
          {opportunity.smbPainPoint ? <div className="rounded border border-white/10 p-2"><span className="text-slate-500">SMB pain:</span> {opportunity.smbPainPoint}</div> : null}
        </div>
      ) : null}
      <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-emerald-100">
        Manual next review: {opportunity.nextReviewAction}
      </div>
    </article>
  )
}

export function RevenueEnginePanel() {
  const [snapshot, setSnapshot] = useState<RevenueEngineSnapshot | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/revenue-engine', { cache: 'no-store' })
      const body = await res.json() as RevenueEngineSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Revenue Engine snapshot failed')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revenue Engine snapshot failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/revenue-engine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          estimatedRevenue: form.estimatedRevenue || null,
          estimatedTimeHours: form.estimatedTimeHours || null,
          startupCostUsd: form.startupCostUsd || null,
        }),
      })
      const body = await res.json() as { persistenceNote?: string; error?: string }
      if (!res.ok) throw new Error(body.error || 'Revenue opportunity scoring failed')
      setNotice(body.persistenceNote ?? 'Opportunity scored. No external execution was performed.')
      setForm(emptyForm)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revenue opportunity scoring failed')
    } finally {
      setSubmitting(false)
    }
  }

  const opportunities = useMemo(() => snapshot?.opportunities ?? [], [snapshot?.opportunities])
  const freightItems = useMemo(() => opportunities.filter(item => ['freight', 'sprinter_van_routes', 'local_delivery'].includes(item.category)).slice(0, 3), [opportunities])
  const smbItems = useMemo(() => opportunities.filter(item => /smb|automation|operations|scheduling|dashboard/.test(item.category)).slice(0, 3), [opportunities])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-emerald-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#00ff41]">Phase 13</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">War Room Revenue Engine</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Economic leverage operating surface for income-focused opportunity tracking, execution prioritization, profitable repetition, and compounding workflows. Scores are estimates only; actions remain visible, approval-gated, and manual.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CanonicalStatusBadge subsystemId="revenue_engine" label="Canonical" />
          <Badge label={snapshot?.persistenceAvailable ? 'persistent_available' : 'fallback'} />
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
        <MiniMetric label="Active Opps" value={String(snapshot?.stats.activeOpportunities ?? 0)} />
        <MiniMetric label="Avg Leverage" value={score(snapshot?.stats.averageLeverageScore)} />
        <MiniMetric label="Est. Pipeline" value={money(snapshot?.stats.estimatedPipelineRevenue)} />
        <MiniMetric label="Repeatable" value={String(snapshot?.stats.repeatablePatterns ?? 0)} />
        <MiniMetric label="Low-ROI Warnings" value={String(snapshot?.stats.lowRoiWarnings ?? 0)} />
        <MiniMetric label="Compounding" value={String(snapshot?.stats.compoundingOpportunities ?? 0)} />
      </div>

      <section className="mb-4 rounded border border-[#00ff41]/30 bg-[#00ff41]/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#00ff41]">Highest Leverage Move</p>
            <h3 className="mt-1 text-lg font-semibold text-white">{snapshot?.highestLeverageMove.title ?? 'Loading revenue priority...'}</h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-emerald-100">{snapshot?.highestLeverageMove.summary ?? 'Waiting for Revenue Engine snapshot.'}</p>
            <p className="mt-2 text-[10px] text-slate-400">Why now: {snapshot?.highestLeverageMove.whyNow ?? 'not available yet'}</p>
          </div>
          <MiniMetric label="Move Score" value={score(snapshot?.highestLeverageMove.score)} />
        </div>
        <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] leading-relaxed text-slate-300">
          Next manual action: {snapshot?.highestLeverageMove.nextManualAction ?? 'Load or capture an opportunity first.'}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded border border-white/10 bg-black/25 p-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">Capture Opportunity</h3>
          <form className="mt-4 space-y-3" onSubmit={submit}>
            <input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} required className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Opportunity title" />
            <select value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value as RevenueEngineCategory }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
              {REVENUE_ENGINE_CATEGORIES.map(category => <option key={category} value={category}>{label(category)}</option>)}
            </select>
            <textarea value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} rows={3} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Evidence, constraints, offer notes, or observed pain..." />
            <div className="grid gap-2 sm:grid-cols-3">
              <input value={form.estimatedRevenue} onChange={event => setForm(current => ({ ...current, estimatedRevenue: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Est. revenue" inputMode="numeric" />
              <input value={form.estimatedTimeHours} onChange={event => setForm(current => ({ ...current, estimatedTimeHours: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Est. hours" inputMode="numeric" />
              <input value={form.startupCostUsd} onChange={event => setForm(current => ({ ...current, startupCostUsd: event.target.value }))} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Startup cost" inputMode="numeric" />
            </div>
            <input value={form.source} onChange={event => setForm(current => ({ ...current, source: event.target.value }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Source or evidence note" />
            <textarea value={form.regionalSignal} onChange={event => setForm(current => ({ ...current, regionalSignal: event.target.value }))} rows={2} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Freight / Ohio / local market signal" />
            <textarea value={form.shipperPainPoint} onChange={event => setForm(current => ({ ...current, shipperPainPoint: event.target.value }))} rows={2} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Shipper or logistics pain point" />
            <textarea value={form.smbPainPoint} onChange={event => setForm(current => ({ ...current, smbPainPoint: event.target.value }))} rows={2} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="SMB workflow inefficiency or customer ops pain" />
            <input value={form.nextReviewAction} onChange={event => setForm(current => ({ ...current, nextReviewAction: event.target.value }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Next manual review action" />
            <button type="submit" disabled={submitting} className="w-full rounded border border-[#00ff41]/40 bg-[#00ff41]/10 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-[#00ff41] disabled:opacity-50">
              {submitting ? 'Scoring...' : 'Score opportunity'}
            </button>
          </form>
          <p className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-[10px] leading-relaxed text-slate-500">
            Guardrail: this form records and scores only. It does not contact shippers, apply for work, run automation, mutate files, deploy, or claim income.
          </p>
        </section>

        <section className="space-y-4">
          <div className="rounded border border-white/10 bg-black/25 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Active Opportunity Pipeline</h3>
              <span className="text-[10px] text-slate-500">source: /api/revenue-engine</span>
            </div>
            <div className="max-h-[42rem] space-y-3 overflow-y-auto">
              {opportunities.length ? opportunities.map(opportunity => <OpportunityCard key={opportunity.id} opportunity={opportunity} />) : (
                <div className="rounded border border-white/10 p-3 text-xs text-slate-500">No opportunities loaded yet.</div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="rounded border border-white/10 bg-black/25 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Freight Intelligence Layer</h3>
          <ul className="mt-2 space-y-2 text-[10px] text-slate-400">
            {(freightItems.length ? freightItems : opportunities.slice(0, 1)).map(item => (
              <li key={`freight-${item.id}`} className="rounded border border-white/10 p-2">
                <span className="font-semibold text-slate-200">{item.title}</span>
                <p className="mt-1">{item.regionalSignal || item.shipperPainPoint || 'Track Ohio/local signals, lane profitability, recurring patterns, and shipper pain points.'}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded border border-white/10 bg-black/25 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-violet-300">SMB Systems Layer</h3>
          <ul className="mt-2 space-y-2 text-[10px] text-slate-400">
            {(smbItems.length ? smbItems : opportunities.slice(0, 1)).map(item => (
              <li key={`smb-${item.id}`} className="rounded border border-white/10 p-2">
                <span className="font-semibold text-slate-200">{item.title}</span>
                <p className="mt-1">{item.smbPainPoint || 'Track repetitive pain, workflow inefficiency, intake systems, dashboards, and AI-assisted customer operations.'}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded border border-white/10 bg-black/25 p-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Strategic Alerts</h3>
          <ul className="mt-2 space-y-2 text-[10px] text-slate-400">
            {(snapshot?.strategicAlerts ?? []).slice(0, 5).map(alert => (
              <li key={alert.id} className="rounded border border-white/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{alert.title}</span>
                  <Badge label={alert.severity} />
                </div>
                <p className="mt-1">{alert.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Categories: {(snapshot?.categories ?? REVENUE_ENGINE_CATEGORIES).map(label).join(', ')}. Scores optimize estimated income per unit of attention, leverage, execution compression, repeatability, workflow scalability, strategic positioning, and family impact.
      </div>
    </section>
  )
}


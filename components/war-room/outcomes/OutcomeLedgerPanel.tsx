'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  OUTCOME_CATEGORIES,
  OUTCOME_RECOMMENDATIONS,
  OUTCOME_RESULT_STATUSES,
  type OutcomeCategory,
  type OutcomeRecommendation,
  type OutcomeResultStatus,
  type OutcomeSnapshot,
} from '@/lib/outcomes/model'

type FormState = {
  title: string
  category: OutcomeCategory
  relatedOpportunity: string
  estimatedRevenue: string
  actualRevenue: string
  timeInvestedHours: string
  stressLoad: string
  leverageScore: string
  repeatabilityScore: string
  scalabilityScore: string
  familyImpact: string
  executionDifficulty: string
  resultStatus: OutcomeResultStatus
  whatWorked: string
  whatFailed: string
  lessonsLearned: string
  recommendedRepeatAvoid: OutcomeRecommendation
  linkedFeatureProject: string
  linkedBabyAiFamily: string
  approvalStatus: string
  sourceUri: string
}

const emptyForm: FormState = {
  title: '',
  category: 'learning',
  relatedOpportunity: '',
  estimatedRevenue: '',
  actualRevenue: '',
  timeInvestedHours: '',
  stressLoad: '50',
  leverageScore: '50',
  repeatabilityScore: '50',
  scalabilityScore: '50',
  familyImpact: '50',
  executionDifficulty: '50',
  resultStatus: 'needs_review',
  whatWorked: '',
  whatFailed: '',
  lessonsLearned: '',
  recommendedRepeatAvoid: 'monitor',
  linkedFeatureProject: '',
  linkedBabyAiFamily: '',
  approvalStatus: 'not_required',
  sourceUri: '',
}

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/-/g, ' ')
}

function money(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function numeric(value: number | null | undefined, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}${suffix}` : 'n/a'
}

function colorFor(value: string) {
  if (/critical|failed|loss|avoid|waste|deprioritize|high|abandoned/.test(value)) return '#F87171'
  if (/watch|review|monitor|rising|underperforming|pause/.test(value)) return '#FBBF24'
  if (/profitable|repeat|compounded|available|outperforming|on_track|low/.test(value)) return '#34D399'
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
      <div className="mt-1 font-mono text-sm text-cyan-200">{value}</div>
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

function ScoreInput({
  label: inputLabel,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">{inputLabel}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        inputMode="numeric"
        className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
    </label>
  )
}

export function OutcomeLedgerPanel() {
  const [snapshot, setSnapshot] = useState<OutcomeSnapshot | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/outcomes', { cache: 'no-store' })
      const body = await res.json() as OutcomeSnapshot & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Outcome Ledger snapshot failed')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outcome Ledger snapshot failed')
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
      const res = await fetch('/api/outcomes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          estimatedRevenue: form.estimatedRevenue || null,
          actualRevenue: form.actualRevenue || null,
          timeInvestedHours: form.timeInvestedHours || null,
          stressLoad: form.stressLoad || null,
          leverageScore: form.leverageScore || null,
          repeatabilityScore: form.repeatabilityScore || null,
          scalabilityScore: form.scalabilityScore || null,
          familyImpact: form.familyImpact || null,
          executionDifficulty: form.executionDifficulty || null,
          linkedBabyAiFamily: form.linkedBabyAiFamily || null,
          sourceUri: form.sourceUri || null,
          evidence: form.sourceUri ? { sourceUri: form.sourceUri } : {},
        }),
      })
      const body = await res.json() as { persistenceNote?: string; error?: string }
      if (!res.ok) throw new Error(body.error || 'Outcome logging failed')
      setNotice(body.persistenceNote ?? 'Outcome logged from explicit Commander entry. No external action was performed.')
      setForm(emptyForm)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outcome logging failed')
    } finally {
      setSubmitting(false)
    }
  }

  const outcomes = useMemo(() => snapshot?.outcomes ?? [], [snapshot?.outcomes])
  const profitable = useMemo(() => outcomes.filter(item => (item.actualRevenue ?? 0) > 0 || item.resultStatus === 'profitable').slice(0, 5), [outcomes])
  const failed = useMemo(() => outcomes.filter(item => ['failed', 'loss', 'time_wasted', 'abandoned', 'not_shipped'].includes(item.resultStatus) || item.recommendedRepeatAvoid === 'avoid').slice(0, 5), [outcomes])

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-cyan-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-cyan-300">Phase 15</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Outcome Ledger + Real-World ROI Learning</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Explicit reality ledger for what made money, wasted time, created leverage, failed, compounded, should repeat, or should be abandoned. Empty means unknown, not success.
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

      <div className="mb-4 rounded border border-cyan-400/25 bg-cyan-400/5 p-3 text-[10px] leading-relaxed text-cyan-100">
        Truth label: War Room does not infer revenue, claim AI success, spend money, contact anyone, or hide actions. POST endpoints only record explicit outcome/review logs.
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-6">
        <MiniMetric label="Logged Outcomes" value={String(snapshot?.roiTrends.loggedOutcomeCount ?? 0)} />
        <MiniMetric label="Actual Revenue" value={money(snapshot?.roiTrends.totalActualRevenue)} />
        <MiniMetric label="Estimate Delta" value={money(snapshot?.roiTrends.estimateDelta)} />
        <MiniMetric label="Value / Hour" value={snapshot?.roiTrends.valuePerHour == null ? 'n/a' : money(snapshot.roiTrends.valuePerHour)} />
        <MiniMetric label="Wasted Hours" value={numeric(snapshot?.roiTrends.timeWastedHours, 'h')} />
        <MiniMetric label="Distraction" value={label(snapshot?.roiTrends.distractionTrend ?? 'unknown')} />
      </div>

      <section className="mb-4 rounded border border-white/10 bg-black/25 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Reality Correction</p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {snapshot?.realityCorrectionAlerts[0]?.title ?? 'No reality correction loaded yet'}
            </h3>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
              {snapshot?.realityCorrectionAlerts[0]?.summary ?? 'Log real outcomes before War Room repeats, abandons, or ranks a pattern.'}
            </p>
          </div>
          <Badge value={snapshot?.realityCorrectionAlerts[0]?.priorityAdjustment ?? 'none'} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <aside className="space-y-4">
          <section className="rounded border border-white/10 bg-black/25 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Log Explicit Outcome</h3>
            <form className="mt-4 space-y-3" onSubmit={submit}>
              <input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} required className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Outcome title" />
              <select value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value as OutcomeCategory }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
                {OUTCOME_CATEGORIES.map(category => <option key={category} value={category}>{label(category)}</option>)}
              </select>
              <div className="grid gap-2 sm:grid-cols-2">
                <select value={form.resultStatus} onChange={event => setForm(current => ({ ...current, resultStatus: event.target.value as OutcomeResultStatus }))} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
                  {OUTCOME_RESULT_STATUSES.map(status => <option key={status} value={status}>{label(status)}</option>)}
                </select>
                <select value={form.recommendedRepeatAvoid} onChange={event => setForm(current => ({ ...current, recommendedRepeatAvoid: event.target.value as OutcomeRecommendation }))} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white">
                  {OUTCOME_RECOMMENDATIONS.map(item => <option key={item} value={item}>{label(item)}</option>)}
                </select>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={form.estimatedRevenue} onChange={event => setForm(current => ({ ...current, estimatedRevenue: event.target.value }))} inputMode="numeric" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Est. revenue" />
                <input value={form.actualRevenue} onChange={event => setForm(current => ({ ...current, actualRevenue: event.target.value }))} inputMode="numeric" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Actual revenue" />
                <input value={form.timeInvestedHours} onChange={event => setForm(current => ({ ...current, timeInvestedHours: event.target.value }))} inputMode="numeric" className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Hours invested" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ScoreInput label="Stress" value={form.stressLoad} onChange={value => setForm(current => ({ ...current, stressLoad: value }))} />
                <ScoreInput label="Leverage" value={form.leverageScore} onChange={value => setForm(current => ({ ...current, leverageScore: value }))} />
                <ScoreInput label="Repeatability" value={form.repeatabilityScore} onChange={value => setForm(current => ({ ...current, repeatabilityScore: value }))} />
                <ScoreInput label="Scalability" value={form.scalabilityScore} onChange={value => setForm(current => ({ ...current, scalabilityScore: value }))} />
                <ScoreInput label="Family impact" value={form.familyImpact} onChange={value => setForm(current => ({ ...current, familyImpact: value }))} />
                <ScoreInput label="Difficulty" value={form.executionDifficulty} onChange={value => setForm(current => ({ ...current, executionDifficulty: value }))} />
              </div>
              <textarea value={form.whatWorked} onChange={event => setForm(current => ({ ...current, whatWorked: event.target.value }))} rows={2} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="What worked" />
              <textarea value={form.whatFailed} onChange={event => setForm(current => ({ ...current, whatFailed: event.target.value }))} rows={2} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="What failed" />
              <textarea value={form.lessonsLearned} onChange={event => setForm(current => ({ ...current, lessonsLearned: event.target.value }))} rows={2} className="w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Lessons learned" />
              <input value={form.relatedOpportunity} onChange={event => setForm(current => ({ ...current, relatedOpportunity: event.target.value }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Related opportunity id or note" />
              <input value={form.linkedFeatureProject} onChange={event => setForm(current => ({ ...current, linkedFeatureProject: event.target.value }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Linked feature/project" />
              <input value={form.sourceUri} onChange={event => setForm(current => ({ ...current, sourceUri: event.target.value }))} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-600" placeholder="Optional source URI/evidence link" />
              <button type="submit" disabled={submitting} className="w-full rounded border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-cyan-200 disabled:opacity-50">
                {submitting ? 'Logging...' : 'Log explicit outcome'}
              </button>
            </form>
          </section>

          <CompactList
            title="Highest Leverage Categories"
            empty="No leverage categories until real outcomes are logged."
            items={(snapshot?.highestLeverageCategories ?? []).map(item => ({
              id: item.category,
              title: label(item.category),
              detail: `${item.outcomeCount} outcomes · ${money(item.actualRevenue)} actual · ${item.valuePerHour == null ? 'value/hour n/a' : `${money(item.valuePerHour)}/h`} · stress ${Math.round(item.averageStress)}`,
              badge: `leverage_${Math.round(item.averageLeverage)}`,
            }))}
          />
        </aside>

        <section className="space-y-4">
          <div className="rounded border border-white/10 bg-black/25 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Explicit Outcome Ledger</h3>
              <span className="text-[10px] text-slate-500">source: /api/outcomes</span>
            </div>
            <div className="max-h-[44rem] space-y-3 overflow-y-auto">
              {outcomes.length ? outcomes.slice(0, 12).map(outcome => (
                <article key={outcome.id} className="rounded border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{outcome.title}</h4>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {label(outcome.category)} · {new Date(outcome.createdAt).toLocaleString()} · source-backed: {String(outcome.sourceBacked)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge value={outcome.resultStatus} />
                      <Badge value={outcome.recommendedRepeatAvoid} />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <MiniMetric label="Est." value={money(outcome.estimatedRevenue)} />
                    <MiniMetric label="Actual" value={money(outcome.actualRevenue)} />
                    <MiniMetric label="Hours" value={outcome.timeInvestedHours == null ? 'n/a' : `${outcome.timeInvestedHours}h`} />
                    <MiniMetric label="Leverage" value={String(outcome.leverageScore)} />
                  </div>
                  <div className="mt-3 grid gap-2 text-[10px] text-slate-400 lg:grid-cols-3">
                    <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Worked:</span> {outcome.whatWorked || 'not logged'}</div>
                    <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Failed:</span> {outcome.whatFailed || 'not logged'}</div>
                    <div className="rounded border border-white/10 p-2"><span className="text-slate-500">Lesson:</span> {outcome.lessonsLearned || 'not logged'}</div>
                  </div>
                </article>
              )) : (
                <div className="rounded border border-white/10 p-3 text-xs text-slate-500">
                  No explicit outcomes logged. War Room has no basis to claim revenue, ROI, repeated wins, or AI success yet.
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CompactList
              title="Profitable Outcomes"
              empty="No profitable outcomes logged."
              items={profitable.map(item => ({
                id: item.id,
                title: item.title,
                detail: `${money(item.actualRevenue)} actual · ${item.timeInvestedHours ?? 'n/a'}h · repeatability ${item.repeatabilityScore}`,
                badge: item.category,
              }))}
            />
            <CompactList
              title="Failed / Wasted Outcomes"
              empty="No failed or wasted outcomes logged."
              items={failed.map(item => ({
                id: item.id,
                title: item.title,
                detail: `${item.resultStatus} · ${item.timeInvestedHours ?? 'n/a'}h · lesson: ${item.lessonsLearned || 'not logged'}`,
                badge: item.recommendedRepeatAvoid,
              }))}
            />
            <CompactList
              title="Compounding Systems"
              empty="No repeated profitable behavior detected from explicit outcomes."
              items={(snapshot?.compoundingPatterns ?? []).map(pattern => ({
                id: pattern.id,
                title: pattern.title,
                detail: pattern.summary,
                badge: pattern.recommendation,
              }))}
            />
            <CompactList
              title="Repeated Mistakes"
              empty="No repeated failure pattern detected from explicit outcomes."
              items={[...(snapshot?.failurePatterns ?? []), ...(snapshot?.timeWastePatterns ?? [])].map(pattern => ({
                id: pattern.id,
                title: pattern.title,
                detail: pattern.summary,
                badge: 'red_team_watch',
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
              <p className="mt-1 leading-relaxed text-slate-500">{values[0] ?? 'No integration signal loaded.'}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Persistence: {snapshot?.persistenceNote ?? 'checking'}. Categories: {OUTCOME_CATEGORIES.map(label).join(', ')}.
      </div>
    </section>
  )
}

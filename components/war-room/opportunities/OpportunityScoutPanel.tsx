'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OperatorOpportunityFilterId, ScoutOpportunity } from '@/lib/opportunities/schema'

const FILTER_CHIPS: { id: OperatorOpportunityFilterId; label: string }[] = [
  { id: 'under500', label: 'Under $500' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'local', label: 'Local' },
  { id: 'remote', label: 'Remote' },
  { id: 'ai-based', label: 'AI-based' },
  { id: 'logistics-aligned', label: 'Logistics' },
  { id: 'passive', label: 'Passive' },
  { id: 'service-based', label: 'Service' },
]

type SortKey = 'generatedAt' | 'confidence' | 'startupCost' | 'roi' | 'title'

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function colorFor(value: string) {
  if (value.includes('REJECTED') || value.includes('high')) return '#F87171'
  if (value.includes('PROPOSED') || value.includes('HISTORICAL')) return '#FBBF24'
  if (value.includes('APPROVED') || value.includes('LIVE_SIGNAL')) return '#34D399'
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
      <div className="mt-1 font-mono text-sm text-amber-200">{value}</div>
    </div>
  )
}

function OpportunityRow({
  opportunity,
  onApprove,
  onReject,
}: {
  opportunity: ScoutOpportunity
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  return (
    <tr className="border-t border-white/10 text-[10px] text-slate-300">
      <td className="px-2 py-2 align-top">
        <div className="font-semibold text-white">{opportunity.opportunityTitle}</div>
        <div className="mt-1 text-slate-500">{opportunity.targetCustomer}</div>
      </td>
      <td className="px-2 py-2 align-top font-mono text-cyan-200">{opportunity.confidence}</td>
      <td className="px-2 py-2 align-top">{opportunity.startupCost}</td>
      <td className="px-2 py-2 align-top">
        {opportunity.estimatedRoi !== null ? `${opportunity.estimatedRoi}x` : 'n/a'}
      </td>
      <td className="px-2 py-2 align-top">{label(opportunity.family)}</td>
      <td className="px-2 py-2 align-top">
        <Badge value={opportunity.approvalStatus} />
        <div className="mt-1">
          <Badge value={opportunity.evidenceLabel} />
        </div>
      </td>
      <td className="px-2 py-2 align-top">
        {opportunity.approvalStatus === 'PROPOSED' ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded border border-emerald-500/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => onApprove(opportunity.id)}
            >
              Approve
            </button>
            <button
              type="button"
              className="rounded border border-red-500/40 px-2 py-0.5 text-[9px] uppercase tracking-widest text-red-300 hover:bg-red-500/10"
              onClick={() => onReject(opportunity.id)}
            >
              Reject
            </button>
          </div>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
    </tr>
  )
}

export function OpportunityScoutPanel({ threadId }: { threadId?: string }) {
  const [opportunities, setOpportunities] = useState<ScoutOpportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('confidence')
  const [activeFilters, setActiveFilters] = useState<Partial<Record<OperatorOpportunityFilterId, boolean>>>({})

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (threadId) params.set('threadId', threadId)
    params.set('sort', sort)
    for (const chip of FILTER_CHIPS) {
      if (activeFilters[chip.id]) params.set(chip.id, 'true')
    }
    return params.toString()
  }, [activeFilters, sort, threadId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/opportunities?${query}`, { cache: 'no-store' })
      const data = (await res.json()) as { opportunities?: ScoutOpportunity[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setOpportunities(data.opportunities ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load opportunities')
      setOpportunities([])
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const patchApproval = async (id: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch('/api/opportunities', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval update failed')
    }
  }

  const toggleFilter = (id: OperatorOpportunityFilterId) => {
    setActiveFilters(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <section className="mx-auto mt-14 max-w-6xl rounded border border-white/10 bg-black/25 p-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-amber-400">Opportunity Scout</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Actionable family opportunities</h2>
          <p className="mt-1 max-w-2xl text-[10px] text-slate-500">
            Council-mandated opportunity packets — PROPOSED until Commander approval. Historical-pattern rows are not live-verified.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[9px] uppercase tracking-widest text-slate-500">
            Sort
            <select
              className="ml-2 rounded border border-white/15 bg-black/40 px-2 py-1 text-[10px] text-slate-200"
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
            >
              <option value="confidence">Confidence</option>
              <option value="roi">Est. ROI</option>
              <option value="startupCost">Launch cost</option>
              <option value="title">Title</option>
              <option value="generatedAt">Newest</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-1 text-[9px] uppercase tracking-widest text-slate-300 hover:bg-white/5"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTER_CHIPS.map(chip => {
          const on = Boolean(activeFilters[chip.id])
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggleFilter(chip.id)}
              className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${
                on ? 'border border-amber-400/50 bg-amber-400/10 text-amber-200' : 'border border-white/10 text-slate-500 hover:text-slate-300'
              }`}
            >
              {chip.label}
            </button>
          )
        })}
      </div>

      {error ? <p className="mb-3 text-[10px] text-red-300">{error}</p> : null}
      {loading ? <p className="text-[10px] text-slate-500">Loading opportunities…</p> : null}

      {!loading && opportunities.length === 0 ? (
        <p className="text-[10px] text-slate-500">No actionable opportunities match the current filters.</p>
      ) : null}

      {opportunities.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-slate-500">
                <th className="px-2 py-2">Title</th>
                <th className="px-2 py-2">Conf.</th>
                <th className="px-2 py-2">Launch</th>
                <th className="px-2 py-2">ROI</th>
                <th className="px-2 py-2">Provider</th>
                <th className="px-2 py-2">State</th>
                <th className="px-2 py-2">Commander</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map(opportunity => (
                <OpportunityRow
                  key={opportunity.id}
                  opportunity={opportunity}
                  onApprove={id => void patchApproval(id, 'approve')}
                  onReject={id => void patchApproval(id, 'reject')}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <MiniMetric label="Visible" value={String(opportunities.length)} />
        <MiniMetric
          label="Proposed"
          value={String(opportunities.filter(o => o.approvalStatus === 'PROPOSED').length)}
        />
        <MiniMetric
          label="Historical"
          value={String(opportunities.filter(o => o.evidenceLabel === 'HISTORICAL_PATTERN_BASED').length)}
        />
      </div>
    </section>
  )
}

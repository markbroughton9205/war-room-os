'use client'

import { useCallback, useEffect, useState } from 'react'

type SchemaSweepStatus = 'healthy' | 'drift_detected' | 'incomplete' | 'error'

type SweepPayload = {
  status: SchemaSweepStatus
  missingTables: string[]
  missingColumns: Array<{ table: string; column: string }>
  missingIndexes: Array<{ table: string; index: string }>
  missingConstraints: Array<{ table: string; constraint: string }>
  checkedAt: string
  recommendedNextAction: string
  introspectionMode?: string
  introspectionNote?: string
  repairPacketAvailable?: boolean
}

type RepairPacketPayload = {
  repairPacket?: {
    title: string
    summary: string
    combinedSql: string
    combinedCursorPrompt: string
  }
}

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function statusTone(status: SchemaSweepStatus) {
  if (status === 'healthy') return 'border-emerald-400/40 text-emerald-200'
  if (status === 'error') return 'border-rose-400/40 text-rose-200'
  if (status === 'incomplete') return 'border-amber-400/40 text-amber-200'
  return 'border-orange-400/40 text-orange-200'
}

function Badge({ value, status }: { value: string; status?: SchemaSweepStatus }) {
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${status ? statusTone(status) : 'border-white/15 text-slate-300'}`}>
      {label(value)}
    </span>
  )
}

export function SchemaSweepPanel() {
  const [sweep, setSweep] = useState<SweepPayload | null>(null)
  const [repair, setRepair] = useState<RepairPacketPayload['repairPacket'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [repairLoading, setRepairLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/schema/sweep', { cache: 'no-store', method: 'POST' })
      const body = await res.json() as SweepPayload
      if (!res.ok || body.status === 'error') {
        throw new Error(body.recommendedNextAction || 'Schema sweep is unavailable. Retry from Engineering View.')
      }
      setSweep(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schema sweep is unavailable. Retry from Engineering View.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRepairPacket = useCallback(async () => {
    setRepairLoading(true)
    setNotice(null)
    try {
      const res = await fetch('/api/schema/repair-packet', { cache: 'no-store' })
      const body = await res.json() as RepairPacketPayload
      if (!res.ok || !body.repairPacket) {
        throw new Error('Repair packet could not be prepared. Run Schema Sweep first.')
      }
      setRepair(body.repairPacket)
      setNotice('Repair packet loaded for manual Supabase review. War Room did not execute database changes.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair packet could not be prepared.')
    } finally {
      setRepairLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const copySql = async () => {
    if (!repair?.combinedSql) return
    try {
      await navigator.clipboard.writeText(repair.combinedSql)
      setNotice('SQL copied for manual Supabase review.')
    } catch {
      setNotice('Clipboard unavailable; copy SQL from the panel manually.')
    }
  }

  const status = sweep?.status ?? 'error'
  const showRepair = sweep?.repairPacketAvailable || (sweep?.missingTables.length ?? 0) > 0 || (sweep?.missingColumns.length ?? 0) > 0

  return (
    <section className="rounded border border-violet-900/40 bg-black/30 p-4">
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-violet-300">Phase 31</p>
          <h3 className="mt-1 text-sm font-semibold text-white">Schema Sweep</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Read-only diagnostics against the War Room schema manifest. No DDL runs from the browser.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={status} status={status} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Sweeping…' : 'Run sweep'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-3 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-[10px] text-rose-200">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-3 rounded border border-sky-500/30 bg-sky-500/10 p-2 text-[10px] text-sky-100">{notice}</div>
      ) : null}

      <div className="mb-3 text-[10px] text-slate-400">
        <span>Checked: {sweep?.checkedAt ? new Date(sweep.checkedAt).toLocaleString() : 'not yet'}</span>
        {sweep?.introspectionMode ? (
          <span className="ml-2 text-slate-500">· mode: {label(sweep.introspectionMode)}</span>
        ) : null}
      </div>

      {sweep?.recommendedNextAction ? (
        <div className="mb-3 rounded border border-white/10 bg-black/25 p-2 text-[10px] leading-relaxed text-slate-300">
          {sweep.recommendedNextAction}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded border border-white/10 bg-black/25 p-3">
          <h4 className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Missing tables</h4>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[10px] text-slate-300">
            {(sweep?.missingTables ?? []).length
              ? sweep!.missingTables.map(table => <li key={table}>{table}</li>)
              : <li className="text-slate-500">None detected.</li>}
          </ul>
        </section>
        <section className="rounded border border-white/10 bg-black/25 p-3">
          <h4 className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Missing columns</h4>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[10px] text-slate-300">
            {(sweep?.missingColumns ?? []).length
              ? sweep!.missingColumns.slice(0, 24).map(item => (
                <li key={`${item.table}.${item.column}`}>{item.table}.{item.column}</li>
              ))
              : <li className="text-slate-500">None detected.</li>}
          </ul>
        </section>
      </div>

      {showRepair ? (
        <div className="mt-3 rounded border border-violet-400/25 bg-violet-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-violet-200">Repair packet</h4>
              <p className="mt-1 text-[10px] text-violet-100/80">Advisory SQL for manual Supabase review.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadRepairPacket()}
                disabled={repairLoading}
                className="rounded border border-violet-400/40 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-violet-200 disabled:opacity-50"
              >
                {repairLoading ? 'Loading…' : 'Load repair packet'}
              </button>
              <button
                type="button"
                onClick={() => void copySql()}
                disabled={!repair?.combinedSql}
                className="rounded border border-sky-400/40 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-sky-200 disabled:opacity-50"
              >
                Copy SQL
              </button>
            </div>
          </div>
          {repair ? (
            <textarea
              readOnly
              value={repair.combinedSql}
              rows={8}
              className="mt-2 w-full resize-y rounded border border-white/10 bg-black/40 p-2 font-mono text-[9px] leading-relaxed text-slate-300"
            />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

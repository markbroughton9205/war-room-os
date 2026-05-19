'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SchemaFeatureId, SchemaRepairPacket, SchemaSweepSnapshot, SchemaTableDiagnostic } from '@/lib/schema-sweep'

type SchemaStatusPayload = Pick<
  SchemaSweepSnapshot,
  | 'generatedAt'
  | 'persistenceHealth'
  | 'persistenceNote'
  | 'summary'
  | 'affectedFeatures'
  | 'validationChecklist'
  | 'connectedSurfaces'
  | 'guardrails'
> & {
  missingTables: SchemaTableDiagnostic[]
  missingPolicies: SchemaTableDiagnostic[]
  migrationStatus: SchemaSweepSnapshot['migrations']
  repairPacketAvailable: boolean
  repairPacket: SchemaRepairPacket
}

function label(value: string) {
  return value.replace(/_/g, ' ')
}

function tone(value: string) {
  if (/critical|missing|failed|unavailable|degraded|drift/i.test(value)) return 'border-rose-400/40 text-rose-200'
  if (/unknown|manual|advisory|pending|cache/i.test(value)) return 'border-amber-400/40 text-amber-200'
  if (/ready|available|verified|healthy/i.test(value)) return 'border-emerald-400/40 text-emerald-200'
  return 'border-white/15 text-slate-300'
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${tone(value)}`}>
      {label(value)}
    </span>
  )
}

function Metric({ label: metricLabel, value, status }: { label: string; value: string; status?: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/25 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] uppercase tracking-widest text-slate-500">{metricLabel}</div>
        {status ? <Badge value={status} /> : null}
      </div>
      <div className="mt-1 font-mono text-sm text-sky-100">{value}</div>
    </div>
  )
}

function TableList({ title, tables }: { title: string; tables: SchemaTableDiagnostic[] }) {
  return (
    <section className="rounded border border-white/10 bg-black/25 p-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{title}</h3>
      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
        {tables.length ? tables.slice(0, 12).map(table => (
          <article key={`${title}-${table.table}`} className="rounded border border-white/10 bg-black/20 p-2 text-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-200">{table.table}</span>
              <Badge value={table.status} />
            </div>
            <p className="mt-1 text-slate-500">{label(table.feature)} · {table.migrationFile}</p>
            {table.missingColumns.length ? (
              <p className="mt-1 text-amber-100/80">Missing columns: {table.missingColumns.slice(0, 8).join(', ')}</p>
            ) : null}
          </article>
        )) : <div className="rounded border border-white/10 p-2 text-[10px] text-slate-500">None detected in latest sweep.</div>}
      </div>
    </section>
  )
}

export function SchemaSweepPanel() {
  const [snapshot, setSnapshot] = useState<SchemaStatusPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/schema/status', { cache: 'no-store' })
      const body = await res.json() as SchemaStatusPayload & { error?: string }
      if (!res.ok) throw new Error(body.error || 'Schema sweep status failed')
      setSnapshot(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schema sweep status failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const copy = async (kind: 'sql' | 'prompt') => {
    const packet = snapshot?.repairPacket
    if (!packet) return
    const value = kind === 'sql' ? packet.combinedSql : packet.combinedCursorPrompt
    try {
      await navigator.clipboard.writeText(value)
      setNotice(kind === 'sql'
        ? 'SQL copied for manual Supabase review. War Room did not execute database changes.'
        : 'Cursor prompt copied for manual Engineering Lane handoff.')
    } catch {
      setNotice('Clipboard unavailable; use the visible repair packet text manually.')
    }
  }

  const affectedFeatures = useMemo(
    () => (snapshot?.affectedFeatures ?? []).map((feature: SchemaFeatureId) => label(feature)).join(', ') || 'none',
    [snapshot?.affectedFeatures],
  )
  const issueCount = snapshot?.repairPacket.issues.length ?? 0
  const policyUnknown = snapshot ? Math.max(0, snapshot.summary.expectedTables - snapshot.summary.missingPolicies) : 0

  return (
    <section className="mx-auto mt-14 max-w-6xl border-t border-violet-900/50 pt-10">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-violet-300">Phase 22</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">Schema Sweep &amp; Migration Repair Intelligence</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">
            Read-only Supabase schema diagnostics for missing tables, columns, permissions, cache drift, and migration status. Repair packets are copy-only: no browser database mutation, no hidden execution, and no fake repaired state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={snapshot?.persistenceHealth ?? 'loading'} />
          <Badge value={snapshot?.repairPacketAvailable ? 'repair_packet_available' : 'no_packet_needed'} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-white/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-slate-300 disabled:opacity-50"
          >
            {loading ? 'Sweeping...' : 'Run Sweep'}
          </button>
        </div>
      </header>

      {error ? <div className="mb-4 rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">{notice}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <Metric label="Persistence Health" value={snapshot?.persistenceHealth ?? 'loading'} status={snapshot?.persistenceHealth} />
        <Metric label="Missing Tables" value={String(snapshot?.summary.missingTables ?? 0)} status={snapshot?.summary.missingTables ? 'missing' : 'ready'} />
        <Metric label="Missing Columns" value={String(snapshot?.summary.missingColumns ?? 0)} status={snapshot?.summary.missingColumns ? 'missing' : 'ready'} />
        <Metric label="Policies" value={`${snapshot?.summary.missingPolicies ?? 0} missing · ${policyUnknown} unknown`} status={snapshot?.summary.missingPolicies ? 'missing' : 'manual_validation'} />
        <Metric label="Migration Status" value={snapshot?.migrationStatus.status ?? 'checking'} status={snapshot?.migrationStatus.status} />
      </div>

      <div className="mb-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-400">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Last sweep: {snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString() : 'not run yet'}</span>
          <span>Affected features: {affectedFeatures}</span>
        </div>
        <p className="mt-2">{snapshot?.persistenceNote ?? 'Loading schema sweep status.'}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <aside className="space-y-4">
          <TableList title="Missing Tables" tables={snapshot?.missingTables ?? []} />
          <TableList title="Missing Policies / RLS" tables={snapshot?.missingPolicies ?? []} />
          <section className="rounded border border-white/10 bg-black/25 p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Connected Surfaces</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {(snapshot?.connectedSurfaces ?? []).map(surface => <Badge key={surface} value={surface} />)}
            </div>
          </section>
        </aside>

        <section className="space-y-4">
          <div className="rounded border border-violet-400/25 bg-violet-500/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{snapshot?.repairPacket.title ?? 'Schema repair packet loading'}</h3>
                <p className="mt-1 text-xs leading-relaxed text-violet-100">
                  {snapshot?.repairPacket.summary ?? 'A repair packet will appear after the first sweep.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge value="advisory_only" />
                  <Badge value="copy_only" />
                  <Badge value={`${issueCount}_issues`} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy('sql')} disabled={!snapshot} className="rounded border border-violet-400/40 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-violet-200 disabled:opacity-50">
                  Copy SQL
                </button>
                <button type="button" onClick={() => void copy('prompt')} disabled={!snapshot} className="rounded border border-sky-400/40 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-sky-200 disabled:opacity-50">
                  Copy Cursor Prompt
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={snapshot?.repairPacket.combinedSql ?? '-- Schema sweep has not loaded yet.'}
              rows={10}
              className="mt-3 w-full resize-y rounded border border-white/10 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-300"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded border border-white/10 bg-black/25 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Validation Checklist</h3>
              <ul className="mt-2 space-y-2 text-[10px] leading-relaxed text-slate-400">
                {(snapshot?.validationChecklist ?? []).map(item => <li key={item} className="rounded border border-white/10 p-2">{item}</li>)}
              </ul>
            </section>
            <section className="rounded border border-white/10 bg-black/25 p-3">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Migration Status</h3>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">{snapshot?.migrationStatus.detail ?? 'Migration status loading.'}</p>
              <div className="mt-3 grid gap-2 text-[10px] text-slate-500">
                <div className="rounded border border-white/10 p-2">Expected: {snapshot?.migrationStatus.expectedMigrations.length ?? 0}</div>
                <div className="rounded border border-white/10 p-2">Missing files recorded: {snapshot?.migrationStatus.missingMigrations.length ?? 0}</div>
                <div className="rounded border border-white/10 p-2">Orphaned records: {snapshot?.migrationStatus.orphanedMigrations.length ?? 0}</div>
              </div>
            </section>
          </div>
        </section>
      </div>

      <div className="mt-4 rounded border border-white/10 bg-black/25 p-3 text-[10px] leading-relaxed text-slate-500">
        Guardrails: {(snapshot?.guardrails ?? []).join(' ')}
      </div>
    </section>
  )
}

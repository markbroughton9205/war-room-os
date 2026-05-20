'use client'

import { useCallback, useMemo, useState } from 'react'

import { useWarRoomUiMode } from '@/components/war-room/WarRoomUiModeContext'
import type { SweepCategory, SweepFinding, SweepReport, SweepSeverity } from '@/lib/war-room-sweep/types'

const CATEGORY_LABELS: Record<SweepCategory, string> = {
  missing_configuration: 'Missing config',
  schema_database: 'Schema / DB',
  provider_runtime: 'Providers',
  signal_intelligence: 'Signals',
  ui_ux: 'UI / UX',
  engineering_runtime: 'Engineering',
  council_orchestration: 'Council',
  mission_revenue: 'Mission / revenue',
}

function severityColor(severity: SweepSeverity): string {
  if (severity === 'BLOCKER') return '#F87171'
  if (severity === 'HIGH') return '#FB923C'
  if (severity === 'MEDIUM') return '#FBBF24'
  if (severity === 'LOW') return '#94A3B8'
  return '#64748B'
}

export function WarRoomSweepPanel() {
  const { uiMode } = useWarRoomUiMode()
  const engineering = uiMode === 'advanced'
  const [report, setReport] = useState<SweepReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<SweepCategory | 'all'>('all')
  const [severityFilter, setSeverityFilter] = useState<SweepSeverity | 'all'>('all')
  const [notice, setNotice] = useState<string | null>(null)

  const runSweep = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/war-room/sweep', { method: 'POST', cache: 'no-store' })
      const body = await res.json() as SweepReport & { error?: string }
      if (!res.ok) throw new Error(body.error || 'OS sweep failed')
      setReport(body)
      setNotice(`Sweep complete · readiness ${body.summary.readinessScore}%`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OS sweep failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const filtered = useMemo(() => {
    if (!report) return []
    return report.findings.filter(f => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false
      return true
    })
  }, [report, categoryFilter, severityFilter])

  const generatePacket = async (finding: SweepFinding) => {
    setNotice(null)
    try {
      const res = await fetch(`/api/war-room/sweep?findingId=${encodeURIComponent(finding.id)}`, {
        method: 'PATCH',
        cache: 'no-store',
      })
      const body = await res.json() as { repairPacket?: { cursorReadyPrompt?: string }; error?: string }
      if (!res.ok || !body.repairPacket?.cursorReadyPrompt) {
        throw new Error(body.error || 'Repair packet unavailable')
      }
      await navigator.clipboard.writeText(body.repairPacket.cursorReadyPrompt)
      setNotice(`Repair packet copied for: ${finding.title}`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Repair packet failed')
    }
  }

  return (
    <section className="rounded border border-violet-500/25 bg-black/30 p-3" data-testid="war-room-sweep-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-violet-300">War Room OS Sweep</p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void runSweep()}
          className="rounded border border-violet-400/40 px-2 py-0.5 text-[7px] font-bold uppercase tracking-widest text-violet-200 disabled:opacity-40"
        >
          {loading ? 'Scanning…' : 'Run sweep'}
        </button>
      </div>

      {report?.generatedAt ? (
        <p className="mt-1 text-[8px] text-slate-500">Last sweep: {new Date(report.generatedAt).toLocaleString()}</p>
      ) : null}
      {error ? <p className="mt-1 text-[9px] text-red-300">{error}</p> : null}
      {notice ? <p className="mt-1 text-[8px] text-sky-200">{notice}</p> : null}

      {report?.summary && (
        <p className="mt-2 text-[10px] text-slate-300">
          {report.summary.readinessScore}% readiness · {report.summary.missingConfigCount} config ·{' '}
          {report.summary.repairCount} fixes · {report.summary.duplicateCount} dupes
        </p>
      )}

      {engineering && report ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            <FilterSelect
              label="Category"
              value={categoryFilter}
              options={['all', ...Object.keys(CATEGORY_LABELS)] as const}
              onChange={v => setCategoryFilter(v as SweepCategory | 'all')}
              format={v => (v === 'all' ? 'All' : CATEGORY_LABELS[v as SweepCategory])}
            />
            <FilterSelect
              label="Severity"
              value={severityFilter}
              options={['all', 'BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const}
              onChange={v => setSeverityFilter(v as SweepSeverity | 'all')}
              format={v => v}
            />
          </div>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {filtered.map(finding => (
              <li key={finding.id} className="rounded border border-white/10 bg-black/20 p-2 text-[9px]">
                <div className="flex flex-wrap items-center gap-1">
                  <span style={{ color: severityColor(finding.severity) }}>{finding.severity}</span>
                  <span className="text-slate-500">{CATEGORY_LABELS[finding.category]}</span>
                  <span className="text-slate-400">· {finding.classification}</span>
                </div>
                <p className="mt-0.5 font-semibold text-slate-200">{finding.title}</p>
                {!engineering ? null : (
                  <p className="text-slate-500">{finding.suggestedAction}</p>
                )}
                {engineering && finding.evidence.length ? (
                  <ul className="mt-1 list-inside list-disc text-[8px] text-slate-600">
                    {finding.evidence.slice(0, 3).map(line => (
                      <li key={line.slice(0, 40)}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                {engineering && (finding.repairPacketAvailable || finding.cursorReadyCommand) ? (
                  <button
                    type="button"
                    className="mt-1 text-[7px] uppercase tracking-widest text-violet-300 underline"
                    onClick={() => void generatePacket(finding)}
                  >
                    Generate repair packet
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {!engineering && report ? (
        <p className="mt-2 text-[8px] text-slate-500">
          Operator summary only. Switch to Engineering mode for full findings and repair packets.
        </p>
      ) : null}

      <p className="mt-2 text-[7px] text-slate-600">Diagnostic only · no auto mutation · secrets sanitized</p>
    </section>
  )
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  format,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (v: T) => void
  format: (v: T) => string
}) {
  return (
    <label className="flex items-center gap-1 text-[7px] text-slate-500">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="rounded border border-white/10 bg-black/40 px-1 py-0.5 text-[7px] text-slate-300"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>
            {format(opt)}
          </option>
        ))}
      </select>
    </label>
  )
}

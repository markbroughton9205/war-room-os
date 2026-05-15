'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { mapIntegrityRowsToRepairs } from '@/lib/runtime/runtimeRepairMap'
import type { RuntimeIntegrityResponse } from '@/lib/runtime/runtimeIntegrityTypes'
import { DiagnosticSessionPanel, type DiagnosticPanelState } from '@/components/war-room/runtime/DiagnosticSessionPanel'
import { SubsystemHealthCard } from '@/components/war-room/runtime/SubsystemHealthCard'
import { SystemStatusMatrix } from '@/components/war-room/runtime/SystemStatusMatrix'

export function RuntimeIntegrityDashboard({
  diagnosticSession,
  refreshIntervalMs = 45_000,
}: {
  diagnosticSession?: DiagnosticPanelState | null
  refreshIntervalMs?: number
}) {
  const [data, setData] = useState<RuntimeIntegrityResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/runtime/integrity', { cache: 'no-store' })
      const j = (await res.json()) as RuntimeIntegrityResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || res.statusText || 'Failed to load integrity')
      setData(j)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
  }, [load])

  useEffect(() => {
    if (!refreshIntervalMs) return
    const t = window.setInterval(() => void load(), refreshIntervalMs)
    return () => window.clearInterval(t)
  }, [load, refreshIntervalMs])

  const repairs = data ? mapIntegrityRowsToRepairs(data.subsystems) : []

  function overallTone(s: RuntimeIntegrityResponse['overallStatus']): string {
    switch (s) {
      case 'HEALTHY':
        return 'text-emerald-300'
      case 'DEGRADED':
      case 'PARTIAL':
        return 'text-amber-200'
      case 'FAILING':
        return 'text-rose-300'
      default:
        return 'text-white/80'
    }
  }

  return (
    <div className="space-y-6 text-white/90">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Runtime integrity</h2>
          <p className="text-xs text-white/50">
            Read-only aggregates (no secrets). Refreshes periodically.{' '}
            <Link href="/" className="text-emerald-300/90 underline-offset-4 hover:underline">
              War Room home
            </Link>
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {diagnosticSession !== undefined && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/45">Diagnostics session</div>
          <DiagnosticSessionPanel state={diagnosticSession ?? null} />
        </div>
      )}

      {err && <div className="rounded-md border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{err}</div>}

      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-white/45">Overall</div>
              <div className={`text-2xl font-semibold ${overallTone(data.overallStatus)}`}>{data.overallStatus}</div>
            </div>
            <div className="text-xs text-white/45">Generated {new Date(data.generatedAt).toLocaleString()}</div>
          </div>

          <SystemStatusMatrix rows={data.subsystems} />

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">High-signal cards</div>
            <div className="grid gap-3 md:grid-cols-2">
              {data.subsystems.map(s => (
                <SubsystemHealthCard key={s.id} row={s} />
              ))}
            </div>
          </div>

          {repairs.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-200/80">
                Repair map (approval required — no auto-execution)
              </div>
              <ul className="space-y-2 text-sm">
                {repairs.map(r => (
                  <li key={r.subsystemId} className="rounded-md border border-amber-500/20 bg-amber-950/20 px-3 py-2">
                    <div className="font-medium text-amber-100/95">{r.title}</div>
                    <div className="text-xs text-white/70">{r.summary}</div>
                    <div className="mt-1 text-[11px] text-white/45">
                      Severity: {r.severity} · Approval required: {String(r.approvalRequired)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

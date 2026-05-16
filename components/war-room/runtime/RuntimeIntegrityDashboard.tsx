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
  const [linkedSession, setLinkedSession] = useState<DiagnosticPanelState | null>(null)

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

  useEffect(() => {
    const tick = () => {
      try {
        const raw = sessionStorage.getItem('warRoomDiagnosticStrip')
        if (!raw) {
          setLinkedSession(null)
          return
        }
        const j = JSON.parse(raw) as DiagnosticPanelState
        setLinkedSession(j?.active ? j : null)
      } catch {
        setLinkedSession(null)
      }
    }
    tick()
    const id = window.setInterval(tick, 2000)
    return () => window.clearInterval(id)
  }, [])

  const repairs = data ? mapIntegrityRowsToRepairs(data.subsystems) : []
  const effectiveDiagnosticSession =
    diagnosticSession !== undefined && diagnosticSession !== null ? diagnosticSession : linkedSession

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

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/45">
          Sequential diagnostics
          {diagnosticSession === undefined ? (
            <span className="ml-2 font-normal normal-case text-white/40">(mirrored from Operations → Diagnostics tab)</span>
          ) : null}
        </div>
        <DiagnosticSessionPanel state={effectiveDiagnosticSession} />
      </div>

      {err && <div className="rounded-md border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{err}</div>}

      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-white/45">Overall</div>
              <div className={`text-2xl font-semibold ${overallTone(data.overallStatus)}`}>{data.overallStatus}</div>
            </div>
            <div className="text-xs text-white/45">Generated {new Date(data.generatedAt).toLocaleString()}</div>
            <div className="text-xs text-white/45">
              Attendance (integrity): <span className="text-white/70">{data.attendanceParticipation}</span>
            </div>
          </div>

          {(data.contradictions?.length ?? 0) > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/95">
              <div className="font-semibold uppercase tracking-wide text-amber-200/80">Contradictions (do not suppress)</div>
              <ul className="mt-1 list-inside list-disc space-y-1 text-white/75">
                {data.contradictions!.map((c, i) => (
                  <li key={`${c.kind}-${i}`}>{c.summary}</li>
                ))}
              </ul>
            </div>
          )}

          {(data.currentFailures?.length ?? 0) > 0 && (
            <div className="rounded-md border border-rose-500/35 bg-rose-950/30 px-3 py-2 text-xs">
              <div className="font-semibold uppercase tracking-wide text-rose-200/90">Current failures</div>
              <ul className="mt-1 space-y-1.5 text-white/80">
                {data.currentFailures!.map(f => (
                  <li key={f.subsystemId}>
                    <span className="text-rose-100/95">{f.label}</span>{' '}
                    <span className="text-white/45">({f.severity})</span>
                    <div className="mt-0.5 text-[11px] text-white/55">{f.evidence}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.historicalWarnings?.length ?? 0) > 0 && (
            <div className="rounded-md border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-white/80">
              <div className="font-semibold uppercase tracking-wide text-amber-200/85">Historical warnings</div>
              <ul className="mt-1 space-y-1.5">
                {data.historicalWarnings!.map(w => (
                  <li key={w.subsystemId}>
                    <span className="text-amber-100/90">{w.label}</span>{' '}
                    <span className="text-white/45">({w.severity})</span>
                    <div className="mt-0.5 text-[11px] text-white/55">{w.message}</div>
                    {w.staleAfter ? (
                      <div className="text-[10px] text-white/40">staleAfter: {new Date(w.staleAfter).toLocaleString()}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.optionalUnwired?.length ?? 0) > 0 && (
            <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
              <div className="font-semibold uppercase tracking-wide text-white/45">Optional / unwired</div>
              <ul className="mt-1 space-y-1">
                {data.optionalUnwired!.map(u => (
                  <li key={u.subsystemId}>
                    {u.label} <span className="text-white/40">({u.severity})</span>
                    <div className="text-[11px] text-white/50">{u.message}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.liveVerified?.length ?? 0) > 0 && (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100/90">
              <div className="font-semibold uppercase tracking-wide text-emerald-200/80">Live verified</div>
              <ul className="mt-1 space-y-1 font-mono text-[11px] text-emerald-100/85">
                {data.liveVerified!.map((v, i) => (
                  <li key={`${v.kind}-${i}`}>
                    [{v.kind}] {v.label}: {v.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.deployment?.commitShort || data.deployment?.lastDeployment) && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
              <span className="text-white/45">Deploy hint:</span>{' '}
              {data.deployment.commitShort ? <span className="text-sky-200/90">commit {data.deployment.commitShort}</span> : null}
              {data.deployment.lastDeployment ? (
                <span className="ml-2 text-white/60">· {data.deployment.lastDeployment}</span>
              ) : null}
            </div>
          )}

          {data.runtimeHealth && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
              <div className="font-semibold text-white/50">Runtime health</div>
              <div className="mt-1 text-white/70">
                Queue depth: {data.runtimeHealth.orchestrationQueueDepth}
                {data.runtimeHealth.councilModeFromQuery ? (
                  <span className="ml-3 text-white/55">councilMode(query): {data.runtimeHealth.councilModeFromQuery}</span>
                ) : null}
              </div>
              {data.runtimeHealth.unresolvedFailures?.length ? (
                <div className="mt-1 text-rose-200/90">
                  Unresolved failures:{' '}
                  {data.runtimeHealth.unresolvedFailures.map(f => f.label).join(', ')}
                </div>
              ) : null}
            </div>
          )}

          {data.toolsLayer && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80">
              <div className="font-semibold text-white/50">Tool layer</div>
              <div className="mt-1">
                Internet surface: <span className="text-emerald-200/80">{data.toolsLayer.internetToolStatus}</span>
                <span className="mx-2 text-white/35">·</span>
                Research adapters: <span className="text-emerald-200/80">{data.toolsLayer.researchAdapters}</span>
              </div>
              {data.toolsLayer.notes ? <div className="mt-1 text-white/55">{data.toolsLayer.notes}</div> : null}
            </div>
          )}

          {data.persistence && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
              <div className="font-semibold text-white/50">Persistence probes</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <div>conversations: {data.persistence.conversations}</div>
                <div>messages (assistant filter): {data.persistence.messages}</div>
                <div>actions: {data.persistence.actions}</div>
                <div>audit: {data.persistence.audit}</div>
                <div>memory proposals: {data.persistence.memoryProposals}</div>
              </div>
              {data.persistence.clientOnlyPersistenceFallbackLikely ? (
                <div className="mt-1 text-amber-200/85">Client-only persistence fallback likely (anon key missing).</div>
              ) : null}
            </div>
          )}

          {data.providers?.length ? (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
              <div className="font-semibold text-white/50">Provider / engine slots</div>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px]">
                {data.providers.map(p => (
                  <li key={p.id}>
                    {p.id}: cfg={String(p.configured)} rch={String(p.reachable)} fn={String(p.functional)} deg=
                    {String(p.degraded)} fail={String(p.failed)}
                    {p.lastSuccess ? ` · lastOK=${p.lastSuccess}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.internetRollup && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
              <div className="font-semibold text-white/50">Internet layer rollup</div>
              <div className="mt-1 text-white/60">
                {data.internetRollup.overallStatus ?? '—'} · {data.internetRollup.label ?? ''}
              </div>
            </div>
          )}

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

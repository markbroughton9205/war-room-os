'use client'

import { useCallback, useEffect, useState } from 'react'

import type { DeployStatusResponse, EnvReadinessResponse } from '@/lib/deploy/types'

const DEFAULT_POLL_MS = 120_000

type DeployPayload = DeployStatusResponse

export function DeploymentAwarenessPanel({ data }: { data: DeployPayload | null }) {
  if (!data) {
    return (
      <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
        <h3 className="mb-2 font-bold tracking-widest" style={{ color: '#7DD3FC' }}>DEPLOYMENT STATUS</h3>
        <p style={{ color: '#666' }}>Loading…</p>
      </section>
    )
  }
  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
      <h3 className="mb-2 font-bold tracking-widest" style={{ color: '#7DD3FC' }}>DEPLOYMENT AWARENESS</h3>
      {data.offlineHint && (
        <p className="mb-2 rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1.5 text-[10px] leading-snug text-amber-100">
          {data.offlineHint}
        </p>
      )}
      <dl className="space-y-1 font-mono text-[10px]" style={{ color: '#bbb' }}>
        <div className="flex justify-between gap-2"><dt>Provider</dt><dd>{data.provider}</dd></div>
        <div className="flex justify-between gap-2"><dt>Last deployment</dt><dd>{data.lastDeployment ?? '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt>Production URL (candidate)</dt><dd className="truncate text-right">{data.production.candidateUrl ?? '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt>URL sources</dt><dd className="text-right">{data.production.urlSources.length ? data.production.urlSources.join(', ') : '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt>Production probe</dt><dd>{data.production.productionReachable}</dd></div>
        <div className="flex justify-between gap-2"><dt>Local dev probe</dt><dd>{data.localDev.localDevProbe}</dd></div>
        <div className="flex justify-between gap-2"><dt>NODE_ENV</dt><dd>{data.localDev.nodeEnv}</dd></div>
        <div className="flex justify-between gap-2"><dt>Build script</dt><dd>{data.build.hasBuildScript ? 'yes' : 'no'}</dd></div>
      </dl>
      <p className="mt-2 text-[9px] leading-snug" style={{ color: '#666' }}>
        Localhost GET probe: set DEPLOY_STATUS_PROBE_LOCALHOST=1. Production HEAD probe: NEXT_PUBLIC_SITE_URL + DEPLOY_STATUS_PROBE_PRODUCTION=1.
      </p>
    </section>
  )
}

function EnvDot({ present }: { present: boolean }) {
  return (
    <span className="inline-block w-2 rounded-full" style={{ background: present ? '#34D399' : '#444' }} title={present ? 'present' : 'missing'} />
  )
}

export function EnvironmentReadinessPanel({ data }: { data: EnvReadinessResponse | null }) {
  if (!data) {
    return (
      <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
        <h3 className="mb-2 font-bold tracking-widest" style={{ color: '#A7F3D0' }}>ENVIRONMENT READINESS</h3>
        <p style={{ color: '#666' }}>Loading…</p>
      </section>
    )
  }
  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
      <h3 className="mb-2 font-bold tracking-widest" style={{ color: '#A7F3D0' }}>ENVIRONMENT READINESS</h3>
      <p className="mb-2 text-[9px]" style={{ color: '#666' }}>Source: {data.source} — presence only, never values.</p>
      <ul className="max-h-56 space-y-3 overflow-y-auto">
        {data.groups.map(g => (
          <li key={g.groupId} style={{ color: '#ccc' }}>
            <div className="font-bold tracking-wider" style={{ color: '#86EFAC' }}>{g.label}</div>
            {g.required.length > 0 && (
              <div className="mt-1 text-[10px]">
                <span style={{ color: '#888' }}>Required</span>
                <ul className="mt-0.5 space-y-0.5 font-mono">
                  {g.required.map(v => (
                    <li key={v.name} className="flex items-center gap-2">
                      <EnvDot present={v.present} />
                      {v.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {g.optional.length > 0 && (
              <div className="mt-1 text-[10px]">
                <span style={{ color: '#888' }}>Optional</span>
                <ul className="mt-0.5 space-y-0.5 font-mono">
                  {g.optional.map(v => (
                    <li key={v.name} className="flex items-center gap-2">
                      <EnvDot present={v.present} />
                      {v.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ProductionHealthPanel({ data }: { data: DeployPayload | null }) {
  if (!data) {
    return (
      <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
        <h3 className="mb-2 font-bold tracking-widest" style={{ color: '#FDE68A' }}>PRODUCTION HEALTH</h3>
        <p style={{ color: '#666' }}>Loading…</p>
      </section>
    )
  }
  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
      <h3 className="mb-2 font-bold tracking-widest" style={{ color: '#FDE68A' }}>PRODUCTION HEALTH</h3>
      <div className="mb-2 text-[10px]" style={{ color: '#aaa' }}>
        Supabase URL / anon / service role:
        {' '}
        <span className="font-mono">{String(data.supabase.urlPresent)}</span>
        {' / '}
        <span className="font-mono">{String(data.supabase.anonKeyPresent)}</span>
        {' / '}
        <span className="font-mono">{String(data.supabase.serviceRolePresent)}</span>
      </div>
      {data.blockers.length > 0 && (
        <ul className="mb-2 max-h-24 space-y-1 overflow-y-auto text-[10px]">
          {data.blockers.map(b => (
            <li key={b.id} style={{ color: b.severity === 'blocking' ? '#FCA5A5' : '#FDE047' }}>
              [{b.severity}] {b.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mb-1 text-[10px] font-bold tracking-wider" style={{ color: '#93C5FD' }}>Engines</div>
      <ul className="mb-2 max-h-32 space-y-0.5 overflow-y-auto font-mono text-[9px]" style={{ color: '#bbb' }}>
        {(data.engines ?? []).map(e => (
          <li key={e.id}>
            {e.id}
            {' '}
            cfg
            {String(e.configured)}
            {' '}
            rch
            {String(e.reachable)}
            {' '}
            fn
            {String(e.functional)}
          </li>
        ))}
        {!data.engines?.length && <li style={{ color: '#666' }}>—</li>}
      </ul>
      <div className="mb-1 text-[10px] font-bold tracking-wider" style={{ color: '#93C5FD' }}>Internet layer</div>
      <pre className="max-h-28 overflow-auto text-[9px]" style={{ color: '#888' }}>{data.internet ? JSON.stringify(data.internet, null, 2) : '—'}</pre>
    </section>
  )
}

export function Phase5DeployPanels({
  autoRefreshEnabled = false,
  tabActive = true,
  pollIntervalMs = DEFAULT_POLL_MS,
}: {
  autoRefreshEnabled?: boolean
  tabActive?: boolean
  pollIntervalMs?: number
} = {}) {
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<DeployPayload | null>(null)
  const [env, setEnv] = useState<EnvReadinessResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const load = useCallback(async () => {
    try {
      const [resS, resE] = await Promise.all([
        fetch('/api/deploy/status', { cache: 'no-store' }),
        fetch('/api/deploy/env', { cache: 'no-store' }),
      ])
      const [jS, jE] = await Promise.all([
        resS.json() as Promise<DeployPayload>,
        resE.json() as Promise<EnvReadinessResponse>,
      ])
      if (!resS.ok) throw new Error((jS as { error?: string }).error || resS.statusText)
      if (!resE.ok) throw new Error((jE as { error?: string }).error || resE.statusText)
      setStatus(jS)
      setEnv(jE)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Deploy readiness failed')
      setStatus(null)
      setEnv(null)
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    const t = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(t)
  }, [mounted, load])

  useEffect(() => {
    if (!mounted || !autoRefreshEnabled) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (!tabActive) return
      void load()
    }
    const t = window.setInterval(tick, Math.max(pollIntervalMs, 120_000))
    return () => window.clearInterval(t)
  }, [mounted, autoRefreshEnabled, tabActive, pollIntervalMs, load])

  if (!mounted) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold tracking-widest" style={{ color: '#D4AF37' }}>DEPLOYMENT READINESS</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] opacity-60">
            {autoRefreshEnabled ? `auto · ${Math.max(pollIntervalMs, 120_000) / 1000}s` : 'manual refresh'}
          </span>
          <button
            type="button"
            className="rounded px-2 py-1 text-[10px] font-bold"
            style={{ border: '1px solid #555', color: '#ccc' }}
            onClick={() => void load()}
          >
            REFRESH
          </button>
        </div>
      </div>
      {err && <div className="text-[11px]" style={{ color: '#fca5a5' }}>{err}</div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <DeploymentAwarenessPanel data={status} />
        <EnvironmentReadinessPanel data={env} />
        <ProductionHealthPanel data={status} />
      </div>
    </div>
  )
}

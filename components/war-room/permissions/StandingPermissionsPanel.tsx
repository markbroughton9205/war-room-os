'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'

type PermissionsStatusResponse = {
  mode: StandingPermissionMode
  safetyLock: boolean
  autoAllowedCatalog: string[]
  requiresApprovalCatalog: string[]
  lastAutoAction: { at: string; kind: string; detail: Record<string, unknown> } | null
  error?: string
}

function readPersistence(res: Response) {
  return res.headers.get('x-war-room-persistence') ?? 'unknown'
}

export function StandingPermissionsPanel() {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [persistence, setPersistence] = useState('unknown')
  const [status, setStatus] = useState<PermissionsStatusResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/permissions/status', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = (await res.json()) as PermissionsStatusResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'Failed to load standing permissions')
      setStatus(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const t = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(t)
  }, [mounted, load])

  const postUpdate = async (patch: { mode?: StandingPermissionMode; safetyLock?: boolean }) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/permissions/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setPersistence(readPersistence(res))
      const j = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(j.error || 'Update failed')
      await load()
      window.dispatchEvent(new CustomEvent('war-room-permissions-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) {
    return (
      <div className="rounded p-3 text-xs" style={{ border: '1px solid #333', color: '#666' }}>
        Standing permissions…
      </div>
    )
  }

  return (
    <section className="rounded p-3 text-xs" style={{ border: '1px solid #333', background: 'rgba(0,0,0,0.25)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold tracking-widest" style={{ color: '#A7F3D0' }}>STANDING PERMISSIONS</span>
        <button
          type="button"
          className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
          style={{ border: '1px solid #444', color: '#ccc' }}
          onClick={() => void load()}
          disabled={loading}
        >
          REFRESH
        </button>
      </div>
      <p className="mb-2 text-[10px]" style={{ color: '#888' }}>
        Persistence: <span style={{ color: persistence === 'available' ? '#34D399' : '#FBBF24' }}>{persistence.toUpperCase()}</span>
      </p>
      {error && <div className="mb-2 text-[11px]" style={{ color: '#fca5a5' }}>{error}</div>}
      {loading && !status ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : status ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>MODE</label>
            <select
              className="w-full rounded bg-black px-2 py-1 font-mono text-[11px]"
              style={{ border: '1px solid #333', color: '#eee' }}
              value={status.mode}
              disabled={saving}
              onChange={e => {
                const mode = e.target.value as StandingPermissionMode
                void postUpdate({ mode })
              }}
            >
              <option value="manual">manual — minimal auto-allow</option>
              <option value="operator">operator (default catalog)</option>
              <option value="commander">commander — operator + route planning / QA read</option>
            </select>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: '#ddd' }}>
              <input
                type="checkbox"
                checked={status.safetyLock}
                disabled={saving}
                onChange={e => void postUpdate({ safetyLock: e.target.checked })}
              />
              Safety lock (auto catalog needs standing_override or approval_granted per POST)
            </label>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: '#888' }}>LAST AUTO-RUN</div>
            {status.lastAutoAction ? (
              <div className="font-mono text-[10px]" style={{ color: '#ccc' }}>
                <div>{status.lastAutoAction.at}</div>
                <div style={{ color: '#A7F3D0' }}>{status.lastAutoAction.kind}</div>
              </div>
            ) : (
              <div style={{ color: '#666' }}>None recorded.</div>
            )}
          </div>
          <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: '#34D399' }}>AUTO-ALLOWED (policy)</div>
              <ul className="max-h-32 overflow-y-auto text-[10px] font-mono" style={{ color: '#9CA3AF' }}>
                {status.autoAllowedCatalog.map(k => (
                  <li key={k}>{k}</li>
                ))}
                {!status.autoAllowedCatalog.length && <li style={{ color: '#666' }}>—</li>}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold tracking-widest" style={{ color: '#FBBF24' }}>APPROVAL REQUIRED</div>
              <ul className="max-h-32 overflow-y-auto text-[10px] font-mono" style={{ color: '#9CA3AF' }}>
                {status.requiresApprovalCatalog.map(k => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

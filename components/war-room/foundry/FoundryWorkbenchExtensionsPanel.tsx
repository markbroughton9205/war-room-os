'use client'

/**
 * W6 Commander EXTENSIONS panel. Recommendations are not approval.
 * OpenVSX is labeled as an extension source, not the VS Code Marketplace.
 */
import { useEffect, useState } from 'react'

type RecordView = {
  extensionId: string
  version: string
  publisher: string
  sourceType: string
  license: string
  linuxCompat: string
  capabilities: string[]
  status: string
  sha256?: string
  enabled: boolean
  trusted: boolean
  reason?: string
}

type Snapshot = {
  enabled?: boolean
  tabLabel?: string
  records?: RecordView[]
  recommendations?: Array<{ extensionId: string; text: string; approved: boolean }>
  openvsxLabel?: string
  marketplace?: string
}

export function FoundryWorkbenchExtensionsPanel({ enabled }: { enabled: boolean }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [tab, setTab] = useState<'Installed' | 'Available' | 'Updates' | 'Quarantined'>('Installed')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/foundry/workbench/extensions', { cache: 'no-store' })
        const data = await res.json() as Snapshot
        if (!cancelled) setSnap(data)
      } catch {
        /* ignore */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled])

  if (!enabled) return null

  const records = snap?.records || []
  const filtered = records.filter(item => {
    if (tab === 'Installed') return item.status === 'INSTALLED' || item.status === 'ACTIVE' || item.status === 'DISABLED'
    if (tab === 'Available') return item.status === 'DISCOVERED' || item.status === 'REVIEW_PENDING' || item.status === 'APPROVED'
    if (tab === 'Updates') return item.status === 'UPDATE_AVAILABLE'
    return item.status === 'QUARANTINED'
  })
  const detail = records.find(item => item.extensionId === selected) || filtered[0]

  async function act(action: string) {
    if (!detail || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/foundry/workbench/extensions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, extensionId: detail.extensionId, commanderApproved: true }),
      })
      const data = await res.json() as Snapshot
      setSnap(data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 rounded border border-emerald-400/25 p-2" data-testid="foundry-w6-extensions">
      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Extensions</p>
      <p className="text-[9px] uppercase tracking-widest text-slate-500" data-testid="foundry-w6-openvsx-label">{snap?.openvsxLabel || 'Extension Source: OpenVSX'}</p>
      <p className="text-[9px] uppercase tracking-widest text-slate-600">Not VS Code Marketplace · {snap?.marketplace || 'MICROSOFT_MARKETPLACE_ENABLED=NO'}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {(['Installed', 'Available', 'Updates', 'Quarantined'] as const).map(name => (
          <button key={name} type="button" className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${tab === name ? 'border-emerald-400/60 text-emerald-200' : 'border-white/15 text-slate-400'}`} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>
      {(snap?.recommendations || []).map(item => (
        <p key={`${item.extensionId}-${item.text}`} className="mt-1 text-[10px] text-cyan-200" data-testid="foundry-w6-recommendation">Recommendation (not approval): {item.text}</p>
      ))}
      <div className="mt-1 max-h-24 overflow-auto">
        {filtered.map(item => (
          <button key={`${item.extensionId}@${item.version}`} type="button" className="block w-full truncate px-1 text-left text-[10px] text-slate-200" onClick={() => setSelected(item.extensionId)}>
            {item.extensionId}@{item.version} · {item.status}
          </button>
        ))}
        {!filtered.length ? <p className="text-[10px] text-slate-500">None</p> : null}
      </div>
      {detail ? (
        <div className="mt-1 rounded border border-white/10 p-1 text-[10px] text-slate-300" data-testid="foundry-w6-extension-detail">
          <p>{detail.extensionId} {detail.version}</p>
          <p>publisher {detail.publisher} · source {detail.sourceType} · license {detail.license}</p>
          <p>Linux {detail.linuxCompat} · capabilities {detail.capabilities.join(', ')}</p>
          <p>approval {detail.status} · trusted {String(detail.trusted)} · hash {detail.sha256?.slice(0, 16) || 'none'}</p>
          {detail.reason ? <p>review {detail.reason}</p> : null}
          <div className="mt-1 flex flex-wrap gap-1">
            {['REVIEW', 'INSTALL', 'ENABLE', 'DISABLE', 'UPDATE', 'REMOVE'].map(name => (
              <button key={name} type="button" disabled={busy} className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[9px] uppercase text-emerald-200" onClick={() => void act(name.toLowerCase())}>{name}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

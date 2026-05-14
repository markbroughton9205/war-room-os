'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MemoryContextResponse, MemoryFamilyPartition, MemoryProposal } from '@/lib/memory/types'
import { MEMORY_FAMILY_PARTITIONS } from '@/lib/memory/types'

function readPersistence(res: Response) {
  return res.headers.get('x-war-room-persistence') ?? 'unknown'
}

export function Phase6MemoryPanels({ autoLoad = false }: { autoLoad?: boolean }) {
  const [persistence, setPersistence] = useState('unknown')
  const [pending, setPending] = useState<MemoryProposal[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)

  const [partition, setPartition] = useState<MemoryFamilyPartition>('ChatGPT Family')
  const [familyCtx, setFamilyCtx] = useState<MemoryContextResponse | null>(null)
  const [familyLoading, setFamilyLoading] = useState(false)

  const [continuity, setContinuity] = useState<MemoryContextResponse | null>(null)
  const [continuityLoading, setContinuityLoading] = useState(false)

  const loadPending = useCallback(async () => {
    setPendingLoading(true)
    setPendingError(null)
    try {
      const res = await fetch('/api/memory/proposals', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = (await res.json()) as { proposals?: MemoryProposal[]; error?: string }
      if (!res.ok) throw new Error(j.error || 'Failed to load proposals')
      setPending(Array.isArray(j.proposals) ? j.proposals : [])
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : 'Load failed')
      setPending([])
    } finally {
      setPendingLoading(false)
    }
  }, [])

  const loadFamily = useCallback(async () => {
    setFamilyLoading(true)
    try {
      const res = await fetch(
        `/api/memory/context?partition=${encodeURIComponent(partition)}&limit=24`,
        { cache: 'no-store' },
      )
      setPersistence(readPersistence(res))
      const j = (await res.json()) as MemoryContextResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'Context failed')
      setFamilyCtx(j)
    } catch {
      setFamilyCtx(null)
    } finally {
      setFamilyLoading(false)
    }
  }, [partition])

  const loadContinuity = useCallback(async () => {
    setContinuityLoading(true)
    try {
      const res = await fetch('/api/memory/context?limit=12', { cache: 'no-store' })
      setPersistence(readPersistence(res))
      const j = (await res.json()) as MemoryContextResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'Context failed')
      setContinuity(j)
    } catch {
      setContinuity(null)
    } finally {
      setContinuityLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!autoLoad) return
    const t = window.setTimeout(() => {
      void loadPending()
      void loadContinuity()
    }, 0)
    return () => window.clearTimeout(t)
  }, [autoLoad, loadPending, loadContinuity])

  useEffect(() => {
    if (!autoLoad) return
    const t = window.setTimeout(() => {
      void loadFamily()
    }, 0)
    return () => window.clearTimeout(t)
  }, [autoLoad, loadFamily])

  const approve = async (id: string) => {
    const res = await fetch('/api/memory/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: id }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) {
      void loadPending()
      void loadFamily()
      void loadContinuity()
    } else {
      const j = (await res.json()) as { error?: string }
      window.alert(j.error || 'Approve failed')
    }
  }

  const reject = async (id: string) => {
    const reason = window.prompt('Reject reason (optional)') ?? ''
    const res = await fetch('/api/memory/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalId: id, reason: reason.trim() || undefined }),
    })
    setPersistence(readPersistence(res))
    if (res.ok) void loadPending()
    else {
      const j = (await res.json()) as { error?: string }
      window.alert(j.error || 'Reject failed')
    }
  }

  const babyQueue = pending.filter(p => p.family_partition === 'Baby AI Observer')

  return (
    <div className="mt-4 space-y-4">
      <div className="text-[10px] font-bold tracking-[0.25em]" style={{ color: '#94A3B8' }}>
        PHASE 6 — MEMORY + IDENTITY · persistence: {persistence}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded p-3 text-xs" style={{ border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#34D399' }}>MEMORY APPROVAL</span>
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold tracking-widest"
              style={{ border: '1px solid #444', color: '#ccc' }}
              onClick={() => void loadPending()}
              disabled={pendingLoading}
            >
              REFRESH
            </button>
          </div>
          {pendingError ? <p style={{ color: '#F87171' }}>{pendingError}</p> : null}
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {pending.map(p => (
              <li key={p.id} className="rounded border border-white/10 p-2" style={{ color: '#ddd' }}>
                <div className="text-[10px]" style={{ color: '#6EE7B7' }}>{p.family_partition}</div>
                <div className="mt-1 font-semibold">{p.title}</div>
                <div className="mt-1 text-[10px] opacity-80" style={{ color: '#999' }}>
                  {p.content_redacted.slice(0, 220)}
                  {p.content_redacted.length > 220 ? '…' : ''}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] font-bold"
                    style={{ background: '#059669', color: '#fff' }}
                    onClick={() => void approve(p.id)}
                  >
                    APPROVE
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] font-bold"
                    style={{ background: '#7F1D1D', color: '#FECACA' }}
                    onClick={() => void reject(p.id)}
                  >
                    REJECT
                  </button>
                </div>
              </li>
            ))}
            {!pending.length && <li style={{ color: '#666' }}>No pending memory proposals.</li>}
          </ul>
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#60A5FA' }}>FAMILY MEMORY</span>
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{ border: '1px solid #444', color: '#ccc' }}
              onClick={() => void loadFamily()}
              disabled={familyLoading}
            >
              REFRESH
            </button>
          </div>
          <select
            className="mb-2 w-full rounded bg-black px-2 py-1 text-[10px] font-mono"
            style={{ border: '1px solid #444', color: '#ccc' }}
            value={partition}
            onChange={e => setPartition(e.target.value as MemoryFamilyPartition)}
          >
            {MEMORY_FAMILY_PARTITIONS.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {(familyCtx?.snippets ?? []).map(s => (
              <li key={s.id} className="border-b border-white/5 pb-2" style={{ color: '#bbb' }}>
                <div className="font-semibold" style={{ color: '#93C5FD' }}>{s.title}</div>
                <div className="mt-1 text-[10px]" style={{ color: '#888' }}>{s.preview}</div>
              </li>
            ))}
            {!familyCtx?.snippets?.length && <li style={{ color: '#666' }}>No approved rows for this partition (yet).</li>}
          </ul>
          {familyCtx?.familyContext ? (
            <details className="mt-2" style={{ color: '#777' }}>
              <summary className="cursor-pointer text-[10px] font-bold tracking-widest">Prompt block preview</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[9px]">{familyCtx.familyContext}</pre>
            </details>
          ) : null}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded p-3 text-xs" style={{ border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#FBBF24' }}>MISSION CONTINUITY</span>
            <button
              type="button"
              className="rounded px-2 py-1 text-[10px] font-bold"
              style={{ border: '1px solid #444', color: '#ccc' }}
              onClick={() => void loadContinuity()}
              disabled={continuityLoading}
            >
              REFRESH
            </button>
          </div>
          {continuity?.operationalNote ? (
            <p className="mb-2 text-[10px]" style={{ color: '#A8A29E' }}>{continuity.operationalNote}</p>
          ) : null}
          <pre className="max-h-64 overflow-auto rounded p-2 text-[10px]" style={{ border: '1px solid #333', color: '#d4d4d8' }}>
            {JSON.stringify(continuity?.operational ?? {}, null, 2)}
          </pre>
        </section>

        <section className="rounded p-3 text-xs" style={{ border: '1px solid rgba(244,114,182,0.35)', background: 'rgba(0,0,0,0.28)' }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold tracking-widest" style={{ color: '#F472B6' }}>BABY AI LEARNING QUEUE</span>
            <span className="text-[10px]" style={{ color: '#888' }}>{babyQueue.length} pending</span>
          </div>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {babyQueue.map(p => (
              <li key={p.id} className="rounded border border-white/10 p-2" style={{ color: '#ddd' }}>
                <div className="font-semibold">{p.title}</div>
                <div className="mt-1 text-[10px]" style={{ color: '#9CA3AF' }}>
                  {p.content_redacted.length > 160 ? `${p.content_redacted.slice(0, 160)}…` : p.content_redacted}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] font-bold"
                    style={{ background: '#059669', color: '#fff' }}
                    onClick={() => void approve(p.id)}
                  >
                    APPROVE
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] font-bold"
                    style={{ background: '#7F1D1D', color: '#FECACA' }}
                    onClick={() => void reject(p.id)}
                  >
                    REJECT
                  </button>
                </div>
              </li>
            ))}
            {!babyQueue.length && <li style={{ color: '#666' }}>No Baby AI Observer proposals in queue.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}

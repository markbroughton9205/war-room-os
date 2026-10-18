'use client'

/**
 * W2 Composer binding: editor-context chips + proposal accept/reject.
 * Workbench commands still apply through Foundry APIs / Tool Broker.
 */
import { useEffect, useRef, useState } from 'react'

type Chips = {
  file: string | null
  selection: string | null
  diagnostics: string | null
  symbol: string | null
  sensitive: string | null
  terminal: string | null
  git: string | null
  debug: string | null
  test: string | null
}

type Proposal = {
  proposalId: string
  status: string
  filePath: string
  reason: string
  instruction: string
}

type Snapshot = {
  enabled?: boolean
  chips?: Chips
  lastResponse?: { ok?: boolean; text?: string; kind?: string; proposal?: Proposal | null; error?: string }
  proposal?: Proposal | null
  openComposer?: { at: string } | null
}

export function FoundryWorkbenchAiPanel({ enabled, onFocusPrompt }: { enabled: boolean; onFocusPrompt: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const focusRef = useRef(onFocusPrompt)
  focusRef.current = onFocusPrompt

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch('/api/foundry/workbench/editor', { cache: 'no-store' })
        const data = await res.json() as Snapshot
        if (!cancelled) {
          setSnap(data)
          if (data.openComposer) focusRef.current()
        }
      } catch {
        /* ignore */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled])

  if (!enabled) return null
  const chips = snap?.chips
  const proposal = snap?.lastResponse?.proposal || snap?.proposal
  const text = snap?.lastResponse?.text

  async function act(action: 'accept' | 'reject') {
    if (!proposal?.proposalId || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/foundry/workbench/editor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, proposalId: proposal.proposalId }),
      })
      const data = await res.json() as Snapshot & { text?: string; proposal?: Proposal }
      setSnap(current => ({ ...current, lastResponse: data, proposal: data.proposal ?? current?.proposal }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 space-y-2" data-testid="foundry-w2-composer">
      <div className="flex flex-wrap gap-1" data-testid="foundry-w2-context-chips">
        {chips?.file ? <span className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-200">{chips.file}</span> : null}
        {chips?.selection ? <span className="rounded border border-cyan-400/30 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200">{chips.selection}</span> : null}
        {chips?.diagnostics ? <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-amber-200">{chips.diagnostics}</span> : null}
        {chips?.symbol ? <span className="rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-300">{chips.symbol}</span> : null}
        {chips?.sensitive ? <span className="rounded border border-red-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-red-300">{chips.sensitive}</span> : null}
        {chips?.terminal ? <span className="rounded border border-cyan-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-cyan-200">{chips.terminal}</span> : null}
        {chips?.git ? <span className="rounded border border-amber-300/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-amber-100">{chips.git}</span> : null}
        {chips?.debug ? <span className="rounded border border-fuchsia-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-fuchsia-200">{chips.debug}</span> : null}
        {chips?.test ? <span className="rounded border border-rose-400/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-rose-200">{chips.test}</span> : null}
        {!chips?.file && !chips?.selection ? <span className="text-[9px] uppercase tracking-widest text-slate-500">No editor context</span> : null}
      </div>
      {text ? (
        <p className="rounded border border-emerald-400/20 bg-black/30 p-2 text-[11px] text-emerald-100" data-testid="foundry-w2-response">{text}</p>
      ) : null}
      {proposal && (proposal.status === 'PROPOSED' || proposal.status === 'ACCEPTED') ? (
        <div className="rounded border border-cyan-400/30 p-2" data-testid="foundry-w2-proposal">
          <p className="text-[10px] uppercase tracking-widest text-cyan-300">Foundry proposal · {proposal.filePath}</p>
          <p className="mt-1 text-[11px] text-slate-200">{proposal.reason}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="foundry-w2-accept" disabled={busy} className="rounded border border-emerald-500/50 px-2 py-0.5 text-[10px] uppercase text-emerald-200" onClick={() => void act('accept')}>Accept</button>
            <button type="button" data-testid="foundry-w2-reject" disabled={busy} className="rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase text-slate-300" onClick={() => void act('reject')}>Reject</button>
            <span className="self-center text-[9px] uppercase tracking-widest text-slate-500">Explain Change is in the response above</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

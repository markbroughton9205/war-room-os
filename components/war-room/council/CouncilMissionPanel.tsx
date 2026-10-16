'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CouncilMissionProposal } from '@/lib/council/missions/types'

const ACTIVE = new Set(['RUNNING', 'INTERRUPTED'])
const CONTROL_HEADER = { 'Content-Type': 'application/json', 'x-wr-council-missions': '1' }

const STATUS_STYLE: Record<string, string> = {
  PROPOSED: 'border-amber-400/60 text-amber-200',
  START_FAILED: 'border-red-500/60 text-red-300',
  RUNNING: 'border-cyan-400/60 text-cyan-200',
  INTERRUPTED: 'border-amber-500/60 text-amber-300',
  COMPLETED: 'border-emerald-400/70 text-emerald-200',
  FAILED: 'border-red-500/70 text-red-300',
  CANCELLED: 'border-slate-500/60 text-slate-300',
  REJECTED: 'border-slate-500/60 text-slate-300',
}

function pathsFrom(text: string): string[] {
  const found = text.match(/[A-Za-z0-9_@./-]+\.(?:tsx?|jsx?|mjs|cjs|py|json|md|css|html|sh|yml|yaml)\b/g) ?? []
  return Array.from(new Set(found.filter(p => !p.startsWith('/') && !p.includes('..'))))
}

/**
 * Council -> Foundry missions for the open conversation. A proposal is only a draft until the Commander approves it here; the status
 * shown is whatever Foundry's own mission record says (this panel never marks anything complete itself).
 */
export function CouncilMissionPanel({
  conversationId,
  lastCommanderText = '',
  onResultReturned,
}: {
  conversationId: string | null
  lastCommanderText?: string
  onResultReturned?: () => void
}) {
  const [proposals, setProposals] = useState<CouncilMissionProposal[]>([])
  const [foundry, setFoundry] = useState<{ ok: boolean; reason?: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState('')
  const [paths, setPaths] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const returnedRef = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!conversationId) { setProposals([]); return }
    try {
      const res = await fetch(`/api/council/missions?conversationId=${encodeURIComponent(conversationId)}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json() as { proposals?: CouncilMissionProposal[]; foundry?: { ok: boolean; reason?: string } }
      const rows = Array.isArray(j.proposals) ? j.proposals : []
      setProposals(rows)
      if (j.foundry) setFoundry(j.foundry)
      for (const p of rows) {
        if (p.resultReturned && !returnedRef.current.has(p.proposalId)) {
          returnedRef.current.add(p.proposalId)
          onResultReturned?.()
        }
      }
    } catch { /* panel is optional */ }
  }, [conversationId, onResultReturned])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set from the response
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!proposals.some(p => ACTIVE.has(p.status))) return
    const t = window.setInterval(() => { void load() }, 4000)
    return () => window.clearInterval(t)
  }, [proposals, load])

  // The sync that returned a result runs on the server; mark already-returned ones so a reopen does not re-announce them.
  useEffect(() => {
    for (const p of proposals) if (p.resultReturned && p.status && !ACTIVE.has(p.status)) returnedRef.current.add(p.proposalId)
  }, [proposals])

  const post = async (body: Record<string, unknown>) => {
    if (!conversationId) return null
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/council/missions', { method: 'POST', headers: CONTROL_HEADER, body: JSON.stringify({ conversationId, ...body }) })
      const j = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(j.error ?? `Request failed (${res.status})`); return null }
      await load()
      return j
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    const targetPaths = paths.split(/[,\n]/).map(p => p.trim()).filter(Boolean)
    const res = await post({
      action: 'propose',
      request: request.trim(),
      acceptance: acceptance.split('\n').map(a => a.trim()).filter(Boolean),
      targets: targetPaths.map(path => ({ path, action: 'modify' })),
    })
    if (res) { setOpen(false); setRequest(''); setPaths(''); setAcceptance('') }
  }

  if (!conversationId) return null
  const visible = proposals.filter(p => p.status !== 'REJECTED' || !p.resultReturned)

  return (
    <section
      className="mt-2 rounded-lg border border-cyan-500/25 px-3 py-2"
      style={{ background: 'rgba(0,10,14,0.55)' }}
      data-testid="council-mission-panel"
      aria-label="Foundry missions from this discussion"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">
          Foundry missions{visible.length ? ` (${visible.length})` : ''}
        </p>
        <button
          type="button"
          className="rounded border border-cyan-400/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-200 hover:bg-cyan-400/10"
          onClick={() => {
            setOpen(o => !o)
            if (!request) {
              setRequest(lastCommanderText.slice(0, 1000))
              setPaths(pathsFrom(lastCommanderText).join(', '))
            }
          }}
          data-testid="council-mission-propose-toggle"
        >
          {open ? 'Close' : 'Propose mission'}
        </button>
      </div>

      {foundry && !foundry.ok ? (
        <p className="mt-1 text-[10px] text-amber-300" data-testid="council-mission-foundry-unavailable">
          Foundry cannot start missions right now: {foundry.reason}
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-1.5" data-testid="council-mission-form">
          <textarea
            value={request}
            onChange={e => setRequest(e.target.value)}
            rows={3}
            placeholder="What should Foundry build or fix? Be specific; name the files."
            className="w-full rounded border border-cyan-900/50 bg-black/40 px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-400/50"
            data-testid="council-mission-request"
          />
          <input
            value={paths}
            onChange={e => setPaths(e.target.value)}
            placeholder="Files to change, comma separated (e.g. calc.mjs)"
            className="w-full rounded border border-cyan-900/50 bg-black/40 px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-400/50"
            data-testid="council-mission-paths"
          />
          <textarea
            value={acceptance}
            onChange={e => setAcceptance(e.target.value)}
            rows={2}
            placeholder="Acceptance criteria, one per line (default: the change is made and the repository tests pass)"
            className="w-full rounded border border-cyan-900/50 bg-black/40 px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-400/50"
            data-testid="council-mission-acceptance"
          />
          <p className="text-[9px] text-slate-500">This only drafts a proposal. Nothing runs until you approve it below.</p>
          <button
            type="button"
            disabled={busy || request.trim().length < 10}
            className="rounded border border-cyan-400/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40"
            onClick={() => void submit()}
            data-testid="council-mission-submit"
          >
            Draft proposal
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-[10px] text-red-300" data-testid="council-mission-error">{error}</p> : null}

      <ul className="mt-2 space-y-2" data-testid="council-mission-list">
        {visible.map(p => (
          <li key={p.proposalId} className="rounded border border-cyan-900/40 px-2 py-1.5" data-testid="council-mission-card" data-status={p.status} data-proposal-id={p.proposalId}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-semibold text-cyan-50">{p.title}</span>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${STATUS_STYLE[p.status] ?? 'border-slate-500/60 text-slate-300'}`} data-testid="council-mission-status">
                {p.status.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-400">{p.statusReason}</p>
            {p.targets.length ? <p className="mt-0.5 text-[9px] text-slate-500">Files: {p.targets.map(t => t.path).join(', ')}</p> : null}
            {p.foundry ? (
              <div className="mt-1 space-y-0.5 text-[9px] text-slate-400" data-testid="council-mission-foundry">
                <p>Foundry mission <span className="text-cyan-200">{p.foundry.missionId}</span> · {p.foundry.state}</p>
                {p.foundry.progress ? <p>Steps {p.foundry.progress.stepsDone}/{p.foundry.progress.stepsTotal} · model calls {p.foundry.progress.modelCalls}</p> : null}
                {p.foundry.receipt ? (
                  <p data-testid="council-mission-receipt">
                    Verifier {p.foundry.receipt.verifier.label}: exit {String(p.foundry.receipt.verifier.exitCode)} · integration {p.foundry.receipt.integration.state}
                    {p.foundry.receipt.integration.commit ? ` ${p.foundry.receipt.integration.commit.slice(0, 8)}` : ''} · receipt {p.foundry.receipt.receiptSha256.slice(0, 12)}{p.foundry.receipt.receiptVerified ? ' ✓' : ' (not verified)'}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-1.5 flex gap-1">
              {p.status === 'PROPOSED' || p.status === 'START_FAILED' ? (
                <>
                  <button type="button" disabled={busy}
                    className="rounded border border-emerald-400/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-40"
                    onClick={() => void post({ action: 'approve', proposalId: p.proposalId })}
                    data-testid="council-mission-approve">
                    {p.status === 'START_FAILED' ? 'Approve again' : 'Approve and run in Foundry'}
                  </button>
                  <button type="button" disabled={busy}
                    className="rounded border border-slate-500/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-300 hover:bg-slate-400/10 disabled:opacity-40"
                    onClick={() => void post({ action: 'reject', proposalId: p.proposalId })}
                    data-testid="council-mission-reject">
                    Reject
                  </button>
                </>
              ) : null}
              {p.status === 'RUNNING' || p.status === 'INTERRUPTED' ? (
                <button type="button" disabled={busy}
                  className="rounded border border-red-500/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  onClick={() => void post({ action: 'cancel', proposalId: p.proposalId })}
                  data-testid="council-mission-cancel">
                  Cancel mission
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

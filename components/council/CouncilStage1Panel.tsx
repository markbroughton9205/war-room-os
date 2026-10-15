'use client'

import { useEffect, useState } from 'react'
import type { Stage1Metadata, Stage1TurnRecord } from '@/lib/council/stage1/record'

const STATUS_CLASS: Record<string, string> = {
  COMPLETED: 'text-emerald-300',
  PARTIAL: 'text-amber-300',
  RUNNING: 'text-cyan-300',
  QUEUED: 'text-slate-300',
  WAITING: 'text-sky-300',
  FAILED: 'text-rose-300',
  CANCELLED: 'text-slate-400',
  INTERRUPTED: 'text-rose-300',
}

function Turn({ t }: { t: Stage1TurnRecord }) {
  return (
    <li className="rounded border border-cyan-900/50 bg-slate-950/50 px-2 py-2" data-testid="stage1-turn">
      <p className="text-[11px] text-slate-200">
        <span className={`font-bold ${STATUS_CLASS[t.status] ?? 'text-slate-300'}`} data-testid="stage1-status">{t.status}</span>
        {' · '}{t.decision.route.replace(/_/g, ' ')} · {t.decision.complexity}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">“{t.decree}”</p>
      <p className="text-[10px] text-slate-500">{t.statusReason}</p>
      {t.understanding.normalizationNotes.length ? (
        <p className="text-[10px] text-slate-500">Read as: {t.understanding.normalizationNotes.slice(0, 5).join('; ')}</p>
      ) : null}
      {t.understanding.references.length ? (
        <p className="text-[10px] text-slate-500">
          References: {t.understanding.references.map(r => `“${r.phrase}” → ${r.resolvedTo ?? 'unresolved'}`).join('; ')}
        </p>
      ) : null}
      {t.understanding.correction ? <p className="text-[10px] text-amber-200/90">Correction applied{t.understanding.correction.replacement ? `: ${t.understanding.correction.replacement}` : ''}</p> : null}
      {t.responder ? (
        <p className="mt-1 text-[11px] text-slate-300">
          Answered by: {t.responder.label} ({t.responder.kind}{t.responder.model ? `, ${t.responder.model}` : ', no model call'})
        </p>
      ) : null}
      {t.contributions.length ? (
        <ol className="mt-1 space-y-1">
          {t.contributions.map(c => (
            <li key={`${c.order}-${c.member}-${c.role}`} className="border-l border-cyan-900/60 pl-2 text-[11px] text-slate-300" data-testid="stage1-contribution">
              <span className="font-semibold text-cyan-200">{c.order}. {c.member}</span> · {c.role.replace(/_/g, ' ')} ·{' '}
              <span className={STATUS_CLASS[c.status] ?? ''}>{c.status}</span>
              <br />
              <span className="text-slate-400">
                {c.backendType ?? '?'} / {c.provider ?? '?'} / {c.model ?? 'model unknown'}
                {c.latencyMs != null ? ` · ${Math.round(c.latencyMs)} ms` : ''}
                {c.fallbackFrom ? ` · fell back from ${c.fallbackFrom}` : ''}
              </span>
              {c.respondsTo.length ? <><br /><span className="text-slate-500">Responds to {c.respondsTo.join(', ')}</span></> : null}
              {c.disagreements.length ? <><br /><span className="text-amber-200/90">Disagrees: {c.disagreements.join(' | ')}</span></> : null}
              {c.failureReason ? <><br /><span className="text-rose-300/90">{c.failureReason}</span></> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {t.sharedModelNote ? <p className="mt-1 text-[10px] text-amber-200/80">{t.sharedModelNote}</p> : null}
      {t.decision.excluded.length ? (
        <p className="mt-1 text-[10px] text-slate-500">
          Not called: {t.decision.excluded.map(e => `${e.member} (${e.reason})`).slice(0, 6).join('; ')}
        </p>
      ) : null}
      {t.research ? (
        <div className="mt-1 text-[11px] text-slate-300" data-testid="stage1-research">
          <p>Research: {t.research.label}</p>
          {t.research.sources.filter(s => !s.accepted).slice(0, 5).map((s, i) => (
            <p key={i} className="text-[10px] text-slate-500">Not counted: {s.url ?? s.title} ({s.evidenceLabel})</p>
          ))}
          {t.research.unknowns.slice(0, 3).map((u, i) => <p key={`u${i}`} className="text-[10px] text-amber-200/80">Unresolved: {u}</p>)}
        </div>
      ) : null}
      {t.localKnowledge.length ? (
        <p className="mt-1 text-[10px] text-slate-500">
          Local knowledge: {t.localKnowledge.slice(0, 6).map(k => `${k.id} [${k.status}]`).join(', ')}
        </p>
      ) : null}
    </li>
  )
}

export function CouncilStage1Panel({ conversationId, refreshKey }: { conversationId: string | null; refreshKey: number | string }) {
  const [meta, setMeta] = useState<Stage1Metadata | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!conversationId) return
    const abort = new AbortController()
    // Server persists after the response; give it a moment, then read the owner-scoped record.
    const timer = setTimeout(() => {
      fetch(`/api/conversations/${conversationId}`, { cache: 'no-store', signal: abort.signal })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j: { conversation?: { metadata?: Record<string, unknown> } }) => {
          const raw = j.conversation?.metadata?.councilStage1 as Stage1Metadata | undefined
          setMeta(raw && raw.version === 1 && Array.isArray(raw.turns) ? raw : null)
          setError(null)
        })
        .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'unavailable') })
    }, 700)
    return () => { clearTimeout(timer); abort.abort() }
  }, [conversationId, refreshKey])

  const turns = conversationId ? meta?.turns ?? [] : []
  return (
    <div className="mt-2 space-y-2" data-testid="council-stage1-panel">
      <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">Who contributed</p>
      {error ? <p className="text-[11px] text-amber-200/80">Contribution record unavailable ({error}).</p> : null}
      {!error && turns.length === 0 ? <p className="text-[11px] text-slate-500">No recorded contributions for this conversation yet.</p> : null}
      <ul className="space-y-2">
        {turns.slice(-8).reverse().map(t => <Turn key={t.turnId} t={t} />)}
      </ul>
    </div>
  )
}

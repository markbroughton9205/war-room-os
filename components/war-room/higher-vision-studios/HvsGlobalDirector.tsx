'use client'

import { useState } from 'react'
import type { HvsProductionPageId } from '@/lib/media-command/production-pages'
import { HVS_PRODUCTION_PAGES } from '@/lib/media-command/production-pages'
import { readHvsResume } from '@/lib/media-command/navigation'

export function HvsGlobalDirector({
  projectId,
  page,
}: {
  projectId: string
  page: HvsProductionPageId
}) {
  const spec = HVS_PRODUCTION_PAGES.find(item => item.id === page)
  const [open, setOpen] = useState(true)
  const [utterance, setUtterance] = useState(spec?.directorExample ?? 'What do you want to do?')
  const [summary, setSummary] = useState<string | null>(null)
  const [pending, setPending] = useState<string[] | null>(null)
  const [status, setStatus] = useState('AI Director uses typed EditOps. It does not mutate .hvsproj directly.')

  async function propose(commit = false) {
    const resume = readHvsResume()
    const res = await fetch('/api/media-command/director', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        utterance,
        mode: 'AI_DIRECTOR',
        commit,
        playheadSeconds: resume?.playheadSec,
        selectedClipId: resume?.selectedClipId,
        workspacePage: page,
      }),
    })
    const data = await res.json() as { proposal?: { summary: string; commands: Array<{ kind: string }>; sourceSeek?: { assetId: string; time: { ticks: number; timescale: number }; reason: string } }; error?: string }
    setSummary(data.proposal?.summary ?? data.error ?? 'No proposal')
    setPending(data.proposal?.commands.map(c => c.kind) ?? null)
    if (data.proposal?.sourceSeek) {
      setStatus(`Source seek ${data.proposal.sourceSeek.reason}`)
    } else {
      setStatus(commit ? (data.error ?? 'Committed via EditOps.') : (data.proposal?.summary ?? 'Preview only.'))
    }
  }

  if (!open) {
    return (
      <button type="button" className="rounded border border-emerald-900/40 px-2 py-1 text-[9px] uppercase tracking-widest text-emerald-300" onClick={() => setOpen(true)}>
        Show AI Director
      </button>
    )
  }

  return (
    <section className="foundry-glass rounded-lg border border-emerald-900/40 p-3" data-testid="hvs-global-director">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-300">AI Director · {spec?.label}</p>
        <button type="button" className="text-[9px] uppercase tracking-widest text-slate-500" onClick={() => setOpen(false)}>Collapse</button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Context: {spec?.directorExample}</p>
      <input
        value={utterance}
        onChange={e => setUtterance(e.target.value)}
        aria-label="What do you want to do?"
        className="mt-2 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-amber-50"
      />
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-100" onClick={() => void propose(false)}>Propose EditOps</button>
        <button type="button" className="rounded border border-emerald-400/70 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-50" disabled={!pending} onClick={() => void propose(true)}>Commit</button>
      </div>
      <p className="mt-2 text-[11px] text-cyan-200">{status}</p>
      {summary ? <p className="mt-1 text-[11px] text-amber-100">{summary}</p> : null}
      {pending ? <pre className="mt-1 max-h-20 overflow-auto text-[10px] text-cyan-200">{pending.join('\n')}</pre> : null}
    </section>
  )
}

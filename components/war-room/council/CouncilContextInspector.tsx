'use client'

import { memo, useState, type ReactNode } from 'react'

export function CouncilContextInspector({
  evidence,
  research,
  terra,
  diagnostics,
}: {
  evidence?: ReactNode
  research?: ReactNode
  terra?: ReactNode
  diagnostics?: ReactNode
}) {
  const [open, setOpen] = useState<'evidence' | 'research' | 'terra' | 'diagnostics' | null>('evidence')
  const tab = (id: typeof open, label: string) => (
    <button
      type="button"
      onClick={() => setOpen(prev => (prev === id ? null : id))}
      className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest"
      style={{
        color: open === id ? '#6ee7b7' : '#64748b',
        border: open === id ? '1px solid rgba(52,211,153,0.45)' : '1px solid transparent',
      }}
    >
      {label}
    </button>
  )
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded border border-cyan-900/40"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      data-testid="council-context-inspector"
    >
      <div className="flex flex-wrap gap-1 border-b border-cyan-900/40 p-2">
        {tab('evidence', 'Evidence')}
        {tab('research', 'Research')}
        {tab('terra', 'Terra')}
        {tab('diagnostics', 'Diagnostics')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px] leading-relaxed text-slate-300">
        {open === 'evidence' ? evidence ?? <p className="text-slate-500">No evidence packet for this turn.</p> : null}
        {open === 'research' ? research ?? <p className="text-slate-500">Research idle.</p> : null}
        {open === 'terra' ? terra ?? <p className="text-slate-500">No Terra pin on this turn.</p> : null}
        {open === 'diagnostics' ? diagnostics ?? <p className="text-slate-500">No extra diagnostics.</p> : null}
        {open === null ? <p className="text-slate-600">Inspector collapsed.</p> : null}
      </div>
    </aside>
  )
}

export const MemoCouncilContextInspector = memo(CouncilContextInspector)

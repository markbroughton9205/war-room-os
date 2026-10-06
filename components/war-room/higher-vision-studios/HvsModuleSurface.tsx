'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { HVS_CANONICAL_PATH } from '@/lib/media-command/navigation'

export function HvsModuleSurface({
  title,
  kicker,
  status,
  children,
  actions,
}: {
  title: string
  kicker: string
  status: 'live' | 'boundary'
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="space-y-3" data-testid="hvs-module-surface">
      <header className="foundry-glass rounded-lg border border-amber-900/40 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-cyan-300">{kicker}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-[0.14em] text-amber-50">{title}</h1>
          <span
            className="rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
            style={{
              borderColor: status === 'live' ? 'rgba(52,211,153,0.5)' : 'rgba(34,211,238,0.45)',
              color: status === 'live' ? '#6ee7b7' : '#67e8f9',
            }}
          >
            {status === 'live' ? 'Slice-0 live' : 'Permanent architecture'}
          </span>
        </div>
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      {children}
      <p className="text-[10px] uppercase tracking-widest text-slate-600">
        Higher Vision Studios · not War Room Media · not Terra · not Foundry ·{' '}
        <Link href={HVS_CANONICAL_PATH} className="text-amber-400/80">Return home</Link>
      </p>
    </div>
  )
}

'use client'

import { useState } from 'react'
import type { CouncilSourceLink as CouncilSourceLinkModel } from '@/lib/council/source-links'
import { CouncilSourceLink } from './CouncilSourceLink'

export function CouncilSourceList({
  links,
  label = 'Sources',
  collapsedByDefault = true,
}: {
  links: CouncilSourceLinkModel[]
  label?: string
  collapsedByDefault?: boolean
}) {
  const [open, setOpen] = useState(!collapsedByDefault || links.length <= 1)
  if (!links.length) return null
  const supporting = links.filter(link => link.supporting)
  const rejected = links.filter(link => !link.supporting)
  return (
    <section className="mt-2 w-full max-w-2xl" data-testid="council-source-list">
      <button
        type="button"
        className="text-[10px] font-bold uppercase tracking-widest text-sky-300/90"
        data-testid="council-source-list-toggle"
        onClick={() => setOpen(value => !value)}
      >
        {label} ({links.length})
      </button>
      {open ? (
        <div className="mt-1 space-y-1">
          {supporting.map(link => <CouncilSourceLink key={link.source_id} link={link} compact />)}
          {rejected.length ? (
            <div data-testid="council-source-rejected-group">
              <p className="mb-1 text-[9px] uppercase tracking-widest text-rose-300/80">Inspected / rejected — not supporting</p>
              {rejected.map(link => <CouncilSourceLink key={link.source_id} link={link} compact />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

'use client'

import type { ReactNode } from 'react'

/**
 * Compact inspect/expand surface — essentials stay visible, deeper detail opens on demand.
 * Uncontrolled <details> so the Commander can open/close freely. Hover CSS (terra-inspect)
 * peeks the body on pointer devices without forcing it open.
 */
export function TerraInspectDetails({
  title,
  badge,
  children,
  defaultOpen = false,
  className = '',
}: {
  title: string
  badge?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <details
      className={`terra-inspect group/inspect pointer-events-auto rounded-lg border border-white/10 bg-black/55 shadow-[0_8px_28px_rgba(0,0,0,0.35)] backdrop-blur-md ${className}`}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-300 [&::-webkit-details-marker]:hidden">
        <span className="truncate">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          <span data-chevron="closed" className="text-cyan-300/80">▸</span>
          <span data-chevron="open" className="text-cyan-300/80">▾</span>
        </span>
      </summary>
      <div className="terra-inspect-body border-t border-white/10 px-2.5 py-2">{children}</div>
    </details>
  )
}

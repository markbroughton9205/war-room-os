'use client'

import type { ReactNode } from 'react'

export type SegmentTone = 'neutral' | 'ok' | 'warn' | 'danger'

const TONE_TEXT: Record<SegmentTone, string> = {
  neutral: 'text-slate-200',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  danger: 'text-red-300',
}

export function RibbonSegmentShell({
  label,
  children,
  tone = 'neutral',
  className = '',
  urgent = false,
  title,
}: {
  label: string
  children: ReactNode
  tone?: SegmentTone
  className?: string
  urgent?: boolean
  title?: string
}) {
  return (
    <div
      className={`flex min-h-[3.25rem] shrink-0 flex-col justify-center border-r border-white/10 px-3 py-2 sm:min-w-[10rem] sm:px-4 ${urgent ? 'animate-pulse bg-red-950/20' : ''} ${className}`}
      title={title}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <div className={`mt-0.5 text-sm font-semibold leading-snug ${TONE_TEXT[tone]}`}>{children}</div>
    </div>
  )
}

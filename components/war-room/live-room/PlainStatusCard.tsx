'use client'

import { memo, type ReactNode } from 'react'

export type PlainStatusCardProps = {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'danger'
}

const TONE_STYLES: Record<NonNullable<PlainStatusCardProps['tone']>, { border: string; value: string }> = {
  neutral: { border: 'rgba(255,255,255,0.12)', value: '#E2E8F0' },
  ok: { border: 'rgba(52,211,153,0.35)', value: '#6EE7B7' },
  warn: { border: 'rgba(251,191,36,0.35)', value: '#FCD34D' },
  danger: { border: 'rgba(248,113,113,0.35)', value: '#FCA5A5' },
}

export const PlainStatusCard = memo(function PlainStatusCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: PlainStatusCardProps) {
  const styles = TONE_STYLES[tone]
  return (
    <article
      className="min-w-[7.5rem] flex-1 rounded border px-3 py-2"
      style={{ borderColor: styles.border, background: 'rgba(0,0,0,0.35)' }}
      title={hint}
    >
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold tracking-wide" style={{ color: styles.value }}>
        {value}
      </p>
    </article>
  )
})

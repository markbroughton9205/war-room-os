'use client'

import { memo, useCallback, useState } from 'react'

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

const BTN_CLASS =
  'min-h-[32px] rounded px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest transition hover:bg-white/5 active:scale-[0.98]'

export type CopyCouncilButtonProps = {
  label: string
  getText: () => string
  successMessage?: string
  manualTitle?: string
  className?: string
  variant?: 'default' | 'accent'
  hint?: string
}

export const CopyCouncilButton = memo(function CopyCouncilButton({
  label,
  getText,
  successMessage = 'Copied',
  manualTitle,
  className = '',
  variant = 'default',
  hint,
}: CopyCouncilButtonProps) {
  const { copy } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)

  const onClick = useCallback(async () => {
    const result = await copy(getText(), { successMessage, manualTitle: manualTitle ?? label })
    if (result === 'copied') {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    }
  }, [copy, getText, label, manualTitle, successMessage])

  const accent = variant === 'accent'

  return (
    <div className={`inline-flex max-w-[14rem] flex-col gap-0.5 ${className}`}>
      <button
        type="button"
        className={BTN_CLASS}
        style={{
          border: accent ? '1px solid rgba(255,215,0,0.45)' : '1px solid rgba(148,163,184,0.35)',
          color: copied ? '#86EFAC' : accent ? '#FDE68A' : '#CBD5E1',
          background: 'rgba(0,0,0,0.22)',
        }}
        aria-label={label}
        onClick={() => void onClick()}
      >
        {copied ? 'Copied' : label}
      </button>
      {hint ? (
        <span className="text-[8px] leading-snug tracking-wide text-slate-600" role="note">
          {hint}
        </span>
      ) : null}
    </div>
  )
})

'use client'

import { memo, useCallback, useState } from 'react'

import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import { copyTextToClipboard } from '@/lib/operator/copyCouncilText'

const BTN_CLASS =
  'min-h-[32px] rounded px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest transition hover:bg-white/5 active:scale-[0.98]'

export type CopyCouncilButtonProps = {
  label: string
  getText: () => string
  successMessage?: string
  className?: string
  variant?: 'default' | 'accent'
}

export const CopyCouncilButton = memo(function CopyCouncilButton({
  label,
  getText,
  successMessage = 'Copied to clipboard',
  className = '',
  variant = 'default',
}: CopyCouncilButtonProps) {
  const { signalSuccess, signalError } = useMatrixStatus()
  const [copied, setCopied] = useState(false)

  const onClick = useCallback(async () => {
    const ok = await copyTextToClipboard(getText())
    if (!ok) {
      signalError('Copy failed')
      return
    }
    setCopied(true)
    signalSuccess(successMessage)
    window.setTimeout(() => setCopied(false), 1_600)
  }, [getText, signalError, signalSuccess, successMessage])

  const accent = variant === 'accent'

  return (
    <button
      type="button"
      className={`${BTN_CLASS} ${className}`}
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
  )
})

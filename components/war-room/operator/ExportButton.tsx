'use client'

import { memo, useCallback } from 'react'

import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import { downloadTextFile, type ExportMimeType } from '@/lib/operator/exportAsFile'

const BTN_CLASS =
  'min-h-[32px] rounded px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest transition hover:bg-white/5 active:scale-[0.98]'

export type ExportButtonProps = {
  label: string
  getContent: () => string
  filename: string | (() => string)
  mimeType?: ExportMimeType
  successMessage?: string
  className?: string
  variant?: 'default' | 'accent'
  hint?: string
}

export const ExportButton = memo(function ExportButton({
  label,
  getContent,
  filename,
  mimeType = 'text/plain',
  successMessage = 'Exported',
  className = '',
  variant = 'default',
  hint,
}: ExportButtonProps) {
  const { signalSuccess, signalWarning } = useMatrixStatus()

  const onClick = useCallback(() => {
    const name = typeof filename === 'function' ? filename() : filename
    const result = downloadTextFile(name, getContent(), mimeType)
    if (result === 'downloaded') {
      signalSuccess(successMessage)
    } else if (result === 'empty') {
      signalWarning('Nothing to export')
    } else {
      signalWarning('Export not supported in this browser')
    }
  }, [filename, getContent, mimeType, signalSuccess, signalWarning, successMessage])

  const accent = variant === 'accent'

  return (
    <div className={`inline-flex max-w-[14rem] flex-col gap-0.5 ${className}`}>
      <button
        type="button"
        className={BTN_CLASS}
        style={{
          border: accent ? '1px solid rgba(255,215,0,0.45)' : '1px solid rgba(148,163,184,0.35)',
          color: accent ? '#FDE68A' : '#CBD5E1',
          background: 'rgba(0,0,0,0.22)',
        }}
        aria-label={label}
        onClick={onClick}
      >
        {label}
      </button>
      {hint ? (
        <span className="text-[8px] leading-snug tracking-wide text-slate-600" role="note">
          {hint}
        </span>
      ) : null}
    </div>
  )
})

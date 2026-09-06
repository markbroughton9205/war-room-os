'use client'

import { memo, useCallback, useState } from 'react'

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { formatMessageForCopy, type CouncilMessageLike } from '@/lib/operator/copyCouncilText'

const COPY_BTN_CLASS =
  'min-h-[28px] min-w-[28px] rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest transition hover:bg-white/10 sm:opacity-70 sm:group-hover:opacity-100'

export type MessageCopyButtonProps = {
  message: CouncilMessageLike
  className?: string
}

export const MessageCopyButton = memo(function MessageCopyButton({
  message,
  className = '',
}: MessageCopyButtonProps) {
  const { copy } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)

  const runCopy = useCallback(
    async (includeMeta: boolean) => {
      const text = formatMessageForCopy(message, { includeMeta })
      const result = await copy(text, {
        successMessage: 'Copied',
        manualTitle: includeMeta ? 'Copy message (+meta)' : 'Copy message',
      })
      if (result === 'copied') {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_600)
      }
    },
    [copy, message],
  )

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <button
        type="button"
        className={COPY_BTN_CLASS}
        style={{ border: '1px solid rgba(148,163,184,0.35)', color: copied ? '#86EFAC' : '#94A3B8' }}
        aria-label={copied ? 'Copied' : 'Copy message'}
        onClick={() => void runCopy(false)}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        className={COPY_BTN_CLASS}
        style={{ border: '1px solid rgba(148,163,184,0.2)', color: '#64748B' }}
        aria-label="Copy message with agent and timestamp"
        title="Copy with agent and timestamp"
        onClick={() => void runCopy(true)}
      >
        +meta
      </button>
    </div>
  )
})

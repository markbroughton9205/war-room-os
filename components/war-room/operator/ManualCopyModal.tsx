'use client'

import { useCallback, useEffect, useRef } from 'react'

export type ManualCopyModalProps = {
  text: string
  title?: string
  onClose: () => void
}

export function ManualCopyModal({ text, title, onClose }: ManualCopyModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectAll = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => selectAll(), 0)
    return () => window.clearTimeout(timer)
  }, [selectAll, text])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-copy-title"
    >
      <div className="w-full max-w-2xl rounded border border-amber-400/35 bg-slate-950 p-4 shadow-2xl shadow-amber-950/30">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p
              id="manual-copy-title"
              className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300"
            >
              {title ?? 'Manual copy'}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Clipboard write was blocked. Select the text below, then press{' '}
              <kbd className="rounded border border-white/15 px-1 py-0.5 font-mono text-[10px] text-slate-200">
                Ctrl+C
              </kbd>{' '}
              (Mac:{' '}
              <kbd className="rounded border border-white/15 px-1 py-0.5 font-mono text-[10px] text-slate-200">
                Cmd+C
              </kbd>
              ). On mobile: tap and hold the text, then choose Copy.
            </p>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          readOnly
          value={text}
          rows={14}
          className="mt-2 w-full resize-y rounded border border-white/10 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-slate-200 outline-none focus:border-amber-400/40"
          aria-label="Text to copy manually"
          onFocus={selectAll}
        />

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="rounded border border-amber-400/40 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-100"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

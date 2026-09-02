'use client'

import { memo, useState } from 'react'

export type SynthesisCardProps = {
  synthesis: string | null | undefined
}

/**
 * Full, non-truncated synthesis result — a dedicated card, not the thin ambient ticker line.
 * Renders only when a synthesis exists; the ticker (`AmbientActivityFeed`) never duplicates it.
 */
export const SynthesisCard = memo(function SynthesisCard({ synthesis }: SynthesisCardProps) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const text = synthesis?.trim()
  if (!text) return null

  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  const renderParagraphs = paragraphs.length > 0 ? paragraphs : [text]

  const handleCopy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <section
      aria-label="Synthesis"
      className="w-full rounded border border-cyan-900/40 bg-black/40 px-4 py-3 sm:px-5 sm:py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          className="text-[10px] font-bold tracking-[0.2em]"
          style={{ color: '#FBBF24' }}
        >
          SYNTHESIS
        </h3>
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="text-[10px] tracking-widest px-2 py-1 rounded border border-cyan-800/60 text-cyan-300/80"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
        {typeof navigator !== 'undefined' && navigator.clipboard ? (
          <button
            type="button"
            onClick={handleCopy}
            className="text-[10px] tracking-widest px-2 py-1 rounded border border-cyan-800/60 text-cyan-300/80 hover:text-cyan-200 hover:border-cyan-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            aria-label="Copy full synthesis text"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </div>
      {collapsed ? (
        <p className="mt-2 text-[11px] text-slate-500">Optional inspector copy — full synthesis is in the Council stream.</p>
      ) : (
      <div className="mt-2 max-w-full space-y-2 text-[12px] leading-relaxed text-emerald-100/90 break-words whitespace-pre-wrap">
        {renderParagraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      )}
    </section>
  )
})

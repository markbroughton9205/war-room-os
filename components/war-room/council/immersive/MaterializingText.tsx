'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type MaterializingBlock = {
  id: string
  label: string
  detail?: string | null
  color?: string
  text: string
  streaming?: boolean
  role: 'member' | 'commander' | 'system'
}

const MAX_STAGGER_MS = 2200
const WORD_STEP_MS = 14

/**
 * Council text that "materializes" near the bottom of the screen. Only blocks that arrive while this view is open are animated
 * (history shown at mount, and everything under reduced motion, appears instantly). Readability wins: a solid translucent backdrop,
 * the full text is always present for assistive technology, and the animation is capped so long replies never wait on it.
 */
export function MaterializingText({ blocks, reducedMotion, maxHeight = '38vh' }: { blocks: MaterializingBlock[]; reducedMotion: boolean; maxHeight?: string }) {
  const seen = useRef<Set<string> | null>(null)
  const [animated, setAnimated] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // History present when the view first has content (open, restore, session switch) appears instantly; only later arrivals animate.
    if (seen.current === null) { if (blocks.length) seen.current = new Set(blocks.map(b => b.id)); return }
    const ids = new Set(blocks.map(b => b.id))
    if (blocks.length && !blocks.some(b => seen.current!.has(b.id))) { seen.current = ids; queueMicrotask(() => setAnimated(new Set())); return }
    for (const id of [...seen.current]) if (!ids.has(id)) seen.current.delete(id)
    const fresh = blocks.filter(b => !seen.current!.has(b.id) && b.role !== 'commander')
    if (!fresh.length) return
    for (const b of fresh) seen.current.add(b.id)
    if (!reducedMotion) queueMicrotask(() => setAnimated(prev => new Set([...prev, ...fresh.map(b => b.id)])))
  }, [blocks, reducedMotion])

  const signature = blocks.map(b => `${b.id}:${b.text.length}`).join('|')
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [signature])

  const rendered = useMemo(() => blocks.map(b => ({ b, anim: animated.has(b.id) && !reducedMotion })), [blocks, animated, reducedMotion])

  return (
    <div
      ref={scroller}
      className={`immersive-text-scroll overflow-y-auto ${rendered.length === 0 ? '' : 'rounded-2xl border border-cyan-300/15 bg-[rgba(2,8,14,0.82)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.6)] backdrop-blur-md'}`}
      style={{ maxHeight }}
      role="log"
      aria-label="Council conversation, latest round"
      aria-live={blocks.some(b => b.streaming) ? 'off' : 'polite'}
      tabIndex={0}
      data-testid="immersive-text"
    >
      {rendered.length === 0 ? (
        <p className="text-center text-xs text-slate-400" data-testid="immersive-text-empty">The Council is listening. Speak to begin.</p>
      ) : rendered.map(({ b, anim }) => (
        <article key={b.id} className="mb-3 last:mb-0" data-testid="immersive-block" data-role={b.role} data-member={b.label}>
          <header className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]">
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: `${b.color ?? '#67e8f9'}66`, color: b.color ?? '#67e8f9' }}>{b.label}</span>
            {b.detail ? <span className="font-normal normal-case tracking-normal text-slate-400">{b.detail}</span> : null}
            {b.streaming ? <span className="text-emerald-300" aria-hidden="true">● live</span> : null}
          </header>
          {anim ? (
            <>
              <p className="sr-only">{b.text}</p>
              <p className="immersive-materialize whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100" aria-hidden="true">
                {b.text.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w)
                  ? w
                  : <span key={i} style={{ animationDelay: `${Math.min(Math.floor(i / 2) * WORD_STEP_MS, MAX_STAGGER_MS)}ms` }}>{w}</span>))}
              </p>
            </>
          ) : (
            <p className={`whitespace-pre-wrap text-[15px] leading-relaxed ${b.role === 'commander' ? 'text-slate-400' : 'text-slate-100'}`}>{b.text}</p>
          )}
        </article>
      ))}
    </div>
  )
}

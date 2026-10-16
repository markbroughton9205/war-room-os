'use client'

import type { ProgressStar, StarState } from '@/lib/council/immersive/signals'

const STYLE: Record<StarState, { color: string; glyph: string; word: string }> = {
  idle: { color: '#64748b', glyph: '✦', word: 'idle' },
  active: { color: '#22d3ee', glyph: '✦', word: 'in progress' },
  pending: { color: '#fbbf24', glyph: '✧', word: 'waiting for you' },
  partial: { color: '#fb923c', glyph: '✧', word: 'partial' },
  done: { color: '#94a3b8', glyph: '★', word: 'finished (not independently verified)' },
  verified: { color: '#34d399', glyph: '★', word: 'verified by evidence' },
  blocked: { color: '#f59e0b', glyph: '✕', word: 'blocked' },
  failed: { color: '#f87171', glyph: '✕', word: 'failed' },
}

/**
 * One star per real signal. The state word is always printed next to the colour so the meaning never depends on colour alone,
 * and the evidence record is available on focus/hover. Only a `verified` star is a green full star.
 */
export function ProgressStars({ stars, reducedMotion }: { stars: ProgressStar[]; reducedMotion: boolean }) {
  return (
    <ul className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1" aria-label="Progress signals" data-testid="progress-stars">
      {stars.map(s => {
        const st = STYLE[s.state]
        return (
          <li key={s.id} className="group relative" data-testid="progress-star" data-state={s.state} data-kind={s.kind}>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2 py-0.5 text-[10px] text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
              title={`${s.label} — evidence: ${s.evidence}`}
              aria-label={`${s.label}, ${st.word}. Evidence: ${s.evidence}`}
            >
              <span
                className={s.state === 'active' && !reducedMotion ? 'immersive-star-pulse' : ''}
                style={{ color: st.color, textShadow: s.state === 'idle' ? 'none' : `0 0 8px ${st.color}` }}
                aria-hidden="true"
              >{st.glyph}</span>
              <span className="max-w-[16rem] truncate">{s.label}</span>
              <span className="text-[9px] uppercase tracking-wider" style={{ color: st.color }}>{st.word}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { useApplicationActivity } from '@/lib/ui/applicationActivity'
import { FOUNDRY_HOME_ICON_SRC } from '@/lib/native-builder/foundryNavigation'
import { FoundryEntryLink } from './FoundryEntryLink'

const CODE_GLYPHS = [
  { text: '</>', dx: '-3.1rem', dy: '-2.4rem' },
  { text: '{}', dx: '3.4rem', dy: '-2.1rem' },
  { text: '[]', dx: '-3.6rem', dy: '0.2rem' },
  { text: '01', dx: '3.8rem', dy: '0.6rem' },
  { text: '=>', dx: '-1.6rem', dy: '-3.4rem' },
  { text: '#', dx: '1.8rem', dy: '3.1rem' },
  { text: 'fn', dx: '-0.2rem', dy: '3.4rem' },
] as const

type ForgeMotion = 'live' | 'paused' | 'reduced'

/**
 * Home workspace launcher for Foundry.
 * Uses the exact saved PNG at public/foundry/foundry-icon.png
 * (source: /home/chosenone/foundry icon.png). Animation is CSS/DOM only.
 */
export function FoundryHomeAppIcon() {
  const hostRef = useRef<HTMLDivElement>(null)
  const activity = useApplicationActivity()
  const [intersecting, setIntersecting] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      setIntersecting(entries[0]?.isIntersecting ?? false)
    }, { threshold: 0.2 })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const motion: ForgeMotion = reducedMotion
    ? 'reduced'
    : activity.visible && intersecting && activity.mode === 'HOME_ACTIVE'
      ? 'live'
      : 'paused'

  return (
    <div
      ref={hostRef}
      className="foundry-home-app-icon-host pointer-events-none absolute inset-0 z-20 flex items-end justify-start p-3 pb-14 sm:items-center sm:p-5"
      data-testid="foundry-home-app-icon-host"
      data-forge-motion={motion}
    >
      <FoundryEntryLink
        testId="foundry-home-app-icon"
        ariaLabel="Open Foundry"
        className="foundry-home-app-icon pointer-events-auto flex w-[clamp(6.75rem,16vmin,9.25rem)] flex-col items-center gap-2 rounded-2xl border border-cyan-300/25 bg-[rgba(3,10,14,0.62)] px-2.5 py-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl outline-none transition-[border-color,box-shadow,transform] duration-200 hover:border-cyan-200/55 hover:shadow-[0_0_28px_rgba(34,211,238,0.28)] focus-visible:border-cyan-200 focus-visible:shadow-[0_0_0_2px_rgba(34,211,238,0.55),0_0_28px_rgba(52,211,153,0.35)]"
      >
        <span className="foundry-home-app-icon-frame relative block aspect-square w-full overflow-hidden rounded-[1.15rem] border border-emerald-300/20 bg-slate-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FOUNDRY_HOME_ICON_SRC}
            alt="Foundry"
            draggable={false}
            className="foundry-home-app-icon-art relative z-[1] h-full w-full object-contain"
            data-testid="foundry-home-app-icon-image"
          />
          <span className="foundry-home-app-icon-anvil-pulse pointer-events-none absolute left-1/2 top-[58%] z-[2] h-[42%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden="true" />
          <span className="foundry-home-app-icon-flash pointer-events-none absolute inset-0 z-[3]" aria-hidden="true" />
          <span className="pointer-events-none absolute inset-0 z-[4]" aria-hidden="true">
            {CODE_GLYPHS.map(glyph => (
              <span
                key={glyph.text}
                className="foundry-home-app-icon-glyph absolute left-1/2 top-[56%] font-mono text-[9px] font-bold tracking-tight text-cyan-100"
                style={{ '--dx': glyph.dx, '--dy': glyph.dy } as CSSProperties}
                data-testid="foundry-home-app-icon-glyph"
              >
                {glyph.text}
              </span>
            ))}
          </span>
        </span>
        <span className="flex flex-col items-center text-center">
          <span className="text-[10px] font-bold uppercase tracking-[0.34em] text-cyan-100">Foundry</span>
          <span className="mt-0.5 text-[7px] uppercase tracking-[0.22em] text-emerald-300/75">Build · Engineer · Create</span>
        </span>
      </FoundryEntryLink>
    </div>
  )
}

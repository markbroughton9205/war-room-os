'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useApplicationActivity } from '@/lib/ui/applicationActivity'
import { HvsStudioMark } from './HvsStudioMark'

type Motion = 'live' | 'paused' | 'reduced'

/**
 * Home workspace launcher for Higher Vision Studios.
 * Primary visual is the cinematic studio mark (lens / viewfinder / timeline).
 * The Commander-saved television PNG remains in public/hvs for brand archive;
 * it is not the homepage identity.
 */
export function HvsHomeAppIcon() {
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

  const motion: Motion = reducedMotion
    ? 'reduced'
    : activity.visible && intersecting && activity.mode === 'HOME_ACTIVE'
      ? 'live'
      : 'paused'

  return (
    <div
      ref={hostRef}
      className="hvs-home-app-icon-host pointer-events-none absolute inset-0 z-20 flex items-end justify-end p-3 pb-14 sm:items-center sm:p-5"
      data-testid="hvs-home-app-icon-host"
      data-hvs-motion={motion}
    >
      <Link
        href="/higher-vision-studios"
        data-testid="hvs-home-app-icon"
        aria-label="Open Higher Vision Studios"
        className="hvs-home-app-icon pointer-events-auto flex w-[clamp(6.75rem,16vmin,9.25rem)] flex-col items-center gap-2 rounded-2xl border border-amber-300/30 bg-[rgba(8,4,2,0.72)] px-2.5 py-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl outline-none transition-[border-color,box-shadow,transform] duration-200 hover:border-amber-200/60 hover:shadow-[0_0_28px_rgba(201,162,39,0.28)] focus-visible:border-amber-200 focus-visible:shadow-[0_0_0_2px_rgba(251,191,36,0.55)]"
      >
        <span className="hvs-home-app-icon-frame relative block aspect-square w-full overflow-hidden rounded-[1.15rem] border border-amber-300/35 bg-slate-950 shadow-[inset_0_0_24px_rgba(201,162,39,0.18)]">
          <HvsStudioMark />
        </span>
        <span className="flex flex-col items-center text-center">
          <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-amber-100">Higher Vision</span>
          <span className="mt-0.5 text-[7px] uppercase tracking-[0.22em] text-emerald-300/75">Studios · Produce</span>
        </span>
      </Link>
    </div>
  )
}

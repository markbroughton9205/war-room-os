'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  HVS_DISPLAY_NAME,
  HVS_HOME_SHORTCUT_HINT,
  HVS_TAGLINE,
  WAR_ROOM_HOME_HREF,
  matchesHomeShortcut,
} from '@/lib/media-command/navigation'

export function HvsHomeNav({
  projectName,
  compact = false,
}: {
  projectName?: string
  compact?: boolean
}) {
  const router = useRouter()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesHomeShortcut(event)) return
      event.preventDefault()
      router.push(WAR_ROOM_HOME_HREF)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  if (compact) {
    return (
      <nav
        className="mb-1 flex flex-wrap items-center gap-2 rounded border border-amber-900/30 px-2 py-1"
        data-testid="hvs-home-nav"
        aria-label="Higher Vision Studios navigation"
      >
        <Link
          href={WAR_ROOM_HOME_HREF}
          data-testid="hvs-back-to-war-room"
          className="rounded border border-emerald-500/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-200"
          title={`Back to War Room (${HVS_HOME_SHORTCUT_HINT})`}
        >
          ← War Room
        </Link>
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-amber-200">{HVS_DISPLAY_NAME}</p>
        {projectName ? <p className="truncate text-[10px] text-slate-400">{projectName}</p> : null}
        <Link href="/higher-vision-studios/projects" className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">Projects</Link>
        <Link
          href={WAR_ROOM_HOME_HREF}
          data-testid="hvs-logo-home"
          className="ml-auto text-[9px] uppercase tracking-widest text-yellow-400"
          aria-label="War Room home"
        >
          ⚔ Home
        </Link>
      </nav>
    )
  }

  return (
    <nav
      className="foundry-glass sticky top-0 z-30 mb-2 rounded-lg border border-amber-400/25 px-3 py-2"
      data-testid="hvs-home-nav"
      aria-label="Higher Vision Studios navigation"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-amber-200/90">
          WAR ROOM — HIGHER VISION INC
        </p>
        <Link
          href={WAR_ROOM_HOME_HREF}
          data-testid="hvs-logo-home"
          className="ml-auto rounded px-2 py-1 text-right"
          title={`War Room home (${HVS_HOME_SHORTCUT_HINT})`}
          aria-label="War Room home"
        >
          <p className="text-sm font-bold tracking-widest text-yellow-400">⚔ WAR ROOM</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Home</p>
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Link
          href={WAR_ROOM_HOME_HREF}
          data-testid="hvs-back-to-war-room"
          className="rounded border border-emerald-500/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-950/40"
          title={`Back to War Room (${HVS_HOME_SHORTCUT_HINT})`}
        >
          ← Back to War Room
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-slate-400">WAR ROOM OS</p>
          <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-amber-200">{HVS_DISPLAY_NAME}</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">{HVS_TAGLINE}</p>
        </div>
        {projectName ? (
          <div className="hidden min-w-0 max-w-[280px] rounded border border-amber-400/20 px-2 py-1 sm:block">
            <p className="truncate text-[10px] font-bold text-amber-100">{projectName}</p>
          </div>
        ) : null}
      </div>
    </nav>
  )
}

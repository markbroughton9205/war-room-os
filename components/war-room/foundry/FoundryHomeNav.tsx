'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FOUNDRY_HOME_SHORTCUT_HINT,
  WAR_ROOM_HOME_HREF,
  matchesHomeShortcut,
} from '@/lib/native-builder/foundryNavigation'
import { foundryToneBorder, foundryToneClass, type FoundryVisualTreatment } from '@/lib/native-builder/foundryVisualState'

/**
 * Permanent Foundry chrome: return to War Room home without logging out,
 * cancelling missions, or depending on the browser back button.
 */
export function FoundryHomeNav({
  workspaceTitle,
  workspaceKind,
  workspacePath,
  visual,
}: {
  workspaceTitle?: string
  workspaceKind?: string
  workspacePath?: string
  visual?: FoundryVisualTreatment
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

  return (
    <nav
      className="sticky top-0 z-30 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/20 bg-black/70 px-3 py-1.5 backdrop-blur-md"
      data-testid="foundry-home-nav"
      aria-label="Foundry navigation"
    >
      <Link
        href={WAR_ROOM_HOME_HREF}
        data-testid="foundry-back-to-war-room"
        className="rounded border border-emerald-500/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-950/40"
        title={`Back to War Room (${FOUNDRY_HOME_SHORTCUT_HINT})`}
      >
        ← Back to War Room
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-emerald-300">The Foundry</p>
        <p className="text-[9px] uppercase tracking-widest text-slate-500">Native Engineering Intelligence</p>
      </div>
      {workspaceTitle ? (
        <div
          className="hidden min-w-0 max-w-[240px] rounded border border-emerald-400/20 px-2 py-1 sm:block"
          title={workspacePath}
        >
          <p className="truncate text-[10px] font-bold text-emerald-100">{workspaceTitle}</p>
          <p className={`truncate text-[8px] uppercase tracking-widest ${/canonical/i.test(workspaceKind ?? '') ? 'text-emerald-400/80' : 'text-slate-500'}`}>{workspaceKind}</p>
        </div>
      ) : null}
      {visual ? (
        <p
          className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${foundryToneClass(visual.tone)} ${foundryToneBorder(visual.tone)}`}
          data-testid="foundry-header-state"
        >
          {visual.label}
        </p>
      ) : null}
      <Link
        href={WAR_ROOM_HOME_HREF}
        data-testid="foundry-logo-home"
        className="rounded px-2 py-1 text-right"
        title={`War Room home (${FOUNDRY_HOME_SHORTCUT_HINT})`}
        aria-label="War Room home"
      >
        <p className="text-sm font-bold tracking-widest text-yellow-400">⚔ WAR ROOM</p>
        <p className="text-[9px] uppercase tracking-widest text-slate-500">Home</p>
      </Link>
    </nav>
  )
}

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
      className="foundry-glass foundry-home-nav sticky top-0 z-30 mb-2 rounded-lg border border-emerald-400/25 px-3 py-2"
      data-testid="foundry-home-nav"
      aria-label="Foundry navigation"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="foundry-glitch-mark text-[10px] font-bold uppercase tracking-[0.34em] text-emerald-300/90" data-testid="foundry-org-identity">
          WAR ROOM — HIGHER VISION INC
        </p>
        <Link
          href={WAR_ROOM_HOME_HREF}
          data-testid="foundry-logo-home"
          className="ml-auto rounded px-2 py-1 text-right"
          title={`War Room home (${FOUNDRY_HOME_SHORTCUT_HINT})`}
          aria-label="War Room home"
        >
          <p className="foundry-glitch-mark text-sm font-bold tracking-widest text-yellow-400">⚔ WAR ROOM</p>
          <p className="text-[9px] uppercase tracking-widest text-slate-500">Home</p>
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Link
          href={WAR_ROOM_HOME_HREF}
          data-testid="foundry-back-to-war-room"
          className="rounded border border-emerald-500/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-950/40"
          title={`Back to War Room (${FOUNDRY_HOME_SHORTCUT_HINT})`}
        >
          ← Back to War Room
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-slate-400">WAR ROOM OS</p>
          <p className="foundry-glitch-mark text-[12px] font-bold uppercase tracking-[0.28em] text-emerald-300">The Foundry</p>
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
      </div>
      <p className="mt-1.5 text-[9px] leading-relaxed tracking-wide text-slate-500" data-testid="foundry-supporting-line">
        Build. Test. Iterate. Ship. Local coder first. Cloud APIs optional. Commit, push, and deploy stay Commander-gated.
      </p>
    </nav>
  )
}

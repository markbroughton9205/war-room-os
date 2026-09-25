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
import { FOUNDRY_BACK_TO_WAR_ROOM_LABEL } from '@/lib/native-builder/foundryUxContract'

/**
 * Compact Foundry chrome: return to War Room home without logging out,
 * cancelling missions, or depending on the browser back button.
 */
export function FoundryHomeNav({
  visual,
  providerMode,
}: {
  workspaceTitle?: string
  workspaceKind?: string
  workspacePath?: string
  visual?: FoundryVisualTreatment
  providerMode?: string
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

  const stateLabel = visual?.label ?? 'READY'

  return (
    <nav
      className="foundry-glass foundry-home-nav sticky top-0 z-30 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/25 px-3 py-1.5"
      data-testid="foundry-home-nav"
      aria-label="Foundry navigation"
    >
      <Link
        href={WAR_ROOM_HOME_HREF}
        data-testid="foundry-back-to-war-room"
        className="rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-950/40"
        title={`War Room home (${FOUNDRY_HOME_SHORTCUT_HINT})`}
      >
        {FOUNDRY_BACK_TO_WAR_ROOM_LABEL}
      </Link>
      <Link
        href={WAR_ROOM_HOME_HREF}
        data-testid="foundry-logo-home"
        className="rounded px-1 py-0.5"
        title={`War Room home (${FOUNDRY_HOME_SHORTCUT_HINT})`}
        aria-label="War Room home"
      >
        <span className="sr-only">WAR ROOM</span>
      </Link>
      <p className="foundry-glitch-mark min-w-0 flex-1 text-[12px] font-bold uppercase tracking-[0.28em] text-emerald-300">
        THE FOUNDRY
      </p>
      {visual ? (
        <p
          className={`rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${foundryToneClass(visual.tone)} ${foundryToneBorder(visual.tone)}`}
          data-testid="foundry-header-state"
        >
          {stateLabel}
        </p>
      ) : (
        <p className="rounded border border-emerald-400/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-300" data-testid="foundry-header-state">
          READY
        </p>
      )}
      {providerMode && providerMode !== 'READY' ? (
        <p className="rounded border border-white/15 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-400" data-testid="foundry-provider-compact">
          {providerMode}
        </p>
      ) : null}
    </nav>
  )
}

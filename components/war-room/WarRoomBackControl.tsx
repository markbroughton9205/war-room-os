'use client'

/**
 * Always-a-way-back control for War Room pages and workspaces.
 *
 * Doctrine: Commander must never feel trapped. Use an explicit Link to War Room home (`/`),
 * never history.back() / router.back() — those break when the page was opened directly,
 * from a desktop shell, or as the first history entry. Matches Foundry's home-escape pattern
 * (lib/native-builder/foundryNavigation.ts): Alt+H also returns home.
 *
 * Foundry surfaces keep FoundryHomeNav. Every other major page/view/workspace should render
 * this control (or an equivalent Link to WAR_ROOM_HOME_HREF).
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FOUNDRY_HOME_SHORTCUT_HINT,
  WAR_ROOM_HOME_HREF,
  matchesHomeShortcut,
} from '@/lib/native-builder/foundryNavigation'

export function WarRoomBackControl({
  label = 'Back to War Room',
  variant = 'header',
  className = '',
}: {
  label?: string
  variant?: 'header' | 'overlay'
  className?: string
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

  const overlay = variant === 'overlay'
  return (
    <Link
      href={WAR_ROOM_HOME_HREF}
      data-testid="war-room-back-control"
      title={`Back to War Room (${FOUNDRY_HOME_SHORTCUT_HINT})`}
      aria-label="Back to War Room"
      className={[
        overlay
          ? 'pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-400/70 bg-black/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-100 shadow-[0_0_22px_rgba(0,255,140,0.22)] backdrop-blur-md hover:border-emerald-200 hover:bg-emerald-950/80'
          : 'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-400/80 bg-emerald-950/80 px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-emerald-50 hover:border-emerald-200 hover:bg-emerald-900',
        className,
      ].filter(Boolean).join(' ')}
    >
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  )
}

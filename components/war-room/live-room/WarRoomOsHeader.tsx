'use client'

import { memo, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'

import { LogoutButton } from '@/components/auth/LogoutButton'
import { FoundryEntryLink } from '@/components/war-room/foundry/FoundryEntryLink'
import { CommanderStatusCluster } from './CommanderStatusCluster'
import type { CommanderStatusPill } from '@/lib/council/live-orchestration/rosterHealth'

export type WarRoomOsHeaderProps = {
  systemStatusLine?: string
  missionHint?: string
  statusPills?: CommanderStatusPill[]
  trailing?: ReactNode
}

function formatClock(now: Date) {
  return now.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * `systemStatusLine`/`missionHint` are intentionally accepted but unused in the header:
 * verbose backend strings belong in Inspector. Optional statusPills render the Commander cluster.
 */
export const WarRoomOsHeader = memo(function WarRoomOsHeader(props: WarRoomOsHeaderProps) {
  void props.systemStatusLine
  void props.missionHint
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()))
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header
      className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-cyan-900/40 px-4 py-2 sm:px-6"
      style={{ background: 'rgba(0,6,12,0.78)' }}
      data-testid="war-room-os-header"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.42em] text-emerald-400">War Room OS</p>
        <p className="truncate text-[11px] font-semibold tracking-widest text-cyan-100/90">
          Conversation first
        </p>
      </div>

      {props.statusPills?.length ? (
        <div className="min-w-0 flex-1">
          <CommanderStatusCluster pills={props.statusPills} />
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <time className="hidden text-[10px] tracking-widest text-slate-400 sm:block" dateTime={clock}>
          {clock || '—'}
        </time>
        {props.trailing ?? (
          <>
            <FoundryEntryLink
              testId="nav-foundry-header"
              className="rounded-full border border-emerald-400/40 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-200"
            >
              Foundry
            </FoundryEntryLink>
            <Link
              href="/search"
              className="rounded-full border border-white/10 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300"
            >
              Search
            </Link>
            <LogoutButton />
          </>
        )}
      </div>
    </header>
  )
})

'use client'

import { memo } from 'react'
import Link from 'next/link'

import type { CouncilFlowMode } from '@/lib/council/councilMode'
import { COUNCIL_FLOW_MODE_LABELS } from '@/lib/council/councilMode'
import type { DockPanelId } from './FeatureDock'

export type LiveRoomNavItem = {
  id: DockPanelId | 'live-council-focus'
  label: string
}

export const LIVE_ROOM_NAV_ITEMS: LiveRoomNavItem[] = [
  { id: 'live-council-focus', label: 'Live Council' },
  { id: 'command-intel', label: 'Command Intel' },
  { id: 'operations', label: 'Operations' },
  { id: 'memory-core', label: 'Memory Core' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'red-team', label: 'Red Team' },
  { id: 'system-health', label: 'System Health' },
  { id: 'settings', label: 'Settings' },
]

export type LiveRoomNavPanelProps = {
  activePanelId: DockPanelId | null
  councilFlowMode: CouncilFlowMode
  sessionId: string | null
  sessionStartedAt?: string | null
  onSelectPanel: (id: DockPanelId | null) => void
  onEndSession: () => void
}

function formatSessionStart(iso: string | null | undefined): string {
  if (!iso) return 'This session'
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return 'This session'
  }
}

export const LiveRoomNavPanel = memo(function LiveRoomNavPanel({
  activePanelId,
  councilFlowMode,
  sessionId,
  sessionStartedAt,
  onSelectPanel,
  onEndSession,
}: LiveRoomNavPanelProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto rounded border border-emerald-900/40 p-3 lg:max-w-[13rem]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      data-testid="live-room-nav-panel"
    >
      <nav aria-label="War Room navigation">
        <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.35em] text-emerald-500/80">Navigation</p>
        <ul className="space-y-1">
          {LIVE_ROOM_NAV_ITEMS.map(item => {
            const isCouncil = item.id === 'live-council-focus'
            const active = isCouncil ? activePanelId === null : activePanelId === item.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest transition"
                  style={{
                    border: active ? '1px solid rgba(52,211,153,0.55)' : '1px solid transparent',
                    color: active ? '#6ee7b7' : '#94a3b8',
                    background: active ? 'rgba(0,255,102,0.08)' : 'transparent',
                    boxShadow: active ? '0 0 12px rgba(0,255,102,0.12)' : undefined,
                  }}
                  onClick={() => onSelectPanel(isCouncil ? null : (item.id as DockPanelId))}
                >
                  {item.label}
                </button>
              </li>
            )
          })}
        </ul>
        <Link
          href="/war-room/code-operator"
          className="mt-2 block w-full rounded border border-emerald-900/50 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-950/20"
        >
          Code Operator
        </Link>
      </nav>

      <section
        className="mt-auto rounded border border-yellow-900/40 p-2.5"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        data-testid="active-session-card"
      >
        <p className="text-[9px] font-bold uppercase tracking-widest text-yellow-500/90">Active Session</p>
        <dl className="mt-2 space-y-1.5 text-[9px] tracking-wide text-slate-400">
          <div>
            <dt className="text-slate-600">Mode</dt>
            <dd className="text-yellow-200/90" title={COUNCIL_FLOW_MODE_LABELS[councilFlowMode]}>
              {councilFlowMode === 'stable_group' ? 'Stable Group' : councilFlowMode === 'full_council' ? 'Full Council' : 'Direct'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Session</dt>
            <dd className="truncate font-mono text-[8px] text-emerald-300/80" title={sessionId ?? undefined}>
              {sessionId ? sessionId.slice(0, 12) : 'Local'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Started</dt>
            <dd className="text-slate-300">{formatSessionStart(sessionStartedAt)}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="mt-3 w-full rounded border border-red-900/50 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-950/30"
          onClick={onEndSession}
        >
          End Session
        </button>
      </section>
    </aside>
  )
})

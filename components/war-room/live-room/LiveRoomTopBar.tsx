'use client'

import { memo } from 'react'
import { CanonicalStatusBadge } from '@/components/war-room/runtime/CanonicalStatusBadge'
type ProviderHealthStrip = {
  providers: Record<string, string>
  labels: Record<string, string>
}

const providerStatusStyles: Record<string, { dot: string; color: string; shadow?: string }> = {
  online: { dot: '#34D399', color: '#34D399', shadow: '0 0 6px #34D399' },
  standby: { dot: '#60A5FA', color: '#60A5FA' },
  degraded: { dot: '#FBBF24', color: '#FBBF24' },
  offline: { dot: '#64748B', color: '#64748B' },
  unavailable: { dot: '#F87171', color: '#F87171' },
}

function missionLabel(chatHealth: string, councilStateLabel: string): string {
  if (chatHealth && chatHealth !== 'Ready') return chatHealth
  return councilStateLabel
}

export const LiveRoomTopBar = memo(function LiveRoomTopBar({
  providerStripKeys,
  providerHealth,
  chatHealthLabel,
  councilStateLabel,
  missionExtra,
  rosterLine,
}: {
  providerStripKeys: string[]
  providerHealth: ProviderHealthStrip
  chatHealthLabel: string
  councilStateLabel: string
  missionExtra?: string
  rosterLine?: string
}) {
  const mission = missionLabel(chatHealthLabel, councilStateLabel)

  return (
    <div className="flex flex-col gap-2 px-4 py-2 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#FFD700]">Live Room Runtime</span>
        <span
          className="rounded border border-yellow-500/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-yellow-200"
          title="Council / decree mission state"
        >
          Mission: {mission}
          {missionExtra ? ` · ${missionExtra}` : ''}
        </span>
      </div>
      {rosterLine ? (
        <div className="text-[9px] font-semibold uppercase tracking-widest text-amber-200/90">{rosterLine}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-slate-500">Providers</span>
        {providerStripKeys.map(k => {
          const providerStatus = providerHealth.providers[k] ?? 'unavailable'
          const statusStyle = providerStatusStyles[providerStatus] ?? providerStatusStyles.unavailable
          return (
            <span key={k} className="flex items-center gap-1.5" title={providerHealth.labels[k] ?? k}>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: statusStyle.dot, boxShadow: statusStyle.shadow }}
              />
              <span className="text-[10px] tracking-widest" style={{ color: statusStyle.color }}>
                {k.toUpperCase()}
              </span>
            </span>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <CanonicalStatusBadge subsystemId="red_sentinel" label="Runtime" />
        <CanonicalStatusBadge subsystemId="signal_radar" label="Signals" />
        <CanonicalStatusBadge subsystemId="provider_runtime" label="Providers API" />
        <CanonicalStatusBadge subsystemId="approval_gate" label="Council" />
      </div>
    </div>
  )
})

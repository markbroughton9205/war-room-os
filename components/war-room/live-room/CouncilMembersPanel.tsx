'use client'

import { memo } from 'react'

import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'

type ProviderConnectionStatus = 'online' | 'standby' | 'not_connected' | 'error'

export type CouncilMembersPanelProps = {
  providerStatuses: Record<string, ProviderConnectionStatus | string>
  onOpenPanel?: (panel: 'command-intel' | 'operations' | 'memory-core' | 'approvals' | 'analytics' | 'red-team' | 'system-health' | 'settings') => void
}

const STATUS_DOT: Record<string, { color: string; glow?: string }> = {
  online: { color: '#34d399', glow: '0 0 8px #34d399' },
  standby: { color: '#fbbf24', glow: '0 0 6px #fbbf24' },
  not_connected: { color: '#64748b' },
  error: { color: '#f87171', glow: '0 0 8px #f87171' },
  degraded: { color: '#fbbf24' },
  unavailable: { color: '#f87171' },
  offline: { color: '#64748b' },
}

const MEMBER_ORDER: { id: string; label: string; rosterId?: string }[] = [
  { id: 'rael', label: "Ra'el", rosterId: undefined },
  { id: 'chatgpt', label: 'ChatGPT', rosterId: 'chatgpt' },
  { id: 'claude', label: 'Claude', rosterId: 'claude' },
  { id: 'gemini', label: 'Gemini', rosterId: 'gemini' },
  { id: 'grok', label: 'Grok', rosterId: 'grok' },
  { id: 'kimi', label: 'Kimi', rosterId: 'kimi' },
  { id: 'red_team', label: 'Red Team', rosterId: 'red_team' },
]

const QUICK_TOOLS: { label: string; panel: 'command-intel' | 'operations' | 'memory-core' | 'system-health' }[] = [
  { label: 'Command Intel', panel: 'command-intel' },
  { label: 'Operations', panel: 'operations' },
  { label: 'Memory Core', panel: 'memory-core' },
  { label: 'System Health', panel: 'system-health' },
]

function statusForMember(
  memberId: string,
  rosterId: string | undefined,
  providerStatuses: Record<string, string>,
): string {
  if (memberId === 'rael') return 'online'
  const key = rosterId ?? memberId
  const raw = providerStatuses[key] ?? providerStatuses[memberId.replace('_', '')] ?? 'not_connected'
  if (key === 'red_team') return providerStatuses.redteam ?? providerStatuses.red_team ?? raw
  return raw
}

export const CouncilMembersPanel = memo(function CouncilMembersPanel({
  providerStatuses,
  onOpenPanel,
}: CouncilMembersPanelProps) {
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto rounded border border-emerald-900/40 p-3 lg:max-w-[14rem]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      data-testid="council-members-panel"
    >
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-emerald-500/80">Council Members</p>
        <ul className="mt-2 space-y-2">
          {MEMBER_ORDER.map(member => {
            const status = statusForMember(member.id, member.rosterId, providerStatuses)
            const dot = STATUS_DOT[status] ?? STATUS_DOT.not_connected
            const roster = member.rosterId ? COUNCIL_ROSTER.find(r => r.id === member.rosterId) : null
            return (
              <li key={member.id} className="flex items-start gap-2">
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: dot.color, boxShadow: dot.glow }}
                  title={status}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-widest text-emerald-100">{member.label}</p>
                  {roster ? (
                    <p className="truncate text-[8px] tracking-wide text-slate-500">{roster.role}</p>
                  ) : (
                    <p className="text-[8px] tracking-wide text-yellow-600/80">Operator · Throne</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {onOpenPanel ? (
        <section>
          <p className="text-[9px] font-bold uppercase tracking-widest text-cyan-500/80">Quick Tools</p>
          <ul className="mt-2 space-y-1">
            {QUICK_TOOLS.map(tool => (
              <li key={tool.panel}>
                <button
                  type="button"
                  className="text-[9px] font-bold uppercase tracking-widest text-cyan-300/90 hover:text-cyan-200"
                  onClick={() => onOpenPanel(tool.panel)}
                >
                  {tool.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  )
})

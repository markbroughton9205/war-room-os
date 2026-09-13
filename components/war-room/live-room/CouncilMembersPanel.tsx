'use client'

import { memo } from 'react'

import { COUNCIL_ROSTER } from '@/lib/council/familyRoster'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import {
  FAMILY_OPERATION_STATUS_PRESENTATION,
  type FamilyOperationStatus,
  type FamilyOperationTone,
} from '@/lib/council/familyOperationStatus'
import { rosterMemberPresentation, type CouncilRosterSnapshot } from '@/lib/council/live-orchestration/rosterHealth'
import { CLOUD_PROVIDER_LABEL } from '@/lib/council/live-orchestration/councilContinuity'

type ProviderConnectionStatus = 'online' | 'standby' | 'not_connected' | 'error'

export type CouncilMembersPanelProps = {
  providerStatuses: Record<string, ProviderConnectionStatus | string>
  providerLabels?: Record<string, string>
  operationStatuses?: Partial<Record<string, FamilyOperationStatus>>
  councilRoster?: CouncilRosterSnapshot | null
  onOpenPanel?: (panel: 'command-intel' | 'operations' | 'memory-core' | 'approvals' | 'analytics' | 'red-team' | 'system-health' | 'settings') => void
}

const STATUS_DOT: Record<string, { color: string; glow?: string }> = {
  ready: { color: '#34d399', glow: '0 0 8px #34d399' },
  online: { color: '#34d399', glow: '0 0 8px #34d399' },
  standby: { color: '#fbbf24', glow: '0 0 6px #fbbf24' },
  needs_key: { color: '#64748b' },
  not_connected: { color: '#64748b' },
  quota: { color: '#f87171', glow: '0 0 8px #f87171' },
  error: { color: '#f87171', glow: '0 0 8px #f87171' },
  degraded: { color: '#fbbf24' },
  unavailable: { color: '#f87171' },
  offline: { color: '#64748b' },
}

const OPERATION_TONE_DOT: Record<FamilyOperationTone, { color: string; glow?: string }> = {
  green: { color: '#34d399', glow: '0 0 8px #34d399' },
  neutral: { color: '#64748b' },
  amber: { color: '#fbbf24', glow: '0 0 6px #fbbf24' },
  red: { color: '#f87171', glow: '0 0 8px #f87171' },
}

const PRIMARY_MEMBERS: { id: string; label: string; rosterId: string }[] = [
  { id: 'chatgpt', label: displayNameForSeat('chatgpt', 'AURORA'), rosterId: 'chatgpt' },
  { id: 'claude', label: displayNameForSeat('claude', 'ORION'), rosterId: 'claude' },
  { id: 'grok', label: displayNameForSeat('grok', 'PULSAR'), rosterId: 'grok' },
  { id: 'gemini', label: displayNameForSeat('gemini', 'LUMEN'), rosterId: 'gemini' },
]

const ADDITIONAL_MEMBERS: { id: string; label: string; rosterId: string }[] = [
  { id: 'nova', label: displayNameForSeat('nova', 'NOVA'), rosterId: 'nova' },
  { id: 'red_team', label: displayNameForSeat('red_team', 'PHOENIX'), rosterId: 'red_team' },
]

const QUICK_TOOLS: { label: string; panel: 'command-intel' | 'operations' | 'memory-core' | 'system-health' }[] = [
  { label: 'Command Intel', panel: 'command-intel' },
  { label: 'Operations', panel: 'operations' },
  { label: 'Memory Core', panel: 'memory-core' },
  { label: 'System Health', panel: 'system-health' },
]

export type MemberStatusPresentation = {
  tone: keyof typeof STATUS_DOT
  label: string
}

export function memberStatusPresentation(
  status: string,
  detailLabel?: string,
): MemberStatusPresentation {
  const haystack = `${status} ${detailLabel ?? ''}`.toLowerCase()
  if (/quota|rate.?limit|429|insufficient.?quota|billing|credit/.test(haystack)) {
    return { tone: 'quota', label: 'Quota issue' }
  }
  if (/needs.?key|not.?connected|api.?key|unconfigured|config.?needed|missing.?key/.test(haystack)) {
    return { tone: 'needs_key', label: 'Needs key' }
  }
  if (status === 'online' || status === 'standby') {
    return { tone: 'ready', label: 'Connected' }
  }
  if (/degraded|partial|fallback|mixed/.test(haystack) || status === 'degraded') {
    return { tone: 'degraded', label: 'Degraded' }
  }
  if (status === 'error' || status === 'unavailable' || status === 'offline') {
    return { tone: 'offline', label: 'Offline' }
  }
  return { tone: 'offline', label: 'Offline' }
}

function MemberRow({
  member,
  councilRoster,
  operationStatuses,
}: {
  member: { id: string; label: string; rosterId: string }
  councilRoster?: CouncilRosterSnapshot | null
  operationStatuses?: Partial<Record<string, FamilyOperationStatus>>
}) {
  const rosterRow = councilRoster?.families[member.rosterId as keyof typeof councilRoster.families]
  const presentation = rosterRow
    ? rosterMemberPresentation(rosterRow)
    : memberStatusPresentation('unavailable')
  const operationStatus = operationStatuses?.[member.rosterId]
  const operationPresentation = operationStatus ? FAMILY_OPERATION_STATUS_PRESENTATION[operationStatus] : null
  const dot = operationPresentation
    ? OPERATION_TONE_DOT[operationPresentation.tone]
    : (STATUS_DOT[presentation.tone] ?? STATUS_DOT.offline)
  const roster = COUNCIL_ROSTER.find(r => r.id === member.rosterId)
  const brainLine = rosterRow?.backingLine ?? ('localLine' in presentation ? presentation.localLine : null)
  return (
    <li className="flex items-start gap-2" data-testid={`council-member-${member.id}`}>
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ background: dot.color, boxShadow: dot.glow }}
        title={presentation.label}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <p className="text-[10px] font-bold tracking-widest text-emerald-100">{member.label}</p>
          <span className="text-[8px] font-semibold uppercase tracking-widest text-slate-500">
            {presentation.label}
            {operationPresentation ? ` · ${operationPresentation.label}` : ''}
          </span>
        </div>
        {typeof brainLine === 'string' && brainLine ? (
          <p className="text-[8px] tracking-wide text-slate-500">{brainLine}</p>
        ) : null}
        {roster ? (
          <p className="truncate text-[8px] tracking-wide text-slate-500">{roster.role}</p>
        ) : null}
      </div>
    </li>
  )
}

export const CouncilMembersPanel = memo(function CouncilMembersPanel({
  operationStatuses,
  councilRoster,
  onOpenPanel,
}: CouncilMembersPanelProps) {
  const optionalProviders: Array<{ name: string; state: string }> = [
    { name: CLOUD_PROVIDER_LABEL.chatgpt, state: councilRoster?.families.chatgpt?.cloudState ?? 'NOT_CONFIGURED' },
    { name: CLOUD_PROVIDER_LABEL.claude, state: councilRoster?.families.claude?.cloudState ?? 'NOT_CONFIGURED' },
    { name: CLOUD_PROVIDER_LABEL.grok, state: councilRoster?.families.grok?.cloudState ?? 'NOT_CONFIGURED' },
    { name: CLOUD_PROVIDER_LABEL.gemini, state: councilRoster?.families.gemini?.cloudState ?? 'NOT_CONFIGURED' },
  ]
  const headline = councilRoster?.entityHeadline?.replace(/^COUNCIL\s+/i, '') ?? 'READY · LIVE'
  const searchLabel = councilRoster?.researchProviders === 'LIVE'
    ? 'READY'
    : councilRoster?.researchProviders === 'CONFIG_NEEDED'
      ? 'CONFIG NEEDED'
      : councilRoster?.researchProviders ?? 'UNKNOWN'
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto rounded border border-emerald-900/40 p-3 lg:max-w-[14rem]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      data-testid="council-members-panel"
    >
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.35em] text-emerald-500/80">Council</p>
        {councilRoster ? (
          <div className="mt-1 space-y-0.5" data-testid="council-continuity-status">
            <p
              className={`text-[10px] font-semibold uppercase tracking-widest ${
                councilRoster.operationalState === 'UNAVAILABLE' ? 'text-rose-300/90' : 'text-emerald-200/90'
              }`}
            >
              {headline}
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Members {councilRoster.entityReadyCount} / {councilRoster.entityPresentCount} ready
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Backing {councilRoster.backingIntelligence.label}
              {councilRoster.backingIntelligence.ready ? ' READY' : ''}
            </p>
            {councilRoster.backingIntelligence.model ? (
              <p className="text-[8px] uppercase tracking-widest text-slate-500">
                Model {councilRoster.backingIntelligence.model}
              </p>
            ) : null}
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Model Diversity {councilRoster.modelDiversity}
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Perspective {councilRoster.reasoningDiversity}
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Live Internet {councilRoster.networkEgress}
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Sovereign Search {searchLabel}
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Terra {councilRoster.terraConnection}
            </p>
            <p className="text-[8px] uppercase tracking-widest text-slate-500">
              Optional External Brains {councilRoster.externalProviderCount.configured} configured
            </p>
          </div>
        ) : null}

        <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.35em] text-yellow-600/80">Operator</p>
        <ul className="mt-2 space-y-2">
          <li className="flex items-start gap-2" data-testid="council-member-rael">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: '#34d399', boxShadow: '0 0 8px #34d399' }} aria-hidden />
            <div>
              <p className="text-[10px] font-bold tracking-widest text-emerald-100">Ra&apos;el</p>
              <p className="text-[8px] tracking-wide text-yellow-600/80">Operator · Throne</p>
            </div>
          </li>
        </ul>

        <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.35em] text-emerald-500/80">Members</p>
        <ul className="mt-2 space-y-2">
          {PRIMARY_MEMBERS.map(member => (
            <MemberRow key={member.id} member={member} councilRoster={councilRoster} operationStatuses={operationStatuses} />
          ))}
        </ul>

        <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.35em] text-emerald-500/80">Additional</p>
        <ul className="mt-2 space-y-2">
          {ADDITIONAL_MEMBERS.map(member => (
            <MemberRow key={member.id} member={member} councilRoster={councilRoster} operationStatuses={operationStatuses} />
          ))}
        </ul>

        <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.35em] text-slate-500">Optional Model Providers</p>
        <ul className="mt-2 space-y-1" data-testid="optional-external-brains">
          {optionalProviders.map(provider => (
            <li key={provider.name} className="flex items-baseline justify-between gap-2">
              <span className="text-[8px] uppercase tracking-widest text-slate-400">{provider.name}</span>
              <span className="text-[8px] uppercase tracking-widest text-slate-500">{provider.state.replace(/_/g, ' ')}</span>
            </li>
          ))}
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

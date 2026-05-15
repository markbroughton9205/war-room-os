'use client'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCommand } from '@/lib/council/councilCommandTypes'
import type { CouncilRenderPacket } from '@/lib/council/renderPacket'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

const BADGES: { mode: CouncilCommand['mode']; label: string }[] = [
  { mode: 'attendance', label: 'ATTENDANCE' },
  { mode: 'execution', label: 'EXECUTION' },
  { mode: 'debate', label: 'DEBATE' },
  { mode: 'silent', label: 'SILENT' },
  { mode: 'research', label: 'RESEARCH' },
  { mode: 'council', label: 'COUNCIL ACTIVE' },
  { mode: 'emergency', label: 'EMERGENCY' },
  { mode: 'red_team_only', label: 'RED TEAM' },
  { mode: 'analysis', label: 'ANALYSIS' },
]

function commandSummary(cmd: CouncilCommand): string {
  const bits: string[] = [cmd.mode]
  if (cmd.targetFamilies.length) bits.push(`only: ${cmd.targetFamilies.join(', ')}`)
  if (cmd.excludedFamilies.length) bits.push(`except: ${cmd.excludedFamilies.join(', ')}`)
  bits.push(`≤${cmd.responseLimits.maxChars}c`)
  return bits.join(' · ')
}

const PACKET_STATUS_LABEL: Record<CouncilRenderPacket['packetStatus'], string> = {
  idle: 'PACKET · idle',
  gathering: 'PACKET · gathering',
  finalizing: 'PACKET · finalizing',
  released: 'PACKET · released',
}

function familyShort(id: CouncilOrchestrationFamily): string {
  if (id === 'red_team') return 'Red Team'
  if (id === 'bridge_architect') return 'Bridge'
  return id.replace(/_/g, ' ')
}

const PROVIDER_STATUS_LABEL: Record<string, string> = {
  READY: 'ready',
  RESPONDED: 'ok',
  TIMED_OUT: 'timed out',
  DEGRADED: 'degraded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  IN_FLIGHT: 'in flight',
}

export function CouncilCommandBadges({
  cmd,
  packet,
}: {
  cmd: CouncilCommand
  packet?: CouncilRenderPacket | null
}) {
  const sessionLine = packet
    ? `Session · ${packet.sessionState} · ${PACKET_STATUS_LABEL[packet.packetStatus]}`
    : 'Session · —'

  const familiesLine = packet?.participatingFamilies?.length
    ? `Families · ${packet.participatingFamilies.map(familyShort).join(', ')}`
    : packet?.packetStatus === 'gathering' || packet?.packetStatus === 'finalizing'
      ? 'Families · (pending release)'
      : null

  const drift = packet?.warnings?.length
    ? `Protocol / integrity · ${packet.warnings.slice(0, 6).join(' · ')}${packet.warnings.length > 6 ? ' …' : ''}`
    : null

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {BADGES.map(b => {
          const on = cmd.mode === b.mode
          return (
            <span
              key={b.mode}
              className="rounded px-2 py-0.5 text-[9px] font-bold tracking-widest transition-opacity"
              style={{
                border: on ? '1px solid rgba(255,215,0,0.55)' : '1px solid rgba(255,255,255,0.08)',
                color: on ? '#FFD700' : '#555',
                opacity: on ? 1 : 0.45,
                background: on ? 'rgba(255,215,0,0.08)' : 'transparent',
              }}
            >
              {b.label}
            </span>
          )
        })}
      </div>
      <p className="text-[8px] tracking-wide" style={{ color: '#555' }} title="Parsed from latest Ra’el decree">
        {commandSummary(cmd)}
      </p>
      {packet ? (
        <div className="space-y-0.5 border-t border-white/5 pt-1">
          <p className="text-[8px] font-bold tracking-widest" style={{ color: '#8B7355' }}>
            Active mode · {packet.mode}
          </p>
          <p className="text-[8px] tracking-wide" style={{ color: '#6a6a6a' }} title="Council resolution packet lifecycle">
            {sessionLine}
          </p>
          {familiesLine ? (
            <p className="text-[8px] tracking-wide" style={{ color: '#6a6a6a' }}>
              {familiesLine}
            </p>
          ) : null}
          {drift ? (
            <p className="text-[8px] leading-snug tracking-wide" style={{ color: '#b45309' }} title="Integrity and scope drift signals">
              {drift}
            </p>
          ) : null}
          {packet?.providerRuntimeStates && Object.keys(packet.providerRuntimeStates).length ? (
            <div className="flex flex-wrap gap-1 pt-0.5" title="Per-family provider outcome for the last gather">
              {(Object.entries(packet.providerRuntimeStates) as [CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus][]).map(
                ([fid, st]) => (
                  <span
                    key={fid}
                    className="rounded px-1.5 py-0.5 text-[8px] font-semibold tracking-wide"
                    style={{
                      border: '1px solid rgba(255,255,255,0.12)',
                      color:
                        st === 'RESPONDED'
                          ? '#9ca3af'
                          : st === 'TIMED_OUT'
                            ? '#d97706'
                            : st === 'FAILED'
                              ? '#b91c1c'
                              : st === 'IN_FLIGHT'
                                ? '#a78bfa'
                                : '#6b7280',
                      background: 'rgba(0,0,0,0.25)',
                    }}
                  >
                    {familyShort(fid)} · {PROVIDER_STATUS_LABEL[st] ?? st}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

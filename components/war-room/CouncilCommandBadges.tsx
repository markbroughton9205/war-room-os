'use client'

import type { CouncilCommand } from '@/lib/council/councilCommandTypes'

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

export function CouncilCommandBadges({ cmd }: { cmd: CouncilCommand }) {
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
    </div>
  )
}

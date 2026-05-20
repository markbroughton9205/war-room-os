'use client'

import { memo } from 'react'

import type { RibbonAiTeamSlice } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell } from './RibbonSegmentShell'

export const AiTeamSegment = memo(function AiTeamSegment({ aiTeam }: { aiTeam: RibbonAiTeamSlice }) {
  return (
    <RibbonSegmentShell
      label="AI Team"
      tone={aiTeam.tone}
      title={aiTeam.councilNote ? `${aiTeam.label} · ${aiTeam.councilNote}` : aiTeam.label}
      className="min-w-[10rem] sm:min-w-[11rem]"
    >
      <p className="truncate">{aiTeam.label}</p>
      {aiTeam.councilNote ? (
        <p className="mt-0.5 truncate text-[11px] font-normal text-slate-400">{aiTeam.councilNote}</p>
      ) : null}
    </RibbonSegmentShell>
  )
})

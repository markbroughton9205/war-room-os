'use client'

import { memo } from 'react'

import type { RibbonOpportunitiesSlice } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell } from './RibbonSegmentShell'

export const OpportunitySegment = memo(function OpportunitySegment({
  opportunities,
}: {
  opportunities: RibbonOpportunitiesSlice
}) {
  return (
    <RibbonSegmentShell
      label="Opportunities"
      tone={opportunities.count > 0 ? 'ok' : 'neutral'}
      title={opportunities.payoutAlert ?? opportunities.label}
      className="min-w-[10rem] sm:min-w-[11rem]"
    >
      <p className="truncate">{opportunities.label}</p>
      {opportunities.payoutAlert ? (
        <p className="mt-0.5 truncate text-[11px] font-normal text-amber-300/90">{opportunities.payoutAlert}</p>
      ) : null}
    </RibbonSegmentShell>
  )
})

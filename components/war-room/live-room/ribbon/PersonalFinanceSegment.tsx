'use client'

import { memo } from 'react'

import type { RibbonPersonalFinanceSlice } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell, type SegmentTone } from './RibbonSegmentShell'

export const PersonalFinanceSegment = memo(function PersonalFinanceSegment({
  finance,
}: {
  finance: RibbonPersonalFinanceSlice
}) {
  const tone: SegmentTone = finance.status === 'available' ? 'ok' : 'neutral'

  return (
    <RibbonSegmentShell
      label="Personal Finance"
      tone={tone}
      title={finance.label}
      className="min-w-[11rem] sm:min-w-[13rem]"
    >
      {finance.status === 'available' ? (
        <>
          <p className="truncate">{finance.label}</p>
          {finance.missionTrigger ? (
            <p className="mt-0.5 truncate text-[11px] font-normal text-emerald-300/90">{finance.missionTrigger}</p>
          ) : null}
        </>
      ) : (
        <p className="truncate text-slate-500">{finance.label}</p>
      )}
    </RibbonSegmentShell>
  )
})

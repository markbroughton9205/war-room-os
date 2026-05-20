'use client'

import { memo } from 'react'

import type { RibbonSymbolicSlice } from '@/lib/intelligence/ribbon/types'

import { RibbonSegmentShell } from './RibbonSegmentShell'

export const SymbolicSegment = memo(function SymbolicSegment({ symbolic }: { symbolic: RibbonSymbolicSlice }) {
  return (
    <RibbonSegmentShell
      label="Symbolic"
      title={symbolic.guidance}
      className="min-w-[10rem] max-w-[14rem] border-r-0 sm:min-w-[11rem]"
    >
      <p className="truncate text-[11px] font-normal italic text-violet-200/80">
        <span className="not-italic text-violet-300/70">{symbolic.sign} · </span>
        {symbolic.guidance}
      </p>
    </RibbonSegmentShell>
  )
})

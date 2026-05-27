'use client'

import { memo } from 'react'

import { TopIntelRibbon, type TopIntelRibbonProps } from './TopIntelRibbon'

export type MatrixTopIntelRowProps = TopIntelRibbonProps & {
  missionStatus: string
  councilHealthLabel: string
  activityFeedLabel: string
}

export const MatrixTopIntelRow = memo(function MatrixTopIntelRow({
  missionStatus,
  councilHealthLabel,
  activityFeedLabel,
  ...ribbonProps
}: MatrixTopIntelRowProps) {
  return (
    <div className="relative z-10 w-full border-b border-emerald-900/40" data-testid="matrix-top-intel-row">
      <TopIntelRibbon
        {...ribbonProps}
        missionStatus={missionStatus}
        councilHealthLabel={councilHealthLabel}
        activityFeedLabel={activityFeedLabel}
      />
    </div>
  )
})

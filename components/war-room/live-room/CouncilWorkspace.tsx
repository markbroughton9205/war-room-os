'use client'

import type { ReactNode, RefObject } from 'react'
import { LiveRoomCenter } from './LiveRoomCenter'

export type CouncilWorkspaceProps = {
  scrollContainerRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  toolbar: ReactNode
  preamble?: ReactNode
  thread: ReactNode
  composer?: ReactNode
  inlineBelowThread?: ReactNode
}

export function CouncilWorkspace({
  scrollContainerRef,
  onScroll,
  toolbar,
  preamble,
  thread,
  composer,
  inlineBelowThread,
}: CouncilWorkspaceProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2 sm:px-4" data-testid="council-workspace">
      <LiveRoomCenter
        scrollContainerRef={scrollContainerRef}
        onScroll={onScroll}
        toolbar={toolbar}
        preamble={preamble}
        thread={thread}
        composer={composer}
        inlineBelowThread={inlineBelowThread}
      />
    </div>
  )
}

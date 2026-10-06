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
  activeSessionId?: string | null
  transcriptOwnerId?: string | null
}

export function CouncilWorkspace({
  scrollContainerRef,
  onScroll,
  toolbar,
  preamble,
  thread,
  composer,
  inlineBelowThread,
  activeSessionId,
  transcriptOwnerId,
}: CouncilWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col px-2 py-1 sm:px-3 sm:py-2" data-testid="council-workspace">
      <LiveRoomCenter
        scrollContainerRef={scrollContainerRef}
        onScroll={onScroll}
        toolbar={toolbar}
        preamble={preamble}
        thread={thread}
        composer={composer}
        inlineBelowThread={inlineBelowThread}
        activeSessionId={activeSessionId}
        transcriptOwnerId={transcriptOwnerId}
      />
    </div>
  )
}

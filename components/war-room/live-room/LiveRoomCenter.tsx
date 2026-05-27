'use client'

import { useEffect, type ReactNode, type RefObject } from 'react'
import { readLiveCouncilScrollTop, writeLiveCouncilScrollTop } from '@/lib/war-room/liveRoomScroll'

export type LiveRoomCenterProps = {
  scrollContainerRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  toolbar: ReactNode
  preamble: ReactNode
  thread: ReactNode
  composer?: ReactNode
  inlineBelowThread?: ReactNode
}

export function LiveRoomCenter({
  scrollContainerRef,
  onScroll,
  toolbar,
  preamble,
  thread,
  composer,
  inlineBelowThread,
}: LiveRoomCenterProps) {
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const saved = readLiveCouncilScrollTop()
    if (saved == null) return
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = Math.min(saved, Math.max(0, el.scrollHeight - el.clientHeight))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [scrollContainerRef])

  const handleScroll = () => {
    const el = scrollContainerRef.current
    if (el) writeLiveCouncilScrollTop(el.scrollTop)
    onScroll()
  }

  return (
    <section
      data-testid="live-council-chat-card"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-emerald-900/50"
      style={{ background: 'rgba(0,8,4,0.62)', backdropFilter: 'blur(8px)', boxShadow: '0 0 32px rgba(0,255,102,0.06)' }}
    >
      <div
        className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-yellow-900/60 px-4 py-2 sm:px-6"
        style={{ background: 'rgba(0,0,0,0.5)' }}
      >
        {toolbar}
      </div>
      <div className="flex-shrink-0 px-4 pt-3 pb-2 sm:px-6">{preamble}</div>
      <div
        data-testid="live-council-messages"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6 [scroll-padding-bottom:var(--live-room-bottom-reserved,7rem)]"
      >
        {thread}
      </div>
      {inlineBelowThread ? (
        <div className="flex-shrink-0 border-t border-yellow-900/40 px-4 py-2 sm:px-6">{inlineBelowThread}</div>
      ) : null}
      {composer ? (
        <div
          className="flex-shrink-0 border-t border-yellow-900 px-4 py-4 sm:px-6"
          style={{ background: 'rgba(255,215,0,0.09)' }}
        >
          {composer}
        </div>
      ) : null}
    </section>
  )
}

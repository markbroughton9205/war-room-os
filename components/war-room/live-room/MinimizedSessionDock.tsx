'use client'

import { IconRestore } from '@/components/war-room/council/CommandIcons'

export function MinimizedSessionDock({
  title,
  status,
  messageCount,
  onRestore,
}: {
  title: string
  status: string
  messageCount?: number
  onRestore: () => void
}) {
  const countLabel =
    typeof messageCount === 'number'
      ? `${messageCount} message${messageCount === 1 ? '' : 's'}`
      : null

  return (
    <div
      className="live-intel-motion pointer-events-auto absolute bottom-3 left-1/2 z-30 flex w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-full border border-cyan-400/20 bg-[rgba(3,8,14,0.92)] px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      data-testid="minimized-session-dock"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 commander-status-pill" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-white">{title}</p>
        <p className="truncate text-[9px] uppercase tracking-[0.16em] text-slate-400">
          {status}
          {countLabel ? `  ·  ${countLabel}` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={onRestore}
        className="flex shrink-0 items-center gap-1 rounded-full border border-cyan-400/30 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300"
        aria-label="Restore conversation"
        title="Restore conversation"
        data-testid="restore-conversation"
      >
        <IconRestore />
        Restore
      </button>
    </div>
  )
}

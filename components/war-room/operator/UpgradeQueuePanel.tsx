'use client'

import { memo } from 'react'

import { useMatrixStatus } from '@/hooks/useMatrixStatus'
import {
  loadUpgradeQueue,
  updateUpgradeQueueEntry,
  type UpgradeQueueSnapshot,
} from '@/lib/operator/upgradeQueue'

export type UpgradeQueuePanelProps = {
  queue: UpgradeQueueSnapshot
  onQueueChange: (snapshot: UpgradeQueueSnapshot) => void
}

export const UpgradeQueuePanel = memo(function UpgradeQueuePanel({
  queue,
  onQueueChange,
}: UpgradeQueuePanelProps) {
  const { signalSuccess } = useMatrixStatus()
  const pending = queue.entries.filter(e => e.status === 'queued' || e.status === 'in_progress')

  const setStatus = (id: string, status: 'in_progress' | 'done' | 'skipped') => {
    onQueueChange(updateUpgradeQueueEntry(id, status))
    signalSuccess(`Upgrade ${status.replace('_', ' ')}`)
  }

  return (
    <section
      className="rounded border border-indigo-500/25 bg-black/30 p-3"
      data-testid="upgrade-queue-panel"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-200">
        Approved Upgrade Queue
      </p>
      <p className="mt-1 text-[9px] text-slate-500">
        Commander-approved repairs waiting for manual apply in Cursor — not auto-executed.
      </p>

      {pending.length ? (
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-[10px]">
          {pending.map(entry => (
            <li key={entry.id} className="rounded border border-white/10 bg-black/40 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-200">{entry.title}</span>
                <span className="text-[8px] uppercase tracking-widest text-amber-200/80">
                  {entry.risk} risk
                </span>
                <span className="text-[8px] uppercase tracking-widest text-indigo-300/70">
                  {entry.status}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[9px] text-slate-500">{entry.cursorCommand}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.status === 'queued' ? (
                  <QueueChip label="Start" onClick={() => setStatus(entry.id, 'in_progress')} />
                ) : null}
                <QueueChip label="Done" onClick={() => setStatus(entry.id, 'done')} />
                <QueueChip label="Skip" muted onClick={() => setStatus(entry.id, 'skipped')} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[9px] text-slate-500">No approved upgrades queued.</p>
      )}
    </section>
  )
})

export function loadUpgradeQueueState(): UpgradeQueueSnapshot {
  return loadUpgradeQueue()
}

function QueueChip({
  label,
  onClick,
  muted,
}: {
  label: string
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      className="min-h-[26px] rounded px-2 py-1 text-[8px] font-bold uppercase tracking-widest"
      style={{
        border: muted ? '1px solid rgba(148,163,184,0.45)' : '1px solid rgba(99,102,241,0.45)',
        color: muted ? '#94A3B8' : '#A5B4FC',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

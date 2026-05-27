'use client'

import { memo, useCallback, useMemo } from 'react'

import { CopyCouncilButton } from '@/components/war-room/council/CopyCouncilButton'
import {
  formatSessionTranscript,
  type CouncilMessageLike,
  type SessionTranscriptMeta,
} from '@/lib/operator/copyCouncilText'

export type ArchiveViewerMessage = CouncilMessageLike & {
  archivedFromLiveView?: boolean
}

export type ArchiveViewerProps = {
  visibleMessages: ArchiveViewerMessage[]
  archivedMessages: ArchiveViewerMessage[]
  hiddenCount: number
  meta?: SessionTranscriptMeta
  onClose: () => void
}

export const ArchiveViewer = memo(function ArchiveViewer({
  visibleMessages,
  archivedMessages,
  hiddenCount,
  meta,
  onClose,
}: ArchiveViewerProps) {
  const fullTranscript = useMemo(() => {
    const archivedIds = new Set(archivedMessages.map(m => m.id))
    const tagged: ArchiveViewerMessage[] = [
      ...archivedMessages.map(m => ({ ...m, archivedFromLiveView: true })),
      ...visibleMessages
        .filter(m => !archivedIds.has(m.id))
        .map(m => ({ ...m, archivedFromLiveView: false })),
    ]
    return tagged.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }, [archivedMessages, visibleMessages])

  const getFullArchiveText = useCallback(
    () => formatSessionTranscript(fullTranscript, meta),
    [fullTranscript, meta],
  )

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-viewer-title"
      data-testid="archive-viewer"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded border border-sky-500/35 bg-slate-950 shadow-2xl shadow-sky-950/40">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <p
              id="archive-viewer-title"
              className="text-[10px] font-black uppercase tracking-[0.3em] text-sky-300"
            >
              Archive Viewer
            </p>
            <p className="mt-1 text-[10px] tracking-wide text-slate-500">
              Full session transcript from this browser — {fullTranscript.length} message
              {fullTranscript.length === 1 ? '' : 's'}
              {hiddenCount > 0
                ? ` (${hiddenCount} hidden from live view, ${visibleMessages.length} visible)`
                : ''}
              . Copy Visible Log covers on-screen rows only; Copy Session matches this archive.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/15 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-300"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {fullTranscript.length === 0 ? (
            <p className="text-xs text-slate-500">No council messages in this session yet.</p>
          ) : (
            <ul className="space-y-3">
              {fullTranscript.map(message => (
                <li
                  key={message.id}
                  className="rounded border border-white/10 bg-black/40 px-3 py-2"
                  data-archived={message.archivedFromLiveView ? 'true' : 'false'}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] tracking-widest">
                    <span className="text-sky-200">{message.familyName}</span>
                    <span className="text-slate-500">{new Date(message.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[9px] tracking-widest text-slate-600">
                    <span>{message.messageType}</span>
                    {message.archivedFromLiveView ? (
                      <span className="text-sky-400/90">Archived from live view</span>
                    ) : (
                      <span className="text-emerald-500/80">Visible in live council</span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{message.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3">
          <CopyCouncilButton
            label="Copy Full Archive"
            getText={getFullArchiveText}
            successMessage="Copied"
            manualTitle="Full archive transcript"
            variant="accent"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
})

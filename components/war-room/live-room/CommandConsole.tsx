'use client'

import { memo, useRef, type ChangeEvent, type FormEvent } from 'react'
import { COUNCIL_FLOW_MODE_LABELS, type CouncilFlowMode } from '@/lib/council/councilMode'
import { matrixStatus } from '@/lib/ui/matrixStatusBus'

export type AttachmentStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error'

export type CommandConsoleProps = {
  command: string
  onCommandChange: (value: string) => void
  onSubmit: (event?: FormEvent) => void | Promise<void>
  loading?: boolean
  councilFlowMode: CouncilFlowMode
  onCouncilFlowModeChange: (mode: CouncilFlowMode) => void
  /** When false, council mode is controlled in the Live Council header (matrix operator view). */
  showFlowModeSelect?: boolean
  /**
   * Commander correction (2026-08-05) — attachment beside Execute, for books/documents the
   * Council should examine. Purely presentational here: file selection and status are owned by
   * the caller (app/page.tsx), which drives the actual upload (/api/files/upload) and scan
   * (/api/council/documents/scan) requests.
   */
  attachmentFileName?: string | null
  attachmentStatus?: AttachmentStatus
  attachmentError?: string | null
  onAttachmentSelect?: (file: File) => void
  onAttachmentRemove?: () => void
}

const FLOW_MODES: CouncilFlowMode[] = ['direct', 'stable_group', 'full_council']

const ATTACHMENT_STATUS_LABEL: Record<AttachmentStatus, string> = {
  idle: '',
  uploading: 'Uploading…',
  processing: 'Scanning…',
  ready: 'Ready',
  error: 'Failed',
}

export const CommandConsole = memo(function CommandConsole({
  command,
  onCommandChange,
  onSubmit,
  loading = false,
  councilFlowMode,
  onCouncilFlowModeChange,
  showFlowModeSelect = true,
  attachmentFileName = null,
  attachmentStatus = 'idle',
  attachmentError = null,
  onAttachmentSelect,
  onAttachmentRemove,
}: CommandConsoleProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const attachmentBusy = attachmentStatus === 'uploading' || attachmentStatus === 'processing'

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && onAttachmentSelect) onAttachmentSelect(file)
    event.target.value = ''
  }
  return (
    <footer
      className="relative z-20 max-h-[min(42vh,14rem)] flex-shrink-0 overflow-y-auto border-t border-emerald-800/60 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:max-h-none sm:px-4 sm:py-2"
      style={{ background: 'rgba(0,0,0,0.88)', boxShadow: '0 -4px 24px rgba(0,255,102,0.08)' }}
      data-testid="command-console"
    >
      <form
        className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2"
        onSubmit={event => {
          event.preventDefault()
          if (!loading && command.trim()) {
            matrixStatus('outbound', 'Decree sent to Council…')
          }
          void onSubmit(event)
        }}
      >
        <div
          className="flex min-w-0 flex-1 cursor-text items-stretch gap-2 rounded border border-emerald-700/50 px-2.5 py-1.5 sm:px-3 sm:py-2"
          style={{ background: 'rgba(0,20,8,0.55)', boxShadow: 'inset 0 0 20px rgba(0,255,102,0.04)' }}
          onMouseDown={e => {
            // Clicking anywhere in the composer surface (including padding around the input's
            // own line box) must focus the input, not fall through to the Cesium canvas behind it.
            if (e.target !== commandInputRef.current) {
              e.preventDefault()
              commandInputRef.current?.focus()
            }
          }}
        >
          <span className="hidden shrink-0 self-center text-[10px] font-bold tracking-widest text-emerald-400 sm:inline">RA&apos;EL@WARROOM:~$</span>
          <span className="shrink-0 self-center text-[10px] font-bold tracking-widest text-emerald-400 sm:hidden">~$</span>
          <input
            ref={commandInputRef}
            data-command-surface-id="live-council-primary-decree"
            data-command-surface-role="primary_decree"
            type="text"
            value={command}
            onChange={e => onCommandChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!loading && command.trim()) void onSubmit()
              }
            }}
            placeholder="Enter command or decree…"
            disabled={loading}
            className="min-w-0 flex-1 self-stretch bg-transparent text-sm tracking-wide text-emerald-100 outline-none placeholder:text-emerald-900/80"
            aria-label="Council command"
          />
        </div>

        {showFlowModeSelect ? (
          <label className="hidden shrink-0 items-center gap-2 text-[9px] uppercase tracking-widest text-slate-400 md:flex">
            Council Mode
            <select
              value={councilFlowMode}
              onChange={e => onCouncilFlowModeChange(e.target.value as CouncilFlowMode)}
              className="rounded border border-yellow-900/50 bg-black px-2 py-1.5 text-[10px] text-yellow-200 outline-none"
              aria-label="Council flow mode"
              title={COUNCIL_FLOW_MODE_LABELS[councilFlowMode]}
            >
              {FLOW_MODES.map(mode => (
                <option key={mode} value={mode}>
                  {mode === 'direct' ? 'Direct' : mode === 'stable_group' ? 'Stable Group' : 'Full Council'}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {onAttachmentSelect ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,.json,.csv,application/pdf,text/plain,text/markdown,application/json,text/csv"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Attach a document for the Council"
            />
            {attachmentFileName ? (
              <div
                className="flex shrink-0 items-center gap-1.5 rounded border px-2 py-1.5 text-[9px] tracking-wide"
                style={{
                  borderColor: attachmentStatus === 'error' ? 'rgba(248,113,113,0.5)' : 'rgba(96,165,250,0.4)',
                  color: attachmentStatus === 'error' ? '#F87171' : '#93C5FD',
                }}
                title={attachmentError ?? attachmentFileName}
              >
                <span className="max-w-[8rem] truncate">📎 {attachmentFileName}</span>
                {ATTACHMENT_STATUS_LABEL[attachmentStatus] ? (
                  <span className="opacity-80">· {ATTACHMENT_STATUS_LABEL[attachmentStatus]}</span>
                ) : null}
                {onAttachmentRemove ? (
                  <button
                    type="button"
                    onClick={onAttachmentRemove}
                    aria-label="Remove attachment"
                    className="ml-0.5 shrink-0 opacity-70 hover:opacity-100"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                disabled={attachmentBusy}
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 rounded border border-slate-500/50 px-3 py-1.5 text-[10px] font-bold tracking-widest text-slate-300 disabled:opacity-40 sm:px-3.5 sm:py-2"
                aria-label="Attach a document for the Council"
                title="Attach a book or document for the Council to examine"
              >
                📎 Attach
              </button>
            )}
          </>
        ) : null}

        <button
          type="submit"
          disabled={loading || !command.trim()}
          className="shrink-0 rounded border border-emerald-400/60 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-40 sm:px-5 sm:py-2"
          style={{ background: loading ? '#166534' : '#34d399', boxShadow: loading ? undefined : '0 0 16px rgba(52,211,153,0.35)' }}
        >
          {loading ? 'Council thinking…' : 'Execute'}
        </button>
      </form>
    </footer>
  )
})

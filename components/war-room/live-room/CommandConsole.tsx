'use client'

import { memo, type FormEvent } from 'react'
import { COUNCIL_FLOW_MODE_LABELS, type CouncilFlowMode } from '@/lib/council/councilMode'
import { matrixStatus } from '@/lib/ui/matrixStatusBus'

export type CommandConsoleProps = {
  command: string
  onCommandChange: (value: string) => void
  onSubmit: (event?: FormEvent) => void | Promise<void>
  loading?: boolean
  councilFlowMode: CouncilFlowMode
  onCouncilFlowModeChange: (mode: CouncilFlowMode) => void
  /** When false, council mode is controlled in the Live Council header (matrix operator view). */
  showFlowModeSelect?: boolean
}

const FLOW_MODES: CouncilFlowMode[] = ['direct', 'stable_group', 'full_council']

export const CommandConsole = memo(function CommandConsole({
  command,
  onCommandChange,
  onSubmit,
  loading = false,
  councilFlowMode,
  onCouncilFlowModeChange,
  showFlowModeSelect = true,
}: CommandConsoleProps) {
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
            matrixStatus('working', 'Council responding…')
          }
          void onSubmit(event)
        }}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2 rounded border border-emerald-700/50 px-2.5 py-1.5 sm:px-3 sm:py-2"
          style={{ background: 'rgba(0,20,8,0.55)', boxShadow: 'inset 0 0 20px rgba(0,255,102,0.04)' }}
        >
          <span className="hidden shrink-0 text-[10px] font-bold tracking-widest text-emerald-400 sm:inline">RA&apos;EL@WARROOM:~$</span>
          <span className="shrink-0 text-[10px] font-bold tracking-widest text-emerald-400 sm:hidden">~$</span>
          <input
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
            className="min-w-0 flex-1 bg-transparent text-sm tracking-wide text-emerald-100 outline-none placeholder:text-emerald-900/80"
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

        <button
          type="submit"
          disabled={loading || !command.trim()}
          className="shrink-0 rounded border border-emerald-400/60 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-40 sm:px-5 sm:py-2"
          style={{ background: loading ? '#166534' : '#34d399', boxShadow: loading ? undefined : '0 0 16px rgba(52,211,153,0.35)' }}
        >
          {loading ? 'Working…' : 'Execute'}
        </button>
      </form>
    </footer>
  )
})

'use client'

/**
 * Compact War Room-native conversation controls.
 * Normal Commander view hides Direct / Group / Council orchestration.
 * Expand remains a first-class view change, never a new session.
 */
import {
  IconCollapse,
  IconDirect,
  IconExpand,
  IconFullCouncil,
  IconInspector,
  IconJumpToLatest,
  IconSessions,
  IconSettings,
  IconStableGroup,
} from '@/components/war-room/council/CommandIcons'
import { COUNCIL_FLOW_MODE_LABELS, type CouncilFlowMode } from '@/lib/council/councilMode'

const COUNCIL_FLOW_MODES: readonly CouncilFlowMode[] = ['direct', 'stable_group', 'full_council']

const FLOW_MODE_SHORT_LABEL: Record<CouncilFlowMode, string> = {
  direct: 'Direct',
  stable_group: 'Group',
  full_council: 'Council',
}

const FLOW_MODE_ICON: Record<CouncilFlowMode, typeof IconDirect> = {
  direct: IconDirect,
  stable_group: IconStableGroup,
  full_council: IconFullCouncil,
}

const ICON_BUTTON_BASE =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40'

export type CouncilCommandControlsProps = {
  councilFlowMode: CouncilFlowMode
  onCouncilFlowModeChange: (mode: CouncilFlowMode) => void
  onOpenControls: () => void
  isChatExpanded: boolean
  onToggleExpand: () => void
  autoScrollEnabled: boolean
  onJumpToLatest: () => void
  statusLine?: string
  disabled?: boolean
  sessionNavOpen?: boolean
  onToggleSessionNav?: () => void
  inspectorOpen?: boolean
  onToggleInspector?: () => void
  /** Hide Direct/Group/Council and engineering Controls from the normal Commander surface. */
  commanderView?: boolean
}

export function CouncilCommandControls({
  councilFlowMode,
  onCouncilFlowModeChange,
  onOpenControls,
  isChatExpanded,
  onToggleExpand,
  autoScrollEnabled,
  onJumpToLatest,
  statusLine,
  disabled,
  sessionNavOpen,
  onToggleSessionNav,
  inspectorOpen,
  onToggleInspector,
  commanderView = false,
}: CouncilCommandControlsProps) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2" data-testid="council-command-controls">
      {statusLine && !commanderView ? (
        <span className="text-[10px] font-bold tracking-widest text-emerald-300">{statusLine}</span>
      ) : (
        <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-300/90">Conversation</span>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {!commanderView ? (
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Council conversation mode">
            {COUNCIL_FLOW_MODES.map(mode => {
              const Icon = FLOW_MODE_ICON[mode]
              const selected = councilFlowMode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${COUNCIL_FLOW_MODE_LABELS[mode]} council mode`}
                  title={COUNCIL_FLOW_MODE_LABELS[mode]}
                  disabled={disabled}
                  onClick={() => onCouncilFlowModeChange(mode)}
                  className={ICON_BUTTON_BASE}
                  data-testid={`council-mode-${mode}`}
                  style={{
                    border: selected ? '1px solid #FFD700' : '1px solid #333',
                    color: selected ? '#FFD700' : '#888',
                  }}
                >
                  <Icon />
                  <span>{FLOW_MODE_SHORT_LABEL[mode]}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        {onToggleSessionNav ? (
          <button
            type="button"
            onClick={onToggleSessionNav}
            disabled={disabled}
            className={ICON_BUTTON_BASE}
            style={{ border: '1px solid #34d399', color: '#6ee7b7' }}
            aria-label={sessionNavOpen ? 'Hide Council sessions' : 'Show Council sessions'}
            aria-pressed={sessionNavOpen}
            title={sessionNavOpen ? 'Hide Sessions' : 'Sessions'}
          >
            <IconSessions />
            <span>Sessions</span>
          </button>
        ) : null}
        {onToggleInspector ? (
          <button
            type="button"
            onClick={onToggleInspector}
            disabled={disabled}
            className={ICON_BUTTON_BASE}
            style={{
              border: inspectorOpen ? '1px solid #67e8f9' : '1px solid rgba(103,232,249,0.35)',
              color: '#a5f3fc',
            }}
            aria-label={inspectorOpen ? 'Hide Inspector' : 'Show Inspector'}
            aria-pressed={inspectorOpen}
            title={inspectorOpen ? 'Hide Inspector' : 'Advanced / Inspector'}
            data-testid="council-inspector-toggle"
          >
            <IconInspector />
            <span>{commanderView ? 'Advanced' : 'Inspector'}</span>
          </button>
        ) : null}
        {!commanderView ? (
          <button
            type="button"
            onClick={onOpenControls}
            disabled={disabled}
            className={ICON_BUTTON_BASE}
            style={{ border: '1px solid #93C5FD', color: '#93C5FD' }}
            aria-label="Open council controls panel"
            title="Controls"
          >
            <IconSettings />
            <span>Controls</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={disabled}
          className={ICON_BUTTON_BASE}
          data-testid="council-expand-toggle"
          style={{
            border: isChatExpanded ? '1px solid #FFD700' : '1px solid #67e8f9',
            color: isChatExpanded ? '#FFD700' : '#67e8f9',
            boxShadow: isChatExpanded ? '0 0 12px rgba(255,215,0,0.25)' : '0 0 10px rgba(103,232,249,0.18)',
          }}
          aria-label={isChatExpanded ? 'Restore compact conversation view' : 'Expand conversation'}
          aria-pressed={isChatExpanded}
          title={isChatExpanded ? 'Restore compact view' : 'Expand'}
        >
          {isChatExpanded ? <IconCollapse /> : <IconExpand />}
          <span>{isChatExpanded ? 'Restore' : 'Expand'}</span>
        </button>
        {!autoScrollEnabled ? (
          <button
            type="button"
            onClick={onJumpToLatest}
            className={ICON_BUTTON_BASE}
            style={{ background: '#FFD700', color: '#000' }}
            aria-label="Jump to latest Council message"
            title="Go to latest"
          >
            <IconJumpToLatest />
            <span>Latest</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

'use client'

/**
 * Council Command UI phase: compact, icon-led War Room-native controls replacing the large
 * text-heavy rectangular buttons that used to dominate the Council toolbar in app/page.tsx.
 * Same underlying state, same aria-labels/behavior as the original text buttons -- a presentation
 * change, never a new Council architecture. Every icon keeps a short visible label alongside it
 * (never an unlabeled glyph) plus a full-sentence title/aria-label for tooltips and screen
 * readers. Icons come from the shared components/war-room/council/CommandIcons.tsx set rather
 * than a second, locally-drawn icon library, so every War Room command surface speaks the same
 * glyph language.
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
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-40'

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
  /** Council Foundation session list rail — omit both props to hide the toggle entirely. */
  sessionNavOpen?: boolean
  onToggleSessionNav?: () => void
  /** Council Foundation right-side inspector panel — omit both props to hide the toggle entirely. */
  inspectorOpen?: boolean
  onToggleInspector?: () => void
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
}: CouncilCommandControlsProps) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2" data-testid="council-command-controls">
      {statusLine ? (
        <span className="text-[10px] font-bold tracking-widest text-emerald-300">{statusLine}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
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
            style={{ border: '1px solid #67e8f9', color: '#a5f3fc' }}
            aria-label={inspectorOpen ? 'Hide Council inspector' : 'Show Council inspector'}
            aria-pressed={inspectorOpen}
            title={inspectorOpen ? 'Hide Inspector' : 'Inspector'}
          >
            <IconInspector />
            <span>Inspector</span>
          </button>
        ) : null}
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
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={disabled}
          className={ICON_BUTTON_BASE}
          style={{
            border: isChatExpanded ? '1px solid #FFD700' : '1px solid #93C5FD',
            color: isChatExpanded ? '#FFD700' : '#93C5FD',
          }}
          aria-label={isChatExpanded ? 'Collapse chat to normal dashboard' : 'Expand chat to full view'}
          aria-pressed={isChatExpanded}
          title={isChatExpanded ? 'Collapse Chat' : 'Expand Chat'}
        >
          {isChatExpanded ? <IconCollapse /> : <IconExpand />}
          <span>{isChatExpanded ? 'Collapse' : 'Expand'}</span>
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

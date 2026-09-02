'use client'

/**
 * Council Command UI phase: compact, icon-led War Room-native controls replacing the large
 * text-heavy rectangular buttons that used to dominate the Council toolbar in app/page.tsx.
 * Extracted 1:1 -- same props, same underlying state, same aria-labels/behavior -- so this is a
 * presentation change only, never a new Council architecture. Every icon keeps a short visible
 * label alongside it (never an unlabeled glyph) plus a full-sentence title/aria-label for
 * tooltips and screen readers.
 */
import type { ReactNode } from 'react'
import { COUNCIL_FLOW_MODE_LABELS, type CouncilFlowMode } from '@/lib/council/councilMode'

const COUNCIL_FLOW_MODES: readonly CouncilFlowMode[] = ['direct', 'stable_group', 'full_council']

const FLOW_MODE_SHORT_LABEL: Record<CouncilFlowMode, string> = {
  direct: 'Direct',
  stable_group: 'Group',
  full_council: 'Council',
}

function DirectIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="4" fill="currentColor" />
    </svg>
  )
}

function StableGroupIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="5" cy="6" r="2.4" fill="currentColor" />
      <circle cx="11" cy="6" r="2.4" fill="currentColor" />
      <circle cx="8" cy="11" r="2.4" fill="currentColor" />
    </svg>
  )
}

function FullCouncilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      {[0, 60, 120, 180, 240, 300].map(angle => {
        const rad = (angle * Math.PI) / 180
        const x = 8 + Math.cos(rad) * 5.2
        const y = 8 + Math.sin(rad) * 5.2
        return <circle key={angle} cx={x} cy={y} r="1.35" fill="currentColor" />
      })}
    </svg>
  )
}

function ControlsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
      <circle cx="6" cy="4" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" />
    </svg>
  )
}

function LatestIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v8M4.5 7.5 8 11l3.5-3.5" />
    </svg>
  )
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
}: CouncilCommandControlsProps) {
  const modeIcon: Record<CouncilFlowMode, () => ReactNode> = {
    direct: DirectIcon,
    stable_group: StableGroupIcon,
    full_council: FullCouncilIcon,
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2" data-testid="council-command-controls">
      {statusLine ? (
        <span className="text-[10px] font-bold tracking-widest text-emerald-300">{statusLine}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Council conversation mode">
          {COUNCIL_FLOW_MODES.map(mode => {
            const Icon = modeIcon[mode]
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
        <button
          type="button"
          onClick={onOpenControls}
          disabled={disabled}
          className={ICON_BUTTON_BASE}
          style={{ border: '1px solid #93C5FD', color: '#93C5FD' }}
          aria-label="Open council controls panel"
          title="Controls"
        >
          <ControlsIcon />
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
          {isChatExpanded ? <CollapseIcon /> : <ExpandIcon />}
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
            <LatestIcon />
            <span>Latest</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

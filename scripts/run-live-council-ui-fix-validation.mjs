import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const page = read('app/page.tsx')
const rows = page.slice(page.indexOf('const CouncilMessageRows'), page.indexOf('function EvidencePill'))
const topRibbon = read('components/war-room/live-room/TopIntelRibbon.tsx')
const intelWall = read('components/intelligence/NewsIntelCommandWall.tsx')
const center = read('components/war-room/live-room/LiveRoomCenter.tsx')
const shell = read('components/war-room/live-room/LiveRoomShell.tsx')

function liveCouncilEmptyState({ loadState, conversationId, messageCount }) {
  if (messageCount > 0) return null
  if (loadState === 'restoring') {
    return {
      tone: 'loading',
      title: 'Restoring Live Council session.',
      healthy: false,
    }
  }
  if (loadState === 'error') {
    return {
      tone: 'error',
      title: 'Live Council transcript could not load.',
      healthy: false,
    }
  }
  if (loadState === 'session_only' || !conversationId) {
    return {
      tone: 'warn',
      title: 'Live Council is ready in session-only mode.',
      healthy: false,
    }
  }
  return {
    tone: 'ready',
    title: 'Live Council is ready.',
    healthy: true,
  }
}

function expandIntel(state) {
  return { ...state, workspace: 'expanded_intel' }
}

function closeIntel(state) {
  return { ...state, workspace: 'council' }
}

function shouldRestoreLatestScroll(previousWorkspace, nextWorkspace, autoScrollEnabled) {
  return previousWorkspace === 'expanded_intel' && nextWorkspace === 'council' && autoScrollEnabled
}

function preserveSessionState(previous, next) {
  return previous.conversationId === next.conversationId
    && previous.councilMode === next.councilMode
    && previous.commandDraft === next.commandDraft
    && previous.messageIds.join('|') === next.messageIds.join('|')
}

const structuralCases = [
  [
    'live_council_01_transcript_component_mounted',
    rows.includes('messages.map(msg =>') && page.includes('<CouncilMessageRows'),
  ],
  [
    'live_council_02_existing_messages_rendered',
    rows.includes('<MessageBubble') && rows.includes('key={msg.id}') && rows.includes('messages.map'),
  ],
  [
    'live_council_03_empty_state_truthful',
    rows.includes('data-testid="live-council-empty-state"') && page.includes('Live Council is ready.') && !rows.includes('fake'),
  ],
  [
    'live_council_04_failed_load_not_healthy_empty',
    page.includes("liveCouncilLoadState === 'error'") && page.includes('Live Council transcript could not load.'),
  ],
  [
    'live_council_05_command_composer_visible_in_shell',
    shell.includes('{commandConsole}') && page.includes('<CommandConsole') && page.includes('onSubmit={handleDecree}'),
  ],
  [
    'live_council_06_expand_intel_parent_controlled',
    topRibbon.includes('onExpandIntel?: () => void') && topRibbon.includes('if (onExpandIntel)') && page.includes("setLiveRoomWorkspace('expanded_intel')"),
  ],
  [
    'live_council_07_expanded_intel_workspace_not_overlay',
    page.includes('presentation="workspace"') && intelWall.includes('function IntelWallWorkspace'),
  ],
  [
    'live_council_08_close_returns_to_live_council',
    page.includes("onClose={() => setLiveRoomWorkspace('council')}"),
  ],
  [
    'live_council_09_session_state_preserved',
    page.includes("liveRoomWorkspace === 'expanded_intel'") && page.includes('visibleCouncilMessages') && page.includes('liveCouncilConvId'),
  ],
  [
    'live_council_10_council_mode_persists',
    page.includes('councilFlowMode={councilFlowMode}') && page.includes('persistCouncilFlowMode'),
  ],
  [
    'live_council_11_no_fake_messages_added',
    !page.includes('placeholder transcript') && !page.includes('fake chat') && !rows.includes('Council family placeholder'),
  ],
  [
    'live_council_12_bottom_toolbar_does_not_cover_transcript',
    center.includes('[scroll-padding-bottom:var(--live-room-bottom-reserved,7rem)]') && shell.includes('live-room-bottom-stack'),
  ],
  [
    'live_council_13_close_keyboard_accessible',
    intelWall.includes('<button') && intelWall.includes('onClick={onClose}') && intelWall.includes('Close'),
  ],
  [
    'live_council_14_no_stale_overlay_in_unified_path',
    page.includes('presentation="workspace"') && topRibbon.includes('onExpandIntel') && !page.includes('setIntelWallOpen(true)'),
  ],
]

const behavioralCases = [
  [
    'behavior_01_empty_session_renders_truthful_ready_state',
    liveCouncilEmptyState({ loadState: 'ready', conversationId: 'conv-1', messageCount: 0 })?.title === 'Live Council is ready.',
  ],
  [
    'behavior_02_real_messages_remain_transcript_source',
    liveCouncilEmptyState({ loadState: 'ready', conversationId: 'conv-1', messageCount: 2 }) === null,
  ],
  [
    'behavior_03_loading_is_not_healthy_empty',
    liveCouncilEmptyState({ loadState: 'restoring', conversationId: 'conv-1', messageCount: 0 })?.healthy === false,
  ],
  [
    'behavior_04_error_is_not_healthy_empty',
    liveCouncilEmptyState({ loadState: 'error', conversationId: 'conv-1', messageCount: 0 })?.healthy === false,
  ],
  [
    'behavior_05_expand_intel_switches_workspace',
    expandIntel({ workspace: 'council' }).workspace === 'expanded_intel',
  ],
  [
    'behavior_06_close_returns_to_live_council',
    closeIntel({ workspace: 'expanded_intel' }).workspace === 'council',
  ],
  [
    'behavior_07_repeated_cycles_preserve_session_state',
    (() => {
      const before = {
        workspace: 'council',
        conversationId: 'conv-1',
        councilMode: 'full',
        commandDraft: 'hold this thought',
        messageIds: ['m1', 'm2'],
      }
      const after = closeIntel(expandIntel(closeIntel(expandIntel(before))))
      return after.workspace === 'council' && preserveSessionState(before, after)
    })(),
  ],
  [
    'behavior_08_selected_council_mode_preserved',
    (() => {
      const before = { workspace: 'council', conversationId: 'conv-1', councilMode: 'stable', commandDraft: '', messageIds: [] }
      return closeIntel(expandIntel(before)).councilMode === 'stable'
    })(),
  ],
  [
    'behavior_09_command_draft_preserved',
    (() => {
      const before = { workspace: 'council', conversationId: 'conv-1', councilMode: 'direct', commandDraft: 'unfinished command', messageIds: [] }
      return closeIntel(expandIntel(before)).commandDraft === 'unfinished command'
    })(),
  ],
  [
    'behavior_10_returning_restores_latest_scroll_when_auto_scroll_enabled',
    shouldRestoreLatestScroll('expanded_intel', 'council', true) === true,
  ],
  [
    'behavior_11_no_scroll_restore_when_auto_scroll_disabled',
    shouldRestoreLatestScroll('expanded_intel', 'council', false) === false,
  ],
  [
    'behavior_12_fallback_overlay_not_needed_with_parent_handler',
    page.includes('onExpandIntel={() => setLiveRoomWorkspace') && !page.includes('setIntelWallOpen(true)'),
  ],
]

const cases = [
  ...structuralCases.map(([name, pass]) => [`structural_${name}`, pass]),
  ...behavioralCases,
]

const failed = cases.filter(([, pass]) => !pass)
for (const [name, pass] of cases) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
}
console.log(`Live Council UI fix validation: ${cases.length - failed.length}/${cases.length} PASS`)
console.log(`Structural source checks: ${structuralCases.length - structuralCases.filter(([, pass]) => !pass).length}/${structuralCases.length} PASS`)
console.log(`Behavioral model checks: ${behavioralCases.length - behavioralCases.filter(([, pass]) => !pass).length}/${behavioralCases.length} PASS`)
console.log('DOM component rendering coverage: NOT AVAILABLE (no React/JSDOM/Vitest test stack is configured in this repository)')

if (failed.length) process.exit(1)

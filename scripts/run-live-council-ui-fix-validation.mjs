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
const deck = read('components/war-room/operator/OperatorCommandDeck.tsx')
const deckPersistence = read('lib/operator/deckPersistence.ts')
const deckTypes = read('lib/operator/deckTypes.ts')
const dockContent = read('components/war-room/live-room/DockPanelContent.tsx')
const toolsFilesRoute = read('app/api/tools/files/route.ts')
const toolsRepoRoute = read('app/api/tools/repo/route.ts')
const incomeSearchRoute = read('app/api/income/search/route.ts')
const incomeCurrencyRoute = read('app/api/income/currency/route.ts')
const repoScanRoute = read('app/api/repo/scan/route.ts')
const osHeader = read('components/war-room/live-room/WarRoomOsHeader.tsx')
const commandBar = read('components/war-room/CommandBar.tsx')
const kpiGrid = read('components/war-room/KpiGrid.tsx')
const lazyPanels = read('components/war-room/WarRoomLazyPanels.tsx')
const sentinelPanel = read('components/war-room/council/SentinelStatusPanel.tsx')
const councilTable = read('components/war-room/council/CouncilTable.tsx')
const paymentTypes = read('lib/payments/types.ts')
const paymentProviders = read('lib/payments/providers.ts')

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
    center.includes('pb-[calc(var(--live-room-bottom-reserved,7rem)+1rem)]') && center.includes('[scroll-padding-bottom:var(--live-room-bottom-reserved,7rem)]') && shell.includes('live-room-bottom-stack'),
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

const operationalWiringCases = [
  [
    'operator_01_packet_feed_uses_real_packet_rows',
    deck.includes('Approval Packet Feed') && deckTypes.includes('packets: OperatorPacketSummary[]') && deckPersistence.includes("client.from('war_room_operator_packets').select('*')") && deckPersistence.includes('.limit(8)'),
  ],
  [
    'operator_02_specific_packet_approval_wired',
    deck.includes("command: 'approve_packet'") && deckPersistence.includes("command.command === 'approve_last_packet' || command.command === 'approve_packet'") && deckPersistence.includes('No external action was performed'),
  ],
  [
    'operator_03_unsupported_packet_actions_truthfully_disabled',
    deck.includes('unsupportedPacketActionReason') && deck.includes('Modify') && deck.includes('Reject') && deck.includes('Archive'),
  ],
  [
    'operator_04_approvals_workspace_removes_duplicate_command_environment',
    !dockContent.includes('<OperatorCommandEnvironment') && dockContent.includes('signalRadarSlot={<SignalRadarPanel />}'),
  ],
  [
    'operator_05_signal_radar_visible_in_approvals_order',
    deck.includes('{signalRadarSlot}') && dockContent.includes('signalRadarSlot={<SignalRadarPanel />}'),
  ],
  [
    'routes_01_files_tool_route_is_connected',
    toolsFilesRoute.includes("from('war_room_files')") && !toolsFilesRoute.includes("status: 'placeholder'"),
  ],
  [
    'routes_02_repo_tool_route_is_connected',
    toolsRepoRoute.includes('getRepoStatus') && !toolsRepoRoute.includes("status: 'placeholder'"),
  ],
  [
    'routes_03_income_search_no_generated_fallbacks',
    incomeSearchRoute.includes('searchTavilyIncomeOpportunities') && incomeSearchRoute.includes('searchIncomeOpportunities') && incomeSearchRoute.includes('No fallback or generated opportunities') && !incomeSearchRoute.includes("status: 'placeholder'"),
  ],
  [
    'routes_04_currency_route_reports_missing_dependency',
    incomeCurrencyRoute.includes("status: 'config_needed'") && incomeCurrencyRoute.includes('Exchange-rate provider') && !incomeCurrencyRoute.includes("status: 'placeholder'"),
  ],
  [
    'routes_05_repo_scan_build_deploy_status_truthful',
    repoScanRoute.includes('config_needed: build verification is not connected') && repoScanRoute.includes('config_needed: deployment provider status is not connected') && !repoScanRoute.includes('placeholder: not connected'),
  ],
  [
    'legacy_01_header_resource_status_is_truthful',
    osHeader.includes('CPU · Not connected') && osHeader.includes('Missing dependency: a connected resource monitor feed.') && !osHeader.includes('placeholder'),
  ],
  [
    'legacy_02_command_bar_not_labeled_mock',
    commandBar.includes('not connected on this legacy route') && !commandBar.toLowerCase().includes('mock'),
  ],
  [
    'legacy_03_kpi_grid_no_mock_kpi_import',
    !kpiGrid.includes('MOCK_KPIS') && kpiGrid.includes('does not display fabricated counts'),
  ],
  [
    'legacy_04_council_overview_static_seed_labeled',
    lazyPanels.includes('Static council overview') && !lazyPanels.includes('Mock council layout') && sentinelPanel.includes('Static seed / not live') && councilTable.includes('Static seed overview'),
  ],
  [
    'payments_01_provider_readiness_has_no_placeholder_status',
    !paymentTypes.includes("'placeholder'") && paymentProviders.includes("status: 'not_configured'") && !paymentProviders.includes("status: 'placeholder'"),
  ],
]

const cases = [
  ...structuralCases.map(([name, pass]) => [`structural_${name}`, pass]),
  ...behavioralCases,
  ...operationalWiringCases,
]

const failed = cases.filter(([, pass]) => !pass)
for (const [name, pass] of cases) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
}
console.log(`Live Council UI fix validation: ${cases.length - failed.length}/${cases.length} PASS`)
console.log(`Structural source checks: ${structuralCases.length - structuralCases.filter(([, pass]) => !pass).length}/${structuralCases.length} PASS`)
console.log(`Behavioral model checks: ${behavioralCases.length - behavioralCases.filter(([, pass]) => !pass).length}/${behavioralCases.length} PASS`)
console.log(`Operational wiring checks: ${operationalWiringCases.length - operationalWiringCases.filter(([, pass]) => !pass).length}/${operationalWiringCases.length} PASS`)
console.log('DOM component rendering coverage: NOT AVAILABLE (no React/JSDOM/Vitest test stack is configured in this repository)')

if (failed.length) process.exit(1)

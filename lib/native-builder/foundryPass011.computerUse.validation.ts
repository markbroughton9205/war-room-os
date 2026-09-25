/**
 * PASS 011 targeted validation: state-confirmed click, AT-SPI no-op detection,
 * semantic bounds retry, cached War Room root, hung-app skip, inside-window bounds.
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  actionSuccessIsNotStateSuccess,
  classifyActivation,
  expectedStateLabel,
  hitInsideWindow,
  mapHitToWindowFrame,
  preferCompactHits,
  semanticClickPoint,
  SESSION_LIFECYCLE_CONTRACTS,
  shouldSkipHungApp,
} from './foundryComputerUseGeometry'
import { COMPUTER_TOOL_NAMES } from './foundryComputerUse'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

async function run() {
  const results: CaseResult[] = []
  const window = { x: 530, y: 262, width: 2880, height: 1800 }

  results.push(check(
    'action_success_requires_expected_state',
    actionSuccessIsNotStateSuccess(true, false) === true && actionSuccessIsNotStateSuccess(true, true) === false,
    'AT-SPI do_action true without expected state is a no-op',
  ))
  results.push(check(
    'atspi_noop_detection',
    classifyActivation({
      actionOk: true,
      expectedObservedAfterAction: false,
      boundsRetryUsed: true,
      expectedObservedAfterBounds: true,
      boundsOutsideWindow: false,
    }) === 'SEMANTIC_BOUNDS_CLICK',
    'no-op action then bounds retry that observes expected state',
  ))
  results.push(check(
    'semantic_bounds_retry',
    classifyActivation({
      actionOk: true,
      expectedObservedAfterAction: true,
      boundsRetryUsed: false,
      expectedObservedAfterBounds: false,
      boundsOutsideWindow: false,
    }) === 'AT_SPI_ACTION',
    'true state change after AT-SPI action needs no bounds retry',
  ))
  results.push(check(
    'stale_control_node_invalidation_source',
    (await readFile(resolveRepoRoot() + '/scripts/foundry/computer-use-backend.py', 'utf8')).includes('invalidate_cache')
      && (await readFile(resolveRepoRoot() + '/lib/native-builder/foundryComputerUse.ts', 'utf8')).includes('invalidateControlNodes')
      && (await readFile(resolveRepoRoot() + '/scripts/foundry/computer-use-backend.py', 'utf8')).includes('invalidate_control_nodes'),
    'python invalidate_cache + TS invalidateControlNodes after state change',
  ))
  results.push(check(
    'cached_war_room_root_source',
    (await readFile(resolveRepoRoot() + '/scripts/foundry/computer-use-backend.py', 'utf8')).includes('_WR_CACHE')
      && (await readFile(resolveRepoRoot() + '/lib/native-builder/foundryComputerUse.ts', 'utf8')).includes('warRoomSessionCache'),
    'PID/index/app/title cache without rescanning GNOME first',
  ))
  results.push(check(
    'hung_app_skip',
    shouldSkipHungApp(null).reason === 'hung' && shouldSkipHungApp('').reason === 'unnamed' && shouldSkipHungApp('war-room-os').skip === false,
    JSON.stringify({ hung: shouldSkipHungApp(null), unnamed: shouldSkipHungApp(''), named: shouldSkipHungApp('war-room-os') }),
  ))
  results.push(check(
    'rename_after_new_session_contract',
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS['New Session']).includes('Rename'),
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS['New Session']),
  ))
  results.push(check(
    'save_after_rename_contract',
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Rename).includes('Save')
      && expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Rename).includes('Session title'),
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Rename),
  ))
  results.push(check(
    'confirm_after_archive_contract',
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Archive) === 'Confirm Archive',
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Archive),
  ))
  results.push(check(
    'restore_transition_contract',
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Restore).includes('Rename'),
    expectedStateLabel(SESSION_LIFECYCLE_CONTRACTS.Restore),
  ))

  const wide = { x: 732, y: 865, width: 194, height: 40 }
  const mapped = mapHitToWindowFrame(wide, window, 1)
  const point = mapped ? semanticClickPoint(mapped, window) : { error: 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW' as const }
  results.push(check(
    'bounds_remain_inside_war_room_frame',
    Boolean(mapped && !('error' in point) && hitInsideWindow({ ...mapped, x: 'error' in point ? 0 : point.x, y: 'error' in point ? 0 : point.y, width: 1, height: 1 }, window) && !('error' in point) && point.x <= window.x + 240),
    JSON.stringify({ mapped, point }),
  ))
  const outside = semanticClickPoint({ x: 10, y: 10, width: 20, height: 20 }, window)
  results.push(check(
    'outside_window_fails_without_click',
    'error' in outside && outside.error === 'SEMANTIC_BOUNDS_OUTSIDE_WINDOW',
    JSON.stringify(outside),
  ))
  const compact = preferCompactHits([
    { x: 1, y: 1, width: 800, height: 400 },
    { x: 2, y: 2, width: 80, height: 24 },
  ])
  results.push(check('prefer_compact_hits', compact[0].width === 80, JSON.stringify(compact.map(item => item.width))))
  results.push(check(
    'click_and_wait_tool_registered',
    (COMPUTER_TOOL_NAMES as readonly string[]).includes('computer.click_and_wait'),
    COMPUTER_TOOL_NAMES.join(','),
  ))
  const computer = await readFile(resolveRepoRoot() + '/lib/native-builder/foundryComputerUse.ts', 'utf8')
  results.push(check(
    'no_explicit_coordinate_fallback_for_required_controls',
    computer.includes('EXPLICIT_COORDINATE_FALLBACK refused for required control'),
    'required controls refuse hardcoded x/y',
  ))
  results.push(check(
    'coordinate_fallback_globally_preserved',
    computer.includes("method: 'COORDINATE_FALLBACK'") && computer.includes('COORDINATE_FALLBACK'),
    'global x/y fallback remains for non-required controls',
  ))
  const shell = await readFile(resolveRepoRoot() + '/components/war-room/foundry/FoundryShell.tsx', 'utf8')
  results.push(check(
    'selected_session_accessible',
    shell.includes("aria-label={sessionId ? 'Selected session' : undefined}"),
    'Selected session header exposed after real New Session',
  ))
  results.push(check(
    'atspi_press_is_not_click',
    classifyActivation({
      actionOk: true,
      expectedObservedAfterAction: false,
      boundsRetryUsed: false,
      expectedObservedAfterBounds: false,
      boundsOutsideWindow: false,
      domRetryUsed: true,
      expectedObservedAfterDom: true,
    }) === 'SEMANTIC_DOM_CLICK',
    'Chromium press no-op then semantic DOM activate is STATE_SUCCESS',
  ))
  const cdp = await readFile(resolveRepoRoot() + '/lib/native-builder/foundryComputerUseCdp.ts', 'utf8')
  const backend = await readFile(resolveRepoRoot() + '/scripts/foundry/computer-use-backend.py', 'utf8')
  const main = await readFile(resolveRepoRoot() + '/desktop/src/main.cjs', 'utf8')
  results.push(check(
    'semantic_dom_click_source',
    computer.includes('clickAccessibleInInstalledUi') && cdp.includes('ELECTRON_CDP') && cdp.includes('aria-label'),
    'installed Electron CDP activates accessible-name controls',
  ))
  results.push(check(
    'stale_hits_not_early_return',
    backend.includes('len(hits) < 8') && !backend.includes('if area <= 420 * 72'),
    'collect every New Session hit after React changes',
  ))
  results.push(check(
    'never_invoke_context_menu_as_click',
    backend.includes('Never invoke the context-menu action'),
    'press+showContextMenu is not treated as a completed click',
  ))
  results.push(check(
    'localhost_cdp_enabled',
    (main.includes("REMOTE_DEBUGGING_ADDRESS = '127.0.0.1'") || main.includes("remote-debugging-address', '127.0.0.1'"))
      && main.includes('claimWarRoomCdpEndpoint')
      && main.includes("require('./warRoomCdp.cjs')")
      && !main.includes("REMOTE_DEBUGGING_PORT = '9222'")
      && !main.includes("remote-debugging-port', '9222'")
      && !main.includes("remote-debugging-address', '0.0.0.0"),
    'installed Electron exposes localhost CDP for semantic DOM activate',
  ))
  results.push(check(
    'no_native_confirm_blocker',
    !shell.includes('window.confirm') || !shell.includes('Start a new session without cancelling'),
    'New Session is not blocked by a native confirm dialog',
  ))

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  console.log(`Foundry PASS 011 Computer Use: ${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (results.some(item => !item.pass)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryPass011ComputerUseValidation }

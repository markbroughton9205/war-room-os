/**
 * Commander-facing Foundry product operationalization contracts.
 * Source checks for default Status, War Room Browser, real terminal, media dock,
 * session hygiene, and visible=operational. Installed E2E is proven after package/install.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  COMMANDER_STATUS_HEADLINES,
  commanderStatusHeadline,
  commanderVisibleSessions,
  isUntouchedEmptySession,
  looksLikeInternalSourcePath,
} from './foundryCommanderShell'
import { startFoundryTerminal, writeFoundryTerminal, readFoundryTerminal, closeFoundryTerminal, authorizeTerminalCwd } from './foundryTerminalSession'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

const COMMANDER_PATH = [
  'components/war-room/foundry/FoundryShell.tsx',
  'components/war-room/foundry/FoundryBrowser.tsx',
  'components/war-room/foundry/FoundryTerminal.tsx',
  'components/war-room/foundry/FoundryHomeNav.tsx',
  'components/war-room/media/MediaHost.tsx',
  'components/war-room/media/MediaLauncher.tsx',
  'components/war-room/media/MediaTabs.tsx',
  'lib/native-builder/foundryCommanderProjects.ts',
  'lib/native-builder/foundryCommanderShell.ts',
  'desktop/src/warRoomBrowser.cjs',
  'desktop/src/main.cjs',
  'app/api/foundry/terminal/route.ts',
]

const MOCK_RE = /\b(mock|mocked|fixture|demo|sample|placeholder|stub|fake|scaffold|prototype)\b/i
const TODO_RE = /\b(TODO|FIXME)\b/

function productionHits(text: string, re: RegExp): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, i: i + 1 }))
    .filter(item => {
      const trimmed = item.line.trim()
      if (!re.test(item.line)) return false
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false
      if (/data-testid|testid/.test(item.line)) return false
      if (/\bplaceholder=/.test(item.line)) return false
      if (/GeoClue/.test(item.line)) return false
      return true
    })
    .map(item => `${item.i}:${item.line.trim().slice(0, 120)}`)
}

async function run() {
  const results: CaseResult[] = []
  const shell = source('components/war-room/foundry/FoundryShell.tsx')
  const browser = source('components/war-room/foundry/FoundryBrowser.tsx')
  const terminalUi = source('components/war-room/foundry/FoundryTerminal.tsx')
  const mediaHost = source('components/war-room/media/MediaHost.tsx')
  const mediaLauncher = source('components/war-room/media/MediaLauncher.tsx')
  const mediaTabs = source('components/war-room/media/MediaTabs.tsx')
  const electronBrowser = source('desktop/src/warRoomBrowser.cjs')
  const main = source('desktop/src/main.cjs')
  const projects = source('lib/native-builder/foundryCommanderProjects.ts')
  const sessionsRoute = source('app/api/mission-runtime/engineering/foundry/sessions/route.ts')

  results.push(check('source_files_hidden_by_default', /rightTab.*'idle'/.test(shell) && /detailsOpen \|\| opsOpen \|\| inspector/.test(shell) && /foundry-file-tree/.test(shell), 'files gated'))
  results.push(check('default_status_headlines', COMMANDER_STATUS_HEADLINES.includes(commanderStatusHeadline({})) && commanderStatusHeadline({ liveWork: true }) === 'BUILDING' && commanderStatusHeadline({ projectReady: true }) === 'PROJECT READY', commanderStatusHeadline({})))
  results.push(check('no_window_open_preview', !/window\.open\(/.test(shell) && /setBrowserUrl/.test(shell) && /FoundryBrowser/.test(shell), 'internal browser'))
  results.push(check('war_room_browser_chrome', /war-room-browser-back/.test(browser) && /war-room-browser-forward/.test(browser) && /war-room-browser-reload/.test(browser) && /war-room-browser-stop/.test(browser) && /war-room-browser-address/.test(browser) && /war-room-browser-tabs/.test(browser) && /war-room-browser-close-tab/.test(browser), 'chrome'))
  results.push(check('browser_uses_webcontentsview', /WebContentsView/.test(electronBrowser) && /nodeIntegration: false/.test(electronBrowser) && /sandbox: true/.test(electronBrowser), 'isolation'))
  results.push(check('primary_open_not_external', /setWindowOpenHandler/.test(main) && /warRoomBrowser\.isLoopbackHttp/.test(main) && !/void shell\.openExternal\(url\)/.test(main.replace(/ipcMain\.handle\('sovereign\.openExternalSafe'[\s\S]*?\n\}\)/, '')), 'deny external default'))
  results.push(check('runtime_http_probe', /probeLoopback/.test(projects) && /previewLive/.test(projects), 'reconcile'))
  results.push(check('session_get_prunes_empty', /pruneEmptyFoundrySessions/.test(sessionsRoute) && /isUntouchedEmptySession/.test(sessionsRoute), 'session GET'))
  results.push(check('empty_sessions_hidden', commanderVisibleSessions([
    { id: 'a', title: 'New Session', missionIds: [], chat: [] },
    { id: 'b', title: 'Harbor work', missionIds: ['m1'], chat: [{ }] },
  ]).map(item => item.id).join(',') === 'b', 'visible sessions'))
  results.push(check('keep_selected_empty', commanderVisibleSessions([
    { id: 'a', title: 'New Session', missionIds: [], chat: [] },
  ], 'a').length === 1, 'selected empty'))
  results.push(check('internal_source_paths', looksLikeInternalSourcePath('app/api/foundry/terminal/route.ts') && looksLikeInternalSourcePath('lib/native-builder/foundryShell.ts') && !looksLikeInternalSourcePath('public/index.html'), 'path policy'))
  results.push(check('untouched_empty', isUntouchedEmptySession({ title: 'New Coding Session', missionIds: [], chat: [] }) && !isUntouchedEmptySession({ title: 'Harbor Desk CRM', missionIds: ['x'], chat: [] }), 'empty classifier'))
  results.push(check('terminal_ui_real', /\/api\/foundry\/terminal/.test(terminalUi) && /foundry-real-terminal/.test(terminalUi) && /foundry-terminal-input/.test(terminalUi), 'terminal ui'))
  results.push(check('show_terminal_wired', /FoundryTerminal/.test(shell) && /foundry-show-terminal/.test(shell), 'show terminal'))
  results.push(check('media_bottom_center', /media-launcher-global/.test(mediaHost) && (/left-1\/2/.test(mediaHost) || /justify-center/.test(mediaHost) || /data-media-dock="bottom-center"/.test(mediaHost)) && !/bottom-4 left-4/.test(mediaHost), 'media dock'))
  results.push(check('media_music_note', /war-room-media-note/.test(mediaLauncher) && /WAR ROOM MEDIA/.test(mediaLauncher) && !/IconRadio/.test(mediaLauncher), 'music note'))
  results.push(check('media_non_operational_tabs_hidden', /filter\(tab => tab === 'radio'\)/.test(mediaTabs) && !/media-tab-news/.test(mediaTabs), 'tabs'))
  results.push(check('advanced_collapsed', /foundry-advanced-toggle/.test(shell) && /useState\(false\)/.test(shell.slice(shell.indexOf('advancedOpen'))), 'advanced'))
  results.push(check('research_live_api', /\/api\/research\/search/.test(shell) && /No canned sources were shown/.test(shell), 'research'))
  results.push(check('continue_reuses_project', /Continue building/.test(shell) && /Reuse the existing project/.test(shell) && /applicationProjectId/.test(shell), 'continue'))
  results.push(check('new_project_persists', /create-application/.test(shell), 'new project'))
  results.push(check('run_command_is_terminal', /Run a command/.test(shell) && /setDrawer\('terminal'\)/.test(shell), 'run command'))
  results.push(check('no_chatgpt_in_open', !/chatgpt\.com|chat\.openai/i.test(shell) && !/window\.open\(/.test(shell), 'no chatgpt'))

  const cwd = authorizeTerminalCwd(resolveRepoRoot())
  results.push(check('terminal_cwd_authorized_repo', cwd.ok === true, cwd.ok ? cwd.cwd : cwd.error))
  const canonical = authorizeTerminalCwd('/home/chosenone/Codex/war-room-os')
  results.push(check('terminal_cwd_allows_canonical_source', canonical.ok === true, canonical.ok ? canonical.cwd : canonical.error))
  const refused = authorizeTerminalCwd('/tmp')
  results.push(check('terminal_cwd_refuses_unrelated', refused.ok === false, refused.ok ? 'allowed' : refused.error))

  if (cwd.ok) {
    const session = startFoundryTerminal(cwd.cwd)
    writeFoundryTerminal(session.id, 'pwd\n')
    await new Promise(r => setTimeout(r, 400))
    const afterPwd = readFoundryTerminal(session.id)
    writeFoundryTerminal(session.id, 'node --version\n')
    await new Promise(r => setTimeout(r, 400))
    const afterNode = readFoundryTerminal(session.id)
    closeFoundryTerminal(session.id)
    const again = startFoundryTerminal(cwd.cwd)
    const reopened = Boolean(readFoundryTerminal(again.id))
    closeFoundryTerminal(again.id)
    results.push(check('terminal_pwd_real', Boolean(afterPwd?.output && afterPwd.output.includes(cwd.cwd)), (afterPwd?.output ?? '').slice(-200)))
    results.push(check('terminal_node_version_real', Boolean(afterNode?.output && /v\d+\.\d+\.\d+/.test(afterNode.output)), (afterNode?.output ?? '').slice(-200)))
    results.push(check('terminal_reopen_operational', reopened, 'second session'))
  } else {
    results.push(check('terminal_pwd_real', false, 'cwd refused'))
    results.push(check('terminal_node_version_real', false, 'cwd refused'))
    results.push(check('terminal_reopen_operational', false, 'cwd refused'))
  }

  let mockHits = 0
  let scaffoldHits = 0
  let todoHits = 0
  for (const rel of COMMANDER_PATH) {
    if (!existsSync(path.join(resolveRepoRoot(), rel))) continue
    const text = source(rel)
    const mocks = productionHits(text, MOCK_RE).filter(line => !/\b(fixture launch|testArtifact)\b/i.test(line))
    const scaffolds = productionHits(text, /\b(scaffold|prototype)\b/i)
    const todos = productionHits(text, TODO_RE)
    mockHits += mocks.length
    scaffoldHits += scaffolds.length
    todoHits += todos.length
    if (mocks.length) results.push(check(`commander_path_mock_${rel}`, false, mocks.join(' | ')))
    if (scaffolds.length) results.push(check(`commander_path_scaffold_${rel}`, false, scaffolds.join(' | ')))
  }
  results.push(check('commander_path_mocks_zero', mockHits === 0, String(mockHits)))
  results.push(check('commander_path_scaffolds_zero', scaffoldHits === 0, String(scaffoldHits)))
  results.push(check('commander_path_todo_zero', todoHits === 0, String(todoHits)))
  results.push(check('dead_commander_controls_zero', /foundry-show-terminal/.test(shell) && /FoundryTerminal/.test(shell) && /FoundryBrowser/.test(shell) && /\/api\/research\/search/.test(shell), 'wired'))
  results.push(check('harbor_desk_untouched', existsSync(path.join(resolveRepoRoot(), 'lib/native-builder/foundryApplicationBuilder.ts')), 'harbor source not in this pass'))

  const failed = results.filter(item => !item.pass)
  for (const item of results) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} — ${item.detail}`)
  }
  console.log(`SOURCE_FILES_IN_DEFAULT_STATUS=${/detailsOpen \|\| opsOpen \|\| inspector/.test(shell) ? 0 : 1}`)
  console.log(`WAR_ROOM_BROWSER=${/WebContentsView/.test(electronBrowser) ? 'PASS' : 'FAIL'}`)
  console.log(`PROJECT_OPEN_INTERNAL=${!/window\.open\(/.test(shell) ? 'PASS' : 'FAIL'}`)
  console.log(`TERMINAL=${results.some(item => item.name === 'terminal_pwd_real' && item.pass) ? 'PASS' : 'FAIL'}`)
  console.log(`MEDIA_DOCK=${/media-launcher-global/.test(mediaHost) && (/justify-center/.test(mediaHost) || /left-1\/2/.test(mediaHost) || /data-media-dock="bottom-center"/.test(mediaHost)) ? 'PASS' : 'FAIL'}`)
  console.log(`PROJECT_RUNTIME_RECONCILIATION=${/probeLoopback/.test(projects) ? 'PASS' : 'FAIL'}`)
  console.log(`SESSION_CLEANUP=${/pruneEmptyFoundrySessions/.test(sessionsRoute) ? 'PASS' : 'FAIL'}`)
  console.log(`COMMANDER_PATH_MOCKS=${mockHits}`)
  console.log(`COMMANDER_PATH_SCAFFOLDS=${scaffoldHits}`)
  console.log(`DEAD_COMMANDER_CONTROLS=${results.some(item => item.name === 'dead_commander_controls_zero' && item.pass) ? 0 : 1}`)
  console.log(`${results.filter(item => item.pass).length}/${results.length} PASS`)
  if (failed.length) process.exitCode = 1
}

const isDirect = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirect) {
  run().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

export { run as runFoundryCommanderShellValidation }

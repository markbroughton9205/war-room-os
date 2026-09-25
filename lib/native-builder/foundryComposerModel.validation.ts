/**
 * Composer model validation: modes are wired to real mission-controller behavior, the model registry
 * view is truthful, and context references reach the request text.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  FOUNDRY_COMPOSER_MODES,
  buildContextView,
  contextFilesUrl,
  isFoundryMetadataPath,
  resolveContextFiles,
  buildModelRegistryView,
  insertContextReference,
  routeForMode,
  parseComposerMode,
} from './foundryComposerModel'

type CaseResult = { name: string; pass: boolean; detail: string }
const results: CaseResult[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`)
}

function main() {
  // ---- Modes are real ----
  check('modes_are_the_three_foundry_modes', FOUNDRY_COMPOSER_MODES.map(m => m.id).join(',') === 'ask,agent,standalone', FOUNDRY_COMPOSER_MODES.map(m => m.id).join(','))
  check('parse_defaults_to_agent', parseComposerMode(undefined) === 'agent' && parseComposerMode('nonsense') === 'agent' && parseComposerMode('ask') === 'ask' && parseComposerMode('standalone') === 'standalone', 'parse')

  check('ask_routes_to_the_read_only_endpoint', routeForMode('ask') === 'ask-endpoint', routeForMode('ask'))
  check('agent_is_the_unchanged_default_path', routeForMode('agent') === 'session-mission', routeForMode('agent'))
  check('standalone_routes_to_the_mission_controller', routeForMode('standalone') === 'mission-controller', routeForMode('standalone'))
  check('every_mode_has_a_distinct_real_path', new Set(FOUNDRY_COMPOSER_MODES.map(m => routeForMode(m.id))).size === 3, 'distinct')

  // ---- Model registry is truthful ----
  const ready = buildModelRegistryView({
    known: true,
    local: { state: 'READY', label: 'Qwen 2.5 Coder 14B', model: 'qwen2.5-coder:14b', detail: 'ok' },
    brain: { ready: false, provider: 'claude', modelId: 'sonnet', usageLimited: false, detail: 'no key' },
    providers: [{ family: 'claude', configured: false }, { family: 'gpt', configured: true }],
  })
  check('registry_current_is_foundry_auto_local', ready.current.label === 'Foundry Auto' && ready.current.locality === 'local' && ready.current.state === 'ready', JSON.stringify(ready.current))
  check('registry_only_auto_is_selectable', ready.entries.filter(e => e.selectable).map(e => e.id).join(',') === 'foundry-auto' && ready.entries[0].selected, ready.entries.map(e => `${e.id}:${e.selectable}`).join(' '))
  check('registry_lists_local_model_with_state', ready.entries.some(e => e.locality === 'local' && e.label === 'qwen2.5-coder:14b' && e.state === 'ready'), 'local')
  check('registry_brain_state_is_honest', ready.entries.some(e => e.id.startsWith('brain:claude') && e.state === 'unavailable'), ready.entries.map(e => `${e.id}:${e.state}`).join(' '))
  check('registry_configured_provider_not_claimed_reachable', ready.entries.some(e => e.id === 'provider:gpt' && e.state === 'configured' && e.detail.includes('Not verified live')), 'gpt configured')
  check('registry_unconfigured_providers_are_not_listed', ready.entries.every(e => e.id !== 'provider:claude' && e.state !== 'not configured'), ready.entries.map(e => e.id).join(' '))
  check('registry_local_entry_uses_the_model_name_not_a_status', ready.entries.some(e => e.id === 'local:qwen2.5-coder:14b' && e.label === 'qwen2.5-coder:14b') && ready.entries[0].detail === 'Routes work to qwen2.5-coder:14b', ready.entries[0].detail)
  check('registry_has_no_invented_names', ready.entries.every(e => ['foundry-auto', 'local:qwen2.5-coder:14b', 'brain:claude:sonnet', 'provider:gpt'].includes(e.id)), ready.entries.map(e => e.id).join(' '))
  const down = buildModelRegistryView({ known: true, local: { state: 'ERROR', label: 'Local model error', model: null }, brain: { ready: false, provider: 'claude' }, providers: [] })
  check('registry_unavailable_when_nothing_ready', down.current.state === 'unavailable' && down.entries[0].state === 'unavailable', JSON.stringify(down.current))
  const limited = buildModelRegistryView({ known: true, local: null, brain: { ready: true, provider: 'gpt', modelId: 'x', usageLimited: true }, providers: [] })
  check('registry_limited_is_not_ready', limited.current.state === 'limited' && limited.entries.some(e => e.state === 'limited'), JSON.stringify(limited.current))
  const unknown = buildModelRegistryView({ known: false })
  check('registry_unknown_status_is_not_ready', unknown.current.state === 'unknown' && unknown.entries.length === 1, JSON.stringify(unknown.current))

  // ---- Context only offers real sources ----
  const ctx = buildContextView({ files: ['backend/api.py', 'frontend/view.py'], changedFiles: ['backend/api.py'] })
  check('context_connected_sources', ctx.connected.map(c => `${c.id}:${c.count}`).join(',') === 'files:2,changes:1', ctx.connected.map(c => c.id).join(','))
  check('context_unsupported_sources_are_labelled_not_faked', ctx.notConnected.includes('Web') && ctx.notConnected.includes('Terminal') && !ctx.connected.some(c => ctx.notConnected.includes(c.label)), ctx.notConnected.join(','))
  check('context_empty_when_nothing_exists', buildContextView({ files: [] }).connected.length === 0, 'empty')
  check('context_reference_reaches_request_text', insertContextReference('Fix this', 'backend/api.py') === 'Fix this @backend/api.py ' && insertContextReference('', 'a.py') === '@a.py ', insertContextReference('Fix this', 'backend/api.py'))
  check('context_reference_not_duplicated', insertContextReference('Fix @a.py ', 'a.py') === 'Fix @a.py ', 'idempotent')


  // ---- Context files load by workspace, never by panel visibility (04d13) ----
  const PROJECT = ['README.md', 'backend/api.py', 'frontend/view.py', 'shared/contract.py', 'tests/test_tickets.py', 'commander-facts.json', 'foundry-memory.json', '.war-room/native-builder/repairs/x.json']
  const listed = (ws: string) => ({ workspaceId: ws, ok: true })
  const filesOf = (r: ReturnType<typeof resolveContextFiles>) => buildContextView({ files: r.files, filesState: r.state })

  // CASE 1: files present, Advanced closed. The loader takes no visibility input at all: it is keyed by workspace only.
  const c1 = resolveContextFiles({ workspaceId: 'ws-a', listedFor: listed('ws-a'), files: PROJECT })
  const v1 = filesOf(c1)
  check('case1_files_populated_with_advanced_closed', c1.state === 'ready' && v1.connected.some(s => s.id === 'files' && s.paths.includes('backend/api.py')), v1.connected.map(s => `${s.id}:${s.count}`).join(','))
  check('case1_url_depends_only_on_workspace', contextFilesUrl('ws-a') === '/api/mission-runtime/engineering/repo/files?workspaceId=ws-a' && contextFilesUrl(null) === null && contextFilesUrl(undefined) === null && contextFilesUrl('') === null && contextFilesUrl.length === 1, String(contextFilesUrl.length))
  const shellSource = readFileSync(path.join(process.cwd(), 'components/war-room/foundry/FoundryShell.tsx'), 'utf8')
  const effectStart = shellSource.indexOf('const changedFilesKey')
  const effectBlock = effectStart >= 0 ? shellSource.slice(effectStart, shellSource.indexOf('}, [workspaceId, changedFilesKey])', effectStart) + 60) : ''
  check('case1_shell_loader_is_not_gated_by_panel_flags', effectBlock.length > 200 && effectBlock.includes('contextFilesUrl(workspaceId)') && !/\b(inspector|showInspector|detailsOpen|advancedOpen|opsOpen|rightTab)\b/.test(effectBlock), `block=${effectBlock.length} chars`)
  check('case1_shell_reload_no_longer_clears_files_when_inspector_closed', !/else \{\s*setFiles\(\[\]\)/.test(shellSource), 'no else-clear')

  // CASE 2: Advanced open yields the same Files. The inspector refresh writes the same listing for the same workspace.
  const c2 = resolveContextFiles({ workspaceId: 'ws-a', listedFor: listed('ws-a'), files: PROJECT })
  check('case2_files_identical_with_advanced_open', JSON.stringify(filesOf(c2).connected) === JSON.stringify(v1.connected), 'same')

  // CASE 3: Advanced closed again: nothing clears the listing (state is workspace-scoped, not flag-scoped).
  const c3 = resolveContextFiles({ workspaceId: 'ws-a', listedFor: listed('ws-a'), files: PROJECT })
  check('case3_files_remain_after_advanced_reclosed', JSON.stringify(filesOf(c3).connected) === JSON.stringify(v1.connected) && c3.files.length === PROJECT.length, String(c3.files.length))

  // CASE 4: different workspace: never the old project's files; loading until the new listing arrives; then refreshed.
  const c4a = resolveContextFiles({ workspaceId: 'ws-b', listedFor: listed('ws-a'), files: PROJECT })
  check('case4_switch_hides_previous_workspace_files', c4a.files.length === 0 && c4a.state === 'loading', c4a.state)
  const c4b = resolveContextFiles({ workspaceId: 'ws-b', listedFor: listed('ws-b'), files: ['app.js', 'index.html'] })
  check('case4_switch_refreshes_for_new_workspace', c4b.state === 'ready' && filesOf(c4b).connected[0].paths.join(',') === 'app.js,index.html', c4b.files.join(','))

  // CASE 5: a genuinely empty workspace is "ready" with no files (the menu shows "No project files yet"); loading is not empty.
  const c5 = resolveContextFiles({ workspaceId: 'ws-empty', listedFor: listed('ws-empty'), files: [] })
  check('case5_true_empty_workspace_is_ready_and_empty', c5.state === 'ready' && filesOf(c5).connected.length === 0 && filesOf(c5).filesState === 'ready', c5.state)
  check('case5_loading_and_failed_listings_are_not_reported_as_empty', resolveContextFiles({ workspaceId: 'ws-a', listedFor: null, files: [] }).state === 'loading' && resolveContextFiles({ workspaceId: 'ws-a', listedFor: { workspaceId: 'ws-a', ok: false }, files: [] }).state === 'unavailable', 'states')
  check('case5_no_workspace_selected_is_ready_empty', resolveContextFiles({ workspaceId: null, listedFor: null, files: [] }).state === 'ready', 'no workspace')

  // CASE 6: Changed files still works and is independent of the Files listing state.
  const c6 = buildContextView({ files: [], changedFiles: ['backend/api.py'], filesState: 'loading' })
  check('case6_changed_files_functional_even_while_files_load', c6.connected.length === 1 && c6.connected[0].id === 'changes' && c6.connected[0].paths[0] === 'backend/api.py', JSON.stringify(c6.connected))
  const c6b = buildContextView({ files: PROJECT, changedFiles: ['backend/api.py'], filesState: 'ready' })
  check('case6_files_and_changed_files_both_present', c6b.connected.map(s => s.id).join(',') === 'files,changes', c6b.connected.map(s => s.id).join(','))

  // CASE 7: unsupported sources stay visibly not connected and are never listed as connected.
  check('case7_unsupported_sources_not_connected', c6b.notConnected.join(',') === 'Codebase,Web,Git,Terminal,Selection' && !c6b.connected.some(s => c6b.notConnected.includes(s.label)), c6b.notConnected.join(','))

  // CASE 8: an @file reference from the menu reaches the request text.
  check('case8_file_reference_reaches_request_text', insertContextReference('', c6b.connected[0].paths[0]) === `@${c6b.connected[0].paths[0]} ` && insertContextReference('Fix it', 'backend/api.py') === 'Fix it @backend/api.py ', insertContextReference('Fix it', 'backend/api.py'))

  // CASE 9: opening Context causes no mutation. The model is pure (inputs are not modified) and the loader is a GET only.
  const frozen = Object.freeze([...PROJECT])
  let threw = false
  try { buildContextView({ files: frozen, changedFiles: Object.freeze(['backend/api.py']) }); resolveContextFiles({ workspaceId: 'ws-a', listedFor: listed('ws-a'), files: frozen }) } catch { threw = true }
  check('case9_context_model_is_pure_no_mutation', !threw && frozen.length === PROJECT.length, 'frozen inputs untouched')
  check('case9_context_loader_is_read_only_get', !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(effectBlock) && effectBlock.includes('getJson<{ files: string[] }>(url)'), 'GET only')

  // CASE 10: Foundry bookkeeping does not leak into normal file choices (mirrors .war-room denylist + identity seed files).
  const paths = filesOf(c1).connected.find(s => s.id === 'files')?.paths ?? []
  check('case10_foundry_metadata_hidden', !paths.some(isFoundryMetadataPath) && !paths.includes('commander-facts.json') && !paths.includes('foundry-memory.json') && !paths.some(p => p.startsWith('.war-room/')), paths.join(','))
  check('case10_real_project_files_kept', ['README.md', 'backend/api.py', 'frontend/view.py', 'shared/contract.py', 'tests/test_tickets.py'].every(p => paths.includes(p)) && !isFoundryMetadataPath('data/commander-facts.json') && isFoundryMetadataPath('sub/.war-room/x.json'), paths.length + ' kept')

  const failed = results.filter(result => !result.pass)
  console.log(`COMPOSER_MODEL_VALIDATION ${failed.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}

main()

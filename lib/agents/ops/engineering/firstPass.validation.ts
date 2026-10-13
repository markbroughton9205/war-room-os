/** First-pass correctness: implementation contract, proven recipes, plan, structural edits, manifest, preflight (static + runtime), left-shift classification, metrics, workflow wiring. Run: pnpm run validate:agent-eng-firstpass */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { harness, engWorld, addAgent, draftFor, C, NOW, tmp } from './engtestkit'
import { AgentOpsLog } from '../log'
import { assign, deriveAssignments, startAssignment } from './assignments'
import { ALERT_FEATURE, ALERT_REFERENCE, makeAlertApp } from './alertFixture'
import { TASK_FEATURE, TASK_REFERENCE, makeTaskApp } from './taskFixture'
import { CHAT_FEATURE, CHAT_REFERENCE, CHAT_VERIFY_SCRIPT, makeChatApp } from './chatFixture'
import { deriveImplementationContract, renderContract, resolveContract, inheritConventions, safeRelativePath, unresolvedAmbiguities } from './implContract'
import { buildEvidence } from './failureEvidence'
import { RECIPES, autofix, buildImplStep, checkManifest, matchRecipes, renderImplStep, renderRecipes, runRecipeChecks, stripManifest, unawaitedFsCalls } from './recipes'
import { applyStructOps, parseStructOps, preservedShare, topLevelDecls } from './structEdit'
import { contractRouteProblems, routeTable, syntaxProblems } from './staticGates'
import { OllamaModelClient, isRunaway } from './runtime/ollamaModel'
import { classifyModelFailure } from './modelFailure'
import { parseEditReply, fitPrompt, ENGINEER_STRUCT_SYSTEM } from './prompts'
import { importProblems, runPreflight, staticPreflight, preflightTap, preflightHypotheses } from './preflight'
import { HARNESS_PATH, buildTestPlan, planPromptFor, filterVariantsOf, generateCounterTests, generateFilterTests, generateTransitionTests, generatePersistenceTests, harnessSource, repairDefaultStoragePath, reviewTestFile } from './testPlan'
import { classifyLeftShift, criterionOfCheck, newFirstPassState, buildFirstPassReport } from './firstPass'
import { runFeatureWorkflow, type WorkflowDeps } from './workflow'
import { Workspace } from './runtime/workspaceFs'
import { makeIndependentVerification } from './runtime/verifier'
import { ScriptedModel, fenced, type ScriptCtx } from './scriptedModel'
import type { EngineeringTool } from '../types'

const { check, finish } = harness('AGENT_ENG_FIRSTPASS_VALIDATION')
const TOOLS: EngineeringTool[] = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output']

const syntaxOk = (t: string) => syntaxProblems('server.mjs', t).length === 0
// ======================================================================= 1. implementation contract
const ca = deriveImplementationContract(ALERT_FEATURE.acceptance, ALERT_FEATURE.request)
const ct = deriveImplementationContract(TASK_FEATURE.acceptance, TASK_FEATURE.request)
const cc = deriveImplementationContract(CHAT_FEATURE.acceptance, CHAT_FEATURE.request)
check('F01_the_alert_contract_carries_routes_statuses_defaults_flags_filters_shapes_persistence_and_ui', ca.routes.some((r) => r.id === 'POST /api/alerts' && r.statuses.includes(201) && r.statuses.includes(400)) && ca.routes.some((r) => r.id === 'POST /api/alerts/read-all' && r.shape?.updated === 'n') && ca.routes.some((r) => r.id === 'GET /api/alerts/unread-count' && r.shape?.unread === 'n' && r.shape?.critical === 'n') && ca.fields.some((f) => f.name === 'severity' && f.default === 'info' && f.values.join() === 'info,warning,critical') && ca.fields.some((f) => f.name === 'title' && f.required) && ca.flags.some((f) => f.route === 'POST /api/alerts/:id/archive' && f.name === 'archived' && f.sets) && ca.filters.some((f) => f.param === 'state' && f.values.includes('archived')) && ca.persistence.envVar === 'ALERTS_FILE' && ca.persistence.defaultPath === 'data/alerts.json' && ca.persistence.idsNeverReused && ca.ui.ids.join() === 'alert-list,unread-badge,alert-filter' && ca.compat.routes.includes('GET /api/events'), JSON.stringify(ca.routes.map((r) => r.id)))
check('F02_the_task_contract_carries_the_allowed_transitions_and_the_default_field_values', ct.transitions.map((t) => `${t.from}>${t.to}`).join() === 'todo>doing,doing>done,doing>todo,done>doing' && ct.fields.some((f) => f.name === 'priority' && f.default === '2') && ct.fields.some((f) => f.name === 'status' && f.default === 'todo') && ct.ui.ids.join() === 'col-todo,col-doing,col-done' && ct.idNumeric)
check('F03_the_chat_contract_does_not_invent_numeric_ids_and_every_fixture_contract_is_unambiguous', !cc.idNumeric && ca.idNumeric && [ca, ct, cc].every((c) => unresolvedAmbiguities(c).length === 0 && c.ambiguities.length === 0))
const amb = deriveImplementationContract(['the request is rejected with 409 when it conflicts', 'alerts survive a restart and are persisted to disk'])
check('F04_a_status_with_no_route_is_an_unresolved_ambiguity_and_an_unstated_storage_location_is_resolved_by_a_recorded_assumption', unresolvedAmbiguities(amb).some((a) => a.kind === 'STATUS_WITHOUT_ROUTE') && amb.ambiguities.some((a) => a.kind === 'PERSISTENCE_LOCATION_UNSPECIFIED'))
const amb2 = resolveContract(deriveImplementationContract(['POST /api/things creates a thing (201)', 'things are persisted to disk and survive a restart']))
check('F05_the_persistence_assumption_is_recorded_and_applied_deterministically', amb2.persistence.defaultPath === 'data/things.json' && amb2.persistence.envVar === 'THINGS_FILE' && renderContract(amb2).includes('ASSUMPTION'))

// ======================================================================= 2. recipes
const ra = matchRecipes(ca).map((r) => r.id), rc = matchRecipes(cc).map((r) => r.id)
check('F06_the_alert_contract_selects_the_proven_recipes_it_needs', ['JSON_FILE_STORE', 'MONOTONIC_IDS', 'REST_STATUS', 'ROUTE_ORDER', 'STATE_ACTIONS', 'LIST_FILTER', 'COUNTERS_AND_SHAPES', 'API_UI_WIRING', 'LEGACY_COMPAT', 'STARTUP'].every((id) => ra.includes(id)), ra.join())
check('F07_recipes_only_apply_when_the_contract_calls_for_them', !rc.includes('LIST_FILTER') && !rc.includes('COUNTERS_AND_SHAPES') && !rc.includes('STATE_ACTIONS') && rc.includes('JSON_FILE_STORE'), rc.join())
check('F08_every_recipe_names_its_proof_prerequisites_invariants_failure_modes_and_verification', RECIPES.every((r) => r.provenBy.length > 0 && r.prerequisites.length > 0 && r.invariants.length > 0 && r.failureModes.length > 0 && r.verificationChecks.length > 0 && r.structure(ca).length > 0))
const store = renderRecipes(ca, matchRecipes(ca), 'storage', 4000)
check('F09_the_storage_recipe_is_instantiated_from_the_contract_values_not_from_model_prose', store.includes('process.env.ALERTS_FILE') && store.includes('"data", "alerts.json"') && /mkdirSync\(dirname/.test(store) && /nextId/.test(store))
const step = buildImplStep(ca, matchRecipes(ca), { file: 'server.mjs', layer: 'api', exists: true, current: 'import x from "y"\nexport function a() {}\nconst b = 1\n', step: 3, dependsOn: ['src/eventFeed.mjs'] })
const stepText = renderImplStep(step)
check('F10_each_build_step_has_the_full_implementation_plan_record_before_any_code_is_requested', ['STEP:', 'TARGET_FILE: server.mjs', 'TARGET_SYMBOL:', 'CURRENT_BEHAVIOR:', 'REQUIRED_BEHAVIOR: B', 'EXACT_CHANGE:', 'DEPENDENCIES: src/eventFeed.mjs', 'INVARIANTS:', 'EXPECTED_RUNTIME_RESULT:'].every((k) => stepText.includes(k)) && stepText.length <= 1500 && step.EXPECTED_RUNTIME_RESULT.some((e) => /POST \/api\/alerts\/read-all/.test(e) && /updated/.test(e)), stepText)

// ======================================================================= 3. recipe static checks
const STORE_OK = "import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'\nimport { dirname, join } from 'node:path'\nconst file = () => process.env.ALERTS_FILE || join(process.cwd(), 'data', 'alerts.json')\nexport function save(x) { mkdirSync(dirname(file()), { recursive: true }); writeFileSync(file(), JSON.stringify(x)) }\n"
const STORE_BAD = STORE_OK.replace("mkdirSync(dirname(file()), { recursive: true }); ", '')
const only = (files: Record<string, string>, id: string) => runRecipeChecks(files, ca).filter((f) => `${f.recipe}.${f.check}` === id)
check('F11_a_missing_parent_folder_is_found_before_the_file_is_written_and_a_present_one_is_not_flagged', only({ 'src/eventFeed.mjs': STORE_BAD }, 'JSON_FILE_STORE.parent-dir').length === 1 && only({ 'src/eventFeed.mjs': STORE_OK }, 'JSON_FILE_STORE.parent-dir').length === 0)
const FIRE = "import { writeFile } from 'node:fs/promises'\nconst F = process.env.ALERTS_FILE\nasync function saveAlerts() { await writeFile(F, '[]') }\nexport function add() { saveAlerts() }\nexport function add2() { saveAlerts().catch(() => {}) }\nexport async function add3() { await saveAlerts() }\n"
check('F12_a_fire_and_forget_async_write_is_found_including_the_catch_form_and_an_awaited_write_is_not', unawaitedFsCalls('x.mjs', FIRE).length === 2 && unawaitedFsCalls('x.mjs', FIRE).every((u) => u.fn === 'saveAlerts') && unawaitedFsCalls('x.mjs', STORE_OK).length === 0)
check('F13_a_default_path_anchored_to_the_module_is_found', only({ 'src/eventFeed.mjs': "import path from 'node:path'\nconst f = process.env.ALERTS_FILE || path.join(__dirname, '..', 'data', 'alerts.json')\n" }, 'JSON_FILE_STORE.default-path-cwd').length === 1)
check('F14_ids_derived_from_the_collection_length_are_found', only({ 'src/a.mjs': 'export function add(items) { const a = { id: items.length + 1 }; items.push(a); return a }' }, 'MONOTONIC_IDS.id-from-length').length === 1)
check('F15_a_response_shape_key_nobody_produces_and_a_double_wrapped_result_are_found', only({ 'src/a.mjs': 'export const x = { unread: 1 }' }, 'COUNTERS_AND_SHAPES.shape-keys').some((f) => /critical/.test(f.fact)) && only({ 'server.mjs': "function h(res) { const out = { updated: markAll() }\n return { updated: { updated: 1 } } }\n" }, 'COUNTERS_AND_SHAPES.double-wrap').length === 1)
check('F16_a_filter_parameter_the_contract_names_that_no_code_reads_is_found_and_a_handled_value_is_left_to_the_runtime_probe', only({ 'src/a.mjs': "export function list(state) { if (state === 'unread') return 1 }\nconst q = 'state'" }, 'LIST_FILTER.filter-values').some((f) => /severity/.test(f.fact)) && only({ 'src/a.mjs': "const q = ['state', 'severity']" }, 'LIST_FILTER.filter-values').length === 0)
check('F17_the_page_ids_and_the_client_api_calls_the_contract_names_are_checked', only({ 'public/index.html': '<div id="alert-list"></div>', 'public/app.js': "fetch('/api/alerts')" }, 'API_UI_WIRING.ui-ids').length === 2 && only({ 'public/index.html': '<div id="alert-list"></div>', 'public/app.js': "fetch('/api/alerts')" }, 'API_UI_WIRING.ui-apis').some((f) => /unread-count/.test(f.fact)))

// ======================================================================= 4. structural edits
const BIG = Array.from({ length: 60 }, (_, i) => `export function fn${i}(x) {\n  // helper ${i}\n  return x + ${i}\n}\n`).join('\n') + "\nimport_marker()\nconst CONFIG = { a: 1 }\n"
const BIGI = "import { a } from './a.mjs'\n" + BIG.replace('\nimport_marker()\n', '\n')
const r1 = applyStructOps('big.mjs', BIGI, parseStructOps('```replace-symbol fn7\nfunction fn7(x) {\n  return x * 7\n}\n```'))
check('F18_replace_symbol_changes_only_that_declaration_keeps_its_export_and_leaves_the_other_bytes_alone', r1.ok && r1.content.includes('export function fn7(x) {\n  return x * 7\n}') && preservedShare(BIGI, r1.content) > 0.97 && r1.content.split('\n').length - BIGI.split('\n').length === -1, r1.ok ? '' : r1.reason)
const r2 = applyStructOps('big.mjs', BIGI, parseStructOps('```insert-after fn3\nexport function extra() { return 1 }\n```\n```add-import\nimport { b, a } from \'./a.mjs\'\nimport { c } from \'./c.mjs\'\n```'))
check('F19_insert_after_adds_beside_a_named_declaration_and_add_import_merges_names_into_an_existing_import', r2.ok && r2.content.indexOf('export function extra') > r2.content.indexOf('function fn3') && r2.content.indexOf('export function extra') < r2.content.indexOf('function fn4') && /import \{ a, b \} from '\.\/a\.mjs'/.test(r2.content) && r2.content.includes("import { c } from './c.mjs'") && (r2.content.match(/from '\.\/a\.mjs'/g) ?? []).length === 1, r2.ok ? r2.content.slice(0, 200) : r2.reason)
const TWIN = "export function fnA() {\n  return 1\n}\n\nexport function fnB() {\n  return 1\n}\n"
const r3 = applyStructOps('twin.mjs', TWIN, parseStructOps('```change-in fnB\n<<<<<<< SEARCH\n  return 1\n=======\n  return 2\n>>>>>>> REPLACE\n```'))
const plainAmbiguous = parseEditReply('<<<<<<< SEARCH\n  return 1\n=======\n  return 2\n>>>>>>> REPLACE', TWIN, 'twin.mjs')
check('F20_change_in_only_needs_the_search_text_to_be_unique_inside_its_symbol_where_a_whole_file_search_is_ambiguous', r3.ok && r3.content.indexOf('return 2') > r3.content.indexOf('fnB') && r3.content.indexOf('return 1') < r3.content.indexOf('fnB') && plainAmbiguous.kind === 'invalid', r3.ok ? '' : r3.reason)
const SERVER = "import { createServer } from 'node:http'\ncreateServer((req, res) => {\n  const { pathname } = new URL(req.url, 'http://x')\n  if (req.method === 'GET' && pathname === '/api/a') {\n    res.end('a')\n    return\n  }\n  res.end('none')\n}).listen(3000)\n"
const r4 = applyStructOps('server.mjs', SERVER, parseStructOps("```insert-before-line\nANCHOR: if (req.method === 'GET' && pathname === '/api/a') {\nif (req.method === 'POST' && pathname === '/api/b') {\n  res.end('b')\n  return\n}\n```"))
check('F21_a_route_branch_is_added_next_to_an_anchor_line_with_the_anchor_block_left_intact', r4.ok && r4.content.indexOf("/api/b") < r4.content.indexOf("/api/a") && r4.content.includes("res.end('a')") && preservedShare(SERVER, r4.content) > 0.4, r4.ok ? r4.content : r4.reason)
const bad = [applyStructOps('big.mjs', BIGI, parseStructOps('```replace-symbol nope\nfunction nope() {}\n```')), applyStructOps('big.mjs', BIGI, parseStructOps('```replace-symbol fn7\nfunction other() {}\n```')), applyStructOps('big.mjs', BIGI, parseStructOps('```replace-symbol fn7\nfunction fn7( {\n```')), applyStructOps('server.mjs', SERVER, parseStructOps('```insert-after-line\nANCHOR: not a line in the file\nx()\n```')), applyStructOps('big.mjs', BIGI, parseStructOps('```change-in fn9\n<<<<<<< SEARCH\n  nothing like this\n=======\n  x\n>>>>>>> REPLACE\n```'))]
check('F22_an_unknown_symbol_a_replacement_that_drops_the_name_a_syntax_break_a_missing_anchor_and_a_missing_search_are_all_refused_with_a_reason', bad.every((b) => !b.ok && b.reason.length > 10), bad.map((b) => (b.ok ? 'ok' : b.reason.slice(0, 50))).join(' | '))
const pe = parseEditReply('```replace-symbol fn2\nfunction fn2(x) {\n  return 42\n}\n```', BIGI, 'big.mjs')
check('F23_the_reply_parser_applies_structural_edits_and_reports_them_as_such_without_double_applying_search_blocks', pe.kind === 'code' && pe.mode === 'edits' && pe.structural?.join() === 'REPLACE_SYMBOL' && pe.content.includes('return 42') && topLevelDecls('big.mjs', pe.content).length === topLevelDecls('big.mjs', BIGI).length)

// ======================================================================= 5. manifest
const MF = '```js\nexport function save() {}\n```\n```manifest\nCHANGED: save, ghost\nWHY: persist\nSATISFIES: B7, B2\nPRESERVES: allEvents\nRISKS: none\n```'
const sm = stripManifest(MF)
check('F24_the_manifest_is_parsed_and_removed_from_the_reply_text', sm.manifest?.CHANGED.join() === 'save,ghost' && sm.manifest.SATISFIES.join() === 'B7,B2' && sm.manifest.RISKS === 'none' && !sm.text.includes('manifest') && sm.manifest.PRESERVES.join() === 'allEvents')
const stepS = buildImplStep(ca, matchRecipes(ca), { file: 'src/eventFeed.mjs', layer: 'storage', exists: true, current: 'export function allEvents() {}\n', step: 1, dependsOn: [] })
const mcheck = checkManifest(sm.manifest, 'export function save() {}\n', stepS, 'export function allEvents() {}\n', [{ recipe: 'JSON_FILE_STORE', check: 'parent-dir', criterion: 7, file: 'src/eventFeed.mjs', symbol: null, fact: 'no mkdir', expected: 'mkdir' }])
check('F25_false_claims_are_caught_by_independent_checks_a_missing_changed_symbol_a_dropped_export_a_foreign_behavior_id_and_a_claim_the_recipe_check_contradicts', mcheck.problems.some((p) => /"ghost"/.test(p)) && mcheck.problems.some((p) => /"allEvents" is preserved/.test(p)) && mcheck.problems.some((p) => /claims B2/.test(p)) && mcheck.problems.some((p) => /claims B7 is satisfied, but Foundry's check still finds/.test(p)), mcheck.problems.join(' | '))
check('F26_a_missing_manifest_is_reported_as_missing_not_as_a_pass', checkManifest(null, 'x', stepS, '', []).missing === true && checkManifest(sm.manifest, 'export function save() { ghost }\nexport function allEvents() {}\n', stepS, 'export function allEvents() {}\n', []).missing === false)

// ======================================================================= 6. preflight: static
check('F27_imports_that_do_not_resolve_and_names_the_target_does_not_export_are_found', importProblems({ 'server.mjs': "import { a, zz } from './src/a.mjs'\nimport x from './src/missing.mjs'\n", 'src/a.mjs': 'export function a() {}\n' }).length === 2)
const sp = staticPreflight({ 'server.mjs': "import { createServer } from 'node:http'\ncreateServer((q, r) => r.end(countThings())).listen(3000)\n" }, ca, matchRecipes(ca))
check('F28_undefined_identifiers_and_a_hard_coded_port_are_static_preflight_findings', sp.findings.some((f) => f.check === 'STARTUP.undefined-identifier' && f.symbol === 'countThings') && sp.findings.some((f) => f.check === 'STARTUP.listens-on-port'))

// ======================================================================= 7. preflight: runtime against a synthetic implementation of the alert contract
const GOOD = `import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
const file = () => process.env.ALERTS_FILE || join(process.cwd(), 'data', 'alerts.json')
let db = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : { items: [], nextId: 1 }
const save = () => { mkdirSync(dirname(file()), { recursive: true }); writeFileSync(file(), JSON.stringify(db)) }
const events = []
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const pathname = url.pathname
  let raw = ''
  for await (const c of req) raw += c
  const body = raw ? JSON.parse(raw) : {}
  if (req.method === 'GET' && pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<div id="alert-list"></div><span id="unread-badge"></span><select id="alert-filter"></select><script src="/app.js"></script>') }
  if (req.method === 'GET' && pathname === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end("fetch('/api/alerts'); fetch('/api/alerts/unread-count')") }
  if (req.method === 'GET' && pathname === '/api/events') return send(res, 200, events)
  if (req.method === 'POST' && pathname === '/api/events') { events.push(body); return send(res, 201, body) }
  if (req.method === 'POST' && pathname === '/api/alerts') {
    const sev = body.severity ?? 'info'
    if (typeof body.title !== 'string' || !body.title.trim() || !['info', 'warning', 'critical'].includes(sev)) return send(res, 400, { error: 'bad' })
    const a = { id: db.nextId++, title: body.title, severity: sev, read: false, archived: false }
    db.items.push(a); save(); return send(res, 201, a)
  }
  if (req.method === 'GET' && pathname === '/api/alerts/unread-count') { const u = db.items.filter((a) => !a.read && !a.archived); return send(res, 200, { unread: u.length, critical: u.filter((a) => a.severity === 'critical').length }) }
  if (req.method === 'POST' && pathname === '/api/alerts/read-all') { let n = 0; for (const a of db.items) if (!a.archived && !a.read) { a.read = true; n++ } save(); return send(res, 200, { updated: n }) }
  if (req.method === 'GET' && pathname === '/api/alerts') {
    const st = url.searchParams.get('state'), sv = url.searchParams.get('severity')
    let l = db.items
    if (st === 'unread') l = l.filter((a) => !a.read && !a.archived)
    else if (st === 'read') l = l.filter((a) => a.read && !a.archived)
    else if (st === 'archived') l = l.filter((a) => a.archived)
    else if (st !== 'all') l = l.filter((a) => !a.archived)
    if (sv) l = l.filter((a) => a.severity === sv)
    return send(res, 200, l)
  }
  const m = /^\\/api\\/alerts\\/(\\d+)\\/(read|unread|archive)$/.exec(pathname)
  if (m && req.method === 'POST') {
    const a = db.items.find((x) => x.id === Number(m[1]))
    if (!a) return send(res, 404, { error: 'nf' })
    if (m[2] !== 'archive' && a.archived) return send(res, 409, { error: 'archived' })
    if (m[2] === 'read') a.read = true
    if (m[2] === 'unread') a.read = false
    if (m[2] === 'archive') a.archived = true
    save(); return send(res, 200, a)
  }
  send(res, 404, { error: 'not found' })
}).listen(Number(process.env.PORT) || 3000)
`
const mkApp = (server: string) => { const d = path.join(tmp(), 'pf'); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, 'package.json'), JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } })); writeFileSync(path.join(d, 'server.mjs'), server); return d }
const swap = (from: string, to: string) => { if (!GOOD.includes(from)) throw new Error('defect anchor missing: ' + from.slice(0, 40)); return GOOD.replace(from, to) }
const pfGood = await runPreflight(mkApp(GOOD), ca)
check('F29_a_correct_implementation_of_the_alert_contract_passes_static_and_runtime_preflight_with_nothing_skipped_that_matters', pfGood.passed && pfGood.findings.length === 0 && pfGood.checked.some((c) => /restart persistence/.test(c)) && pfGood.checked.some((c) => /default storage path/.test(c)) && pfGood.checked.some((c) => /filter state=archived/.test(c)), JSON.stringify(pfGood.findings.map((f) => f.check + ': ' + f.fact.slice(0, 100))) + pfGood.skipped.join(';'))
const DEFECTS: [string, string, string, RegExp][] = [
  ['F30_a_missing_data_folder_is_caught_by_the_static_recipe_AND_by_the_runtime_default_path_probe', 'mkdirSync(dirname(file()), { recursive: true }); ', '', /PERSISTENCE\.default-path/],
  ['F31_a_double_wrapped_bulk_result_is_caught_as_a_shape_violation', 'send(res, 200, { updated: n })', 'send(res, 200, { updated: { updated: n } })', /SHAPE\.type/],
  ['F32_data_that_does_not_survive_a_restart_is_caught', "let db = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : { items: [], nextId: 1 }", 'let db = { items: [], nextId: 1 }', /PERSISTENCE\.survives-restart/],
  ['F33_ids_that_restart_at_one_after_a_restart_are_caught', "JSON.parse(readFileSync(file(), 'utf8')) :", "{ items: JSON.parse(readFileSync(file(), 'utf8')).items, nextId: 1 } :", /PERSISTENCE\.ids-advance/],
  ['F34_an_unknown_id_that_answers_200_is_caught', "if (!a) return send(res, 404, { error: 'nf' })", "if (!a) return send(res, 200, {})", /STATUS\.unknown-id/],
  ['F35_a_value_outside_the_allowed_set_that_is_accepted_is_caught', "!['info', 'warning', 'critical'].includes(sev)", 'false', /STATUS\.invalid-value/],
  ['F36_a_contract_route_that_is_not_registered_is_caught_statically_and_at_runtime', "if (req.method === 'POST' && pathname === '/api/alerts/read-all') { let n = 0; for (const a of db.items) if (!a.archived && !a.read) { a.read = true; n++ } save(); return send(res, 200, { updated: n }) }\n", '', /ROUTE\.reachable|ROUTE_ORDER\.routes-served/],
  ['F37_a_severity_filter_that_returns_other_severities_is_caught', "    if (sv) l = l.filter((a) => a.severity === sv)\n", '', /FILTER\.content/],
  ['F38_an_action_that_sets_the_wrong_flag_is_caught', "if (m[2] === 'read') a.read = true", "if (m[2] === 'read') a.read = false", /STATE\.flag/],
  ['F39_a_wrong_default_value_is_caught', 'severity: sev, read: false,', 'severity: sev, read: true,', /FIELD\.default/],
  ['F61_a_whitespace_only_required_field_that_is_accepted_is_caught', "typeof body.title !== 'string' || !body.title.trim() ||", "!body.title ||", /STATUS\.empty-required/],
  ['F62_an_action_on_an_archived_item_that_answers_404_instead_of_the_contract_409_is_caught', "if (m[2] !== 'archive' && a.archived) return send(res, 409, { error: 'archived' })", "if (m[2] !== 'archive' && a.archived) return send(res, 404, { error: 'archived' })", /STATUS\.conflict/],
  ['F63_an_action_the_contract_calls_harmless_to_repeat_that_fails_the_second_time_is_caught', "if (m[2] !== 'archive' && a.archived) return send(res, 409, { error: 'archived' })", "if (a.archived) return send(res, 409, { error: 'archived' })", /STATE\.idempotent/],
  ['F64_a_client_script_that_the_page_loads_but_the_server_cannot_serve_is_caught', "pathname === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(", "pathname === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(readFileSync('missing.js', 'text/javascript') + ", /UI\.script-served/],
  ['F65_a_page_without_the_contract_element_ids_is_caught', '<span id="unread-badge"></span>', '<span></span>', /UI\.page-ids/],
  ['F75_a_default_list_view_that_filters_by_the_wrong_flag_is_caught_with_the_item_it_wrongly_omits', "else if (st !== 'all') l = l.filter((a) => !a.archived)", "else if (st !== 'all') l = l.filter((a) => !a.read && !a.archived)", /FILTER\.semantics/],
  ['F76_a_state_filter_that_ignores_the_archived_flag_is_caught', "else if (st === 'read') l = l.filter((a) => a.read && !a.archived)", "else if (st === 'read') l = l.filter((a) => a.read)", /FILTER\.semantics/],
  ['F40_a_hard_coded_port_stops_the_server_from_being_exercised_and_is_reported', 'Number(process.env.PORT) || 3000', '3000', /STARTUP\.(listens-on-port|boot)/],
]
for (const [name, from, to, re] of DEFECTS) {
  const rep = await runPreflight(mkApp(swap(from, to)), ca)
  check(name, !rep.passed && rep.findings.some((f) => re.test(f.check)), JSON.stringify(rep.findings.map((f) => f.check + ': ' + f.fact.slice(0, 90))))
}
const tapBad = preflightTap(await runPreflight(mkApp(swap('send(res, 200, { updated: n })', 'send(res, 200, { updated: { updated: n } })')), ca))
check('F41_a_preflight_failure_becomes_a_structured_fact_for_the_repair_loop_not_a_log_dump', /^not ok 1 - /m.test(tapBad) && /contract: C6/.test(tapBad) && /expected: /.test(tapBad) && /"updated" is an object/.test(tapBad) && tapBad.length < 900, tapBad)
check('F42_the_preflight_never_reads_the_independent_verifier_or_any_fixture_specific_expectation', !/CHAT_VERIFY_SCRIPT|VERIFY_SCRIPT|ALERT_FEATURE|TASK_FEATURE|alerts|unread/.test(readFileSync(path.join(import.meta.dirname ?? '.', 'preflight.ts'), 'utf8').replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))

// ======================================================================= 8. left-shift classification and metrics
const noRecipe = matchRecipes(cc).filter((r) => r.id !== 'REST_STATUS')
const ls = classifyLeftShift({
  contract: ca, recipes: matchRecipes(ca), acceptance: ALERT_FEATURE.acceptance,
  rejections: [{ file: 'server.mjs', problem: 'route conflict: x' }], firstPreflight: [{ stage: 'RUNTIME', check: 'SHAPE.type', criterion: 6, recipe: 'COUNTERS_AND_SHAPES', file: 'server.mjs', symbol: null, fact: 'nested', expected: 'flat' }],
  preflightChecked: ['runtime.POST /api/alerts/read-all', 'runtime.filter state=unread', 'runtime.restart persistence'],
  verifierFailures: ['the list excludes archived by default and ?state=unread|read|archived|all select the right alerts', 'the page shows the alert list element id alert-list an unread badge and filter control', 'node tests cover the new alert service functions'],
  testDefects: [{ kind: 'TEST_WRITER_DEFECT', test: 'a' }, { kind: 'ENVIRONMENT_DEFECT', test: 'b' }, { kind: 'IMPLEMENTATION_DEFECT', test: 'c' }],
})
const cats = ls.map((l) => `${l.found_at}:${l.category}`)
check('F43_defects_caught_by_the_edit_gate_and_the_preflight_are_model_generation_errors_found_before_execution', cats.includes('EDIT_GATE:MODEL_GENERATION_ERROR') && cats.includes('PREFLIGHT:MODEL_GENERATION_ERROR') && ls.filter((l) => l.found_at === 'EDIT_GATE' || l.found_at === 'PREFLIGHT').every((l) => l.caught_before_execution && l.improve === null))
check('F44_a_value_level_failure_in_a_route_the_preflight_exercised_is_runtime_only_and_a_ui_failure_without_a_ui_probe_is_a_static_miss_that_names_the_stage_to_improve', ls.some((l) => l.found_at === 'VERIFIER' && l.category === 'RUNTIME_ONLY_FAILURE' && l.criterion === 4) && ls.some((l) => l.found_at === 'VERIFIER' && l.category === 'STATIC_MISS' && /preflight:/.test(l.improve ?? '')), JSON.stringify(ls.filter((l) => l.found_at === 'VERIFIER').map((l) => [l.category, l.criterion])))
const lsPlan = classifyLeftShift({ contract: deriveImplementationContract(['The board should feel snappy']), recipes: [], acceptance: ['The board should feel snappy'], rejections: [], firstPreflight: null, preflightChecked: [], verifierFailures: ['the board should feel snappy'], testDefects: [] })
const lsRecipe = classifyLeftShift({ contract: ca, recipes: noRecipe.filter((r) => r.id === 'STARTUP'), acceptance: ALERT_FEATURE.acceptance, rejections: [], firstPreflight: null, preflightChecked: [], verifierFailures: ['POST /api/alerts/read-all marks every non-archived alert read and returns updated'], testDefects: [] })
check('F45_an_unmapped_criterion_is_a_PLAN_MISS_and_a_behavior_with_no_recipe_is_a_RECIPE_MISS_each_naming_the_earlier_stage_to_improve', lsPlan[0]?.category === 'PLAN_MISS' && /implContract/.test(lsPlan[0].improve ?? '') && lsRecipe[0]?.category === 'RECIPE_MISS' && /recipes:/.test(lsRecipe[0].improve ?? ''), JSON.stringify([lsPlan, lsRecipe].map((x) => x.map((l) => l.category))))
check('F46_test_defects_environment_failures_and_implementation_defects_found_by_tests_are_classified_apart', cats.includes('CONTRACT_TEST:TEST_DEFECT') && cats.includes('CONTRACT_TEST:ENVIRONMENT_FAILURE') && cats.includes('CONTRACT_TEST:STATIC_MISS'))
check('F47_a_failing_check_is_matched_to_its_criterion_by_wording_and_an_unrelated_check_is_not', criterionOfCheck('GET /api/alerts/unread-count counts unread, non-archived alerts and how many are critical', ALERT_FEATURE.acceptance) === 5 && criterionOfCheck('totally unrelated words here', ALERT_FEATURE.acceptance) === null)
const st0 = newFirstPassState(); st0.first_preflight = []; st0.final_preflight = { findings: [], advisories: [], checked: ['a'], skipped: [], passed: true, runtimeMs: 5 }; st0.first_verifier = { pass: 12, fail: 0 }; st0.range_edits = 2; st0.structural_edits = 3; st0.whole_file_rewrites = 1; st0.deterministic_structural_edits = 1
const rep0 = buildFirstPassReport({ contract: ca, recipes: matchRecipes(ca), steps: [], st: st0, repairs: 0, quarantined: 0, testDefects: [], acceptance: ALERT_FEATURE.acceptance, testsPassed: true, verifierPassed: true })
check('F48_the_report_carries_every_required_first_pass_metric_and_the_progression_to_CLEAN', rep0.metrics.FIRST_PASS_IMPLEMENTATION_VALID === true && rep0.metrics.FIRST_PASS_VERIFIER_PASS === true && rep0.metrics.FIRST_VERIFIER_SCORE === '12/12' && rep0.metrics.REPAIRS_REQUIRED === 0 && rep0.metrics.WHOLE_FILE_REWRITES === 1 && rep0.metrics.STRUCTURAL_EDITS === 4 && rep0.metrics.RANGE_EDITS === 2 && rep0.metrics.PREFLIGHT_CAUGHT_ERRORS === 0 && rep0.metrics.TEST_DISCOVERED_ERRORS === 0 && rep0.metrics.QUARANTINED_TESTS === 0 && Object.values(rep0.progression).every((v) => v === true))
const st1 = newFirstPassState(); st1.first_preflight = [{ stage: 'STATIC', check: 'a', criterion: null, recipe: null, file: null, symbol: null, fact: 'x', expected: 'y' }]; st1.first_verifier = { pass: 10, fail: 2 }; st1.verifier_failure_names = ['one', 'two']
const rep1 = buildFirstPassReport({ contract: ca, recipes: matchRecipes(ca), steps: [], st: st1, repairs: 3, quarantined: 1, testDefects: [{ kind: 'IMPLEMENTATION_DEFECT', test: 't' }], acceptance: ALERT_FEATURE.acceptance, testsPassed: false, verifierPassed: false })
check('F49_a_run_that_needed_repairs_is_not_reported_as_first_pass_valid_and_test_discovered_errors_are_counted', rep1.metrics.FIRST_PASS_IMPLEMENTATION_VALID === false && rep1.metrics.FIRST_PASS_VERIFIER_PASS === false && rep1.metrics.PREFLIGHT_CAUGHT_ERRORS === 1 && rep1.metrics.TEST_DISCOVERED_ERRORS === 3 && rep1.metrics.QUARANTINED_TESTS === 1)

// ======================================================================= 9. workflow wiring (scripted model, real files, real commands, real preflight)
const chatReq = { request: CHAT_FEATURE.request, acceptance: CHAT_FEATURE.acceptance, hints: CHAT_FEATURE.hints }
function world() {
  const w = engWorld(); const agent = addAgent(w, 'agent-fp', 'feature_implementation')
  const root = makeChatApp(path.join(tmp(), 'chat'))
  const asg = assign(w.log, draftFor(agent.id, 'mission-chat-fp', CHAT_FEATURE.request, { workspace: { id: 'chat-fp', root, kind: 'sandbox' }, limits: { maxSteps: 40, maxRuntimeMs: 600_000, maxModelCalls: 60, maxRetries: 4 } }), C, NOW).assignment
  startAssignment(w.log, asg.id, 'system:runner', NOW)
  return { ...w, root, asg, ws: new Workspace(root), verification: makeIndependentVerification('independent chat-session verification', tmp(), 'verify.mjs', CHAT_VERIFY_SCRIPT, root) }
}
type W = ReturnType<typeof world>
const mkDeps = (x: W, model: ScriptedModel, over: Partial<WorkflowDeps> = {}): WorkflowDeps => ({ log: x.log, assignmentId: x.asg.id, ws: x.ws, model, tools: TOOLS, finalVerification: x.verification, ...over })
const SOL: Record<string, string> = { 'src/messageStore.mjs': CHAT_REFERENCE['src/messageStore.mjs'], 'src/chatService.mjs': CHAT_REFERENCE['src/chatService.mjs'], 'server.mjs': CHAT_REFERENCE['server.mjs'], 'public/app.js': CHAT_REFERENCE['public/app.js'], 'public/index.html': CHAT_REFERENCE['public/index.html'] }
const TESTFILE = "import test from 'node:test'\nimport assert from 'node:assert'\ntest('placeholder suite is runnable', () => assert.ok(true))\n"
const withManifest = (code: string, prompt: string) => `${fenced(code)}\n\`\`\`manifest\nCHANGED: none\nWHY: implements the plan\nSATISFIES: ${[...new Set((/REQUIRED_BEHAVIOR: ([^\n]*)/.exec(prompt)?.[1] ?? '').match(/\bB\d+\b/g) ?? [])].join(', ')}\nPRESERVES: none\nRISKS: none\n\`\`\``
process.env.ENGINE_NODE_PARSE = '0'
{
  const x = world()
  const model = new ScriptedModel((ctx: ScriptCtx) => (ctx.kind === 'file' && ctx.path && SOL[ctx.path] ? withManifest(SOL[ctx.path], ctx.prompt) : ctx.kind === 'file' && ctx.path && /^test\//.test(ctx.path) ? fenced(TESTFILE) : null))
  const r = await runFeatureWorkflow(mkDeps(x, model, { firstPass: {} }), chatReq)
  const fp = r.firstPass
  const filePrompts = model.calls.filter((c) => c.kind === 'file')
  const implPrompts = filePrompts.filter((c) => c.path && !/^test\//.test(c.path))
  check('F50_with_first_pass_the_run_completes_the_preflight_passes_first_time_and_the_metrics_say_so', r.status === 'COMPLETED' && !!fp && fp.metrics.FIRST_PASS_IMPLEMENTATION_VALID === true && fp.metrics.FIRST_PASS_VERIFIER_PASS === true && fp.metrics.REPAIRS_REQUIRED === 0 && fp.progression.PLAN_VALID && fp.progression.IMPLEMENTATION_PREFLIGHT_PASS === true && fp.progression.INDEPENDENT_VERIFIER_PASS === true && fp.preflight.runs.length === 1, `${r.status} ${r.reason} ${JSON.stringify(fp?.metrics)} ${JSON.stringify(fp?.preflight.first_findings)}`)
  check('F51_every_builder_prompt_carries_the_contract_the_recipes_the_step_plan_and_the_manifest_request_and_stays_inside_the_context_budget', implPrompts.length >= 5 && implPrompts.every((c) => c.prompt.includes('IMPLEMENTATION CONTRACT') && c.prompt.includes('IMPLEMENTATION PLAN FOR THIS STEP') && c.prompt.includes('TARGET_FILE: ' + c.path) && c.prompt.includes('```manifest') && c.prompt.length < 15_500), implPrompts.map((c) => `${c.path}:${c.prompt.length}`).join(' '))
  check('F52_the_independent_verifier_is_never_consulted_by_the_preflight_it_passed_before_the_accept_step_ran', (() => { const steps = (x.log.view().records as unknown[]).length; return steps > 0 && fp!.preflight.runs.length >= 1 })() && x.log.view().records.some((rec) => JSON.stringify(rec).includes('implementation preflight')))
  check('F53_the_plan_records_a_step_for_each_implementation_file_with_its_recipes_and_behaviors', (fp?.plan_steps.length ?? 0) >= 5 && fp!.plan_steps.some((s) => s.target_file === 'src/messageStore.mjs' && s.recipes.includes('JSON_FILE_STORE')) && fp!.recipes.includes('JSON_FILE_STORE'))
  check('F54_manifests_are_counted_and_none_was_a_false_claim', fp!.manifests.present >= 5 && fp!.manifests.false_claims === 0, JSON.stringify(fp?.manifests))
}
{
  const x = world(); const model = new ScriptedModel((ctx) => (ctx.kind === 'file' && ctx.path && SOL[ctx.path] ? fenced(SOL[ctx.path]) : ctx.kind === 'file' && ctx.path && /^test\//.test(ctx.path) ? fenced(TESTFILE) : null))
  const r = await runFeatureWorkflow(mkDeps(x, model), chatReq)
  check('F55_without_the_first_pass_option_nothing_changes_no_contract_no_plan_no_manifest_no_preflight_step_and_no_report', r.status === 'COMPLETED' && r.firstPass === undefined && model.calls.every((c) => !c.prompt.includes('IMPLEMENTATION CONTRACT') && !c.prompt.includes('```manifest')) && !x.log.view().records.some((rec) => JSON.stringify(rec).includes('implementation preflight')))
}
{
  const x = world()
  const BADSTORE = SOL['src/messageStore.mjs'].replace('  mkdirSync(path.dirname(file), { recursive: true })\n', '')
  let storeCalls = 0
  const model = new ScriptedModel((ctx) => {
    if (ctx.kind === 'file' && ctx.path === 'src/messageStore.mjs') { storeCalls += 1; return withManifest(BADSTORE, ctx.prompt) }
    if (ctx.kind === 'file' && ctx.path && SOL[ctx.path]) return withManifest(SOL[ctx.path], ctx.prompt)
    if (ctx.kind === 'file' && ctx.path && /^test\//.test(ctx.path)) return fenced(TESTFILE)
    if (ctx.kind === 'repair' && ctx.path === 'src/messageStore.mjs') return fenced(SOL['src/messageStore.mjs'])
    return null
  })
  const r = await runFeatureWorkflow(mkDeps(x, model, { firstPass: {} }), chatReq)
  const fp = r.firstPass
  check('F56_a_storage_file_without_the_folder_creation_is_rejected_by_the_recipe_gate_before_it_is_written', BADSTORE !== SOL['src/messageStore.mjs'] && (fp?.metrics.REPLY_REJECTIONS ?? 0) >= 1 && fp!.left_shift.some((l) => l.found_at === 'EDIT_GATE' && /recipe check failed/.test(l.what)), `${JSON.stringify(fp?.metrics)} ${storeCalls}`)
  check('F57_a_defect_that_survived_the_gate_is_caught_by_the_preflight_and_repaired_before_any_test_or_verifier_run', r.status === 'COMPLETED' && fp!.metrics.PREFLIGHT_CAUGHT_ERRORS >= 1 && fp!.metrics.FIRST_PASS_IMPLEMENTATION_VALID === false && fp!.progression.IMPLEMENTATION_PREFLIGHT_PASS === true && (fp!.metrics.REPAIRS_BY_STEP.preflight ?? 0) >= 1 && fp!.metrics.FIRST_PASS_VERIFIER_PASS === true, `${r.status} ${r.reason} ${JSON.stringify(fp?.metrics)} ${JSON.stringify(fp?.preflight)}`)
}
{
  const x = world()
  const model = new ScriptedModel(() => null)
  const r = await runFeatureWorkflow(mkDeps(x, model, { firstPass: {} }), { request: 'x', acceptance: ['the request is rejected with 409 when it conflicts'], hints: [] })
  check('F58_an_unresolvable_contract_ambiguity_stops_the_build_before_a_single_model_call_or_file_write', r.status === 'BLOCKED' && /ambiguous implementation contract/.test(r.reason) && model.calls.length === 0 && r.filesChanged.length === 0, `${r.status} ${r.reason}`)
}

// ---- found by the first real-model dry run: a replace-symbol block that carries import lines (and the keyword export) must produce a valid file
{
  const BASE = "const events = []\nlet nextId = 1\n\nexport function allEvents() {\n  return events\n}\n\nexport function pushEvent(e) {\n  events.push(e)\n  return e\n}\n"
  const hoist = applyStructOps('s.mjs', BASE, parseStructOps("```replace-symbol allEvents\nimport { readFileSync } from 'node:fs'\nfunction load() { return readFileSync('x', 'utf8') }\nfunction allEvents() {\n  return load()\n}\n```"))
  check('F59_imports_in_a_replace_symbol_block_are_hoisted_the_export_keyword_lands_on_the_named_declaration_and_the_result_parses', hoist.ok && hoist.content.startsWith("import { readFileSync } from 'node:fs'") && /export function allEvents\(\)/.test(hoist.content) && !/export import/.test(hoist.content) && /^\s*function load\(\)/m.test(hoist.content), hoist.ok ? hoist.content : hoist.reason)
  const dupe = applyStructOps('s.mjs', BASE, parseStructOps("```replace-symbol allEvents\nexport function allEvents() { return 1 }\nexport function pushEvent(e) { return e }\n```"))
  check('F60_a_block_that_redeclares_a_symbol_that_already_exists_is_refused_with_a_reason_that_tells_the_worker_what_to_do', !dupe.ok && /pushEvent more than once/.test(dupe.reason) && /replace-symbol block replaces ONLY/.test(dupe.reason), dupe.ok ? 'ok' : dupe.reason)
}

// ---- deterministic structural autofix (found by the dry runs: a catch-all 400 hid the 404/409 the domain code signals)
{
  const SERVICE = "export function find(id) {\n  throw Object.assign(new Error('Not found'), { status: 404 })\n}\nexport function archived() { throw Object.assign(new Error('Already archived'), { status: 409 }) }\n"
  const SRV = "import { createServer } from 'node:http'\nconst reply = (res, code, b) => { res.writeHead(code); res.end(JSON.stringify(b)) }\ncreateServer(async (req, res) => {\n  try {\n    return reply(res, 200, {})\n  } catch (err) {\n    return reply(res, 400, { error: String(err.message) })\n  }\n}).listen(Number(process.env.PORT))\n"
  const found = only({ 'src/eventFeed.mjs': SERVICE, 'server.mjs': SRV }, 'REST_STATUS.catch-all-status')
  check('F66_a_catch_block_that_answers_every_error_with_one_fixed_status_is_found_only_when_the_domain_code_really_signals_other_statuses', found.length === 1 && found[0].file === 'server.mjs' && only({ 'src/eventFeed.mjs': "export function f() { throw new Error('x') }\n", 'server.mjs': SRV }, 'REST_STATUS.catch-all-status').length === 0 && only({ 'src/eventFeed.mjs': SERVICE, 'server.mjs': SRV.replace('reply(res, 400, { error', 'reply(res, Number.isInteger(err.status) ? err.status : 400, { error') }, 'REST_STATUS.catch-all-status').length === 0)
  const fx = autofix('server.mjs', SRV, found, ca)
  check('F67_the_catch_all_is_repaired_deterministically_by_changing_only_that_status_expression_and_the_finding_is_gone', !!fx && fx.content.includes('Number.isInteger(err.status) ? err.status : 400') && preservedShare(SRV, fx.content) > 0.8 && fx.content.split('\n').length === SRV.split('\n').length && only({ 'src/eventFeed.mjs': SERVICE, 'server.mjs': fx.content }, 'REST_STATUS.catch-all-status').length === 0, fx?.content)
  const DECL = "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nconst ALERTS_FILE = process.env.ALERTS_FILE || join(process.cwd(), 'data', 'alerts.json')\nexport function save(x) { writeFileSync(ALERTS_FILE, JSON.stringify(x)) }\n"
  const pd = only({ 'src/eventFeed.mjs': DECL }, 'JSON_FILE_STORE.parent-dir')
  const fx2 = autofix('src/eventFeed.mjs', DECL, pd, ca)
  check('F68_a_missing_parent_folder_is_repaired_deterministically_with_one_guarded_recursive_mkdir_and_the_storage_path_declaration_is_untouched', pd.length === 1 && !!fx2 && /mkdirSync\(process\.cwd\(\) \+ "\/data", \{ recursive: true \}\)/.test(fx2.content) && fx2.content.includes("const ALERTS_FILE = process.env.ALERTS_FILE || join(process.cwd(), 'data', 'alerts.json')") && only({ 'src/eventFeed.mjs': fx2.content }, 'JSON_FILE_STORE.parent-dir').length === 0)
  const rep = { findings: [{ stage: 'RUNTIME' as const, check: 'STATUS.conflict', criterion: 3, recipe: 'REST_STATUS', file: 'server.mjs', symbol: null, fact: 'POST /api/alerts/6/read on an item after POST /api/alerts/6/archive answered HTTP 404', expected: 'HTTP 409', route: 'POST /api/alerts/:id/read', expect: 409, got: 404 }], advisories: [], checked: ['x'], skipped: [], passed: false, runtimeMs: 1 }
  const tap = preflightTap(rep)
  const ev = buildEvidence({ output: tap, acceptance: ALERT_FEATURE.acceptance, files: { 'server.mjs': "import { markRead } from './src/eventFeed.mjs'\nconst server = createServer(async (req, res) => {\n  const url = new URL(req.url, 'http://x')\n  if (url.pathname.startsWith('/api/alerts/') && req.method === 'POST') {\n    const a = markRead(1)\n  }\n})\n", 'src/eventFeed.mjs': "export function markRead(id) { throw new Error('Already archived') }\n" }, baseline: {} })
  check('F69_a_status_finding_is_written_in_the_evidence_builders_language_so_the_repair_loop_gets_targeted_hypotheses_not_a_blind_analyst', /must answer 409 \(409\)/.test(tap) && /status=404/.test(tap) && ev.queue.some((h) => /^status:/.test(h.key)), `${tap}\n${ev.queue.map((h) => h.key).join(',')}`)
  const mcA = checkManifest({ CHANGED: ['ghost'], WHY: '', SATISFIES: ['B7'], PRESERVES: [], RISKS: '' }, 'export function save() {}\n', stepS, '', [])
  const mcB = checkManifest({ CHANGED: [], WHY: '', SATISFIES: [], PRESERVES: ['allEvents'], RISKS: '' }, 'export function save() {}\n', stepS, 'export function allEvents() {}\n', [])
  check('F70_a_wrong_manifest_claim_is_recorded_as_evidence_and_only_a_dropped_export_or_an_omitted_violated_behavior_blocks', mcA.problems.length >= 1 && mcA.blocking.length === 0 && mcB.blocking.length === 1)
}
{
  const x = world()
  const REF = SOL['src/messageStore.mjs']
  const STORE2 = REF.replace("export function dataFile() {\n  return process.env.CHAT_DATA_FILE || path.join(process.cwd(), 'data', 'sessions.json')\n}", "const DATA_FILE = process.env.CHAT_DATA_FILE || path.join(process.cwd(), 'data', 'sessions.json')\nexport function dataFile() {\n  return DATA_FILE\n}").replace('  mkdirSync(path.dirname(file), { recursive: true })\n', '')
  const model = new ScriptedModel((ctx) => (ctx.kind === 'file' && ctx.path === 'src/messageStore.mjs' ? withManifest(STORE2, ctx.prompt) : ctx.kind === 'file' && ctx.path && SOL[ctx.path] ? withManifest(SOL[ctx.path], ctx.prompt) : ctx.kind === 'file' && ctx.path && /^test\//.test(ctx.path) ? fenced(TESTFILE) : null))
  const events: string[] = []
  const r = await runFeatureWorkflow(mkDeps(x, model, { firstPass: {}, onEvent: (e) => events.push(`${e.kind}: ${e.detail}`) }), chatReq)
  const fp = r.firstPass
  check('F71_a_known_defect_in_a_worker_reply_is_fixed_by_a_deterministic_structural_edit_before_the_worker_is_asked_again', STORE2 !== REF && r.status === 'COMPLETED' && events.some((e) => /^STRUCTURAL_AUTOFIX: src\/messageStore\.mjs: ADD_DIRECTORY_GUARD/.test(e)) && fp!.metrics.REPLY_REJECTIONS === 0 && fp!.metrics.STRUCTURAL_EDITS >= 1 && /mkdirSync\(process\.cwd\(\)/.test(x.ws.read('src/messageStore.mjs')) && model.calls.filter((c) => c.path === 'src/messageStore.mjs').length === 1, `${r.status} ${r.reason} ${JSON.stringify(fp?.metrics)} ${events.filter((e) => /AUTOFIX|REJECT/.test(e)).join(' | ')}`)
}

// ---- preflight-supplied hypotheses (found by dry run 4: a runtime-only route mismatch got unrelated status hypotheses)
{
  const OFF = { stage: 'RUNTIME' as const, check: 'ROUTE.reachable', criterion: 2, recipe: 'ROUTE_ORDER', file: 'server.mjs', symbol: null, fact: 'POST /api/alerts/2/read answered HTTP 404 {"error":"not found"}', expected: 'HTTP 200', route: 'POST /api/alerts/:id/read', expect: 200, got: 404 }
  const rep2 = { findings: [OFF, { ...OFF, fact: 'POST /api/alerts/3/unread answered HTTP 404 {"error":"not found"}', route: 'POST /api/alerts/:id/unread' }], advisories: [], checked: ['x'], skipped: [], passed: false, runtimeMs: 1 }
  const hy = preflightHypotheses(rep2.findings, 'server.mjs', "import { markRead } from './src/eventFeed.mjs'\nimport { y } from './src/eventService.mjs'\n")
  const ev2 = buildEvidence({ output: preflightTap(rep2), acceptance: ALERT_FEATURE.acceptance, files: { 'server.mjs': "createServer((req, res) => { if (parts.length === 3) {} })\n", 'src/eventFeed.mjs': 'export const x = 1\n' }, baseline: {}, extra: hy })
  check('F72_each_preflight_finding_gets_its_own_targeted_hypothesis_that_names_the_dispatcher_when_the_route_fell_through_to_the_generic_not_found', hy.length === 2 && /does not match the real pathname/.test(hy[0].statement) && hy[0].files[0] === 'server.mjs' && ev2.queue.filter((h) => h.key.startsWith('preflight:ROUTE.reachable')).length === 2 && ev2.queue[0].key.startsWith('preflight:ROUTE.reachable') && /ANCHORED REGEX/.test(ev2.queue[0].statement), ev2.queue.map((h) => h.key).join(','))
}

// ---- found by dry run 5: the worker named the wrong symbol for an otherwise unambiguous edit; and the storage recipe must keep legacy exports out of the new collection
{
  const WRONG = applyStructOps('twin.mjs', "export function fnA() {\n  return 1\n}\n\nexport function fnB() {\n  return 22\n}\n", parseStructOps('```change-in fnA\n<<<<<<< SEARCH\n  return 22\n=======\n  return 23\n>>>>>>> REPLACE\n```'))
  const AMBIG = applyStructOps('twin.mjs', TWIN, parseStructOps('```change-in nope\n<<<<<<< SEARCH\n  return 1\n=======\n  return 2\n>>>>>>> REPLACE\n```'))
  check('F73_a_change_in_block_that_names_the_wrong_symbol_is_applied_when_its_search_text_is_unique_in_the_whole_file_and_refused_when_it_is_not', WRONG.ok && WRONG.content.includes('return 23') && !AMBIG.ok)
  const brief = renderRecipes(ca, matchRecipes(ca), 'domain', 2400, { path: 'src/eventFeed.mjs', text: 'const events = []\nexport function allEvents() {}\n' })
  check('F74_the_builder_prompt_for_the_data_owning_file_carries_the_store_the_ids_and_the_throw_with_status_rules_and_keeps_existing_exports_out_of_the_new_collection', /SYNCHRONOUS fs/.test(brief) && /NEW collection beside them/.test(brief) && /nextId/.test(brief) && /THROW errors that carry their HTTP status/.test(brief) && brief.length <= 2400, brief.length + ' ' + brief.slice(0, 200))
}

{
  check('F77_list_semantics_are_derived_from_the_contract_prose_flag_words_negations_and_un_prefixes_included', ca.filterRules.length === 4 && ca.filterRules.some((r) => r.value === 'unread' && r.requires.map((q) => `${q.flag}=${q.value}`).sort().join() === 'archived=false,read=false') && ca.filterRules.some((r) => r.value === 'read' && r.requires.map((q) => `${q.flag}=${q.value}`).sort().join() === 'archived=false,read=true') && ca.filterRules.some((r) => r.value === 'archived' && r.requires.length === 1 && r.requires[0].value) && ca.filterRules.some((r) => r.value === 'all' && r.everything) && ca.defaultViews[0]?.requires[0]?.flag === 'archived' && ca.defaultViews[0].requires[0].value === false && ct.filterRules.length === 0)
}

// ---- found by Alert x3: a route that falls through to the generic 404 is a ROUTE problem in the entry file, one grouped hypothesis; and the builder is given the contract's exact selections and anchored route regexes
{
  const FT = { stage: 'RUNTIME' as const, check: 'ROUTE.reachable', criterion: 2, recipe: 'ROUTE_ORDER', file: 'server.mjs', symbol: null, fact: 'POST /api/alerts/2/read answered HTTP 404 {"error":"not found"}', expected: 'HTTP 200', route: 'POST /api/alerts/:id/read', expect: 200, got: 404 }
  const SETTER = { ...FT, check: 'STATUS.setter', fact: 'POST /api/alerts/6/archive answered HTTP 404 {"error":"not found"}', route: 'POST /api/alerts/:id/archive', expect: undefined }
  const STATUS = { ...FT, check: 'STATUS.conflict', fact: 'POST /api/alerts/6/read answered HTTP 404 {"error":"Alert not found"}', route: 'POST /api/alerts/:id/read', expect: 409, got: 404 }
  const rep3 = { findings: [FT, SETTER, STATUS], advisories: [], checked: ['x'], skipped: [], passed: false, runtimeMs: 1 }
  const tap3 = preflightTap(rep3)
  const hy3 = preflightHypotheses(rep3.findings, 'server.mjs', "import { a } from './src/eventService.mjs'\n")
  const ev3 = buildEvidence({ output: tap3, acceptance: ALERT_FEATURE.acceptance, files: { 'server.mjs': 'createServer(() => {})\n', 'src/eventService.mjs': 'export const a = 1\n' }, baseline: {}, extra: hy3 })
  check('F78_a_route_that_fell_through_to_the_generic_not_found_is_written_as_a_missing_route_and_its_hypothesis_is_one_grouped_statement_aimed_at_the_entry_file_not_the_service', /is not matched by the dispatcher/.test(tap3) && hy3[0].files[0] === 'server.mjs' && hy3[1].files[0] === 'server.mjs' && /ANCHORED REGEX/.test(hy3[0].statement) && /archive/.test(hy3[0].statement) && hy3[2].files[0] !== 'server.mjs' && ev3.queue[0].files[0] === 'server.mjs' && ev3.checks.slice(0, 2).every((c) => c.kind === 'ROUTE_MISSING'), `${tap3}\n${ev3.queue.map((h) => h.key + '@' + h.files[0]).join(' ')}`)
  const apiText = renderRecipes(ca, matchRecipes(ca), 'api', 3000, { path: 'server.mjs', text: 'createServer' })
  const domText = renderRecipes(ca, matchRecipes(ca), 'domain', 3000, { path: 'src/eventService.mjs', text: 'export function x() {}\n' })
  check('F79_the_api_prompt_carries_an_anchored_regex_for_every_contract_route_and_the_domain_prompt_carries_the_exact_flag_selections', apiText.includes('/^\\/api\\/alerts\\/(\\d+)\\/read$/') && apiText.includes('/^\\/api\\/alerts\\/read-all$/') && /no parameter -> archived=false/.test(domText) && /\?state=unread -> archived=false and read=false/.test(domText) && /\?state=all -> every item/.test(domText) && domText.length <= 3000, apiText.length + ' ' + domText.length)
  const two = only({ 'server.mjs': "import { createServer } from 'node:http'\ncreateServer(async (req, res) => {\n  return reply(res, 201, svc((await body(req)).title, (await body(req)).severity))\n})\n" }, 'ROUTE_ORDER.body-read-once')
  check('F80_a_request_body_read_twice_in_one_statement_is_found_and_a_single_read_is_not', two.length === 1 && /second read|empty/.test(two[0].fact) && only({ 'server.mjs': "import { createServer } from 'node:http'\ncreateServer(async (req, res) => {\n  const input = await body(req)\n  return reply(res, 201, svc(input.title, input.severity))\n})\n" }, 'ROUTE_ORDER.body-read-once').length === 0)
  const big = ['TASK', 'ACCEPTANCE', 'RELATED CODE (x)\n' + 'x'.repeat(30000), 'FILE', 'INSTRUCTIONS']
  const fitted = fitPrompt(big, 2)
  check('F81_an_oversized_prompt_is_shortened_in_the_related_code_only_and_a_small_prompt_is_left_alone', fitted.length <= 16_500 + 80 && fitted.includes('TASK') && fitted.includes('INSTRUCTIONS') && fitted.includes('related code shortened') && fitPrompt(['a', 'RELATED CODE b', 'c'], 1) === 'a\n\nRELATED CODE b\n\nc')
}

// ======================================================================= review blockers (containment of the default storage path, spawn failure)
{
  check('F82_a_path_from_acceptance_text_is_used_only_when_relative_and_inside_the_workspace', safeRelativePath('./data/a.json') === 'data/a.json' && safeRelativePath('alerts.json') === 'alerts.json' && safeRelativePath('../x.json') === null && safeRelativePath('../../tasks.json') === null && safeRelativePath('/etc/x.json') === null && safeRelativePath('a/../../b.json') === null && safeRelativePath('a\\b.json') === null && safeRelativePath('') === null)
  const up = deriveImplementationContract(['POST /api/things creates a thing (201)', 'things are persisted to disk, THINGS_FILE (default ../../tasks.json)'])
  const abs = deriveImplementationContract(['POST /api/things creates a thing (201)', 'things are persisted to disk, THINGS_FILE (default /etc/things.json)'])
  const okd = deriveImplementationContract(['POST /api/things creates a thing (201)', 'things are persisted to disk, THINGS_FILE (default data/things.json)'])
  check('F83_a_default_path_that_climbs_out_of_the_workspace_or_is_absolute_is_never_recorded_in_the_contract_and_a_normal_one_still_is', !up.persistence.defaultPath && !abs.persistence.defaultPath && okd.persistence.defaultPath === 'data/things.json' && !!ca.persistence.defaultPath)
  const sentinelDir = path.join(os.tmpdir(), `pfsentinel-${process.pid}-${Date.now()}`); mkdirSync(sentinelDir, { recursive: true }); writeFileSync(path.join(sentinelDir, 'keep.txt'), 'x')
  const hostile = { ...ca, persistence: { ...ca.persistence, defaultPath: `../${path.basename(sentinelDir)}/tasks.json` } }
  const rHostile = await runPreflight(mkApp(GOOD), hostile)
  check('F84_the_runtime_preflight_never_deletes_anything_outside_its_private_copy_even_when_the_contract_carries_a_climbing_default_path', existsSync(path.join(sentinelDir, 'keep.txt')) && rHostile.skipped.some((x) => /not a path inside the workspace/.test(x)))
  const rootDefault = { ...ca, persistence: { ...ca.persistence, defaultPath: 'alerts.json' } }
  let rootErr = ''
  const rRoot = await runPreflight(mkApp(GOOD), rootDefault).catch((e) => { rootErr = String(e); return null })
  check('F85_a_root_level_default_path_does_not_delete_the_private_copy_or_crash_the_preflight', rRoot !== null && rootErr === '' && Array.isArray(rRoot.findings))
  const rAbs = await runPreflight(mkApp(GOOD), { ...ca, persistence: { ...ca.persistence, defaultPath: '/tmp/never-used.json' } })
  check('F86_an_absolute_default_path_skips_the_default_path_probe_instead_of_touching_it', rAbs.skipped.some((x) => /not a path inside the workspace/.test(x)) && !existsSync('/tmp/never-used.json'))
  const bad = repairDefaultStoragePath("import path from 'node:path'\nconst FILE = process.env.ALERTS_FILE || path.join(__dirname, '..', 'alerts.json')\n", 'ALERTS_FILE', '../../alerts.json')
  const okr = repairDefaultStoragePath("import path from 'node:path'\nconst FILE = process.env.ALERTS_FILE || path.join(__dirname, '..', 'alerts.json')\n", 'ALERTS_FILE', 'data/alerts.json')
  check('F87_the_default_path_implementation_repair_refuses_a_climbing_path_and_still_repairs_a_normal_one', bad === null && okr !== null)
  const spawnMissing = await runPreflight(mkApp(GOOD), ca, { entry: 'does-not-exist.mjs' })
  check('F88_a_missing_entry_file_skips_the_runtime_probe_without_spawning', spawnMissing.skipped.some((x) => /does not exist/.test(x)) && spawnMissing.findings.length === 0)
  const srcP = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'preflight.ts'), 'utf8')
  check('F89_the_preflight_server_spawn_has_an_error_handler_and_checks_the_working_directory', /child\.on\('error'/.test(srcP) && /existsSync\(dir\)/.test(srcP))
}

// ======================================================================= inherited conventions (string ids): the hidden acceptance gap behind chat 0/3
{
  const readBase = (root: string) => { const out: Record<string, string> = {}; const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const a = path.join(d, e.name); if (e.isDirectory()) walk(a); else if (/\.(m?js|html?)$/.test(e.name)) out[path.relative(root, a).split(path.sep).join('/')] = readFileSync(a, 'utf8') } }; walk(root); return out }
  const chatBase = readBase(makeChatApp(path.join(tmp(), 'chat-conv'))), alertBase = readBase(makeAlertApp(path.join(tmp(), 'alert-conv'))), taskBase = readBase(makeTaskApp(path.join(tmp(), 'task-conv')))
  const ccs = inheritConventions(cc, chatBase)
  check('F90_string_ids_are_inherited_from_the_existing_code_when_the_criteria_do_not_state_the_id_type', !cc.idString && ccs.idString && ccs.ambiguities.some((a) => a.kind === 'CONVENTION_INHERITED' && /STRINGS/.test(a.assumption ?? '')) && unresolvedAmbiguities(ccs).length === 0 && /ids are STRINGS/.test(renderContract(ccs)))
  check('F91_nothing_is_inherited_when_the_criteria_state_numeric_ids_or_the_code_issues_numeric_ids', inheritConventions(ca, chatBase) === ca && !inheritConventions(ct, taskBase).idString && !inheritConventions(ca, alertBase).idString && inheritConventions(cc, { 'src/a.mjs': 'export const x = () => ({ id: state.nextId++ })' }) === cc && inheritConventions(cc, { 'test/a.test.mjs': 'const m = { id: String(1) }' }) === cc)
  const ccsRecipes = matchRecipes(ccs)
  const idRecipe = ccsRecipes.find((r) => r.id === 'MONOTONIC_IDS')
  check('F92_the_id_recipe_tells_the_builder_to_issue_and_compare_string_ids_when_the_contract_says_so', !!idRecipe && /String\(state\.nextId\+\+\)/.test(idRecipe.brief?.(ccs) ?? '') && /never Number\(\)/.test((idRecipe.structure(ccs)[0] ?? '') + (idRecipe.brief?.(ccs) ?? '')) && /numeric nextId|id = state\.nextId\+\+/.test(idRecipe.brief?.(cc) ?? ''))
  const strFiles = { 'server.mjs': "const id = Number(url.pathname.split('/')[3])\n", 'src/store.mjs': 'export function create(n) { const s = { id: state.nextId++, name: n }; return s }\n' }
  const strF = runRecipeChecks(strFiles, ccs, ccsRecipes).filter((f) => f.check === 'string-ids')
  check('F93_a_numeric_conversion_of_a_path_id_and_a_numeric_id_issue_are_both_found_only_under_string_ids', strF.length === 2 && runRecipeChecks(strFiles, cc, matchRecipes(cc)).filter((f) => f.check === 'string-ids').length === 0 && runRecipeChecks({ 'server.mjs': "const id = url.pathname.split('/')[3]\n", 'src/store.mjs': 'export const create = (n) => ({ id: String(state.nextId++), name: n })\n' }, ccs, ccsRecipes).filter((f) => f.check === 'string-ids').length === 0)
  const numApp = GOOD.replace(/id: (\w+)\.nextId\+\+/, 'id: $1.nextId++')
  const ccsNum = { ...ca, idNumeric: false, idString: true }
  const rNum = await runPreflight(mkApp(GOOD), ccsNum)
  check('F94_the_runtime_preflight_reports_a_numeric_id_when_the_contract_fixes_string_ids', rNum.findings.some((f) => f.check === 'ROUTE.create-id' && /string id/.test(f.fact)) && numApp.length > 0)
}

{
  const plan = buildTestPlan(ALERT_FEATURE.acceptance, JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } }))
  const file = plan?.tests[0]?.file ?? 'test/contract.api-1.test.mjs'
  const mk = (call: string) => `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { withApp } from './support/harness.mjs'\ntest('[C${plan?.tests.find((t) => t.file === file)?.criterion_id ?? 1}] x', () => withApp(async (app) => {\n  const a = await app.post('/api/alerts', { title: 'a' })\n  ${call}\n  assert.ok(a)\n}))\n`
  const bad = plan ? reviewTestFile(file, mk("await app.post('/api/alerts/:id/read', {})"), plan) : []
  const good = plan ? reviewTestFile(file, mk('await app.post(`/api/alerts/${a.body.id}/read`, {})'), plan) : []
  const bad2 = plan ? reviewTestFile(file, mk("await app.get('/api/alerts/<id>')"), plan) : []
  check('F95_a_test_that_requests_a_template_path_with_a_placeholder_id_is_sent_back_before_it_runs_and_a_real_id_path_is_not', !!plan && bad.some((f) => f.code === 'PLACEHOLDER_PATH') && bad2.some((f) => f.code === 'PLACEHOLDER_PATH') && !good.some((f) => f.code === 'PLACEHOLDER_PATH'))
}

// ======================================================================= gold-round-1 findings: compound list criterion split per filter value, edit-result syntax fallback
{
  const fv = filterVariantsOf(4, ca)
  const keys = fv.map((v) => v.key)
  check('F96_the_alert_list_criterion_is_split_into_one_variant_per_filter_value_and_one_for_the_default_view', ['FILTER_UNREAD', 'FILTER_READ', 'FILTER_ARCHIVED', 'FILTER_ALL', 'FILTER_DEFAULT'].every((k) => keys.includes(k as never)) && fv.length === 5, keys.join())
  const unread = fv.find((v) => v.key === 'FILTER_UNREAD')?.recipe ?? ''
  check('F97_a_filter_variant_carries_the_exact_population_recipe_flag_routes_the_blocking_action_last_and_the_selection', /(read is false and archived is false|archived is false and read is false)/.test(unread) && !/:id/.test(unread) && /LAST/.test(unread) && /archive/.test(unread) && /real id|REAL id/.test(unread) && /state=unread/.test(unread), unread.slice(0, 300))
  const acc2 = ALERT_FEATURE.acceptance.map((a, i) => (i === 0 ? a.replace(/\s*\(201\)/, '') : a))
  const plan2 = buildTestPlan(acc2, JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } }))
  const row2 = plan2?.tests.find((t) => t.criterion_id === 4)
  check('F98_when_the_contract_cannot_support_generated_filter_tests_the_row_falls_back_to_model_variants_and_a_file_without_them_is_sent_back', !!plan2 && !plan2.files.some((f) => f.generated) && (row2?.variants ?? []).length === 5 && reviewTestFile(row2!.file!, "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { withApp } from './support/harness.mjs'\ntest('[C4] list filters', () => withApp(async (app) => { const r = await app.get('/api/alerts'); assert.ok(r) }))\n", plan2).some((f) => f.code === 'MISSING_VARIANT' && /FILTER_UNREAD/.test(f.detail)))
  const tplan = buildTestPlan(TASK_FEATURE.acceptance, JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } }))
  check('F99_a_criterion_without_flag_selections_gets_no_filter_variants', !!tplan && tplan.tests.every((t) => !(t.variants ?? []).some((v) => String(v.key).startsWith('FILTER_'))))
  const wf = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'workflow.ts'), 'utf8')
  check('F100_an_edit_that_leaves_a_file_that_does_not_parse_falls_back_to_one_whole_file_reply_and_the_edit_protocol_says_where_code_goes', /parsedReply\.mode === 'edits' && \/syntax error\|would not start\/i\.test\(problem\)/.test(wf) && /WHERE CODE GOES/.test(ENGINEER_STRUCT_SYSTEM) && /outside every function/.test(ENGINEER_STRUCT_SYSTEM))
}

{
  const SRV = [
    "const server = createServer(async (req, res) => {",
    "  const url = new URL(req.url, 'http://localhost')",
    "  try {",
    "    if (url.pathname === '/api/alerts' && req.method === 'POST') return reply(res, 201, {})",
    "    if (new RegExp('^/api/alerts/(\\\\d+)/read$').test(url.pathname) && req.method === 'POST') return reply(res, 200, {})",
    "    if (RegExp(\"^/api/alerts/(\\\\d+)/unread$\").test(url.pathname) && req.method === 'POST') return reply(res, 200, {})",
    "    return reply(res, 404, {})",
    "  } catch (e) { return reply(res, 400, {}) }",
    "})",
  ].join('\n')
  const rt = routeTable(SRV)
  const probs = contractRouteProblems('server.mjs', SRV, ['POST /api/alerts creates one', 'POST /api/alerts/:id/read marks read', 'POST /api/alerts/:id/unread marks unread'])
  check('F101_a_route_written_as_a_string_regular_expression_is_recognised_by_the_dispatcher_analysis', rt.filter((r) => r.kind === 'regex').length === 2 && rt.some((r) => r.matches('/api/alerts/1/read')) && !probs.some((x) => /read|unread/.test(x)), JSON.stringify(rt.map((r) => r.pattern)) + probs.join('|'))
}

{
  const pkg = JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } })
  const plan = buildTestPlan(ALERT_FEATURE.acceptance, pkg)
  const gf = plan?.files.find((f) => f.generated)
  const row = plan?.tests.find((t) => t.criterion_id === 4)
  check('F102_the_list_criterion_is_covered_by_a_Foundry_generated_file_and_the_model_files_no_longer_carry_it', !!plan && !!gf && gf.criteria.join() === '4' && row?.file === gf.path && !(row?.variants ?? []).some((v) => String(v.key).startsWith('FILTER_')) && plan.files.filter((f) => !f.generated).every((f) => !f.criteria.includes(4)) && !planPromptFor(plan, plan.files.find((f) => !f.generated)!.path).includes('[C4]'), JSON.stringify(plan?.files.map((f) => [f.path, f.criteria])))
  const dir = makeAlertApp(path.join(tmp(), 'alert-gen'))
  for (const [rel, text] of Object.entries(ALERT_REFERENCE)) { if (!/^test\//.test(rel)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text) } }
  mkdirSync(path.join(dir, 'test', 'support'), { recursive: true })
  writeFileSync(path.join(dir, HARNESS_PATH), harnessSource('server.mjs', ['ALERTS_FILE']))
  writeFileSync(path.join(dir, gf!.path), gf!.generated!)
  const run = (d: string) => spawnSync('node', ['--test', gf!.path], { cwd: d, encoding: 'utf8', timeout: 90_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } as unknown as NodeJS.ProcessEnv })
  const ok = run(dir)
  check('F103_the_generated_filter_tests_pass_against_the_reference_implementation_one_test_per_filter_value_and_one_for_the_default_view', ok.status === 0 && /(?:# |ℹ )pass 5\b/.test(ok.stdout) && /(?:# |ℹ )fail 0/.test(ok.stdout), `${ok.status} ${ok.stdout.slice(-400)} ${ok.stderr.slice(-300)}`)
  const bugDir = makeAlertApp(path.join(tmp(), 'alert-gen-bug'))
  for (const [rel, text] of Object.entries(ALERT_REFERENCE)) { if (!/^test\//.test(rel)) { mkdirSync(path.dirname(path.join(bugDir, rel)), { recursive: true }); writeFileSync(path.join(bugDir, rel), rel === 'src/alertService.mjs' ? text.replace("if (a.archived) return false\n    if (want === 'unread')", "if (want === 'unread')") : text) } }
  mkdirSync(path.join(bugDir, 'test', 'support'), { recursive: true }); writeFileSync(path.join(bugDir, HARNESS_PATH), harnessSource('server.mjs', ['ALERTS_FILE'])); writeFileSync(path.join(bugDir, gf!.path), gf!.generated!)
  const bad = run(bugDir)
  check('F104_the_generated_filter_tests_fail_when_the_implementation_lets_an_archived_alert_into_the_unread_list', bad.status !== 0 && /FILTER_UNREAD/.test(bad.stdout + bad.stderr), `${bad.status} ${bad.stdout.slice(-300)}`)
  check('F105_the_generated_file_passes_the_pre_execution_review_and_nothing_is_generated_when_the_contract_lacks_a_setter_or_a_create_route', !!plan && reviewTestFile(gf!.path, gf!.generated!, plan).length === 0 && generateFilterTests(4, { ...ca, flags: [] }) === null && generateFilterTests(4, { ...ca, routes: ca.routes.map((r) => ({ ...r, createsRecord: false })) }) === null && generateFilterTests(1, ca) === null, JSON.stringify(plan ? reviewTestFile(gf!.path, gf!.generated!, plan) : []))
}

{
  const seen: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => { seen.push(String(JSON.parse(String(init?.body)).keep_alive)); return new Response(JSON.stringify({ response: 'x', eval_count: 1, prompt_eval_count: 1 }), { status: 200 }) }) as typeof fetch
  try {
    await new OllamaModelClient('m').generate({ system: 's', prompt: 'p' })
    await new OllamaModelClient('m', undefined, '0').generate({ system: 's', prompt: 'p' })
  } finally { globalThis.fetch = realFetch }
  const e2e = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'e2eRealModel.ts'), 'utf8')
  check('F106_the_builder_model_stays_loaded_while_helper_models_unload_right_after_use', seen.join() === '10m,0' && /const localClient = \(name: string\): ModelClient => \{ const c = new OllamaModelClient\(name, undefined, '0'\)/.test(e2e), seen.join())
}

{
  const endless = ["test('[C6] read-all', () => withApp(async (app) => {", ...Array.from({ length: 70 }, (_, i) => `  await app.post('/api/alerts', { title: 'x${i}', severity: 'info' })`)].join('\n')
  const normal = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'alertFixture.ts'), 'utf8')
  check('F107_a_generation_that_repeats_one_statement_endlessly_is_recognised_and_ordinary_code_is_not', isRunaway(endless) && !isRunaway(normal) && !isRunaway(endless.split('\n').slice(0, 30).join('\n')))
  const ndjson = (parts: string[], extra: object = {}) => parts.map((r) => JSON.stringify({ response: r, done: false })).join('\n') + '\n' + JSON.stringify({ response: '', done: true, eval_count: 7, prompt_eval_count: 3, ...extra }) + '\n'
  const streamOf = (chunks: string[], delay = false) => new ReadableStream<Uint8Array>({ async start(c) { for (const k of chunks) { c.enqueue(new TextEncoder().encode(k)); if (delay) await new Promise((r) => setTimeout(r, 5)) } c.close() } })
  const realFetch2 = globalThis.fetch
  const withFetch = async (body: () => Response, fn: () => Promise<unknown>) => { globalThis.fetch = (async () => body()) as typeof fetch; try { return await fn() } finally { globalThis.fetch = realFetch2 } }
  const ok = await withFetch(() => new Response(streamOf([ndjson(['hel', 'lo'])]), { status: 200 }), () => new OllamaModelClient('m').generate({ system: 's', prompt: 'p' })) as { ok: boolean; text?: string; outputTokens?: unknown; promptTokens?: unknown }
  const split = await withFetch(() => new Response(streamOf([ndjson(['ab', 'cd']).slice(0, 25), ndjson(['ab', 'cd']).slice(25)]), { status: 200 }), () => new OllamaModelClient('m').generate({ system: 's', prompt: 'p' })) as { ok: boolean; text?: string }
  const loopLines = Array.from({ length: 80 }, (_, i) => `  await app.post('/api/alerts', { title: 'x${i}' })\n`)
  const runaway = await withFetch(() => new Response(streamOf([ndjson(["test('a', () => {\n", ...loopLines.slice(0, 3)]).replace(/\n\{"response":"","done":true.*\n$/, '\n'), ...loopLines.map((l) => JSON.stringify({ response: l, done: false }) + '\n')], true), { status: 200 }), () => new OllamaModelClient('m').generate({ system: 's', prompt: 'p' })) as { ok: boolean; detail?: string }
  const err = await withFetch(() => new Response(JSON.stringify({ error: 'boom' }) + '\n', { status: 200 }), () => new OllamaModelClient('m').generate({ system: 's', prompt: 'p' })) as { ok: boolean; detail?: string }
  check('F108_the_model_client_reads_a_streamed_reply_with_real_token_counts_even_when_a_line_is_split_across_chunks', ok.ok && ok.text === 'hello' && ok.outputTokens === 7 && ok.promptTokens === 3 && split.ok && split.text === 'abcd', JSON.stringify([ok, split]))
  check('F109_a_runaway_stream_is_stopped_early_with_a_retryable_failure_and_a_model_error_line_is_reported_as_a_transient_failure', !runaway.ok && /degenerate repetition/.test(runaway.detail ?? '') && classifyModelFailure(runaway.detail ?? '', false) === 'TIMEOUT' && !err.ok && /model error/.test(err.detail ?? '') && classifyModelFailure(err.detail ?? '', false) === 'TRANSIENT', JSON.stringify([runaway, err]))
  const wf2 = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'workflow.ts'), 'utf8')
  const planP = buildTestPlan(ALERT_FEATURE.acceptance, JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } }))
  check('F110_after_a_runaway_the_retry_is_warmer_and_asks_for_compact_setup_and_the_test_prompt_says_to_use_a_loop_for_bulk_data', /REPEATED THE SAME STATEMENT ENDLESSLY/.test(wf2) && /if \(!r\.ok && \/degenerate repetition\/i\.test\(r\.detail\)\) runaway = true/.test(wf2) && !!planP && /KEEP SETUP SHORT/.test(planPromptFor(planP, planP.files.find((f) => !f.generated)!.path)))
}

{
  const BAD2 = "const reply = (res, status, body, type) => res.end(body)\nexport const h2 = (url, res) => {\n  if (url.pathname === '/client.js') return reply(res, 200, readFileSync('public/client.js', 'text/javascript'), 'text/javascript')\n}\n"
  const BAD = "import { readFileSync } from 'node:fs'\nconst send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(body) }\nexport const handle = (url, res) => {\n  if (url.pathname === '/app.js') return send(res, 200, readFileSync('public/app.js', 'text/javascript'))\n  if (url.pathname === '/') return send(res, 200, readFileSync('public/index.html', 'utf8'), 'text/html')\n}\n"
  const recs = matchRecipes(cc)
  const found = runRecipeChecks({ 'server.mjs': BAD }, cc, recs).filter((f) => f.check === 'readfile-encoding')
  const fixed = autofix('server.mjs', BAD, found, cc)
  const found2 = runRecipeChecks({ 'server.mjs': BAD2 }, cc, recs).filter((f) => f.check === 'readfile-encoding')
  const fixed2 = autofix('server.mjs', BAD2, found2, cc)
  check('F111_a_content_type_passed_to_readFileSync_as_its_encoding_is_found_and_moved_into_the_reply_call_deterministically', found.length === 1 && !!fixed && /readFileSync\('public\/app\.js', 'utf8'\), 'text\/javascript'\)/.test(fixed.content) && /readFileSync\('public\/index\.html', 'utf8'\), 'text\/html'\)/.test(fixed.content) && runRecipeChecks({ 'server.mjs': fixed.content }, cc, recs).filter((f) => f.check === 'readfile-encoding').length === 0 && syntaxOk(fixed.content) && found2.length === 1 && !!fixed2 && fixed2.content.includes("readFileSync('public/client.js', 'utf8'), 'text/javascript')") && !/'text\/javascript'\), 'text\/javascript'\), 'text/.test(fixed2.content) && syntaxOk(fixed2.content), JSON.stringify(found.map((f) => f.fact)))
}

{
  const pkg = JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } })
  const plan = buildTestPlan(TASK_FEATURE.acceptance, pkg)
  const gf = plan?.files.find((f) => f.generated && f.criteria.join() === '4')
  check('F112_the_task_summary_criterion_is_covered_by_a_generated_count_file_walked_along_allowed_transitions', !!plan && !!gf && plan.files.some((f) => f.generated && f.criteria.join() === '4') && /SUMMARY: counts per status/.test(gf.generated!) && /"doing":\["doing"\]/.test(gf.generated!) && /"done":\["doing","done"\]/.test(gf.generated!) && !/title: 'todo'/.test(gf.generated!) && plan.files.filter((f) => !f.generated).every((f) => !f.criteria.includes(4)), JSON.stringify(plan?.files.map((f) => [f.path, f.criteria])))
  const mk = (patch: (rel: string, text: string) => string, tag: string) => {
    const dir = makeTaskApp(path.join(tmp(), tag))
    for (const [rel, text] of Object.entries(TASK_REFERENCE)) { if (!/^test\//.test(rel)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), patch(rel, text)) } }
    mkdirSync(path.join(dir, 'test', 'support'), { recursive: true }); writeFileSync(path.join(dir, HARNESS_PATH), harnessSource('server.mjs', ['TASKS_FILE'])); writeFileSync(path.join(dir, gf!.path), gf!.generated!)
    return dir
  }
  const run = (d: string) => spawnSync('node', ['--test', gf!.path], { cwd: d, encoding: 'utf8', timeout: 90_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } as unknown as NodeJS.ProcessEnv })
  const ok = run(mk((_r, t) => t, 'task-gen'))
  check('F113_the_generated_count_tests_pass_against_the_reference_implementation', ok.status === 0 && /(?:# |ℹ )pass 2\b/.test(ok.stdout) && /(?:# |ℹ )fail 0/.test(ok.stdout), `${ok.status} ${ok.stdout.slice(-300)} ${ok.stderr.slice(-200)}`)
  const bad = run(mk((rel, t) => (/summary|Service|service/.test(rel) ? t.replace(/doing:\s*0/g, 'doing: 9').replace(/\.done\b/, '.todo') : t), 'task-gen-bug'))
  check('F114_the_generated_count_tests_fail_when_the_summary_counts_the_wrong_status', bad.status !== 0, `${bad.status} ${bad.stdout.slice(-200)}`)
  const wf = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'workflow.ts'), 'utf8')
  check('F115_a_known_deterministic_defect_is_corrected_on_every_model_write_and_nothing_is_generated_without_the_needed_contract_facts', /\(on write\)/.test(wf) && /tag === '' && !\/\^test/.test(wf) && generateCounterTests(4, { ...ct, transitions: [] }) === null && generateCounterTests(4, { ...ct, routes: ct.routes.map((r) => ({ ...r, createsRecord: false })) }) === null && generateCounterTests(1, ct) === null)
}

{
  const pkg = JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } })
  const plan = buildTestPlan(TASK_FEATURE.acceptance, pkg)
  const gf = plan?.files.find((f) => f.generated && f.criteria.join() === '2')
  check('F116_the_task_move_criterion_is_covered_by_a_generated_transition_file_with_allowed_rejected_unknown_status_and_unknown_id_tests', !!gf && /MOVES_ALLOWED/.test(gf.generated!) && /MOVES_REJECTED/.test(gf.generated!) && /STATUS_UNKNOWN/.test(gf.generated!) && /ID_UNKNOWN/.test(gf.generated!) && /\["todo","done"\]/.test(gf.generated!) && /\["done","todo"\]/.test(gf.generated!) && plan!.files.filter((f) => !f.generated).every((f) => !f.criteria.includes(2)), JSON.stringify(plan?.files.map((f) => [f.path, f.criteria])))
  const mk = (patch: (rel: string, text: string) => string, tag: string) => {
    const dir = makeTaskApp(path.join(tmp(), tag))
    for (const [rel, text] of Object.entries(TASK_REFERENCE)) { if (!/^test\//.test(rel)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), patch(rel, text)) } }
    mkdirSync(path.join(dir, 'test', 'support'), { recursive: true }); writeFileSync(path.join(dir, HARNESS_PATH), harnessSource('server.mjs', ['TASKS_FILE'])); writeFileSync(path.join(dir, gf!.path), gf!.generated!)
    return dir
  }
  const run = (d: string) => spawnSync('node', ['--test', gf!.path], { cwd: d, encoding: 'utf8', timeout: 90_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } as unknown as NodeJS.ProcessEnv })
  const ok = run(mk((_r, t) => t, 'task-trans'))
  check('F117_the_generated_transition_tests_pass_against_the_reference_implementation', ok.status === 0 && /(?:# |ℹ )pass 4\b/.test(ok.stdout) && /(?:# |ℹ )fail 0/.test(ok.stdout), `${ok.status} ${ok.stdout.slice(-400)} ${ok.stderr.slice(-200)}`)
  const ref = TASK_REFERENCE['src/taskService.mjs'] ?? ''
  const loose = run(mk((rel, t) => (rel === 'src/taskService.mjs' ? t.replace(/(done:\s*\[)'doing'\]/, "$1'doing', 'todo']") : t), 'task-trans-bug'))
  check('F118_the_generated_transition_tests_fail_when_the_implementation_allows_a_move_the_contract_forbids', ref.length > 0 && loose.status !== 0, `${loose.status} ${loose.stdout.slice(-300)} ref=${ref.length}`)
  const SRV = ["const server = createServer(async (req, res) => {", "  const url = new URL(req.url, 'http://localhost')", "  try {", "    if (req.method === 'POST' && url.pathname === '/api/alerts') return reply(res, 201, {})", "    const readMatch = url.pathname.match(/^\\/api\\/alerts\\/(\\d+)\\/read$/)", "    if (req.method === 'POST' && readMatch) {", "      return reply(res, 200, {})", "    }", "    const archiveMatch = url.pathname.match(/^\\/api\\/alerts\\/(\\d+)\\/archive$/)", "    if (req.method === 'POST' && archiveMatch) return reply(res, 200, {})", "    const bad = url.pathname.match(/^\\/x$/)", "    if (!bad) return reply(res, 404, {})", "    return reply(res, 404, {})", "  } catch (e) { return reply(res, 400, {}) }", "})"].join('\n')
  const rt = routeTable(SRV)
  const probs = contractRouteProblems('server.mjs', SRV, ['POST /api/alerts creates one', 'POST /api/alerts/:id/read marks read', 'POST /api/alerts/:id/archive archives'])
  check('F119_a_route_whose_match_result_is_stored_in_a_constant_and_used_later_in_the_condition_is_recognised', rt.some((r) => r.kind === 'regex' && r.matches('/api/alerts/1/read') && r.method === 'POST') && !probs.some((x) => /read|archive/.test(x)), JSON.stringify(rt.map((r) => [r.pattern, r.method])) + probs.join('|'))
  check('F120_nothing_is_generated_for_transitions_without_a_move_route_or_a_create_route', generateTransitionTests(2, { ...ct, routes: ct.routes.map((r) => ({ ...r, createsRecord: false })) }) === null && generateTransitionTests(2, { ...ct, transitions: [] }) === null && generateTransitionTests(1, ct) === null && generateTransitionTests(2, ca) === null)
}

{
  check('F121_a_model_server_error_reported_inside_the_stream_is_retried_like_an_http_5xx_and_a_malformed_reply_is_not', classifyModelFailure('model error: an error was encountered while running the model: CUDA error: the launch timed out and was terminated', false) === 'TRANSIENT' && classifyModelFailure('HTTP 503', false) === 'TRANSIENT' && classifyModelFailure('malformed response', false) === 'NO_RETRY' && classifyModelFailure('model error: x', true) === 'NO_RETRY')
}

{
  const pkg = JSON.stringify({ type: 'module', scripts: { start: 'node server.mjs' } })
  const cases: { name: string; acc: string[]; make: (root: string) => string; ref: Record<string, string>; vars: string[] }[] = [
    { name: 'task', acc: TASK_FEATURE.acceptance, make: makeTaskApp, ref: TASK_REFERENCE, vars: ['TASKS_FILE'] },
    { name: 'alert', acc: ALERT_FEATURE.acceptance, make: makeAlertApp, ref: ALERT_REFERENCE, vars: ['ALERTS_FILE'] },
    { name: 'chat', acc: CHAT_FEATURE.acceptance, make: makeChatApp, ref: CHAT_REFERENCE, vars: ['CHAT_DATA_FILE'] },
  ]
  const results: Record<string, { files: string[]; ok: boolean; bad: boolean; detail: string }> = {}
  for (const k of cases) {
    const plan = buildTestPlan(k.acc, pkg)
    const gens = (plan?.files ?? []).filter((f) => f.generated && /PERSISTENCE|CUSTOM_PATH|DEFAULT_PATH|IDS/.test(f.generated))
    const build = (tag: string, mutate: boolean) => {
      const dir = k.make(path.join(tmp(), `${k.name}-${tag}`))
      for (const [rel, text] of Object.entries(k.ref)) { if (/^test\//.test(rel)) continue; mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), mutate ? text.replace(/\bwriteFileSync\(/g, '(() => {})(') : text) }
      mkdirSync(path.join(dir, 'test', 'support'), { recursive: true }); writeFileSync(path.join(dir, HARNESS_PATH), harnessSource('server.mjs', k.vars))
      for (const g of gens) writeFileSync(path.join(dir, g.path), g.generated!)
      return dir
    }
    const run = (d: string) => spawnSync('node', ['--test', ...gens.map((g) => g.path)], { cwd: d, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } as unknown as NodeJS.ProcessEnv })
    const good = gens.length ? run(build('ok', false)) : null
    const bad = gens.length ? run(build('bug', true)) : null
    results[k.name] = { files: gens.map((g) => g.path), ok: !!good && good.status === 0 && /(?:# |ℹ )fail 0/.test(good.stdout), bad: !!bad && bad.status !== 0, detail: `${good?.status} ${good?.stdout.slice(-350)} ${good?.stderr.slice(-200)}` }
  }
  check('F122_the_storage_criteria_of_the_task_alert_and_chat_contracts_are_covered_by_generated_persistence_files', Object.values(results).every((r) => r.files.length >= 1), JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.files]))))
  check('F123_the_generated_persistence_tests_pass_against_the_task_alert_and_chat_reference_implementations', Object.values(results).every((r) => r.ok), JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.detail]))))
  check('F124_the_generated_persistence_tests_fail_when_the_implementation_never_writes_its_file', Object.values(results).every((r) => r.bad))
  check('F125_nothing_is_generated_for_persistence_without_a_storage_variable_or_a_list_route_or_for_a_criterion_that_is_not_about_storage', generatePersistenceTests(5, { ...ct, persistence: { ...ct.persistence, envVar: null } }, ['CUSTOM_PATH']) === null && generatePersistenceTests(5, { ...ct, routes: ct.routes.filter((r) => r.method !== 'GET') }, ['PERSISTENCE']) === null && generatePersistenceTests(1, ct, ['PERSISTENCE']) === null && generatePersistenceTests(5, ct, []) === null)
}

{
  const LAZY = GOOD.replace("let db = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : { items: [], nextId: 1 }", "let db = { items: [], nextId: 1 }\nlet loaded = false\nconst load = () => { if (loaded) return; loaded = true; if (existsSync(file())) db = JSON.parse(readFileSync(file(), 'utf8')) }")
    .replace("if (req.method === 'GET' && pathname === '/api/alerts') {\n", "if (req.method === 'GET' && pathname === '/api/alerts') {\n    load()\n")
  const rLazy = await runPreflight(mkApp(LAZY), ca)
  const rGood = await runPreflight(mkApp(GOOD), ca)
  check('F126_a_create_that_is_the_first_request_after_a_restart_is_caught_when_the_stored_data_is_only_loaded_lazily', LAZY !== GOOD && rLazy.findings.some((f) => f.check === 'PERSISTENCE.cold-create' && /first request after a restart/.test(f.fact)) && !rGood.findings.some((f) => f.check === 'PERSISTENCE.cold-create'), JSON.stringify(rLazy.findings.map((f) => f.check + ': ' + f.fact.slice(0, 120))))
}
void deriveAssignments; void AgentOpsLog

finish()

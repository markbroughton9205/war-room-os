/** Generic reliability gates found by the real-model rounds 8/9: persistence contract, route conflicts, status reachability, syntax, legacy-state drift, structured failure evidence. Run: pnpm run validate:agent-eng-reliability */
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harness, tmp } from './engtestkit'
import { persistenceProblems, persistenceProbe, storageFacts, wantsPersistence, storageEnvVars } from './persistenceContract'
import { acceptanceRoutes, contractRouteProblems, legacyStateDrift, routeFindings, routeTable, statusReachability, syntaxProblems } from './staticGates'
import { buildEvidence, parseChecks } from './failureEvidence'
import { startupProbe } from './startupProbe'
import { CHAT_FEATURE, CHAT_REFERENCE, makeChatApp } from './chatFixture'
import { TASK_FEATURE, TASK_REFERENCE } from './taskFixture'
import { ALERT_FEATURE, ALERT_REFERENCE } from './alertFixture'
import { TICKET_FEATURE, TICKET_REFERENCE } from './ticketFixture'

const { check, finish } = harness('AGENT_ENG_RELIABILITY_VALIDATION')
const FX = { chat: [CHAT_FEATURE, CHAT_REFERENCE], task: [TASK_FEATURE, TASK_REFERENCE], alert: [ALERT_FEATURE, ALERT_REFERENCE], ticket: [TICKET_FEATURE, TICKET_REFERENCE] } as const
const srcOnly = (ref: Record<string, string>) => Object.fromEntries(Object.entries(ref).filter(([k]) => /\.m?js$/.test(k) && !/^(test|public)\//.test(k)))

// ---- persistence contract (static)
const STORE_OK = `import fs from 'node:fs'\nconst file = process.env.DATA_FILE\nlet items = []\nif (fs.existsSync(file)) items = JSON.parse(fs.readFileSync(file, 'utf8'))\nfunction save() { fs.writeFileSync(file, JSON.stringify(items)) }\nexport function addItem(x) { items.push(x); save(); return x }\nexport function allItems() { return items }\n`
const PERSIST = ['items are persisted to disk and survive a restart', 'the data file path comes from the DATA_FILE environment variable']
check('R01_the_acceptance_text_decides_whether_persistence_is_claimed_and_which_env_var_names_the_storage', wantsPersistence(PERSIST) && !wantsPersistence(['the list is sorted']) && storageEnvVars(PERSIST).join() === 'DATA_FILE')
check('R02_a_correct_store_has_no_contract_problem', persistenceProblems({ 'src/store.mjs': STORE_OK }, PERSIST).length === 0)
const forgetful = STORE_OK.replace('export function allItems', 'export function removeItem(i) { items.splice(i, 1) }\nexport function allItems')
const pf = persistenceProblems({ 'src/store.mjs': forgetful }, PERSIST)
check('R03_a_mutation_that_never_reaches_a_file_write_while_its_siblings_do_is_found_before_the_write', pf.length === 1 && /removeItem\(\) changes the persisted collection items/.test(pf[0]), pf.join('|'))
check('R04_a_loader_that_fills_the_collection_is_not_blamed', persistenceProblems({ 'src/store.mjs': STORE_OK.replace('export function allItems', 'export function reloadItems() { items = JSON.parse(fs.readFileSync(file, "utf8")) }\nexport function allItems') }, PERSIST).length === 0)
check('R05_a_store_that_ignores_the_named_env_var_is_found', persistenceProblems({ 'src/store.mjs': STORE_OK.replace('process.env.DATA_FILE', "'data.json'") }, PERSIST).some((p) => /DATA_FILE/.test(p)))
check('R06_writing_without_ever_reading_back_is_found', persistenceProblems({ 'src/store.mjs': `import fs from 'node:fs'\nconst file = process.env.DATA_FILE\nlet items = []\nexport function addItem(x) { items.push(x); fs.writeFileSync(file, JSON.stringify(items)); return x }\n` }, PERSIST).some((p) => /ever reads it back/.test(p)))
check('R07_an_alias_of_the_collection_counts_as_a_mutation_of_it', (() => { const t = STORE_OK.replace('export function allItems', 'export function rename(i, n) { const it = items.find((x) => x.id === i); it.name = n }\nexport function allItems'); return persistenceProblems({ 'src/store.mjs': t }, PERSIST).some((p) => /rename\(\)/.test(p)) })())
check('R08_storage_facts_report_writers_collections_and_env_reads', (() => { const f = storageFacts('src/store.mjs', STORE_OK); return f.writers.includes('save') && f.collections.includes('items') && f.envReads.includes('DATA_FILE') && f.readsFs })())

// ---- persistence contract (dynamic round trip on a private copy)
const mkRoot = (files: Record<string, string>) => { const root = path.join(tmp(), 'p'); for (const [k, v] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, k)), { recursive: true }); writeFileSync(path.join(root, k), v) } return root }
const okRoot = mkRoot({ 'package.json': '{"type":"module"}', 'src/store.mjs': STORE_OK })
const wipes = mkRoot({ 'package.json': '{"type":"module"}', 'src/store.mjs': STORE_OK.replace("let items = []\nif (fs.existsSync(file)) items = JSON.parse(fs.readFileSync(file, 'utf8'))", "let items = []\nfs.writeFileSync(file, '[]')\nif (fs.existsSync(file)) items = JSON.parse(fs.readFileSync(file, 'utf8'))") })
const pOk = await persistenceProbe(okRoot, PERSIST, ['src/store.mjs']), pBad = await persistenceProbe(wipes, PERSIST, ['src/store.mjs'])
check('R09_the_round_trip_probe_passes_for_a_store_that_really_persists', pOk.verdict === 'PASS', pOk.detail)
check('R10_the_round_trip_probe_fails_with_before_and_after_data_for_a_store_that_loses_data_on_restart', pBad.verdict === 'FAIL' && /before the restart/.test(pBad.detail) && /after/.test(pBad.detail), pBad.detail)
check('R11_the_probe_is_inconclusive_not_a_false_pass_when_nothing_writes_to_disk_or_persistence_is_not_claimed', (await persistenceProbe(mkRoot({ 'src/m.mjs': 'const a = []\nexport function add(x) { a.push(x) }\n' }), PERSIST, ['src/m.mjs'])).verdict === 'INCONCLUSIVE' && (await persistenceProbe(okRoot, ['sorted'], ['src/store.mjs'])).verdict === 'INCONCLUSIVE')

// ---- route conflict analyzer
const R = (lines: string[]) => lines.join('\n')
const shadow1 = R(["    if (url.pathname.startsWith('/api/a/') && req.method === 'POST') {", '      return reply(res, 200, 1)', '    }', "    if (url.pathname === '/api/a/read-all' && req.method === 'POST') return reply(res, 200, 2)"])
check('R12_a_specific_route_hidden_by_a_broad_prefix_route_is_found', routeFindings('server.mjs', shadow1).map((f) => `${f.kind}:${f.hidden}`).join() === 'PREFIX_SHADOWS:/api/a/read-all')
const shadow2 = R(["    if (/^\\/api\\/a\\/([^/]+)$/.test(url.pathname) && req.method === 'GET') {", '      return reply(res, 200, 1)', '    }', "    if (url.pathname === '/api/a/summary' && req.method === 'GET') return reply(res, 200, 2)"])
check('R13_a_fixed_path_hidden_by_a_parameter_route_is_found', routeFindings('server.mjs', shadow2).map((f) => `${f.kind}:${f.hidden}`).join() === 'PARAM_SHADOWS:/api/a/summary', JSON.stringify(routeFindings('server.mjs', shadow2)))
const dup = R(["    if (url.pathname === '/api/a' && req.method === 'GET') return reply(res, 200, 1)", "    if (url.pathname === '/api/a' && req.method === 'GET') return reply(res, 200, 2)"])
check('R14_a_route_registered_twice_is_found', routeFindings('server.mjs', dup).map((f) => f.kind).join() === 'DUPLICATE')
check('R15_a_different_method_or_a_literal_first_is_not_a_conflict', routeFindings('server.mjs', R(["    if (url.pathname.startsWith('/api/a/') && req.method === 'PATCH') {", '      return 1', '    }', "    if (url.pathname === '/api/a/x' && req.method === 'GET') return 2"])).length === 0 && routeFindings('server.mjs', R(["    if (url.pathname === '/api/a/x') return 2", "    if (url.pathname.startsWith('/api/a/')) {", '      return 1', '    }'])).length === 0)
check('R16_a_sub_dispatch_nested_inside_a_route_block_is_not_a_second_route', (() => { const t = R(["    const m = /^\\/api\\/a\\/(\\d+)$/.exec(url.pathname)", "    if (url.pathname.startsWith('/api/a/') && req.method === 'POST') {", '      if (!m) return 1', '      return 2', '    }']); return routeTable(t).length === 1 })())
check('R17_regex_literals_with_a_slash_inside_a_character_class_are_parsed_as_routes', routeTable(R(['    const m = /^\\/api\\/s\\/([^/]+)(\\/messages)?$/.exec(url.pathname)', '    if (m) {', '      return 1', '    }'])).length === 1)
const ar = acceptanceRoutes(['POST /api/alerts/read-all marks all (200)', 'GET /api/alerts/:id returns one'])
check('R18_routes_named_by_the_contract_are_extracted_with_a_concrete_sample_path', ar.length === 2 && ar[1].sample === '/api/alerts/1')
const disp = R(["    if (url.pathname === '/api/alerts' && req.method === 'POST') return reply(res, 201, 1)", "    if (url.pathname === '/x') return 1", "    if (url.pathname === '/y') return 1"])
const cpm = contractRouteProblems('server.mjs', disp, ['GET /api/alerts lists alerts', 'POST /api/alerts/read-all marks read'])
check('R19_a_contract_route_with_the_wrong_method_or_no_route_at_all_is_found', cpm.length === 2 && /only for POST/.test(cpm[0]) && /no route/.test(cpm[1]), cpm.join('|'))
check('R20_a_client_call_with_a_method_the_server_does_not_register_is_found', contractRouteProblems('server.mjs', disp, [], ["fetch('/api/alerts', { method: 'PUT' })"]).some((p) => /calls PUT/.test(p)))

// ---- status reachability, syntax, legacy-state drift
check('R21_a_status_the_contract_requires_but_no_code_can_send_is_found', statusReachability({ 'server.mjs': "reply(res, 404, {})\nreply(res, 400, {})" }, ['archived alerts cannot be read (409)', 'unknown ids return 404']).join() === '409')
check('R22_a_status_taken_from_the_thrown_error_counts_as_reachable', statusReachability({ 'server.mjs': 'catch (err) { return reply(res, err.status || 400, {}) }' }, ['conflicts return 409']).length === 0)
check('R23_a_syntax_error_is_found_with_its_line_before_the_file_is_written', syntaxProblems('server.mjs', "const a = 1\nreply(res, 200, readFileSync('x.js', 'utf8')\nconst b = 2\n").some((p) => /^line \d+/.test(p)) && syntaxProblems('server.mjs', 'export const a = 1\n').length === 0)
const LEG = 'const messages = []\nexport function allMessages() { return messages }\nexport function pushMessage(m) { messages.push(m); return m }\n'
check('R24_an_existing_export_re_pointed_at_a_new_collection_is_found', legacyStateDrift('s.mjs', LEG, LEG.replace('const messages = []', 'const messages = []\nlet sessions = []').replace('return messages', 'return sessions.flatMap((s) => s.messages)')).some((d) => d.fn === 'allMessages' && d.now === 'sessions'))
check('R25_adding_new_state_and_new_functions_next_to_the_legacy_ones_is_not_drift', legacyStateDrift('s.mjs', LEG, LEG + 'const sessions = []\nexport function createSession(n) { sessions.push(n); return n }\n').length === 0)
check('R26_a_property_that_merely_shares_a_name_with_the_old_state_is_not_a_reference_to_it', legacyStateDrift('s.mjs', LEG, LEG.replace('const messages = []', 'const messages = []\nlet sessions = []').replace('return messages', 'return sessions.map((s) => s.messages)')).length === 1)

// ---- no gate flags an independent reference implementation
const flagged: string[] = []
for (const [name, [feat, ref]] of Object.entries(FX)) {
  const server = ref['server.mjs'], files = srcOnly(ref)
  const clients = Object.entries(ref).filter(([k]) => /^public\/.+\.js$/.test(k)).map(([, v]) => v)
  const a = routeFindings('server.mjs', server), b = contractRouteProblems('server.mjs', server, feat.acceptance, clients), c = statusReachability(files, feat.acceptance), d = persistenceProblems(files, feat.acceptance)
  const e = Object.entries(ref).flatMap(([k, v]) => syntaxProblems(k, v).map((m) => `${k}:${m}`))
  if (a.length || b.length || c.length || d.length || e.length) flagged.push(`${name}: routes=${JSON.stringify(a)} contract=${b.join('|')} status=${c.join()} persist=${d.join('|')} syntax=${e.join('|')}`)
}
check('R27_no_gate_flags_any_independent_reference_implementation_of_the_four_fixtures', flagged.length === 0, flagged.join('; '))
const baseRoot = makeChatApp(path.join(tmp(), 'base'))
void baseRoot

// ---- structured failure evidence
const TAP = (rows: [number, string, string][]) => rows.map(([n, name, msg]) => `not ok ${n} - ${name}\n  message: ${msg}`).join('\n') + '\n# tests 12\n# pass 10\n# fail 2\n'
const files = { ...Object.fromEntries(Object.entries(ALERT_REFERENCE).filter(([k]) => /\.(m?js|html)$/.test(k))) }
files['server.mjs'] = files['server.mjs'].replace("if (err instanceof AlertError) return reply(res, err.code, { error: err.message })\n", '')
const ev = buildEvidence({ output: TAP([[5, 'archiving works, is repeatable, and an archived alert cannot be marked read or unread (409)', 'archive=200{} again=200 read=400 unread=400'], [12, 'alerts and the id sequence persist in ALERTS_FILE across a restart', 'persisted=true all=[1,2]']]), acceptance: ALERT_FEATURE.acceptance, files })
check('R28_a_failing_check_is_parsed_and_classified_by_what_it_says_not_by_its_position', parseChecks(TAP([[5, 'x', 'a=1']])).length === 1 && ev.checks.map((c) => c.kind).join() === 'STATUS_MISMATCH,PERSISTENCE', ev.checks.map((c) => c.kind).join())
check('R29_a_status_mismatch_is_mapped_to_the_implicated_route_the_error_handler_and_the_thrower', ev.checks[0].facts.some((f) => /implicated route/.test(f)) && ev.checks[0].facts.some((f) => /error handler .* answers thrown errors with 400/.test(f)) && ev.queue[0].key.startsWith('status:map'), ev.checks[0].facts.join(' | '))
check('R30_a_persistence_check_whose_storage_round_trip_is_fine_is_ordered_after_functional_failures_as_a_cascade', ev.queue.at(-1)!.key === 'persist:cascade' && ev.queue.at(-1)!.files.length > 0)
const startup = `file:///tmp/x/server.mjs:3\nimport { a, b } from './src/svc.mjs'\n         ^\nSyntaxError: The requested module './src/svc.mjs' does not provide an export named 'b'\n    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)\n`
const ev2 = buildEvidence({ output: TAP([[1, 'verification could not complete', "server exited: ModuleJob (node:internal"]]), acceptance: [], files: { 'server.mjs': "import { createServer } from 'node:http'\nimport { a, b } from './src/svc.mjs'\ncreateServer(() => {})\n", 'src/svc.mjs': 'export function a() {}\n' }, startupOutput: startup })
check('R31_a_server_that_does_not_start_names_the_module_that_lacks_the_export_not_the_importer', ev2.queue[0].key === 'export:src/svc.mjs:b' && ev2.queue[0].files[0] === 'src/svc.mjs', ev2.queue.map((h) => h.key).join())
const sp = await startupProbe(mkRoot({ 'server.mjs': "import { x } from './nope.mjs'\n" }))
check('R32_the_engine_reproduces_a_start_up_failure_with_the_full_error_output', !sp.started && /ERR_MODULE_NOT_FOUND|Cannot find module/.test(sp.output), sp.output.slice(0, 120))
check('R33_a_check_that_cannot_be_mapped_yields_no_hypotheses_so_the_analyst_path_is_used', buildEvidence({ output: TAP([[3, 'something odd', 'weird']]), acceptance: [], files: {} }).queue.length === 0)
void cpSync
finish()

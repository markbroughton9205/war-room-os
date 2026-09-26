/**
 * Phase 3 - automatic codebase context. Pure checks of the context engine plus textual assertions on the runtime wiring; the live behaviour is proven by the Phase 3 live proofs.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CONTEXT_LIMITS,
  buildIndex,
  callersOf,
  calleesOf,
  contentHash,
  contextDetails,
  contextNotes,
  debugSet,
  dependentsOf,
  describeContext,
  describeExpansion,
  discoverContext,
  expandFromEvidence,
  goalTerms,
  importsOf,
  indexFile,
  inContext,
  isSecretFile,
  isTestPath,
  layersFromContext,
  noteChanged,
  noteRead,
  noteSent,
  redactSecrets,
  refreshContext,
  resolveImport,
  minimalRevertSpan,
  restoreContext,
  staleEntries,
  symbolExcerpt,
  testsFor,
  updateIndex,
  type SourceFile,
} from './foundryProjectContext'
import { contextShouldOwn, readProjectSources } from './foundryProjectContextIO'
import { resolveWorkingPath } from './foundryEngineeringSpecialist'
import { resolveRepoRoot } from '@/lib/repo/paths'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const repo = resolveRepoRoot()
const fixtureRoot = (name: string) => path.join(repo, 'tmp/foundry-phase3/fixtures', name)
const AT = '2026-09-25T12:00:00.000Z'

const shop: SourceFile[] = [
  { path: 'shop/__init__.py', content: '' },
  { path: 'shop/pricing.py', content: 'import os\nfrom shop.tax import add_tax\n\nDISCOUNT_RATE = float(os.environ.get("DISCOUNT_RATE", "0.1"))\nAPI_TOKEN = os.getenv("PRICING_API_TOKEN", "abc123secret")\n\n\nclass Cart:\n    def total(self, items):\n        return order_total(items)\n\n\ndef order_total(items):\n    total = sum(i["price"] * i["qty"] for i in items)\n    return add_tax(total)\n\n\ndef apply_coupon(total, code):\n    return total\n' },
  { path: 'shop/tax.py', content: 'from shop.rounding import round_money\n\n\ndef add_tax(amount):\n    return round_money(amount * 1.2)\n' },
  { path: 'shop/rounding.py', content: 'def round_money(x):\n    return int(x)\n' },
  { path: 'shop/checkout.py', content: 'from shop.pricing import order_total, apply_coupon\n\n\ndef place_order(cart, code=None):\n    total = order_total(cart)\n    return apply_coupon(total, code)\n' },
  { path: 'shop/reports.py', content: 'def sales_report(rows):\n    return len(rows)\n' },
  { path: 'tests/test_flow.py', content: 'import unittest\nfrom shop.checkout import place_order\n\n\nclass T(unittest.TestCase):\n    def test_a(self):\n        self.assertEqual(place_order([{"price": 10, "qty": 2}], "SAVE10"), 21.6)\n' },
  { path: 'tests/test_reports.py', content: 'from shop.reports import sales_report\n' },
  { path: '.env.example', content: 'DISCOUNT_RATE=0.1\nPRICING_API_TOKEN=\n' },
  { path: '.env', content: 'PRICING_API_TOKEN=supersecretvalue\n' },
]

async function main() {
  const idx = buildIndex(shop)
  const ctx = discoverContext(idx, 'Support coupon codes when computing the order total at checkout', AT)

  // ---- A. relevant-file discovery from the goal alone
  const paths = ctx.entries.map(e => e.path)
  check('A_discovery_finds_the_implementation_the_consumer_and_the_test_without_being_told_any_file', paths.includes('shop/pricing.py') && paths.includes('shop/checkout.py') && paths.includes('tests/test_flow.py'), paths.join(','))
  check('A_unrelated_code_and_its_test_are_left_out', !paths.includes('shop/reports.py') && !paths.includes('tests/test_reports.py'), '')
  check('A_every_entry_has_an_explainable_reason', ctx.entries.every(e => e.reasons.length > 0 && e.reasons.every(r => r.length > 3)), JSON.stringify(ctx.entries.map(e => e.reasons[0])))
  check('A_roles_follow_dependency_direction', ctx.entries.find(e => e.path === 'shop/pricing.py')?.role === 'implementation' && ctx.entries.find(e => e.path === 'shop/checkout.py')?.role === 'consumer', '')
  check('A_layers_come_from_the_roles_not_from_directory_names', JSON.stringify(layersFromContext(ctx)) === JSON.stringify({ contract: [], backend: ['shop/pricing.py', 'shop/tax.py'], frontend: ['shop/checkout.py'], tests: ['tests/test_flow.py'], database: [] }), JSON.stringify(layersFromContext(ctx)))
  check('A_confidence_is_high_only_with_code_and_a_test', ctx.confidence === 'high' && discoverContext(idx, 'zzzz qqqq wwww', AT).confidence === 'low', '')
  check('A_a_file_named_in_the_goal_says_you_named_it', discoverContext(idx, 'Change shop/reports.py so it counts refunds', AT).entries.find(e => e.path === 'shop/reports.py')?.reasons.includes('you named it') === true, '')
  check('A_goal_terms_drop_filler_and_stem', goalTerms('Please add support for coupons when computing totals').join() === 'coupon,comput,total' || (goalTerms('Please add support for coupons when computing totals').includes('coupon') && !goalTerms('Please add support for coupons').includes('please')), goalTerms('Please add support for coupons when computing totals').join())

  // ---- bounded, not a repository dump
  const many: SourceFile[] = [...shop]
  for (let i = 0; i < 220; i += 1) many.push({ path: `bulk/mod_${i}.py`, content: `def order_helper_${i}(x):\n    return x + ${i}\n` })
  const big = discoverContext(buildIndex(many), 'Support coupon codes when computing the order total at checkout', AT)
  check('B_the_working_set_is_bounded_on_a_large_project', big.entries.length <= CONTEXT_LIMITS.workingSet && big.entries.length >= 3, String(big.entries.length))
  check('B_no_entry_is_listed_twice', new Set(big.entries.map(e => e.path)).size === big.entries.length, '')
  check('B_the_index_never_holds_a_secret_file', !('.env' in idx.files) && isSecretFile('.env') && isSecretFile('config/.env.production') && !isSecretFile('.env.example') && isSecretFile('deploy/id_rsa') && isSecretFile('certs/server.pem'), Object.keys(idx.files).join())

  // ---- C. symbol awareness
  const py = indexFile({ path: 'app/views.py', content: 'from app.db import session\n\nMAX_ITEMS = 50\n\n\n@app.route("/items", methods=["GET"])\ndef list_items():\n    return []\n\n\nclass ItemService:\n    def create(self, name):\n        return name\n\n    def _hidden(self):\n        return None\n\n\nclass ItemSchema(BaseModel):\n    name: str\n' })
  check('C_python_symbols_have_kind_line_owner_and_route', py.symbols.some(s => s.name === 'list_items' && s.kind === 'route' && s.route === '/items') && py.symbols.some(s => s.name === 'create' && s.kind === 'method' && s.owner === 'ItemService') && py.symbols.some(s => s.name === 'MAX_ITEMS' && s.kind === 'constant') && py.symbols.some(s => s.name === 'ItemSchema' && s.kind === 'schema'), py.symbols.map(s => `${s.kind}:${s.name}@${s.line}`).join())
  check('C_symbol_ranges_close_at_the_next_definition', (() => { const s = py.symbols.find(x => x.name === 'list_items')!; return s.endLine >= s.line && s.endLine < 12 })(), '')
  const js = indexFile({ path: 'web/Cart.tsx', content: "import { total } from './money'\nexport function Cart(props) {\n  return null\n}\nexport const Badge = (p) => p\nconst LIMIT = 5\napp.get('/cart', handler)\nconst key = process.env.CART_KEY\nconst url = process.env.CART_URL || 'http://x'\n" })
  check('C_js_symbols_components_routes_and_env_are_found', js.symbols.some(s => s.name === 'Cart' && s.kind === 'component') && js.symbols.some(s => s.name === 'Badge' && s.kind === 'component') && js.symbols.some(s => s.kind === 'route' && s.route === '/cart') && js.env.some(e => e.name === 'CART_URL' && e.default === 'http://x') && js.env.some(e => e.name === 'CART_KEY' && e.secret), JSON.stringify(js.env))
  check('C_entries_carry_the_relevant_symbols_with_a_reason', (ctx.entries.find(e => e.path === 'shop/pricing.py')?.symbols ?? []).some(s => s.name === 'apply_coupon' && s.why.length > 3), '')
  const longSource = Array.from({ length: 200 }, (_, i) => (i === 100 ? 'def target():\n    return 1' : `x${i} = ${i}`)).join('\n')
  const excerpt = symbolExcerpt(longSource, [{ name: 'target', line: 101, endLine: 102 }])
  check('C_large_files_are_excerpted_by_symbol_and_small_files_stay_whole', excerpt.includes('def target()') && excerpt.length < longSource.length / 2 && symbolExcerpt('a = 1\nb = 2', [{ name: 'a', line: 1 }]) === 'a = 1\nb = 2', String(excerpt.length))

  // ---- D. dependency + caller/callee context
  const known = new Set(shop.map(f => f.path))
  check('D_imports_resolve_absolute_relative_and_index', resolveImport('shop/checkout.py', 'shop.pricing', 'py', known) === 'shop/pricing.py' && resolveImport('shop/checkout.py', '.pricing', 'py', known) === 'shop/pricing.py' && resolveImport('shop/checkout.py', 'os', 'py', known) === null && resolveImport('web/a.ts', './b', 'js', new Set(['web/b.ts'])) === 'web/b.ts' && resolveImport('web/a.ts', './lib', 'js', new Set(['web/lib/index.ts'])) === 'web/lib/index.ts', '')
  check('D_dependency_direction_is_known', importsOf(idx, 'shop/pricing.py').join() === 'shop/tax.py' && dependentsOf(idx, 'shop/tax.py').includes('shop/pricing.py') && dependentsOf(idx, 'shop/pricing.py').includes('shop/checkout.py'), dependentsOf(idx, 'shop/tax.py').join())
  check('D_changing_a_file_reaches_what_uses_it', dependentsOf(idx, 'shop/rounding.py').join() === 'shop/tax.py', '')
  const callers = callersOf(idx, 'order_total', 'shop/pricing.py')
  check('D_callers_name_the_file_and_the_enclosing_symbol', callers.some(c => c.path === 'shop/checkout.py' && c.symbols.includes('place_order')), JSON.stringify(callers))
  check('D_callees_name_what_a_symbol_calls_and_where_it_lives', calleesOf(idx, 'shop/pricing.py', 'order_total').some(c => c.name === 'add_tax' && c.path === 'shop/tax.py'), JSON.stringify(calleesOf(idx, 'shop/pricing.py', 'order_total')))
  const notes = contextNotes(ctx, idx)
  check('D_notes_for_the_model_are_symbol_level_bounded_and_mention_callers_callees_and_tests', notes.some(n => n.includes('used by shop/checkout.py')) && notes.some(n => n.includes('add_tax (shop/tax.py)')) && notes.some(n => /test/.test(n)) && notes.join(' ').length <= CONTEXT_LIMITS.notesChars + 200, notes.join(' | ').slice(0, 160))

  // ---- E. test linkage without trusting names
  check('E_tests_are_linked_by_import_and_by_going_through_a_consumer', testsFor(idx, 'shop/checkout.py').some(t => t.test === 'tests/test_flow.py' && t.how === 'imports') && testsFor(idx, 'shop/pricing.py').some(t => t.test === 'tests/test_flow.py' && t.how === 'through'), JSON.stringify(testsFor(idx, 'shop/pricing.py')))
  const stock = await readProjectSources(fixtureRoot('c-stock'))
  const stockCtx = discoverContext(buildIndex(stock), 'Refuse to reserve more stock than is available', AT)
  check('E_a_hidden_test_is_found_even_though_its_name_never_mentions_the_module', stockCtx.entries.some(e => e.path === 'tests/test_shelf_scenarios.py' && e.role === 'test') && !stockCtx.entries.some(e => e.path === 'tests/test_stock_labels.py'), stockCtx.entries.map(e => e.path).join())
  check('E_test_paths_are_recognised', isTestPath('tests/test_x.py') && isTestPath('web/a.test.ts') && isTestPath('pkg/tests/helpers.py') && !isTestPath('shop/pricing.py') && !isTestPath('tests/conftest.py'), '')

  // ---- F. config / env awareness, secret safe
  const details = contextDetails(ctx).join('\n')
  check('F_env_names_are_reported_with_non_secret_defaults', ctx.env.some(e => e.name === 'DISCOUNT_RATE' && e.default === '0.1' && !e.secret), JSON.stringify(ctx.env))
  check('F_secret_env_names_never_carry_their_values', ctx.env.some(e => e.name === 'PRICING_API_TOKEN' && e.secret && e.default === undefined) && !JSON.stringify(ctx).includes('abc123secret') && !details.includes('abc123secret') && !details.includes('supersecretvalue'), '')
  const tmpl = indexFile({ path: '.env.example', content: 'DISCOUNT_RATE=0.1\nSECRET_KEY=hunter2\n' })
  check('F_env_templates_yield_names_only', tmpl.env.map(e => e.name).join() === 'DISCOUNT_RATE,SECRET_KEY' && tmpl.env.every(e => e.default === undefined), '')
  check('F_redaction_removes_secret_assignments_and_token_shapes', !redactSecrets('API_KEY = "abcd1234efgh"').includes('abcd1234efgh') && !redactSecrets('token: sk-abcdefghijklmnopqrstuvwx').includes('sk-abcdefghij') && redactSecrets('LIMIT = "50"') === 'LIMIT = "50"', redactSecrets('API_KEY = "abcd1234efgh"'))

  // ---- G. changed-file awareness, staleness, refresh
  const edited = 'from shop.tax import add_tax\n\n\ndef order_total(items):\n    return add_tax(sum(i["price"] for i in items))\n\n\ndef apply_coupon(total, code):\n    return total * 0.9 if code == "SAVE10" else total\n'
  const before = ctx.entries.find(e => e.path === 'shop/pricing.py')!.hash
  check('G_staleness_is_a_hash_comparison_against_disk', staleEntries(ctx, { 'shop/pricing.py': contentHash(edited), 'shop/tax.py': idx.files['shop/tax.py'].hash }).join() === 'shop/pricing.py' && staleEntries(ctx, { 'shop/pricing.py': before }).length === 0, '')
  const idx2 = buildIndex(shop)
  const changed = updateIndex(idx2, [{ path: 'shop/pricing.py', content: edited }, { path: 'shop/tax.py', content: shop.find(f => f.path === 'shop/tax.py')!.content }])
  check('G_updating_the_index_reports_only_files_that_really_changed', changed.join() === 'shop/pricing.py', changed.join())
  const refreshed = refreshContext(noteChanged(ctx, 'shop/pricing.py', 1), idx2, changed, 'I changed it', AT, 1)
  check('G_refresh_recomputes_hash_and_symbols_and_records_why', refreshed.context.entries.find(e => e.path === 'shop/pricing.py')!.hash === contentHash(edited) && refreshed.refreshed.join() === 'shop/pricing.py' && refreshed.context.refreshes.some(r => r.file === 'shop/pricing.py' && r.reason === 'I changed it') && refreshed.context.changed.some(c => c.path === 'shop/pricing.py' && c.generation === 1), JSON.stringify(refreshed.context.refreshes))
  check('G_untouched_entries_are_not_refreshed', !refreshed.refreshed.includes('shop/checkout.py'), '')
  const withRead = noteRead(noteRead(ctx, 'shop/pricing.py', shop[1].content, 0), 'shop/pricing.py', edited, 1)
  check('G_reads_record_what_was_shown_so_a_stale_read_is_detectable', withRead.reads.length === 2 && withRead.reads[0].hash !== withRead.reads[1].hash && noteRead(withRead, 'shop/pricing.py', edited, 1).reads.length === 2, JSON.stringify(withRead.reads))

  // ---- H. bounded, evidence-driven expansion
  const region = await readProjectSources(fixtureRoot('e-region'))
  const regionIdx = buildIndex(region)
  const regionCtx = discoverContext(regionIdx, 'Charge Dutch customers correctly when totaling an invoice', AT)
  check('H_the_initial_set_does_not_hold_the_file_two_hops_away', !inContext(regionCtx, 'billing/rates.py') && inContext(regionCtx, 'billing/invoice.py') && inContext(regionCtx, 'billing/tax.py'), regionCtx.entries.map(e => e.path).join())
  const trace = `E\n======================================================================\nERROR: test_dutch (test_invoice.InvoiceTests.test_dutch)\nTraceback (most recent call last):\n  File "${fixtureRoot('e-region')}/tests/test_invoice.py", line 12, in test_dutch\n    invoice_total(LINES, "NL")\n  File "${fixtureRoot('e-region')}/billing/invoice.py", line 6, in invoice_total\n    return add_tax(net, region)\n  File "${fixtureRoot('e-region')}/billing/tax.py", line 5, in add_tax\n    return round(amount * (1 + rate_for(region)), 2)\n  File "${fixtureRoot('e-region')}/billing/rates.py", line 5, in rate_for\n    return RATES[region]\nKeyError: 'NL'\n`
  const grown = expandFromEvidence(regionCtx, regionIdx, { text: trace, root: fixtureRoot('e-region') }, AT, 1)
  check('H_the_failing_traceback_adds_exactly_the_file_it_goes_through_with_a_recorded_reason', grown.added.length === 1 && grown.added[0].path === 'billing/rates.py' && /goes through rate_for/.test(grown.added[0].reasons[0]) && grown.context.expansions.length === 1 && /rates\.py/.test(grown.context.expansions[0].evidence), JSON.stringify(grown.context.expansions))
  check('H_expansion_never_adds_a_file_twice', expandFromEvidence(grown.context, regionIdx, { text: trace, root: fixtureRoot('e-region') }, AT, 2).added.length === 0, '')
  const nameErr = expandFromEvidence(discoverContext(buildIndex(shop), 'Support coupon codes', AT), buildIndex(shop), { text: "NameError: name 'round_money' is not defined", root: '/x' }, AT, 1)
  check('H_a_name_an_error_mentions_leads_to_the_file_that_defines_it', nameErr.added.some(e => e.path === 'shop/rounding.py' && /defines round_money/.test(e.reasons[0])), JSON.stringify(nameErr.added.map(e => e.path)))
  const testHeader = expandFromEvidence({ ...regionCtx, entries: regionCtx.entries.filter(e => e.role !== 'test') }, regionIdx, { text: 'FAIL: test_dutch (test_invoice.InvoiceTests.test_dutch)\n', root: '/x' }, AT, 1)
  check('H_the_failing_test_file_joins_when_it_was_missing', testHeader.added.some(e => e.path === 'tests/test_invoice.py' && e.role === 'test'), '')
  check('H_evidence_that_names_only_known_files_adds_nothing', expandFromEvidence(regionCtx, regionIdx, { text: `File "${fixtureRoot('e-region')}/billing/tax.py", line 5, in add_tax`, root: fixtureRoot('e-region') }, AT, 1).added.length === 0, '')
  const crowded = { ...regionCtx, entries: Array.from({ length: CONTEXT_LIMITS.workingSetHardMax }, (_, i) => ({ ...regionCtx.entries[0], path: `x${i}.py` })) }
  check('H_the_hard_ceiling_holds', expandFromEvidence(crowded, regionIdx, { text: trace, root: fixtureRoot('e-region') }, AT, 1).added.length === 0, '')
  const manyFrames = Array.from({ length: 8 }, (_, i) => `File "/w/m${i}.py", line 1, in f${i}`).join('\n')
  const bulk = buildIndex(Array.from({ length: 8 }, (_, i) => ({ path: `m${i}.py`, content: `def f${i}():\n    pass\n` })))
  check('H_one_piece_of_evidence_adds_at_most_a_few_files', expandFromEvidence({ ...regionCtx, entries: [] }, bulk, { text: manyFrames, root: '/w' }, AT, 1).added.length <= CONTEXT_LIMITS.expansionPerEvidence, '')
  check('H_the_debugger_is_shown_the_code_and_a_test_with_ruled_out_files_last', debugSet(grown.context, ['billing/invoice.py'])[0] !== 'billing/invoice.py' && debugSet(grown.context).some(p => p.startsWith('tests/')), debugSet(grown.context).join())

  // ---- I. restart persistence
  const persisted = JSON.parse(JSON.stringify({ ...grown.context, changed: [{ path: 'billing/invoice.py', generation: 1 }], refreshes: refreshed.context.refreshes, reads: withRead.reads }))
  persisted.entries.push({ ...persisted.entries[0] }, { ...persisted.entries[1] })
  persisted.expansions.push({ ...persisted.expansions[0] })
  const restored = restoreContext(persisted)
  check('I_a_restored_context_keeps_entries_reasons_expansions_changes_reads', Boolean(restored) && restored!.entries.length === grown.context.entries.length && restored!.entries.every(e => e.reasons.length > 0) && restored!.expansions.length === 1 && restored!.changed.length === 1 && restored!.reads.length === 2, `${restored?.entries.length}/${grown.context.entries.length}`)
  check('I_duplicates_are_merged_never_repeated', new Set(restored!.entries.map(e => e.path)).size === restored!.entries.length, '')
  check('I_garbage_is_rejected_instead_of_trusted', restoreContext(null) === null && restoreContext({ version: 2 }) === null && restoreContext({ version: 1, entries: 'x' }) === null, '')
  check('I_restoring_twice_is_stable', JSON.stringify(restoreContext(JSON.parse(JSON.stringify(restored)))) === JSON.stringify(restored), '')

  // ---- J. commander-facing language
  const sentence = describeContext(ctx)
  check('J_the_summary_sounds_natural_and_carries_no_internals', /^I'm tracing /.test(sentence) && !/[0-9]|\/|_|SCORE|CONTEXT|SET_SIZE|EDGE|\.py/.test(sentence) && sentence.length < 200, sentence)
  const expSentence = describeExpansion(grown.context.expansions[0])
  check('J_an_expansion_says_why_in_plain_words', /rates/.test(expSentence) && /adding/.test(expSentence) && !/[0-9]|\/|_|\.py/.test(expSentence), expSentence)
  check('J_technical_detail_lives_in_the_details_not_the_sentence', details.includes('shop/pricing.py') && details.includes('implementation') && !sentence.includes('shop/pricing.py'), '')
  check('J_an_empty_result_is_honest', /couldn't find/.test(describeContext(discoverContext(idx, 'zzzz qqqq', AT))), '')

  // ---- K. ownership and the runtime wiring
  check('K_only_change_requests_that_discovery_can_ground_are_owned', await contextShouldOwn(fixtureRoot('a-coupon'), 'Support coupon codes when computing the order total at checkout') === true && await contextShouldOwn(fixtureRoot('a-coupon'), 'Fix the failing coupon test') === false && await contextShouldOwn(fixtureRoot('a-coupon'), 'Add status filtering to the coupon list') === false && await contextShouldOwn(fixtureRoot('a-coupon'), 'How do coupon codes work?') === false && await contextShouldOwn(fixtureRoot('a-coupon'), 'Do something with zzzz qqqq') === false, '')
  const runtime = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
  const specialist = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringSpecialist.ts'), 'utf8').replace(/\r\n/g, '\n')
  check('K_the_status_filter_fixture_keeps_its_own_path', runtime.includes("if (!isFilterShaped(request)) {") && runtime.includes("state.contextMode = 'CONVENTION'") && specialist.includes('must keep rows whose') && specialist.includes('if (input.generalMode) {'), '')
  check('K_context_is_discovered_stored_and_worded_at_the_start', ['discoverContext(await ensureIndex(), request', "state.contextMode = 'CONTEXT'", 'layersFromContext(found)', 'describeContext(state.context)', 'contextDetails(state.context)'].every(part => runtime.includes(part)), '')
  check('K_edits_refresh_from_disk_and_note_the_changed_file', runtime.includes("noteChanged(state.context!, edit.file, state.mutationGeneration)") && runtime.includes("refreshContextFiles([edit.file], 'I changed it')") && runtime.includes('readProjectFile(root, rel)'), '')
  check('K_specialists_are_shown_fresh_files_and_the_read_is_recorded', runtime.includes('await freshenForCall(files)') && runtime.includes('noteRead(state.context!, file, text, state.mutationGeneration)') && runtime.includes('it changed on disk since I last read it'), '')
  check('K_failures_grow_the_working_set_with_a_reason_and_a_plan_revision', runtime.includes('await expandContext(') && runtime.includes("revisePlanFor('CONTEXT_EXPANDED'") && runtime.includes('describeExpansion(expansion)'), '')
  check('K_failing_run_evidence_is_gathered_once_and_only_with_another_layer_to_blame', runtime.includes('await gatherContextEvidence()') && runtime.includes('codeFiles.length < 2 || state.commandsRun >= commandLimit()'), '')
  check('K_resume_restores_dedupes_and_checks_the_working_set_against_disk', runtime.includes("if (resuming && state.contextMode === 'CONTEXT')") && runtime.includes('restoreContext(state.context)') && runtime.includes('staleEntries(restored, onDisk)') && runtime.includes('it changed while the mission was stopped'), '')
  check('K_the_architect_is_the_context_engine_in_context_mode', runtime.includes("current.id === 'architect' && contextOn()"), '')
  check('K_a_baseline_run_gives_the_first_edit_real_failure_evidence', runtime.includes("state.checkpoints.includes('BASELINE')") && runtime.includes('Checking the tests before changing anything'), '')
  check('K_implementers_see_linked_tests_read_only', runtime.includes('contextTestExcerpts(files)') && specialist.includes('TEST (read only, never edit)'), '')
  check('K_no_change_needed_settles_instead_of_blocking_when_the_covering_tests_pass', runtime.includes("testsGreenAtCurrentGeneration(state)") && runtime.includes("'settled'") && runtime.includes('NO_CHANGE_NEEDED'), '')
  check('K_a_worker_path_with_a_leading_slash_is_the_same_file', resolveWorkingPath('/shop/pricing.py', new Map([['shop/pricing.py', '']])) === 'shop/pricing.py' && resolveWorkingPath('./shop/pricing.py', new Map([['shop/pricing.py', '']])) === 'shop/pricing.py' && resolveWorkingPath('/tmp/x/shop/pricing.py', new Map([['shop/pricing.py', '']])) === 'shop/pricing.py' && resolveWorkingPath('other.py', new Map([['shop/pricing.py', '']])) === 'other.py', '')
  const anchor = readFileSync(path.join(repo, 'lib/native-builder/foundryProjectContext.ts'), 'utf8')
  const route = readFileSync(path.join(repo, 'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts'), 'utf8').replace(/\r\n/g, '\n')
  check('K_a_context_owned_request_gets_model_driven_specialists_from_the_chat_route', route.includes('campaignShouldOwn(text) || await contextShouldOwn(resolveRepoRoot(), text)'), '')
  const good = 'def a(x):\n    return x * 2\n\n\ndef b(y):\n    return y\n'
  const bad = 'def a(x):\n    return x * 2\n\n\ndef b(y):\n    return -1\n'
  const span = minimalRevertSpan(bad, good)!
  check('L_a_revert_span_is_minimal_anchored_and_reproduces_the_snapshot', minimalRevertSpan(good, good) === null && Boolean(span) && span.end - span.start < bad.length && (bad.slice(0, span.start) + good.slice(span.start, good.length - (bad.length - span.end)) + bad.slice(span.end)) === good, JSON.stringify(span))
  check('L_the_runtime_snapshots_green_and_reverts_only_review_driven_breaks_within_a_bound', ['await snapshotGreen()', "state.reworkOrigin !== 'REVIEW'", '(state.reverts ?? 0) >= 2', "revisePlanFor('CHANGE_REVERTED'", 'await revertReviewDrivenBreak()', "state.reworkOrigin = 'REVIEW'", "state.reworkOrigin = 'TEST'"].every(part => runtime.includes(part)), '')
  check('L_the_revert_is_a_governed_edit_and_is_explained_in_plain_words', runtime.includes("reason: 'Put the file back to the version whose tests passed.'") && runtime.includes('that change broke passing tests, so I put the files back'), '')
  // ---- M. caller/callee context and config/env awareness on the live micro-fixtures
  const gFiles = await readProjectSources(fixtureRoot('g-callgraph'))
  const gIdx = buildIndex(gFiles)
  const gCtx = discoverContext(gIdx, 'Make the notices we send for alerts come out in capital letters', AT)
  const gNotes = contextNotes(gCtx, gIdx)
  check('M_the_caller_and_the_callee_of_the_implementation_are_named_with_their_files', gNotes.some(n => n.startsWith('notify/dispatch.py') && n.includes('used by notify/alerts.py:raise_alert') && n.includes('calls emphasize (notify/style.py)')), gNotes[0])
  check('M_caller_and_callee_files_carry_relevance_reasons', gCtx.entries.find(e => e.path === 'notify/alerts.py')?.reasons.some(r => /uses dispatch/.test(r)) === true && gCtx.entries.find(e => e.path === 'notify/style.py')?.reasons.some(r => /relies on emphasize/.test(r)) === true, '')
  const hFiles = await readProjectSources(fixtureRoot('h-config'))
  const hIdx = buildIndex(hFiles)
  const hCtx = discoverContext(hIdx, 'Greetings should shout when the shouting flag is on', AT)
  const hAll = JSON.stringify(hCtx) + contextDetails(hCtx).join('\n') + contextNotes(hCtx, hIdx).join('\n')
  check('M_a_secret_file_is_never_read_indexed_or_shown', !hFiles.some(f => f.path === '.env') && !('.env' in hIdx.files) && !hCtx.entries.some(e => e.path === '.env') && !hFiles.some(f => f.content.includes('FAKE-SECRET-VALUE')), hFiles.map(f => f.path).join())
  check('M_env_names_defaults_and_flags_come_from_code_template_and_schema_without_secret_values', hCtx.env.some(e => e.name === 'GREETING_STYLE' && e.default === 'plain') && hCtx.env.some(e => e.name === 'ENABLE_SHOUTING' && e.flag === true && e.default === 'false') && hCtx.env.some(e => e.name === 'SMTP_PASSWORD' && e.secret && e.default === undefined) && !hAll.includes('FAKE-SECRET-VALUE') && !hAll.includes('sk-FAKE') && !hAll.includes('hunter2'), JSON.stringify(hCtx.env))
  check('M_the_schema_and_the_template_join_as_config_entries_with_a_reason_and_only_names_reach_the_model', hCtx.entries.some(e => e.path === 'config/schema.json' && e.role === 'config' && /declares/.test(e.reasons[0])) && layersFromContext(hCtx).contract.every(p => !/schema\.json|\.env/.test(p)) && debugSet(hCtx).every(p => !/schema\.json|\.env/.test(p)), JSON.stringify(layersFromContext(hCtx)))
  check('M_a_json_schema_yields_only_declared_variables_not_nested_keys', indexFile({ path: 'c/schema.json', content: '{"variables":{"A_FLAG":{"type":"boolean","default":true},"API_KEY":{"default":"zzz"}},"other":{"default":1}}' }).env.map(e => e.name).join() === 'A_FLAG,API_KEY' && indexFile({ path: 'c/schema.json', content: '{"variables":{"API_KEY":{"default":"zzz"}}}' }).env[0].default === undefined, '')
  const sent = noteSent(hCtx, { role: 'BACKEND', task: 'backend', files: ['greeter/hello.py', 'greeter/hello.py'], notes: ['API_KEY = "abcd1234efgh"', 'plain note'] })
  check('M_what_a_specialist_was_given_is_recorded_redacted_and_bounded', sent.sent.length === 1 && sent.sent[0].files.length === 1 && !sent.sent[0].notes.join().includes('abcd1234efgh') && Array.from({ length: 12 }).reduce<typeof sent>(acc => noteSent(acc, { role: 'X', task: 't', files: [], notes: [] }), sent).sent.length === 8, '')
  check('M_the_summary_never_says_dot_env', !/\.env|schema\.json/.test(describeContext(hCtx)) && /environment template/.test(describeContext(hCtx)), describeContext(hCtx))
  check('M_the_runtime_records_what_each_specialist_call_was_given', runtime.includes("noteSent(state.context!, { role: current.role, task: current.id, files: shownExcerpts.map(item => item.file), notes: notesForCall })") && runtime.includes("entry.role !== 'test' && entry.role !== 'config'"), '')
  check('K_the_context_engine_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(anchor), '')
  const live = readFileSync(path.join(repo, 'lib/native-builder/foundryLiveProgress.ts'), 'utf8')
  check('K_an_expansion_is_a_real_replan_in_live_progress', live.includes("'CONTEXT_EXPANDED'"), '')

  const failed = results.filter(r => !r.pass)
  console.log(`PROJECT_CONTEXT_VALIDATION ${failed.length ? 'FAIL' : 'PASS'} ${results.length - failed.length}/${results.length}`)
  if (failed.length) process.exit(1)
}
main()

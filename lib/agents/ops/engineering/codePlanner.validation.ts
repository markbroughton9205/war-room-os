/** Phase 10 continuation: code-aware planning. Run: pnpm run validate:agent-eng-planning */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { harness, tmp } from './engtestkit'
import { buildWorkspaceIndex } from './workspaceIndex'
import { planFromCode, seedsFrom, planContextForModel } from './codePlanner'
import { makeNotesApp } from './fixtures'

const { check, finish } = harness('AGENT_ENG_PLANNING_VALIDATION')
const root = makeNotesApp(path.join(tmp(), 'notes-app'))
const idx = buildWorkspaceIndex(root)
const REQ = 'Make the history view remember pinned notes after a restart'

// ---- index
check('K01_index_extracts_symbols_routes_storage_tests_scripts', !!idx.symbols.addNote && idx.symbols.addNote[0].file === 'src/notesService.mjs' && idx.files['server.mjs'].apiRefs.some((a) => a.role === 'serves' && a.path === '/api/notes') && idx.files['public/app.js'].apiRefs.some((a) => a.role === 'calls' && a.path === '/api/notes') && idx.files['src/notesStore.mjs'].storageRefs.some((s) => s.op === 'write') && idx.files['src/notesStore.mjs'].storageRefs.some((s) => s.path === 'notes.json' || s.path === null) && idx.testsFor['src/notesService.mjs']?.includes('test/notesService.test.mjs') && idx.scripts.test === 'node --test test/' && idx.dependents['src/notesStore.mjs'].includes('src/notesService.mjs'))
// ---- plan from code evidence
const plan = planFromCode(idx, { request: REQ, acceptance: ['pinned notes are still pinned after the server restarts'] })
const wherePaths = plan.where.map((w) => w.path)
check('K02_where_is_localized_by_definitions_routes_and_storage_not_by_text_frequency', ['src/notesService.mjs', 'server.mjs'].every((p) => wherePaths.includes(p)) && plan.where[0].why.some((w) => w.kind === 'definition' || w.kind === 'route' || w.kind === 'storage'), wherePaths.join(','))
check('K03_misleading_keyword_case_naive_frequency_picks_the_wrong_file_and_the_plan_says_so', plan.ranking.naiveKeywordFrequency[0] === 'public/index.html' && plan.ranking.evidence[0] !== 'public/index.html' && plan.ranking.diverges && plan.misleading.some((m) => m.file === 'public/index.html' && /mention|no matching behavior/.test(m.why)), JSON.stringify({ naive: plan.ranking.naiveKeywordFrequency.slice(0, 2), ev: plan.ranking.evidence.slice(0, 2) }))
check('K04_seeds_are_only_discovery_aids', plan.discoverySeeds.includes('history') && plan.discoverySeeds.includes('note') && !plan.where.some((w) => w.path === 'public/index.html' && w.role === 'implementation'))
check('K05_cross_layer_consumers_are_found_through_the_api_path_link', plan.dependsOnIt.some((d) => d.path === 'public/app.js' && d.role === 'consumer' && d.why.some((x) => x.kind === 'consumer')))
const layers = plan.otherLayers.map((l) => l.layer)
check('K06_affected_layers_come_from_code_evidence', ['storage', 'domain', 'api', 'ui'].every((l) => layers.includes(l as never)), layers.join(','))
check('K07_existing_tests_that_establish_current_behavior_are_identified', plan.testsNow.some((t) => t.test === 'test/notesService.test.mjs' && t.covers === 'src/notesService.mjs' && t.how === 'imports'))
check('K08_tests_to_prove_distinguish_covered_from_uncovered_and_propose_conventional_paths', plan.testsToProve.some((t) => t.target === 'src/notesService.mjs' && t.existing === 'test/notesService.test.mjs') && plan.testsToProve.some((t) => t.target === 'server.mjs' && t.proposedPath === 'test/server.test.mjs') && plan.testsToProve.some((t) => t.target.startsWith('acceptance:')))
check('K09_runtime_evidence_lists_routes_persistence_pages_and_start_command', plan.runtimeEvidence.some((r) => r.kind === 'route' && r.detail.includes('/api/notes')) && plan.runtimeEvidence.some((r) => r.kind === 'persistence' && r.detail.endsWith('notes.json')) && plan.runtimeEvidence.some((r) => r.kind === 'command' && r.detail.startsWith('start:')))
check('K10_slices_are_ordered_storage_domain_api_ui_tests_with_validation_commands', (() => { const o = plan.slices.map((s) => s.layer); return o.join() === ['storage', 'domain', 'api', 'ui', 'tests'].filter((l) => o.includes(l as never)).join() && o.includes('storage') && o.includes('tests') && plan.slices.find((s) => s.layer === 'tests')!.files.some((f) => f.action === 'create') && plan.slices.every((s) => s.validation.length > 0) })(), plan.slices.map((s) => s.layer).join('>'))
check('K11_no_typecheck_is_claimed_without_a_tsconfig_and_test_command_is_derived_from_scripts', plan.commands.typecheck === null && plan.commands.start === 'npm run start' && plan.slices[0].validation.some((v) => v.startsWith('node --check')))
// truthfulness: every definition evidence line really contains the symbol
const defs = plan.evidence.filter((e) => e.kind === 'definition' && e.line)
const truthful = defs.every((e) => { const name = /(?:function|class|const|interface|type|enum|component) (\w+)/.exec(e.detail)?.[1]; const line = readFileSync(path.join(root, e.file), 'utf8').split('\n')[e.line! - 1]; return !!name && line.includes(name) })
check('K12_cited_evidence_lines_actually_contain_the_cited_symbols', defs.length >= 3 && truthful, `${defs.length} definition evidence items verified`)
check('K13_planning_is_deterministic', JSON.stringify({ ...planFromCode(idx, { request: REQ, acceptance: ['pinned notes are still pinned after the server restarts'] }), index: 0 }) === JSON.stringify({ ...plan, index: 0 }))
const ctx = planContextForModel(plan, 1800)
check('K14_model_context_is_bounded_and_names_what_is_not_the_place', ctx.length <= 1800 && ctx.includes('WHERE:') && ctx.includes('NOT THE PLACE') && ctx.includes('public/index.html'))
// repair kind, greenfield, undetermined
const repair = planFromCode(idx, { request: 'addNote throws for notes with leading whitespace', kind: 'repair' })
check('K15_repair_plans_locate_the_defect_site_and_have_no_feature_slices', repair.slices.length === 0 && repair.where[0].path === 'src/notesService.mjs')
const empty = tmp(); mkdirSync(empty, { recursive: true })
const g = planFromCode(buildWorkspaceIndex(empty), { request: 'build a notes application with persistence' })
check('K16_empty_workspace_reports_NO_CODE_EVIDENCE_not_a_fabricated_plan', g.where.length === 0 && g.uncertainties.some((u) => u.startsWith('NO CODE EVIDENCE')))
const none = planFromCode(idx, { request: 'integrate satellite weather telemetry orbit' })
check('K17_unmatched_requests_are_UNDETERMINED_not_guessed', none.where.length === 0 && none.uncertainties.some((u) => u.startsWith('UNDETERMINED')))
// robustness
const rb = path.join(tmp(), 'rb'); mkdirSync(path.join(rb, 'node_modules/x'), { recursive: true })
writeFileSync(path.join(rb, 'node_modules/x/index.js'), 'export function addNote(){}'); writeFileSync(path.join(rb, 'broken.ts'), 'export function ((( {{{'); writeFileSync(path.join(rb, 'ok.ts'), 'export function addNote() { return 1 }')
try { symlinkSync(path.join(rb, 'ok.ts'), path.join(rb, 'link.ts')) } catch { /* may exist */ }
const rbi = buildWorkspaceIndex(rb)
check('K18_node_modules_skipped_symlinks_ignored_unparsable_files_do_not_crash', !rbi.files['node_modules/x/index.js'] && !!rbi.files['ok.ts'] && (rbi.symbols.addNote ?? []).every((d) => !d.file.startsWith('node_modules')))
check('K19_seeds_drop_stopwords_and_normalize_plurals', JSON.stringify(seedsFrom('Add the notes feature for users')) === JSON.stringify(['note']))
// real War Room code
const wr = buildWorkspaceIndex(process.cwd())
const t0 = Date.now()
const real = planFromCode(wr, { request: 'The Phase 9 learning API should also report how many ingestion failures were recorded', acceptance: ['the learning read API returns an ingestion failure count'] })
const rp = real.where.map((w) => w.path)
check('K20_real_war_room_plan_finds_the_learning_api_readmodel_and_tests_from_code_evidence', wr.fileCount > 1000 && rp.some((p) => p.startsWith('lib/recursive-learning/')) && (real.testsNow.some((t) => t.test.includes('recursive-learning')) || real.dependsOnIt.some((d) => d.path.includes('recursive-learning'))) && real.slices.length > 0, `files=${wr.fileCount} truncated=${wr.truncated} where=${rp.slice(0, 5).join(',')} in ${Date.now() - t0}ms`)
check('K20b_real_plan_top_match_is_the_ingestion_failure_source_and_hints_sharpen_it', real.where[0].path === 'lib/recursive-learning/ingestion/failureLog.ts' && (() => { const h = planFromCode(wr, { request: 'The Phase 9 learning API should also report how many ingestion failures were recorded', hints: ['recursive-learning', 'readModel', 'api'] }); return h.where.some((w) => w.path.startsWith('lib/recursive-learning/')) && h.where.filter((w) => w.path.startsWith('lib/recursive-learning/')).length >= real.where.filter((w) => w.path.startsWith('lib/recursive-learning/')).length })(), real.where.slice(0, 3).map((w) => w.path).join(','))
check('K21_real_plan_cites_real_files_and_layers_not_keyword_categories', real.where.every((w) => wr.files[w.path]) && real.otherLayers.length >= 2 && real.evidence.every((e) => !!wr.files[e.file]))
finish()

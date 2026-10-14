import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HybridContextPhase, capabilityIntents, chunkFiles, exactItems, exactTerms, stepQuery } from './contextRetriever'
import { assessBrief, makeResearcher, researchTrigger } from './researchBrief'
import { CHAT_FEATURE, makeChatApp } from '@/lib/agents/ops/engineering/chatFixture'
import { TASK_FEATURE, makeTaskApp } from '@/lib/agents/ops/engineering/taskFixture'
import { ALERT_FEATURE, makeAlertApp } from '@/lib/agents/ops/engineering/alertFixture'
import { PAD_RELEVANT, padWorkspace } from '@/lib/agents/ops/engineering/paddedWorkspace'
import { buildWorkspaceIndex } from '@/lib/agents/ops/engineering/workspaceIndex'
import { planFromCode } from '@/lib/agents/ops/engineering/codePlanner'
import { asRelated, briefText, emptyContextStats, RETRIEVED_PER_STEP, type ResearchBrief } from '@/lib/agents/ops/engineering/contextPhase'
import { readdirSync, readFileSync } from 'node:fs'

let fails = 0
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ' ' + d}`); if (!ok) fails++ }

const FILES: Record<string, string> = {
  'src/lib/jsonFile.mjs': 'export function readJsonFile(file, fallback) { return fallback }\nexport function writeJsonAtomic(file, value) {}\n',
  'src/billing/tax.mjs': 'export function addVat(amount) { return amount * 1.2 }\n',
  'src/billing/invoice.mjs': 'export function invoiceTotal(lines) { return 0 }\n',
  'server.mjs': "import { x } from './src/a.mjs'\nconst route = '/api/sessions'\nconst file = process.env.CHAT_DATA_FILE\n",
  'src/other.mjs': "// uses /api/sessions somewhere\nexport const z = 1\n",
  'node_modules/dep/index.js': 'module.exports = 1\n',
  'data/sessions.json': '[]',
  'package-lock.json': '{}',
  'test/a.test.mjs': 'test("/api/sessions")\n',
}
// ---- chunking and exact terms
{
  const c = chunkFiles(FILES)
  check('R01_chunking_skips_dependencies_data_and_lock_files_and_prefixes_the_path', !c.some((x) => /node_modules|data\/|package-lock/.test(x.file)) && c.every((x) => x.text.startsWith(`// file: ${x.file}`)) && c.some((x) => x.file === 'src/billing/tax.mjs'))
  const long = { 'a.mjs': Array.from({ length: 100 }, (_, i) => `const v${i} = ${i}`).join('\n') }
  check('R02_a_long_file_is_split_into_45_line_chunks', chunkFiles(long).length === 3)
  const t = exactTerms('Add persistent sessions', ['POST /api/sessions creates one', 'the data file path comes from the CHAT_DATA_FILE environment variable', 'keep `listMessages` working', 'update public/app.js'])
  check('R03_exact_terms_find_routes_env_vars_quoted_names_and_files', t.includes('/api/sessions') && t.includes('CHAT_DATA_FILE') && t.includes('listMessages') && t.includes('app.js'), t.join(','))
}
// ---- exact / definition pass
{
  const terms = ['/api/sessions', 'CHAT_DATA_FILE', 'readJsonFile']
  const items = exactItems(FILES, terms, 'src/new.mjs')
  check('R04_a_file_that_defines_a_named_symbol_ranks_above_a_file_that_merely_contains_a_term', items[0].path === 'src/lib/jsonFile.mjs' && items[0].method === 'DEFINITION' && items.some((i) => i.method === 'EXACT'))
  check('R05_tests_dependencies_the_step_file_itself_and_manifests_are_never_retrieved', !items.some((i) => /^test\/|node_modules|package/.test(i.path)) && !exactItems(FILES, terms, 'src/lib/jsonFile.mjs').some((i) => i.path === 'src/lib/jsonFile.mjs'))
  check('R06_every_item_says_why_it_was_retrieved', items.every((i) => i.why.length > 8))
}
// ---- the hybrid phase with a deterministic fake embedder
const STEPS = [{ id: 's1', path: 'src/store.mjs', layer: 'storage', title: 'storage: create src/store.mjs', note: 'persist records to disk' }, { id: 's2', path: 'server.mjs', layer: 'api', title: 'api: modify server.mjs', note: 'routes' }]
// the fake embedder maps text to a 3-d vector by topic words so ranking is predictable
const topic = (t: string) => { const l = t.toLowerCase(); return [/(json|disk|persist|file)/.test(l) ? 1 : 0, /(vat|invoice|tax)/.test(l) ? 1 : 0, /(route|http|api)/.test(l) ? 1 : 0.05] }
const calls: string[][] = []
const fake = async (inputs: string[]) => { calls.push(inputs); return inputs.map(topic) }
{
  const cache = new Map<string, number[]>()
  const ph = new HybridContextPhase({ embed: fake, cache })
  const r = await ph.prepare({ request: 'Add persistent records stored on disk', acceptance: ['records are written to a json file'], steps: STEPS, files: FILES })
  const pk = r.packages['src/store.mjs']
  check('R10_the_storage_step_gets_the_json_file_helper_and_not_the_billing_modules', pk.some((i) => i.path === 'src/lib/jsonFile.mjs') && !pk.some((i) => /billing/.test(i.path)), JSON.stringify(pk.map((i) => [i.path, i.method])))
  check('R11_one_batched_embedding_call_covers_all_chunks_and_all_step_queries', calls.length === 1 && calls[0].length === chunkFiles(FILES).length + STEPS.length + capabilityIntents('Add persistent records stored on disk', ['records are written to a json file']).length && /embedded|batched/.test(String(r.report.embedding)))
  check('R12_the_package_is_bounded_per_step', Object.values(r.packages).every((p) => p.length <= RETRIEVED_PER_STEP))
  const r2 = await new HybridContextPhase({ embed: fake, cache }).prepare({ request: 'Add persistent records stored on disk', acceptance: ['records are written to a json file'], steps: STEPS, files: FILES })
  check('R13_a_second_run_reuses_cached_chunk_embeddings_and_embeds_only_the_queries', calls.at(-1)?.length === STEPS.length + capabilityIntents('Add persistent records stored on disk', ['records are written to a json file']).length && r2.report.cacheHits === chunkFiles(FILES).length)
  const noEmb = await new HybridContextPhase({ embed: null }).prepare({ request: 'Use /api/sessions and CHAT_DATA_FILE', acceptance: [], steps: STEPS, files: FILES })
  check('R14_without_an_embedder_exact_search_still_works_and_the_report_says_so', noEmb.report.embedding === 'not used' && noEmb.packages['src/store.mjs'].some((i) => i.method === 'EXACT' || i.method === 'DEFINITION'))
  const boom = await new HybridContextPhase({ embed: async () => { throw new Error('runtime down') } }).prepare({ request: 'Use /api/sessions', acceptance: [], steps: STEPS, files: FILES })
  check('R15_an_embedding_failure_falls_back_to_exact_search_and_is_logged_not_thrown', /FAILED: runtime down/.test(String(boom.report.embedding)) && boom.packages['src/store.mjs'].length > 0)
  const none = await new HybridContextPhase({ embed: async (x) => x.map(() => [0, 0, 0]) }).prepare({ request: 'zzz', acceptance: [], steps: STEPS, files: FILES })
  check('R16_semantic_hits_below_the_similarity_floor_are_not_added', Object.values(none.packages).every((p) => p.every((i) => i.method !== 'EMBEDDING')))
  check('R17_the_embedding_model_only_returns_context_no_decisions_are_in_the_result_type', Object.keys(r).sort().join() === 'brief,packages,report')
  check('R18_stepQuery_is_bounded_and_mentions_the_step', stepQuery('x'.repeat(2000), ['a'.repeat(900)], STEPS[0]).length <= 640 && stepQuery('req', [], STEPS[0]).includes('src/store.mjs'))
}
// ---- capability intents derived from the contract by fixed rules
{
  const it = capabilityIntents('Add persistent sessions', ['POST /api/sessions rejects an empty name (400)', 'sessions survive a restart', 'each has an id', 'node tests cover the service'])
  check('R19_the_contract_yields_storage_identifier_validation_http_test_and_convention_intents', ['storage', 'identifiers', 'validation', 'http', 'tests', 'conventions'].every((id) => it.some((x) => x.id === id)))
  check('R19b_a_contract_with_no_such_needs_still_gets_the_conventions_intent_only', capabilityIntents('Change the page title', ['the title reads Hello']).map((x) => x.id).join() === 'conventions')
}
// ---- research: trigger, assessment, researcher
{
  const quiet = researchTrigger('Add persistent sessions', ['sessions are stored'], FILES)
  check('R20_no_research_is_triggered_when_the_contract_needs_nothing_the_workspace_lacks', !quiet.fire)
  const tech = researchTrigger('Export the report as csv', ['download a csv file'], FILES)
  check('R21_a_technology_the_workspace_never_uses_does_not_trigger_research_without_material_to_brief_from', !tech.fire)
  const doc = 'Conventions: error responses use JSON objects. Persisted data is written with writeJsonAtomic. Ids are numeric strings and are never reused. Handlers use sendJson. Tests use node:test and cover one behaviour each. '.repeat(3)
  const short = researchTrigger('Add persisted records with ids and error responses', ['ids are numeric strings', 'error responses are json'], { ...FILES, 'docs/CONVENTIONS.md': doc })
  check('R22a_short_overlapping_documentation_is_handed_to_the_builder_not_briefed', !short.fire && short.reasons.some((x) => /short enough/.test(x)))
  const longDoc = doc + ' Unrelated paragraph about office hours and parking. '.repeat(60)
  const withDoc = researchTrigger('Add persisted records with ids and error responses', ['ids are numeric strings', 'error responses are json'], { ...FILES, 'docs/CONVENTIONS.md': longDoc })
  check('R22_long_overlapping_documentation_triggers_research_with_that_source', withDoc.fire && withDoc.sources.includes('docs/CONVENTIONS.md'))
  const material = [{ path: 'docs/CONVENTIONS.md', text: doc }]
  const good = assessBrief({ text: '- Error responses are JSON objects [docs/CONVENTIONS.md]\n- Ids are numeric strings and are never reused [docs/CONVENTIONS.md]\n- Data is written with `writeJsonAtomic` [docs/CONVENTIONS.md]', sources: ['docs/CONVENTIONS.md'] }, 'Add persisted records with ids and error responses', ['ids are numeric strings'], material)
  check('R23_a_supported_on_topic_brief_is_relevant', good.relevant, good.reason)
  const unsupported = assessBrief({ text: '- Error responses use JSON objects [docs/CONVENTIONS.md]\n- The service must use `bcryptHash` with 12 rounds and 4096 bytes [docs/CONVENTIONS.md]', sources: [] }, 'Add persisted records with ids and error responses', ['ids are numeric strings'], material)
  check('R24_a_brief_with_claims_that_are_not_in_the_material_is_withheld', !unsupported.relevant && /UNSUPPORTED/.test(unsupported.reason), unsupported.reason)
  check('R25_a_brief_citing_a_source_nobody_supplied_is_withheld', /CITES_SOURCE/.test(assessBrief({ text: '- Error responses use JSON objects and numeric ids are never reused [docs/INVENTED.md]', sources: [] }, 'Add persisted records with ids and error responses', ['ids are numeric strings'], material).reason))
  const lenient = assessBrief({ text: '- Ids are numeric strings and are never reused; the function returns `null` when missing [docs/CONVENTIONS.md]\n- Error responses are JSON objects, see [acceptance criteria]', sources: [] }, 'Add persisted records with ids and error responses', ['ids are numeric strings'], material)
  check('R25b_code_literals_and_non_file_bracket_labels_are_not_treated_as_unsupported_claims_or_foreign_sources', lenient.relevant, lenient.reason)
  check('R26_an_off_topic_or_empty_brief_is_withheld', !assessBrief({ text: 'Sunny weather is expected over the weekend in many places and cities.', sources: [] }, 'Add persisted records with ids and error responses', ['ids'], material).relevant && !assessBrief({ text: 'ok', sources: [] }, 'x', [], material).relevant)
  const researcher = makeResearcher({ async generate() { return { ok: true, text: '- Ids are numeric strings and are never reused [docs/CONVENTIONS.md]\n- Error responses are JSON objects [docs/CONVENTIONS.md]', executor: { provider: 'ollama', model: 'qwen2.5-coder:7b' }, promptTokens: 1, outputTokens: 1, latencyMs: 5 } } }, 'qwen2.5-coder:7b')
  const ph = new HybridContextPhase({ embed: null, research: researcher })
  const rr = await ph.prepare({ request: 'Add persisted records with ids and error responses', acceptance: ['ids are numeric strings', 'error responses are json'], steps: STEPS, files: { ...FILES, 'docs/CONVENTIONS.md': longDoc } })
  check('R27_the_phase_asks_the_researcher_only_when_triggered_and_records_provenance', !!rr.brief && rr.brief.model === 'ollama:qwen2.5-coder:7b' && rr.brief.relevance.relevant && rr.brief.sources.includes('docs/CONVENTIONS.md') && !!rr.report.research)
  const liar = makeResearcher({ async generate() { return { ok: true, text: '- Ids are numeric strings and never reused [docs/INVENTED.md]\n- Error responses are JSON objects [docs/CONVENTIONS.md]', executor: { provider: 'ollama', model: 'm' }, promptTokens: 1, outputTokens: 1, latencyMs: 1 } } }, 'm')
  const lb = await liar({ request: 'Add persisted records with ids and error responses', acceptance: ['ids are numeric strings'], trigger: { fire: true, reasons: [], topic: 't', sources: [] }, material })
  check('R27b_invented_file_citations_are_counted_and_stripped_and_the_real_source_is_attached_by_foundry', lb.inventedCitations === 1 && !/INVENTED/.test(lb.text) && /Source: docs\/CONVENTIONS\.md \(attached by Foundry\)/.test(lb.text) && lb.relevance.relevant, JSON.stringify([lb.inventedCitations, lb.relevance, lb.text.slice(0, 160)]))
  // retrieval-driven trigger: long documentation that search surfaces for a step is briefed even when the word overlap is small
  const guideText = ('# Service conventions\nNew record ids come from nextNumericId. Data is written with writeJsonAtomic. ' + 'Unrelated paragraph about parking and meeting rooms. '.repeat(80))
  const rt = await new HybridContextPhase({ embed: async (x) => x.map((t) => (/Service conventions/.test(t) || /conventions/i.test(t) ? [1, 0, 0] : [0, 0, 1])), research: researcher }).prepare({ request: 'Add widgets', acceptance: ['widgets are stored'], steps: STEPS, files: { ...FILES, 'docs/GUIDE.md': guideText } })
  check('R27c_long_documentation_surfaced_by_retrieval_triggers_research_even_without_word_overlap', !!rt.brief && (rt.report.researchTrigger as { reasons: string[] }).reasons.some((x) => /retrieval surfaced long documentation docs\/GUIDE\.md/.test(x)), JSON.stringify(rt.report.researchTrigger))
  const calls2: number[] = []; const counting = makeResearcher({ async generate() { calls2.push(1); return { ok: false as const, detail: 'x', executor: { provider: 'ollama', model: 'm' } } } }, 'm')
  const q = await new HybridContextPhase({ embed: null, research: counting }).prepare({ request: 'Add persistent sessions', acceptance: ['sessions are stored'], steps: STEPS, files: FILES })
  check('R28_the_researcher_is_not_called_when_nothing_triggers_it', calls2.length === 0 && q.brief === null)
  const failed = await makeResearcher({ async generate() { return { ok: false as const, detail: 'timeout', executor: { provider: 'ollama', model: 'm' } } } }, 'm')({ request: 'r', acceptance: [], trigger: { fire: true, reasons: [], topic: 't', sources: [] }, material })
  check('R29_a_failed_research_call_yields_a_withheld_brief_not_an_exception', !failed.relevance.relevant && /RESEARCH_MODEL_FAILED/.test(failed.relevance.reason) && briefText(failed) === undefined)
  const b: ResearchBrief = { id: 'x', topic: 't', text: 'y'.repeat(5000), model: 'm', sources: [], relevance: { relevant: true, reason: 'ok' }, ms: 1 }
  check('R30_the_brief_given_to_the_builder_is_capped', (briefText(b) ?? '').length === 1200)
}
// ---- context formatting + stats
{
  const rel = asRelated([{ path: 'a.mjs', text: 'x'.repeat(5000), method: 'EXACT', why: 'contains /api/x', score: 1 }])
  check('R31_retrieved_items_are_labelled_and_truncated_inside_related_code', /retrieved by exact search: contains \/api\/x; advisory, the acceptance criteria win/.test(rel[0].path) && rel[0].text.length === 1800 && emptyContextStats().builderPromptCalls === 0)
}
// ---- the padded workspace
{
  const roots = [['chat', makeChatApp, CHAT_FEATURE], ['task', makeTaskApp, TASK_FEATURE], ['alert', makeAlertApp, ALERT_FEATURE]] as const
  for (const [name, make, feature] of roots) {
    const a = mkdtempSync(path.join(tmpdir(), 'pad-a-')), b = mkdtempSync(path.join(tmpdir(), 'pad-b-'))
    make(a); make(b); const added = padWorkspace(b)
    const planOf = (root: string) => { const p = planFromCode(buildWorkspaceIndex(root), { request: feature.request, acceptance: feature.acceptance, hints: feature.hints, kind: 'feature' }); return JSON.stringify(p.slices.map((s) => [s.layer, s.files.map((f) => f.path + ':' + f.action)])) }
    check(`R40_${name}_plan_is_identical_with_and_without_the_padding`, planOf(a) === planOf(b), planOf(a) + ' vs ' + planOf(b))
    if (name === 'chat') check('R41_the_padding_adds_35_files_including_the_five_relevant_ones', added.added.length === 35 && PAD_RELEVANT.every((r) => added.added.includes(r)), String(added.added.length))
    rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
  }
  const g = mkdtempSync(path.join(tmpdir(), 'pad-g-')); const lg = padWorkspace(g, { longGuide: true })
  const guide = readFileSync(path.join(g, 'docs/PLATFORM_GUIDE.md'), 'utf8')
  check('R43_the_long_guide_variant_swaps_the_short_conventions_for_a_long_guide_that_still_holds_them', lg.added.length === 35 && !lg.added.includes('docs/CONVENTIONS.md') && guide.length > 3000 && /nextNumericId/.test(guide) && !/numeric strings/.test(guide) && lg.relevant.includes('docs/PLATFORM_GUIDE.md'), String(guide.length))
  const trig = researchTrigger('Add persisted records with ids', ['ids are numeric strings', 'error responses are json', 'data is written to a file'], { 'docs/PLATFORM_GUIDE.md': guide })
  check('R44_the_long_guide_triggers_research_and_the_short_conventions_do_not', trig.fire && trig.sources.includes('docs/PLATFORM_GUIDE.md'))
  rmSync(g, { recursive: true, force: true })
  const d = mkdtempSync(path.join(tmpdir(), 'pad-c-')); padWorkspace(d)
  const code = readdirSync(path.join(d, 'src'), { recursive: true }).filter((f) => String(f).endsWith('.mjs'))
  check('R42_the_padding_is_deterministic_and_valid_javascript', code.length >= 30 && code.every((f) => { try { new Function(readFileSync(path.join(d, 'src', String(f)), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')); return true } catch { return false } }))
  rmSync(d, { recursive: true, force: true })
}

console.log(`FORGE_CONTEXT_VALIDATION ${fails ? 'FAIL (' + fails + ')' : 'PASS'}`)
process.exit(fails ? 1 : 0)

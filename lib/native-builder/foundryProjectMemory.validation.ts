/**
 * Phase 4 - engineering memory. Pure checks of the memory engine and its file store, plus textual assertions on the runtime wiring. The live behaviour is proven
 * by the Phase 4 live proofs. Fixtures are committed with the Foundry source (never read from tmp/).
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildIndex, discoverContext, isSecretFile, type ProjectIndex, type SourceFile } from './foundryProjectContext'
import { readProjectSources } from './foundryProjectContextIO'
import {
  MEMORY_LIMITS,
  causeFilesOf,
  causeSuggestions,
  checkWriteEligibility,
  describeIgnoredMemory,
  describeMemoryUse,
  emptyStore,
  failureMatches,
  identityStatus,
  makeIdentity,
  memoriesFromMission,
  memoryDetails,
  memoryNotes,
  mergeMemories,
  restoreStore,
  retrieveMemories,
  revalidateStore,
  safeText,
  unrelatedCandidates,
  type EngineeringMemory,
  type FailureKey,
  type MemoryStore,
  type MissionMemoryInput,
} from './foundryProjectMemory'
import { listTopLevelNames, loadMemory, memoryPath, saveMemory } from './foundryProjectMemoryIO'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { spawnSync } from 'node:child_process'
import { plainOutputEnv } from './foundryEngineeringRuntime'

type Result = { name: string; pass: boolean; detail: string }
const results: Result[] = []
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`.trimEnd()) }

const repo = resolveRepoRoot()
const FIXTURES = 'lib/native-builder/__fixtures__/foundry-phase4'
const AT = '2026-09-26T12:00:00.000Z'
const LATER = '2026-09-27T12:00:00.000Z'

async function fixture(name: string, overlay?: string): Promise<SourceFile[]> {
  const files = await readProjectSources(path.join(repo, FIXTURES, name))
  if (!overlay) return files
  const dir = path.join(repo, FIXTURES, `${name}.${overlay}`)
  const out = new Map(files.map(file => [file.path, file.content]))
  const walk = (d: string, rel = '') => {
    for (const entry of readdirSync(d)) {
      const abs = path.join(d, entry)
      const r = rel ? `${rel}/${entry}` : entry
      if (statSync(abs).isDirectory()) { walk(abs, r); continue }
      const target = r.replace(/\.append$/, '')
      const text = readFileSync(abs, 'utf8')
      out.set(target, r.endsWith('.append') ? (out.get(target) ?? '') + text : text)
    }
  }
  walk(dir)
  return [...out.entries()].map(([p, content]) => ({ path: p, content }))
}

const ID = makeIdentity({ root: '/p/one', projectId: 'aaaaaaaa-1111' })
const KEY: FailureKey = { exception: 'KeyError', tests: ['test_dutch'], frames: ['tests/test_invoice.py:test_dutch', 'billing/invoice.py:invoice_total', 'billing/tax.py:add_tax', 'billing/rates.py:rate_for'] }

function input(index: ProjectIndex, over: Partial<MissionMemoryInput> = {}): MissionMemoryInput {
  const context = discoverContext(index, 'Charge Dutch customers correctly when totaling an invoice', AT)
  return {
    mission: 'm1', session: 's1', at: AT, resolved: true, index, context, filesMutated: ['billing/invoice.py', 'billing/rates.py'], baseline: KEY,
    ruledOut: [], noEffect: [], reverted: [], greenFiles: ['billing/rates.py'], testCommand: 'python3 -m unittest discover -s tests', greenGeneration: 2, projectFiles: ['pnpm-lock.yaml'], ...over,
  }
}

async function main() {
  const rates = buildIndex(await fixture('a-rates'))
  const base = input(rates)
  const written = memoriesFromMission(base)
  const kinds = (list: EngineeringMemory[]) => list.map(item => item.kind)
  const fix = written.find(item => item.kind === 'FIX_PATTERN')!

  // ---- A. writes need evidence, and only typed evidence
  check('A_a_verified_mission_writes_typed_durable_knowledge', ['FIX_PATTERN', 'PROJECT_FACT', 'VERIFICATION', 'WORKFLOW'].every(kind => kinds(written).includes(kind as never)) && written.every(item => item.scope === 'PROJECT' && item.status === 'VERIFIED' && item.evidence.length > 0), kinds(written).join(','))
  check('A_the_cause_is_the_edit_that_turned_the_tests_green_narrowed_to_the_raising_file', causeFilesOf(KEY, ['billing/invoice.py', 'billing/rates.py'], rates).join() === 'billing/rates.py' && causeFilesOf(KEY, ['billing/invoice.py'], rates).join() === 'billing/invoice.py' && causeFilesOf(KEY, [], rates).length === 0, '')
  check('A_a_changed_file_that_never_turned_tests_green_is_not_a_cause', (fix.detail as { causeFiles: string[] }).causeFiles.join() === 'billing/rates.py' && !(fix.detail as { causeFiles: string[] }).causeFiles.includes('billing/invoice.py'), JSON.stringify(fix.detail))
  check('A_no_green_evidence_means_no_fix_pattern', !kinds(memoriesFromMission(input(rates, { greenFiles: [] }))).includes('FIX_PATTERN'), '')
  check('A_a_fix_pattern_carries_the_failure_the_evidence_and_the_anchors', fix.failure?.exception === 'KeyError' && fix.evidence.some(e => e.type === 'TEST_PASS') && fix.evidence.some(e => e.type === 'TEST_FAIL') && fix.evidence.some(e => e.type === 'DISK_HASH') && fix.anchors.every(a => a.hash.length > 0) && fix.anchors[0].symbols.includes('rate_for'), JSON.stringify(fix.anchors))
  const speculative: EngineeringMemory = { ...fix, evidence: [] }
  check('A_speculation_without_evidence_is_refused', !checkWriteEligibility(speculative).ok, JSON.stringify(checkWriteEligibility(speculative)))
  check('A_evidence_of_the_wrong_type_is_refused', !checkWriteEligibility({ ...fix, evidence: fix.evidence.filter(e => e.type === 'DISK_HASH') }).ok, '')
  check('A_mission_scope_is_never_written_to_the_project_store', !checkWriteEligibility({ ...fix, scope: 'MISSION' }).ok, '')
  check('A_an_unanchored_or_secret_file_memory_is_refused', !checkWriteEligibility({ ...fix, anchors: [] }).ok && !checkWriteEligibility({ ...fix, files: ['.env'], anchors: [{ file: '.env', hash: 'h', symbols: [] }] }).ok, '')
  check('A_a_fix_pattern_must_name_a_file_the_fix_changed', !checkWriteEligibility({ ...fix, detail: { kind: 'FIX_PATTERN', causeFiles: ['billing/tax.py'], changedFiles: ['billing/rates.py'], verifiedBy: [] } }).ok, '')

  // ---- failed strategies
  const orders = buildIndex(await fixture('b-orders'))
  const orderInput = input(orders, {
    context: discoverContext(orders, 'Make the order report list every order for a status', AT), filesMutated: ['orders/repository.py', 'orders/report.py'],
    baseline: { exception: 'AssertionError', tests: ['test_report_lists_every_closed_order'], frames: ['tests/test_orders.py:test_report_lists_every_closed_order'] },
    ruledOut: [{ file: 'orders/repository.py', layer: 'backend', basis: 'EDIT' }], greenFiles: ['orders/report.py'],
  })
  const ordersWritten = memoriesFromMission(orderInput)
  const failed = ordersWritten.find(item => item.kind === 'FAILED_STRATEGY')
  check('B_a_recorded_ineffective_edit_becomes_a_failed_strategy_with_its_reason', Boolean(failed) && (failed!.detail as { file: string }).file === 'orders/repository.py' && failed!.evidence.some(e => e.type === 'EDIT_INEFFECTIVE') && failed!.anchors[0].hashSensitive === true && (failed!.detail as { causeFiles: string[] }).causeFiles.join() === 'orders/report.py', failed?.subject)
  check('B_the_verified_cause_is_never_also_a_failed_strategy', !memoriesFromMission({ ...orderInput, ruledOut: [{ file: 'orders/report.py', layer: 'frontend', basis: 'EDIT' }] }).some(item => item.kind === 'FAILED_STRATEGY'), '')
  check('B_a_no_op_and_a_revert_are_failed_strategies_too', kinds(memoriesFromMission({ ...orderInput, ruledOut: [], noEffect: [{ file: 'orders/repository.py', layer: 'backend', attempts: 2 }], reverted: ['orders/labels.py'] })).filter(k => k === 'FAILED_STRATEGY').length === 2, '')
  check('B_a_single_no_op_is_not_a_lesson', !kinds(memoriesFromMission({ ...orderInput, ruledOut: [], noEffect: [{ file: 'orders/repository.py', layer: 'backend', attempts: 1 }] })).includes('FAILED_STRATEGY'), '')
  const blocked = memoriesFromMission({ ...orderInput, resolved: false })
  check('B_an_unresolved_mission_leaves_only_session_scoped_lessons_and_no_verified_fix', blocked.every(item => item.kind === 'FAILED_STRATEGY' && item.scope === 'SESSION' && item.sessionId === 's1') && blocked.length === 1, kinds(blocked).join())
  check('B_a_durable_failed_strategy_needs_the_passing_test_that_resolved_the_mission', !checkWriteEligibility({ ...failed!, evidence: failed!.evidence.filter(e => e.type !== 'TEST_PASS') }).ok && checkWriteEligibility({ ...failed!, scope: 'SESSION', sessionId: 's1', evidence: failed!.evidence.filter(e => e.type !== 'TEST_PASS') }).ok, '')

  // ---- architectural decisions, tests, workflow, config
  const decision = ordersWritten.find(item => item.kind === 'DECISION')
  check('D_dependency_direction_is_a_decision_only_when_the_import_graph_proves_it', Boolean(decision) && (decision!.detail as { from: string; to: string }).from === 'orders/report.py' && (decision!.detail as { to: string }).to === 'orders/repository.py' && decision!.evidence[0].type === 'CONTEXT_LINK', decision?.subject)
  check('D_verification_knowledge_records_the_command_and_the_tests_that_cover_the_code', ordersWritten.some(item => item.kind === 'VERIFICATION' && (item.detail as { command: string }).command.includes('unittest') && item.tests.includes('tests/test_orders.py')), '')
  check('D_workflow_knowledge_comes_from_file_names_and_the_test_command', written.filter(item => item.kind === 'WORKFLOW').map(item => (item.detail as { note: string }).note).sort().join() === 'This project is tested with Python unittest,This project uses pnpm', '')
  check('D_facts_state_what_defines_consumes_and_covers_what', ordersWritten.some(item => item.detail.kind === 'PROJECT_FACT' && item.detail.claim === 'defines') && ordersWritten.some(item => item.detail.kind === 'PROJECT_FACT' && item.detail.claim === 'consumes') && ordersWritten.some(item => item.detail.kind === 'PROJECT_FACT' && item.detail.claim === 'covers'), '')
  check('D_writes_per_mission_are_bounded', memoriesFromMission(base).length <= MEMORY_LIMITS.writesPerMission, String(written.length))

  // ---- E. scope and identity
  const store0 = mergeMemories(emptyStore(ID, AT), written, AT)
  check('E_identity_is_the_project_id_when_there_is_one_else_the_root', ID.key === 'pid:aaaaaaaa-1111' && makeIdentity({ root: '/p/x', projectId: null }).key === 'root:/p/x', '')
  check('E_a_store_from_another_project_is_detected_as_a_material_change', identityStatus(store0, ID) === 'SAME' && identityStatus(store0, makeIdentity({ root: '/p/one', projectId: 'bbbbbbbb-2222' })) === 'CHANGED' && identityStatus(store0, makeIdentity({ root: '/p/two', projectId: null })) === 'CHANGED', '')
  const q = (over: Partial<Parameters<typeof retrieveMemories>[1]> = {}) => ({ sessionId: 's1', goal: 'unrelated words', files: [] as string[], symbols: [] as string[], tests: [] as string[], failure: null, ...over })
  check('E_session_notes_are_visible_only_to_their_own_session', (() => { const s = mergeMemories(emptyStore(ID, AT), blocked, AT); return retrieveMemories(s, q({ files: ['orders/repository.py'] })).hits.length === 1 && retrieveMemories(s, q({ sessionId: 's2', files: ['orders/repository.py'] })).hits.length === 0 })(), '')

  // ---- F. retrieval: relevant, bounded, gated
  check('F_goal_words_alone_retrieve_nothing', retrieveMemories(store0, q({ goal: 'Charge Dutch customers correctly when totaling an invoice' })).hits.length === 0, '')
  const byFile = retrieveMemories(store0, q({ files: ['billing/invoice.py', 'billing/tax.py'] }))
  check('F_a_file_link_retrieves_the_relevant_memories_only', byFile.hits.length > 0 && byFile.hits.every(hit => hit.links.length > 0 && hit.memory.files.some(file => ['billing/invoice.py', 'billing/tax.py', 'billing/rates.py'].includes(file))), byFile.hits.map(h => h.memory.kind).join())
  check('F_an_unrelated_file_retrieves_nothing', retrieveMemories(store0, q({ files: ['orders/labels.py'] })).hits.length === 0, '')
  const byFailure = retrieveMemories(store0, q({ files: ['billing/invoice.py'], failure: { exception: 'KeyError', tests: ['test_french'], frames: ['tests/test_invoice.py:test_french', 'billing/rates.py:rate_for'] } }))
  check('F_the_same_kind_of_failure_ranks_first_and_is_marked_as_such', byFailure.hits[0]?.memory.kind === 'FIX_PATTERN' && byFailure.hits[0].links.includes('failure'), byFailure.hits[0]?.links.join())
  check('F_failure_matching_needs_the_same_exception_and_a_shared_project_frame_or_test', failureMatches(fix.failure, { exception: 'KeyError', tests: ['x'], frames: ['billing/rates.py:rate_for'] }) === 'exact' && failureMatches(fix.failure, { exception: 'KeyError', tests: ['x'], frames: ['tests/t.py:x'] }) === 'related' && failureMatches(fix.failure, { exception: 'TypeError', tests: ['test_dutch'], frames: [] }) === null, '')
  const many = mergeMemories(emptyStore(ID, AT), Array.from({ length: 30 }, (_, i) => ({ ...store0.entries[0], id: `f-${i}`, files: ['billing/invoice.py'], lastVerified: `2026-09-26T12:00:${String(i).padStart(2, '0')}.000Z` })), AT)
  const bounded = retrieveMemories(many, q({ files: ['billing/invoice.py'] }))
  check('F_retrieval_is_bounded_in_count_and_note_size', bounded.hits.length <= MEMORY_LIMITS.retrieve && memoryNotes(bounded).join(' ').length <= MEMORY_LIMITS.noteChars + 250, String(bounded.hits.length))
  check('F_notes_are_marked_as_hints_to_check_against_the_source', memoryNotes(byFailure).every(line => /check it against SOURCE now/.test(line)), memoryNotes(byFailure)[0])
  check('F_a_fix_pattern_suggests_its_cause_file_only_for_the_same_failure_and_only_while_the_symbol_exists', causeSuggestions(byFailure, rates).map(item => item.file).join() === 'billing/rates.py' && causeSuggestions(byFile, rates).length === 0 && causeSuggestions(byFailure, buildIndex(rates ? (await fixture('a-rates')).map(f => f.path === 'billing/rates.py' ? { ...f, content: 'RATES = {}\n' } : f) : [])).length === 0, '')
  const withStrategy = mergeMemories(emptyStore(ID, AT), ordersWritten, AT)
  const related = retrieveMemories(withStrategy, q({ files: ['orders/repository.py', 'orders/report.py'], failure: { exception: 'AssertionError', tests: ['test_customer'], frames: ['tests/test_orders.py:test_customer'] } }), orders)
  check('F_a_failed_strategy_is_offered_for_fresh_verification_never_as_a_skip_on_its_own', unrelatedCandidates(related, orders, ['orders/repository.py', 'orders/report.py']).map(item => item.file).join() === 'orders/repository.py' && unrelatedCandidates(related, orders, ['orders/report.py']).length === 0, '')
  const editedOrders = buildIndex((await fixture('b-orders')).map(f => f.path === 'orders/repository.py' ? { ...f, content: f.content + '\n# edited\n' } : f))
  check('F_a_failed_strategy_is_not_offered_when_its_file_changed_since', unrelatedCandidates(related, editedOrders, ['orders/repository.py']).length === 0, '')

  // ---- G. stale detection, supersession, retirement (current code always wins)
  const coupon = buildIndex(await fixture('c-coupon'))
  const couponInput = input(coupon, { context: discoverContext(coupon, 'Support coupon codes when computing the order total at checkout', AT), filesMutated: ['shop/pricing.py'], baseline: { exception: 'AssertionError', tests: ['test_save10_takes_ten_percent_off'], frames: ['tests/test_flow.py:test_save10_takes_ten_percent_off'] }, greenFiles: ['shop/pricing.py'] })
  const couponStore = mergeMemories(emptyStore(ID, AT), memoriesFromMission(couponInput), AT)
  const moved = buildIndex(await fixture('c-coupon', 'm2'))
  const rev = revalidateStore(couponStore, moved, LATER, 'm2')
  const defines = rev.store.entries.find(item => item.detail.kind === 'PROJECT_FACT' && item.detail.claim === 'defines' && item.detail.symbol === 'apply_coupon')!
  check('G_a_symbol_that_moved_supersedes_the_fact_and_says_where_it_lives_now', defines.status === 'SUPERSEDED' && /coupons\.py/.test(defines.supersededBy ?? '') && defines.history.at(-1)?.why.includes('shop/coupons.py') === true, defines.supersededBy)
  check('G_a_fix_pattern_about_a_moved_symbol_is_superseded_too', rev.store.entries.filter(item => item.kind === 'FIX_PATTERN').every(item => item.status === 'SUPERSEDED'), rev.store.entries.filter(item => item.kind === 'FIX_PATTERN').map(item => item.status).join())
  check('G_facts_the_code_still_supports_stay_verified', rev.store.entries.filter(item => item.detail.kind === 'PROJECT_FACT' && item.detail.claim === 'defines' && item.detail.symbol === 'order_total').every(item => item.status === 'VERIFIED'), '')
  check('G_every_status_change_is_recorded_with_its_reason_and_mission', rev.changed.length > 0 && rev.store.entries.filter(item => item.status !== 'VERIFIED').every(item => item.history.length >= 2 && item.history.at(-1)!.mission === 'm2' && item.history.at(-1)!.why.length > 5), `${rev.changed.length} changes`)
  const after = retrieveMemories(rev.store, q({ files: ['shop/pricing.py', 'shop/coupons.py'], symbols: ['apply_coupon'] }), moved)
  check('G_superseded_memory_is_never_used_as_guidance_but_is_reported_as_ignored', after.hits.every(hit => hit.memory.status === 'VERIFIED') && after.ignored.length > 0 && !causeSuggestions(after, moved).length, after.ignored.map(item => item.memory.kind).join())
  check('G_the_commander_hears_it_was_ignored_in_plain_words', /^That earlier (fix|note|lesson) no longer matches the current code, so I'm ignoring it and rebuilding the plan from the repository as it is now\.$/.test(describeIgnoredMemory(after) ?? ''), describeIgnoredMemory(after) ?? '')
  const gone = revalidateStore(couponStore, buildIndex((await fixture('c-coupon')).filter(f => f.path !== 'shop/pricing.py')), LATER, 'm3')
  check('G_a_deleted_file_retires_what_was_anchored_to_it', gone.store.entries.filter(item => item.anchors.some(a => a.file === 'shop/pricing.py')).every(item => item.status === 'RETIRED'), '')
  const strategyStore = mergeMemories(emptyStore(ID, AT), ordersWritten, AT)
  const changedRepo = revalidateStore(strategyStore, editedOrders, LATER, 'm2')
  check('G_a_failed_strategy_holds_only_while_its_file_is_unchanged', changedRepo.store.entries.find(item => item.kind === 'FAILED_STRATEGY')!.status === 'STALE' && revalidateStore(strategyStore, orders, LATER, 'm2').store.entries.find(item => item.kind === 'FAILED_STRATEGY')!.status === 'VERIFIED', '')
  const noChange = revalidateStore(store0, rates, LATER, 'm2')
  check('G_an_unchanged_project_changes_nothing_but_last_verified', noChange.changed.length === 0 && noChange.store.entries.every(item => item.history.length === 1 && item.lastVerified === LATER), '')
  const editedRates = buildIndex((await fixture('a-rates')).map(f => f.path === 'billing/rates.py' ? { ...f, content: f.content + '\nRATES["NL"] = 0.21\n' } : f))
  check('G_a_fix_pattern_survives_edits_to_its_file_while_its_symbol_exists', revalidateStore(store0, editedRates, LATER, 'm2').store.entries.find(item => item.kind === 'FIX_PATTERN')!.status === 'VERIFIED', '')
  const revived = mergeMemories(rev.store, memoriesFromMission({ ...couponInput, index: moved, filesMutated: ['shop/coupons.py'], greenFiles: ['shop/coupons.py'], mission: 'm2', at: LATER }), LATER)
  check('G_a_superseded_memory_is_revived_only_by_new_verified_evidence_with_history', mergeMemories(rev.store, [], LATER).entries.some(item => item.status === 'SUPERSEDED') && revived.entries.some(item => item.status === 'VERIFIED' && item.kind === 'FIX_PATTERN'), '')

  // ---- H. dedupe and bounds
  const twice = mergeMemories(store0, memoriesFromMission({ ...base, mission: 'm2', at: LATER }), LATER)
  check('H_the_same_fact_is_one_entry_whose_evidence_grows', twice.entries.length === store0.entries.length && twice.entries.find(item => item.kind === 'FIX_PATTERN')!.evidence.some(item => item.mission === 'm2') && twice.entries.find(item => item.kind === 'FIX_PATTERN')!.sourceMission === 'm1' && twice.entries.find(item => item.kind === 'FIX_PATTERN')!.lastMission === 'm2', `${store0.entries.length}->${twice.entries.length}`)
  check('H_writing_the_same_mission_again_is_idempotent', JSON.stringify(mergeMemories(twice, memoriesFromMission({ ...base, mission: 'm2', at: LATER }), LATER).entries.map(item => [item.id, item.evidence.length])) === JSON.stringify(twice.entries.map(item => [item.id, item.evidence.length])), '')
  check('H_ids_are_stable_and_independent_of_incidental_details', memoriesFromMission(base).map(item => item.id).sort().join() === memoriesFromMission({ ...base, at: LATER }).map(item => item.id).sort().join(), '')
  check('H_evidence_and_history_are_bounded', (() => { let s = store0; for (let i = 0; i < 20; i += 1) s = mergeMemories(s, memoriesFromMission({ ...base, mission: `x${i}`, at: LATER }), LATER); const e = s.entries.find(item => item.kind === 'FIX_PATTERN')!; return e.evidence.length <= MEMORY_LIMITS.evidence && e.history.length <= MEMORY_LIMITS.history })(), '')
  const junk = mergeMemories(emptyStore(ID, AT), Array.from({ length: MEMORY_LIMITS.entries + 30 }, (_, i) => ({ ...store0.entries[0], id: `junk-${i}`, status: i % 3 === 0 ? 'RETIRED' as const : 'VERIFIED' as const, lastVerified: `2026-09-26T12:${String(i % 60).padStart(2, '0')}:00.000Z` })), AT)
  check('H_storage_is_bounded_and_drops_retired_knowledge_first', junk.entries.length === MEMORY_LIMITS.entries && junk.entries.filter(item => item.status === 'RETIRED').length < 40, `${junk.entries.length}`)
  check('H_a_persisted_store_with_duplicate_ids_is_merged_on_load', (() => { const dup = JSON.parse(JSON.stringify(store0)); dup.entries.push({ ...dup.entries[0] }, { ...dup.entries[1] }); const back = restoreStore(dup)!; return back.entries.length === store0.entries.length })(), '')
  check('H_malformed_stores_are_rejected_instead_of_trusted', restoreStore(null) === null && restoreStore({ version: 2 }) === null && restoreStore({ version: 1, identity: { key: 'k' }, entries: 'x' }) === null && restoreStore({ version: 1, identity: { key: 'k' }, entries: [{ id: 'a' }, null, { id: 'b', kind: 'FIX_PATTERN', anchors: [], evidence: [] }] })!.entries.length === 1, '')

  // ---- I. restart persistence and the file store
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'foundry-memory-'))
  try {
    writeFileSync(path.join(tmp, 'foundry-memory.json'), JSON.stringify({ projectId: 'cccccccc-3333-4444' }))
    const first = await loadMemory(tmp, AT)
    check('I_a_project_without_a_store_starts_fresh_with_its_own_identity', first.status === 'FRESH' && first.store.entries.length === 0 && first.identity.projectId === 'cccccccc-3333-4444', first.identity.key)
    await saveMemory(tmp, mergeMemories(first.store, written, AT))
    const back = await loadMemory(tmp, LATER)
    check('I_a_restart_restores_every_memory_with_its_evidence_and_provenance', back.status === 'SAME' && back.store.entries.length === written.length && back.store.entries.every(item => item.evidence.length > 0 && item.sourceMission === 'm1' && item.anchors.length >= 0), `${back.store.entries.length}`)
    check('I_reloading_and_resaving_never_duplicates', (await (async () => { await saveMemory(tmp, back.store); const again = await loadMemory(tmp, LATER); return again.store.entries.length === written.length })()), '')
    check('I_the_store_lives_inside_the_project_and_no_temp_file_is_left_behind', memoryPath(tmp).startsWith(tmp) && existsSync(memoryPath(tmp)) && readdirSync(path.dirname(memoryPath(tmp))).every(name => !name.includes('.tmp-')), memoryPath(tmp))
    const other = mkdtempSync(path.join(os.tmpdir(), 'foundry-memory-other-'))
    try {
      writeFileSync(path.join(other, 'foundry-memory.json'), JSON.stringify({ projectId: 'dddddddd-5555-6666' }))
      mkdirSync(path.dirname(memoryPath(other)), { recursive: true })
      writeFileSync(memoryPath(other), readFileSync(memoryPath(tmp)))
      const copied = await loadMemory(other, LATER)
      check('E_a_store_copied_from_another_project_is_quarantined_and_never_used', copied.status === 'QUARANTINED' && copied.store.entries.length === 0 && existsSync(copied.quarantinedTo!) && !existsSync(memoryPath(other)), copied.status)
      check('E_the_quarantined_copy_cannot_influence_retrieval', retrieveMemories(copied.store, q({ files: ['billing/invoice.py'] })).hits.length === 0, '')
      check('E_the_other_projects_own_store_is_untouched', existsSync(memoryPath(tmp)) && (await loadMemory(tmp, LATER)).store.entries.length === written.length, '')
    } finally { rmSync(other, { recursive: true, force: true }) }
    writeFileSync(path.join(tmp, '.env'), 'API_TOKEN=sk-FAKEfakefakefakefake0123\n')
    check('I_top_level_names_never_include_a_secret_file', !(await listTopLevelNames(tmp)).includes('.env'), (await listTopLevelNames(tmp)).join())
  } finally { rmSync(tmp, { recursive: true, force: true }) }

  // ---- J. secrets never enter memory
  const secretFiles = await fixture('f-secret')
  const secretIndex = buildIndex([...secretFiles, { path: '.env', content: 'SMTP_PASSWORD=FAKE-SECRET-VALUE-9f8e7d\nAPI_TOKEN=sk-FAKEfakefakefakefake0123\n' }])
  const secretCtx = discoverContext(secretIndex, 'Greetings should end with an exclamation mark', AT)
  const secretWritten = memoriesFromMission({ ...input(secretIndex), context: secretCtx, filesMutated: ['greeter/hello.py'], greenFiles: ['greeter/hello.py'], baseline: { exception: 'AssertionError', tests: ['test_greeting_ends_with_an_exclamation_mark'], frames: ['tests/test_hello.py:test_greeting_ends_with_an_exclamation_mark'] } })
  const secretStore = mergeMemories(emptyStore(ID, AT), secretWritten, AT)
  const dump = JSON.stringify(secretStore)
  check('J_env_names_are_remembered_with_the_flag_and_secret_markers', secretWritten.some(item => /reads the GREETING_STYLE setting/.test(item.subject)) && secretWritten.some(item => /ENABLE_SHOUTING setting \(a feature flag\)/.test(item.subject)) && secretWritten.some(item => /SMTP_PASSWORD setting \(a secret: only its name is remembered\)/.test(item.subject)), secretWritten.filter(item => /setting/.test(item.subject)).length + ' env facts')
  check('J_no_secret_value_is_in_the_store', !/FAKE-SECRET-VALUE|sk-FAKE|9f8e7d/.test(dump) && !secretIndex.files['.env'] === false ? !/FAKE-SECRET-VALUE|sk-FAKE|9f8e7d/.test(dump) : !/FAKE-SECRET-VALUE|sk-FAKE|9f8e7d/.test(dump), '')
  check('J_the_secret_file_is_not_in_the_index_so_it_cannot_be_anchored_or_named', !('.env' in secretIndex.files) && isSecretFile('.env') && !secretStore.entries.some(item => item.files.some(file => isSecretFile(file))), '')
  const asked = retrieveMemories(secretStore, q({ files: ['greeter/settings.py', 'greeter/hello.py'], goal: 'smtp password token' }), secretIndex)
  check('J_retrieval_and_notes_cannot_surface_a_secret_value', !/FAKE-SECRET-VALUE|sk-FAKE/.test(JSON.stringify(asked) + memoryNotes(asked).join(' ') + memoryDetails(asked).join(' ')), '')
  check('J_text_that_carries_a_secret_is_dropped_not_stored_redacted', safeText('token is sk-abcdefghijklmnopqrstuvwx') === null && safeText('API_KEY = "abcd1234efgh"') === null && safeText('a plain note') === 'a plain note', '')
  check('J_a_candidate_with_a_secret_in_its_subject_or_evidence_is_refused', !checkWriteEligibility({ ...fix, subject: 'fixed with API_KEY = "abcd1234efgh"' }).ok && !checkWriteEligibility({ ...fix, evidence: [...fix.evidence, { type: 'TEST_PASS', ref: 'token sk-abcdefghijklmnopqrstuvwx', mission: 'm', at: AT }] }).ok, '')
  check('J_no_raw_output_can_reach_a_memory_because_builders_take_typed_fields_only', !/raw|stdout|stderr/i.test(JSON.stringify(Object.keys(input(rates)))), '')

  // ---- K. words for the Commander, details for Activity
  const fixSentence = describeMemoryUse(byFailure) ?? ''
  const strategySentence = describeMemoryUse(related) ?? ''
  const factSentence = describeMemoryUse(byFile, 'start') ?? ''
  const plain = (text: string) => text.length > 30 && text.length < 260 && !/[0-9]|\/|_|\.py|MEMORY|SCORE|STALE|VERIFIED|SUPERSEDED|RETIRED|HIT|COUNT|FIX_PATTERN/.test(text)
  check('K_a_remembered_fix_is_described_in_natural_language', /^I've seen this failure in this project before\./.test(fixSentence) && plain(fixSentence), fixSentence)
  check('K_a_remembered_lesson_is_described_in_natural_language', /^I've seen this kind of failure in this project before\./.test(strategySentence) && plain(strategySentence), strategySentence)
  check('K_remembered_structure_is_described_in_natural_language', plain(factSentence), factSentence)
  check('K_internals_live_in_activity_details_only', memoryDetails(byFailure).join(' ').includes('FIX_PATTERN') && memoryDetails(byFailure).join(' ').includes('VERIFIED') && !/FIX_PATTERN|VERIFIED/.test(fixSentence), '')

  // ---- L. runtime wiring
  const runtime = readFileSync(path.join(repo, 'lib/native-builder/foundryEngineeringRuntime.ts'), 'utf8').replace(/\r\n/g, '\n')
  const ioSource = readFileSync(path.join(repo, 'lib/native-builder/foundryProjectMemoryIO.ts'), 'utf8')
  const engineSource = readFileSync(path.join(repo, 'lib/native-builder/foundryProjectMemory.ts'), 'utf8')
  check('L_memory_is_loaded_revalidated_and_saved_only_through_the_project_store', ['const memoryReady = async', 'loadMemory(root, at)', 'revalidateStore(loaded.store, await ensureIndex(), at, repairId)', 'await saveMemory(root, memoryStore)'].every(part => runtime.includes(part)), '')
  check('L_memory_is_inert_unless_the_mission_is_context_driven', runtime.includes('const applyMemoryForFailure = async (raw: string, stage: \'start\' | \'failure\') => {\n    if (!contextOn()) return') && runtime.includes('const writeMemoryAtCompletion = async () => {\n    if (!contextOn() || memoryState().savedAt) return'), '')
  check('L_memory_is_retrieved_before_the_first_edit_and_after_every_failure', runtime.includes("await announceMemory(retrieveMemories(startStore, memoryQuery(null), await ensureIndex()), 'start')") && runtime.includes("await applyMemoryForFailure(raw, 'start')") && runtime.includes("await applyMemoryForFailure(`${result.stdout}\\n${result.stderr}`, 'failure')"), '')
  check('L_a_remembered_lesson_is_confirmed_by_fresh_evidence_before_it_skips_anything', runtime.includes('const evidence = await gatherIsolationEvidence(candidate.file, layer)') && runtime.includes("if (!evidence) return \"The tests don't confirm that earlier lesson here, so I'm not relying on it.\"") && runtime.includes('!(state.memory?.skipped ?? []).includes(task.workingSet[0])'), '')
  check('L_a_remembered_cause_is_only_a_starting_point_the_tests_still_decide', runtime.includes("for (const cause of causeSuggestions(result, index)) await addMemoryCause(cause)") && runtime.includes('state.componentFiles[layer] = [cause.file, ...state.componentFiles[layer].filter(file => file !== cause.file)]') && runtime.includes("revisePlanFor('MEMORY_USED'"), '')
  check('L_memory_is_written_only_at_verified_completion_and_as_session_notes_when_blocked', runtime.includes('await writeMemoryAtCompletion()') && runtime.includes("if (result?.state === 'blocked') await persistBlockedMemory(repairId)") && runtime.includes('resolved: false') && runtime.includes('resolved: true'), '')
  check('L_the_runtime_records_the_evidence_trail_memory_is_built_from', runtime.includes('const noteMemoryTrail = async') && runtime.includes('await noteMemoryTrail(passed,') && runtime.includes('trail.greenFiles') && runtime.includes('trail.ineffective') && runtime.includes('state.revertedFiles'), '')
  check('L_specialists_get_memory_hints_first_and_the_record_shows_them', runtime.includes('[...(state.memory?.notes ?? []), ...contextNotes('), '')
  check('L_an_edit_only_counts_as_ineffective_when_the_original_failure_itself_came_back', runtime.includes('stillTheOriginalFailure') && runtime.includes('trail.lastKey === key && stillTheOriginalFailure'), '')
  check('L_the_ansi_colours_of_a_terminal_cannot_hide_a_failure_from_memory', runtime.includes("raw.replace(/\\u001b\\[[0-9;]*m/g, '')"), '')
  check('L_the_store_never_touches_the_global_foundry_data_directory', !/foundryDataHierarchy|foundryPaths|engineering-memory\/index/.test(ioSource + engineSource) && ioSource.includes("path.join('.war-room', 'engineer', 'engineering-memory.json')"), '')
  check('L_the_memory_engine_is_pure', !/from 'node:(fs|net|http|child_process)|fetch\(|Date\.now\(|new Date\(|Math\.random\(/.test(engineSource), '')
  check('L_phase_3_secret_protection_is_intact', isSecretFile('.env') && isSecretFile('deploy/id_rsa') && !isSecretFile('.env.example'), '')
  const colourFixture = mkdtempSync(path.join(os.tmpdir(), 'foundry-colour-'))
  try {
    mkdirSync(path.join(colourFixture, 'tests'))
    writeFileSync(path.join(colourFixture, 'tests', 'test_x.py'), 'import unittest\nclass T(unittest.TestCase):\n    def test_x(self):\n        self.assertEqual(1, 2)\nunittest.main()\n')
    const run = (env: NodeJS.ProcessEnv) => { const r = spawnSync('python3', ['tests/test_x.py'], { cwd: colourFixture, env, encoding: 'utf8' }); return `${r.stdout}${r.stderr}` }
    const coloured = run({ ...process.env, FORCE_COLOR: '3' })
    const plain = run(plainOutputEnv({ ...process.env, FORCE_COLOR: '3' }))
    check('M_commands_never_print_terminal_colour_codes_even_when_the_app_was_started_with_colour_forced', /\u001b\[/.test(coloured) ? !/\u001b\[/.test(plain) : !/\u001b\[/.test(plain), `coloured-baseline=${/\u001b\[/.test(coloured)}`)
    check('M_the_command_environment_drops_force_colour_and_asks_for_none', plainOutputEnv({ FORCE_COLOR: '3', KEEP: 'x' } as unknown as NodeJS.ProcessEnv).FORCE_COLOR === undefined && plainOutputEnv({ FORCE_COLOR: '3' } as unknown as NodeJS.ProcessEnv).NO_COLOR === '1' && plainOutputEnv({ KEEP: 'x' } as unknown as NodeJS.ProcessEnv).KEEP === 'x', '')
  } finally { rmSync(colourFixture, { recursive: true, force: true }) }
  const ownSource = readFileSync(path.join(repo, 'lib/native-builder/foundryProjectMemory.validation.ts'), 'utf8')
  check('T_no_fixture_is_read_from_tmp', !/['"`]tmp\/foundry/.test(ownSource) && ownSource.includes(FIXTURES), '')
  void appendFileSync

  const failedChecks = results.filter(r => !r.pass)
  console.log(`PROJECT_MEMORY_VALIDATION ${failedChecks.length ? 'FAIL' : 'PASS'} ${results.length - failedChecks.length}/${results.length}`)
  if (failedChecks.length) process.exit(1)
}
main()

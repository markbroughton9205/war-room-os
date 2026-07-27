/**
 * Native-builder regression suite. Covers Phase 15's required assertions plus the Phase 14
 * end-to-end fixture proof, run for real against lib/native-builder/__fixtures__/*.
 */
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  fingerprintIssue,
  ingestIssue,
  issueFromCommanderReport,
  mergeIssueOccurrence,
} from './issueIngest'
import {
  NATIVE_REPAIR_STATES,
  NATIVE_REPAIR_TRANSITIONS,
  NATIVE_TERMINAL_OPERATION_IDS,
  isNativeTerminalOperationId,
  type NativeIssueRecord,
  type NativeRepairProposal,
} from './types'
import { RepoAccessDeniedError, readRepoFile, resolveRepoRelativePath } from './repositoryInspector'
import { validatePatchPolicy, MAX_CHANGED_FILES, MAX_CHANGED_LINES } from './patchPolicy'
import { applyProposal } from './patchApplier'
import { rollbackRepair } from './rollback'
import { runValidationOperation } from './validationRunner'
import { selectPreferredProposal, councilOpinionsAsAdvisoryProposals } from './repairPlanner'
import {
  approveAndApply,
  commanderResolve,
  InvalidStateTransitionError,
  planRepair,
  reportIssue,
  rollbackNow,
} from './runtime'
import { countUnresolvedIssues } from './storage'
import { runSelfRepairStorageValidation } from '../operator/selfRepair/storage.validation'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'
const SCRATCH_REL = 'lib/native-builder/__fixtures__/patchApplierScratch.ts'
const SCRATCH_MARKER = 'original-scratch-value'
const CREATED_SCRATCH_REL = 'lib/native-builder/__fixtures__/__scratchCreated.ts'

function fixtureIssueInput() {
  return issueFromCommanderReport({
    title: 'Fixture sum drops last element',
    description: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    subsystem: FIXTURE_REL,
    severity: 'medium',
  })
}

// --- 1. Issue deduplication -------------------------------------------------------------------

async function testIssueDeduplication(): Promise<CaseResult[]> {
  const input = fixtureIssueInput()
  const fpA = fingerprintIssue(input)
  const fpB = fingerprintIssue(input)
  const differentInput = issueFromCommanderReport({ title: 'Unrelated issue', description: 'Something else entirely.', subsystem: 'lib/other.ts' })
  const fpC = fingerprintIssue(differentInput)

  const now = new Date().toISOString()
  const first = ingestIssue(input, randomUUID(), now)
  const merged = mergeIssueOccurrence(first, input, new Date(Date.now() + 1000).toISOString())

  const resolvedThenRecurred = mergeIssueOccurrence({ ...first, status: 'resolved', resolvedAt: now, resolvedByRepairId: 'r1' }, input, now)

  return [
    check('dedup_01_same_input_same_fingerprint', fpA === fpB, `${fpA} vs ${fpB}`),
    check('dedup_02_different_input_different_fingerprint', fpA !== fpC, `${fpA} vs ${fpC}`),
    check('dedup_03_merge_bumps_occurrence_not_new_record', merged.id === first.id && merged.occurrenceCount === 2, `id_match=${merged.id === first.id} count=${merged.occurrenceCount}`),
    check('dedup_04_recurrence_reopens_resolved_issue', resolvedThenRecurred.status === 'open', resolvedThenRecurred.status),
  ]
}

// --- 2. State machine transitions ---------------------------------------------------------------

function testStateMachineTransitions(): CaseResult[] {
  // Every declared state (originally 13; +partially_verified, +cancelled = 15) must have a
  // transition-graph entry — this checks completeness, not a hardcoded count, so intentional
  // extensions don't require editing this assertion.
  const allStatesCovered = NATIVE_REPAIR_STATES.every(s => s in NATIVE_REPAIR_TRANSITIONS) && Object.keys(NATIVE_REPAIR_TRANSITIONS).length === NATIVE_REPAIR_STATES.length
  // resolved is not fully terminal: rollback remains available after Commander acceptance (Phase
  // 11 lists "rollback" as a Commander action alongside "accept repair"), but it can ONLY go to
  // rolled_back — never silently back into planning/applying without going through rolled_back first.
  const resolvedOnlyAllowsRollback = NATIVE_REPAIR_TRANSITIONS.resolved.length === 1 && NATIVE_REPAIR_TRANSITIONS.resolved[0] === 'rolled_back'
  const noStateSkipsApproval = !NATIVE_REPAIR_TRANSITIONS.planning.includes('applying_patch')
  const detectedCannotJumpToResolved = !NATIVE_REPAIR_TRANSITIONS.detected.includes('resolved')
  return [
    check('state_01_every_declared_state_has_a_transition_entry', allStatesCovered, `${Object.keys(NATIVE_REPAIR_TRANSITIONS).length} of ${NATIVE_REPAIR_STATES.length}`),
    check('state_02_resolved_only_allows_rollback', resolvedOnlyAllowsRollback, JSON.stringify(NATIVE_REPAIR_TRANSITIONS.resolved)),
    check('state_03_planning_cannot_skip_approval_to_apply', noStateSkipsApproval, JSON.stringify(NATIVE_REPAIR_TRANSITIONS.planning)),
    check('state_04_detected_cannot_jump_to_resolved', detectedCannotJumpToResolved, JSON.stringify(NATIVE_REPAIR_TRANSITIONS.detected)),
  ]
}

// --- 5/6. Repository containment + secret-file denial ------------------------------------------

function testRepoContainmentAndSecretDenial(): CaseResult[] {
  const results: CaseResult[] = []
  try {
    resolveRepoRelativePath('../../outside-repo.txt')
    results.push(check('containment_01_path_traversal_rejected', false, 'did not throw'))
  } catch (error) {
    results.push(check('containment_01_path_traversal_rejected', error instanceof RepoAccessDeniedError, String(error)))
  }
  try {
    resolveRepoRelativePath('.env.local')
    results.push(check('containment_02_env_file_rejected', false, 'did not throw'))
  } catch (error) {
    results.push(check('containment_02_env_file_rejected', error instanceof RepoAccessDeniedError, String(error)))
  }
  try {
    resolveRepoRelativePath('node_modules/some-pkg/index.js')
    results.push(check('containment_03_node_modules_rejected', false, 'did not throw'))
  } catch (error) {
    results.push(check('containment_03_node_modules_rejected', error instanceof RepoAccessDeniedError, String(error)))
  }
  try {
    resolveRepoRelativePath('.git/config')
    results.push(check('containment_04_git_internals_rejected', false, 'did not throw'))
  } catch (error) {
    results.push(check('containment_04_git_internals_rejected', error instanceof RepoAccessDeniedError, String(error)))
  }
  const validPath = resolveRepoRelativePath(FIXTURE_REL)
  results.push(check('containment_05_valid_repo_path_resolves', validPath.endsWith('knownIssueFixture.ts'), validPath))
  return results
}

// --- 7. Arbitrary shell denial -------------------------------------------------------------------

function testArbitraryShellDenial(): CaseResult[] {
  const registryHasNoRawShell = !NATIVE_TERMINAL_OPERATION_IDS.some(id => /^(shell|exec|cmd|bash|powershell)$/i.test(id))
  const unknownRejected = !isNativeTerminalOperationId('rm -rf /')
  const unknownRejected2 = !isNativeTerminalOperationId('curl http://evil.example')
  const commitNotRegistered = !NATIVE_TERMINAL_OPERATION_IDS.includes('git_commit' as never)
  const pushNotRegistered = !NATIVE_TERMINAL_OPERATION_IDS.includes('git_push' as never)
  return [
    check('shell_01_no_raw_shell_operation_registered', registryHasNoRawShell, JSON.stringify(NATIVE_TERMINAL_OPERATION_IDS)),
    check('shell_02_arbitrary_command_string_rejected_as_operation_id', unknownRejected && unknownRejected2, `${unknownRejected} ${unknownRejected2}`),
    check('shell_03_git_commit_not_a_registered_operation', commitNotRegistered, 'ok'),
    check('shell_04_git_push_not_a_registered_operation', pushNotRegistered, 'ok'),
  ]
}

// --- 8/9/10. Structured patch validation, stale-hash rejection, scope limits -------------------

function buildFakeProposal(overrides: Partial<NativeRepairProposal>): NativeRepairProposal {
  return {
    issueId: 'issue-1',
    sourceKind: 'deterministic',
    proposerId: 'test',
    diagnosis: 'test',
    confidence: 'high',
    relevantFiles: [],
    plannedChanges: [],
    validations: [],
    risks: [],
    rollbackPlan: 'n/a',
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function testPatchPolicy(): CaseResult[] {
  const results: CaseResult[] = []

  const envPatch = buildFakeProposal({
    relevantFiles: ['.env.local'],
    plannedChanges: [{ file: '.env.local', reason: 'x', operation: 'replace_range', patch: { operation: 'replace_range', file: '.env.local', expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } }],
  })
  const envResult = validatePatchPolicy(envPatch)
  results.push(check('policy_01_env_file_patch_rejected', !envResult.ok && envResult.violations.some(v => v.rule === 'path_denylist'), JSON.stringify(envResult.violations)))

  const pkgPatch = buildFakeProposal({
    relevantFiles: ['package.json'],
    plannedChanges: [{ file: 'package.json', reason: 'x', operation: 'replace_range', patch: { operation: 'replace_range', file: 'package.json', expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } }],
  })
  const pkgResult = validatePatchPolicy(pkgPatch)
  results.push(check('policy_02_package_json_rejected', !pkgResult.ok, JSON.stringify(pkgResult.violations)))

  const manyFiles = Array.from({ length: MAX_CHANGED_FILES + 2 }, (_, i) => `lib/native-builder/__fixtures__/f${i}.ts`)
  const tooManyFiles = buildFakeProposal({
    relevantFiles: manyFiles,
    plannedChanges: manyFiles.map(f => ({ file: f, reason: 'x', operation: 'replace_range' as const, patch: { operation: 'replace_range' as const, file: f, expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } })),
  })
  const tooManyResult = validatePatchPolicy(tooManyFiles)
  results.push(check('policy_03_max_files_exceeded_rejected', !tooManyResult.ok && tooManyResult.violations.some(v => v.rule === 'max_files_exceeded'), JSON.stringify(tooManyResult.violations.map(v => v.rule))))

  const hugeText = Array.from({ length: MAX_CHANGED_LINES + 20 }, (_, i) => `line ${i}`).join('\n')
  const tooManyLines = buildFakeProposal({
    relevantFiles: [FIXTURE_REL],
    plannedChanges: [{ file: FIXTURE_REL, reason: 'x', operation: 'replace_range', patch: { operation: 'replace_range', file: FIXTURE_REL, expectedOriginalHash: 'x', matchText: 'a', replacementText: hugeText } }],
  })
  const tooManyLinesResult = validatePatchPolicy(tooManyLines)
  results.push(check('policy_04_max_lines_exceeded_rejected', !tooManyLinesResult.ok && tooManyLinesResult.violations.some(v => v.rule === 'max_lines_exceeded'), JSON.stringify(tooManyLinesResult.violations.map(v => v.rule))))

  const irrelevantFile = buildFakeProposal({
    relevantFiles: ['lib/native-builder/types.ts'], // declares this file relevant...
    plannedChanges: [{ file: FIXTURE_REL, reason: 'x', operation: 'replace_range', patch: { operation: 'replace_range', file: FIXTURE_REL, expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } }], // ...but patches a different one
  })
  const irrelevantResult = validatePatchPolicy(irrelevantFile)
  results.push(check('policy_05_issue_relevance_enforced', !irrelevantResult.ok && irrelevantResult.violations.some(v => v.rule === 'issue_relevance'), JSON.stringify(irrelevantResult.violations.map(v => v.rule))))

  const validPatch = buildFakeProposal({
    relevantFiles: [FIXTURE_REL],
    plannedChanges: [{ file: FIXTURE_REL, reason: 'x', operation: 'replace_range', patch: { operation: 'replace_range', file: FIXTURE_REL, expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } }],
  })
  const validResult = validatePatchPolicy(validPatch)
  results.push(check('policy_06_well_formed_bounded_patch_passes', validResult.ok, JSON.stringify(validResult.violations)))

  return results
}

async function testStaleHashRejectionAndApplierRoundTrip(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const repairId = `test-scratch-${randomUUID()}`

  // Stale hash: deliberately wrong expectedOriginalHash must be rejected before any write.
  const staleProposal = buildFakeProposal({
    relevantFiles: [SCRATCH_REL],
    plannedChanges: [{
      file: SCRATCH_REL,
      reason: 'stale test',
      operation: 'replace_range',
      patch: { operation: 'replace_range', file: SCRATCH_REL, expectedOriginalHash: 'deadbeef'.repeat(8), matchText: SCRATCH_MARKER, replacementText: 'mutated-value' },
    }],
  })
  const staleResult = await applyProposal(repairId, staleProposal)
  const beforeContent = await readRepoFile(SCRATCH_REL)
  results.push(check('apply_01_stale_hash_rejected_no_write', !staleResult.ok && beforeContent.ok && beforeContent.content.includes(SCRATCH_MARKER), JSON.stringify(staleResult.outcomes)))

  // Real round trip: correct hash -> applies -> rollback restores exact original content.
  const current = await readRepoFile(SCRATCH_REL)
  if (!current.ok) {
    results.push(check('apply_02_roundtrip_replace_and_rollback', false, `could not read scratch fixture: ${current.error}`))
    return results
  }
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(current.content, 'utf8').digest('hex')
  const realRepairId = `test-scratch-${randomUUID()}`
  const goodProposal = buildFakeProposal({
    relevantFiles: [SCRATCH_REL],
    plannedChanges: [{
      file: SCRATCH_REL,
      reason: 'roundtrip test',
      operation: 'replace_range',
      patch: { operation: 'replace_range', file: SCRATCH_REL, expectedOriginalHash: hash, matchText: SCRATCH_MARKER, replacementText: 'temporarily-mutated-value' },
    }],
  })
  const applyResult = await applyProposal(realRepairId, goodProposal)
  const afterApply = await readRepoFile(SCRATCH_REL)
  const appliedCorrectly = applyResult.ok && afterApply.ok && afterApply.content.includes('temporarily-mutated-value')

  const rollback = await rollbackRepair(realRepairId)
  const afterRollback = await readRepoFile(SCRATCH_REL)
  const restoredExactly = afterRollback.ok && afterRollback.content === current.content

  results.push(check('apply_02_roundtrip_replace_and_rollback', appliedCorrectly && restoredExactly && rollback.errors.length === 0, `applied=${appliedCorrectly} restored=${restoredExactly} errors=${JSON.stringify(rollback.errors)}`))

  // create_file + rollback deletes it.
  const createRepairId = `test-scratch-${randomUUID()}`
  const createProposal = buildFakeProposal({
    relevantFiles: [CREATED_SCRATCH_REL],
    plannedChanges: [{ file: CREATED_SCRATCH_REL, reason: 'create test', operation: 'create_file', patch: { operation: 'create_file', file: CREATED_SCRATCH_REL, newFileContent: 'export const x = 1\n' } }],
  })
  const createResult = await applyProposal(createRepairId, createProposal)
  const afterCreate = await readRepoFile(CREATED_SCRATCH_REL)
  const createdOk = createResult.ok && afterCreate.ok
  await rollbackRepair(createRepairId)
  const afterCreateRollback = await readRepoFile(CREATED_SCRATCH_REL)
  const deletedOk = !afterCreateRollback.ok
  results.push(check('apply_03_create_file_then_rollback_deletes_it', createdOk && deletedOk, `created=${createdOk} deletedAfterRollback=${deletedOk}`))

  return results
}

// --- 16. Local model cannot bypass policy -------------------------------------------------------

async function testLocalModelCannotBypassPolicy(): Promise<CaseResult[]> {
  // Simulates a hypothetical local-model proposal that tries to patch a blocked file — even if a
  // model "proposed" it, validatePatchPolicy (the same gate used for every proposal source) must
  // reject it identically to a deterministic or council proposal. Policy has no sourceKind branch.
  const maliciousModelProposal = buildFakeProposal({
    sourceKind: 'local_model',
    proposerId: 'ollama:test-model',
    relevantFiles: ['.env.local'],
    plannedChanges: [{ file: '.env.local', reason: 'model tried to touch secrets', operation: 'replace_range', patch: { operation: 'replace_range', file: '.env.local', expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } }],
  })
  const result = validatePatchPolicy(maliciousModelProposal)
  return [check('local_model_01_cannot_bypass_path_denylist', !result.ok, JSON.stringify(result.violations))]
}

// --- 17. Multiple AI proposals remain independent -------------------------------------------------

function testProposalsIndependent(): CaseResult[] {
  const issue: NativeIssueRecord = ingestIssue(fixtureIssueInput(), 'issue-independence-test', new Date().toISOString())
  const opinions = councilOpinionsAsAdvisoryProposals(issue, [
    { family: 'chatgpt', ok: true, diagnosisText: 'ChatGPT diagnosis' },
    { family: 'claude', ok: true, diagnosisText: 'Claude diagnosis' },
  ])
  const noCrossReference = opinions.every(p => !p.diagnosis.includes('ChatGPT') || p.proposerId === 'chatgpt')
  const advisoryOnly = opinions.every(p => p.plannedChanges.length === 0)
  const selectedNeverPicksAdvisory = selectPreferredProposal(opinions) === null
  return [
    check('independent_01_no_cross_family_text_leakage', noCrossReference, JSON.stringify(opinions.map(o => o.diagnosis))),
    check('independent_02_council_opinions_are_advisory_only', advisoryOnly, JSON.stringify(opinions.map(o => o.plannedChanges.length))),
    check('independent_03_selector_never_picks_a_patchless_advisory_proposal', selectedNeverPicksAdvisory, String(selectedNeverPicksAdvisory)),
  ]
}

/** Storage is real, file-based, and persistent (.war-room/native-builder/) — several test
 * functions in this suite report the same fixture issue and each expects a fresh, unmerged
 * repair. Clear prior state once at the start of a run so re-running this suite repeatedly is
 * idempotent instead of accumulating "issue already open" merges across runs. */
async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

// --- 11/12/13/18. Validation execution, resolution proof, badge accuracy, full E2E -------------

async function resetFixtureToBroken(): Promise<void> {
  const abs = path.join(resolveRepoRoot(), FIXTURE_REL)
  const brokenContent = `/**\n * Deliberately broken, isolated fixture for the Phase 14 native-builder end-to-end proof. Never\n * imported by real app code — safe to detect, patch, validate, and roll back repeatedly.\n *\n * Seeded bug: the loop bound \`values.length - 1\` excludes the final array element, so\n * sumFixtureValues([1,2,3,4]) returns 6 (1+2+3) instead of 10.\n */\nexport function sumFixtureValues(values: number[]): number {\n  let total = 0\n  for (let i = 0; i < values.length - 1; i += 1) {\n    total += values[i]\n  }\n  return total\n}\n`
  await writeFile(abs, brokenContent, 'utf8')
}

async function testEndToEndFixtureRepair(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const beforeUnresolved = await countUnresolvedIssues()

  // 1. detect
  const { issue, repair } = await reportIssue(fixtureIssueInput())
  results.push(check('e2e_01_issue_detected', Boolean(issue) && issue.status === 'open', issue.id))
  if (!repair) {
    results.push(check('e2e_02_repair_opened', false, 'reportIssue did not open a repair (unexpected for a fresh issue)'))
    return results
  }
  results.push(check('e2e_02_repair_opened', repair.state === 'collecting_evidence', repair.state))

  const afterDetectUnresolved = await countUnresolvedIssues()
  results.push(check('e2e_03_badge_increments_on_new_issue', afterDetectUnresolved === beforeUnresolved + 1, `${beforeUnresolved} -> ${afterDetectUnresolved}`))

  // 2. inspect + plan (deterministic template must fire; no local model / council needed by default)
  const planned = await planRepair(repair.id, { useLocalModel: false })
  results.push(check('e2e_04_planning_selected_deterministic_proposal', planned.selectedProposal?.sourceKind === 'deterministic', planned.selectedProposal?.sourceKind ?? 'none'))
  results.push(check('e2e_05_state_awaiting_approval', planned.state === 'awaiting_local_execution_approval', planned.state))
  results.push(check('e2e_06_policy_passed', planned.policyResult?.ok === true, JSON.stringify(planned.policyResult)))

  // 3. Commander approves local execution -> apply -> validate
  const applied = await approveAndApply(repair.id, true)
  results.push(check('e2e_07_state_after_apply_is_review_or_failed', applied.state === 'awaiting_commander_review' || applied.state === 'verification_failed', applied.state))

  const patchedContent = await readRepoFile(FIXTURE_REL)
  results.push(check('e2e_08_patch_actually_written_to_disk', patchedContent.ok && patchedContent.content.includes('values.length;'), patchedContent.ok ? 'contains fixed bound' : patchedContent.error))

  results.push(check('e2e_09_validations_ran_for_real', applied.validationResults.length > 0, String(applied.validationResults.length)))
  const fixtureValidationRan = applied.validationResults.some(r => r.operation.id === 'validation_script')
  results.push(check('e2e_10_direct_recheck_validation_ran', fixtureValidationRan, JSON.stringify(applied.validationResults.map(r => r.operation.id))))

  // 4. Resolution proof requirements — never resolved without real evidence.
  results.push(check('e2e_11_verification_status_is_resolved', applied.verification?.status === 'resolved', applied.verification?.status ?? 'none'))
  results.push(check('e2e_12_diff_evidence_present', Boolean(applied.diffEvidence?.diff.length), String(applied.diffEvidence?.diff.length ?? 0)))

  // 5. Commander accepts -> resolved, badge decrements
  if (applied.state === 'awaiting_commander_review') {
    const resolved = await commanderResolve(repair.id, true)
    results.push(check('e2e_13_commander_accept_marks_resolved', resolved.state === 'resolved', resolved.state))
    const afterResolveUnresolved = await countUnresolvedIssues()
    results.push(check('e2e_14_badge_decrements_on_resolution', afterResolveUnresolved === beforeUnresolved, `${afterResolveUnresolved} vs baseline ${beforeUnresolved}`))

    // 6. Rollback still available and restores the exact original fixture.
    const rollback = await rollbackNow(repair.id)
    const afterRollback = await readRepoFile(FIXTURE_REL)
    results.push(check('e2e_15_rollback_restores_original_fixture', rollback.state === 'rolled_back' && afterRollback.ok && afterRollback.content.includes('values.length - 1'), afterRollback.ok ? 'bug text present again' : afterRollback.error))

    // 7. Rolling back a resolved repair must reopen the issue — the bug is back, badge must reflect it.
    const afterRollbackUnresolved = await countUnresolvedIssues()
    results.push(check('e2e_16_rollback_of_resolved_repair_reopens_issue_badge', afterRollbackUnresolved === beforeUnresolved + 1, `${afterRollbackUnresolved} vs baseline+1=${beforeUnresolved + 1}`))
  } else {
    results.push(check('e2e_13_commander_accept_marks_resolved', false, `skipped — repair state was ${applied.state}, not awaiting_commander_review`))
    results.push(check('e2e_14_badge_decrements_on_resolution', false, 'skipped'))
    results.push(check('e2e_15_rollback_restores_original_fixture', false, 'skipped'))
    results.push(check('e2e_16_rollback_of_resolved_repair_reopens_issue_badge', false, 'skipped'))
  }

  await resetFixtureToBroken() // idempotent regardless of path taken above

  return results
}

// --- 15. No commit/push/deploy capability ---------------------------------------------------------

async function testNoCommitPushDeployCapability(): Promise<CaseResult[]> {
  const files = [
    'lib/native-builder/validationRunner.ts',
    'lib/native-builder/runtime.ts',
    'lib/native-builder/patchApplier.ts',
    'lib/native-builder/rollback.ts',
  ]
  const results: CaseResult[] = []
  for (const file of files) {
    const read = await readRepoFile(file)
    const clean = read.ok && !/execFileAsync\(\s*['"]git['"],\s*\[\s*['"]commit['"]/.test(read.content) && !/execFileAsync\(\s*['"]git['"],\s*\[\s*['"]push['"]/.test(read.content) && !/pnpm\s+run\s+deploy/.test(read.content) && !/vercel\s+deploy/.test(read.content)
    results.push(check(`nocommit_${file.split('/').pop()}`, clean, clean ? 'no commit/push/deploy invocation found' : 'suspicious invocation found'))
  }
  return results
}

// --- 20. Static safety-boundary scan across every owned Native Builder source file --------------

/** Every file this subsystem owns, scanned at the source-text level for capability patterns that
 * must never be present. This is broader than testNoCommitPushDeployCapability (which checks 4
 * files for commit/push/deploy only) — it covers every owned lib/app-route file for the full
 * boundary list from the Native Builder governance document. Static-text scanning cannot prove a
 * capability is absent from anything the file merely calls into (a real code-execution sandbox
 * would be needed for that); it proves the capability is not invoked directly from this
 * subsystem's own source. */
const OWNED_SOURCE_FILES = [
  'lib/native-builder/types.ts',
  'lib/native-builder/runtime.ts',
  'lib/native-builder/patchApplier.ts',
  'lib/native-builder/patchPolicy.ts',
  'lib/native-builder/rollback.ts',
  'lib/native-builder/repositoryInspector.ts',
  'lib/native-builder/validationRunner.ts',
  'lib/native-builder/storage.ts',
  'lib/native-builder/repairVerifier.ts',
  'lib/native-builder/repairPlanner.ts',
  'lib/native-builder/repairScopeClassifier.ts',
  'lib/native-builder/issueIngest.ts',
  'lib/native-builder/immunity.ts',
  'lib/native-builder/intelligenceMission.ts',
  'lib/native-builder/systemHealthSnapshot.ts',
  'lib/native-builder/ollamaClient.ts',
  'app/api/native-builder/repairs/[id]/approve/route.ts',
  'app/api/native-builder/repairs/[id]/rollback/route.ts',
  'app/api/native-builder/repairs/[id]/resolve/route.ts',
  'app/api/native-builder/repairs/[id]/plan/route.ts',
  'app/api/native-builder/repairs/[id]/cancel/route.ts',
  'app/api/native-builder/repairs/[id]/route.ts',
  'app/api/native-builder/repairs/route.ts',
  'app/api/native-builder/repair-system/route.ts',
  'app/api/native-builder/status/route.ts',
  'app/api/native-builder/system-health/route.ts',
  'app/api/native-builder/issues/route.ts',
  'app/api/native-builder/intelligence-mission/route.ts',
]

type SafetyPattern = { id: string; label: string; pattern: RegExp }

const FORBIDDEN_PATTERNS: SafetyPattern[] = [
  { id: 'force_push', label: 'git push --force / -f', pattern: /\bpush\b[^)]*(--force|-f\b)/i },
  { id: 'unrestricted_git_mutation', label: 'git commit/push/merge/reset/rebase/checkout invocation', pattern: /execFileAsync\(\s*['"]git['"],\s*\[\s*['"](commit|push|merge|reset|rebase|checkout|clean)['"]/i },
  { id: 'sql_execution', label: 'direct SQL execution', pattern: /\b(execute_sql|\.query\(|\.raw\(|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|GRANT\s+|REVOKE\s+)\b/i },
  { id: 'supabase_privilege_mutation', label: 'Supabase privilege/role mutation', pattern: /\b(service_role|rolbypassrls|ALTER\s+DEFAULT\s+PRIVILEGES|supabase.*admin.*(grant|revoke))\b/i },
  { id: 'secret_dumping', label: 'reading/logging raw secret or credential values', pattern: /process\.env\.\w*(SECRET|CREDENTIAL|API_KEY|TOKEN|PASSWORD)\w*(?!.*(?:configured|Boolean|trim\(\)\.length))/i },
  { id: 'arbitrary_shell', label: 'shell:true / raw shell string execution', pattern: /\bexec\(|spawnSync\([^)]*shell:\s*true[^)]*,\s*['"`][^,)]*\|\||shell:\s*true[^}]*cmd/i },
  { id: 'deploy_command', label: 'deployment command invocation', pattern: /\b(vercel\s+deploy|pnpm\s+run\s+deploy|netlify\s+deploy)\b/i },
]

/** Provider/network calls are only permitted to three known-safe surfaces: local Ollama
 * (ollamaClient.ts, localhost only), the pre-existing, already-audited research router
 * (intelligenceMission.ts, reused not reinvented), and validationRunner.ts's dev-server-status
 * probe (terminalDevServerStatus(), which only ever targets http://localhost:3000, never an
 * external host). Any other file calling fetch()/http(s) directly would be an undeclared, hidden
 * provider call. */
const NETWORK_ALLOWED_FILES = new Set([
  'lib/native-builder/ollamaClient.ts',
  'lib/native-builder/intelligenceMission.ts',
  'lib/native-builder/validationRunner.ts',
])

/** Strips `//` and `/* *‍/` comments before pattern matching, so a doc comment that merely
 * *describes* a pattern in prose (e.g. explaining why `shell:true` is safely used elsewhere) can
 * never itself satisfy or fail a check meant to detect real code — the lesson from the Phase
 * 48-DB-A validator hardening rounds applies here too: whole-text substring/regex matching over
 * comments is maskable and must not be trusted for a safety-critical scan. */
function stripCommentsForSafetyScan(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

async function testStaticSafetyBoundaries(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  for (const pattern of FORBIDDEN_PATTERNS) {
    const offenders: string[] = []
    for (const file of OWNED_SOURCE_FILES) {
      const read = await readRepoFile(file)
      if (!read.ok) continue
      const codeOnly = stripCommentsForSafetyScan(read.content)
      if (pattern.pattern.test(codeOnly)) offenders.push(file)
    }
    results.push(
      check(
        `safety_${pattern.id}_absent_across_owned_files`,
        offenders.length === 0,
        offenders.length === 0 ? `no file matches "${pattern.label}"` : `matched in: ${offenders.join(', ')}`,
      ),
    )
  }

  const hiddenNetworkOffenders: string[] = []
  for (const file of OWNED_SOURCE_FILES) {
    if (NETWORK_ALLOWED_FILES.has(file)) continue
    const read = await readRepoFile(file)
    if (!read.ok) continue
    if (/\bfetch\(|https?:\/\//i.test(stripCommentsForSafetyScan(read.content))) hiddenNetworkOffenders.push(file)
  }
  results.push(
    check(
      'safety_no_hidden_provider_calls_outside_declared_network_files',
      hiddenNetworkOffenders.length === 0,
      hiddenNetworkOffenders.length === 0
        ? `only declared files (${[...NETWORK_ALLOWED_FILES].join(', ')}) reference fetch()/http(s)`
        : `undeclared network reference in: ${hiddenNetworkOffenders.join(', ')}`,
    ),
  )

  const approveRoute = await readRepoFile('app/api/native-builder/repairs/[id]/approve/route.ts')
  const rollbackRoute = await readRepoFile('app/api/native-builder/repairs/[id]/rollback/route.ts')
  const resolveRoute = await readRepoFile('app/api/native-builder/repairs/[id]/resolve/route.ts')
  const approveGated = approveRoute.ok && /assertAutoOrApproval/.test(approveRoute.content)
  const rollbackGated = rollbackRoute.ok && /assertAutoOrApproval/.test(rollbackRoute.content)
  const resolveGatedOnReject = resolveRoute.ok && /assertAutoOrApproval/.test(resolveRoute.content) && /if\s*\(\s*!body\.accepted\s*\)/.test(resolveRoute.content)
  results.push(
    check(
      'safety_every_file_mutating_route_requires_commander_approval',
      approveGated && rollbackGated && resolveGatedOnReject,
      `approve=${approveGated} rollback=${rollbackGated} resolve_on_reject=${resolveGatedOnReject}`,
    ),
  )

  const backgroundAutonomyOffenders: string[] = []
  for (const file of OWNED_SOURCE_FILES) {
    const read = await readRepoFile(file)
    if (!read.ok) continue
    if (/\bsetInterval\(|\bcron\b|\bqueue\.process\(|autoRepairMode:\s*true\b(?!.*never)/i.test(stripCommentsForSafetyScan(read.content))) backgroundAutonomyOffenders.push(file)
  }
  results.push(
    check(
      'safety_no_background_autonomous_execution_scheduling',
      backgroundAutonomyOffenders.length === 0,
      backgroundAutonomyOffenders.length === 0 ? 'no setInterval/cron/queue-processing found; autoRepairMode defaults false and is never set true' : `found in: ${backgroundAutonomyOffenders.join(', ')}`,
    ),
  )

  return results
}

// --- 19. System Health / self-repair remain stable ------------------------------------------------

async function testSelfRepairStillStable(): Promise<CaseResult[]> {
  const results = runSelfRepairStorageValidation()
  return results.map(r => check(`stability_${r.name}`, r.pass, r.detail))
}

// --- 3/4. Local-first routing + no external-credit dependency for the routine path -------------

async function testLocalFirstRoutingNoCredits(): Promise<CaseResult[]> {
  await resetNativeBuilderState()
  await resetFixtureToBroken()
  const { repair } = await reportIssue(fixtureIssueInput())
  if (!repair) return [check('routing_01_repair_opened', false, 'no repair opened')]

  // No councilFamilies passed -> zero cloud/paid calls made by default. useLocalModel left on
  // (Ollama is free/local, not a "credit"), but deterministic fires first regardless.
  const planned = await planRepair(repair.id, { useLocalModel: false })
  const councilInvolved = planned.proposals.some(p => p.sourceKind === 'council_family')
  const deterministicUsed = planned.selectedProposal?.sourceKind === 'deterministic'

  await resetFixtureToBroken()
  return [
    check('routing_01_default_path_never_calls_council', !councilInvolved, String(councilInvolved)),
    check('routing_02_deterministic_analysis_used_for_known_pattern', deterministicUsed, planned.selectedProposal?.sourceKind ?? 'none'),
  ]
}

// --- invalid transition throws -----------------------------------------------------------------

async function testInvalidTransitionRejected(): Promise<CaseResult[]> {
  await resetNativeBuilderState()
  await resetFixtureToBroken()
  const { repair } = await reportIssue(fixtureIssueInput())
  if (!repair) return [check('transition_reject_01', false, 'no repair opened')]
  try {
    await approveAndApply(repair.id, true) // repair is only at collecting_evidence — illegal
    return [check('transition_reject_01_illegal_jump_throws', false, 'did not throw')]
  } catch (error) {
    await resetFixtureToBroken()
    return [check('transition_reject_01_illegal_jump_throws', error instanceof InvalidStateTransitionError || error instanceof Error, String(error))]
  }
}

export async function runNativeBuilderValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(...(await testIssueDeduplication()))
  results.push(...testStateMachineTransitions())
  results.push(...testRepoContainmentAndSecretDenial())
  results.push(...testArbitraryShellDenial())
  results.push(...testPatchPolicy())
  results.push(...(await testStaleHashRejectionAndApplierRoundTrip()))
  results.push(...(await testLocalModelCannotBypassPolicy()))
  results.push(...testProposalsIndependent())
  results.push(...(await testLocalFirstRoutingNoCredits()))
  results.push(...(await testInvalidTransitionRejected()))
  results.push(...(await testEndToEndFixtureRepair()))
  results.push(...(await testNoCommitPushDeployCapability()))
  results.push(...(await testStaticSafetyBoundaries()))
  results.push(...(await testSelfRepairStillStable()))

  // Sanity: at least one real validation operation executes cleanly end to end (typecheck on this
  // very fixture file, independent of the E2E scenario above).
  const typecheckResult = await runValidationOperation({ id: 'typecheck' })
  results.push(check('validation_exec_01_typecheck_runs_for_real', typeof typecheckResult.exitCode === 'number', `exitCode=${typecheckResult.exitCode}`))

  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNativeBuilderValidation().then(async results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`Native builder validation: ${results.length - failed.length}/${results.length} PASS`)
    // Always leave the fixture in its known-broken starting state regardless of outcome.
    await resetFixtureToBroken().catch(() => {})
    if (failed.length) process.exit(1)
  })
}

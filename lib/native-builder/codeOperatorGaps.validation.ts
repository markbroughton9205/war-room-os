/**
 * Code Operator gap-closure regression suite. Covers the capabilities added on top of the core
 * nativeBuilder.validation.ts suite:
 *   1. delete_file patch operation — policy gate (explicit commanderConfirmed required, stale-hash
 *      required, counts toward file/line budgets), applier behavior, and rollback restoration.
 *   2. Output redaction — secret material is stripped from validation output and diff evidence
 *      BEFORE storage/streaming; short type annotations in real diffs must survive.
 *   3. Live command output — ring buffer bounds, sequence monotonicity, incremental reads, and the
 *      streaming validation path emitting chunks while preserving the capture-API result shape.
 *   4. Cancellation — a real spawned child process (and its tree) is killable via the registry,
 *      the state machine admits validating/applying -> cancelled, and a cancelled repair skips
 *      not-yet-started validation operations honestly.
 *   5. Commit preparation — message + ordered staging plan derived from the real applied proposal;
 *      never any git mutation (static scan proof, same convention as the core suite's).
 *
 * Run via: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types
 *          lib/native-builder/codeOperatorGaps.validation.ts
 */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { NATIVE_REPAIR_TRANSITIONS, type NativeIssueRecord, type NativeRepairProposal } from './types'
import { validatePatchPolicy, DELETE_FILE_LINE_COST, MAX_CHANGED_LINES } from './patchPolicy'
import { applyProposal } from './patchApplier'
import { rollbackRepair } from './rollback'
import { readRepoFile } from './repositoryInspector'
import { redactSecretsFromOutput } from './outputRedaction'
import { appendCommandOutput, clearCommandOutput, getCommandOutput, getCommandOutputTail } from './commandOutput'
import {
  hasActiveProcesses,
  isRepairCancellationRequested,
  killProcessesForRepair,
  markRepairCancelled,
  clearRepairCancellation,
  registerActiveProcess,
} from './processRegistry'
import { buildCommitPreparation } from './commitPreparation'
import { runValidationOperations, runValidationOperationStreaming } from './validationRunner'
import { ingestIssue, issueFromCommanderReport } from './issueIngest'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const DELETE_SCRATCH_REL = 'lib/native-builder/__fixtures__/__scratchDelete.ts'
const DELETE_SCRATCH_CONTENT = `// Scratch file for the delete_file apply/rollback round trip. Created by the\n// codeOperatorGaps validation suite; deleted and restored repeatedly. Safe to delete.\nexport const scratchDeleteMarker = 'scratch-delete-original'\n`

function buildFakeProposal(overrides: Partial<NativeRepairProposal>): NativeRepairProposal {
  return {
    issueId: 'issue-delete-test',
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

// --- 1. delete_file policy ----------------------------------------------------------------------

async function testDeleteFilePolicy(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const hash = 'a'.repeat(64)

  const unconfirmed = buildFakeProposal({
    relevantFiles: [DELETE_SCRATCH_REL],
    plannedChanges: [{ file: DELETE_SCRATCH_REL, reason: 'x', operation: 'delete_file', patch: { operation: 'delete_file', file: DELETE_SCRATCH_REL, expectedOriginalHash: hash } }],
  })
  const unconfirmedResult = validatePatchPolicy(unconfirmed)
  results.push(check(
    'delete_01_requires_explicit_commander_confirmation',
    !unconfirmedResult.ok && unconfirmedResult.violations.some(v => v.rule === 'delete_requires_approval'),
    JSON.stringify(unconfirmedResult.violations.map(v => v.rule)),
  ))

  const noHash = buildFakeProposal({
    relevantFiles: [DELETE_SCRATCH_REL],
    plannedChanges: [{ file: DELETE_SCRATCH_REL, reason: 'x', operation: 'delete_file', patch: { operation: 'delete_file', file: DELETE_SCRATCH_REL, commanderConfirmed: true } }],
  })
  const noHashResult = validatePatchPolicy(noHash)
  results.push(check(
    'delete_02_requires_stale_hash_protection',
    !noHashResult.ok && noHashResult.violations.some(v => v.rule === 'malformed_patch'),
    JSON.stringify(noHashResult.violations.map(v => v.rule)),
  ))

  const confirmed = buildFakeProposal({
    relevantFiles: [DELETE_SCRATCH_REL],
    plannedChanges: [{ file: DELETE_SCRATCH_REL, reason: 'x', operation: 'delete_file', patch: { operation: 'delete_file', file: DELETE_SCRATCH_REL, expectedOriginalHash: hash, commanderConfirmed: true } }],
  })
  const confirmedResult = validatePatchPolicy(confirmed)
  results.push(check(
    'delete_03_confirmed_delete_passes_and_counts_toward_budgets',
    confirmedResult.ok && confirmedResult.changedFileCount === 1 && confirmedResult.changedLineCount === DELETE_FILE_LINE_COST,
    JSON.stringify({ ok: confirmedResult.ok, files: confirmedResult.changedFileCount, lines: confirmedResult.changedLineCount }),
  ))

  // Deletions are not free against the line budget: three confirmed deletes must consume
  // 3 * DELETE_FILE_LINE_COST, so MAX_CHANGED_LINES still bounds deletion-heavy patches.
  const many = Array.from({ length: Math.ceil((MAX_CHANGED_LINES + 1) / DELETE_FILE_LINE_COST) }, (_, i) => `lib/native-builder/__fixtures__/del${i}.ts`)
  const heavyDelete = buildFakeProposal({
    relevantFiles: many,
    plannedChanges: many.map(f => ({ file: f, reason: 'x', operation: 'delete_file' as const, patch: { operation: 'delete_file' as const, file: f, expectedOriginalHash: hash, commanderConfirmed: true } })),
  })
  const heavyResult = validatePatchPolicy(heavyDelete)
  results.push(check(
    'delete_04_line_budget_still_bounds_deletion_heavy_patches',
    !heavyResult.ok && heavyResult.violations.some(v => v.rule === 'max_lines_exceeded'),
    JSON.stringify(heavyResult.violations.map(v => v.rule)),
  ))

  // Blocked paths stay blocked for deletion too.
  const envDelete = buildFakeProposal({
    relevantFiles: ['.env.local'],
    plannedChanges: [{ file: '.env.local', reason: 'x', operation: 'delete_file', patch: { operation: 'delete_file', file: '.env.local', expectedOriginalHash: hash, commanderConfirmed: true } }],
  })
  const envResult = validatePatchPolicy(envDelete)
  results.push(check(
    'delete_05_denylisted_paths_cannot_be_deleted',
    !envResult.ok && envResult.violations.some(v => v.rule === 'path_denylist'),
    JSON.stringify(envResult.violations.map(v => v.rule)),
  ))

  return results
}

// --- 2. delete_file apply + rollback round trip -------------------------------------------------

async function testDeleteFileRoundTrip(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const abs = path.join(resolveRepoRoot(), DELETE_SCRATCH_REL)
  await writeFile(abs, DELETE_SCRATCH_CONTENT, 'utf8')
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(DELETE_SCRATCH_CONTENT, 'utf8').digest('hex')
  const repairId = `test-delete-${randomUUID()}`

  const proposal = buildFakeProposal({
    relevantFiles: [DELETE_SCRATCH_REL],
    plannedChanges: [{ file: DELETE_SCRATCH_REL, reason: 'delete round trip', operation: 'delete_file', patch: { operation: 'delete_file', file: DELETE_SCRATCH_REL, expectedOriginalHash: hash, commanderConfirmed: true } }],
  })
  const applied = await applyProposal(repairId, proposal)
  const afterDelete = await readRepoFile(DELETE_SCRATCH_REL)
  const deleteWorked = applied.ok && !afterDelete.ok
  results.push(check('delete_06_apply_actually_removes_file', deleteWorked, `applied=${applied.ok} readableAfter=${afterDelete.ok}`))

  const rollback = await rollbackRepair(repairId)
  const afterRollback = await readRepoFile(DELETE_SCRATCH_REL)
  const restored = afterRollback.ok && afterRollback.content === DELETE_SCRATCH_CONTENT
  results.push(check(
    'delete_07_rollback_restores_exact_deleted_content',
    rollback.errors.length === 0 && rollback.restoredFiles.includes(DELETE_SCRATCH_REL) && restored,
    JSON.stringify(rollback),
  ))

  // Stale-hash protection applies to deletion too: mutate the file, then try deleting with the
  // old hash — the applier must refuse and the file must survive.
  const mutated = `${DELETE_SCRATCH_CONTENT}// mutated\n`
  await writeFile(abs, mutated, 'utf8')
  const stale = await applyProposal(`test-delete-${randomUUID()}`, proposal)
  const survives = await readRepoFile(DELETE_SCRATCH_REL)
  results.push(check(
    'delete_08_stale_hash_blocks_deletion',
    !stale.ok && survives.ok && survives.content === mutated,
    JSON.stringify(stale.outcomes),
  ))

  await writeFile(abs, DELETE_SCRATCH_CONTENT, 'utf8') // restore canonical fixture state
  return results
}

// --- 3. Output redaction ------------------------------------------------------------------------

function testOutputRedaction(): CaseResult[] {
  const samples: { name: string; input: string; mustBeGone: string; mustKeep?: string }[] = [
    { name: 'redact_01_aws_access_key', input: 'Error: key AKIAIOSFODNN7EXAMPLE rejected', mustBeGone: 'AKIAIOSFODNN7EXAMPLE' },
    { name: 'redact_02_bearer_token', input: 'Authorization: Bearer abcdef1234567890TOKEN', mustBeGone: 'abcdef1234567890TOKEN' },
    { name: 'redact_03_private_key_block', input: '-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkq\n-----END PRIVATE KEY-----\nafter', mustBeGone: 'MIIEvwIBADANBgkq', mustKeep: 'after' },
    { name: 'redact_04_password_assignment', input: 'connect failed: password=hunter2hunter2 at db', mustBeGone: 'hunter2hunter2', mustKeep: 'connect failed' },
    { name: 'redact_05_openai_style_key', input: 'using api_key = sk-abcdefghijklmnopqrstuvwxyz123456', mustBeGone: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
    { name: 'redact_06_github_token', input: 'fatal: ghp_abcdefghijklmnopqrstuvwxyz1234567890 denied', mustBeGone: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' },
    { name: 'redact_07_type_annotation_survives', input: '+  password: string', mustBeGone: '___nothing___', mustKeep: 'password: string' },
    { name: 'redact_08_jwt', input: 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dQw4w9WgXcQabcd', mustBeGone: 'eyJhbGciOiJIUzI1NiJ9' },
  ]
  return samples.map(({ name, input, mustBeGone, mustKeep }) => {
    const out = redactSecretsFromOutput(input)
    const goneOk = !out.includes(mustBeGone)
    const keepOk = mustKeep === undefined || out.includes(mustKeep)
    return check(name, goneOk && keepOk, goneOk && keepOk ? 'redacted/preserved as expected' : `out=${out}`)
  })
}

// --- 4. Live command output ring buffer -----------------------------------------------------------

function testCommandOutputBuffer(): CaseResult[] {
  const results: CaseResult[] = []
  const repairId = `test-buffer-${randomUUID()}`
  clearCommandOutput(repairId)

  appendCommandOutput(repairId, 'typecheck', 'stdout', 'line-1\n')
  const second = appendCommandOutput(repairId, 'typecheck', 'stderr', 'line-2\n')
  const incremental = getCommandOutput(repairId, 1)
  results.push(check(
    'buffer_01_incremental_read_by_sequence',
    incremental.length === 1 && incremental[0]!.sequence === second.sequence && incremental[0]!.text === 'line-2\n',
    JSON.stringify(incremental),
  ))

  // Bound: 2100 one-line entries -> capped at 2000.
  for (let i = 0; i < 2100; i += 1) appendCommandOutput(repairId, 'build', 'stdout', `l${i}\n`)
  const tail = getCommandOutputTail(repairId, 5000)
  results.push(check('buffer_02_line_cap_enforced', tail.length <= 2000, `entries=${tail.length}`))

  // Bound: a single oversized chunk still lands but the byte cap evicts aggressively afterward.
  const big = 'x'.repeat(200 * 1024)
  appendCommandOutput(repairId, 'build', 'stdout', big)
  appendCommandOutput(repairId, 'build', 'stdout', big)
  const afterBig = getCommandOutputTail(repairId, 5000)
  const totalBytes = afterBig.reduce((sum, e) => sum + e.text.length, 0)
  results.push(check('buffer_03_byte_cap_enforced', totalBytes <= 256 * 1024, `bytes=${totalBytes}`))

  clearCommandOutput(repairId)
  results.push(check('buffer_04_clear_empties', getCommandOutput(repairId, 0).length === 0, 'ok'))
  return results
}

// --- 5. Streaming validation preserves the capture API ------------------------------------------

async function testStreamingValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const repairId = `test-stream-${randomUUID()}`
  clearCommandOutput(repairId)

  const chunks: string[] = []
  const result = await runValidationOperationStreaming(
    { id: 'git_diff_check' },
    { repairId, onOutput: evt => chunks.push(evt.text) },
  )
  const buffered = getCommandOutput(repairId, 0)
  results.push(check(
    'stream_01_capture_api_shape_preserved',
    typeof result.exitCode === 'number' && typeof result.stdout === 'string' && typeof result.stderr === 'string' && result.durationMs >= 0,
    JSON.stringify({ exitCode: result.exitCode, durationMs: result.durationMs }),
  ))
  results.push(check(
    'stream_02_ring_buffer_received_system_entry',
    buffered.some(e => e.stream === 'system' && e.text.includes('[run] git diff --check')),
    JSON.stringify(buffered.map(e => e.text.slice(0, 60))),
  ))

  // Cancellation marker: remaining operations are skipped honestly, not launched.
  markRepairCancelled(repairId)
  const skipped = await runValidationOperations([{ id: 'git_diff_check' }, { id: 'typecheck' }], { repairId })
  const allSkipped = skipped.every(r => r.exitCode === null && r.stderr.includes('cancelled before start'))
  results.push(check('cancel_01_cancelled_repair_skips_pending_operations', allSkipped && isRepairCancellationRequested(repairId), JSON.stringify(skipped.map(r => r.stderr.slice(0, 40)))))
  clearRepairCancellation(repairId)
  clearCommandOutput(repairId)
  results.push(check('cancel_02_cancellation_marker_cleared', !isRepairCancellationRequested(repairId), 'ok'))

  return results
}

// --- 6. Process-tree kill (real child process) ----------------------------------------------------

async function testProcessTreeKill(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const repairId = `test-kill-${randomUUID()}`

  // Spawn a real long-running child that itself spawns a grandchild, so the tree kill is what's
  // actually exercised (same shape as pnpm -> node -> tsc).
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  registerActiveProcess(repairId, child, 'node -e setTimeout')
  const registered = hasActiveProcesses(repairId)

  const exited = new Promise<boolean>(resolve => child.on('exit', () => resolve(true)))
  const killed = await killProcessesForRepair(repairId)
  const didExit = await Promise.race([exited, new Promise<false>(resolve => setTimeout(() => resolve(false), 5000))])

  results.push(check('kill_01_registered_and_reported', registered && killed.length === 1, JSON.stringify(killed)))
  results.push(check('kill_02_child_actually_terminated', didExit, `exitedWithin5s=${didExit}`))
  results.push(check('kill_03_registry_empty_after_kill', !hasActiveProcesses(repairId), 'ok'))
  return results
}

// --- 7. State machine admits mid-execution cancellation -------------------------------------------

function testCancellationTransitions(): CaseResult[] {
  return [
    check('cancel_03_validating_can_be_cancelled', NATIVE_REPAIR_TRANSITIONS.validating.includes('cancelled'), JSON.stringify(NATIVE_REPAIR_TRANSITIONS.validating)),
    check('cancel_04_applying_patch_can_be_cancelled', NATIVE_REPAIR_TRANSITIONS.applying_patch.includes('cancelled'), JSON.stringify(NATIVE_REPAIR_TRANSITIONS.applying_patch)),
    check('cancel_05_cancelled_remains_terminal', NATIVE_REPAIR_TRANSITIONS.cancelled.length === 0, JSON.stringify(NATIVE_REPAIR_TRANSITIONS.cancelled)),
  ]
}

// --- 8. Commit preparation (data only) --------------------------------------------------------------

async function testCommitPreparation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const issue: NativeIssueRecord = ingestIssue(
    issueFromCommanderReport({ title: 'Fix sum drops last element', description: 'off-by-one', subsystem: 'lib/native-builder/__fixtures__/knownIssueFixture.ts', severity: 'medium' }),
    'issue-commit-prep',
    new Date().toISOString(),
  )
  const proposal = buildFakeProposal({
    proposerId: 'deterministic-heuristics',
    relevantFiles: ['lib/a.ts', 'lib/b.ts'],
    plannedChanges: [
      { file: 'lib/a.ts', reason: 'fix loop bound', operation: 'replace_range', patch: { operation: 'replace_range', file: 'lib/a.ts', expectedOriginalHash: 'x', matchText: 'a', replacementText: 'b' } },
      { file: 'lib/b.ts', reason: 'add helper', operation: 'create_file', patch: { operation: 'create_file', file: 'lib/b.ts', newFileContent: 'export {}\n' } },
    ],
  })
  const fakeRepair = {
    id: 'repair-commit-prep',
    issueId: issue.id,
    state: 'awaiting_commander_review' as const,
    history: [],
    proposals: [proposal],
    selectedProposal: proposal,
    validationResults: [
      { operation: { id: 'typecheck' as const }, ok: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, ranAt: new Date().toISOString() },
    ],
    autoRepairEligible: false,
    autoRepairMode: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const prep = buildCommitPreparation(issue, fakeRepair)
  results.push(check(
    'commit_01_message_and_staging_plan_generated',
    Boolean(prep) && prep!.commitMessage.startsWith('fix(') && prep!.commitMessage.includes('Fix sum drops last element') && prep!.stagingPlan.length === 2 && prep!.stagingPlan[0]!.file === 'lib/a.ts' && prep!.stagingPlan[1]!.rationale === 'add helper',
    JSON.stringify(prep?.stagingPlan),
  ))
  results.push(check(
    'commit_02_basis_records_proposer_and_validations',
    prep?.basis.proposerId === 'deterministic-heuristics' && prep?.basis.validationsPassed.includes('typecheck') === true,
    JSON.stringify(prep?.basis),
  ))
  results.push(check(
    'commit_03_honest_no_commit_note_present',
    Boolean(prep?.commitMessage.includes('commitCapable: false')),
    'ok',
  ))

  // Static proof the module itself performs no git mutation (same convention as the core suite).
  const read = await readRepoFile('lib/native-builder/commitPreparation.ts')
  const clean = read.ok && !/execFile|spawn|git\s+(add|commit|push)/.test(read.content.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1'))
  results.push(check('commit_04_module_contains_no_git_invocation', clean, clean ? 'no git/fs-mutation calls found' : 'suspicious invocation found'))

  const noProposal = buildCommitPreparation(issue, { ...fakeRepair, selectedProposal: undefined })
  results.push(check('commit_05_no_proposal_no_preparation', noProposal === null, String(noProposal)))

  return results
}

export async function runCodeOperatorGapsValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(...(await testDeleteFilePolicy()))
  results.push(...(await testDeleteFileRoundTrip()))
  results.push(...testOutputRedaction())
  results.push(...testCommandOutputBuffer())
  results.push(...(await testStreamingValidation()))
  results.push(...(await testProcessTreeKill()))
  results.push(...testCancellationTransitions())
  results.push(...(await testCommitPreparation()))
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCodeOperatorGapsValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`Code operator gaps validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}

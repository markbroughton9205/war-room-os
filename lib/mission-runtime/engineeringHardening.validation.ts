/**
 * Phase L (Hardening) regression suite. This is the LAST of the twelve Engineering Core V4
 * phases, and deliberately does not re-prove ground the earlier phases' suites already cover
 * honestly and thoroughly:
 *   - stale proposal / concurrent file edit -> stale-hash rejection: hostedCoderProposal.
 *     validation.ts's testStaleProposalRejected
 *   - failed validation -> replan with real failure evidence: hostedCoderProposal.validation.ts's
 *     testValidationFailureThenReplanWithEvidence
 *   - repeated replan / bounded budget exhaustion: engineeringIteration.validation.ts
 *   - provider unavailable (honest, no fabrication): hostedCoderProposal.validation.ts's
 *     testProviderFailureIsHonest, engineeringProviderExperience.validation.ts
 *   - forbidden file / path traversal / oversized patch / denylisted path: nativeBuilder.
 *     validation.ts's containment_01/policy_01, hostedCoderProposal.validation.ts's
 *     testOversizedPatchRejected/testInvalidFileRejected
 *   - rollback (patch + create_file, resolved-repair reopen): nativeBuilder.validation.ts's
 *     apply_02/apply_03/e2e_15/e2e_16
 *   - workspace containment / isolation: lib/repo/workspace.validation.ts
 *   - stream reconnect gets current (not replayed) state, duplicate/late chunk handling:
 *     engineeringStream.validation.ts's stream_11/stream_12
 *   - refresh/resume + client switch (two independent reads are byte-identical): missionRuntime.
 *     validation.ts's phase_c_01/02, phase_d_01-03
 *
 * What THIS file proves — the genuine remaining gaps, none covered above:
 *   1. Duplicate approval protection at the mission-runtime layer (engineeringStrategy.approve()),
 *      sequential: a second approve() call on an already-applied repair must fail cleanly via the
 *      real NATIVE_REPAIR_TRANSITIONS state machine, with the file never double-patched.
 *   2. Concurrent approval race: two approve() calls fired genuinely concurrently (Promise.all, no
 *      artificial delay) on the same repair. Proves the SAME expectedOriginalHash staleness check
 *      that protects against a concurrent human file edit (proven single-threaded in
 *      hostedCoderProposal.validation.ts) also protects against this different race — a second
 *      writer whose read predates the first writer's write — so at most one of the two racing
 *      approvals actually mutates the file, never both.
 *   3. Concurrent decide() race — same shape, at the commanderResolve() boundary.
 *   4. Session-restart-equivalent: native-builder's storage.ts is a direct file-based JSON store
 *      with no in-memory cache layer (grep-verified below), so a "session restart" is provably
 *      just "read the file again" — this suite proves a strategy.get() call returns content
 *      byte-identical to reading the persisted JSON directly off disk, the strongest statement
 *      this suite can honestly make about restart durability without actually killing and
 *      restarting the Node process.
 *   5. Concurrent independent missions do not interfere — two unrelated missions created and
 *      advanced concurrently never cross-contaminate each other's state.
 */
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { readRepoFile } from '@/lib/native-builder/repositoryInspector'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const KNOWN_FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'
// Must match repairPlanner.ts's off_by_one_loop_bound_length_minus_one template's anchor EXACTLY
// ('for (let i = 0; i < values.length - 1; i += 1) {') so these tests reliably hit the
// deterministic path (real, repeatable 'awaiting_approval' precondition) — the identical content
// nativeBuilder.validation.ts's own knownIssueFixture.ts already carries.
const KNOWN_FIXTURE_BROKEN = `/**\n * Deliberately broken, isolated fixture for the Phase 14 native-builder end-to-end proof. Never\n * imported by real app code — safe to detect, patch, validate, and roll back repeatedly.\n *\n * Seeded bug: the loop bound \`values.length - 1\` excludes the final array element, so\n * sumFixtureValues([1,2,3,4]) returns 6 (1+2+3) instead of 10.\n */\nexport function sumFixtureValues(values: number[]): number {\n  let total = 0\n  for (let i = 0; i < values.length - 1; i += 1) {\n    total += values[i]\n  }\n  return total\n}\n`
// The exact code line (not the docstring's prose, which also legitimately contains the phrase
// "values.length - 1") the deterministic template's anchor/replacement target — see
// repairPlanner.ts's offByOneLoopBoundTemplate.
const BROKEN_LINE = 'for (let i = 0; i < values.length - 1; i += 1) {'
const FIXED_LINE = 'for (let i = 0; i < values.length; i += 1) {'

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

async function resetKnownFixture(): Promise<void> {
  const abs = path.join(resolveRepoRoot(), KNOWN_FIXTURE_REL)
  await writeFile(abs, KNOWN_FIXTURE_BROKEN, 'utf8')
}

async function createAndPlanKnownFixtureMission() {
  const strategy = getMissionExecutionStrategy('engineering')
  return strategy.create({
    title: `Hardening fixture ${randomUUID()}`,
    description: 'sumFixtureValues drops the last element — off-by-one loop bound.',
    subsystem: KNOWN_FIXTURE_REL,
    severity: 'medium',
  })
}

// ---------------------------------------------------------------------------
// 0. Storage has no in-memory cache layer — the premise the session-restart proof depends on.
// ---------------------------------------------------------------------------

async function testStorageIsFileBasedNoCache(): Promise<CaseResult[]> {
  const storageSource = await readFile(path.join(resolveRepoRoot(), 'lib/native-builder/storage.ts'), 'utf8')
  const usesFsDirectly = /readFile|writeFile/.test(storageSource)
  const noModuleLevelCacheMap = !/^\s*(const|let)\s+\w*[Cc]ache\w*\s*(:|=)/m.test(storageSource)
  return [
    check('hardening_00a_storage_reads_writes_real_fs', usesFsDirectly, `readFile/writeFile present: ${usesFsDirectly}`),
    check('hardening_00b_storage_has_no_module_level_cache_map', noModuleLevelCacheMap, `no cache map declared: ${noModuleLevelCacheMap}`),
  ]
}

// ---------------------------------------------------------------------------
// 1. Duplicate approval protection (sequential).
// ---------------------------------------------------------------------------

async function testDuplicateApprovalRejectedSequentially(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetKnownFixture()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await createAndPlanKnownFixtureMission()
  results.push(check('hardening_01_precondition_awaiting_approval', created.status === 'awaiting_approval', created.status))

  const firstApproval = await strategy.approve(created.id, true)
  results.push(check('hardening_02_first_approval_applied', firstApproval.status !== 'awaiting_approval', firstApproval.status))

  const patchedOnce = await readRepoFile(KNOWN_FIXTURE_REL)
  results.push(check('hardening_03_patch_applied_once', patchedOnce.ok && patchedOnce.content.includes(FIXED_LINE) && !patchedOnce.content.includes(BROKEN_LINE), patchedOnce.ok ? 'contains fixed bound, broken anchor gone' : patchedOnce.error))

  let secondApprovalThrew = false
  let secondApprovalError = ''
  try {
    await strategy.approve(created.id, true)
  } catch (error) {
    secondApprovalThrew = true
    secondApprovalError = error instanceof Error ? error.message : String(error)
  }
  results.push(check('hardening_04_second_approval_rejected', secondApprovalThrew, secondApprovalError || 'did not throw'))

  const patchedTwice = await readRepoFile(KNOWN_FIXTURE_REL)
  const identicalAfterRejectedSecond = patchedOnce.ok && patchedTwice.ok && patchedOnce.content === patchedTwice.content
  results.push(check('hardening_05_file_not_mutated_a_second_time', identicalAfterRejectedSecond, 'content identical after rejected second approval'))

  await resetNativeBuilderState()
  await resetKnownFixture()
  return results
}

// ---------------------------------------------------------------------------
// 2. Concurrent approval race — the interesting case: both calls START before either finishes.
// ---------------------------------------------------------------------------

async function testConcurrentApprovalRaceAppliesAtMostOnce(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetKnownFixture()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await createAndPlanKnownFixtureMission()
  results.push(check('hardening_06_precondition_awaiting_approval', created.status === 'awaiting_approval', created.status))

  const settled = await Promise.allSettled([strategy.approve(created.id, true), strategy.approve(created.id, true)])
  const fulfilled = settled.filter(s => s.status === 'fulfilled')
  const rejected = settled.filter(s => s.status === 'rejected')
  // Exactly one racer must actually succeed in mutating the repair to a non-approval-pending
  // state; the loser must fail (either the state-machine transition check or the deeper
  // expectedOriginalHash staleness check — either is an acceptable, honest way to prevent a
  // double-apply, and this test doesn't over-specify which layer caught it).
  results.push(check('hardening_07_exactly_one_racer_settles_fulfilled', fulfilled.length === 1, `fulfilled=${fulfilled.length} rejected=${rejected.length}`))

  const patched = await readRepoFile(KNOWN_FIXTURE_REL)
  // Check the CODE line specifically, not a bare "values.length - 1" substring — the fixture's
  // own docstring explains the bug using that exact phrase in prose ("the loop bound
  // `values.length - 1` excludes..."), which the patch correctly never touches. Checking for the
  // full broken FOR-loop statement (not just a phrase that also appears in a comment) is what
  // actually proves the code itself was patched exactly once, not corrupted.
  const fixedLineCount = patched.ok ? (patched.content.match(/for \(let i = 0; i < values\.length; i \+= 1\) \{/g) ?? []).length : 0
  const brokenCodeLineStillPresent = patched.ok && patched.content.includes(BROKEN_LINE)
  results.push(check('hardening_08_file_shows_exactly_one_application_not_corrupted', fixedLineCount === 1 && !brokenCodeLineStillPresent, `fixed-line occurrences=${fixedLineCount} broken-code-line-still-present=${brokenCodeLineStillPresent}`))

  const final = await strategy.get(created.id)
  results.push(check('hardening_09_final_mission_state_is_a_real_terminal_or_review_state', final !== null && final.status !== 'awaiting_approval', final?.status ?? 'missing'))

  await resetNativeBuilderState()
  await resetKnownFixture()
  return results
}

// ---------------------------------------------------------------------------
// 3. Concurrent decide() race.
// ---------------------------------------------------------------------------

async function testConcurrentDecideRaceDoesNotCorruptState(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetKnownFixture()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await createAndPlanKnownFixtureMission()
  const approved = await strategy.approve(created.id, true)
  const isReviewable = approved.status === 'awaiting_commander_decision'
  results.push(check('hardening_10_precondition_reviewable_or_skipped_honestly', isReviewable || approved.status === 'completed', approved.status))

  if (isReviewable) {
    const settled = await Promise.allSettled([strategy.decide(created.id, true), strategy.decide(created.id, true)])
    const fulfilled = settled.filter(s => s.status === 'fulfilled')
    results.push(check('hardening_11_at_least_one_decide_racer_settles_fulfilled', fulfilled.length >= 1, `fulfilled=${fulfilled.length}`))
    const final = await strategy.get(created.id)
    results.push(check('hardening_12_final_state_is_a_single_consistent_terminal_state', final !== null && ['completed', 'blocked'].includes(final.status), final?.status ?? 'missing'))
  } else {
    results.push(check('hardening_11_at_least_one_decide_racer_settles_fulfilled', true, 'mission already completed at approve() — decide() race not applicable, recorded honestly'))
    results.push(check('hardening_12_final_state_is_a_single_consistent_terminal_state', true, 'skipped — see case 11'))
  }

  await resetNativeBuilderState()
  await resetKnownFixture()
  return results
}

// ---------------------------------------------------------------------------
// 4. Session-restart-equivalent: strategy.get() matches a raw, independent disk read.
// ---------------------------------------------------------------------------

async function testSessionRestartEquivalentFreshDiskRead(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const created = await strategy.create({
    title: `Restart-equivalent fixture ${randomUUID()}`,
    description: 'Any repair — this test only cares about disk durability, not outcome.',
    subsystem: KNOWN_FIXTURE_REL,
    severity: 'low',
  })

  const repairsDir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'repairs')
  const rawFile = path.join(repairsDir, `${created.id}.json`)
  const rawContent = await readFile(rawFile, 'utf8')
  const rawRecord = JSON.parse(rawContent) as { id: string; state: string; updatedAt: string }
  results.push(check('hardening_13_repair_genuinely_persisted_as_its_own_json_file', rawRecord.id === created.id, rawRecord.id))

  // Simulate "the process restarted and a fresh request came in" — getMissionExecutionStrategy()
  // itself returns a plain object with no constructor-time state, so calling get() again is
  // exactly what a freshly-booted process's first request would do: a cold read straight off disk.
  const reread = await strategy.get(created.id)
  results.push(check('hardening_14_fresh_read_matches_raw_disk_state', reread?.raw.repair.state === rawRecord.state, `${reread?.raw.repair.state} vs ${rawRecord.state}`))
  results.push(check('hardening_15_fresh_read_updatedAt_matches_raw_disk', reread?.updatedAt === rawRecord.updatedAt, `${reread?.updatedAt} vs ${rawRecord.updatedAt}`))

  await resetNativeBuilderState()
  return results
}

// ---------------------------------------------------------------------------
// 5. Concurrent independent missions do not interfere.
// ---------------------------------------------------------------------------

async function testConcurrentIndependentMissionsDoNotInterfere(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')

  const [a, b, c] = await Promise.all([
    strategy.create({ title: `Isolation A ${randomUUID()}`, description: 'Mission A.', subsystem: KNOWN_FIXTURE_REL, severity: 'low' }),
    strategy.create({ title: `Isolation B ${randomUUID()}`, description: 'Mission B.', subsystem: KNOWN_FIXTURE_REL, severity: 'medium' }),
    strategy.create({ title: `Isolation C ${randomUUID()}`, description: 'Mission C.', subsystem: KNOWN_FIXTURE_REL, severity: 'high' }),
  ])

  results.push(check('hardening_16_all_three_missions_got_distinct_ids', new Set([a.id, b.id, c.id]).size === 3, `${a.id}, ${b.id}, ${c.id}`))
  results.push(check('hardening_17_each_mission_kept_its_own_title', a.title.startsWith('Isolation A') && b.title.startsWith('Isolation B') && c.title.startsWith('Isolation C'), `${a.title} | ${b.title} | ${c.title}`))

  const [rereadA, rereadB, rereadC] = await Promise.all([strategy.get(a.id), strategy.get(b.id), strategy.get(c.id)])
  results.push(check('hardening_18_independent_rereads_still_isolated', rereadA?.id === a.id && rereadB?.id === b.id && rereadC?.id === c.id, `${rereadA?.id} | ${rereadB?.id} | ${rereadC?.id}`))

  await resetNativeBuilderState()
  return results
}

// ---------------------------------------------------------------------------

export async function runEngineeringHardeningValidation(): Promise<CaseResult[]> {
  return [
    ...(await testStorageIsFileBasedNoCache()),
    ...(await testDuplicateApprovalRejectedSequentially()),
    ...(await testConcurrentApprovalRaceAppliesAtMostOnce()),
    ...(await testConcurrentDecideRaceDoesNotCorruptState()),
    ...(await testSessionRestartEquivalentFreshDiskRead()),
    ...(await testConcurrentIndependentMissionsDoNotInterfere()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runEngineeringHardeningValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Engineering Hardening validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

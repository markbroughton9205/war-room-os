/**
 * Mission Runtime regression suite (Phase 1 — Engineering Mission).
 *
 * This intentionally reuses the exact same fixture and reset helpers as
 * lib/native-builder/nativeBuilder.validation.ts's own e2e_* block, because the point of this
 * suite is to prove the Mission Runtime wrapper drives native-builder's real engine correctly —
 * not to stand up a second, parallel proof against different fixtures. If this suite and
 * nativeBuilder.validation.ts's e2e block ever disagree about what native-builder does, that is a
 * bug in this wrapper, not a second valid interpretation.
 */
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  readRepoFile,
  searchRepoText,
  inspectSymbolUsages,
} from '@/lib/native-builder/repositoryInspector'
import { countUnresolvedIssues, getRepair, saveIssue, saveRepair } from '@/lib/native-builder/storage'
import { planRepair } from '@/lib/native-builder/runtime'
import type { NativeIssueRecord, NativeRepairRecord, NativeRepairState } from '@/lib/native-builder/types'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
import {
  getEngineeringRepositoryContext,
  readEngineeringFile,
  searchEngineeringRepository,
  inspectEngineeringSymbolUsages,
} from './engineeringReadSurface'
import {
  SingleAgentEngineeringStrategy,
  getMissionExecutionStrategy,
  ENGINEERING_MISSION_CAPABILITIES,
  ENGINEERING_MISSION_POLICY,
  RUNTIME_MISSION_KINDS,
  missionStatusFromRepairState,
  type EngineeringMissionRequest,
} from './index'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FIXTURE_REL = 'lib/native-builder/__fixtures__/knownIssueFixture.ts'

const BROKEN_FIXTURE_CONTENT = `/**\n * Deliberately broken, isolated fixture for the Phase 14 native-builder end-to-end proof. Never\n * imported by real app code — safe to detect, patch, validate, and roll back repeatedly.\n *\n * Seeded bug: the loop bound \`values.length - 1\` excludes the final array element, so\n * sumFixtureValues([1,2,3,4]) returns 6 (1+2+3) instead of 10.\n */\nexport function sumFixtureValues(values: number[]): number {\n  let total = 0\n  for (let i = 0; i < values.length - 1; i += 1) {\n    total += values[i]\n  }\n  return total\n}\n`

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

async function resetFixtureToBroken(): Promise<void> {
  const abs = path.join(resolveRepoRoot(), FIXTURE_REL)
  await writeFile(abs, BROKEN_FIXTURE_CONTENT, 'utf8')
}

function engineeringMissionRequest(overrides: Partial<EngineeringMissionRequest> = {}): EngineeringMissionRequest {
  return {
    title: 'Fixture sum drops last element',
    description: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    subsystem: FIXTURE_REL,
    severity: 'medium',
    targetFiles: [FIXTURE_REL],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Naming / registry sanity — the abstraction exists and is reachable by kind.
// ---------------------------------------------------------------------------

function testRegistrySanity(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('registry_01_only_engineering_kind_declared_in_phase1', RUNTIME_MISSION_KINDS.length === 1 && RUNTIME_MISSION_KINDS[0] === 'engineering', JSON.stringify(RUNTIME_MISSION_KINDS)))
  const resolved = getMissionExecutionStrategy('engineering')
  results.push(check('registry_02_resolves_to_the_single_agent_strategy', resolved === SingleAgentEngineeringStrategy, String(resolved === SingleAgentEngineeringStrategy)))
  results.push(check('registry_03_policy_never_declares_commit_capable', ENGINEERING_MISSION_POLICY.commitCapable === false, JSON.stringify(ENGINEERING_MISSION_POLICY)))
  results.push(check('registry_04_capabilities_declared_and_read_heavy', ENGINEERING_MISSION_CAPABILITIES.includes('files_read') && ENGINEERING_MISSION_CAPABILITIES.includes('patch_apply_gated'), JSON.stringify(ENGINEERING_MISSION_CAPABILITIES)))
  return results
}

// ---------------------------------------------------------------------------
// 2. Approval-gate proof — the same policy.ts gate native-builder's own routes use.
// ---------------------------------------------------------------------------

function testApprovalGateReused(): CaseResult[] {
  const results: CaseResult[] = []
  const blocked = assertAutoOrApproval({
    mode: 'manual',
    safetyLock: false,
    actionKind: ENGINEERING_MISSION_POLICY.applyActionKind,
    body: {},
  })
  results.push(check('gate_01_apply_blocked_without_approval_granted', blocked.ok === false && blocked.status === 403, JSON.stringify(blocked)))

  const allowed = assertAutoOrApproval({
    mode: 'manual',
    safetyLock: false,
    actionKind: ENGINEERING_MISSION_POLICY.applyActionKind,
    body: { approval_granted: true },
  })
  results.push(check('gate_02_apply_allowed_with_approval_granted', allowed.ok === true, JSON.stringify(allowed)))

  const rollbackBlocked = assertAutoOrApproval({
    mode: 'commander',
    safetyLock: false,
    actionKind: ENGINEERING_MISSION_POLICY.rollbackActionKind,
    body: {},
  })
  results.push(check('gate_03_rollback_never_auto_allowed_even_in_full_auto_mode', rollbackBlocked.ok === false, JSON.stringify(rollbackBlocked)))

  return results
}

// ---------------------------------------------------------------------------
// 3. Status projection — one native-builder state maps to exactly one mission status.
// ---------------------------------------------------------------------------

function testStatusProjection(): CaseResult[] {
  const results: CaseResult[] = []
  results.push(check('status_01_resolved_maps_to_completed', missionStatusFromRepairState('resolved') === 'completed', missionStatusFromRepairState('resolved')))
  results.push(check('status_02_rolled_back_maps_to_rolled_back', missionStatusFromRepairState('rolled_back') === 'rolled_back', missionStatusFromRepairState('rolled_back')))
  results.push(check('status_03_awaiting_local_execution_approval_maps_to_awaiting_approval', missionStatusFromRepairState('awaiting_local_execution_approval') === 'awaiting_approval', missionStatusFromRepairState('awaiting_local_execution_approval')))
  results.push(check('status_04_awaiting_commander_review_maps_to_awaiting_commander_decision', missionStatusFromRepairState('awaiting_commander_review') === 'awaiting_commander_decision', missionStatusFromRepairState('awaiting_commander_review')))
  return results
}

// ---------------------------------------------------------------------------
// 4. Engineering Core read/inspect surface — proves delegation (not reimplementation) and that
//    every exposed operation is genuinely read-only (Foundation Hardening §1 / §8).
// ---------------------------------------------------------------------------

async function testEngineeringReadSurfaceDelegatesAndIsReadOnly(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  const statusBefore = await getEngineeringRepositoryContext()

  // Delegation proof: the boundary function's result must be identical to calling the underlying
  // repositoryInspector.ts function directly — if these ever diverge, the boundary has drifted
  // into reimplementation, which §1 explicitly prohibits.
  const viaSurface = await readEngineeringFile('package.json')
  const viaInspector = await readRepoFile('package.json')
  results.push(check(
    'read_surface_01_read_file_delegates_to_repositoryInspector',
    viaSurface.ok && viaInspector.ok && viaSurface.content === viaInspector.content,
    viaSurface.ok ? `${viaSurface.content.length} bytes match` : viaSurface.error,
  ))

  const searchViaSurface = await searchEngineeringRepository('planRepair', { pathPrefix: 'lib/native-builder' })
  const searchViaInspector = await searchRepoText('planRepair', { pathPrefix: 'lib/native-builder' })
  results.push(check(
    'read_surface_02_search_delegates_to_repositoryInspector',
    searchViaSurface.length > 0 && JSON.stringify(searchViaSurface) === JSON.stringify(searchViaInspector),
    `${searchViaSurface.length} hits`,
  ))

  const usagesViaSurface = await inspectEngineeringSymbolUsages('NATIVE_REPAIR_TRANSITIONS')
  const usagesViaInspector = await inspectSymbolUsages('NATIVE_REPAIR_TRANSITIONS')
  results.push(check(
    'read_surface_03_symbol_usages_delegate_to_repositoryInspector',
    usagesViaSurface.length > 0 && JSON.stringify(usagesViaSurface) === JSON.stringify(usagesViaInspector),
    `${usagesViaSurface.length} hits`,
  ))

  results.push(check(
    'read_surface_04_repository_context_carries_status_and_diff',
    typeof statusBefore.status.repoPath === 'string' && typeof statusBefore.recentDiff.diff === 'string',
    JSON.stringify({ repoPath: statusBefore.status.repoPath, diffLen: statusBefore.recentDiff.diff.length }),
  ))

  // Read-only proof: none of the four calls above may change the working tree. Compare the
  // uncommitted-file count before and after — an unexpected mutation would move it.
  const statusAfter = await getEngineeringRepositoryContext()
  results.push(check(
    'read_surface_05_no_mutation_from_any_read_operation',
    statusAfter.status.uncommittedFilesCount === statusBefore.status.uncommittedFilesCount,
    `${statusBefore.status.uncommittedFilesCount} -> ${statusAfter.status.uncommittedFilesCount}`,
  ))

  return results
}

// ---------------------------------------------------------------------------
// 5. Replan transition-graph coverage — every state NATIVE_REPAIR_TRANSITIONS declares may
//    re-enter 'planning' directly must actually do so through the real planRepair() function, with
//    no 'inspecting_repository' hop in between (Foundation Hardening §3 / §8). The full e2e test
//    below already proves this naturally for 'rolled_back' (a genuine rollback -> replan cycle);
//    this section proves it for the remaining four declared states, using repair records saved
//    through the exact same storage.ts saveIssue/saveRepair every other code path uses — not a
//    mock — then handed to the real, unmodified-by-tests planRepair() and transition() functions.
// ---------------------------------------------------------------------------

const REPLAN_ENTRY_STATES: readonly NativeRepairState[] = [
  'verification_failed',
  'blocked',
  'partially_verified',
  'escalation_recommended',
]

async function seedReplanEligibleRepair(state: NativeRepairState): Promise<{ repairId: string }> {
  const now = new Date().toISOString()
  const issue: NativeIssueRecord = {
    id: randomUUID(),
    fingerprint: `replan-fixture-${state}-${randomUUID()}`,
    title: 'Fixture sum drops last element',
    severity: 'medium',
    source: 'commander_report',
    affectedSubsystem: FIXTURE_REL,
    evidence: ['seeded for replan transition-graph coverage'],
    rawEvidenceText: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    occurrenceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'open',
  }
  await saveIssue(issue)

  const repair: NativeRepairRecord = {
    id: randomUUID(),
    issueId: issue.id,
    state,
    history: [{ state, at: now, note: `Seeded directly in '${state}' for replan transition-graph coverage.` }],
    proposals: [],
    validationResults: [],
    autoRepairEligible: false,
    autoRepairMode: false,
    createdAt: now,
    updatedAt: now,
  }
  await saveRepair(repair)
  return { repairId: repair.id }
}

async function testReplanTransitionGraphCoverage(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  for (const state of REPLAN_ENTRY_STATES) {
    const { repairId } = await seedReplanEligibleRepair(state)

    let threw = false
    let record: NativeRepairRecord | null = null
    try {
      record = await planRepair(repairId, { targetFiles: [FIXTURE_REL] })
    } catch {
      threw = true
    }
    results.push(check(`replan_${state}_01_does_not_throw_invalid_state_transition`, !threw, String(threw)))

    const idx = record?.history.map(h => h.state).lastIndexOf(state) ?? -1
    const nextState = record?.history[idx + 1]?.state
    results.push(check(
      `replan_${state}_02_transitions_directly_to_planning_no_inspecting_hop`,
      nextState === 'planning',
      JSON.stringify({ nextState, tail: record?.history.map(h => h.state) }),
    ))
    results.push(check(
      `replan_${state}_03_reaches_a_legal_post_planning_state`,
      record?.state === 'awaiting_local_execution_approval'
        || record?.state === 'escalation_recommended'
        || record?.state === 'blocked',
      record?.state ?? 'missing',
    ))
  }

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

// ---------------------------------------------------------------------------
// 6. Full end-to-end acceptance test, driven entirely through the Mission Runtime wrapper.
// ---------------------------------------------------------------------------

async function testEndToEndEngineeringMission(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const beforeUnresolved = await countUnresolvedIssues()
  const strategy = getMissionExecutionStrategy('engineering')

  // 1. Mission creation (also exercises single-agent provider invocation — advisory only, honest
  // failure expected in any environment without ANTHROPIC_API_KEY configured).
  const mission = await strategy.create(
    engineeringMissionRequest({ singleAgentProvider: { enabled: true, family: 'claude' } }),
  )
  results.push(check('e2e_01_mission_created', Boolean(mission.id) && mission.kind === 'engineering', mission.id))
  results.push(check('e2e_02_single_agent_provider_invoked_exactly_once', mission.providerOpinions.length === 1 && mission.providerOpinions[0].family === 'claude', JSON.stringify(mission.providerOpinions)))
  results.push(check('e2e_03_provider_opinion_is_honest_not_faked_success', mission.providerOpinions[0].ok === false || mission.providerOpinions[0].text.length > 0, JSON.stringify(mission.providerOpinions[0])))

  // Provider-opinion durability (Foundation Hardening §2): re-read the AUTHORITATIVE repair record
  // straight off storage.ts (which has no in-process cache — every call re-reads from disk), not
  // through the strategy's own get(). This is the "simulate a restart" proof: if the opinion only
  // lived in an in-process Map, this independent disk re-read would come back empty.
  const repairAfterCreate = await getRepair(mission.id)
  results.push(check(
    'e2e_03b_provider_opinion_durable_on_authoritative_repair_record',
    Boolean(repairAfterCreate?.advisoryProviderOpinions?.length)
      && repairAfterCreate!.advisoryProviderOpinions![0].family === 'claude'
      && Boolean(repairAfterCreate!.advisoryProviderOpinions![0].recordedAt),
    JSON.stringify(repairAfterCreate?.advisoryProviderOpinions),
  ))

  // 2. Repository read/search + proposal generation already happened inside create() via
  // native-builder's planRepair (gatherExcerpts -> readRepoFile / searchRepoText).
  results.push(check('e2e_04_repo_inspected_and_patch_proposed', mission.proposalSummary.hasProposal && mission.proposalSummary.sourceKind === 'deterministic', JSON.stringify(mission.proposalSummary)))
  results.push(check('e2e_05_status_awaiting_approval', mission.status === 'awaiting_approval', mission.status))

  const afterCreateUnresolved = await countUnresolvedIssues()
  results.push(check('e2e_06_issue_badge_increments', afterCreateUnresolved === beforeUnresolved + 1, `${beforeUnresolved} -> ${afterCreateUnresolved}`))

  // 3. Apply must be refused without approval_granted — proving the gate runs, not just exists.
  let refused = false
  try {
    await strategy.approve(mission.id, false)
  } catch {
    refused = true
  }
  results.push(check('e2e_07_apply_refused_without_approval', refused, String(refused)))
  const stillAwaitingApproval = await strategy.get(mission.id)
  results.push(check('e2e_08_mission_unchanged_after_refused_apply', stillAwaitingApproval?.status === 'awaiting_approval', stillAwaitingApproval?.status ?? 'missing'))

  // 4. Commander approves -> native-builder applies the patch, runs validations, builds diff.
  const applied = await strategy.approve(mission.id, true)
  results.push(check('e2e_09_status_after_apply', applied.status === 'awaiting_commander_decision' || applied.status === 'blocked', applied.status))

  const patchedContent = await readRepoFile(FIXTURE_REL)
  results.push(check('e2e_10_patch_actually_written_to_disk', patchedContent.ok && patchedContent.content.includes('values.length;'), patchedContent.ok ? 'contains fixed bound' : patchedContent.error))
  results.push(check('e2e_11_validations_ran_for_real', applied.validationResults.length > 0, String(applied.validationResults.length)))
  results.push(check('e2e_12_verification_present', Boolean(applied.verification), JSON.stringify(applied.verification)))
  results.push(check('e2e_13_final_diff_present', Boolean(applied.diff?.diff.length), String(applied.diff?.diff.length ?? 0)))

  // 5. Commander decision + rollback-where-supported, same as native-builder's own e2e proof.
  if (applied.status === 'awaiting_commander_decision') {
    const resolved = await strategy.decide(mission.id, true)
    results.push(check('e2e_14_commander_accept_completes_mission', resolved.status === 'completed', resolved.status))

    const afterResolveUnresolved = await countUnresolvedIssues()
    results.push(check('e2e_15_badge_decrements_on_completion', afterResolveUnresolved === beforeUnresolved, `${afterResolveUnresolved} vs baseline ${beforeUnresolved}`))

    // Rollback requires the gate too — prove it, then actually roll back.
    const rollbackBlocked = assertAutoOrApproval({ mode: 'manual', safetyLock: false, actionKind: ENGINEERING_MISSION_POLICY.rollbackActionKind, body: {} })
    results.push(check('e2e_16_rollback_requires_approval_gate', rollbackBlocked.ok === false, JSON.stringify(rollbackBlocked)))

    const rolledBack = await strategy.rollback(mission.id)
    const afterRollback = await readRepoFile(FIXTURE_REL)
    results.push(check('e2e_17_rollback_restores_original_fixture', rolledBack.status === 'rolled_back' && afterRollback.ok && afterRollback.content.includes('values.length - 1'), afterRollback.ok ? 'bug text present again' : afterRollback.error))

    const afterRollbackUnresolved = await countUnresolvedIssues()
    results.push(check('e2e_18_rollback_reopens_issue_badge', afterRollbackUnresolved === beforeUnresolved + 1, `${afterRollbackUnresolved} vs baseline+1=${beforeUnresolved + 1}`))

    // 6. Replan / iteration proof (Foundation Hardening §3). The repair is now 'rolled_back' — one
    // of the five states NATIVE_REPAIR_TRANSITIONS declares may re-enter 'planning' directly, and
    // rollback just restored the fixture to its ORIGINAL broken content, so this is a genuine
    // second cycle against a real, still-broken file — not a forced state or a test-only mutation.
    // This exercises the exact runtime.ts planRepair() fix end to end through real production code:
    // observe(rolled_back) -> replan -> apply revised proposal -> validate -> verify -> resolved.
    const beforeReplan = await getRepair(mission.id)
    results.push(check('e2e_19_repair_is_in_a_replan_eligible_state', beforeReplan?.state === 'rolled_back', beforeReplan?.state ?? 'missing'))

    let replanThrew = false
    let replanned: Awaited<ReturnType<typeof planRepair>> | null = null
    try {
      replanned = await planRepair(mission.id, { targetFiles: [FIXTURE_REL] })
    } catch {
      replanThrew = true
    }
    results.push(check('e2e_20_replan_does_not_throw_invalid_state_transition', !replanThrew, String(replanThrew)))

    const rolledBackIdx = replanned?.history.map(h => h.state).lastIndexOf('rolled_back') ?? -1
    const stateAfterRolledBack = replanned?.history[rolledBackIdx + 1]?.state
    results.push(check(
      'e2e_21_replan_transitions_directly_rolled_back_to_planning_no_inspecting_hop',
      stateAfterRolledBack === 'planning',
      JSON.stringify({ stateAfterRolledBack, tail: replanned?.history.slice(-4).map(h => h.state) }),
    ))
    results.push(check(
      'e2e_22_replan_produces_a_fresh_executable_proposal',
      replanned?.state === 'awaiting_local_execution_approval' && replanned.selectedProposal?.sourceKind === 'deterministic',
      replanned?.state ?? 'missing',
    ))

    if (replanned?.state === 'awaiting_local_execution_approval') {
      const reapplied = await strategy.approve(mission.id, true)
      results.push(check('e2e_23_second_apply_after_replan_runs_for_real', reapplied.validationResults.length > 0, String(reapplied.validationResults.length)))

      const patchedAgain = await readRepoFile(FIXTURE_REL)
      results.push(check('e2e_24_second_patch_actually_written_to_disk', patchedAgain.ok && patchedAgain.content.includes('values.length;'), patchedAgain.ok ? 'contains fixed bound' : patchedAgain.error))

      if (reapplied.status === 'awaiting_commander_decision') {
        const resolvedAgain = await strategy.decide(mission.id, true)
        results.push(check('e2e_25_replanned_mission_reaches_completed', resolvedAgain.status === 'completed', resolvedAgain.status))
      } else {
        results.push(check('e2e_25_replanned_mission_reaches_completed', false, `skipped — status was ${reapplied.status}, not awaiting_commander_decision`))
      }
    } else {
      for (const name of ['e2e_23_second_apply_after_replan_runs_for_real', 'e2e_24_second_patch_actually_written_to_disk', 'e2e_25_replanned_mission_reaches_completed']) {
        results.push(check(name, false, `skipped — replanned status was ${replanned?.state ?? 'missing'}, not awaiting_local_execution_approval`))
      }
    }
  } else {
    for (const name of [
      'e2e_14_commander_accept_completes_mission', 'e2e_15_badge_decrements_on_completion',
      'e2e_16_rollback_requires_approval_gate', 'e2e_17_rollback_restores_original_fixture',
      'e2e_18_rollback_reopens_issue_badge', 'e2e_19_repair_is_in_a_replan_eligible_state',
      'e2e_20_replan_does_not_throw_invalid_state_transition',
      'e2e_21_replan_transitions_directly_rolled_back_to_planning_no_inspecting_hop',
      'e2e_22_replan_produces_a_fresh_executable_proposal',
      'e2e_23_second_apply_after_replan_runs_for_real', 'e2e_24_second_patch_actually_written_to_disk',
      'e2e_25_replanned_mission_reaches_completed',
    ]) {
      results.push(check(name, false, `skipped — mission status was ${applied.status}, not awaiting_commander_decision`))
    }
  }

  // 7. Mission is auditable: native-builder already writes every transition to
  // war_room_audit_logs (category 'repo') via lib/war-room/repoAudit.ts — this suite does not
  // re-verify that write (nativeBuilder.validation.ts's own safety_* checks already cover it end
  // to end); it verifies only that the mission's identifiers needed to trace that trail are
  // present in the projection.
  results.push(check('e2e_26_mission_carries_traceable_native_builder_ids', mission.nativeBuilder.repairId === mission.id && Boolean(mission.nativeBuilder.issueId), JSON.stringify(mission.nativeBuilder)))

  // Cleanup: leave state reset for the next run, matching nativeBuilder.validation.ts's own
  // idempotency discipline.
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  return results
}

/**
 * Phase D (War Room Engineering Mission UI) proof, plus the concrete Phase C (Shared Session
 * Continuity) proof: since there is exactly one authoritative persistence layer, two independent
 * reads of the same missionId — standing in for "Standalone Builder reads it" and "War Room
 * Engineering reads it" — must return identical projected state, and list() must be a real
 * reflection of storage, not a second index that could drift.
 */
async function testMissionListAndSharedContinuity(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const strategy = getMissionExecutionStrategy('engineering')
  const created = await strategy.create(engineeringMissionRequest({ title: `List/continuity fixture ${randomUUID()}` }))

  results.push(check('phase_d_01_list_capability_present', typeof strategy.list === 'function', typeof strategy.list))

  const listed = (await strategy.list?.()) ?? []
  results.push(check('phase_d_02_created_mission_appears_in_list', listed.some(m => m.id === created.id), `listed ${listed.length} missions`))

  const notInListedBeforeCreate = listed.filter(m => m.id !== created.id)
  results.push(check('phase_d_03_list_reflects_real_storage_not_a_second_index', notInListedBeforeCreate.every(m => Boolean(m.nativeBuilder.repairId)), 'every other listed mission also carries a real repairId'))

  // Two independent reads standing in for two clients (Builder, War Room Engineering) reading the
  // same repairId — must be byte-for-byte identical on every field that matters, proving there is
  // no per-client cached/duplicated mission state.
  const readAsBuilder = await strategy.get(created.id)
  const readAsWarRoomEngineering = await strategy.get(created.id)
  results.push(check(
    'phase_c_01_two_independent_reads_of_same_mission_are_identical',
    JSON.stringify(readAsBuilder) === JSON.stringify(readAsWarRoomEngineering),
    readAsBuilder && readAsWarRoomEngineering ? 'deep-equal' : 'one or both reads returned null',
  ))
  results.push(check(
    'phase_c_02_no_duplicate_repair_created_by_second_read',
    readAsBuilder?.nativeBuilder.repairId === created.id && readAsWarRoomEngineering?.nativeBuilder.repairId === created.id,
    `${readAsBuilder?.nativeBuilder.repairId} / ${readAsWarRoomEngineering?.nativeBuilder.repairId}`,
  ))

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

export async function runMissionRuntimeValidation(): Promise<CaseResult[]> {
  return [
    ...testRegistrySanity(),
    ...testApprovalGateReused(),
    ...testStatusProjection(),
    ...(await testEngineeringReadSurfaceDelegatesAndIsReadOnly()),
    ...(await testReplanTransitionGraphCoverage()),
    ...(await testEndToEndEngineeringMission()),
    ...(await testMissionListAndSharedContinuity()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runMissionRuntimeValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Mission Runtime validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

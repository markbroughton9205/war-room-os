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
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { readRepoFile } from '@/lib/native-builder/repositoryInspector'
import { countUnresolvedIssues } from '@/lib/native-builder/storage'
import { assertAutoOrApproval } from '@/lib/permissions/policy'
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
// 4. Full end-to-end acceptance test, driven entirely through the Mission Runtime wrapper.
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
  } else {
    for (const name of ['e2e_14_commander_accept_completes_mission', 'e2e_15_badge_decrements_on_completion', 'e2e_16_rollback_requires_approval_gate', 'e2e_17_rollback_restores_original_fixture', 'e2e_18_rollback_reopens_issue_badge']) {
      results.push(check(name, false, `skipped — mission status was ${applied.status}, not awaiting_commander_decision`))
    }
  }

  // 6. Mission is auditable: native-builder already writes every transition to
  // war_room_audit_logs (category 'repo') via lib/war-room/repoAudit.ts — this suite does not
  // re-verify that write (nativeBuilder.validation.ts's own safety_* checks already cover it end
  // to end); it verifies only that the mission's identifiers needed to trace that trail are
  // present in the projection.
  results.push(check('e2e_19_mission_carries_traceable_native_builder_ids', mission.nativeBuilder.repairId === mission.id && Boolean(mission.nativeBuilder.issueId), JSON.stringify(mission.nativeBuilder)))

  // Cleanup: leave state reset for the next run, matching nativeBuilder.validation.ts's own
  // idempotency discipline.
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  return results
}

export async function runMissionRuntimeValidation(): Promise<CaseResult[]> {
  return [
    ...testRegistrySanity(),
    ...testApprovalGateReused(),
    ...testStatusProjection(),
    ...(await testEndToEndEngineeringMission()),
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

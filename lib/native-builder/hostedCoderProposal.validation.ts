/**
 * Hosted-model coder proposal source — permanent regression suite (Engineering Core: General-
 * Purpose Coder Proposal Generation).
 *
 * Every test here drives the REAL production pipeline — reportIssue(), planRepair(),
 * approveAndApply(), commanderResolve(), validatePatchPolicy(), requestHostedModelProposal() —
 * exactly as lib/mission-runtime/engineeringStrategy.ts and the real API routes do. The one thing
 * standing in for reality is the hosted provider's network call itself: each test injects a
 * controlled, clearly-labeled FIXTURE invoke function in place of
 * lib/council/providerDirectCall.ts's invokeDirectCouncilProvider (the same
 * NativeCouncilInvokeFn dependency-injection seam requestCouncilOpinions already uses for real
 * Council calls). This is a fixture standing in for the network edge, not a mock of
 * native-builder's own logic — never call any result in this file a live-provider test; see this
 * session's final report for the honest LIVE PROVIDER VERIFICATION determination.
 */
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { readRepoFile } from './repositoryInspector'
import { reportIssue, planRepair, approveAndApply, commanderResolve } from './runtime'
import { issueFromCommanderReport } from './issueIngest'
import { validatePatchPolicy } from './patchPolicy'
import { requestHostedModelProposal, type NativeCouncilInvokeFn } from './repairPlanner'
import type { NativeIssueRecord, NativeRepairProposal } from './types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const FIXTURE_REL = 'lib/native-builder/__fixtures__/novelCoderFixture.ts'

const BROKEN_FIXTURE_CONTENT = `/**\n * Deliberately broken, isolated fixture for the hosted-model coder proposal regression suite\n * (General-Purpose Coder Proposal Generation phase). Never imported by real app code — safe to\n * detect, patch, validate, and roll back repeatedly, same discipline as knownIssueFixture.ts.\n *\n * This bug's shape does NOT match either existing deterministic template\n * (off_by_one_loop_bound_length_minus_one / duplicate_import_line — see repairPlanner.ts), so\n * buildDeterministicProposal() correctly returns null for it. That is the point: any proposal\n * selected for a repair against this fixture proves it came from the hosted-model path, not a\n * template match — this is what "previously unseen coding task" means operationally.\n *\n * Seeded bug: uses \`>\` instead of \`>=\`, so isAdult(18) incorrectly returns false.\n */\nexport function isAdult(age: number): boolean {\n  return age > 18\n}\n`

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

async function resetFixtureToBroken(): Promise<void> {
  const abs = path.join(resolveRepoRoot(), FIXTURE_REL)
  await writeFile(abs, BROKEN_FIXTURE_CONTENT, 'utf8')
}

async function seedNovelIssueAndRepair() {
  const input = issueFromCommanderReport({
    title: 'isAdult excludes the boundary age of 18',
    description: 'isAdult(18) returns false; the comparison should be inclusive (>=), not exclusive (>).',
    subsystem: FIXTURE_REL,
    severity: 'medium',
  })
  const { issue, repair } = await reportIssue(input)
  if (!repair) throw new Error('Expected a fresh repair for a brand-new fingerprint.')
  return { issue, repair }
}

/** A FIXTURE standing in for the hosted provider network call — never a live call. Always reports
 * ok:true with a caller-supplied text body. */
function fixtureInvokeReturning(text: string): NativeCouncilInvokeFn {
  return async () => ({ ok: true, text })
}

/** Same fixture seam, honest failure — stands in for a real "provider unavailable / missing key /
 * timeout" outcome, exactly the shape invokeDirectCouncilProvider itself returns on those. */
function fixtureInvokeFailing(error: string): NativeCouncilInvokeFn {
  return async () => ({ ok: false, text: '', error })
}

function validProposalJson(matchText: string, replacementText: string, relevantFile = FIXTURE_REL): string {
  return JSON.stringify({
    diagnosis: 'Comparison operator excludes the boundary age; should be inclusive.',
    confidence: 'high',
    relevantFiles: [relevantFile],
    plannedChanges: [
      { file: relevantFile, reason: 'Boundary-inclusive comparison.', operation: 'replace_range', matchText, replacementText },
    ],
    risks: ['Novel proposal — no prior deterministic template exists for this bug class.'],
    rollbackPlan: 'Restore the pre-patch file content from the native-builder snapshot for this repair.',
  })
}

// ---------------------------------------------------------------------------
// 1. Valid hosted proposal — the full architecture diagram, real code at every stage.
// ---------------------------------------------------------------------------

async function testValidHostedProposalFullPipeline(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const { repair } = await seedNovelIssueAndRepair()
  const invoke = fixtureInvokeReturning(validProposalJson('return age > 18', 'return age >= 18'))

  const planned = await planRepair(repair.id, {
    targetFiles: [FIXTURE_REL],
    hostedCoder: { family: 'claude', invoke },
    commanderRequestText: 'Fix isAdult to be inclusive of the boundary age.',
  })
  results.push(check('valid_01_deterministic_template_does_not_match_novel_bug', planned.proposals.every(p => p.sourceKind !== 'deterministic'), JSON.stringify(planned.proposals.map(p => p.sourceKind))))
  results.push(check('valid_02_hosted_proposal_selected', planned.selectedProposal?.sourceKind === 'hosted_model' && planned.selectedProposal.proposerId === 'hosted:claude', planned.selectedProposal?.proposerId ?? 'none'))
  results.push(check('valid_03_status_awaiting_approval', planned.state === 'awaiting_local_execution_approval', planned.state))

  const applied = await approveAndApply(planned.id, true)
  results.push(check('valid_04_validations_ran_for_real', applied.validationResults.length > 0 && applied.validationResults[0].operation.id === 'typecheck', String(applied.validationResults.length)))
  results.push(check('valid_05_verification_not_blocked', applied.verification?.status !== 'verification_blocked', JSON.stringify(applied.verification)))

  const patched = await readRepoFile(FIXTURE_REL)
  results.push(check('valid_06_patch_actually_written_to_disk', patched.ok && patched.content.includes('age >= 18'), patched.ok ? 'contains fixed comparison' : patched.error))

  if (applied.state === 'awaiting_commander_review' || applied.state === 'partially_verified') {
    const resolved = await commanderResolve(applied.id, true)
    results.push(check('valid_07_commander_accept_completes_mission', resolved.state === 'resolved', resolved.state))
  } else {
    results.push(check('valid_07_commander_accept_completes_mission', false, `skipped — applied state was ${applied.state}`))
  }

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

// ---------------------------------------------------------------------------
// 2. Safety rejection tests — invalid structured output, invalid file, ambiguous anchor, oversized
//    patch. Each proves the EXISTING parser/validator rejects a hosted-sourced proposal honestly,
//    with no mutation.
// ---------------------------------------------------------------------------

async function testInvalidStructuredOutputRejected(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetFixtureToBroken()
  const before = await readRepoFile(FIXTURE_REL)

  const issue: NativeIssueRecord = {
    id: 'fixture-issue',
    fingerprint: 'fixture-fingerprint',
    title: 'isAdult excludes the boundary age of 18',
    severity: 'medium',
    source: 'commander_report',
    affectedSubsystem: FIXTURE_REL,
    evidence: [],
    rawEvidenceText: 'isAdult(18) returns false.',
    occurrenceCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: 'open',
  }
  const excerpts = [{ relPath: FIXTURE_REL, content: before.ok ? before.content : BROKEN_FIXTURE_CONTENT }]

  const outcome = await requestHostedModelProposal(issue, excerpts, 'claude', fixtureInvokeReturning('I am not able to help with that request.'))
  results.push(check('invalid_json_01_rejected_as_insufficient', outcome.status === 'insufficient', JSON.stringify(outcome)))

  const after = await readRepoFile(FIXTURE_REL)
  results.push(check('invalid_json_02_no_mutation', before.ok && after.ok && before.content === after.content, 'file unchanged'))

  return results
}

async function testInvalidFileRejected(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetFixtureToBroken()
  const before = await readRepoFile(FIXTURE_REL)

  const issue: NativeIssueRecord = {
    id: 'fixture-issue',
    fingerprint: 'fixture-fingerprint',
    title: 'isAdult excludes the boundary age of 18',
    severity: 'medium',
    source: 'commander_report',
    affectedSubsystem: FIXTURE_REL,
    evidence: [],
    rawEvidenceText: 'isAdult(18) returns false.',
    occurrenceCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: 'open',
  }
  const excerpts = [{ relPath: FIXTURE_REL, content: before.ok ? before.content : BROKEN_FIXTURE_CONTENT }]

  // Case A: the parser itself — a file the provider names that was never in the given excerpts
  // (i.e. never actually inspected) cannot become a planned change; tryParseModelProposal's
  // byPath lookup fails and the change is silently dropped, leaving no executable proposal.
  const proposalForUninspectedFile = validProposalJson('return age > 18', 'return age >= 18', 'lib/native-builder/runtime.ts')
  const outcomeA = await requestHostedModelProposal(issue, excerpts, 'claude', fixtureInvokeReturning(proposalForUninspectedFile))
  results.push(check('invalid_file_01_uninspected_file_rejected_by_parser', outcomeA.status === 'insufficient', JSON.stringify(outcomeA)))

  // Case B: the downstream policy layer — a hand-built hosted-sourced proposal that DOES target a
  // real, in-scope file, but one on the path denylist (.env). Proves patchPolicy.ts independently
  // rejects a hosted proposal, defense in depth, regardless of what the parser already filtered.
  const deniedProposal: NativeRepairProposal = {
    issueId: issue.id,
    sourceKind: 'hosted_model',
    proposerId: 'hosted:claude',
    diagnosis: 'Adversarial: proposes editing a denylisted file.',
    confidence: 'high',
    relevantFiles: ['.env'],
    plannedChanges: [{
      file: '.env',
      reason: 'n/a',
      operation: 'replace_range',
      patch: { operation: 'replace_range', file: '.env', expectedOriginalHash: 'deadbeef', matchText: 'X', replacementText: 'Y' },
    }],
    validations: [{ id: 'typecheck' }],
    risks: [],
    rollbackPlan: 'n/a',
    generatedAt: new Date().toISOString(),
  }
  const policyResult = validatePatchPolicy(deniedProposal)
  results.push(check('invalid_file_02_denied_path_rejected_by_policy', !policyResult.ok && policyResult.violations.some(v => v.rule === 'path_denylist'), JSON.stringify(policyResult)))

  const after = await readRepoFile(FIXTURE_REL)
  results.push(check('invalid_file_03_no_mutation', before.ok && after.ok && before.content === after.content, 'file unchanged'))

  return results
}

async function testAmbiguousAnchorRejected(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetFixtureToBroken()
  const before = await readRepoFile(FIXTURE_REL)

  const issue: NativeIssueRecord = {
    id: 'fixture-issue',
    fingerprint: 'fixture-fingerprint',
    title: 'Ambiguous anchor test',
    severity: 'medium',
    source: 'commander_report',
    affectedSubsystem: FIXTURE_REL,
    evidence: [],
    rawEvidenceText: 'n/a',
    occurrenceCount: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: 'open',
  }
  // Fabricated excerpt content where the proposed anchor text appears twice — the parser
  // (tryParseModelProposal) must refuse to build a planned change from a non-unique match.
  const ambiguousContent = 'const a = 1\nconst b = 1\n'
  const excerpts = [{ relPath: FIXTURE_REL, content: ambiguousContent }]

  const proposalJson = JSON.stringify({
    diagnosis: 'Ambiguous anchor.',
    confidence: 'high',
    relevantFiles: [FIXTURE_REL],
    plannedChanges: [{ file: FIXTURE_REL, reason: 'n/a', operation: 'replace_range', matchText: 'const', replacementText: 'let' }],
    risks: [],
    rollbackPlan: 'n/a',
  })
  const outcome = await requestHostedModelProposal(issue, excerpts, 'claude', fixtureInvokeReturning(proposalJson))
  results.push(check('ambiguous_anchor_01_rejected_by_parser', outcome.status === 'insufficient', JSON.stringify(outcome)))

  const after = await readRepoFile(FIXTURE_REL)
  results.push(check('ambiguous_anchor_02_no_mutation', before.ok && after.ok && before.content === after.content, 'file unchanged'))

  return results
}

async function testOversizedPatchRejected(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  const bigReplacement = Array.from({ length: 200 }, (_, i) => `// line ${i}`).join('\n')
  const oversized: NativeRepairProposal = {
    issueId: 'fixture-issue',
    sourceKind: 'hosted_model',
    proposerId: 'hosted:claude',
    diagnosis: 'Adversarial: oversized patch.',
    confidence: 'high',
    relevantFiles: [FIXTURE_REL],
    plannedChanges: [{
      file: FIXTURE_REL,
      reason: 'n/a',
      operation: 'replace_range',
      patch: { operation: 'replace_range', file: FIXTURE_REL, expectedOriginalHash: 'deadbeef', matchText: 'return age > 18', replacementText: bigReplacement },
    }],
    validations: [{ id: 'typecheck' }],
    risks: [],
    rollbackPlan: 'n/a',
    generatedAt: new Date().toISOString(),
  }
  const result = validatePatchPolicy(oversized)
  results.push(check('oversized_01_rejected_by_policy', !result.ok && result.violations.some(v => v.rule === 'max_lines_exceeded'), JSON.stringify(result)))
  return results
}

// ---------------------------------------------------------------------------
// 3. Stale proposal — file drifted after the proposal was generated, before it was applied.
// ---------------------------------------------------------------------------

async function testStaleProposalRejected(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const { repair } = await seedNovelIssueAndRepair()
  const invoke = fixtureInvokeReturning(validProposalJson('return age > 18', 'return age >= 18'))
  const planned = await planRepair(repair.id, { targetFiles: [FIXTURE_REL], hostedCoder: { family: 'claude', invoke } })
  results.push(check('stale_01_hosted_proposal_planned', planned.selectedProposal?.sourceKind === 'hosted_model', planned.selectedProposal?.sourceKind ?? 'none'))

  // Simulate a concurrent edit landing after the proposal's expectedOriginalHash was computed but
  // before Commander approval applies it.
  const driftedContent = BROKEN_FIXTURE_CONTENT.replace('return age > 18', 'return age > 18 // edited concurrently')
  await writeFile(path.join(resolveRepoRoot(), FIXTURE_REL), driftedContent, 'utf8')

  const applied = await approveAndApply(planned.id, true)
  results.push(check('stale_02_rejected_stale_hash', applied.state === 'blocked', applied.state))

  const after = await readRepoFile(FIXTURE_REL)
  results.push(check('stale_03_no_mutation_file_is_the_drifted_version', after.ok && after.content === driftedContent, after.ok ? 'matches drifted content' : after.error))

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

// ---------------------------------------------------------------------------
// 4. Validation failure + replan, with the hosted provider receiving real failure evidence.
// ---------------------------------------------------------------------------

async function testValidationFailureThenReplanWithEvidence(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()

  const { repair } = await seedNovelIssueAndRepair()

  const BAD_REPLACEMENT = "return age >= 18 ? 'adult' : false" // type error: string | boolean vs boolean
  let callCount = 0
  let secondCallSawFailureEvidence = false
  const statefulInvoke: NativeCouncilInvokeFn = async (_family, prompt) => {
    callCount += 1
    if (callCount === 1) {
      return { ok: true, text: validProposalJson('return age > 18', BAD_REPLACEMENT) }
    }
    secondCallSawFailureEvidence = prompt.includes('FAILED validation') && prompt.includes('typecheck')
    return { ok: true, text: validProposalJson(BAD_REPLACEMENT, 'return age >= 18') }
  }

  // Attempt 1: hosted proposal applies cleanly but fails typecheck for real.
  const planned1 = await planRepair(repair.id, { targetFiles: [FIXTURE_REL], hostedCoder: { family: 'claude', invoke: statefulInvoke } })
  results.push(check('replan_01_attempt_one_planned', planned1.selectedProposal?.sourceKind === 'hosted_model', planned1.state))

  const applied1 = await approveAndApply(planned1.id, true)
  results.push(check('replan_02_attempt_one_applies_but_fails_typecheck', applied1.verification?.status === 'verification_blocked', JSON.stringify(applied1.verification)))
  results.push(check('replan_03_attempt_one_lands_verification_failed', applied1.state === 'verification_failed', applied1.state))

  // Replan: the same repairId, now in 'verification_failed' — one of the five real replan-entry
  // states (Foundation Hardening). The hosted coder is called again; this time it must receive the
  // real failure evidence from attempt 1.
  const planned2 = await planRepair(applied1.id, { targetFiles: [FIXTURE_REL], hostedCoder: { family: 'claude', invoke: statefulInvoke } })
  results.push(check('replan_04_provider_called_exactly_twice', callCount === 2, String(callCount)))
  results.push(check('replan_05_second_call_received_real_failure_evidence', secondCallSawFailureEvidence, String(secondCallSawFailureEvidence)))
  results.push(check('replan_06_attempt_two_planned', planned2.selectedProposal?.sourceKind === 'hosted_model', planned2.state))

  const applied2 = await approveAndApply(planned2.id, true)
  results.push(check('replan_07_attempt_two_passes_validation', applied2.verification?.status !== 'verification_blocked', JSON.stringify(applied2.verification)))

  const patched = await readRepoFile(FIXTURE_REL)
  results.push(check('replan_08_final_content_is_the_corrected_fix', patched.ok && patched.content.includes('return age >= 18') && !patched.content.includes("'adult'"), patched.ok ? patched.content.slice(0, 200) : patched.error))

  if (applied2.state === 'awaiting_commander_review' || applied2.state === 'partially_verified') {
    const resolved = await commanderResolve(applied2.id, true)
    results.push(check('replan_09_commander_accepts_replanned_mission', resolved.state === 'resolved', resolved.state))
  } else {
    results.push(check('replan_09_commander_accepts_replanned_mission', false, `skipped — state was ${applied2.state}`))
  }

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

// ---------------------------------------------------------------------------
// 5. Provider failure — honest, no fabricated proposal, repository unchanged.
// ---------------------------------------------------------------------------

async function testProviderFailureIsHonest(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  await resetFixtureToBroken()
  const before = await readRepoFile(FIXTURE_REL)

  const { repair } = await seedNovelIssueAndRepair()
  const invoke = fixtureInvokeFailing('ANTHROPIC_API_KEY not configured')

  const planned = await planRepair(repair.id, { targetFiles: [FIXTURE_REL], hostedCoder: { family: 'claude', invoke } })
  results.push(check('provider_failure_01_no_hosted_proposal_fabricated', planned.proposals.every(p => p.sourceKind !== 'hosted_model'), JSON.stringify(planned.proposals.map(p => p.sourceKind))))
  results.push(check('provider_failure_02_no_deterministic_match_either', !planned.selectedProposal, planned.selectedProposal?.sourceKind ?? 'none selected'))
  results.push(check('provider_failure_03_repair_lands_blocked', planned.state === 'blocked', planned.state))

  const after = await readRepoFile(FIXTURE_REL)
  results.push(check('provider_failure_04_no_mutation', before.ok && after.ok && before.content === after.content, 'file unchanged'))

  await resetNativeBuilderState()
  await resetFixtureToBroken()
  return results
}

// ---------------------------------------------------------------------------

export async function runHostedCoderProposalValidation(): Promise<CaseResult[]> {
  return [
    ...(await testValidHostedProposalFullPipeline()),
    ...(await testInvalidStructuredOutputRejected()),
    ...(await testInvalidFileRejected()),
    ...(await testAmbiguousAnchorRejected()),
    ...(await testOversizedPatchRejected()),
    ...(await testStaleProposalRejected()),
    ...(await testValidationFailureThenReplanWithEvidence()),
    ...(await testProviderFailureIsHonest()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runHostedCoderProposalValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(r => !r.pass)
  console.log(`Hosted coder proposal validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

/**
 * Phase G (Coder Agent Iteration) regression suite. Proves the bounded auto-replan-on-failure
 * policy against real code paths — no fixture invoke functions needed here, since a mission whose
 * subsystem doesn't match any deterministic template and has no hosted coder configured naturally
 * lands in a real 'blocked' state with no proposal (the same honest "nothing matched" outcome
 * hostedCoderProposal.validation.ts's provider_failure_03 case already established), giving a
 * real, repeatable failure state to iterate against without touching a live provider.
 */
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NOVEL_FIXTURE_REL = 'lib/native-builder/__fixtures__/novelCoderFixture.ts'

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

async function createUnmatchedMission() {
  const strategy = getMissionExecutionStrategy('engineering')
  return strategy.create({
    title: `Iteration fixture ${randomUUID()}`,
    description: 'Deliberately does not match any deterministic template — proves a real, repeatable blocked state.',
    subsystem: NOVEL_FIXTURE_REL,
    severity: 'medium',
    targetFiles: [NOVEL_FIXTURE_REL],
  })
}

async function testNotEligibleIsHonestNoOp(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const strategy = getMissionExecutionStrategy('engineering')
  const created = await strategy.create({
    title: 'Fixture sum drops last element',
    description: 'sumFixtureValues([1,2,3,4]) returns 6 instead of 10 — off-by-one loop bound.',
    subsystem: 'lib/native-builder/__fixtures__/knownIssueFixture.ts',
    severity: 'medium',
  })
  results.push(check('iter_01_precondition_awaiting_approval', created.status === 'awaiting_approval', created.status))

  results.push(check('iter_02_capability_present', typeof strategy.autoIterate === 'function', typeof strategy.autoIterate))

  const attempted = await strategy.autoIterate?.(created.id)
  results.push(check('iter_03_not_eligible_status_unchanged', attempted?.status === 'awaiting_approval', attempted?.status ?? 'missing'))
  results.push(check('iter_04_attempts_used_unchanged_on_ineligible', attempted?.iterationPolicy.attemptsUsed === 0, String(attempted?.iterationPolicy.attemptsUsed)))
  results.push(check('iter_05_ineligible_attempt_still_recorded_honestly', attempted?.iterationAttempts.length === 1 && attempted.iterationAttempts[0].evidenceSummary.includes('not eligible'), JSON.stringify(attempted?.iterationAttempts)))
  results.push(check('iter_06_no_proposal_fabricated', attempted?.proposalSummary.hasProposal === created.proposalSummary.hasProposal, `${created.proposalSummary.hasProposal} -> ${attempted?.proposalSummary.hasProposal}`))

  await resetNativeBuilderState()
  return results
}

async function testPausedIsHonestNoOp(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const created = await createUnmatchedMission()
  results.push(check('iter_07_precondition_blocked', created.status === 'blocked', created.status))

  const strategy = getMissionExecutionStrategy('engineering')
  const paused = await strategy.autoIterate?.(created.id, { paused: true })
  results.push(check('iter_08_paused_no_op', paused?.iterationPolicy.attemptsUsed === 0, String(paused?.iterationPolicy.attemptsUsed)))
  results.push(check('iter_09_paused_flag_persisted', paused?.iterationPolicy.paused === true, String(paused?.iterationPolicy.paused)))
  results.push(check('iter_10_paused_attempt_recorded', paused?.iterationAttempts.some(a => a.evidenceSummary.includes('paused')) ?? false, JSON.stringify(paused?.iterationAttempts)))

  // Confirm a second call, still paused (policy persisted), is also a no-op without re-passing paused:true.
  const stillPaused = await strategy.autoIterate?.(created.id)
  results.push(check('iter_11_paused_persists_across_calls', stillPaused?.iterationPolicy.attemptsUsed === 0, String(stillPaused?.iterationPolicy.attemptsUsed)))

  await resetNativeBuilderState()
  return results
}

async function testRealBoundedIterationAndBudgetExhaustion(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  await resetNativeBuilderState()
  const created = await createUnmatchedMission()
  const strategy = getMissionExecutionStrategy('engineering')

  results.push(check('iter_12_precondition_blocked', created.status === 'blocked', created.status))

  const first = await strategy.autoIterate?.(created.id, { maxAttempts: 2 })
  results.push(check('iter_13_first_real_attempt_recorded', first?.iterationAttempts.length === 1, String(first?.iterationAttempts.length)))
  results.push(check('iter_14_first_attempt_used_incremented', first?.iterationPolicy.attemptsUsed === 1, String(first?.iterationPolicy.attemptsUsed)))
  results.push(check('iter_15_first_attempt_evidence_present', Boolean(first?.iterationAttempts[0]?.evidenceSummary), first?.iterationAttempts[0]?.evidenceSummary?.slice(0, 80) ?? 'missing'))
  results.push(check('iter_16_replan_did_not_apply_anything', first?.proposalSummary.hasProposal === false && !first?.raw.repair.diffEvidence, `hasProposal=${first?.proposalSummary.hasProposal}`))
  results.push(check('iter_17_still_blocked_no_match_found', first?.status === 'blocked', first?.status ?? 'missing'))

  const second = await strategy.autoIterate?.(created.id)
  results.push(check('iter_18_second_attempt_recorded', second?.iterationAttempts.length === 2, String(second?.iterationAttempts.length)))
  results.push(check('iter_19_second_attempt_used_incremented', second?.iterationPolicy.attemptsUsed === 2, String(second?.iterationPolicy.attemptsUsed)))

  // Budget is now exhausted (maxAttempts=2, attemptsUsed=2).
  const third = await strategy.autoIterate?.(created.id)
  results.push(check('iter_20_budget_exhausted_no_further_replan', third?.iterationAttempts.length === 3, String(third?.iterationAttempts.length)))
  results.push(check('iter_21_budget_exhausted_attempts_used_unchanged', third?.iterationPolicy.attemptsUsed === 2, String(third?.iterationPolicy.attemptsUsed)))
  results.push(check('iter_22_budget_exhausted_message_honest', third?.iterationAttempts[2]?.evidenceSummary.includes('exhausted') ?? false, third?.iterationAttempts[2]?.evidenceSummary ?? 'missing'))

  // Never auto-applied at any point — approval remains required and untouched.
  results.push(check('iter_23_never_auto_applied_across_all_attempts', third?.raw.repair.diffEvidence === undefined, 'diffEvidence absent throughout'))

  await resetNativeBuilderState()
  return results
}

export async function runEngineeringIterationValidation(): Promise<CaseResult[]> {
  return [
    ...(await testNotEligibleIsHonestNoOp()),
    ...(await testPausedIsHonestNoOp()),
    ...(await testRealBoundedIterationAndBudgetExhaustion()),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runEngineeringIterationValidation()
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`)
  const failed = results.filter(r => !r.pass)
  console.log(`Engineering Iteration validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

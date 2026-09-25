/**
 * Proofs for Foundry engineering reasoning.
 * Disposable fixtures only. Does not commit, push, deploy, spend, or change a Mission Contract.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_AGENT_ROLES, type FoundryCommandCenterGraph } from './foundryAgentTypes'
import { buildTaskGraph, ticketManagerGraphSeeds } from './foundryTaskGraph'
import { draftStandaloneContracts, sealAcceptanceContract, sealMissionContract } from './foundryMissionContract'
import { applyReplan } from './foundryReplanEngine'
import { evaluateIndependentReview } from './foundryVerdictLayer'
import { FOUNDRY_MODEL_DRIVEN_BUDGET } from './foundryEngineeringGraduationTypes'
import { FOUNDRY_REASONING_OWNERSHIP, FOUNDRY_REASONING_ROLES, FOUNDRY_REASONING_STAGES } from './foundryEngineeringReasoningTypes'
import {
  assignReasoningRoles,
  critiqueHypothesis,
  dossierFromMission,
  evaluateAdversarialReview,
  lessonRetainsHiddenAnswer,
  operationalRoleForReasoningRole,
  retainEngineeringLesson,
  reviewGraphForAdversarialFindings,
  runCapabilityEvaluation,
  selectNextCapabilityTask,
  verifyHypothesisFiles,
} from './foundryEngineeringReasoning'
import { reasoningCapabilityCases, sequenceModel } from './foundryEngineeringReasoningEvals'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function makeGraph(suffix: string): FoundryCommandCenterGraph {
  const missionId = `m-reason-${suffix}`
  const graph = buildTaskGraph({
    missionId,
    projectId: `p-${suffix}`,
    projectName: 'Reasoning Fixture',
    projectRoot: `/tmp/foundry-reason-${suffix}`,
    goal: 'Repair the approved ticket manager inside the sealed contract.',
    planningMode: false,
    specId: 'SPEC-REASON',
    specVersion: '1',
    specApproved: true,
    engineeringClass: 'STANDALONE_ENGINEER',
    tasks: ticketManagerGraphSeeds(),
  })
  for (const task of graph.tasks) task.criterionIds = ['CR-TEST']
  const drafted = draftStandaloneContracts({
    missionId,
    commanderRequest: graph.goal,
    goal: graph.goal,
    specId: 'SPEC-REASON',
    specVersion: '1',
    taskIds: graph.tasks.map(task => task.taskId),
    engineeringClass: 'STANDALONE_ENGINEER',
  })
  const missionContract = sealMissionContract(drafted.missionContract)
  const acceptance = sealAcceptanceContract(drafted.acceptanceContract)
  graph.missionContractId = missionContract.missionContractId
  graph.acceptanceContractId = acceptance.acceptanceContractId
  graph.missionContractHash = missionContract.contentHash
  graph.acceptanceContractHash = acceptance.contentHash
  return graph
}

function run(): CaseResult[] {
  const results: CaseResult[] = []
  const engine = source('lib/native-builder/foundryEngineeringReasoning.ts')
  const commandCenter = source('lib/native-builder/foundryAgentCommandCenter.ts')
  results.push(check(
    'OWNERSHIP',
    FOUNDRY_REASONING_OWNERSHIP.commander[0] === 'authority'
      && FOUNDRY_REASONING_OWNERSHIP.model[0] === 'reasoning generation'
      && FOUNDRY_REASONING_OWNERSHIP.toolBroker[0] === 'execution'
      && !FOUNDRY_REASONING_OWNERSHIP.foundry.includes('authority' as never),
    FOUNDRY_REASONING_OWNERSHIP.foundry.join(', '),
  ))
  results.push(check(
    'NO_INTELLIGENCE_SCORE',
    !/intelligenceScore|\bIQ\b/.test(engine),
    'metrics stay factual',
  ))
  results.push(check(
    'BUDGET_UNCHANGED',
    FOUNDRY_MODEL_DRIVEN_BUDGET.maxModelCalls === 12
      && FOUNDRY_MODEL_DRIVEN_BUDGET.maxTotalTokens === 80_000
      && FOUNDRY_MODEL_DRIVEN_BUDGET.maxWallClockMs === 1_200_000
      && FOUNDRY_MODEL_DRIVEN_BUDGET.maxToolCalls === 40
      && FOUNDRY_MODEL_DRIVEN_BUDGET.maxTestRuns === 8
      && FOUNDRY_MODEL_DRIVEN_BUDGET.maxBuildRuns === 2,
    JSON.stringify(FOUNDRY_MODEL_DRIVEN_BUDGET),
  ))
  results.push(check(
    'REASONING_ROLES_MAP',
    !(FOUNDRY_AGENT_ROLES as readonly string[]).includes('IMPLEMENTER')
      && !(FOUNDRY_AGENT_ROLES as readonly string[]).includes('TEST_ENGINEER')
      && operationalRoleForReasoningRole('IMPLEMENTER', 'frontend') === 'FRONTEND'
      && operationalRoleForReasoningRole('IMPLEMENTER', 'database') === 'DATABASE'
      && operationalRoleForReasoningRole('TEST_ENGINEER') === 'TEST'
      && operationalRoleForReasoningRole('ARCHITECT') === 'ARCHITECT',
    FOUNDRY_REASONING_ROLES.join(', '),
  ))
  const shared = assignReasoningRoles({ models: [{ provider: 'cursor-agent', model: 'primary' }] })
  const split = assignReasoningRoles({ models: [{ provider: 'cursor-agent', model: 'primary' }, { provider: 'ollama', model: 'local' }] })
  results.push(check(
    'MODEL_INTERCHANGEABLE',
    shared.length === 6 && shared.every(item => item.model === 'primary')
      && split.find(item => item.reasoningRole === 'REVIEWER')?.model === 'local'
      && split.find(item => item.reasoningRole === 'IMPLEMENTER')?.model === 'primary',
    shared.map(item => item.reasoningRole).join(', '),
  ))
  results.push(check(
    'REVIEW_FEEDS_REPLAN',
    commandCenter.includes('reviewGraphForAdversarialFindings') && commandCenter.includes('applyReplan'),
    'reviewer path',
  ))

  const cases = reasoningCapabilityCases()
  results.push(check('CAPABILITY_CLASSES', cases.length === 9, String(cases.length)))
  let verifierDefects = 0
  let recovered = 0
  for (const reasoningCase of cases) {
    const superficial = reasoningCase.hypotheses[0]
    const plausible = reasoningCase.hypotheses[1]
    const supported = reasoningCase.hypotheses[2]
    const shortcut = critiqueHypothesis(superficial, reasoningCase.observations)
    const superficialTrial = shortcut.admit ? verifyHypothesisFiles(reasoningCase, superficial.files) : { ok: false, output: shortcut.reason }
    const plausibleTrial = verifyHypothesisFiles(reasoningCase, plausible.files)
    const supportedTrial = verifyHypothesisFiles(reasoningCase, supported.files)
    const cycle = runCapabilityEvaluation({
      reasoningCase,
      model: sequenceModel(['h1', 'h2', 'h3'], reasoningCase.capabilityClass),
    })
    verifierDefects += cycle.metrics.verifierFoundDefectCount
    if (cycle.metrics.failedHypothesisRecovery) recovered += 1
    const publicText = JSON.stringify({ dossier: cycle.dossier, lesson: cycle.lesson, metrics: cycle.metrics })
    results.push(check(
      reasoningCase.caseId,
      superficialTrial.ok === false
        && plausibleTrial.ok === false
        && supportedTrial.ok === true
        && cycle.metrics.acceptanceSuccess
        && cycle.metrics.firstPlanSuccess === false
        && cycle.metrics.failedHypothesisRecovery
        && cycle.oracleLeak === false
        && !publicText.includes(reasoningCase.hiddenAnswer)
        && FOUNDRY_REASONING_STAGES.every(stage => cycle.stages.includes(stage))
        && cycle.stages.includes('ADVERSARIAL_REVIEW')
        && cycle.stages.includes('LEARN')
        && cycle.dossier.selectedApproach.length > 0,
      `superficial=${superficialTrial.ok}:${superficialTrial.output.slice(0, 80)} plausible=${plausibleTrial.ok}:${plausibleTrial.output.slice(0, 80)} supported=${supportedTrial.ok} accept=${cycle.metrics.acceptanceSuccess} defects=${cycle.metrics.verifierFoundDefectCount}`,
    ))
  }
  results.push(check('VERIFIER_FOUND_DEFECTS', verifierDefects > 0, String(verifierDefects)))
  results.push(check('FAILED_HYPOTHESIS_RECOVERY', recovered === cases.length, `${recovered}/${cases.length}`))

  const architecture = cases.find(item => item.capabilityClass === 'ARCHITECTURE_COMPARISON')!
  const first = runCapabilityEvaluation({
    reasoningCase: architecture,
    model: sequenceModel(['h3'], 'first-plan'),
  })
  results.push(check(
    'FIRST_PLAN_SUCCESS',
    first.metrics.firstPlanSuccess && first.metrics.acceptanceSuccess && first.metrics.unnecessaryEditCount === 0,
    JSON.stringify(first.metrics),
  ))
  results.push(check(
    'METRICS_ARE_COUNTS',
    !('intelligenceScore' in first.metrics) && typeof first.metrics.toolEfficiency === 'number',
    Object.keys(first.metrics).join(', '),
  ))

  const stubborn = runCapabilityEvaluation({
    reasoningCase: architecture,
    model: {
      provider: 'interchangeable-stub',
      model: 'stubborn',
      choose: () => ({ hypothesisId: 'h1', rationale: 'Patch only the first route.' }),
    },
  })
  const next = selectNextCapabilityTask({
    capabilityClass: 'ARCHITECTURE_COMPARISON',
    difficulty: 'D3',
    recentResults: ['FAIL'],
    gap: 'Selected a one-route patch. Both call sites still diverge.',
  })
  results.push(check(
    'FAILURE_DOES_NOT_BLOCK_COMMANDER',
    stubborn.metrics.acceptanceSuccess === false
      && stubborn.metrics.repeatedErrorCount >= 1
      && next.commanderMayProceed === true
      && next.authorityUnchanged === true
      && next.missionContractUnchanged === true
      && next.action === 'DIAGNOSE_AND_PRACTICE'
      && next.nextDifficulty === 'D3'
      && Boolean(next.gap),
    `${next.action} repeats=${stubborn.metrics.repeatedErrorCount}`,
  ))
  const increased = selectNextCapabilityTask({
    capabilityClass: 'AMBIGUOUS_BUG',
    difficulty: 'D2',
    recentResults: ['PASS', 'PASS', 'PASS'],
  })
  results.push(check(
    'DIFFICULTY_INCREASES_AFTER_PASSES',
    increased.action === 'INCREASE_DIFFICULTY' && increased.nextDifficulty === 'D3' && increased.commanderMayProceed === true,
    `${increased.difficulty}->${increased.nextDifficulty}`,
  ))

  const lesson = first.lesson
  const leaked = { ...lesson, rootCause: `${lesson.rootCause} ${architecture.hiddenAnswer}` }
  results.push(check('HIDDEN_ANSWER_REFUSED', lessonRetainsHiddenAnswer(leaked, [architecture.hiddenAnswer]), 'leak detected'))
  const memoryRoot = mkdtempSync(path.join(tmpdir(), 'wr-reason-mem-'))
  const retained = retainEngineeringLesson(lesson, { root: memoryRoot, forbiddenFragments: [architecture.hiddenAnswer] })
  const lessonPath = path.join(memoryRoot, 'lessons', `${lesson.lessonId}.json`)
  const lessonText = existsSync(lessonPath) ? readFileSync(lessonPath, 'utf8') : ''
  results.push(check(
    'LESSON_RETAINED',
    retained.ok && lessonText.includes(lesson.problemPattern.slice(0, 24)) && !lessonText.includes(architecture.hiddenAnswer),
    retained.reason,
  ))
  rmSync(memoryRoot, { recursive: true, force: true })

  const benign = evaluateAdversarialReview(dossierFromMission({ missionId: 'm-benign', goal: 'Ship the approved scope.' }))
  results.push(check('UNPROVEN_CAPABILITY_DOES_NOT_BLOCK', benign.every(item => !item.blocksReady), String(benign.length)))

  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-reason-c-'))
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  try {
    const graph = makeGraph('adv')
    for (const task of graph.tasks) {
      if (task.role === 'TEST') task.tests = { ok: true, detail: 'passed' }
    }
    const hash = graph.missionContractHash
    graph.reasoningDossier = {
      ...dossierFromMission({ missionId: graph.missionId, goal: graph.goal }),
      excerpts: ['assert.ok(true)'],
      missingRequirementIds: ['REQ-EDGE'],
    }
    const adversarial = reviewGraphForAdversarialFindings(graph)
    const applied = adversarial.proposal
      ? applyReplan({
        graph,
        proposal: adversarial.proposal,
        missionContract: null,
        acceptanceContract: null,
      })
      : null
    const review = evaluateIndependentReview(graph)
    results.push(check(
      'ADVERSARIAL_REPLAN',
      adversarial.blocksReady
        && adversarial.proposal?.expandsMission === false
        && adversarial.proposal?.changesAcceptance === false
        && applied?.applied === true
        && graph.missionContractHash === hash
        && graph.tasks.some(task => task.role === 'DEBUGGER' && task.title.includes('WEAK_TEST'))
        && review.outcome === 'FAIL',
      `${review.outcome} applied=${applied?.applied} hashSame=${graph.missionContractHash === hash}`,
    ))
  } finally {
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    rmSync(contractsRoot, { recursive: true, force: true })
  }
  return results
}

const results = run()
const failed = results.filter(item => !item.pass)
for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
console.log(`${results.length - failed.length}/${results.length} PASS`)
if (failed.length) process.exit(1)

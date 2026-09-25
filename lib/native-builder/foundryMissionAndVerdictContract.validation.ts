/**
 * Source + disposable proofs for sealed MissionContract, AcceptanceContract,
 * evidence binding, VerdictLayer, and COMPLETE / PROJECT_READY hard gates.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_ACCEPTANCE_VERIFICATION_TYPES, FOUNDRY_AUTHORITY_SNAPSHOT } from './foundryContractTypes'
import { hashAcceptanceContractIdentity, hashMissionContractIdentity } from './foundryContractHash'
import {
  defaultTicketManagerCriteria,
  draftStandaloneContracts,
  hashAcceptanceContract,
  hashMissionContract,
  sealAcceptanceContract,
  sealMissionContract,
  supersedeMissionContract,
} from './foundryMissionContract'
import { recordAcceptanceEvidence, satisfyCriterion, supersedeEvidenceForContract } from './foundryAcceptanceEvidence'
import {
  canComplete,
  canEnterExecution,
  canEnterExecutionFromGraph,
  evaluateIndependentReview,
  evaluateVerdictLayer,
  isStandaloneEngineerMission,
  projectReadyFromVerdict,
  proposeExecutorComplete,
  recoverVerdictState,
  standaloneEngineerBlocksMutation,
} from './foundryVerdictLayer'
import { loadMissionContract, loadVerdictRecord, saveMissionContract, saveVerdictRecord } from './foundryContractStore'
import { enqueueCommandCenterWork, executeCommandCenterGraph } from './foundryAgentCommandCenter'
import { completeMission, startMissionInput } from './foundryMissionController'
import { enterFoundryExecutionFromPlan } from './foundryPlanningMode'
import { executeEngineerTool } from './engineerTools'
import { saveMission } from './foundryMissionStore'
import { emptyApplicationBuilderState } from './foundryApplicationBuilderTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function recordAllPass(missionId: string, missionContract: ReturnType<typeof sealMissionContract>, acceptance: ReturnType<typeof sealAcceptanceContract>) {
  for (const criterion of acceptance.criteria.filter(item => item.required)) {
    recordAcceptanceEvidence({
      criterionId: criterion.criterionId,
      missionId,
      evidenceType: criterion.verificationType,
      producer: 'foundry-verifier',
      artifactReference: `artifact://${criterion.criterionId}`,
      commandReference: 'node --test test.mjs',
      result: `${criterion.expectedOutcome} persist ok`,
      status: 'PASS',
      missionContract,
      acceptanceContract: acceptance,
    })
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-contract-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-contract-projects-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-contract-cc-'))
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  const previousProjects = process.env.FOUNDRY_PROJECTS_ROOT
  const previousCc = process.env.FOUNDRY_COMMAND_CENTER_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot

  let mutationBeforeContract = 0
  let falseComplete = 0
  let readyWithoutVerdict = 0

  try {
    const types = source('lib/native-builder/foundryContractTypes.ts')
    const center = source('lib/native-builder/foundryAgentCommandCenter.ts')
    const verdictSrc = source('lib/native-builder/foundryVerdictLayer.ts')
    const planner = source('lib/native-builder/foundryPlanningMode.ts')
    const builder = source('lib/native-builder/foundryApplicationBuilder.ts')
    const controller = source('lib/native-builder/foundryMissionController.ts')

    results.push(check(
      'MISSION_CONTRACT_SCHEMA',
      /missionContractId/.test(types) && /acceptanceContractId/.test(types) && /contentHash/.test(types) && /DRAFT/.test(types) && /SEALED/.test(types) && /SUPERSEDED/.test(types),
      'typed MissionContract fields present',
    ))
    results.push(check(
      'ACCEPTANCE_CRITERION_TYPES',
      FOUNDRY_ACCEPTANCE_VERIFICATION_TYPES.join(',') === 'TEST,VALIDATION,BUILD,RUNTIME,BROWSER,PERSISTENCE,SECURITY,DIFF_SCOPE,CUSTOM_EVIDENCE',
      FOUNDRY_ACCEPTANCE_VERIFICATION_TYPES.join(','),
    ))
    results.push(check(
      'spec_approved_no_longer_defaults_true_for_se',
      /engineeringClass === 'STANDALONE_ENGINEER'/.test(center) && /\? Boolean\(input\.specApproved\)/.test(center) && !/specApproved = input\.planningMode \? Boolean\(input\.specApproved\) : true/.test(center),
      'SE requires explicit specApproved',
    ))
    results.push(check(
      'authority_snapshot_does_not_expand',
      FOUNDRY_AUTHORITY_SNAPSHOT.autoCommit === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.autoPush === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.autoDeploy === 0 && FOUNDRY_AUTHORITY_SNAPSHOT.foundryIsMissionOwner === true,
      JSON.stringify(FOUNDRY_AUTHORITY_SNAPSHOT),
    ))
    results.push(check(
      'existing_systems_extended_not_rebuilt',
      /canEnterExecutionFromGraph/.test(center) && /enterFoundryExecutionFromPlan/.test(planner) && /standaloneApplicationBuilderReady|isStandaloneEngineerMission/.test(builder) && /contractCanComplete/.test(controller),
      'command center / planning / builder / controller extended',
    ))

    const drafted = draftStandaloneContracts({
      missionId: 'mission-hash',
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-HASH',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const hashA = hashMissionContract(drafted.missionContract)
    const hashB = hashMissionContractIdentity(drafted.missionContract)
    const hashC = hashMissionContract({ ...drafted.missionContract, sealedAt: '2099-01-01T00:00:00.000Z', status: 'SEALED', createdAt: '2099-01-01T00:00:00.000Z' })
    const hashChanged = hashMissionContract({ ...drafted.missionContract, goal: 'Ticket manager changed' })
    const acceptanceHashA = hashAcceptanceContract(drafted.acceptanceContract)
    const acceptanceHashB = hashAcceptanceContractIdentity({ ...drafted.acceptanceContract, sealedAt: '2099-01-01T00:00:00.000Z', status: 'SEALED' })
    results.push(check(
      'MISSION_CONTRACT_HASH_STABLE',
      hashA === hashB && hashA === hashC && hashA !== hashChanged && acceptanceHashA === acceptanceHashB,
      `${hashA.slice(0, 12)} vs ${hashChanged.slice(0, 12)}`,
    ))

    const sealedAcceptance = sealAcceptanceContract(drafted.acceptanceContract)
    drafted.missionContract.acceptanceContractId = sealedAcceptance.acceptanceContractId
    const sealedMission = sealMissionContract(drafted.missionContract)
    let immutable = false
    try {
      saveMissionContract({ ...sealedMission, goal: 'mutated in place' })
    } catch (error) {
      immutable = /SEALED_CONTRACT_MUTATION_REFUSED/.test(error instanceof Error ? error.message : String(error))
    }
    results.push(check('MISSION_CONTRACT_SEALED_IMMUTABLE', sealedMission.status === 'SEALED' && Boolean(sealedMission.sealedAt) && immutable && loadMissionContract(sealedMission.missionContractId)?.goal === 'Ticket manager', 'in-place mutation refused'))

    const missingEvidence = evaluateVerdictLayer({
      missionId: sealedMission.missionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: sealedMission,
      acceptanceContract: sealedAcceptance,
      executorResult: 'PROPOSED_READY',
    })
    const readyA = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: missingEvidence,
      missionContract: sealedMission,
      acceptanceContract: sealedAcceptance,
    })
    if (missingEvidence.result === 'PASS' || readyA) readyWithoutVerdict += 1
    results.push(check(
      'fixture_a_missing_evidence',
      missingEvidence.result !== 'PASS' && readyA === false && missingEvidence.missingCriterionIds.length > 0 && /UNBOUND_PASS_CANNOT_SATISFY_CRITERION/.test(missingEvidence.reasons.join(' ')),
      `${missingEvidence.result} ready=${readyA} missing=${missingEvidence.missingCriterionIds.join(',')}`,
    ))

    const passMissionId = 'mission-all-pass'
    const passDraft = draftStandaloneContracts({
      missionId: passMissionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-PASS',
      specVersion: '1',
      taskIds: ['TASK-001', 'TASK-002'],
    }, defaultTicketManagerCriteria(['TASK-001', 'TASK-002']))
    const passAcceptance = sealAcceptanceContract(passDraft.acceptanceContract)
    passDraft.missionContract.acceptanceContractId = passAcceptance.acceptanceContractId
    const passMission = sealMissionContract(passDraft.missionContract)
    recordAllPass(passMissionId, passMission, passAcceptance)
    const passVerdict = evaluateVerdictLayer({
      missionId: passMissionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: 'PASS',
      executorResult: 'PROPOSED_READY',
    })
    const readyB = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: passVerdict,
      missionContract: passMission,
      acceptanceContract: passAcceptance,
    })
    results.push(check(
      'fixture_b_all_pass',
      passVerdict.result === 'PASS' && readyB === true && canComplete({ engineeringClass: 'STANDALONE_ENGINEER', missionContract: passMission, acceptanceContract: passAcceptance, verdict: passVerdict }).ok === true,
      `${passVerdict.result} ready=${readyB}`,
    ))

    const failMissionId = 'mission-fail-test'
    const failDraft = draftStandaloneContracts({
      missionId: failMissionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-FAIL',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const failAcceptance = sealAcceptanceContract(failDraft.acceptanceContract)
    failDraft.missionContract.acceptanceContractId = failAcceptance.acceptanceContractId
    const failMission = sealMissionContract(failDraft.missionContract)
    for (const criterion of failAcceptance.criteria.filter(item => item.required)) {
      recordAcceptanceEvidence({
        criterionId: criterion.criterionId,
        missionId: failMissionId,
        evidenceType: criterion.verificationType,
        producer: 'foundry-verifier',
        result: criterion.criterionId === 'CR-TEST' ? 'fail=1' : 'ok persist',
        status: criterion.criterionId === 'CR-TEST' ? 'FAIL' : 'PASS',
        missionContract: failMission,
        acceptanceContract: failAcceptance,
      })
    }
    const failVerdict = evaluateVerdictLayer({
      missionId: failMissionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: failMission,
      acceptanceContract: failAcceptance,
      reviewOutcome: 'PASS',
    })
    const readyC = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: failVerdict,
      missionContract: failMission,
      acceptanceContract: failAcceptance,
    })
    results.push(check(
      'fixture_c_failing_test',
      failVerdict.result === 'FAIL' && readyC === false && failVerdict.failedCriterionIds.includes('CR-TEST'),
      `${failVerdict.result} ready=${readyC} failed=${failVerdict.failedCriterionIds.join(',')}`,
    ))

    const staleMissionId = 'mission-stale'
    const staleDraft = draftStandaloneContracts({
      missionId: staleMissionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager v1',
      specId: 'SPEC-STALE',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const staleAcceptance = sealAcceptanceContract(staleDraft.acceptanceContract)
    staleDraft.missionContract.acceptanceContractId = staleAcceptance.acceptanceContractId
    const staleMission = sealMissionContract(staleDraft.missionContract)
    recordAllPass(staleMissionId, staleMission, staleAcceptance)
    const superseded = supersedeMissionContract(staleMission, { goal: 'Ticket manager v2', specVersion: '2' }, true)
    const nextAcceptance = loadMissionContract(superseded.next.missionContractId)
    const nextAcc = nextAcceptance ? (await import('./foundryContractStore')).loadAcceptanceContract(nextAcceptance.acceptanceContractId) : null
    const staleVerdict = evaluateVerdictLayer({
      missionId: staleMissionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: superseded.next,
      acceptanceContract: nextAcc,
      reviewOutcome: 'PASS',
    })
    const readyD = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: staleVerdict,
      missionContract: superseded.next,
      acceptanceContract: nextAcc,
    })
    const staleSatisfy = satisfyCriterion({
      criterionId: 'CR-TEST',
      required: true,
      evidence: (await import('./foundryContractStore')).listAcceptanceEvidence(staleMissionId),
      missionContract: superseded.next,
      acceptanceContract: nextAcc!,
    })
    results.push(check(
      'fixture_d_stale_evidence',
      staleSatisfy.reason === 'STALE_EVIDENCE_CANNOT_SATISFY_CRITERION' && staleVerdict.result !== 'PASS' && readyD === false,
      `${staleSatisfy.reason} verdict=${staleVerdict.result} ready=${readyD}`,
    ))

    const proposed = proposeExecutorComplete(sealedMission.missionId, 'PROPOSED_COMPLETE')
    const completeGate = canComplete({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: sealedMission,
      acceptanceContract: sealedAcceptance,
      verdict: proposed,
    })
    const executorMission = startMissionInput('Standalone engineer complete claim', 'SE complete', { engineeringClass: 'STANDALONE_ENGINEER' })
    executorMission.engineeringClass = 'STANDALONE_ENGINEER'
    executorMission.kind = 'app_builder'
    executorMission.capabilityLane = 'APPLICATION_BUILDER'
    executorMission.missionContractId = sealedMission.missionContractId
    executorMission.acceptanceContractId = sealedAcceptance.acceptanceContractId
    executorMission.missionContractHash = sealedMission.contentHash
    executorMission.acceptanceContractHash = sealedAcceptance.contentHash
    executorMission.contractSpecApproved = true
    executorMission.status = 'VERIFYING'
    executorMission.testState = { ok: true, detail: 'pass persist' }
    executorMission.sourceState.changedFiles = ['server.mjs']
    executorMission.runtimeState.detail = 'listening'
    executorMission.browserState = { ok: true, detail: 'ok' }
    executorMission.applicationBuilder = {
      ...emptyApplicationBuilderState(),
      research: [{ id: 'r1', source: 'https://example.com', title: 'ex', retrievedAt: new Date().toISOString(), claim: 'c', relevance: 'r', confidence: 'high', usedFor: 'u', kind: 'RESEARCHED_FACT', freshness: 'current' }],
      requirements: {
        goal: 'g', userType: [], coreWorkflows: [], functionalRequirements: [], nonfunctionalRequirements: [], dataRequirements: [], integrations: [], uiRequirements: [], securityRequirements: [], acceptanceCriteria: ['tests'], unknownBusinessFacts: [], researchTrace: [],
      },
      stack: { stack: 'node', alternativesConsidered: [], reason: 'local', decidedAt: new Date().toISOString() },
      project: {
        projectId: 'p', projectName: 'p', projectRoot: projectsRoot, missionId: executorMission.missionId, projectType: 'database_backed_app', createdAt: new Date().toISOString(), stack: null, requirements: null, researchSources: [], acceptanceCriteria: [], status: 'PROJECT_READY',
      },
      viewportResults: [
        { name: 'desktop', width: 1280, height: 800, ok: true, detail: 'ok', overflow: false, blankScreen: false, missingContent: false },
        { name: 'mobile', width: 390, height: 844, ok: true, detail: 'ok', overflow: false, blankScreen: false, missingContent: false },
      ],
      preview: {
        status: 'PROJECT_READY',
        projectName: 'p',
        whatWasBuilt: 'preview',
        localPreview: 'http://127.0.0.1:18765',
        majorFeatures: [],
        testStatus: 'PASS',
        knownLimitations: [],
        researchUsed: [],
        deploymentReadiness: 'NOT AUTHORIZED. LIVE_DEPLOY = NO.',
      },
    }
    await saveMission(executorMission)
    const manual = await completeMission(executorMission.missionId)
    if (manual.ok || manual.mission?.status === 'COMPLETE') falseComplete += 1
    results.push(check(
      'fixture_e_executor_self_complete',
      proposed.executorResult === 'PROPOSED_COMPLETE' && proposed.result !== 'PASS' && completeGate.ok === false && manual.ok === false,
      `verdict=${proposed.result} complete=${manual.ok} error=${manual.error ?? ''}`,
    ))
    results.push(check(
      'EXECUTOR_CANNOT_SELF_APPROVE',
      !/result:\s*'PASS'/.test(verdictSrc.split('proposeExecutorComplete')[1]?.slice(0, 800) ?? 'result: \'PASS\'') && proposed.result !== 'PASS',
      'proposeExecutorComplete cannot assign PASS',
    ))

    process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE = '1'
    const reviewFail = evaluateIndependentReview({
      tasks: [{ role: 'TEST', tests: { ok: true, detail: 'ok' } }],
      workspaces: [{ filesChanged: ['server.mjs'] }],
      preview: { status: 'RUNNING' },
      engineeringClass: 'STANDALONE_ENGINEER',
    } as never)
    delete process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE
    const reviewPass = evaluateIndependentReview({
      tasks: [{ role: 'TEST', tests: { ok: true, detail: 'ok' } }],
      workspaces: [{ filesChanged: ['server.mjs'] }],
      preview: { status: 'RUNNING' },
      engineeringClass: 'STANDALONE_ENGINEER',
    } as never)
    const reviewBlocked = evaluateIndependentReview({
      tasks: [{ role: 'TEST', tests: { ok: true, detail: 'ok' } }],
      workspaces: [{ filesChanged: ['Harbor Desk/app.js'] }],
      preview: { status: 'RUNNING' },
      engineeringClass: 'STANDALONE_ENGINEER',
    } as never)
    const reviewed = evaluateVerdictLayer({
      missionId: passMissionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: reviewFail.outcome,
      executorResult: 'PROPOSED_READY',
    })
    const readyF = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: reviewed,
      missionContract: passMission,
      acceptanceContract: passAcceptance,
    })
    results.push(check(
      'fixture_f_reviewer_failure',
      reviewFail.outcome === 'FAIL' && reviewPass.outcome === 'PASS' && reviewBlocked.outcome === 'FAIL' && reviewed.result === 'FAIL' && readyF === false,
      `fail=${reviewFail.outcome} pass=${reviewPass.outcome} blocked=${reviewBlocked.outcome} verdict=${reviewed.result}`,
    ))

    const blockedVerdict = evaluateVerdictLayer({
      missionId: 'mission-blocked',
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: null,
      acceptanceContract: null,
    })
    results.push(check('VERDICT_CAN_BLOCK', blockedVerdict.result === 'BLOCKED', blockedVerdict.result))
    results.push(check('VERDICT_CAN_FAIL', failVerdict.result === 'FAIL', failVerdict.result))

    const planning = await enqueueCommandCenterWork({
      goal: 'New standalone engineer mission',
      projectName: 'mutation-probe',
      kind: 'ticket-manager',
      specApproved: true,
    })
    const beforeFiles = existsSync(path.join(planning.projectRoot, 'server.mjs'))
    const planned = await executeCommandCenterGraph(planning.graphId)
    const afterFiles = existsSync(path.join(planning.projectRoot, 'server.mjs'))
    if (afterFiles && !beforeFiles) mutationBeforeContract += 1
    const enter = canEnterExecutionFromGraph(planning)
    results.push(check(
      'fixture_planning_bypass',
      planning.engineeringClass === 'STANDALONE_ENGINEER' && planning.specApproved === true && !planning.missionContractId && enter.ok === false && planned.status === 'PLANNING' && afterFiles === false,
      `status=${planned.status} server=${afterFiles} enter=${enter.error ?? 'ok'}`,
    ))

    const seMission = startMissionInput('Write hello.js as standalone engineer', 'SE mutate', { engineeringClass: 'STANDALONE_ENGINEER' })
    seMission.engineeringClass = 'STANDALONE_ENGINEER'
    seMission.planningMode = false
    seMission.contractSpecApproved = false
    const block = standaloneEngineerBlocksMutation(seMission, 'file.write')
    const written = await executeEngineerTool({
      tool: 'file.write',
      input: { path: 'hello.js', content: 'export const x = 1\n', reason: 'mutation-before-contract probe' },
    }, { repairId: seMission.missionId, mission: seMission })
    if (written.ok) mutationBeforeContract += 1
    results.push(check(
      'MUTATION_BEFORE_CONTRACT',
      Boolean(block) && written.ok === false && mutationBeforeContract === 0,
      `block=${block ?? 'none'} write=${written.ok} count=${mutationBeforeContract}`,
    ))

    const planMission = startMissionInput('Plan a standalone engineer change', 'SE plan', { engineeringClass: 'STANDALONE_ENGINEER' })
    planMission.engineeringClass = 'STANDALONE_ENGINEER'
    planMission.planningMode = true
    const entered = enterFoundryExecutionFromPlan(planMission, true)
    results.push(check(
      'planning_mode_requires_sealed_contracts',
      entered.ok === false && /Sealed MissionContract|STANDALONE_ENGINEER execution refused/.test(entered.error ?? ''),
      entered.error ?? 'entered',
    ))

    const legacyReady = projectReadyFromVerdict({
      engineeringClass: undefined,
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:9',
      verdict: null,
    })
    const legacyComplete = canComplete({ engineeringClass: undefined })
    results.push(check(
      'legacy_pre_contract_untouched',
      legacyReady === true && legacyComplete.ok === true && isStandaloneEngineerMission({ engineeringClass: undefined }) === false,
      `legacyReady=${legacyReady} complete=${legacyComplete.ok}`,
    ))
    results.push(check(
      'unbound_pass_cannot_satisfy',
      satisfyCriterion({
        criterionId: 'CR-TEST',
        required: true,
        evidence: [{
          schemaVersion: 1,
          evidenceId: 'fake',
          criterionId: 'OTHER',
          missionId: sealedMission.missionId,
          taskId: null,
          evidenceType: 'TEST',
          producer: 'executor',
          timestamp: new Date().toISOString(),
          artifactReference: null,
          commandReference: null,
          result: 'claimed pass',
          contentHash: 'x',
          status: 'PASS',
          missionContractId: sealedMission.missionContractId,
          acceptanceContractId: sealedAcceptance.acceptanceContractId,
          missionContractHash: sealedMission.contentHash,
          acceptanceContractHash: sealedAcceptance.contentHash,
          specVersion: sealedMission.specVersion,
          superseded: false,
        }],
        missionContract: sealedMission,
        acceptanceContract: sealedAcceptance,
      }).reason === 'UNBOUND_PASS_CANNOT_SATISFY_CRITERION',
      'unbound PASS ignored',
    ))

    saveVerdictRecord({
      schemaVersion: 1,
      verdictId: 'VD-mid',
      missionId: failMissionId,
      graphId: null,
      missionContractId: failMission.missionContractId,
      acceptanceContractId: failAcceptance.acceptanceContractId,
      missionContractHash: failMission.contentHash,
      acceptanceContractHash: failAcceptance.contentHash,
      specVersion: failMission.specVersion,
      result: 'INCONCLUSIVE',
      reasons: ['mid-evaluation'],
      missingCriterionIds: [],
      failedCriterionIds: [],
      inconclusiveCriterionIds: [],
      staleEvidenceIds: [],
      reviewOutcome: 'PASS',
      executorResult: 'PROPOSED_COMPLETE',
      evaluatedAt: new Date().toISOString(),
      midEvaluation: true,
    })
    const recovered = recoverVerdictState(failMissionId)
    results.push(check(
      'restart_recovery_truthful',
      recovered?.midEvaluation === false && recovered.result === 'FAIL' && loadVerdictRecord(failMissionId)?.result === 'FAIL',
      `${recovered?.result} mid=${recovered?.midEvaluation}`,
    ))

    results.push(check(
      'canEnterExecution_api',
      canEnterExecution({ engineeringClass: 'STANDALONE_ENGINEER', specApproved: true }).ok === false
        && canEnterExecution({ engineeringClass: 'STANDALONE_ENGINEER', specApproved: true, missionContract: sealedMission, acceptanceContract: sealedAcceptance }).ok === true,
      'execution requires sealed pair + spec approval',
    ))

    void supersedeEvidenceForContract
    results.push(check('FALSE_COMPLETE_COUNT', falseComplete === 0, String(falseComplete)))
    results.push(check('PROJECT_READY_WITHOUT_VERDICT_PASS', readyWithoutVerdict === 0, String(readyWithoutVerdict)))
    results.push(check('MUTATION_BEFORE_CONTRACT_COUNT', mutationBeforeContract === 0, String(mutationBeforeContract)))
  } finally {
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    if (previousProjects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previousProjects
    if (previousCc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previousCc
    delete process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE
    rmSync(contractsRoot, { recursive: true, force: true })
    rmSync(projectsRoot, { recursive: true, force: true })
    rmSync(ccRoot, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    results,
  }, null, 2))
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryMissionAndVerdictContractValidation }

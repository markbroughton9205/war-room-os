/**
 * Source + disposable proofs for Foundry execution-approval snapshots,
 * contract supersession, and Commander re-approval.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { FOUNDRY_AGENT_EVENT_TYPES } from './foundryAgentEvents'
import { FOUNDRY_EXECUTION_APPROVAL_STATUSES } from './foundryContractTypes'
import { hashSpecIdentity, NON_MATERIAL_GRAPH_FIELDS } from './foundryContractHash'
import {
  defaultTicketManagerCriteria,
  draftStandaloneContracts,
  sealAcceptanceContract,
  sealMissionContract,
  supersedeAcceptanceContract,
  supersedeMissionContract,
} from './foundryMissionContract'
import { recordAcceptanceEvidence } from './foundryAcceptanceEvidence'
import {
  canComplete,
  canEnterExecutionFromGraph,
  evaluateVerdictLayer,
  isStandaloneEngineerMission,
  projectReadyFromVerdict,
  standaloneEngineerBlocksMutation,
} from './foundryVerdictLayer'
import {
  listArchivedVerdicts,
  listExecutionApprovals,
  loadAcceptanceContract,
  loadExecutionApproval,
  loadMissionContract,
  loadVerdictRecord,
  saveExecutionApproval,
} from './foundryContractStore'
import {
  approvalMatchesGeneration,
  createExecutionApproval,
  evaluateApprovalBinding,
  recoverApprovalBinding,
  revokeExecutionApproval,
} from './foundryExecutionApproval'
import {
  approveCommandCenterExecution,
  draftAndSealCommandCenterContracts,
  enqueueCommandCenterWork,
  executeCommandCenterGraph,
  revokeCommandCenterExecution,
  supersedeCommandCenterContracts,
} from './foundryAgentCommandCenter'
import { recoverCommandCenterGraph, saveCommandCenterGraph } from './foundryAgentStore'
import { classifyToolIdempotency } from './foundryToolLifecycle'
import { isMutatingBrokerTool } from './foundryMissionWriteSet'
import { executeEngineerTool } from './engineerTools'
import { startMissionInput } from './foundryMissionController'
import { buildContractVerdictView } from './foundryContractVerdictView'

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

function bindMission(mission: ReturnType<typeof startMissionInput>, missionContract: ReturnType<typeof sealMissionContract>, acceptance: ReturnType<typeof sealAcceptanceContract>) {
  mission.engineeringClass = 'STANDALONE_ENGINEER'
  mission.planningMode = false
  mission.missionContractId = missionContract.missionContractId
  mission.acceptanceContractId = acceptance.acceptanceContractId
  mission.missionContractHash = missionContract.contentHash
  mission.acceptanceContractHash = acceptance.contentHash
  mission.contractSpecApproved = true
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-reapproval-'))
  const projectsRoot = mkdtempSync(path.join(tmpdir(), 'wr-reapproval-projects-'))
  const ccRoot = mkdtempSync(path.join(tmpdir(), 'wr-reapproval-cc-'))
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  const previousProjects = process.env.FOUNDRY_PROJECTS_ROOT
  const previousCc = process.env.FOUNDRY_COMMAND_CENTER_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  process.env.FOUNDRY_PROJECTS_ROOT = projectsRoot
  process.env.FOUNDRY_COMMAND_CENTER_ROOT = ccRoot

  let mutationWithoutReapproval = 0
  let staleApprovalWrites = 0
  let projectReadyWithStale = 0
  let verdictPassWithStale = 0
  let silentHashReplacement = 0

  try {
    const types = source('lib/native-builder/foundryContractTypes.ts')
    const store = source('lib/native-builder/foundryContractStore.ts')
    const approvalSrc = source('lib/native-builder/foundryExecutionApproval.ts')
    const panel = source('components/war-room/foundry/FoundryContractVerdictPanel.tsx')
    const api = source('app/api/foundry/command-center/route.ts')
    const planner = source('lib/native-builder/foundryPlanningMode.ts')
    const center = source('lib/native-builder/foundryAgentCommandCenter.ts')
    const broker = source('lib/native-builder/engineerTools.ts')
    const events = source('lib/native-builder/foundryAgentEvents.ts')

    results.push(check(
      'EXECUTION_APPROVAL_SNAPSHOT',
      /FoundryExecutionApproval/.test(types)
        && FOUNDRY_EXECUTION_APPROVAL_STATUSES.join(',') === 'ACTIVE,SUPERSEDED,REVOKED'
        && /approvals/.test(store)
        && /SEALED_APPROVAL_IMMUTABLE/.test(store)
        && /createExecutionApproval/.test(approvalSrc),
      FOUNDRY_EXECUTION_APPROVAL_STATUSES.join(','),
    ))
    results.push(check(
      'events_typed_on_existing_bus',
      FOUNDRY_AGENT_EVENT_TYPES.includes('EXECUTION_APPROVAL_CREATED')
        && FOUNDRY_AGENT_EVENT_TYPES.includes('EXECUTION_APPROVAL_SUPERSEDED')
        && FOUNDRY_AGENT_EVENT_TYPES.includes('EXECUTION_APPROVAL_REVOKED')
        && FOUNDRY_AGENT_EVENT_TYPES.includes('REAPPROVAL_REQUIRED')
        && FOUNDRY_AGENT_EVENT_TYPES.includes('REAPPROVAL_COMPLETED')
        && FOUNDRY_AGENT_EVENT_TYPES.includes('VERDICT_INVALIDATED')
        && FOUNDRY_AGENT_EVENT_TYPES.includes('PROJECT_READY_INVALIDATED')
        && /EXECUTION_APPROVAL_CREATED/.test(events),
      'typed events on existing bus',
    ))
    results.push(check(
      'planning_and_api_extended',
      /createExecutionApproval/.test(planner)
        && /expectedSpecVersion/.test(api)
        && /revoke-execution/.test(api)
        && /APPROVAL_TARGET_STALE/.test(approvalSrc)
        && /standaloneEngineerBlocksMutation/.test(broker)
        && /haltGraphForReapproval/.test(center),
      'existing approve-execution / planning / broker extended',
    ))
    results.push(check(
      'reapproval_ui',
      /APPROVE UPDATED EXECUTION/.test(panel)
        && /PREVIOUS APPROVAL|Previous approval/.test(panel)
        && /foundry-approval-history/.test(panel)
        && /APPROVAL SUPERSEDED/.test(panel)
        && /RE-APPROVAL REQUIRED/.test(panel),
      'Planning Mode / contract panel reapproval surface',
    ))
    results.push(check(
      'non_material_fields_defined',
      NON_MATERIAL_GRAPH_FIELDS.includes('updatedAt')
        && NON_MATERIAL_GRAPH_FIELDS.includes('recoveryCount')
        && NON_MATERIAL_GRAPH_FIELDS.includes('displayLabel')
        && NON_MATERIAL_GRAPH_FIELDS.includes('pollingMetadata'),
      NON_MATERIAL_GRAPH_FIELDS.join(','),
    ))
    results.push(check(
      'read_only_not_mutating_broker',
      classifyToolIdempotency('file.read') === 'READ_ONLY'
        && classifyToolIdempotency('git.status') === 'READ_ONLY'
        && classifyToolIdempotency('workspace.search') === 'READ_ONLY'
        && classifyToolIdempotency('code.symbol') === 'READ_ONLY'
        && classifyToolIdempotency('code.refs') === 'READ_ONLY'
        && isMutatingBrokerTool('file.write') === true
        && isMutatingBrokerTool('file.read') === false
        && isMutatingBrokerTool('git.status') === false,
      'read-only tools stay outside mutation gate',
    ))

    const missionA = startMissionInput('Build a ticket manager as standalone engineer', 'SE A', { engineeringClass: 'STANDALONE_ENGINEER' })
    const draftA = draftStandaloneContracts({
      missionId: missionA.missionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-RA-A',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const acceptanceA = sealAcceptanceContract(draftA.acceptanceContract)
    draftA.missionContract.acceptanceContractId = acceptanceA.acceptanceContractId
    const sealedA = sealMissionContract(draftA.missionContract)
    bindMission(missionA, sealedA, acceptanceA)
    const approvalA = createExecutionApproval({
      missionId: missionA.missionId,
      missionContract: sealedA,
      acceptanceContract: acceptanceA,
      mission: missionA,
    })
    missionA.executionApprovalId = approvalA.approvalId
    const blockA = standaloneEngineerBlocksMutation(missionA, 'file.write')
    results.push(check(
      'fixture_a_approved_v1_unchanged',
      approvalA.status === 'ACTIVE'
        && approvalMatchesGeneration(approvalA, sealedA, acceptanceA)
        && blockA === null
        && approvalA.specVersion === '1'
        && approvalA.missionContractHash === sealedA.contentHash
        && approvalA.acceptanceContractHash === acceptanceA.contentHash,
      `status=${approvalA.status} block=${blockA ?? 'none'}`,
    ))

    const graphB = await enqueueCommandCenterWork({
      goal: 'Ticket manager command center',
      projectName: 'reapproval-b',
      kind: 'ticket-manager',
      specApproved: false,
      missionId: `cc-${missionA.missionId.slice(0, 8)}-b`,
    })
    const sealedGraph = draftAndSealCommandCenterContracts(graphB.graphId)
    const approvedGraph = approveCommandCenterExecution(sealedGraph.graphId)
    const completeTask = approvedGraph.tasks[0]
    const readyTask = approvedGraph.tasks[1]
    if (completeTask) {
      completeTask.status = 'COMPLETE'
      completeTask.blocker = null
    }
    if (readyTask) {
      readyTask.status = 'READY'
      readyTask.blocker = null
    }
    saveCommandCenterGraph(approvedGraph)
    const priorApprovalId = approvedGraph.approvalId
    const supersededGraph = supersedeCommandCenterContracts(approvedGraph.graphId, { goal: 'Ticket manager v2' })
    const preservedComplete = supersededGraph.tasks[0]?.status === 'COMPLETE'
    const readyBlocked = supersededGraph.tasks[1]?.status === 'PLANNING' && (supersededGraph.tasks[1]?.blocker ?? '').includes('REAPPROVAL_REQUIRED')
    const v1StillThere = priorApprovalId ? loadExecutionApproval(priorApprovalId)?.status === 'SUPERSEDED' : false
    const liveMission = supersededGraph.missionContractId ? loadMissionContract(supersededGraph.missionContractId) : null
    const bindingB = evaluateApprovalBinding({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionId: supersededGraph.missionId,
      graphId: supersededGraph.graphId,
      missionContract: liveMission,
      acceptanceContract: supersededGraph.acceptanceContractId ? loadAcceptanceContract(supersededGraph.acceptanceContractId) : null,
    })
    const executedB = await executeCommandCenterGraph(supersededGraph.graphId)
    const mutatedAfter = existsSync(path.join(supersededGraph.projectRoot, 'server.mjs'))
    if (mutatedAfter) mutationWithoutReapproval += 1
    results.push(check(
      'fixture_b_mission_contract_superseded',
      bindingB.reapprovalRequired
        && /REAPPROVAL_REQUIRED/.test(bindingB.reason ?? '')
        && preservedComplete
        && readyBlocked
        && v1StillThere
        && executedB.status === 'PLANNING'
        && mutatedAfter === false
        && liveMission?.specVersion !== '1'
        && liveMission?.status === 'SEALED',
      `reapproval=${bindingB.reapprovalRequired} complete=${preservedComplete} ready=${supersededGraph.tasks[1]?.status} server=${mutatedAfter}`,
    ))

    const missionC = startMissionInput('Acceptance supersession', 'SE C', { engineeringClass: 'STANDALONE_ENGINEER' })
    const draftC = draftStandaloneContracts({
      missionId: missionC.missionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-RA-C',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const acceptanceC = sealAcceptanceContract(draftC.acceptanceContract)
    draftC.missionContract.acceptanceContractId = acceptanceC.acceptanceContractId
    const sealedC = sealMissionContract(draftC.missionContract)
    bindMission(missionC, sealedC, acceptanceC)
    recordAllPass(missionC.missionId, sealedC, acceptanceC)
    const passC = evaluateVerdictLayer({
      missionId: missionC.missionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: sealedC,
      acceptanceContract: acceptanceC,
      reviewOutcome: 'PASS',
      executorResult: 'PROPOSED_READY',
    })
    createExecutionApproval({
      missionId: missionC.missionId,
      missionContract: sealedC,
      acceptanceContract: acceptanceC,
      mission: missionC,
    })
    const extraCriteria = [
      ...defaultTicketManagerCriteria(['TASK-001']),
      {
        criterionId: 'CR-NEW',
        description: 'Newly required criterion after acceptance supersession',
        required: true,
        verificationType: 'CUSTOM_EVIDENCE' as const,
        expectedOutcome: 'new bound evidence',
        evidenceRequirements: ['new.proof'],
        relatedTaskIds: ['TASK-001'],
      },
    ]
    const supersededC = supersedeAcceptanceContract(sealedC, extraCriteria, true, missionC)
    const nextAccC = loadAcceptanceContract(supersededC.next.acceptanceContractId)
    const currentC = loadVerdictRecord(missionC.missionId)
    const archivedC = listArchivedVerdicts(missionC.missionId)
    const readyC = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: currentC,
      missionContract: supersededC.next,
      acceptanceContract: nextAccC,
    })
    if (currentC?.result === 'PASS') verdictPassWithStale += 1
    if (readyC) projectReadyWithStale += 1
    const viewC = buildContractVerdictView({
      missionId: missionC.missionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specApproved: false,
      missionContract: supersededC.next,
      acceptanceContract: nextAccC,
    })
    const blockC = standaloneEngineerBlocksMutation(missionC, 'file.write')
    results.push(check(
      'fixture_c_acceptance_superseded',
      passC.result === 'PASS'
        && currentC?.result !== 'PASS'
        && archivedC.some(item => item.result === 'PASS')
        && readyC === false
        && Boolean(blockC && /REAPPROVAL_REQUIRED/.test(blockC))
        && Boolean(nextAccC?.criteria.some(item => item.criterionId === 'CR-NEW'))
        && viewC.criteria.some(item => item.criterionId === 'CR-NEW' && item.status === 'MISSING')
        && viewC.reapprovalRequired === true
        && viewC.projectReadyAdmissible === false,
      `prior=${passC.result} current=${currentC?.result} ready=${readyC} block=${blockC}`,
    ))

    const missionD = startMissionInput('Spec version increment', 'SE D', { engineeringClass: 'STANDALONE_ENGINEER' })
    const draftD = draftStandaloneContracts({
      missionId: missionD.missionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-RA-D',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const acceptanceD = sealAcceptanceContract(draftD.acceptanceContract)
    draftD.missionContract.acceptanceContractId = acceptanceD.acceptanceContractId
    const sealedD = sealMissionContract(draftD.missionContract)
    bindMission(missionD, sealedD, acceptanceD)
    const approvalD = createExecutionApproval({
      missionId: missionD.missionId,
      missionContract: sealedD,
      acceptanceContract: acceptanceD,
      mission: missionD,
    })
    const hashBefore = hashSpecIdentity({
      specId: sealedD.specId,
      specVersion: sealedD.specVersion,
      goal: sealedD.goal,
      nonGoals: sealedD.nonGoals,
      constraints: sealedD.constraints,
      taskIds: sealedD.taskIds,
      commanderRequest: sealedD.commanderRequest,
      acceptanceContractHash: acceptanceD.contentHash,
    })
    const sameVersionForced = supersedeMissionContract(sealedD, { goal: 'Ticket manager changed', specVersion: '1' }, true, missionD)
    const hashAfter = hashSpecIdentity({
      specId: sameVersionForced.next.specId,
      specVersion: sameVersionForced.next.specVersion,
      goal: sameVersionForced.next.goal,
      nonGoals: sameVersionForced.next.nonGoals,
      constraints: sameVersionForced.next.constraints,
      taskIds: sameVersionForced.next.taskIds,
      commanderRequest: sameVersionForced.next.commanderRequest,
      acceptanceContractHash: loadAcceptanceContract(sameVersionForced.next.acceptanceContractId)?.contentHash ?? '',
    })
    const bindingD = evaluateApprovalBinding({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionId: missionD.missionId,
      missionContract: sameVersionForced.next,
      acceptanceContract: loadAcceptanceContract(sameVersionForced.next.acceptanceContractId),
    })
    results.push(check(
      'fixture_d_spec_version_increment',
      sameVersionForced.next.specVersion !== '1'
        && sameVersionForced.next.specVersion !== sealedD.specVersion
        && hashBefore !== hashAfter
        && bindingD.reapprovalRequired
        && loadExecutionApproval(approvalD.approvalId)?.status === 'SUPERSEDED'
        && loadMissionContract(sealedD.missionContractId)?.status === 'SUPERSEDED',
      `v${sealedD.specVersion}→v${sameVersionForced.next.specVersion} reapproval=${bindingD.reapprovalRequired}`,
    ))

    const reapproved = approveCommandCenterExecution(supersededGraph.graphId)
    const historyE = listExecutionApprovals(reapproved.missionId, reapproved.graphId)
    const oldE = historyE.find(item => item.approvalId === priorApprovalId)
    const activeE = historyE.find(item => item.status === 'ACTIVE')
    const enterE = canEnterExecutionFromGraph(reapproved)
    const bindingE = evaluateApprovalBinding({
      engineeringClass: reapproved.engineeringClass,
      missionId: reapproved.missionId,
      graphId: reapproved.graphId,
      missionContract: loadMissionContract(reapproved.missionContractId!),
      acceptanceContract: loadAcceptanceContract(reapproved.acceptanceContractId!),
    })
    results.push(check(
      'fixture_e_commander_reapproves',
      Boolean(reapproved.approvalId)
        && reapproved.approvalId !== priorApprovalId
        && oldE?.status === 'SUPERSEDED'
        && activeE?.status === 'ACTIVE'
        && activeE?.approvalId === reapproved.approvalId
        && reapproved.specApproved === true
        && enterE.ok === true
        && bindingE.ok === true
        && historyE.length >= 2,
      `old=${oldE?.status} new=${activeE?.approvalId} enter=${enterE.error ?? 'ok'}`,
    ))

    let raceRefused = false
    let raceApprovalCreated = false
    try {
      approveCommandCenterExecution(reapproved.graphId, {
        specVersion: '1',
        missionContractHash: sealedA.contentHash,
        acceptanceContractHash: acceptanceA.contentHash,
      })
      raceApprovalCreated = true
    } catch (error) {
      raceRefused = /APPROVAL_TARGET_STALE/.test(error instanceof Error ? error.message : String(error))
    }
    const afterRace = listExecutionApprovals(reapproved.missionId, reapproved.graphId).filter(item => item.status === 'ACTIVE')
    results.push(check(
      'fixture_f_stale_client_race',
      raceRefused && raceApprovalCreated === false && afterRace.length === 1 && afterRace[0]?.approvalId === reapproved.approvalId,
      `refused=${raceRefused} active=${afterRace.map(item => item.approvalId).join(',')}`,
    ))

    const graphG = { ...reapproved, updatedAt: '2099-01-01T00:00:00.000Z', recoveryCount: 42, lastRecoveryAt: '2099-01-01T00:00:00.000Z', paused: true }
    saveCommandCenterGraph(graphG)
    const bindingG = evaluateApprovalBinding({
      engineeringClass: graphG.engineeringClass,
      missionId: graphG.missionId,
      graphId: graphG.graphId,
      missionContract: loadMissionContract(graphG.missionContractId!),
      acceptanceContract: loadAcceptanceContract(graphG.acceptanceContractId!),
    })
    results.push(check(
      'fixture_g_non_material_change',
      bindingG.ok
        && bindingG.reapprovalRequired === false
        && bindingG.approval?.status === 'ACTIVE'
        && bindingG.approval?.approvalId === reapproved.approvalId,
      `ok=${bindingG.ok} status=${bindingG.approval?.status}`,
    ))

    const missionH = startMissionInput('Restart mismatch', 'SE H', { engineeringClass: 'STANDALONE_ENGINEER' })
    const draftH = draftStandaloneContracts({
      missionId: missionH.missionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager v1',
      specId: 'SPEC-RA-H',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const acceptanceH = sealAcceptanceContract(draftH.acceptanceContract)
    draftH.missionContract.acceptanceContractId = acceptanceH.acceptanceContractId
    const sealedH = sealMissionContract(draftH.missionContract)
    bindMission(missionH, sealedH, acceptanceH)
    const approvalH = createExecutionApproval({
      missionId: missionH.missionId,
      missionContract: sealedH,
      acceptanceContract: acceptanceH,
      mission: missionH,
    })
    const draftH2 = draftStandaloneContracts({
      missionId: missionH.missionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager v2 live hashes',
      specId: 'SPEC-RA-H',
      specVersion: '2',
      taskIds: ['TASK-001'],
    })
    const acceptanceH2 = sealAcceptanceContract(draftH2.acceptanceContract)
    draftH2.missionContract.acceptanceContractId = acceptanceH2.acceptanceContractId
    const sealedH2 = sealMissionContract(draftH2.missionContract)
    const recovered = recoverApprovalBinding({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionId: missionH.missionId,
      missionContract: sealedH2,
      acceptanceContract: acceptanceH2,
    })
    const approvalAfterRecover = loadExecutionApproval(approvalH.approvalId)
    if (approvalAfterRecover && approvalAfterRecover.missionContractHash === sealedH2.contentHash) silentHashReplacement += 1
    try {
      saveExecutionApproval({ ...approvalH, missionContractHash: sealedH2.contentHash, acceptanceContractHash: acceptanceH2.contentHash })
      silentHashReplacement += 1
    } catch (error) {
      results.push(check(
        'SEALED_APPROVAL_IMMUTABLE',
        /SEALED_APPROVAL_IMMUTABLE/.test(error instanceof Error ? error.message : String(error)),
        error instanceof Error ? error.message : String(error),
      ))
    }
    const graphH = await enqueueCommandCenterWork({
      goal: 'Restart graph',
      projectName: 'reapproval-h',
      kind: 'ticket-manager',
      specApproved: true,
      missionId: missionH.missionId,
    })
    graphH.missionContractId = sealedH2.missionContractId
    graphH.acceptanceContractId = acceptanceH2.acceptanceContractId
    graphH.missionContractHash = sealedH2.contentHash
    graphH.acceptanceContractHash = acceptanceH2.contentHash
    graphH.approvalId = approvalH.approvalId
    saveCommandCenterGraph(graphH)
    const recoveredGraph = recoverCommandCenterGraph(graphH)
    results.push(check(
      'fixture_h_restart_does_not_silently_reapprove',
      recovered.reapprovalRequired
        && approvalAfterRecover?.missionContractHash === sealedH.contentHash
        && approvalAfterRecover?.acceptanceContractHash === acceptanceH.contentHash
        && approvalAfterRecover?.status === 'ACTIVE'
        && recoveredGraph.planningMode === true
        && recoveredGraph.specApproved === false,
      `reapproval=${recovered.reapprovalRequired} hash=${approvalAfterRecover?.missionContractHash.slice(0, 12)}`,
    ))

    const missionI = startMissionInput('Old verdict cannot authorize new generation', 'SE I', { engineeringClass: 'STANDALONE_ENGINEER' })
    const draftI = draftStandaloneContracts({
      missionId: missionI.missionId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-RA-I',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const acceptanceI = sealAcceptanceContract(draftI.acceptanceContract)
    draftI.missionContract.acceptanceContractId = acceptanceI.acceptanceContractId
    const sealedI = sealMissionContract(draftI.missionContract)
    bindMission(missionI, sealedI, acceptanceI)
    recordAllPass(missionI.missionId, sealedI, acceptanceI)
    const passI = evaluateVerdictLayer({
      missionId: missionI.missionId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: sealedI,
      acceptanceContract: acceptanceI,
      reviewOutcome: 'PASS',
      executorResult: 'PROPOSED_READY',
    })
    const readyBefore = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: passI,
      missionContract: sealedI,
      acceptanceContract: acceptanceI,
    })
    createExecutionApproval({
      missionId: missionI.missionId,
      missionContract: sealedI,
      acceptanceContract: acceptanceI,
      mission: missionI,
    })
    const supersededI = supersedeMissionContract(sealedI, { goal: 'Ticket manager generation 2', specVersion: '2' }, true, missionI)
    const nextAccI = loadAcceptanceContract(supersededI.next.acceptanceContractId)
    const currentI = loadVerdictRecord(missionI.missionId)
    const readyAfter = projectReadyFromVerdict({
      engineeringClass: 'STANDALONE_ENGINEER',
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:18765',
      verdict: currentI,
      missionContract: supersededI.next,
      acceptanceContract: nextAccI,
    })
    const completeI = canComplete({
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: supersededI.next,
      acceptanceContract: nextAccI,
      verdict: currentI,
      missionId: missionI.missionId,
    })
    if (currentI?.result === 'PASS') verdictPassWithStale += 1
    if (readyAfter) projectReadyWithStale += 1
    const staleWrite = await executeEngineerTool({
      tool: 'file.write',
      input: { path: '.tmp/foundry-contract-reapproval/probe-i.js', content: 'export const i = 1\n', reason: 'stale approval write probe' },
    }, { repairId: missionI.missionId, mission: missionI })
    if (staleWrite.ok) staleApprovalWrites += 1
    results.push(check(
      'fixture_i_old_verdict_cannot_authorize_new_generation',
      passI.result === 'PASS'
        && readyBefore === true
        && currentI?.result !== 'PASS'
        && readyAfter === false
        && completeI.ok === false
        && listArchivedVerdicts(missionI.missionId).some(item => item.result === 'PASS')
        && staleWrite.ok === false,
      `priorReady=${readyBefore} current=${currentI?.result} readyAfter=${readyAfter} write=${staleWrite.ok}`,
    ))

    const legacy = startMissionInput('Harbor lane inventory historical', 'legacy')
    legacy.engineeringClass = undefined
    const legacyReady = projectReadyFromVerdict({
      engineeringClass: undefined,
      tasksComplete: true,
      previewUrl: 'http://127.0.0.1:9',
      verdict: null,
    })
    const legacyBinding = evaluateApprovalBinding({
      engineeringClass: undefined,
      missionId: legacy.missionId,
    })
    const legacyView = buildContractVerdictView({
      missionId: legacy.missionId,
      engineeringClass: undefined,
      previewReady: true,
      projectReadyFlag: true,
    })
    results.push(check(
      'fixture_j_legacy_pre_contract',
      isStandaloneEngineerMission(legacy) === false
        && legacyReady === true
        && legacyBinding.ok === true
        && legacyBinding.reapprovalRequired === false
        && listExecutionApprovals(legacy.missionId).length === 0
        && legacyView.legacy === true
        && canEnterExecutionFromGraph({ engineeringClass: undefined } as never).ok === true,
      `legacyReady=${legacyReady} approvals=${listExecutionApprovals(legacy.missionId).length}`,
    ))

    const revoked = revokeCommandCenterExecution(reapproved.graphId)
    const revokedRecord = reapproved.approvalId ? loadExecutionApproval(reapproved.approvalId) : null
    const blockRevoked = evaluateApprovalBinding({
      engineeringClass: revoked.engineeringClass,
      missionId: revoked.missionId,
      graphId: revoked.graphId,
      missionContract: loadMissionContract(revoked.missionContractId!),
      acceptanceContract: loadAcceptanceContract(revoked.acceptanceContractId!),
    })
    results.push(check(
      'explicit_revoke_support',
      revokedRecord?.status === 'REVOKED' && blockRevoked.reapprovalRequired === true && revoked.specApproved === false,
      `status=${revokedRecord?.status} reapproval=${blockRevoked.reapprovalRequired}`,
    ))

    results.push(check('MUTATION_AFTER_CONTRACT_CHANGE_WITHOUT_REAPPROVAL', mutationWithoutReapproval === 0, String(mutationWithoutReapproval)))
    results.push(check('STALE_APPROVAL_TOOL_WRITE_COUNT', staleApprovalWrites === 0, String(staleApprovalWrites)))
    results.push(check('PROJECT_READY_WITH_STALE_APPROVAL', projectReadyWithStale === 0, String(projectReadyWithStale)))
    results.push(check('VERDICT_PASS_WITH_STALE_APPROVAL', verdictPassWithStale === 0, String(verdictPassWithStale)))
    results.push(check('SILENT_APPROVAL_HASH_REPLACEMENT_COUNT', silentHashReplacement === 0, String(silentHashReplacement)))
  } finally {
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    if (previousProjects === undefined) delete process.env.FOUNDRY_PROJECTS_ROOT
    else process.env.FOUNDRY_PROJECTS_ROOT = previousProjects
    if (previousCc === undefined) delete process.env.FOUNDRY_COMMAND_CENTER_ROOT
    else process.env.FOUNDRY_COMMAND_CENTER_ROOT = previousCc
    rmSync(contractsRoot, { recursive: true, force: true })
    rmSync(projectsRoot, { recursive: true, force: true })
    rmSync(ccRoot, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({
    ok: failed.length === 0,
    passed: results.filter(item => item.pass).length,
    failed: failed.length,
    counts: {
      MUTATION_AFTER_CONTRACT_CHANGE_WITHOUT_REAPPROVAL: mutationWithoutReapproval,
      STALE_APPROVAL_TOOL_WRITE_COUNT: staleApprovalWrites,
      PROJECT_READY_WITH_STALE_APPROVAL: projectReadyWithStale,
      VERDICT_PASS_WITH_STALE_APPROVAL: verdictPassWithStale,
      SILENT_APPROVAL_HASH_REPLACEMENT_COUNT: silentHashReplacement,
    },
    results,
  }, null, 2))
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryContractReapprovalValidation }

/**
 * Commander-facing read model for sealed contracts, criterion evidence, and Verdict.
 * Reads the existing Foundry contract store. Does not duplicate persistence and
 * does not mutate sealed contracts. Server-only — browser types live in
 * foundryContractVerdictView.types.ts.
 */
import type { FoundryCommandCenterGraph } from './foundryAgentTypes'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import { classifyLegacyPreContract } from './foundryContractTypes'
import { loadAcceptanceContract, loadContractEvents, loadMissionContract, loadVerdictRecord, listAcceptanceEvidence, listExecutionApprovals } from './foundryContractStore'
import { evaluateAllCriteria, evidenceIsCurrentGeneration } from './foundryAcceptanceEvidence'
import { canComplete } from './foundryVerdictLayer'
import { evaluateApprovalBinding, loadActiveExecutionApproval } from './foundryExecutionApproval'
import type {
  FoundryContractVerdictView,
  FoundryContractVerdictViewInput,
  FoundryCriterionUiRow,
  FoundryCriterionUiStatus,
  FoundryVerdictUiState,
} from './foundryContractVerdictView.types'
import {
  commanderCompletionRefusedReason,
  commanderNextAction,
  compactFoundryHash,
  sanitizeCommanderEvidenceText,
  truthfulHeadlineForView,
} from './foundryContractVerdictView.types'

export {
  FOUNDRY_CRITERION_UI_STATUSES,
  FOUNDRY_VERDICT_UI_STATES,
  FOUNDRY_TRUTHFUL_HEADLINES,
  compactFoundryHash,
  sanitizeCommanderEvidenceText,
  commanderCompletionRefusedReason,
  commanderNextAction,
  truthfulHeadlineForView,
  projectReadyUiAdmissible,
} from './foundryContractVerdictView.types'
export type {
  FoundryCriterionUiStatus,
  FoundryVerdictUiState,
  FoundryTruthfulHeadline,
  FoundryCriterionUiRow,
  FoundryContractVerdictView,
  FoundryContractVerdictViewInput,
} from './foundryContractVerdictView.types'

function criterionUiStatus(row: { satisfied: boolean; reason: string; stale: boolean }): FoundryCriterionUiStatus {
  if (row.stale || row.reason === 'STALE_EVIDENCE_CANNOT_SATISFY_CRITERION') return 'STALE'
  if (row.satisfied) return 'PASS'
  if (row.reason === 'criterion FAIL') return 'FAIL'
  if (row.reason === 'UNBOUND_PASS_CANNOT_SATISFY_CRITERION' || /no evidence/i.test(row.reason)) return 'MISSING'
  return 'INCONCLUSIVE'
}

export function buildContractVerdictView(input: FoundryContractVerdictViewInput): FoundryContractVerdictView {
  const engineeringClass = classifyLegacyPreContract(input.engineeringClass)
  const legacy = engineeringClass !== 'STANDALONE_ENGINEER'
  if (legacy) {
    return {
      engineeringClass,
      legacy: true,
      legacyLabel: 'LEGACY MISSION',
      missionId: input.missionId,
      specVersion: null,
      specApproved: Boolean(input.specApproved),
      reapprovalRequired: false,
      previousSpecVersion: null,
      previousMissionHash: null,
      previousAcceptanceHash: null,
      missionContract: {
        id: null,
        status: null,
        hash: null,
        compactHash: '—',
        specVersion: null,
        engineeringClass,
        sealed: false,
      },
      acceptanceContract: {
        id: null,
        status: null,
        hash: null,
        compactHash: '—',
        criterionCount: 0,
        sealed: false,
      },
      criteria: [],
      verdict: 'NOT_EVALUATED',
      verdictReason: 'Pre-contract mission; Standalone Engineer contract gates do not apply.',
      evaluatedAt: null,
      reviewOutcome: null,
      completionRefusedReason: null,
      projectReadyAdmissible: Boolean(input.previewReady || input.projectReadyFlag),
      truthfulHeadline: 'LEGACY MISSION',
      nextAction: 'Pre-contract mission; Standalone Engineer contract gates do not apply.',
      approvalCopy: {
        specVersion: 'n/a',
        missionCompactHash: '—',
        acceptanceCompactHash: '—',
        bindsExecution: true,
      },
      approval: null,
      approvalHistory: [],
      schemaVersion: 1,
    }
  }
  const missionContract = input.missionContract
    ?? (input.missionContractId ? loadMissionContract(input.missionContractId) : null)
  const acceptanceContract = input.acceptanceContract
    ?? (input.acceptanceContractId ? loadAcceptanceContract(input.acceptanceContractId) : null)
  const evidence = input.evidence ?? (input.missionId ? listAcceptanceEvidence(input.missionId) : [])
  const verdictRecord = input.verdict === undefined
    ? (input.missionId ? loadVerdictRecord(input.missionId) : null)
    : input.verdict
  const events = input.events ?? (input.missionId ? loadContractEvents(input.missionId) : [])

  const liveMissionHash = missionContract?.contentHash ?? null
  const liveAcceptanceHash = acceptanceContract?.contentHash ?? null
  const binding = evaluateApprovalBinding({
    engineeringClass,
    missionId: input.missionId,
    graphId: input.graphId,
    missionContract,
    acceptanceContract,
  })
  const activeApproval = binding.approval ?? loadActiveExecutionApproval(input.missionId, input.graphId)
  const history = listExecutionApprovals(input.missionId)
  const previousApproval = [...history].reverse().find(item => item.status !== 'ACTIVE') ?? null
  const hashMismatch = Boolean(input.approvedMissionHash && liveMissionHash && input.approvedMissionHash !== liveMissionHash)
    || Boolean(input.approvedAcceptanceHash && liveAcceptanceHash && input.approvedAcceptanceHash !== liveAcceptanceHash)
    || Boolean(input.specVersion && missionContract?.specVersion && input.specVersion !== missionContract.specVersion)
  const reapprovalRequired = history.length
    ? binding.reapprovalRequired
    : Boolean(input.specApproved && hashMismatch)

  const satisfaction = acceptanceContract && missionContract
    ? evaluateAllCriteria(missionContract, acceptanceContract, evidence)
    : []
  const rows: FoundryCriterionUiRow[] = acceptanceContract && missionContract
    ? acceptanceContract.criteria.map(criterion => {
        const sat = satisfaction.find(item => item.criterionId === criterion.criterionId)
        const bound = evidence.filter(item => item.criterionId === criterion.criterionId)
        const chosen = sat?.evidenceId ? bound.find(item => item.evidenceId === sat.evidenceId) : bound[0] ?? null
        const stale = sat?.stale === true || (chosen ? !evidenceIsCurrentGeneration(chosen, missionContract, acceptanceContract) : false)
        return {
          criterionId: criterion.criterionId,
          description: criterion.description,
          verificationType: criterion.verificationType,
          required: criterion.required,
          status: sat ? criterionUiStatus(sat) : 'MISSING',
          evidenceId: chosen?.evidenceId ?? null,
          producer: chosen?.producer ?? null,
          timestamp: chosen?.timestamp ?? null,
          artifactReference: chosen?.artifactReference ? sanitizeCommanderEvidenceText(chosen.artifactReference, 120) : null,
          commandReference: chosen?.commandReference ? sanitizeCommanderEvidenceText(chosen.commandReference, 80) : null,
          result: chosen?.result ? sanitizeCommanderEvidenceText(chosen.result) : null,
          contentHash: chosen?.contentHash ?? null,
          specVersion: chosen?.specVersion ?? null,
          stale,
        }
      })
    : []

  let verdict: FoundryVerdictUiState = legacy
    ? 'NOT_EVALUATED'
    : verdictRecord?.result
      ?? 'NOT_EVALUATED'
  if (!legacy && !verdictRecord && missionContract?.status === 'SEALED') {
    if (rows.some(item => item.required && item.status === 'FAIL')) verdict = 'FAIL'
    else if (rows.some(item => item.required && item.status !== 'PASS')) verdict = 'INCONCLUSIVE'
  }

  const completeOk = canComplete({
    engineeringClass,
    missionContract,
    acceptanceContract,
    verdict: verdictRecord,
    missionId: input.missionId,
  }).ok === true
  const projectReadyAdmissible = legacy
    ? Boolean(input.previewReady || input.projectReadyFlag)
    : !reapprovalRequired && verdict === 'PASS' && completeOk

  const completionRefusedReason = commanderCompletionRefusedReason({
    verdict,
    criteria: rows,
    reviewOutcome: input.reviewOutcome ?? verdictRecord?.reviewOutcome,
    reapprovalRequired,
    events,
  })

  const nextAction = commanderNextAction({
    legacy,
    verdict,
    criteria: rows,
    reviewOutcome: input.reviewOutcome ?? verdictRecord?.reviewOutcome,
    reapprovalRequired,
    projectReadyAdmissible,
  })

  const truthfulHeadline = truthfulHeadlineForView({
    legacy,
    projectReadyAdmissible,
    verdict,
    reapprovalRequired,
    criteria: rows,
  })

  const reason = reapprovalRequired
    ? 'Contract changed after approval. Re-approval required.'
    : (verdictRecord?.reasons[0] ?? (legacy ? 'Pre-contract mission; Standalone Engineer contract gates do not apply.' : 'Independent verdict has not been evaluated.'))

  return {
    engineeringClass,
    legacy,
    legacyLabel: legacy ? 'LEGACY MISSION' : null,
    missionId: input.missionId,
    specVersion: missionContract?.specVersion ?? input.specVersion ?? null,
    specApproved: Boolean(input.specApproved) && !reapprovalRequired,
    reapprovalRequired,
    previousSpecVersion: reapprovalRequired ? (previousApproval?.specVersion ?? input.specVersion ?? null) : null,
    previousMissionHash: reapprovalRequired ? (previousApproval?.missionContractHash ?? input.approvedMissionHash ?? null) : null,
    previousAcceptanceHash: reapprovalRequired ? (previousApproval?.acceptanceContractHash ?? input.approvedAcceptanceHash ?? null) : null,
    missionContract: {
      id: missionContract?.missionContractId ?? input.missionContractId ?? null,
      status: missionContract?.status ?? null,
      hash: liveMissionHash,
      compactHash: compactFoundryHash(liveMissionHash),
      specVersion: missionContract?.specVersion ?? input.specVersion ?? null,
      engineeringClass,
      sealed: missionContract?.status === 'SEALED',
    },
    acceptanceContract: {
      id: acceptanceContract?.acceptanceContractId ?? input.acceptanceContractId ?? null,
      status: acceptanceContract?.status ?? null,
      hash: liveAcceptanceHash,
      compactHash: compactFoundryHash(liveAcceptanceHash),
      criterionCount: acceptanceContract?.criteria.length ?? 0,
      sealed: acceptanceContract?.status === 'SEALED',
    },
    criteria: rows,
    verdict,
    verdictReason: reason,
    evaluatedAt: verdictRecord?.evaluatedAt ?? null,
    reviewOutcome: input.reviewOutcome ?? verdictRecord?.reviewOutcome ?? null,
    completionRefusedReason,
    projectReadyAdmissible: Boolean(projectReadyAdmissible),
    truthfulHeadline,
    nextAction,
    approvalCopy: {
      specVersion: missionContract?.specVersion ? `v${missionContract.specVersion}` : (input.specVersion ? `v${input.specVersion}` : 'unsealed'),
      missionCompactHash: compactFoundryHash(liveMissionHash),
      acceptanceCompactHash: compactFoundryHash(liveAcceptanceHash),
      bindsExecution: true,
    },
    approval: activeApproval || previousApproval ? {
      approvalId: (activeApproval ?? previousApproval)?.approvalId ?? null,
      status: (activeApproval ?? previousApproval)?.status ?? null,
      approvedAt: (activeApproval ?? previousApproval)?.approvedAt ?? null,
      specVersion: (activeApproval ?? previousApproval)?.specVersion ?? null,
      missionHash: (activeApproval ?? previousApproval)?.missionContractHash ?? null,
      acceptanceHash: (activeApproval ?? previousApproval)?.acceptanceContractHash ?? null,
      missionCompactHash: compactFoundryHash((activeApproval ?? previousApproval)?.missionContractHash),
      acceptanceCompactHash: compactFoundryHash((activeApproval ?? previousApproval)?.acceptanceContractHash),
      superseded: (activeApproval ?? previousApproval)?.status !== 'ACTIVE' || reapprovalRequired,
    } : null,
    approvalHistory: history.map(item => ({
      approvalId: item.approvalId,
      status: item.status,
      specVersion: item.specVersion,
      missionCompactHash: compactFoundryHash(item.missionContractHash),
      acceptanceCompactHash: compactFoundryHash(item.acceptanceContractHash),
      approvedAt: item.approvedAt,
    })),
    schemaVersion: 1,
  }
}

export function buildContractVerdictViewFromGraph(graph: FoundryCommandCenterGraph): FoundryContractVerdictView {
  return buildContractVerdictView({
    missionId: graph.missionId,
    graphId: graph.graphId,
    engineeringClass: graph.engineeringClass,
    specVersion: graph.specVersion,
    specApproved: graph.specApproved,
    approvedMissionHash: graph.missionContractHash,
    approvedAcceptanceHash: graph.acceptanceContractHash,
    missionContractId: graph.missionContractId,
    acceptanceContractId: graph.acceptanceContractId,
    reviewOutcome: graph.reviewOutcome,
    previewReady: Boolean(graph.preview?.localPreview) && graph.result?.projectReady === true,
    projectReadyFlag: graph.result?.projectReady === true,
    tasksComplete: graph.tasks.every(task => task.status === 'COMPLETE' || task.status === 'CANCELLED'),
    previewUrl: graph.preview?.localPreview,
  })
}

export function buildContractVerdictViewFromMission(mission: Pick<FoundryMissionRecord, 'missionId' | 'engineeringClass' | 'missionContractId' | 'acceptanceContractId' | 'missionContractHash' | 'acceptanceContractHash' | 'contractSpecApproved' | 'reviewOutcome' | 'status' | 'applicationBuilder'>): FoundryContractVerdictView {
  return buildContractVerdictView({
    missionId: mission.missionId,
    engineeringClass: mission.engineeringClass,
    specVersion: mission.applicationBuilder?.preview ? '1' : undefined,
    specApproved: mission.contractSpecApproved === true,
    approvedMissionHash: mission.missionContractHash,
    approvedAcceptanceHash: mission.acceptanceContractHash,
    missionContractId: mission.missionContractId,
    acceptanceContractId: mission.acceptanceContractId,
    reviewOutcome: mission.reviewOutcome,
    previewReady: mission.applicationBuilder?.preview?.status === 'PROJECT_READY',
    projectReadyFlag: mission.applicationBuilder?.preview?.status === 'PROJECT_READY' && mission.status === 'COMPLETE',
    previewUrl: mission.applicationBuilder?.preview?.localPreview,
    tasksComplete: mission.status === 'COMPLETE',
  })
}

export function commandCenterSnapshotWithContractViews(snapshot: {
  graphs: FoundryCommandCenterGraph[]
  runningTaskCount: number
  queuedTaskCount: number
  backgroundLabel: string
  governance: unknown
}) {
  return {
    ...snapshot,
    graphs: snapshot.graphs.map(graph => ({
      ...graph,
      contractVerdict: buildContractVerdictViewFromGraph(graph),
    })),
  }
}

export function falseUiSuccessCounts(view: FoundryContractVerdictView) {
  return {
    PROJECT_READY_UI_WITHOUT_VERDICT_PASS: view.truthfulHeadline === 'PROJECT READY' && view.verdict !== 'PASS' ? 1 : 0,
    GREEN_SUCCESS_WITH_INCONCLUSIVE_VERDICT: (view.truthfulHeadline === 'PROJECT READY' || view.truthfulHeadline === 'SITE READY') && (view.verdict === 'INCONCLUSIVE' || view.verdict === 'NOT_EVALUATED') ? 1 : 0,
    STALE_EVIDENCE_RENDERED_AS_PASS: view.criteria.filter(item => item.stale && item.status === 'PASS').length,
    LEGACY_FAKE_CONTRACT_COUNT: view.legacy && (Boolean(view.missionContract.hash) || Boolean(view.missionContract.id) || view.criteria.length > 0) ? 1 : 0,
  }
}

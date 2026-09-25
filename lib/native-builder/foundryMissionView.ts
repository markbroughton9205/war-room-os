import type { FoundryMissionRecord } from './foundryMissionTypes'
import { buildContractVerdictViewFromMission } from './foundryContractVerdictView'
import { buildResourceView } from './foundryResourceGovernor'
import { buildRuntimeView } from './foundryMissionRuntime'
import { buildUnattendedView } from './foundryUnattendedEngineer'
import { commanderWorkerRoutingView } from './foundryWorkerRouting'

/** Bounded Commander-facing projection. Detailed tool payloads remain in durable mission storage. */
export function toFoundryMissionCommanderView(mission: FoundryMissionRecord) {
  return {
    missionId: mission.missionId,
    title: mission.title,
    userRequest: mission.userRequest,
    kind: mission.kind,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    status: mission.status,
    phase: mission.phase,
    goal: mission.goal,
    successCriteria: mission.successCriteria,
    constraints: mission.constraints,
    currentStep: mission.currentStep,
    plan: mission.plan,
    observations: mission.observations.slice(-20),
    journal: mission.journal.slice(-50),
    blocker: mission.blocker,
    authorization: mission.authorization,
    priority: mission.priority ?? 'NORMAL',
    lastHeartbeat: mission.lastHeartbeat ?? null,
    currentAction: mission.currentAction ?? null,
    pauseRequested: mission.pauseRequested === true,
    activeToolCallId: mission.activeToolCallId ?? null,
    lockClaims: (mission.lockClaims ?? []).map(claim => claim.resource),
    runtimeClaims: mission.runtimeClaims ?? [],
    pinnedModel: mission.pinnedModel ?? null,
    recovery: mission.recovery ?? null,
    visibility: mission.visibility ?? 'commander',
    archived: Boolean(mission.archived),
    superseded: Boolean(mission.superseded),
    resumeEligible: mission.resumeEligible !== false && !mission.archived && !mission.superseded,
    testArtifact: Boolean(mission.testArtifact),
    classification: mission.classification ?? null,
    productionRole: mission.productionRole ?? null,
    productionOwner: mission.productionOwner === true,
    parentMissionId: mission.parentMissionId ?? null,
    durableToolCalls: (mission.durableToolCalls ?? []).slice(-12).map(call => ({
      toolCallId: call.toolCallId,
      tool: call.tool,
      status: call.status,
      startTime: call.startTime,
      endTime: call.endTime,
      resultSummary: call.resultSummary,
    })),
    ownedArtifacts: (mission.ownedArtifacts ?? []).slice(-12),
    latestCheckpointId: mission.latestCheckpointId ?? null,
    agentEvents: (mission.agentEvents ?? []).slice(-24).map(event => ({
      eventId: event.eventId,
      at: event.at,
      type: event.type,
      text: event.text,
      tool: event.tool ?? null,
      ok: event.ok ?? null,
    })),
    planningMode: mission.planningMode === true,
    contextCompacted: mission.contextPack?.compacted === true,
    estimatedContextTokens: mission.contextPack?.estimatedTokens ?? null,
    hypotheses: mission.hypotheses ?? [],
    changedFiles: mission.sourceState.changedFiles,
    testState: mission.testState,
    sourceState: {
      changedFiles: mission.sourceState.changedFiles,
      newFiles: mission.sourceState.newFiles,
    },
    completionGate: mission.completionGate,
    modelState: mission.modelState
      ? {
          primaryProvider: mission.modelState.primaryProvider,
          activeProvider: mission.modelState.activeProvider,
          activeModel: mission.modelState.activeModel,
          fallbackProvider: mission.modelState.fallbackProvider,
          calls: mission.modelState.calls,
          lastReasoningSummary: mission.modelState.lastReasoningSummary,
          lastExpectedObservation: mission.modelState.lastExpectedObservation,
        }
      : undefined,
    engineeringReview: mission.engineering?.selfReview?.status ?? 'PENDING',
    engineeringReviewDetail: mission.engineering?.reviewDetail
      ?? (mission.engineering?.selfReview?.status === 'PASS'
        ? 'Checked:\n- implementation diff\n- targeted tests\n- regression impact'
        : mission.engineering?.selfReview?.compact ?? null),
    compactLine: mission.engineering?.compactLine ?? null,
    capabilityLane: mission.capabilityLane ?? (mission.kind === 'app_builder' ? 'APPLICATION_BUILDER' : 'WAR_ROOM_ENGINEERING'),
    engineeringClass: mission.engineeringClass ?? null,
    missionContractId: mission.missionContractId ?? null,
    acceptanceContractId: mission.acceptanceContractId ?? null,
    missionContractHash: mission.missionContractHash ?? null,
    acceptanceContractHash: mission.acceptanceContractHash ?? null,
    contractSpecApproved: mission.contractSpecApproved === true,
    executionApprovalId: mission.executionApprovalId ?? null,
    reviewOutcome: mission.reviewOutcome ?? null,
    contractVerdict: buildContractVerdictViewFromMission(mission),
    resourceView: mission.missionId ? buildResourceView(mission.missionId) : null,
    runtimeView: mission.missionId ? buildRuntimeView(mission.missionId) : null,
    unattendedView: mission.missionId ? buildUnattendedView(mission.missionId) : null,
    applicationPreview: mission.applicationBuilder?.preview ?? null,
    applicationProject: mission.applicationBuilder?.project
      ? {
          projectId: mission.applicationBuilder.project.projectId,
          projectName: mission.applicationBuilder.project.projectName,
          projectRoot: mission.applicationBuilder.project.projectRoot,
          projectType: mission.applicationBuilder.project.projectType,
          status: mission.applicationBuilder.project.status,
        }
      : null,
    reasoningSessionId: mission.reasoningSessionId ?? null,
    reasoningBrief: mission.reasoningBrief ?? null,
    reasoningStatus: mission.reasoningStatus ?? null,
    reasoningUpdatedAt: mission.reasoningUpdatedAt ?? null,
    workerRouting: mission.routingDecision
      ? {
          mode: mission.routingDecision.routingMode,
          selectedWorker: mission.actualWorker?.provider
            ? `${mission.actualWorker.provider}/${mission.actualWorker.model}`
            : null,
          previousWorker: mission.routingDecision.previousProvider
            ? `${mission.routingDecision.previousProvider}/${mission.routingDecision.previousModel}`
            : null,
          recommendedWorker: mission.recommendedWorker?.provider
            ? `${mission.recommendedWorker.provider}/${mission.recommendedWorker.model}`
            : commanderWorkerRoutingView(mission.routingDecision).recommendedWorker,
          why: mission.routingDecision.reason,
          capabilityEvidence: mission.routingDecision.selectionEvidenceIds.join(', ') || 'none',
          policy: mission.routingDecision.policyBasis,
          fallbackAllowed: mission.routingDecision.fallbackExplicit === true || mission.routingDecision.fallbackCandidates.length > 0,
          workerSwitchCount: mission.routingDecision.switchCount ?? 0,
        }
      : commanderWorkerRoutingView(),
  }
}

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { createAssemblyPlan } from './planner'
import { evaluateShadowEligibility } from './shadowEligibility'
import { createShadowSelectionReport } from './shadowComparison'
import type {
  ActualCouncilSelectionSnapshot,
  CouncilShadowSelectionReport,
  NormalizedShadowMissionInput,
  ShadowFeatureMode,
  ShadowRuntimeInput,
} from './shadowTypes'

const plannedRequestIds = new Set<string>()

export function resetShadowRuntimeForValidation(): void {
  plannedRequestIds.clear()
}

export function normalizeShadowMissionInput(input: {
  requestId: string
  logicalRequestId?: string | null
  missionId: string
  missionVersion: number
  commanderMessage: string
  councilFlowMode: string
  directInvocation?: boolean
  familyDeliberationRequested?: boolean
  uncertaintyFlags?: readonly string[]
}): NormalizedShadowMissionInput {
  return Object.freeze({
    requestId: input.requestId,
    logicalRequestId: input.logicalRequestId ?? null,
    missionId: input.missionId,
    missionVersion: input.missionVersion,
    commanderMessage: input.commanderMessage,
    councilFlowMode: input.councilFlowMode,
    directInvocation: input.directInvocation === true,
    familyDeliberationRequested: input.familyDeliberationRequested === true,
    uncertaintyFlags: Object.freeze([...(input.uncertaintyFlags ?? [])]),
  })
}

export function createActualSelectionSnapshot(input: {
  executionMode: string
  actualSelectedFamilies?: readonly CouncilOrchestrationFamily[]
  actualSynthesisFamily?: CouncilOrchestrationFamily | null
  actualSelectionSource?: ActualCouncilSelectionSnapshot['actualSelectionSource']
  actualSelectionFinalized?: boolean
  snapshotCapturedAt?: string
}): ActualCouncilSelectionSnapshot {
  const families = [...(input.actualSelectedFamilies ?? [])]
  return Object.freeze({
    executionMode: input.executionMode,
    actualSelectedFamilies: Object.freeze(families),
    actualSynthesisFamily: input.actualSynthesisFamily ?? null,
    actualRedTeamIncluded: families.includes('red_team'),
    actualSelectionSource: input.actualSelectionSource ?? 'existing_runtime',
    actualSelectionFinalized: input.actualSelectionFinalized ?? families.length > 0,
    snapshotCapturedAt: input.snapshotCapturedAt ?? new Date().toISOString(),
  })
}

export function runAdaptiveCouncilShadowSelection(input: ShadowRuntimeInput): CouncilShadowSelectionReport {
  const eligibility = evaluateShadowEligibility({
    featureMode: input.featureMode,
    missionInput: input.missionInput,
  })

  if (!eligibility.eligible) {
    return createShadowSelectionReport({
      missionInput: input.missionInput,
      actualSnapshot: input.actualSnapshot,
      eligibilityStatus: eligibility.status,
      eligibilityReason: eligibility.reason,
      plan: null,
      plannerStatus: 'not_run',
      comparisonStatus: 'not_run',
    })
  }

  if (plannedRequestIds.has(input.missionInput.requestId)) {
    return createShadowSelectionReport({
      missionInput: input.missionInput,
      actualSnapshot: input.actualSnapshot,
      eligibilityStatus: 'skipped',
      eligibilityReason: 'validation_only',
      plan: null,
      plannerStatus: 'not_run',
      comparisonStatus: 'not_run',
      extraUncertaintyFlags: ['duplicate_shadow_planning_prevented'],
    })
  }
  plannedRequestIds.add(input.missionInput.requestId)

  try {
    const plan = input.planFactory
      ? input.planFactory(input.missionInput)
      : createAssemblyPlan({
          missionId: input.missionInput.missionId,
          missionVersion: input.missionInput.missionVersion,
          commanderMessage: input.missionInput.commanderMessage,
          createdAt: input.actualSnapshot.snapshotCapturedAt,
          legacyCompatibilityOrigin:
            input.missionInput.councilFlowMode === 'stable_group'
              ? 'stable_group'
              : input.missionInput.councilFlowMode === 'full_council'
                ? 'full_council'
                : null,
        })
    return createShadowSelectionReport({
      missionInput: input.missionInput,
      actualSnapshot: input.actualSnapshot,
      eligibilityStatus: 'eligible',
      eligibilityReason: 'supported_council_request',
      plan,
      plannerStatus: 'completed',
    })
  } catch (error) {
    const safeActualSnapshot = createActualSelectionSnapshot({
      executionMode: input.actualSnapshot.executionMode,
      actualSelectedFamilies: [],
      actualSynthesisFamily: null,
      actualSelectionSource: 'unresolved',
      actualSelectionFinalized: false,
      snapshotCapturedAt: input.actualSnapshot.snapshotCapturedAt,
    })
    return createShadowSelectionReport({
      missionInput: input.missionInput,
      actualSnapshot: safeActualSnapshot,
      eligibilityStatus: 'planner_failed',
      eligibilityReason: 'planner_exception',
      plan: null,
      plannerStatus: 'failed',
      comparisonStatus: 'failed',
      extraUncertaintyFlags: [`planner_failed:${error instanceof Error ? error.message : String(error)}`],
    })
  }
}

export function shouldAttachShadowReport(featureMode: ShadowFeatureMode): boolean {
  return featureMode === 'response_metadata'
}

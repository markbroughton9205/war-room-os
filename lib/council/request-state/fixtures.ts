import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilFlowMode } from '@/lib/council/councilMode'
import {
  COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
  councilFamilyExecutionId,
  councilRequestId,
  defaultVisibilityState,
  type CouncilAuditMetadata,
  type CouncilExecutionStrategy,
  type CouncilFamilyExecutionRecord,
  type CouncilFamilyOutcome,
  type CouncilProviderReadiness,
  type CouncilRequestStateRecord,
  type CouncilSelectionAuthority,
} from './types'
import { deriveCouncilRequestCompletionSummary } from './invariants'

const CREATED_AT = '2026-07-18T00:00:00.000Z'

export function makeExecution(overrides: Partial<CouncilFamilyExecutionRecord> & {
  family: CouncilOrchestrationFamily
}): CouncilFamilyExecutionRecord {
  const requestId = overrides.requestId ?? councilRequestId('request-47c1-fixture')
  const family = overrides.family
  const lifecycle = overrides.lifecycle ?? 'terminal'
  const defaultOutcome: CouncilFamilyOutcome | null = lifecycle === 'terminal' ? 'complete' : null
  const outcome = Object.hasOwn(overrides, 'outcome') ? overrides.outcome ?? null : defaultOutcome
  const shouldRenderByDefault = lifecycle === 'terminal' && outcome === 'complete'
  const shouldDispatchByDefault = lifecycle === 'terminal'
    && outcome !== 'not_reached'
    && outcome !== 'skipped_by_policy'
    && outcome !== null
  return {
    schemaVersion: COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
    executionId: overrides.executionId ?? councilFamilyExecutionId(`exec-${family}`),
    requestId,
    family,
    selectionAuthority: overrides.selectionAuthority ?? 'system_selected',
    readinessSnapshot: overrides.readinessSnapshot ?? {
      readiness: 'connected',
      source: 'canonical_runtime',
      checkedAt: CREATED_AT,
      providerLabel: family,
    },
    lifecycle,
    outcome,
    createdAt: overrides.createdAt ?? CREATED_AT,
    queuedAt: overrides.queuedAt ?? CREATED_AT,
    dispatchedAt: overrides.dispatchedAt ?? (shouldDispatchByDefault ? CREATED_AT : null),
    completedAt: overrides.completedAt ?? (lifecycle === 'terminal' ? CREATED_AT : null),
    timeout: overrides.timeout ?? null,
    priorResponseLineage: overrides.priorResponseLineage ?? [],
    respondingToFamilyExecutionIds: overrides.respondingToFamilyExecutionIds ?? [],
    fallbackLineage: overrides.fallbackLineage ?? null,
    visibility: overrides.visibility ?? defaultVisibilityState({ rendered: shouldRenderByDefault }),
    auditRelevance: overrides.auditRelevance ?? 'auditable',
    safeDiagnosticCode: overrides.safeDiagnosticCode ?? null,
    safeDiagnosticMessage: overrides.safeDiagnosticMessage ?? null,
  }
}

export function makeRequest(overrides: Partial<CouncilRequestStateRecord> & {
  familyExecutions?: CouncilFamilyExecutionRecord[]
  expectedFamilies?: CouncilOrchestrationFamily[]
  selectedFamilies?: CouncilOrchestrationFamily[]
  flowMode?: CouncilFlowMode
  executionStrategy?: CouncilExecutionStrategy
} = {}): CouncilRequestStateRecord {
  const requestId = overrides.requestId ?? councilRequestId('request-47c1-fixture')
  const familyExecutions = (overrides.familyExecutions ?? [
    makeExecution({ requestId, family: 'chatgpt', selectionAuthority: 'direct_invocation' }),
  ]).map(record => ({ ...record, requestId }))
  const expectedFamilies = overrides.expectedFamilies ?? familyExecutions.map(record => record.family)
  const selectedFamilies = overrides.selectedFamilies ?? familyExecutions.map(record => record.family)
  const redTeamAudit: CouncilAuditMetadata = overrides.redTeamAudit ?? {
    scope: 'not_audited',
    reviewType: 'not_audited',
    expectedFamilies,
    receivedFamilies: [],
    missingFamilies: [],
    currentTurnPriorResponsesReceived: false,
  }
  return {
    schemaVersion: COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
    requestId,
    parentRequestId: overrides.parentRequestId ?? null,
    createdAt: overrides.createdAt ?? CREATED_AT,
    commanderTurnRef: overrides.commanderTurnRef ?? 'turn-fixture',
    flowMode: overrides.flowMode ?? 'direct',
    executionStrategy: overrides.executionStrategy ?? 'single_family_direct',
    expectedFamilies,
    selectedFamilies,
    familyExecutions,
    completionSummary: overrides.completionSummary ?? deriveCouncilRequestCompletionSummary(expectedFamilies, selectedFamilies, familyExecutions),
    cancellation: overrides.cancellation ?? { cancelled: false },
    redTeamAudit,
  }
}

export function terminalExecution(
  family: CouncilOrchestrationFamily,
  outcome: CouncilFamilyOutcome,
  readiness: CouncilProviderReadiness = 'connected',
  selectionAuthority: CouncilSelectionAuthority = 'system_selected',
): CouncilFamilyExecutionRecord {
  return makeExecution({
    family,
    selectionAuthority,
    readinessSnapshot: {
      readiness,
      source: 'canonical_runtime',
      checkedAt: CREATED_AT,
      providerLabel: family,
    },
    lifecycle: 'terminal',
    outcome,
    dispatchedAt: outcome === 'not_reached' || outcome === 'skipped_by_policy' ? null : CREATED_AT,
    visibility: defaultVisibilityState({
      rendered: outcome === 'complete',
      omitted: outcome !== 'complete',
      diagnosticOnly: outcome !== 'complete',
    }),
  })
}

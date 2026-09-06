import { useMemo } from 'react'

import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilProgressEventEnvelope } from '@/lib/council/progress-events/types'
import type { CouncilProgressRuntimeSnapshot } from '@/lib/council/progress-events/runtime'
import {
  buildCommanderOperationFromMessages,
  type CouncilOperationMessageInput,
} from './adapter'
import { countOperationFamilyContributions } from './operationSummary'
import { nebulaCommanderEventLabel, isHiddenFromCommanderTimeline } from '@/lib/council/nebula/visibleEvents'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import type {
  CommanderBriefing,
  CommanderOperation,
  CommanderOperationEvent,
  CommanderOperationEventProvenance,
  CommanderOperationEventType,
  CommanderOperationMode,
  CommanderOperationRequestKind,
  CommanderOperationStatus,
} from './types'

export type CouncilOperationRuntimeInput = {
  readonly progress: CouncilProgressRuntimeSnapshot | null | undefined
  readonly completedInputs?: readonly CouncilOperationMessageInput[]
  readonly requestText?: string | null
}

export type CouncilOperationPathMapping = {
  readonly path: string
  readonly requestIdentitySource: string
  readonly runtimeEventSource: string
  readonly finalResponseSource: string
  readonly reconciliationPath: string
  readonly fallbackPath: string
  readonly unsupportedStructuredStates: readonly string[]
  readonly runtimeSnapshotAvailable: boolean
  readonly incrementalTransportAvailable: boolean
}

const FAMILY_LABELS: Record<CouncilOrchestrationFamily | 'system' | 'unknown', string> = {
  chatgpt: 'AURORA',
  claude: 'ORION',
  grok: 'PULSAR',
  gemini: 'LUMEN',
  kimi: 'NOVA',
  red_team: 'PHOENIX',
  baby: 'Baby AI Observer',
  bridge_architect: 'Bridge Architect',
  system: 'System Status',
  unknown: 'Unknown Council agent',
}

const ROLE_LABELS: Record<CouncilOrchestrationFamily | 'system' | 'unknown', string> = {
  chatgpt: 'Strategy / Synthesis',
  claude: 'Architecture / Systems',
  grok: 'Current Signals',
  gemini: 'Knowledge / Documentation',
  kimi: 'Task Decomposition',
  red_team: 'Risk Review',
  baby: 'Observer',
  bridge_architect: 'Bridge Coordination',
  system: 'Runtime State',
  unknown: 'Unresolved Role',
}

const TERMINAL_STATUS_RANK: Record<CommanderOperationStatus, number> = {
  idle: 0,
  received: 1,
  interpreting: 2,
  assembling: 3,
  running: 4,
  waiting_for_provider: 5,
  synthesizing: 6,
  waiting_approval: 7,
  unknown: 8,
  completed: 20,
  completed_with_failures: 21,
  failed: 22,
  cancelled: 23,
}

export const COUNCIL_OPERATION_PATH_MAPPINGS: readonly CouncilOperationPathMapping[] = [
  mapping('direct invocation', 'councilProgress.requestId or councilLogicalRequestId', 'councilProgress.events returned by /api/chat final JSON', 'councilSingleResponse', 'runtime snapshot reconciled with direct response bubble', 'completed transcript fallback', ['incremental provider-start transport before final JSON'], true, false),
  mapping('ordinary Commander question', 'nearest Commander decree plus councilProgress.requestId', 'councilProgress.events returned by /api/chat final JSON when server path emits them', 'response messages', 'grouped runtime snapshot plus visible transcript', 'completed transcript fallback', ['browser-visible incremental event transport before response resolves'], true, false),
  mapping('decree', 'councilLogicalRequestId when client drives per-family calls', 'per-family /api/chat councilProgress snapshots returned in final JSON', 'released family messages', 'grouped transcript plus available progress snapshots', 'completed transcript fallback', ['single cross-family incremental transport'], true, false),
  mapping('status check', 'system/status message id or councilProgress.requestId', 'system state response when progress exists', 'system response message', 'runtime snapshot or reconstructed status record', 'completed transcript fallback', ['provider execution states when no provider is dispatched'], false, false),
  mapping('Stable Group', 'councilLogicalRequestId', 'per-family progress snapshots and family deliberation turns returned in final JSON', 'stable group final synthesis response when structured', 'request-id grouping plus final synthesis merge', 'completed transcript fallback', ['sequential browser transport from all providers before response resolves'], true, false),
  mapping('Full Council', 'councilProgress.requestId or logical request id', 'parallel provider progress snapshot returned by /api/chat final JSON', 'provider result messages', 'runtime snapshot plus final transcript merge', 'completed transcript fallback', ['intermediate provider updates before JSON response'], true, false),
  mapping('project packet', 'project packet id', 'project packet structured state', 'project packet approval briefing', 'project packet projection', 'project packet timeline', ['runtime provider states; no provider call occurs'], false, false),
  mapping('research request', 'councilProgress.requestId when routed through /api/chat or research report id', 'research route does not currently expose Council progress events', 'research report markdown', 'completed research response only', 'completed transcript fallback', ['source-level progress events in this timeline'], false, false),
  mapping('troubleshooting request', 'councilProgress.requestId or repair packet id', 'available /api/chat progress snapshot', 'repair packet or provider response', 'runtime snapshot if present; packet fallback otherwise', 'completed transcript fallback', ['repair route progress events'], false, false),
  mapping('approval review', 'approval packet/proposal id or councilProgress.requestId', 'approval state objects and /api/chat progress when present', 'approval review response', 'approval state projection', 'completed transcript fallback', ['approval lifecycle incremental transport'], false, false),
]

function mapping(
  path: string,
  requestIdentitySource: string,
  runtimeEventSource: string,
  finalResponseSource: string,
  reconciliationPath: string,
  fallbackPath: string,
  unsupportedStructuredStates: readonly string[],
  runtimeSnapshotAvailable: boolean,
  incrementalTransportAvailable: boolean,
): CouncilOperationPathMapping {
  return {
    path,
    requestIdentitySource,
    runtimeEventSource,
    finalResponseSource,
    reconciliationPath,
    fallbackPath,
    unsupportedStructuredStates,
    runtimeSnapshotAvailable,
    incrementalTransportAvailable,
  }
}

function readableStatus(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function roleLabel(family: CouncilOrchestrationFamily | 'system' | 'unknown' | null): string | null {
  if (!family) return null
  return ROLE_LABELS[family] ?? ROLE_LABELS.unknown
}

function labelForFamily(family: CouncilOrchestrationFamily | 'system' | 'unknown' | null): string | null {
  if (!family) return null
  return FAMILY_LABELS[family] ?? FAMILY_LABELS.unknown
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'event'
}

function operationIdForProgress(progress: CouncilProgressRuntimeSnapshot): string {
  return `operation-${safeId(progress.logicalRequestId ?? progress.requestId)}`
}

function requestKindFromProgress(progress: CouncilProgressRuntimeSnapshot): CommanderOperationRequestKind {
  const flowMode = progress.state.flowMode
  if (flowMode === 'direct') return 'direct_invocation'
  return 'council_mission'
}

function modeFromProgress(progress: CouncilProgressRuntimeSnapshot): CommanderOperationMode {
  const flowMode = progress.state.flowMode
  if (flowMode === 'direct') return 'direct'
  if (flowMode === 'stable_group') return 'stable_group'
  if (flowMode === 'full_council') return 'full_council'
  return 'unknown'
}

function eventProvenance(event: CouncilProgressEventEnvelope): CommanderOperationEventProvenance {
  if (event.source === 'provider_adapter') return 'runtime_event'
  if (event.source === 'integrity_layer') return 'runtime_event'
  if (event.source === 'commander') return 'system_state'
  return 'runtime_event'
}

function eventType(event: CouncilProgressEventEnvelope): CommanderOperationEventType | null {
  if (isHiddenFromCommanderTimeline(event)) return null
  switch (event.eventType) {
    case 'request_created':
      return 'request_received'
    case 'request_selection_resolved':
      return 'families_assigned'
    case 'request_started':
      return 'council_mode_selected'
    case 'family_waiting':
    case 'family_queued':
      return 'family_queued'
    case 'family_dispatched':
    case 'family_response_started':
      return 'family_started'
    case 'family_response_completed':
      return 'family_responded'
    case 'family_failed':
      return 'family_failed'
    case 'family_timed_out':
      return 'family_timed_out'
    case 'family_skipped_by_policy':
    case 'family_stopped_by_commander':
      return 'family_skipped'
    case 'family_not_reached':
      return 'family_unavailable'
    case 'family_retrieval_started':
    case 'family_retrieval_completed':
    case 'family_prior_response_delivered':
    case 'family_reviewing_previous':
    case 'fallback_started':
    case 'fallback_completed':
    case 'fallback_failed':
    case 'audit_started':
    case 'audit_scope_declared':
    case 'audit_completed':
    case 'audit_failed':
    case 'diagnostic_recorded':
      return 'system_state_inspected'
    case 'request_completed':
      return 'operation_completed'
    case 'request_failed':
    case 'request_timed_out':
      return 'operation_failed'
    case 'request_cancel_requested':
      return 'system_state_inspected'
    case 'request_cancelled':
      return 'operation_cancelled'
    default:
      return null
  }
}

function eventStatusLabel(event: CouncilProgressEventEnvelope): string {
  return nebulaCommanderEventLabel(event) ?? readableStatus(event.eventType)
}

function eventOutput(event: CouncilProgressEventEnvelope): string | null {
  const parts: string[] = []
  if (event.payload.readiness) parts.push(`Readiness: ${event.payload.readiness}`)
  if (event.payload.outcome) parts.push(`Outcome: ${event.payload.outcome}`)
  if (event.payload.reason) parts.push(`Reason: ${event.payload.reason}`)
  if (event.payload.audit) {
    const nameFor = (family: string) => displayNameForSeat(family as CouncilOrchestrationFamily, family)
    parts.push(`Audit: ${event.payload.audit.reviewType}`)
    parts.push(`Expected: ${event.payload.audit.expectedFamilies.map(nameFor).join(', ') || 'none'}`)
    parts.push(`Received: ${event.payload.audit.receivedFamilies.map(nameFor).join(', ') || 'none'}`)
    if (event.payload.audit.missingFamilies.length) parts.push(`Missing: ${event.payload.audit.missingFamilies.map(nameFor).join(', ')}`)
  }
  if (event.diagnostic?.safeMessage) parts.push(`Diagnostic: ${event.diagnostic.safeMessage}`)
  return parts.length ? parts.join('\n') : null
}

function isActualProviderOutput(event: CouncilProgressEventEnvelope, mappedType: CommanderOperationEventType): boolean {
  return event.source === 'provider_adapter' && mappedType === 'family_responded'
}

function eventFromProgress(event: CouncilProgressEventEnvelope, operationId: string): CommanderOperationEvent | null {
  const type = eventType(event)
  if (!type) return null
  const family = event.family ?? null
  const familyId = family ? family : type.startsWith('operation_') || type === 'families_assigned' || type === 'council_mode_selected' ? null : 'system'
  return Object.freeze({
    id: `${operationId}-runtime-${safeId(event.eventId)}`,
    sequence: event.sequence,
    timestamp: event.occurredAt,
    type,
    familyId,
    familyLabel: labelForFamily(familyId),
    roleLabel: roleLabel(familyId),
    statusLabel: eventStatusLabel(event),
    messageId: null,
    outputText: eventOutput(event),
    replyToEventId: null,
    replyToFamilyId: null,
    replyToLabel: null,
    provenance: eventProvenance(event),
    isActualProviderOutput: isActualProviderOutput(event, type),
    isFinal: type === 'operation_completed' || type === 'operation_failed' || type === 'operation_cancelled',
  })
}

function sortEvents(events: readonly CommanderOperationEvent[]): CommanderOperationEvent[] {
  return [...events].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence
    const at = a.timestamp ? Date.parse(a.timestamp) : Number.NaN
    const bt = b.timestamp ? Date.parse(b.timestamp) : Number.NaN
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt
    return a.id.localeCompare(b.id)
  })
}

function semanticKey(event: CommanderOperationEvent): string {
  return [
    event.type,
    event.familyId ?? 'none',
    event.messageId ?? 'none',
    event.replyToEventId ?? 'none',
    event.timestamp ?? 'none',
    event.outputText ?? 'none',
  ].join('|')
}

function dedupeEvents(events: readonly CommanderOperationEvent[]): CommanderOperationEvent[] {
  const byId = new Map<string, CommanderOperationEvent>()
  const seenSemantic = new Set<string>()
  for (const event of sortEvents(events)) {
    if (byId.has(event.id)) continue
    const key = semanticKey(event)
    if (seenSemantic.has(key)) continue
    if (isTerminalOperationEvent(event) && [...byId.values()].some(isTerminalOperationEvent)) continue
    seenSemantic.add(key)
    byId.set(event.id, event)
  }
  return [...byId.values()]
}

function isTerminalOperationEvent(event: CommanderOperationEvent): boolean {
  return event.type === 'operation_completed' || event.type === 'operation_failed' || event.type === 'operation_cancelled'
}

function progressStatus(events: readonly CommanderOperationEvent[], progress: CouncilProgressRuntimeSnapshot): CommanderOperationStatus {
  if (events.some(event => event.type === 'operation_cancelled')) return 'cancelled'
  if (events.some(event => event.type === 'operation_failed')) return 'failed'
  if (events.some(event => event.type === 'operation_completed')) {
    return events.some(event => event.type === 'family_failed' || event.type === 'family_timed_out' || event.type === 'family_unavailable')
      ? 'completed_with_failures'
      : 'completed'
  }
  if (events.some(event => event.type === 'approval_required' || event.type === 'family_waiting_approval')) return 'waiting_approval'
  if (events.some(event => event.type === 'synthesis_started' || event.familyId === 'chatgpt' && event.type === 'family_started')) return 'synthesizing'
  if (events.some(event => event.type === 'family_started' || event.type === 'family_queued')) return 'running'
  if (events.some(event => event.type === 'families_assigned')) return 'assembling'
  if (events.some(event => event.type === 'council_mode_selected')) return 'running'
  if (events.some(event => event.type === 'request_received')) return 'received'
  return progress.status === 'degraded' ? 'unknown' : 'idle'
}

function preserveMonotonicStatus(a: CommanderOperationStatus, b: CommanderOperationStatus): CommanderOperationStatus {
  return TERMINAL_STATUS_RANK[b] >= TERMINAL_STATUS_RANK[a] ? b : a
}

function summaryFor(mode: CommanderOperationMode, events: readonly CommanderOperationEvent[]) {
  const familyCounts = countOperationFamilyContributions(events)
  const respondedCount = familyCounts.respondedCount
  const failedCount = familyCounts.failedCount + events.filter(item => item.type === 'operation_failed').length
  const unavailableCount = familyCounts.unavailableCount
  const skippedCount = familyCounts.skippedCount
  const waitingApprovalCount = events.filter(item => item.type === 'approval_required' || item.type === 'family_waiting_approval').length
  const synthesisCompleted = events.some(item => item.type === 'synthesis_completed')
  const approvalRequired = waitingApprovalCount > 0
  const title = mode === 'direct'
    ? 'Direct operation'
    : mode === 'system'
      ? 'System operation'
      : 'Council operation'
  const fragments = [
    respondedCount ? `${respondedCount} agent${respondedCount === 1 ? '' : 's'} responded` : 'ASTRA coordinating',
    failedCount ? `${failedCount} failed/timed out` : null,
    unavailableCount ? `${unavailableCount} unavailable` : null,
    skippedCount ? `${skippedCount} skipped` : null,
    synthesisCompleted ? 'Synthesis completed' : null,
    approvalRequired ? 'Commander approval required' : null,
  ].filter((item): item is string => Boolean(item))
  return Object.freeze({
    title,
    respondedCount,
    failedCount,
    unavailableCount,
    skippedCount,
    waitingApprovalCount,
    synthesisCompleted,
    approvalRequired,
    label: fragments.join(' · '),
  })
}

function emptyBriefing(hasFinal: boolean, body?: string): CommanderBriefing {
  return Object.freeze({
    heading: 'Commander Briefing',
    body: hasFinal ? (body?.trim() || 'No final provider output was available.') : 'Not yet available.',
    risks: [],
    approvalRequirements: [],
    nextActions: [],
    evidenceStatus: 'Evidence not evaluated by this presentation layer.',
    recommendation: null,
  })
}

export function buildCommanderOperationFromProgressSnapshot(
  progress: CouncilProgressRuntimeSnapshot,
): CommanderOperation {
  const operationId = operationIdForProgress(progress)
  const events = dedupeEvents(progress.events.map(event => eventFromProgress(event, operationId)).filter((event): event is CommanderOperationEvent => Boolean(event)))
  const mode = modeFromProgress(progress)
  const status = progressStatus(events, progress)
  const completedAt = [...events].reverse().find(event => event.type === 'operation_completed' || event.type === 'operation_failed' || event.type === 'operation_cancelled')?.timestamp ?? null
  return Object.freeze({
    operationId,
    requestId: progress.requestId,
    sessionId: progress.logicalRequestId,
    requestKind: requestKindFromProgress(progress),
    mode,
    status,
    events,
    finalResponseId: null,
    completedAt,
    briefing: emptyBriefing(false),
    summary: summaryFor(mode, events),
    technicalData: progress,
    timelineSource: 'authoritative_runtime_snapshot',
    runtimeSnapshotAvailable: progress.events.length > 0,
    incrementalTransportAvailable: false,
  })
}

export function reconcileCommanderOperation(
  currentOperation: CommanderOperation,
  incomingRuntimeEvent: CouncilProgressEventEnvelope,
): CommanderOperation {
  // Once an operation has reached a terminal status, a late-arriving event (e.g. a stray retry
  // completion from a request that has already been superseded) must never reopen it or inflate
  // its summary counts — mirrors the terminal_reopened protection in reduceCouncilProgressEvent.
  if (TERMINAL_STATUS_RANK[currentOperation.status] >= TERMINAL_STATUS_RANK.completed) return currentOperation
  const mapped = eventFromProgress(incomingRuntimeEvent, currentOperation.operationId)
  if (!mapped) return currentOperation
  const events = dedupeEvents([...currentOperation.events, mapped])
  const mode = currentOperation.mode
  const candidateStatus = events.some(event => event.type === 'operation_cancelled')
    ? 'cancelled'
    : events.some(event => event.type === 'operation_failed')
      ? 'failed'
      : events.some(event => event.type === 'operation_completed')
        ? 'completed'
        : currentOperation.status
  const status = preserveMonotonicStatus(currentOperation.status, candidateStatus)
  return Object.freeze({
    ...currentOperation,
    status,
    events,
    completedAt: currentOperation.completedAt ?? (mapped.isFinal ? mapped.timestamp : null),
    summary: summaryFor(mode, events),
    runtimeSnapshotAvailable: true,
    incrementalTransportAvailable: false,
  })
}

export function mergeCommanderOperationWithCompletedTranscript(
  currentOperation: CommanderOperation,
  completedOperation: CommanderOperation,
): CommanderOperation {
  // `requestId` is per-HTTP-request and deliberately differs across a Full Council round's N
  // separate single-family requests — comparing it here silently discarded the completed
  // transcript for every multi-family round. `sessionId` (the client-supplied logicalRequestId)
  // is the identifier shared by every family's request within one round, so it's the correct
  // "same operation" signal; only reject the merge when it's present on both sides and disagrees.
  if (currentOperation.operationId !== completedOperation.operationId && currentOperation.sessionId && completedOperation.sessionId && currentOperation.sessionId !== completedOperation.sessionId) {
    return currentOperation
  }
  const events = dedupeEvents([...currentOperation.events, ...completedOperation.events])
  const status = preserveMonotonicStatus(currentOperation.status, completedOperation.status)
  return Object.freeze({
    ...currentOperation,
    status,
    events,
    finalResponseId: completedOperation.finalResponseId ?? currentOperation.finalResponseId,
    completedAt: completedOperation.completedAt ?? currentOperation.completedAt,
    briefing: completedOperation.finalResponseId ? completedOperation.briefing : currentOperation.briefing,
    summary: summaryFor(currentOperation.mode, events),
    timelineSource: 'reconciled_runtime_snapshot_and_transcript',
    runtimeSnapshotAvailable: currentOperation.runtimeSnapshotAvailable,
    incrementalTransportAvailable: false,
  })
}

export function buildCouncilOperationTimeline(input: CouncilOperationRuntimeInput): CommanderOperation | null {
  const completed = input.completedInputs?.length ? buildCommanderOperationFromMessages(input.completedInputs) : null
  if (!input.progress) return completed
  const live = buildCommanderOperationFromProgressSnapshot(input.progress)
  if (!completed) return live
  return mergeCommanderOperationWithCompletedTranscript(live, completed)
}

export function useCouncilOperationTimeline(input: CouncilOperationRuntimeInput): CommanderOperation | null {
  const { completedInputs, progress, requestText } = input
  return useMemo(
    () => buildCouncilOperationTimeline({ completedInputs, progress, requestText }),
    [completedInputs, progress, requestText],
  )
}

export function appMessageProviderStatusFromStructuredStatus(status: string | null | undefined, hasContent: boolean): string | null {
  if (status === 'FAILED' || status === 'TIMED_OUT' || status === 'UNAVAILABLE' || status === 'SKIPPED') return status
  if (hasContent) return 'OK'
  return 'SKIPPED'
}

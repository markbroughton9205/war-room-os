import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DeliberationTurn } from '@/lib/council/family-deliberation'
import type { ProjectOrchestrationPacket } from '@/lib/projects/projectOrchestrator'
import type {
  CommanderBriefing,
  CommanderOperation,
  CommanderOperationEvent,
  CommanderOperationEventType,
  CommanderOperationMode,
  CommanderOperationRequestKind,
  CommanderOperationStatus,
} from './types'

type ProviderStatus = 'OK' | 'FAILED' | 'TIMED_OUT' | 'UNAVAILABLE' | 'SKIPPED' | string
type OperationTerminalState = 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'request_completed'

export type CouncilOperationMessageInput = {
  readonly id: string
  readonly familyName: string
  readonly content: string
  readonly timestamp: string
  readonly provider?: string
  readonly messageType: string
  readonly requestText?: string | null
  readonly flowMode?: string | null
  readonly providerStatus?: ProviderStatus | null
  readonly familyDeliberationTurn?: DeliberationTurn | null
  readonly projectOrchestrationPacket?: ProjectOrchestrationPacket | null
  readonly requestId?: string | null
  readonly sessionId?: string | null
  readonly operationId?: string | null
  readonly isFinal?: boolean | null
  readonly responseType?: string | null
  readonly synthesized?: boolean | null
  readonly synthesisComplete?: boolean | null
  readonly requestCompleted?: boolean | null
  readonly operationStatus?: OperationTerminalState | string | null
  readonly completionEvent?: boolean | null
  readonly finalBriefing?: boolean | null
}

const FAMILY_BY_LABEL: Record<string, CouncilOrchestrationFamily | 'system' | 'unknown'> = {
  CHATGPT: 'chatgpt',
  CLAUDE: 'claude',
  GROK: 'grok',
  GEMINI: 'gemini',
  KIMI: 'kimi',
  'RED TEAM': 'red_team',
  SYSTEM: 'system',
  CONTROL: 'system',
}

const FAMILY_LABELS: Record<CouncilOrchestrationFamily | 'system' | 'unknown', string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  grok: 'Grok',
  gemini: 'Gemini',
  kimi: 'Kimi',
  red_team: 'Red Team',
  baby: 'Baby AI Observer',
  bridge_architect: 'Bridge Architect',
  system: 'System Status',
  unknown: 'Unknown Council family',
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

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'operation'
}

export function familyIdFromLabel(label: string): CouncilOrchestrationFamily | 'system' | 'unknown' {
  return FAMILY_BY_LABEL[label.trim().toUpperCase()] ?? 'unknown'
}

export function familyLabel(family: CouncilOrchestrationFamily | 'system' | 'unknown' | null): string | null {
  if (!family) return null
  return FAMILY_LABELS[family] ?? FAMILY_LABELS.unknown
}

function roleLabel(family: CouncilOrchestrationFamily | 'system' | 'unknown' | null): string | null {
  if (!family) return null
  return ROLE_LABELS[family] ?? ROLE_LABELS.unknown
}

function readableStatus(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function requestKindFromInput(input: CouncilOperationMessageInput): CommanderOperationRequestKind {
  if (input.messageType === 'project_orchestration' || input.projectOrchestrationPacket) return 'project'
  if (input.messageType === 'system') return 'status_check'
  if (/research|source|verify online|live information/i.test(input.requestText ?? '')) return 'research'
  if (/status|health|check/i.test(input.content) && familyIdFromLabel(input.familyName) === 'system') return 'status_check'
  if (/troubleshoot|debug|fix|repair/i.test(input.requestText ?? '')) return 'troubleshooting'
  if (/approve|approval|review/i.test(input.requestText ?? '')) return 'approval_review'
  if (input.flowMode === 'direct' || input.flowMode === 'direct_invocation') return 'direct_invocation'
  if (input.messageType === 'decree') return 'decree'
  if (input.content.includes('?')) return 'question'
  return 'council_mission'
}

function modeFromInput(input: CouncilOperationMessageInput): CommanderOperationMode {
  if (input.projectOrchestrationPacket) return 'system'
  if (input.flowMode === 'direct' || input.flowMode === 'direct_invocation') return 'direct'
  if (familyIdFromLabel(input.familyName) === 'system') return 'system'
  if (input.flowMode === 'full_council') return 'full_council'
  if (input.flowMode === 'stable_group') return 'stable_group'
  return 'unknown'
}

function event(
  input: Omit<CommanderOperationEvent, 'id'> & { id?: string },
  operationSeed: string,
): CommanderOperationEvent {
  return Object.freeze({
    id: input.id ?? `${operationSeed}-event-${input.sequence}`,
    ...input,
  })
}

function normalizedProviderStatus(status: ProviderStatus | null | undefined): string | null {
  return typeof status === 'string' ? status.trim().toUpperCase() || null : null
}

function eventTypeForProvider(status: ProviderStatus | null | undefined, hasOutput: boolean): CommanderOperationEventType {
  const normalizedStatus = normalizedProviderStatus(status)
  if (normalizedStatus === 'UNAVAILABLE') return 'family_unavailable'
  if (normalizedStatus === 'SKIPPED') return 'family_skipped'
  if (normalizedStatus === 'FAILED' || normalizedStatus === 'TIMED_OUT') return 'family_failed'
  if (hasOutput) return 'family_responded'
  return 'family_skipped'
}

function providerStatusLabel(status: ProviderStatus | null | undefined, hasOutput: boolean): string {
  const normalizedStatus = normalizedProviderStatus(status)
  if (normalizedStatus === 'UNAVAILABLE') return 'Unavailable'
  if (normalizedStatus === 'SKIPPED') return 'Skipped'
  if (normalizedStatus === 'FAILED') return 'Failed'
  if (normalizedStatus === 'TIMED_OUT') return 'Failed'
  if (hasOutput) return 'Responded'
  return 'Unknown'
}

function operationStatus(events: readonly CommanderOperationEvent[]): CommanderOperationStatus {
  if (events.some(item => item.type === 'operation_failed')) return 'failed'
  if (events.some(item => item.type === 'approval_required')) return 'waiting_approval'
  if (events.some(item => item.type === 'operation_completed')) {
    return events.some(item => item.type === 'family_failed' || item.type === 'family_unavailable')
      ? 'completed_with_failures'
      : 'completed'
  }
  return 'running'
}

function isAuthoritativeFinalOutput(input: CouncilOperationMessageInput): boolean {
  if (input.projectOrchestrationPacket) return true
  if (input.familyDeliberationTurn?.turn_role === 'council_synthesis' && input.familyDeliberationTurn.completion_status === 'complete') return true
  if (input.isFinal === true) return true
  if (input.synthesized === true || input.synthesisComplete === true || input.finalBriefing === true) return true
  if (input.responseType === 'final_synthesis' || input.responseType === 'commander_briefing') return true
  if (input.messageType === 'council_synthesis' || input.messageType === 'final_synthesis' || input.messageType === 'commander_briefing') return true
  return false
}

function hasAuthoritativeTerminalState(input: CouncilOperationMessageInput): boolean {
  if (input.projectOrchestrationPacket) return true
  if (input.requestCompleted === true || input.completionEvent === true) return true
  return input.operationStatus === 'completed' || input.operationStatus === 'request_completed'
}

function operationSeedFromInputs(inputs: readonly CouncilOperationMessageInput[]): string {
  const first = inputs[0]
  const sourceId = first?.operationId
    ?? first?.requestId
    ?? first?.sessionId
    ?? first?.familyDeliberationTurn?.session_id
    ?? first?.projectOrchestrationPacket?.id
    ?? first?.id
    ?? 'operation'
  return `operation-${safeId(sourceId)}`
}

function briefingFromText(text: string, requestKind: CommanderOperationRequestKind, hasFinalBriefing: boolean): CommanderBriefing {
  return Object.freeze({
    heading: requestKind === 'project' ? 'Commander Briefing' : 'Commander Briefing',
    body: hasFinalBriefing
      ? (text.trim() || 'No final provider output was available.')
      : 'No final Commander briefing was emitted by this Council path. The timeline below shows only real provider/runtime records; implementation remaining: emit a final_synthesis or commander_briefing message when the backend completes synthesis.',
    risks: [],
    approvalRequirements: requestKind === 'project' ? ['Commander approval required before execution.'] : [],
    nextActions: [],
    evidenceStatus: hasFinalBriefing
      ? 'Evidence not evaluated by this presentation layer.'
      : 'Not evaluated here. No source, provider, or synthesis evidence is fabricated.',
    recommendation: null,
  })
}

function summaryFor(mode: CommanderOperationMode, events: readonly CommanderOperationEvent[]) {
  const respondedCount = events.filter(item => item.type === 'family_responded' || item.type === 'synthesis_completed').length
  const failedCount = events.filter(item => item.type === 'family_failed' || item.type === 'operation_failed').length
  const unavailableCount = events.filter(item => item.type === 'family_unavailable').length
  const skippedCount = events.filter(item => item.type === 'family_skipped').length
  const waitingApprovalCount = events.filter(item => item.type === 'approval_required' || item.type === 'family_waiting_approval').length
  const synthesisCompleted = events.some(item => item.type === 'synthesis_completed')
  const approvalRequired = waitingApprovalCount > 0
  const title = mode === 'direct'
    ? 'Direct result'
    : mode === 'system'
      ? 'System status result'
      : 'Council result'
  const fragments = [
    respondedCount ? `${respondedCount} contribution${respondedCount === 1 ? '' : 's'} responded` : 'No provider contribution recorded',
    failedCount ? `${failedCount} failed` : null,
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

export function buildCommanderOperationFromMessage(input: CouncilOperationMessageInput): CommanderOperation {
  return buildCommanderOperationFromMessages([input])
}

export function buildCommanderOperationFromMessages(rawInputs: readonly CouncilOperationMessageInput[]): CommanderOperation {
  const inputs = rawInputs.filter(Boolean)
  if (!inputs.length) {
    throw new Error('Commander operation requires at least one message input.')
  }
  if (inputs.length === 1 && inputs[0]?.projectOrchestrationPacket) return buildCommanderOperationFromProjectPacket(inputs[0])
  if (inputs.some(item => item.projectOrchestrationPacket)) return buildCommanderOperationFromProjectPacket(inputs.find(item => item.projectOrchestrationPacket)!)

  const first = inputs[0]!
  const operationSeed = operationSeedFromInputs(inputs)
  const requestKind = requestKindFromInput(first)
  const mode = inputs.some(item => item.flowMode === 'full_council') ? 'full_council' : modeFromInput(first)
  const finalInput = inputs.find(isAuthoritativeFinalOutput) ?? null
  const terminalInput = inputs.find(hasAuthoritativeTerminalState) ?? null
  const messageFamilyById = new Map<string, CouncilOrchestrationFamily | 'system' | 'unknown'>()
  const eventIdByMessageId = new Map<string, string>()
  const events: CommanderOperationEvent[] = [
    event({
      sequence: 1,
      timestamp: first.timestamp || null,
      type: 'request_received',
      familyId: null,
      familyLabel: null,
      roleLabel: null,
      statusLabel: requestKind === 'status_check' ? 'Status check received' : 'Request received',
      messageId: null,
      outputText: first.requestText ?? null,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: 'system_state',
      isActualProviderOutput: false,
      isFinal: false,
    }, operationSeed),
    event({
      sequence: 2,
      timestamp: first.timestamp || null,
      type: 'request_interpreted',
      familyId: null,
      familyLabel: null,
      roleLabel: null,
      statusLabel: `${readableStatus(requestKind)} interpreted`,
      messageId: null,
      outputText: null,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: 'system_state',
      isActualProviderOutput: false,
      isFinal: false,
    }, operationSeed),
  ]

  inputs.forEach((input, index) => {
    const family = familyIdFromLabel(input.familyName)
    const hasOutput = input.content.trim().length > 0
    const eventType = family === 'system'
      ? 'system_state_inspected'
      : eventTypeForProvider(input.providerStatus, hasOutput)
    const statusLabel = family === 'system'
      ? 'System result'
      : providerStatusLabel(input.providerStatus, hasOutput)
    const replyTargetMessageId = input.familyDeliberationTurn?.input_message_ids
      .find(id => messageFamilyById.has(id))
      ?? null
    const replyToFamily = replyTargetMessageId ? messageFamilyById.get(replyTargetMessageId) ?? null : null
    const contributionEvent = event({
      sequence: events.length + 1,
      timestamp: input.timestamp || null,
      type: eventType,
      familyId: family,
      familyLabel: familyLabel(family),
      roleLabel: roleLabel(family),
      statusLabel,
      messageId: input.id,
      outputText: hasOutput ? input.content : null,
      replyToEventId: replyTargetMessageId ? eventIdByMessageId.get(replyTargetMessageId) ?? null : null,
      replyToFamilyId: replyToFamily,
      replyToLabel: replyToFamily ? familyLabel(replyToFamily) : null,
      provenance: family === 'system' ? 'system_state' : 'provider_response',
      isActualProviderOutput: family !== 'system' && hasOutput && statusLabel === 'Responded',
      isFinal: false,
      id: `${operationSeed}-message-${safeId(input.id || String(index + 1))}`,
    }, operationSeed)
    events.push(contributionEvent)
    messageFamilyById.set(input.id, family)
    eventIdByMessageId.set(input.id, contributionEvent.id)
  })

  if (finalInput) {
    const finalFamily = familyIdFromLabel(finalInput.familyName)
    const finalEventId = eventIdByMessageId.get(finalInput.id) ?? null
    const duplicateFinalExists = events.some(item => item.type === 'synthesis_completed' && item.messageId === finalInput.id)
    if (!duplicateFinalExists) {
      events.push(event({
        sequence: events.length + 1,
        timestamp: finalInput.timestamp || null,
        type: 'synthesis_completed',
        familyId: finalFamily,
        familyLabel: familyLabel(finalFamily),
        roleLabel: 'Final Response',
        statusLabel: 'Authoritative synthesis completed',
        messageId: finalInput.id,
        outputText: null,
        replyToEventId: finalEventId,
        replyToFamilyId: finalFamily,
        replyToLabel: familyLabel(finalFamily),
        provenance: 'provider_response',
        isActualProviderOutput: false,
        isFinal: true,
      }, operationSeed))
    }
  }

  if (terminalInput) {
    events.push(event({
      sequence: events.length + 1,
      timestamp: terminalInput.timestamp || null,
      type: 'operation_completed',
      familyId: null,
      familyLabel: null,
      roleLabel: 'Runtime State',
      statusLabel: 'Authoritative operation completed',
      messageId: terminalInput.id,
      outputText: null,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: 'runtime_event',
      isActualProviderOutput: false,
      isFinal: true,
    }, operationSeed))
  }

  const briefingText = finalInput?.content ?? ''
  const hasFinalBriefing = Boolean(finalInput)

  return Object.freeze({
    operationId: operationSeed,
    requestId: first.requestId ?? first.familyDeliberationTurn?.mission_id ?? null,
    sessionId: first.sessionId ?? first.familyDeliberationTurn?.session_id ?? null,
    requestKind,
    mode,
    status: operationStatus(events),
    events,
    finalResponseId: finalInput?.id ?? null,
    completedAt: terminalInput?.timestamp ?? null,
    briefing: briefingFromText(briefingText, requestKind, hasFinalBriefing),
    summary: summaryFor(mode, events),
    technicalData: null,
    timelineSource: 'completed_transcript',
    runtimeSnapshotAvailable: false,
    incrementalTransportAvailable: false,
  })
}

function buildCommanderOperationFromProjectPacket(input: CouncilOperationMessageInput): CommanderOperation {
  const packet = input.projectOrchestrationPacket!
  const operationSeed = `operation-${safeId(packet.id)}`
  const events: CommanderOperationEvent[] = [
    event({
      sequence: 1,
      timestamp: packet.createdAt,
      type: 'request_received',
      familyId: null,
      familyLabel: null,
      roleLabel: null,
      statusLabel: 'Project decree received',
      messageId: input.id,
      outputText: packet.intake.sourceDecree,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: 'system_state',
      isActualProviderOutput: false,
      isFinal: false,
    }, operationSeed),
    event({
      sequence: 2,
      timestamp: packet.createdAt,
      type: 'request_interpreted',
      familyId: null,
      familyLabel: null,
      roleLabel: null,
      statusLabel: `${packet.intake.projectType} interpreted`,
      messageId: input.id,
      outputText: packet.behaviorSummary,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: 'system_state',
      isActualProviderOutput: false,
      isFinal: false,
    }, operationSeed),
  ]

  packet.lanes.forEach((lane, index) => {
    const family = familyIdFromLabel(lane.family)
    events.push(event({
      sequence: index + 3,
      timestamp: packet.createdAt,
      type: lane.status === 'waiting_approval' ? 'family_waiting_approval' : 'lane_assigned',
      familyId: family,
      familyLabel: familyLabel(family),
      roleLabel: readableStatus(lane.lane),
      statusLabel: lane.status === 'waiting_approval' ? 'Waiting for approval' : 'Lane assigned',
      messageId: input.id,
      outputText: lane.role,
      replyToEventId: null,
      replyToFamilyId: null,
      replyToLabel: null,
      provenance: lane.status === 'waiting_approval' ? 'approval_state' : 'system_state',
      isActualProviderOutput: false,
      isFinal: false,
    }, operationSeed))
  })

  events.push(event({
    sequence: events.length + 1,
    timestamp: packet.createdAt,
    type: 'approval_required',
    familyId: null,
    familyLabel: null,
    roleLabel: 'Approval Gate',
    statusLabel: 'Commander approval required',
    messageId: input.id,
    outputText: packet.approvalPacket.executiveSummary,
    replyToEventId: null,
    replyToFamilyId: null,
    replyToLabel: null,
    provenance: 'approval_state',
    isActualProviderOutput: false,
    isFinal: true,
  }, operationSeed))

  return Object.freeze({
    operationId: operationSeed,
    requestId: packet.id,
    sessionId: null,
    requestKind: 'project',
    mode: 'system',
    status: 'waiting_approval',
    events,
    finalResponseId: input.id,
    completedAt: null,
    briefing: Object.freeze({
      heading: 'Commander Briefing',
      body: packet.approvalPacket.executiveSummary,
      risks: packet.approvalPacket.openRisks,
      approvalRequirements: ['Commander approval required before lane work or external action.'],
      nextActions: packet.approvalPacket.nextDecreeSuggestions,
      evidenceStatus: packet.approvalPacket.evidenceSources.length
        ? packet.approvalPacket.evidenceSources.join('\n')
        : 'Evidence sources not attached yet.',
      recommendation: packet.approvalPacket.recommendedPath,
    }),
    summary: summaryFor('system', events),
    technicalData: packet,
    timelineSource: 'project_packet',
    runtimeSnapshotAvailable: false,
    incrementalTransportAvailable: false,
  })
}

export function buildReadableCommanderOperationCopy(operation: CommanderOperation, requestText?: string | null): string {
  const lines: string[] = [
    'WAR ROOM OS - COMMANDER BRIEFING',
    '',
    'REQUEST',
    requestText?.trim() || operation.events.find(item => item.type === 'request_received')?.outputText || 'Request unavailable',
    '',
    'OPERATION STATUS',
    readableStatus(operation.status),
    '',
    'COUNCIL ACTIVITY',
  ]

  for (const item of operation.events) {
    const actor = item.familyLabel ?? 'War Room'
    const role = item.roleLabel ?? 'Runtime'
    lines.push('', `${actor} - ${role} - ${item.statusLabel}`)
    if (item.replyToLabel) lines.push(`Replying to ${item.replyToLabel}`)
    if (item.outputText) lines.push(item.outputText)
  }

  if (operation.finalResponseId) {
    lines.push('', 'FINAL COMMANDER BRIEFING', operation.briefing.body)
    if (operation.briefing.recommendation) lines.push('', 'RECOMMENDATION', operation.briefing.recommendation)
    if (operation.briefing.risks.length) lines.push('', 'OPEN RISKS', ...operation.briefing.risks.map(item => `- ${item}`))
    if (operation.briefing.approvalRequirements.length) lines.push('', 'APPROVAL REQUIREMENTS', ...operation.briefing.approvalRequirements.map(item => `- ${item}`))
    if (operation.briefing.nextActions.length) lines.push('', 'NEXT ACTIONS', ...operation.briefing.nextActions.map(item => `- ${item}`))
    lines.push('', 'EVIDENCE STATUS', operation.briefing.evidenceStatus)
  }

  return lines
    .map(line => line.replace(/\bundefined\b|\bnull\b/g, '').trimEnd())
    .join('\n')
    .replace(/[{}]/g, '')
}

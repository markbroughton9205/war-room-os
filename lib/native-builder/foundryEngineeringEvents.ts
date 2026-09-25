/**
 * Foundry Engineering Runtime event model.
 * Operator-visible actions, observations, tool results, and repair hypotheses.
 * This is not a chain-of-thought transcript and not a second chat system.
 */

export const FOUNDRY_ENGINEERING_EVENT_TYPES = [
  'MISSION_STARTED',
  'MISSION_RESUMED',
  'WORKSPACE_SCAN_STARTED',
  'WORKSPACE_SCAN_PROGRESS',
  'WORKSPACE_SCAN_COMPLETE',
  'REPOSITORY_MAP_CREATED',
  'SEARCH_STARTED',
  'SEARCH_RESULT',
  'FILE_READING',
  'FILE_READ',
  'FILE_EDIT_PLANNED',
  'FILE_EDITING',
  'FILE_EDITED',
  'FILE_CREATED',
  'FILE_DELETED',
  'PATCH_CREATED',
  'PATCH_APPLIED',
  'COMMAND_QUEUED',
  'COMMAND_STARTED',
  'COMMAND_OUTPUT',
  'COMMAND_COMPLETED',
  'TEST_STARTED',
  'TEST_RESULT',
  'BUILD_STARTED',
  'BUILD_RESULT',
  'TYPECHECK_STARTED',
  'TYPECHECK_RESULT',
  'LINT_STARTED',
  'LINT_RESULT',
  'FORMAT_STARTED',
  'FORMAT_RESULT',
  'DEPENDENCY_CHECK',
  'PROCESS_STARTED',
  'PROCESS_PROGRESS',
  'PROCESS_STOPPED',
  'FAILURE_DETECTED',
  'FAILURE_SIGNATURE_CREATED',
  'ROOT_CAUSE_ANALYSIS_STARTED',
  'ROOT_CAUSE_FOUND',
  'REPAIR_HYPOTHESIS',
  'REPAIR_STARTED',
  'REPAIR_APPLIED',
  'REPAIR_VALIDATION_STARTED',
  'REPAIR_VALIDATION_RESULT',
  'STRATEGY_CHANGED',
  'CHECKPOINT_CREATED',
  'ROLLBACK_STARTED',
  'ROLLBACK_COMPLETE',
  'BLOCKED',
  'WAITING_FOR_APPROVAL',
  'MISSION_COMPLETE',
  'CAMPAIGN_STARTED',
  'ARCHITECTING',
  'PLAN_READY',
  'TASK_STARTED',
  'TASK_COMPLETE',
  'TASK_BLOCKED',
  'INTEGRATING',
  'REVIEWING',
  'VERIFICATION_STARTED',
  'VERIFICATION_FAILED',
  'REWORKING',
  'PROJECT_READY',
  'PROGRESS_EVALUATED',
  'COMMANDER_DECISION',
  'PLAN_REVISED',
] as const

export type FoundryEngineeringEventType = (typeof FOUNDRY_ENGINEERING_EVENT_TYPES)[number]

export type FoundryEngineeringStatus = 'running' | 'pass' | 'fail' | 'blocked' | 'info'

export type FoundryEngineeringCommandClass =
  | 'READ_ONLY'
  | 'REVERSIBLE_MUTATION'
  | 'DESTRUCTIVE'
  | 'EXTERNAL_SIDE_EFFECT'
  | 'PRODUCTION'
  | 'GIT_PERSISTENT'
  | 'FINANCIAL'

export type FoundryEngineeringGovernance = {
  commandClass?: FoundryEngineeringCommandClass
  allowed: boolean
  reason?: string
}

type EngineeringEventBase = {
  eventId: string
  missionId: string
  reasoningSessionId?: string
  timestamp: string
  phase: string
  status: FoundryEngineeringStatus
  summary: string
  detail?: string
  tool?: string
  command?: string
  cwd?: string
  filePath?: string
  lineRange?: { start: number; end: number }
  exitCode?: number
  durationMs?: number
  progress?: { current: number; total: number; label?: string }
  attempt?: number
  failureSignature?: string
  strategy?: string
  previousStrategy?: string
  repairHypothesis?: string
  validationResult?: 'PASS' | 'FAIL' | 'SKIPPED'
  artifact?: { kind: string; ref: string }
  governance?: FoundryEngineeringGovernance
  visibility: 'operator'
  rawOutputRef?: string
  outputTail?: string
  diff?: string
  coalescedCount?: number
}

export type FoundryEngineeringEvent =
  | (EngineeringEventBase & { type: 'COMMAND_STARTED' | 'COMMAND_OUTPUT' | 'COMMAND_COMPLETED' | 'COMMAND_QUEUED'; command: string })
  | (EngineeringEventBase & { type: 'FILE_READING' | 'FILE_READ' | 'FILE_EDIT_PLANNED' | 'FILE_EDITING' | 'FILE_EDITED' | 'FILE_CREATED' | 'FILE_DELETED' | 'PATCH_CREATED' | 'PATCH_APPLIED'; filePath: string })
  | (EngineeringEventBase & { type: 'FAILURE_DETECTED' | 'FAILURE_SIGNATURE_CREATED'; failureSignature: string })
  | (EngineeringEventBase & { type: 'STRATEGY_CHANGED'; strategy: string; previousStrategy: string })
  | (EngineeringEventBase & { type: Exclude<FoundryEngineeringEventType, 'COMMAND_STARTED' | 'COMMAND_OUTPUT' | 'COMMAND_COMPLETED' | 'COMMAND_QUEUED' | 'FILE_READING' | 'FILE_READ' | 'FILE_EDIT_PLANNED' | 'FILE_EDITING' | 'FILE_EDITED' | 'FILE_CREATED' | 'FILE_DELETED' | 'PATCH_CREATED' | 'PATCH_APPLIED' | 'FAILURE_DETECTED' | 'FAILURE_SIGNATURE_CREATED' | 'STRATEGY_CHANGED'> })

export type FoundryEngineeringFailureAttempt = {
  signature: string
  strategy: string
  sourceFingerprint: string
  summary: string
}

import type { BlockedProgressEvidence } from './foundryProgressEvaluation'

export type FoundryBlockedDetail = {
  summary: string
  failure: string
  attempts: { strategy: string; outcome: string }[]
  currentState: string
  rolledBack: boolean
  boundary: string
  unblockAction: string
  /** Typed stagnation / progress evidence (smart stagnation). Present on blocks decided by the progress evaluator. */
  progress?: BlockedProgressEvidence
}

export type FoundryEngineeringCheckpoint = {
  id: string
  missionId: string
  at: string
  files: { path: string; fingerprint: string }[]
  commandsRun: string[]
  validationState: string
  failureSignatures: string[]
  strategy: string | null
  nextAction: string
}

export type FoundryScopeManifest = {
  read: string[]
  modified: string[]
  created: string[]
  deleted: string[]
  excluded: string[]
}

export type FoundryEngineeringCompletion = {
  canComplete: boolean
  changedFiles: string[]
  tests: { command: string; ok: boolean; summary: string }[]
  build: { ran: boolean; ok: boolean; summary: string }
  runtime: { ran: boolean; ok: boolean; summary: string }
  limitations: string[]
  commitOccurred: boolean
  pushOccurred: boolean
  deployOccurred: boolean
}

export type FoundryEngineeringEditReceipt = {
  file: string
  operation: string
  beforeFingerprint: string
  afterFingerprint: string
  linesChanged: number
  reason: string
  validation: 'PASS' | 'FAIL'
}

export type FoundryEngineeringRuntimeState = {
  events: FoundryEngineeringEvent[]
  checkpoints: FoundryEngineeringCheckpoint[]
  scope: FoundryScopeManifest
  strategiesTried: string[]
  currentStrategy: string | null
  failureAttempts: FoundryEngineeringFailureAttempt[]
  processes: { id: string; command: string; pid?: number; phase: string; startedAt: string; lastAt: string; exitCode?: number }[]
  terminalCollapsed: true
  blockedDetail?: FoundryBlockedDetail | null
  completion?: FoundryEngineeringCompletion | null
  rawOutputs: { ref: string; text: string }[]
  preexistingPaths: string[]
  receipts: FoundryEngineeringEditReceipt[]
  largeProject?: import('./foundryLargeProject').LargeProjectState | null
  campaign?: import('./foundryEngineeringCampaign').EngineeringCampaign | null
}

const OUTPUT_TAIL = 1200
const MAX_EVENTS = 240
const MAX_RAW = 6
const MAX_RAW_CHARS = 8000

let eventSeq = 0

export function nextEngineeringEventId(now = Date.now()): string {
  eventSeq += 1
  return `eng-${now.toString(36)}-${eventSeq.toString(36)}`
}

export function emptyEngineeringRuntime(): FoundryEngineeringRuntimeState {
  return {
    events: [],
    checkpoints: [],
    scope: { read: [], modified: [], created: [], deleted: [], excluded: [] },
    strategiesTried: [],
    currentStrategy: null,
    failureAttempts: [],
    processes: [],
    terminalCollapsed: true,
    blockedDetail: null,
    completion: null,
    rawOutputs: [],
    preexistingPaths: [],
    receipts: [],
    largeProject: null,
    campaign: null,
  }
}

export function engineeringEvent(
  type: FoundryEngineeringEventType,
  fields: Omit<EngineeringEventBase, 'eventId' | 'timestamp' | 'visibility' | 'phase' | 'status'> & {
    eventId?: string
    timestamp?: string
    phase?: string
    status?: FoundryEngineeringStatus
  },
): FoundryEngineeringEvent {
  const phase = fields.phase ?? phaseForEvent(type)
  const status = fields.status ?? 'info'
  return {
    ...fields,
    type,
    eventId: fields.eventId ?? nextEngineeringEventId(),
    timestamp: fields.timestamp ?? new Date().toISOString(),
    phase,
    status,
    visibility: 'operator',
  } as FoundryEngineeringEvent
}

export function phaseForEvent(type: FoundryEngineeringEventType): string {
  switch (type) {
    case 'WORKSPACE_SCAN_STARTED':
    case 'WORKSPACE_SCAN_PROGRESS':
    case 'WORKSPACE_SCAN_COMPLETE':
    case 'REPOSITORY_MAP_CREATED':
    case 'SEARCH_STARTED':
    case 'SEARCH_RESULT':
    case 'FILE_READING':
    case 'FILE_READ':
      return 'ANALYZING'
    case 'FILE_EDIT_PLANNED':
    case 'FILE_EDITING':
    case 'FILE_EDITED':
    case 'FILE_CREATED':
    case 'FILE_DELETED':
    case 'PATCH_CREATED':
    case 'PATCH_APPLIED':
      return 'EDITING'
    case 'TEST_STARTED':
    case 'TEST_RESULT':
    case 'TYPECHECK_STARTED':
    case 'TYPECHECK_RESULT':
    case 'LINT_STARTED':
    case 'LINT_RESULT':
    case 'FORMAT_STARTED':
    case 'FORMAT_RESULT':
    case 'REPAIR_VALIDATION_STARTED':
    case 'REPAIR_VALIDATION_RESULT':
      return 'VALIDATING'
    case 'FAILURE_DETECTED':
    case 'FAILURE_SIGNATURE_CREATED':
    case 'ROOT_CAUSE_ANALYSIS_STARTED':
    case 'ROOT_CAUSE_FOUND':
    case 'REPAIR_HYPOTHESIS':
    case 'REPAIR_STARTED':
    case 'REPAIR_APPLIED':
    case 'STRATEGY_CHANGED':
      return 'REPAIRING'
    case 'BLOCKED':
    case 'WAITING_FOR_APPROVAL':
      return 'BLOCKED'
    case 'MISSION_COMPLETE':
    case 'PROJECT_READY':
      return 'COMPLETE'
    case 'CAMPAIGN_STARTED':
    case 'ARCHITECTING':
    case 'PLAN_READY':
    case 'TASK_STARTED':
    case 'TASK_COMPLETE':
    case 'TASK_BLOCKED':
    case 'INTEGRATING':
    case 'REVIEWING':
    case 'VERIFICATION_STARTED':
    case 'VERIFICATION_FAILED':
    case 'REWORKING':
      return 'PLANNING'
    case 'BUILD_STARTED':
    case 'BUILD_RESULT':
    case 'PROCESS_STARTED':
    case 'PROCESS_PROGRESS':
    case 'PROCESS_STOPPED':
    case 'COMMAND_QUEUED':
    case 'COMMAND_STARTED':
    case 'COMMAND_OUTPUT':
    case 'COMMAND_COMPLETED':
      return 'RUNNING'
    default:
      return 'PLANNING'
  }
}

function mergeTail(previous: string | undefined, next: string | undefined): string {
  const joined = `${previous ?? ''}${next ?? ''}`
  return joined.length <= OUTPUT_TAIL ? joined : joined.slice(-OUTPUT_TAIL)
}

export function reduceEngineeringEvents(
  existing: FoundryEngineeringEvent[],
  incoming: FoundryEngineeringEvent,
): FoundryEngineeringEvent[] {
  const last = existing.at(-1)
  const coalesce = last && (
    (incoming.type === 'COMMAND_OUTPUT' && last.type === 'COMMAND_OUTPUT' && last.command === incoming.command)
    || (incoming.type === 'PROCESS_PROGRESS' && last.type === 'PROCESS_PROGRESS' && last.command === incoming.command)
    || (incoming.type === 'WORKSPACE_SCAN_PROGRESS' && last.type === 'WORKSPACE_SCAN_PROGRESS')
  )
  if (coalesce && last) {
    const merged: FoundryEngineeringEvent = {
      ...incoming,
      eventId: last.eventId,
      timestamp: incoming.timestamp,
      detail: mergeTail(last.detail, incoming.detail),
      outputTail: mergeTail(last.outputTail, incoming.outputTail ?? incoming.detail),
      progress: incoming.progress ?? last.progress,
      coalescedCount: (last.coalescedCount ?? 1) + 1,
      summary: incoming.summary || last.summary,
    }
    return [...existing.slice(0, -1), merged]
  }
  const next = [...existing, incoming]
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
}

export function rememberRawOutput(
  runtime: FoundryEngineeringRuntimeState,
  ref: string,
  text: string,
): FoundryEngineeringRuntimeState {
  const clipped = text.length > MAX_RAW_CHARS ? text.slice(-MAX_RAW_CHARS) : text
  const rawOutputs = [...runtime.rawOutputs.filter(item => item.ref !== ref), { ref, text: clipped }]
  return { ...runtime, rawOutputs: rawOutputs.slice(-MAX_RAW) }
}

export function activityTitle(event: { type: string; phase: string; summary: string }): string {
  switch (event.type) {
    case 'WORKSPACE_SCAN_STARTED':
      return /LARGE_PROJECT/.test(event.summary) ? 'ANALYZING PROJECT' : event.phase
    case 'WORKSPACE_SCAN_COMPLETE':
      return /MAPPING REPOSITORY/.test(event.summary) ? 'MAPPING REPOSITORY' : event.phase
    case 'REPOSITORY_MAP_CREATED':
      return 'ANALYZING REPOSITORY'
    case 'SEARCH_STARTED':
    case 'SEARCH_RESULT':
      return 'SEARCHING'
    case 'FILE_EDIT_PLANNED':
      return 'PLANNING REPAIR'
    case 'TEST_STARTED':
      return 'TESTING'
    case 'REPAIR_VALIDATION_STARTED':
      return 'RECHECKING'
    case 'CHECKPOINT_CREATED':
      return event.summary || event.phase
    case 'FILE_READING':
    case 'FILE_READ':
      return 'READING'
    case 'FAILURE_DETECTED':
    case 'ROOT_CAUSE_FOUND':
      return 'FOUND ISSUE'
    case 'REPAIR_HYPOTHESIS':
    case 'REPAIR_STARTED':
    case 'REPAIR_APPLIED':
      return 'REPAIRING'
    case 'FILE_EDITED':
    case 'PATCH_APPLIED':
      return 'EDITED'
    case 'REPAIR_VALIDATION_RESULT':
    case 'TEST_RESULT':
      return 'VALIDATING FIX'
    case 'PROCESS_PROGRESS':
      return 'TRAINING'
    case 'BLOCKED':
      return 'BLOCKED'
    case 'MISSION_COMPLETE':
    case 'PROJECT_READY':
      return 'COMPLETE'
    case 'CAMPAIGN_STARTED':
      return 'CAMPAIGN'
    case 'ARCHITECTING':
      return 'ARCHITECTING'
    case 'PLAN_READY':
      return 'PLAN READY'
    case 'TASK_STARTED':
    case 'TASK_COMPLETE':
    case 'TASK_BLOCKED':
      return event.summary
    case 'INTEGRATING':
      return 'INTEGRATING'
    case 'REVIEWING':
      return 'REVIEWING'
    case 'VERIFICATION_STARTED':
      return 'VERIFYING'
    case 'VERIFICATION_FAILED':
      return 'VERIFICATION FAILED'
    case 'REWORKING':
      return 'REWORKING'
    default:
      return event.phase
  }
}

export function workstreamTextForEvent(event: { phase: string; summary: string; filePath?: string; command?: string }): string {
  const target = event.filePath || event.command
  return target ? `${event.phase} — ${event.summary} (${target})` : `${event.phase} — ${event.summary}`
}

export type WorkspacePathClass = 'PREEXISTING' | 'MISSION_MODIFIED' | 'MISSION_CREATED' | 'MISSION_DELETED' | 'UNTOUCHED'

export function classifyWorkspacePath(input: {
  path: string
  preexisting: readonly string[]
  modified: readonly string[]
  created: readonly string[]
  deleted: readonly string[]
}): WorkspacePathClass {
  if (input.deleted.includes(input.path)) return 'MISSION_DELETED'
  if (input.created.includes(input.path)) return 'MISSION_CREATED'
  if (input.modified.includes(input.path)) return 'MISSION_MODIFIED'
  if (input.preexisting.includes(input.path)) return 'PREEXISTING'
  return 'UNTOUCHED'
}

export function outsideSpanUnchanged(before: string, after: string, start: number, end: number): boolean {
  if (start < 0 || end < start || end > before.length) return false
  const prefix = before.slice(0, start)
  const suffix = before.slice(end)
  if (!after.startsWith(prefix)) return false
  if (suffix.length === 0) return true
  return after.endsWith(suffix) && after.length >= prefix.length + suffix.length
}

export function spanChanged(before: string, after: string, start: number, end: number): boolean {
  if (!outsideSpanUnchanged(before, after, start, end)) return false
  const prefix = before.slice(0, start)
  const suffix = before.slice(end)
  const middle = suffix.length === 0 ? after.slice(prefix.length) : after.slice(prefix.length, after.length - suffix.length)
  return middle !== before.slice(start, end)
}

export function lineDiff(before: string, after: string, file: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  const lines = [`--- ${file}`, `+++ ${file}`]
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue
    if (a[i] !== undefined) lines.push(`-${a[i]}`)
    if (b[i] !== undefined) lines.push(`+${b[i]}`)
  }
  return lines.join('\n')
}

export function countLineChanges(diff: string): { plus: number; minus: number } {
  const rows = diff.split('\n')
  return {
    plus: rows.filter(row => row.startsWith('+') && !row.startsWith('+++')).length,
    minus: rows.filter(row => row.startsWith('-') && !row.startsWith('---')).length,
  }
}

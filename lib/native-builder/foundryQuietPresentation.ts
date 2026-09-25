/**
 * Quiet Execution presentation layer.
 *
 * Foundry's engineering runtime persists a rich, authoritative event stream (task starts/completions,
 * receipts, commands, edits, reviews). That stream is NOT changed here. This module only *presents*
 * it: it groups events into a handful of compact activity items, derives one in-place progress
 * state, translates internal states into Commander language, and decides when a Commander
 * intervention is genuinely required.
 *
 * Invariants (enforced by foundryQuietPresentation.validation.ts):
 *  - every input event appears in exactly one activity item (nothing is dropped or reordered);
 *  - no function here mutates its input;
 *  - completion is presented from historical truth (foundryCompletionHistory), never from live state.
 *
 * Pure: no filesystem, git, network, or React.
 */
import { parseUnittestCounts } from './foundryCompletionHistory'
import type { FoundryCompletionTruth } from './foundryCompletionTruth'
import type { BlockedProgressEvidence } from './foundryProgressEvaluation'
import { buildLiveProgress, type LiveProgress } from './foundryLiveProgress'
import { planSummary, type EngineeringPlan, type PlanSummary } from './foundryEngineeringPlan'

export type QuietEvent = {
  eventId?: string
  type: string
  status?: string
  summary?: string
  detail?: string
  phase?: string
  timestamp?: string
  command?: string
  exitCode?: number
  filePath?: string
  durationMs?: number
  outputTail?: string
  diff?: string
  failureSignature?: string
  repairHypothesis?: string
  strategy?: string
  previousStrategy?: string
  rawOutputRef?: string
  attempt?: number
  tool?: string
  governance?: { commandClass?: string; allowed?: boolean; reason?: string; policyClass?: string }
}

export type QuietBlockedDetail = {
  summary: string
  failure?: string
  attempts?: { strategy: string; outcome: string }[]
  currentState?: string
  rolledBack?: boolean
  boundary?: string
  unblockAction?: string
  /** Typed progress/stagnation evidence persisted by the progress evaluator (smart stagnation). */
  progress?: BlockedProgressEvidence
}

/** Structural subset of the persisted campaign that the presentation may read for technical detail. */
export type QuietCampaign = {
  repairFinding?: string | null
  reworkCycles?: number
  workerReceipts?: { role: string; provider: string; model: string; taskId?: string; attempt?: number; resultStatus?: string; failureClass?: string | null }[]
  testReceipts?: { testedMutationGeneration: number; command: string; exitCode: number | null; result: string }[]
  mutationGeneration?: number
  missionId?: string
  progress?: { classification?: string | null; credits?: number; notes?: { icon: string; text: string }[] } | null
  plan?: EngineeringPlan | null
} | null

export type FoundryActivityKind =
  | 'understand' | 'implement' | 'test' | 'debug' | 'review' | 'verify'
  | 'complete' | 'blocked' | 'approval' | 'resume' | 'rollback' | 'command' | 'foundry' | 'decision'
export type FoundryActivityStatus = 'done' | 'running' | 'failed' | 'info'

export type FoundryActivityTechnical = {
  commands: { command: string; exitCode: number | null; durationMs: number | null; status: string }[]
  files: string[]
  outputTail: string | null
  failureCause: string | null
  hypothesis: string | null
  repairTarget: string | null
  governance: { commandClass?: string; allowed?: boolean; reason?: string; policyClass?: string }[]
  workers: { provider: string; model: string; role: string; attempt: number | null; result: string | null }[]
  mutationGeneration: number | null
  rawStates: string[]
  /** Typed progress evaluations persisted with the events in this group (smart stagnation). */
  progress: FoundryProgressEvaluationView[]
}

export type FoundryProgressEvaluationView = {
  kind: string | null
  baseline: boolean
  classification: string
  signals: string[]
  strategy: string | null
  fingerprint: string | null
  exception: string | null
  failingCount: number | null
  sameFailureStreak: number
  sameStrategyStreak: number
  noStrongProgressStreak: number
  credits: number
  cycles: number
  cycleLimit: number
  absoluteCycles: number
  stop: string | null
}

export type FoundryActivityItem = {
  id: string
  kind: FoundryActivityKind
  /** Internal worker label shown only in Activity detail, never as a conversation card. */
  role: string
  title: string
  status: FoundryActivityStatus
  at: string | null
  endedAt: string | null
  files: string[]
  /** Every underlying authoritative event, in original order. */
  events: QuietEvent[]
  technical: FoundryActivityTechnical
}

export type FoundryProgressStepId = 'understand' | 'implement' | 'test' | 'review' | 'verify'
export type FoundryProgressStep = {
  id: FoundryProgressStepId
  label: string
  state: 'done' | 'active' | 'pending' | 'failed'
}

export type FoundryFailureView = {
  /** One compact line for the conversation, e.g. "NameError in test_tickets". */
  title: string
  cause: string | null
  status: 'debugging' | 'repairing' | 'stuck'
  command: string | null
  exitCode: number | null
  outputTail: string | null
  hypothesis: string | null
  repairTarget: string | null
}

export type FoundryProgressNote = { icon: '✓' | '↻'; text: string }

export type FoundryProgressState = {
  working: boolean
  headline: string
  steps: FoundryProgressStep[]
  repairCycle: number
  failure: FoundryFailureView | null
  /** What Foundry says in plain first-person language: what it checked/changed, what happened, and what it does next. No counters, ids or enums. */
  narrative: string[]
  /** Productive-rework narrative ("✓ Fixed missing import / ↻ Found a deeper test failure / ↻ Repairing it"). Empty unless progress was evaluated. */
  notes: FoundryProgressNote[]
}

export type FoundryInterventionAction = {
  id: 'retry' | 'review' | 'stop' | 'models' | 'approve' | 'cancel' | 'details'
  label: string
}

export type FoundryIntervention = {
  kind: 'paused' | 'provider' | 'approval'
  title: string
  body: string
  actions: FoundryInterventionAction[]
  technical: {
    rawState: string
    summary?: string
    failure?: string
    boundary?: string
    unblock?: string
    currentState?: string
    attempts?: string[]
    rolledBack?: boolean
    /** Smart-stagnation evidence: failure fingerprint, strategy changes, progress signals, cycle count and absolute budget. */
    progress?: string[]
  }
}

export type FoundryCompletionPresentation = {
  headline: 'Completed'
  facts: string[]
  diff: string | null
  rolledBack: boolean
  rolledBackLine: string | null
}

export type QuietThread = {
  /** Plain-language plan (what Foundry intends and how it last changed course). Null for records that predate plans. */
  plan: PlanSummary | null
  /** Live stage-by-stage mission status, derived from the persisted events. */
  live: LiveProgress
  activity: FoundryActivityItem[]
  progress: FoundryProgressState
  intervention: FoundryIntervention | null
  completion: FoundryCompletionPresentation | null
}

// ---------------------------------------------------------------------------------------------
// Internal state translation
// ---------------------------------------------------------------------------------------------

const STATE_TEXT: Record<string, string> = {
  ARCHITECT_RUNNING: 'Understanding the project…',
  BACKEND_RUNNING: 'Updating backend…',
  FRONTEND_RUNNING: 'Updating frontend…',
  DATABASE_RUNNING: 'Recording the data contract…',
  TEST_RUNNING: 'Running tests…',
  DEBUGGER_RUNNING: 'Debugging a failing test…',
  REVIEW_RUNNING: 'Reviewing changes…',
  VERIFY_RUNNING: 'Verifying from disk…',
  BLOCKED_STAGNATION: 'Foundry paused after repeated unsuccessful repair attempts.',
  BLOCKED_REPAIR_LIMIT: 'Foundry paused because this mission reached its repair-attempt limit.',
  BLOCKED_CAPABILITY: 'Foundry paused because the model could not produce usable edits.',
  BLOCKED_POLICY: 'Foundry paused because the result cannot be verified.',
  PROVIDER_UNAVAILABLE: 'The selected model is unavailable.',
  BLOCKED_RESOURCE: 'Foundry paused because this mission used its work budget.',
  INVALID_OUTPUT: 'Foundry paused because a worker returned an unusable result.',
  CAPABILITY_FAILURE: 'Foundry paused because no eligible model could take this task.',
  'CAMPAIGN DID NOT VERIFY.': 'Foundry could not verify the result.',
}

/** Keeps the raw enum/state alongside the Commander-facing sentence. */
export function translateInternalState(raw: string | null | undefined): { text: string; raw: string } {
  const value = (raw ?? '').trim()
  if (!value) return { text: 'Foundry paused.', raw: '' }
  const exact = STATE_TEXT[value.toUpperCase()]
  if (exact) return { text: exact, raw: value }
  for (const [key, text] of Object.entries(STATE_TEXT)) {
    if (/^[A-Z_]+$/.test(key) && value.toUpperCase().includes(key)) return { text, raw: value }
  }
  return { text: `Foundry paused: ${value.replace(/\s+/g, ' ').slice(0, 140)}`, raw: value }
}

// ---------------------------------------------------------------------------------------------
// Event grouping
// ---------------------------------------------------------------------------------------------

const ROLE_PREFIX = /^(ARCHITECT|BACKEND|FRONTEND|DATABASE|TEST|DEBUGGER|REVIEWER|VERIFIER)\b/

const ROLE_LABEL: Record<string, string> = {
  ARCHITECT: 'Architect', BACKEND: 'Backend', FRONTEND: 'Frontend', DATABASE: 'Database',
  TEST: 'Test', DEBUGGER: 'Debugger', REVIEWER: 'Reviewer', VERIFIER: 'Verifier',
}

const ROLE_KIND: Record<string, FoundryActivityKind> = {
  ARCHITECT: 'understand', BACKEND: 'implement', FRONTEND: 'implement', DATABASE: 'implement',
  TEST: 'test', DEBUGGER: 'debug', REVIEWER: 'review', VERIFIER: 'verify',
}

const UNDERSTAND_TYPES = new Set([
  'CAMPAIGN_STARTED', 'ARCHITECTING', 'PLAN_READY', 'MISSION_STARTED', 'WORKSPACE_SCAN_STARTED',
  'WORKSPACE_SCAN_PROGRESS', 'WORKSPACE_SCAN_COMPLETE', 'REPOSITORY_MAP_CREATED', 'SEARCH_STARTED',
  'SEARCH_RESULT', 'DEPENDENCY_CHECK',
])
const READ_TYPES = new Set(['FILE_READING', 'FILE_READ'])
const EDIT_TYPES = new Set([
  'FILE_EDIT_PLANNED', 'FILE_EDITING', 'FILE_EDITED', 'FILE_CREATED', 'FILE_DELETED',
  'PATCH_CREATED', 'PATCH_APPLIED', 'REPAIR_STARTED', 'REPAIR_APPLIED',
])
const TEST_TYPES = new Set([
  'TEST_STARTED', 'TEST_RESULT', 'BUILD_STARTED', 'BUILD_RESULT', 'TYPECHECK_STARTED',
  'TYPECHECK_RESULT', 'LINT_STARTED', 'LINT_RESULT', 'FORMAT_STARTED', 'FORMAT_RESULT',
  'INTEGRATING', 'REPAIR_VALIDATION_STARTED', 'REPAIR_VALIDATION_RESULT',
])
const DEBUG_TYPES = new Set([
  'ROOT_CAUSE_ANALYSIS_STARTED', 'ROOT_CAUSE_FOUND', 'REPAIR_HYPOTHESIS', 'STRATEGY_CHANGED', 'PROGRESS_EVALUATED', 'PLAN_REVISED',
])
const INHERIT_TYPES = new Set([
  'COMMAND_QUEUED', 'COMMAND_STARTED', 'COMMAND_OUTPUT', 'COMMAND_COMPLETED', 'REWORKING',
  'VERIFICATION_FAILED', 'FAILURE_DETECTED', 'FAILURE_SIGNATURE_CREATED', 'CHECKPOINT_CREATED',
  'PROCESS_STARTED', 'PROCESS_PROGRESS', 'PROCESS_STOPPED',
])

type GroupKey = { kind: FoundryActivityKind; role: string; key: string }

function roleOf(event: QuietEvent): string | null {
  const match = ROLE_PREFIX.exec((event.summary ?? '').trim())
  return match ? match[1] : null
}

function classify(event: QuietEvent, prev: GroupKey | null): GroupKey {
  const role = roleOf(event)
  if (role && (event.type === 'TASK_STARTED' || event.type === 'TASK_COMPLETE' || event.type === 'TASK_BLOCKED')) {
    const kind = ROLE_KIND[role]
    return { kind, role: ROLE_LABEL[role], key: kind === 'implement' ? `implement:${role}` : kind }
  }
  const type = event.type
  const inherit = (): GroupKey => prev ?? { kind: 'foundry', role: 'Foundry', key: 'foundry' }
  if (type === 'MISSION_COMPLETE') return { kind: 'complete', role: 'Foundry', key: 'complete' }
  if (type === 'BLOCKED' || type === 'TASK_BLOCKED') return { kind: 'blocked', role: 'Foundry', key: 'blocked' }
  if (type === 'WAITING_FOR_APPROVAL') return { kind: 'approval', role: 'Foundry', key: 'approval' }
  if (type === 'MISSION_RESUMED') return { kind: 'resume', role: 'Foundry', key: 'resume' }
  if (type === 'COMMANDER_DECISION') return { kind: 'decision', role: 'You', key: 'decision' }
  if (type === 'ROLLBACK_STARTED' || type === 'ROLLBACK_COMPLETE') return { kind: 'rollback', role: 'Foundry', key: 'rollback' }
  if (type === 'REVIEWING') return { kind: 'review', role: 'Reviewer', key: 'review' }
  if (type === 'VERIFICATION_STARTED' || type === 'PROJECT_READY') return { kind: 'verify', role: 'Verifier', key: 'verify' }
  if (DEBUG_TYPES.has(type)) return { kind: 'debug', role: 'Debugger', key: 'debug' }
  if (TEST_TYPES.has(type)) return { kind: 'test', role: 'Test', key: 'test' }
  if (UNDERSTAND_TYPES.has(type)) {
    return prev && prev.kind !== 'understand' && type !== 'MISSION_STARTED' && type !== 'CAMPAIGN_STARTED' && type !== 'ARCHITECTING' && type !== 'PLAN_READY'
      ? inherit()
      : { kind: 'understand', role: 'Architect', key: 'understand' }
  }
  if (READ_TYPES.has(type)) {
    return prev && ['implement', 'test', 'debug', 'review', 'verify'].includes(prev.kind) ? inherit() : { kind: 'understand', role: 'Architect', key: 'understand' }
  }
  if (EDIT_TYPES.has(type)) {
    return prev && prev.kind === 'implement' ? inherit() : { kind: 'implement', role: 'Foundry', key: 'implement:edit' }
  }
  if (INHERIT_TYPES.has(type)) {
    return prev ?? { kind: 'command', role: 'Foundry', key: 'command' }
  }
  return inherit()
}

export { humanFailure, shortFailureCause } from './foundryFailureText'
import { humanFailure, shortFailureCause } from './foundryFailureText'

function testModuleFrom(text: string | null | undefined): string | null {
  const m = /(?:ERROR|FAIL): \w+ \(([\w]+)(?:\.\w+)+\)/.exec(text ?? '')
  return m ? m[1] : null
}

function errorClassFrom(cause: string | null): string | null {
  const m = /^([A-Za-z_]*(?:Error|Exception))/.exec(cause ?? '')
  return m ? m[1] : null
}

function tailOf(events: QuietEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) if (events[i].outputTail) return events[i].outputTail ?? null
  return null
}

function groupStatus(events: QuietEvent[], isLast: boolean, terminal: boolean): FoundryActivityStatus {
  const meaningful = events.filter(e => e.type !== 'TASK_STARTED')
  const failedEvent = events.some(e => (e.type === 'COMMAND_COMPLETED' && (e.status === 'fail' || (typeof e.exitCode === 'number' && e.exitCode !== 0)))
    || e.type === 'REWORKING' || e.type === 'VERIFICATION_FAILED' || e.type === 'BLOCKED' || e.type === 'TASK_BLOCKED'
    || (e.type === 'REVIEWING' && e.status === 'fail'))
  if (failedEvent) return 'failed'
  const last = events[events.length - 1]
  const completed = events.some(e => e.type === 'TASK_COMPLETE' || e.type === 'PROJECT_READY' || e.type === 'MISSION_COMPLETE'
    || e.type === 'FILE_EDITED' || e.type === 'REVIEWING' || (e.type === 'COMMAND_COMPLETED'))
  if (last?.status === 'running' && !completed && isLast && !terminal) return 'running'
  if (isLast && !terminal && last && last.type === 'TASK_STARTED') return 'running'
  if (meaningful.length === 0 && isLast && !terminal) return 'running'
  return completed || !isLast || terminal ? 'done' : 'running'
}

function commandsOf(events: QuietEvent[]): FoundryActivityTechnical['commands'] {
  return events
    .filter(e => e.type === 'COMMAND_COMPLETED' && e.command)
    .map(e => ({ command: e.command as string, exitCode: typeof e.exitCode === 'number' ? e.exitCode : null, durationMs: typeof e.durationMs === 'number' ? e.durationMs : null, status: e.status ?? 'info' }))
}

function findRepairField(finding: string | null | undefined, field: 'HYPOTHESIS' | 'REPAIR_TARGET'): string | null {
  const m = new RegExp(`${field}:?\\s*([^\\n]*?)(?=\\s+(?:HYPOTHESIS|EVIDENCE|REPAIR_TARGET):|\\s+The implementer|$)`).exec(finding ?? '')
  return m ? m[1].trim().replace(/\.$/, '') || null : null
}

type ProgressPayload = {
  v?: number
  kind?: string | null
  baseline?: boolean
  class?: string
  signals?: string[]
  strategy?: string | null
  fingerprint?: string | null
  exception?: string | null
  failingCount?: number | null
  sameFailureStreak?: number
  sameStrategyStreak?: number
  noStrongProgressStreak?: number
  credits?: number
  cycles?: number
  cycleLimit?: number
  absoluteCycles?: number
  stop?: { reason: string; message: string } | null
  notes?: FoundryProgressNote[]
}

function progressPayload(event: QuietEvent): ProgressPayload | null {
  if (event.type !== 'PROGRESS_EVALUATED' || !event.detail) return null
  try {
    const parsed = JSON.parse(event.detail) as ProgressPayload
    return parsed && parsed.v === 1 ? parsed : null
  } catch {
    return null
  }
}

function progressViewsOf(events: QuietEvent[]): FoundryProgressEvaluationView[] {
  const views: FoundryProgressEvaluationView[] = []
  for (const event of events) {
    const p = progressPayload(event)
    if (!p) continue
    views.push({
      kind: p.kind ?? null,
      baseline: p.baseline === true,
      classification: p.class ?? 'UNKNOWN',
      signals: p.signals ?? [],
      strategy: p.strategy ?? null,
      fingerprint: p.fingerprint ?? null,
      exception: p.exception ?? null,
      failingCount: typeof p.failingCount === 'number' ? p.failingCount : null,
      sameFailureStreak: p.sameFailureStreak ?? 0,
      sameStrategyStreak: p.sameStrategyStreak ?? 0,
      noStrongProgressStreak: p.noStrongProgressStreak ?? 0,
      credits: p.credits ?? 0,
      cycles: p.cycles ?? 0,
      cycleLimit: p.cycleLimit ?? 0,
      absoluteCycles: p.absoluteCycles ?? 0,
      stop: p.stop?.reason ?? null,
    })
  }
  return views
}

/** Productive-rework narrative derived from the persisted PROGRESS_EVALUATED events, oldest first, newest last. */
function progressNotesOf(items: readonly FoundryActivityItem[]): FoundryProgressNote[] {
  const notes: FoundryProgressNote[] = []
  let latest: ProgressPayload | null = null
  for (const item of items) {
    for (const event of item.events) {
      const payload = progressPayload(event)
      if (!payload) continue
      latest = payload
      for (const note of payload.notes ?? []) {
        if (note.text === 'Repairing it') continue
        if (notes[notes.length - 1]?.text !== note.text) notes.push(note)
      }
    }
  }
  if (!notes.length || !latest) return []
  const shown = notes.slice(-4)
  if (!latest.stop) shown.push({ icon: '↻', text: 'Repairing it' })
  return shown
}

function titleFor(kind: FoundryActivityKind, role: string, events: QuietEvent[], status: FoundryActivityStatus, files: string[]): string {
  const last = events[events.length - 1]
  switch (kind) {
    case 'understand':
      return status === 'running' ? 'Analyzing the project…' : 'Analyzed the project'
    case 'implement': {
      const who = role === 'Foundry' ? 'files' : role.toLowerCase()
      if (files.length) return status === 'running' ? `Updating ${files.join(', ')}…` : `Updated ${files.join(', ')}`
      return status === 'running' ? `Updating ${who}…` : `Checked ${who} — no change needed`
    }
    case 'test': {
      const done = [...events].reverse().find(e => e.type === 'COMMAND_COMPLETED')
      if (status === 'running' || !done) return 'Running tests…'
      const passed = done.status === 'pass' || done.exitCode === 0
      if (passed) {
        const counts = parseUnittestCounts(done.outputTail)
        return counts ? `${counts.passed}/${counts.total} tests passed` : 'Tests passed'
      }
      const cause = shortFailureCause([events.find(e => e.type === 'REWORKING')?.summary, done.outputTail].filter(Boolean).join('\n'))
      return cause ? `Tests failed — ${cause}` : 'Tests failed'
    }
    case 'debug':
      return status === 'running' ? 'Debugging a failing test…' : 'Diagnosed the failure'
    case 'review':
      return status === 'running' ? 'Reviewing changes…' : (events.some(e => e.type === 'REVIEWING' && e.status === 'fail') ? 'Review found issues' : 'Review accepted')
    case 'verify':
      if (status === 'failed') return 'Verification failed'
      return status === 'running' ? 'Verifying from disk…' : 'Verified from disk'
    case 'complete':
      return 'Completed'
    case 'blocked':
      return `Paused — ${translateInternalState(last?.summary).text.replace(/\.$/, '')}`
    case 'approval':
      return 'Waiting for your approval'
    case 'resume':
      return 'Resumed after a restart'
    case 'decision':
      return 'You chose to keep trying'
    case 'rollback':
      return 'Rolled back'
    default:
      return (last?.summary ?? 'Working').replace(/\s+/g, ' ').slice(0, 120)
  }
}

export function groupEngineeringEvents(
  events: readonly QuietEvent[],
  options: { terminal?: boolean; campaign?: QuietCampaign } = {},
): FoundryActivityItem[] {
  const groups: { key: GroupKey; events: QuietEvent[] }[] = []
  let prev: GroupKey | null = null
  for (const event of events) {
    const next = classify(event, prev)
    const current = groups[groups.length - 1]
    if (current && current.key.key === next.key) {
      current.events.push(event)
    } else {
      groups.push({ key: next, events: [event] })
    }
    prev = next
  }
  const terminal = options.terminal === true
  const receipts = options.campaign?.workerReceipts ?? []
  const testReceipts = options.campaign?.testReceipts ?? []
  let testIndex = 0
  return groups.map((group, index) => {
    const isLast = index === groups.length - 1
    const status = groupStatus(group.events, isLast, terminal)
    const files = [...new Set(group.events.filter(e => e.type === 'FILE_EDITED' || e.type === 'FILE_CREATED' || e.type === 'FILE_DELETED').map(e => e.filePath).filter((p): p is string => Boolean(p)))]
    const failed = status === 'failed'
    const causeText = [group.events.find(e => e.type === 'REWORKING')?.summary, tailOf(group.events)].filter(Boolean).join('\n')
    const roleKey = Object.keys(ROLE_LABEL).find(key => ROLE_LABEL[key] === group.key.role)
    const workers = receipts
      .filter(r => roleKey && r.role === roleKey)
      .map(r => ({ provider: r.provider, model: r.model, role: r.role, attempt: r.attempt ?? null, result: r.resultStatus ?? null }))
    let generation: number | null = null
    if (group.key.kind === 'test') {
      generation = testReceipts[testIndex]?.testedMutationGeneration ?? null
      testIndex += 1
    }
    const finding = options.campaign?.repairFinding ?? null
    return {
      id: group.events[0].eventId ?? `group-${index}`,
      kind: group.key.kind,
      role: group.key.role,
      title: titleFor(group.key.kind, group.key.role, group.events, status, files),
      status: failed && group.key.kind === 'debug' ? 'done' : status,
      at: group.events[0].timestamp ?? null,
      endedAt: group.events[group.events.length - 1].timestamp ?? null,
      files,
      events: group.events,
      technical: {
        commands: commandsOf(group.events),
        files,
        outputTail: tailOf(group.events),
        failureCause: failed ? shortFailureCause(causeText) : null,
        hypothesis: group.key.kind === 'debug' ? findRepairField(finding, 'HYPOTHESIS') : null,
        repairTarget: group.key.kind === 'debug' ? findRepairField(finding, 'REPAIR_TARGET') : null,
        governance: group.events.map(e => e.governance).filter((g): g is NonNullable<QuietEvent['governance']> => Boolean(g)),
        workers,
        mutationGeneration: generation,
        rawStates: [...new Set(group.events.map(e => `${e.type}:${e.status ?? ''}`))],
        progress: progressViewsOf(group.events),
      },
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['completed', 'resolved', 'rolled_back', 'blocked', 'cancelled', 'failed'])

function isTerminal(items: FoundryActivityItem[], missionStatus?: string | null, blocked?: QuietBlockedDetail | null): boolean {
  if (blocked) return true
  if (missionStatus && TERMINAL_STATUSES.has(missionStatus)) return true
  return items.some(item => item.kind === 'complete' || item.kind === 'blocked')
}

function stepState(items: FoundryActivityItem[], kind: FoundryActivityKind): 'done' | 'active' | 'pending' | 'failed' {
  const mine = items.filter(item => item.kind === kind)
  if (!mine.length) return 'pending'
  if (mine.some(item => item.status === 'running')) return 'active'
  const last = mine[mine.length - 1]
  return last.status === 'failed' ? 'failed' : 'done'
}

function headlineFor(items: FoundryActivityItem[]): string {
  const running = [...items].reverse().find(item => item.status === 'running')
  if (!running) return 'Foundry is working…'
  const key = running.kind === 'implement'
    ? (running.role === 'Frontend' ? 'FRONTEND_RUNNING' : running.role === 'Database' ? 'DATABASE_RUNNING' : 'BACKEND_RUNNING')
    : running.kind === 'understand' ? 'ARCHITECT_RUNNING'
      : running.kind === 'test' ? 'TEST_RUNNING'
        : running.kind === 'debug' ? 'DEBUGGER_RUNNING'
          : running.kind === 'review' ? 'REVIEW_RUNNING'
            : running.kind === 'verify' ? 'VERIFY_RUNNING' : ''
  return key ? STATE_TEXT[key] : 'Foundry is working…'
}

function narrativeFor(input: {
  notes: FoundryProgressNote[]
  failure: FoundryFailureView | null
  editedFiles: string[]
  debugging: boolean
  understand: string
  review: string
  verify: string
  lastTestDone: boolean
}): string[] {
  const lines: string[] = []
  const fixed = input.notes.find(note => /^Fixed /.test(note.text))
  const deeper = input.notes.find(note => /^Found a (deeper|different) test failure/.test(note.text))
  const fewer = input.notes.find(note => /fewer failing/.test(note.text))
  const closer = input.notes.find(note => /closer to what the test expects/.test(note.text))
  const why = input.failure ? humanFailure(input.failure.cause) : null
  if (fixed && deeper) {
    lines.push(`I fixed the ${fixed.text.replace(/^Fixed /, '')}, but the tests exposed ${/deeper/.test(deeper.text) ? 'a deeper problem' : 'a different problem'}${why ? `: ${why}` : ''}.`)
  } else if (fixed) {
    lines.push(`I fixed the ${fixed.text.replace(/^Fixed /, '')}.`)
  } else if (fewer) {
    lines.push(`That fixed some of the failing tests${why ? `, but ${why}` : ''}.`)
  } else if (closer) {
    lines.push(`The result is closer to what the tests expect${why ? `, but ${why}` : ''}.`)
  } else if (why) {
    lines.push(`The tests are failing: ${why}.`)
  }
  if (input.failure) lines.push(input.debugging ? "I'm tracing that now." : "I'm repairing it now.")
  else if (input.lastTestDone && input.review === 'active') lines.push("The tests pass. I'm reviewing the change.")
  else if (input.verify === 'active') lines.push("I'm verifying the result from disk.")
  return lines
}

export function buildProgressState(
  items: readonly FoundryActivityItem[],
  options: { missionStatus?: string | null; blocked?: QuietBlockedDetail | null; campaign?: QuietCampaign } = {},
): FoundryProgressState {
  const list = [...items]
  const terminal = isTerminal(list, options.missionStatus, options.blocked)
  const debugCount = list.filter(item => item.kind === 'debug').length
  const testItems = list.filter(item => item.kind === 'test')
  const lastTest = testItems[testItems.length - 1]
  const lastKind = list.length ? list[list.length - 1].kind : null
  const repairing = Boolean(lastTest && lastTest.status === 'failed' && !terminal)
    || (debugCount > 0 && lastKind !== null && ['debug', 'implement'].includes(lastKind) && !terminal)
  const impl = stepState(list, 'implement')
  const understand = stepState(list, 'understand')
  const review = stepState(list, 'review')
  const verify = stepState(list, 'verify')
  let test = stepState(list, 'test')
  if (repairing && test !== 'active') test = 'active'
  const testDone = lastTest && lastTest.status === 'done' ? lastTest.title.match(/^(\d+\/\d+) tests passed$/)?.[1] : undefined
  const editedFiles = [...new Set(list.flatMap(item => item.files))]
  const steps: FoundryProgressStep[] = [
    {
      id: 'understand',
      label: understand === 'active' ? 'Understanding the project…' : understand === 'done' ? 'Project understood' : understand === 'failed' ? 'Could not understand the project' : 'Understand the project',
      state: understand,
    },
    {
      id: 'implement',
      label: impl === 'active' ? 'Updating the project…'
        : impl === 'done' ? (editedFiles.length ? `Updated ${editedFiles.join(', ')}` : 'Project checked')
          : impl === 'failed' ? 'Update failed' : 'Update the project',
      state: impl,
    },
    {
      id: 'test',
      label: repairing
        ? 'Fixing a failing test'
        : test === 'active' ? 'Running tests…'
          : test === 'failed' ? 'Tests failing'
            : test === 'done' ? (testDone ? `${testDone.replace('/', ' / ')} tests passing` : 'Tests passing') : 'Run tests',
      state: test,
    },
    {
      id: 'review',
      label: review === 'active' ? 'Reviewing changes…' : review === 'failed' ? 'Review found issues' : review === 'done' ? 'Review complete' : 'Review changes',
      state: review,
    },
    {
      id: 'verify',
      label: verify === 'active' ? 'Verifying from disk…' : verify === 'failed' ? 'Verification failed' : verify === 'done' ? 'Verified' : 'Verify from disk',
      state: verify,
    },
  ]
  const failedTest = lastTest && lastTest.status === 'failed' ? lastTest : null
  const debugging = list.length > 0 && list[list.length - 1].kind === 'debug' && list[list.length - 1].status === 'running'
  const finding = options.campaign?.repairFinding ?? null
  let failure: FoundryFailureView | null = null
  if (failedTest && !terminal) {
    const cause = failedTest.technical.failureCause
    const errorClass = errorClassFrom(cause)
    const testModule = testModuleFrom(failedTest.technical.outputTail)
    failure = {
      title: errorClass && testModule ? `${errorClass} in ${testModule}` : (cause ?? 'A test failed'),
      cause,
      status: debugging ? 'debugging' : 'repairing',
      command: failedTest.technical.commands[failedTest.technical.commands.length - 1]?.command ?? null,
      exitCode: failedTest.technical.commands[failedTest.technical.commands.length - 1]?.exitCode ?? null,
      outputTail: failedTest.technical.outputTail,
      hypothesis: findRepairField(finding, 'HYPOTHESIS'),
      repairTarget: findRepairField(finding, 'REPAIR_TARGET'),
    }
  }
  const notes = terminal ? [] : progressNotesOf(list)
  const narrative = terminal ? [] : narrativeFor({ notes, failure, editedFiles, debugging, understand, review, verify, lastTestDone: Boolean(testDone) })
  return {
    working: !terminal,
    headline: terminal
      ? (list.some(item => item.kind === 'complete') || options.missionStatus === 'completed' || options.missionStatus === 'resolved' || options.missionStatus === 'rolled_back' ? 'Completed' : 'Paused')
      : notes.length ? 'Foundry is still working…' : failure ? 'Repairing a failing test…' : headlineFor(list),
    steps,
    repairCycle: debugCount,
    failure,
    narrative,
    notes,
  }
}

// ---------------------------------------------------------------------------------------------
// Intervention
// ---------------------------------------------------------------------------------------------

const PAUSE_BODY: Record<string, string> = {
  BLOCKED_RESOURCE: 'This mission used up its work budget.',
  INVALID_OUTPUT: 'A worker returned a result Foundry could not use.',
  CAPABILITY_FAILURE: 'No eligible model could take this task.',
  BLOCKED_REPAIR_LIMIT: "I was making progress, but this mission reached its limit on repair attempts.",
  BLOCKED_CAPABILITY: 'The model kept returning results I could not use as edits, so I cannot make reliable changes.',
  BLOCKED_POLICY: 'The test command found no tests, so I cannot verify the result.',
}

function progressLines(evidence: BlockedProgressEvidence | undefined): string[] | undefined {
  if (!evidence) return undefined
  const lines = [
    `classification ${evidence.classification} · reason ${evidence.reason}`,
    evidence.message,
    `cycles used ${evidence.cyclesUsed} · window ${evidence.cycleLimit} · absolute limit ${evidence.absoluteCycles} · progress credits ${evidence.credits}`,
    `streaks: same failure ${evidence.sameFailureStreak} · same strategy ${evidence.sameStrategyStreak} · no progress ${evidence.noStrongProgressStreak} · score ${evidence.stagnationScore}`,
    `semantic failure transitions ${evidence.semanticFailureTransitions}`,
  ]
  if (evidence.fingerprint) {
    lines.splice(1, 0, `failure fingerprint ${evidence.fingerprint.id}${evidence.fingerprint.primary ? ` — ${evidence.fingerprint.primary.slice(0, 140)}` : ''}${evidence.fingerprint.failingCount !== null ? ` · ${evidence.fingerprint.failingCount} failing` : ''}`)
  }
  if (evidence.recentStrategies.length) lines.push(`strategy changes: ${evidence.recentStrategies.join(' → ')}`)
  if (evidence.recentSignals.length) lines.push(`progress signals: ${evidence.recentSignals.join(', ')}`)
  return lines
}

const STAGNATION_FAMILY = new Set(['BLOCKED_STAGNATION', 'BLOCKED_REPAIR_LIMIT', 'BLOCKED_CAPABILITY'])

/** The card title already says "Foundry paused", so the body carries the reason without repeating it. */
function pauseBody(raw: string, translated: string, problem: string | null, evidence?: BlockedProgressEvidence | null): string {
  const key = raw.trim().toUpperCase()
  if (key === 'BLOCKED_STAGNATION') {
    const lead = evidence?.reason === 'OSCILLATION'
      ? "The failure keeps flipping between the same states, so I'm not making reliable progress."
      : "I've tried multiple approaches, but the same failure is still present and I'm not gaining new evidence."
    return problem ? `${lead} What keeps failing: ${humanFailure(problem)}.` : lead
  }
  const known = PAUSE_BODY[key]
  if (known) return problem ? `${known} What failed: ${humanFailure(problem)}.` : known
  return problem ? `${translated} What failed: ${humanFailure(problem)}.` : translated
}

export function buildIntervention(input: {
  blocked?: QuietBlockedDetail | null
  missionStatus?: string | null
  provider?: { blocking: boolean; detail?: string | null } | null
  authorization?: { waiting: boolean; action?: string | null; reason?: string | null } | null
  lastBlockedEvent?: QuietEvent | null
}): FoundryIntervention | null {
  if (input.authorization?.waiting) {
    return {
      kind: 'approval',
      title: 'Foundry needs your approval',
      body: input.authorization.reason?.trim() || 'This action needs your authorization before Foundry continues.',
      actions: [
        { id: 'approve', label: 'Approve' },
        { id: 'cancel', label: 'Cancel' },
        { id: 'details', label: 'View details' },
      ],
      technical: { rawState: input.authorization.action ?? 'WAITING_FOR_APPROVAL', summary: input.authorization.reason ?? undefined },
    }
  }
  const blocked = input.blocked ?? null
  if (blocked || input.missionStatus === 'blocked' || input.lastBlockedEvent) {
    const raw = blocked?.summary ?? input.lastBlockedEvent?.summary ?? 'BLOCKED'
    const translated = translateInternalState(raw)
    const problem = shortFailureCause(blocked?.failure ?? '')
    return {
      kind: 'paused',
      title: 'Foundry paused',
      body: pauseBody(translated.raw, translated.text, problem, blocked?.progress),
      actions: STAGNATION_FAMILY.has(translated.raw.trim().toUpperCase())
        ? [
          { id: 'retry', label: 'Keep trying' },
          { id: 'review', label: 'Review problem' },
          { id: 'stop', label: 'Stop' },
        ]
        : [
          { id: 'retry', label: 'Try again' },
          { id: 'review', label: 'Review problem' },
        ],
      technical: {
        rawState: translated.raw,
        summary: blocked?.summary,
        failure: blocked?.failure,
        boundary: blocked?.boundary,
        unblock: blocked?.unblockAction,
        currentState: blocked?.currentState,
        attempts: (blocked?.attempts ?? []).map(item => `${item.strategy}: ${item.outcome}`),
        rolledBack: blocked?.rolledBack,
        progress: progressLines(blocked?.progress),
      },
    }
  }
  if (input.provider?.blocking) {
    return {
      kind: 'provider',
      title: 'The selected model is unavailable',
      body: 'Foundry cannot start new work until a model is available.',
      actions: [{ id: 'models', label: 'Check models' }],
      technical: { rawState: 'PROVIDER_UNAVAILABLE', summary: input.provider.detail ?? undefined },
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------------------------

/** Presents historical completion truth (04d9). A later rollback is shown separately. */
export function buildCompletionPresentation(truth: FoundryCompletionTruth | null | undefined): FoundryCompletionPresentation | null {
  if (!truth || truth.canComplete !== true) return null
  const files = truth.created.length + truth.modified.length
  const facts: string[] = []
  facts.push(`${files} ${files === 1 ? 'file' : 'files'} changed`)
  if (truth.tests.ran && truth.tests.ok) {
    facts.push(truth.tests.total > 0 ? `${truth.tests.pass} / ${truth.tests.total} tests passed` : 'Tests passed')
  }
  if (truth.history?.review === 'accepted') facts.push('Review accepted')
  if (truth.history?.verifier === 'accepted') facts.push('Verifier accepted')
  const rolledBack = truth.history?.rolledBack === true
  return {
    headline: 'Completed',
    facts,
    diff: truth.history?.diffKnown === false ? null : `+${truth.plus} −${truth.minus}`,
    rolledBack,
    rolledBackLine: rolledBack ? 'Changes from this mission were later reverted.' : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------

export function buildQuietThread(input: {
  events: readonly QuietEvent[]
  missionStatus?: string | null
  blocked?: QuietBlockedDetail | null
  campaign?: QuietCampaign
  completionTruth?: FoundryCompletionTruth | null
  provider?: { blocking: boolean; detail?: string | null } | null
  authorization?: { waiting: boolean; action?: string | null; reason?: string | null } | null
}): QuietThread {
  const preliminary = groupEngineeringEvents(input.events, { terminal: false, campaign: input.campaign })
  const terminal = isTerminal(preliminary, input.missionStatus, input.blocked)
  const activity = terminal ? groupEngineeringEvents(input.events, { terminal: true, campaign: input.campaign }) : preliminary
  const lastBlockedEvent = [...input.events].reverse().find(e => e.type === 'BLOCKED') ?? null
  return {
    plan: planSummary(input.campaign?.plan),
    live: buildLiveProgress({ events: input.events, missionStatus: input.missionStatus, blocked: input.blocked }),
    activity,
    progress: buildProgressState(activity, { missionStatus: input.missionStatus, blocked: input.blocked, campaign: input.campaign }),
    intervention: buildIntervention({
      blocked: input.blocked,
      missionStatus: input.missionStatus,
      provider: input.provider,
      authorization: input.authorization,
      lastBlockedEvent: input.blocked ? null : lastBlockedEvent,
    }),
    completion: buildCompletionPresentation(input.completionTruth),
  }
}

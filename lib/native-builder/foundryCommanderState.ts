/**
 * Foundry Commander lifecycle. Distinguishes internal orchestration steps from the
 * states a Commander should see, and refuses REPAIRING without recorded failure evidence.
 */
import { createHash } from 'node:crypto'
import type { FoundryAction } from './foundryActions'
import type {
  FoundryCommanderState,
  FoundryFailureEvidence,
  FoundryWorkEvent,
  NativeValidationResult,
} from './types'

export const FOUNDRY_COMMANDER_STATES = [
  'IDLE',
  'PLANNING',
  'BUILDING',
  'RUNNING',
  'TESTING',
  'REPAIRING',
  'AWAITING_APPROVAL',
  'COMPLETE',
  'BLOCKED',
  'CANCELLED',
] as const satisfies readonly FoundryCommanderState[]

const NEW_APP = /\b(build|create|make|scaffold|start|new)\b.{0,40}\b(app|application|calculator|crm|tracker|game|website|cli|tool|server|page)\b/i
const BUILD_ME = /\bbuild me\b|\bmake me\b|\bcreate (a|an|me)\b/i

export function looksLikeNewApplication(text: string): boolean {
  const t = text.trim()
  return BUILD_ME.test(t) || NEW_APP.test(t)
}

export function projectNameFromPrompt(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^@\w+\s+/i, '')
    .replace(/^(build me|make me|create me|create|build|make|scaffold|start)\s+(a|an|the)?\s*/i, '')
    .replace(/[.'"]/g, '')
    .split(/[.\n!?]/)[0]
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4)
  const slug = (words.join('-') || 'foundry-project')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug || 'foundry-project'
}

export function parseNodeTestCounts(output: string): { tests: number; pass: number; fail: number } | null {
  const tests = Number((output.match(/ℹ\s+tests\s+(\d+)/i) ?? output.match(/#\s+tests\s+(\d+)/i) ?? [])[1])
  const pass = Number((output.match(/ℹ\s+pass\s+(\d+)/i) ?? output.match(/#\s+pass\s+(\d+)/i) ?? [])[1])
  const fail = Number((output.match(/ℹ\s+fail\s+(\d+)/i) ?? output.match(/#\s+fail\s+(\d+)/i) ?? [])[1])
  if (!Number.isFinite(tests) && !Number.isFinite(pass) && !Number.isFinite(fail)) return null
  return {
    tests: Number.isFinite(tests) ? tests : (Number.isFinite(pass) ? pass : 0) + (Number.isFinite(fail) ? fail : 0),
    pass: Number.isFinite(pass) ? pass : 0,
    fail: Number.isFinite(fail) ? fail : 0,
  }
}

export function mapInternalStepToCommanderState(
  step: string | undefined,
  evidence?: { failureEvidence?: { errorSummary?: string } | null; validationResults?: NativeValidationResult[] },
): FoundryCommanderState {
  switch (step) {
    case 'IDLE':
      return 'IDLE'
    case 'ANALYZING':
    case 'PLANNING':
      return 'PLANNING'
    case 'EDITING':
    case 'BUILDING':
      return 'BUILDING'
    case 'RUNNING':
      return 'RUNNING'
    case 'TESTING':
      return 'TESTING'
    case 'REPAIRING':
      return hasRecordedFailure(evidence) ? 'REPAIRING' : 'BUILDING'
    case 'WAITING_FOR_APPROVAL':
    case 'AWAITING_APPROVAL':
      return 'AWAITING_APPROVAL'
    case 'DONE':
    case 'COMPLETE':
      return 'COMPLETE'
    case 'CANCELLED':
      return 'CANCELLED'
    case 'BLOCKED':
    case 'PAUSED_PROVIDER_UNAVAILABLE':
      return 'BLOCKED'
    default:
      return 'IDLE'
  }
}

export function hasRecordedFailure(evidence?: {
  failureEvidence?: FoundryFailureEvidence | null
  validationResults?: NativeValidationResult[]
}): boolean {
  const last = evidence?.validationResults?.at(-1)
  if (last) return !last.ok
  return Boolean(evidence?.failureEvidence?.errorSummary)
}

export function canEnterRepairing(evidence?: {
  failureEvidence?: FoundryFailureEvidence | null
  validationResults?: NativeValidationResult[]
}): boolean {
  return hasRecordedFailure(evidence)
}

export function toCommanderState(
  coding: { currentStep?: string; failureEvidence?: { errorSummary?: string } | null; commanderState?: string } | undefined,
  validationResults?: NativeValidationResult[],
): FoundryCommanderState {
  if (!coding) return 'IDLE'
  return mapInternalStepToCommanderState(coding.currentStep, {
    failureEvidence: coding.failureEvidence,
    validationResults,
  })
}

export function failureFromValidation(
  results: NativeValidationResult[],
  repairAction?: string,
): FoundryFailureEvidence | null {
  const failed = results.filter(v => !v.ok)
  if (!failed.length) return null
  const last = failed[failed.length - 1]
  const output = `${last.stderr || ''}\n${last.stdout || ''}`.trim()
  const counts = parseNodeTestCounts(`${last.stdout}\n${last.stderr}`)
  const summary = counts && counts.fail > 0
    ? `${counts.fail} test${counts.fail === 1 ? '' : 's'} failed`
    : (output.split('\n').filter(Boolean).slice(-4).join(' ').slice(0, 240) || `${last.operation.id} failed`)
  const id = createHash('sha256')
    .update(`${last.operation.id}:${last.exitCode}:${output.slice(0, 400)}`)
    .digest('hex')
    .slice(0, 12)
  return {
    id,
    at: last.ranAt || new Date().toISOString(),
    command: last.operation.id,
    testName: last.operation.targets?.[0],
    action: last.operation.id,
    errorSummary: summary,
    file: last.operation.targets?.find(t => /\.[a-z]+$/i.test(t)),
    subsystem: last.operation.id,
    repairAction,
  }
}

export function activityTextForAction(action: FoundryAction, result?: { ok: boolean; detail: string }): string {
  switch (action.type) {
    case 'READ_FILE':
      return `Reading ${action.path}`
    case 'SEARCH_CODE':
      return `Searching ${action.query}`
    case 'CREATE_FILE':
      return `Creating ${action.path}`
    case 'PATCH_FILE':
      return `Editing ${action.path}`
    case 'DELETE_FILE':
      return `Deleting ${action.path}`
    case 'RUN_COMMAND':
    case 'RUN_VALIDATION': {
      const id = action.type === 'RUN_COMMAND' ? action.operation.id : (action.operation?.id ?? 'node_test')
      if (result && /test/i.test(id)) {
        const counts = parseNodeTestCounts(result.detail)
        if (counts) return `${counts.pass}/${counts.tests} tests ${counts.fail ? 'failed' : 'passed'}`
      }
      return result?.ok === false ? `Tests failed (${id})` : `Running ${id === 'node_test' ? 'tests' : id}`
    }
    case 'START_PROCESS':
      return `Starting ${action.label || [action.cmd, ...action.args].join(' ')}`
    case 'STOP_PROCESS':
      return 'Stopping owned processes'
    case 'INSPECT_DIFF':
      return 'Inspecting diff'
    case 'ASK_SPECIALIST':
      return `Delegating to ${action.specialist}`
    case 'COMPLETE_MISSION':
      return action.summary || 'Mission complete'
    case 'NOTE':
      return action.text.slice(0, 160)
  }
}

export function workEventFromAction(
  action: FoundryAction,
  result?: { ok: boolean; detail: string },
): FoundryWorkEvent {
  const kind: FoundryWorkEvent['kind'] =
    action.type === 'CREATE_FILE' || action.type === 'PATCH_FILE' || action.type === 'DELETE_FILE' || action.type === 'READ_FILE'
      ? 'file'
      : action.type === 'RUN_VALIDATION' || action.type === 'RUN_COMMAND'
        ? 'test'
        : action.type === 'START_PROCESS' || action.type === 'STOP_PROCESS'
          ? 'process'
          : action.type === 'COMPLETE_MISSION'
            ? 'complete'
            : action.type === 'ASK_SPECIALIST'
              ? 'plan'
              : 'status'
  const path = 'path' in action ? action.path : undefined
  return {
    id: createHash('sha256').update(`${action.type}:${path ?? ''}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12),
    at: new Date().toISOString(),
    kind,
    text: activityTextForAction(action, result),
    source: 'execution',
    actionType: action.type,
    path,
    ok: result?.ok,
  }
}

export function stepForTurn(opts: {
  hasFailure: boolean
  lastActionType?: FoundryAction['type']
  testsRan?: boolean
  runningProcess?: boolean
}): NativeEngineerProgressStep {
  if (opts.testsRan || opts.lastActionType === 'RUN_VALIDATION' || opts.lastActionType === 'RUN_COMMAND') return 'TESTING'
  if (opts.runningProcess || opts.lastActionType === 'START_PROCESS') return 'RUNNING'
  if (opts.hasFailure) return 'REPAIRING'
  return 'BUILDING'
}

export function statusNarrative(coding: {
  currentAction?: string
  lastCompletedAction?: string
  nextAction?: string
  currentStep?: string
  failureEvidence?: { errorSummary?: string } | null
  blockingReason?: string
  workstream?: { text: string; ok?: boolean; kind: string }[]
  progressEvents?: { detail: string }[]
  commanderState?: string
} | undefined, validationResults?: NativeValidationResult[]): {
  state: FoundryCommanderState
  current: string
  completed: string[]
  next: string
  error?: string
} {
  const state = toCommanderState(coding, validationResults)
  const completed = (coding?.workstream ?? [])
    .filter(e => e.ok !== false && e.kind !== 'status')
    .slice(-6)
    .map(e => e.text)
  const current = coding?.currentAction || coding?.progressEvents?.at(-1)?.detail || 'Waiting'
  const next = coding?.nextAction || (state === 'COMPLETE' ? 'Review result' : state === 'TESTING' ? 'Evaluate results' : state === 'REPAIRING' ? 'Re-run tests' : 'Continue')
  const error = state === 'REPAIRING' || state === 'BLOCKED' ? (coding?.failureEvidence?.errorSummary || coding?.blockingReason) : undefined
  return { state, current, completed, next, error }
}

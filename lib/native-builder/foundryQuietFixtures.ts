/**
 * Shared Quiet Execution fixture states. Event order and shapes mirror a real persisted engineering
 * campaign. Used by foundryQuietPresentation.validation.ts and by the read-only fixture preview route
 * so the screenshots show exactly the states the validator proves.
 */
import { buildEngineeringCompletionTruth } from './foundryCompletionHistory'
import type { buildQuietThread, QuietEvent } from './foundryQuietPresentation'
import {
  blockedEvidence,
  emptyCampaignProgress,
  evaluateFailure,
  fingerprintTestFailure,
  noteDebuggerFinding,
  noteMutation,
  progressEventPayload,
  progressLimits,
  type CampaignProgress,
  type ProgressDecision,
} from './foundryProgressEvaluation'

export const FAIL_OUT = "======================================================================\nERROR: test_backend_filter_matches_storage_labels (test_tickets.TicketDeskTests.test_backend_filter_matches_storage_labels)\n----------------------------------------------------------------------\nTraceback (most recent call last):\nNameError: name 'STATUS_QUERY' is not defined\n\n----------------------------------------------------------------------\nRan 6 tests in 0.001s\n\nFAILED (errors=4)\n"
export const OK_OUT = '----------------------------------------------------------------------\nRan 6 tests in 0.000s\n\nOK\n'
export const CMD = 'python3 -m unittest discover -s tests -q'
export const DIFF = '--- backend/api.py\n+++ backend/api.py\n-from shared.contract import normalize_status\n+from shared.contract import normalize_status, STATUS_QUERY'

let clock = 0
export const setFixtureClock = (value: number) => { clock = value }
const t = () => new Date(Date.UTC(2026, 8, 24, 17, 0, clock++)).toISOString()
export const ev = (type: string, status: string, summary: string, extra: Partial<QuietEvent> = {}): QuietEvent =>
  ({ eventId: `e${clock}`, type, status, summary, timestamp: t(), ...extra })

export function fullMission(): QuietEvent[] {
  clock = 0
  return [
    ev('CAMPAIGN_STARTED', 'running', 'One engineering campaign started.'),
    ev('ARCHITECTING', 'pass', 'Architecture is taken from repository paths.'),
    ev('PLAN_READY', 'pass', '0 / 6 phases complete'),
    ev('TASK_STARTED', 'running', 'ARCHITECT — analyzing'),
    ev('TASK_COMPLETE', 'pass', 'ARCHITECT discover'),
    ev('TASK_STARTED', 'running', 'ARCHITECT — analyzing'),
    ev('TASK_COMPLETE', 'pass', 'ARCHITECT architect'),
    ev('TASK_STARTED', 'running', 'ARCHITECT — analyzing'),
    ev('TASK_COMPLETE', 'pass', 'ARCHITECT contract'),
    ev('TASK_STARTED', 'running', 'BACKEND — implementing'), // idx 9
    ev('TASK_COMPLETE', 'pass', 'BACKEND backend'),
    ev('TASK_STARTED', 'running', 'FRONTEND — implementing'),
    ev('TASK_COMPLETE', 'pass', 'FRONTEND frontend'),
    ev('TASK_STARTED', 'running', 'TEST — verifying'), // idx 13
    ev('INTEGRATING', 'running', 'Integration tests are running.'),
    ev('COMMAND_STARTED', 'running', 'Campaign integration', { command: CMD }),
    ev('COMMAND_COMPLETED', 'fail', 'FAIL', { command: CMD, exitCode: 1, durationMs: 60, outputTail: FAIL_OUT, governance: { commandClass: 'REVERSIBLE_MUTATION', allowed: true, reason: 'Workspace-local Python toolchain command.' } }),
    ev('REWORKING', 'fail', "integration defect NameError: name 'STATUS_QUERY' is not defined  ======================================================================"), // idx 17
    ev('TASK_STARTED', 'running', 'DEBUGGER — diagnosing'),
    ev('TASK_COMPLETE', 'pass', 'DEBUGGER debug-1'),
    ev('TASK_STARTED', 'running', 'BACKEND — implementing'),
    ev('FILE_EDITED', 'pass', 'backend/api.py', { filePath: 'backend/api.py', diff: DIFF }), // idx 21
    ev('TASK_COMPLETE', 'pass', 'BACKEND backend'),
    ev('TASK_STARTED', 'running', 'TEST — verifying'), // idx 23
    ev('INTEGRATING', 'running', 'Integration tests are running.'),
    ev('COMMAND_STARTED', 'running', 'Campaign integration', { command: CMD }),
    ev('COMMAND_COMPLETED', 'pass', 'PASS', { command: CMD, exitCode: 0, durationMs: 40, outputTail: OK_OUT }),
    ev('TASK_COMPLETE', 'pass', 'TEST integrate'), // idx 27
    ev('TASK_STARTED', 'running', 'REVIEWER — reviewing'), // idx 28
    ev('REVIEWING', 'pass', 'Review found no blocking gap.'),
    ev('TASK_COMPLETE', 'pass', 'REVIEWER review'),
    ev('TASK_STARTED', 'running', 'VERIFIER — verifying'),
    ev('VERIFICATION_STARTED', 'running', 'VERIFIER — verifying'),
    ev('COMMAND_STARTED', 'running', 'Campaign verification', { command: CMD }),
    ev('COMMAND_COMPLETED', 'pass', 'PASS', { command: CMD, exitCode: 0, outputTail: OK_OUT }),
    ev('PROJECT_READY', 'pass', 'Verifier accepted the campaign from disk truth.'),
    ev('TASK_COMPLETE', 'pass', 'VERIFIER verify'),
    ev('MISSION_COMPLETE', 'pass', 'Campaign complete. No git commit, push, or deploy was executed.'),
  ]
}


export const BLOCKED_DETAIL = {
  summary: 'BLOCKED_STAGNATION',
  failure: "integration defect AssertionError: Lists differ: [] != [{'id': 'p1'}]  ======================================================================",
  attempts: [{ strategy: 'CONTRACT_FIELD', outcome: 'failed' }],
  currentState: 'Mission changes kept for inspection.',
  rolledBack: false,
  boundary: 'Bounded repair strategies exhausted, or a governance boundary was reached.',
  unblockAction: 'The review finding needs a bounded repair.',
}

export function truthFor(events: QuietEvent[], missionStatus: string) {
  return buildEngineeringCompletionTruth({
    missionStatus,
    runtime: {
      completion: { canComplete: true, changedFiles: ['backend/api.py'], tests: [{ command: 'unittest discover tests', ok: true }] },
      events: events.map(e => ({ type: e.type, status: e.status, exitCode: e.exitCode, outputTail: e.outputTail, diff: e.diff })),
      scope: { created: [] },
      blockedDetail: null,
      campaign: { verification: 'PROJECT_READY' },
    },
  })
}


export const FIXTURE_REQUEST = 'Update the backend ticket API and the frontend UI view so listing works both with and without a status filter, and make sure the tests pass.'

export const FIXTURE_CAMPAIGN = {
  repairFinding: "HYPOTHESIS: The root cause is that 'STATUS_QUERY' is not defined in the backend/api.py file. EVIDENCE: The failing line is 'wanted = normalize_status(query.get(STATUS_QUERY))'. REPAIR_TARGET: backend/api.py. The implementer applies the repair.",
  reworkCycles: 1,
  workerReceipts: [
    { role: 'ARCHITECT', provider: 'ollama', model: 'qwen2.5-coder:14b', taskId: 'architect', attempt: 1, resultStatus: 'pass', failureClass: null },
    { role: 'DEBUGGER', provider: 'ollama', model: 'qwen2.5-coder:14b', taskId: 'debug-1', attempt: 1, resultStatus: 'pass', failureClass: null },
    { role: 'BACKEND', provider: 'ollama', model: 'qwen2.5-coder:14b', taskId: 'backend', attempt: 2, resultStatus: 'propose', failureClass: null },
  ],
  testReceipts: [
    { testedMutationGeneration: 0, command: CMD, exitCode: 1, result: 'FAILED' },
    { testedMutationGeneration: 1, command: CMD, exitCode: 0, result: 'PASSED' },
  ],
  mutationGeneration: 1,
}

// ---------------------------------------------------------------------------------------------
// Smart stagnation fixtures: real evaluator output, so the UI proves what the runtime persists.
// ---------------------------------------------------------------------------------------------

export const ASSERT_OUT = "======================================================================\nFAIL: test_backend_filter_matches_storage_labels (test_tickets.TicketDeskTests.test_backend_filter_matches_storage_labels)\n----------------------------------------------------------------------\nTraceback (most recent call last):\n  File \"/tmp/x/tests/test_tickets.py\", line 20, in test_backend_filter_matches_storage_labels\n    self.assertEqual([t['id'] for t in list_tickets({'status': 'open'})], ['t1', 't4'])\nAssertionError: Lists differ: [] != ['t1', 't4']\n\nFirst differing element 0:\n\n----------------------------------------------------------------------\nRan 6 tests in 0.001s\n\nFAILED (failures=1)\n"

const IMPORT_BEFORE = 'from shared.contract import normalize_status'
const IMPORT_AFTER = 'from shared.contract import normalize_status, STATUS_QUERY'

function progressEvent(progress: CampaignProgress, decision: ProgressDecision, cycles: number): QuietEvent {
  return ev('PROGRESS_EVALUATED', decision.proceed ? 'info' : 'blocked', decision.summary, { strategy: decision.strategy ?? undefined, detail: progressEventPayload(progress, decision, progressLimits(progress), cycles) })
}

/** NameError fixed, deeper AssertionError exposed: productive rework, still working. */
export function productiveProgressEvents(): { events: QuietEvent[]; progress: CampaignProgress } {
  const base = fullMission().slice(0, 18)
  let progress = emptyCampaignProgress()
  const first = evaluateFailure(progress, { fingerprint: fingerprintTestFailure(FAIL_OUT), at: t(), mutationGeneration: 0, reworkCycles: 0 })
  progress = noteDebuggerFinding(first.progress, { hypothesis: "STATUS_QUERY is not defined in backend/api.py", repairTarget: 'backend/api.py' })
  progress = noteMutation(progress, { file: 'backend/api.py', before: IMPORT_BEFORE, after: IMPORT_AFTER, start: 0, end: 43 })
  const second = evaluateFailure(progress, { fingerprint: fingerprintTestFailure(ASSERT_OUT), at: t(), mutationGeneration: 1, reworkCycles: 1 })
  const events = [
    ...base,
    progressEvent(first.progress, first.decision, 1),
    ev('TASK_STARTED', 'running', 'DEBUGGER — diagnosing'),
    ev('TASK_COMPLETE', 'pass', 'DEBUGGER debug-1'),
    ev('TASK_STARTED', 'running', 'BACKEND — implementing'),
    ev('FILE_EDITED', 'pass', 'backend/api.py', { filePath: 'backend/api.py', diff: DIFF }),
    ev('TASK_COMPLETE', 'pass', 'BACKEND backend'),
    ev('TASK_STARTED', 'running', 'TEST — verifying'),
    ev('INTEGRATING', 'running', 'Integration tests are running.'),
    ev('COMMAND_STARTED', 'running', 'Campaign integration', { command: CMD }),
    ev('COMMAND_COMPLETED', 'fail', 'FAIL', { command: CMD, exitCode: 1, durationMs: 55, outputTail: ASSERT_OUT }),
    ev('REWORKING', 'fail', "integration defect AssertionError: Lists differ: [] != ['t1', 't4']"),
    progressEvent(second.progress, second.decision, 2),
    ev('TASK_STARTED', 'running', 'DEBUGGER — diagnosing'),
  ]
  return { events, progress: second.progress }
}

/** The same assertion returns under the same equivalent edit: Foundry pauses with typed stagnation evidence. */
export function trueStagnationEvents(): { events: QuietEvent[]; progress: CampaignProgress } {
  const base = fullMission().slice(0, 18)
  const events: QuietEvent[] = [...base]
  let progress = emptyCampaignProgress()
  const attempt = (cycles: number, gen: number) => {
    const result = evaluateFailure(progress, { fingerprint: fingerprintTestFailure(ASSERT_OUT), at: t(), mutationGeneration: gen, reworkCycles: cycles })
    events.push(
      ev('TASK_STARTED', 'running', 'TEST — verifying'),
      ev('INTEGRATING', 'running', 'Integration tests are running.'),
      ev('COMMAND_STARTED', 'running', 'Campaign integration', { command: CMD }),
      ev('COMMAND_COMPLETED', 'fail', 'FAIL', { command: CMD, exitCode: 1, durationMs: 55, outputTail: ASSERT_OUT }),
      progressEvent(result.progress, result.decision, cycles),
    )
    if (result.decision.proceed) events.push(ev('REWORKING', 'fail', "integration defect AssertionError: Lists differ: [] != ['t1', 't4']"), ev('TASK_STARTED', 'running', 'DEBUGGER — diagnosing'), ev('TASK_COMPLETE', 'pass', 'DEBUGGER debug'), ev('TASK_STARTED', 'running', 'BACKEND — implementing'), ev('FILE_EDITED', 'pass', 'backend/api.py', { filePath: 'backend/api.py', diff: DIFF }), ev('TASK_COMPLETE', 'pass', 'BACKEND backend'))
    progress = result.progress
    return result
  }
  let cycles = 1
  for (let n = 0; n < 6; n += 1) {
    const result = attempt(cycles, n)
    if (!result.decision.proceed) break
    progress = noteMutation(progress, { file: 'backend/api.py', before: IMPORT_BEFORE, after: IMPORT_AFTER, start: 0, end: 43 })
    cycles += 1
  }
  events.push(ev('BLOCKED', 'blocked', 'BLOCKED_STAGNATION'))
  return { events, progress }
}

export function stagnationBlockedDetail(progress: CampaignProgress) {
  return {
    summary: 'BLOCKED_STAGNATION',
    failure: "integration defect AssertionError: Lists differ: [] != ['t1', 't4']\n" + (progress.stop?.message ?? ''),
    attempts: progress.observations.slice(-4).map(item => ({ strategy: item.strategy ?? item.kind, outcome: item.class })),
    currentState: 'Mission changes kept for inspection.',
    rolledBack: false,
    boundary: 'Bounded repair strategies exhausted, or a governance boundary was reached.',
    unblockAction: 'The same failure kept returning under the same approach.',
    progress: blockedEvidence(progress) ?? undefined,
  }
}

export type QuietFixtureCase = { id: string; label: string; input: Parameters<typeof buildQuietThread>[0] }

/** Cases A..L from the Quiet Execution brief. */
export function quietFixtureCases(): QuietFixtureCase[] {
  const full = fullMission()
  const upTo = (n: number) => full.slice(0, n)
  const status = (s: string) => ({ missionStatus: s })
  const productive = productiveProgressEvents()
  const stagnation = trueStagnationEvents()
  return [
    { id: 'A', label: 'New mission', input: { events: [], ...status('running') } },
    { id: 'B', label: 'Architect working', input: { events: upTo(4), ...status('running') } },
    { id: 'C', label: 'Implementation', input: { events: upTo(10), ...status('running') } },
    { id: 'D', label: 'Test failure', input: { events: upTo(18), ...status('running'), campaign: FIXTURE_CAMPAIGN } },
    { id: 'E', label: 'Debug / rework', input: { events: upTo(22), ...status('running'), campaign: FIXTURE_CAMPAIGN } },
    { id: 'F', label: 'Green tests', input: { events: upTo(28), ...status('running'), campaign: FIXTURE_CAMPAIGN } },
    { id: 'G', label: 'Review', input: { events: upTo(29), ...status('running'), campaign: FIXTURE_CAMPAIGN } },
    { id: 'H', label: 'Verification', input: { events: upTo(34), ...status('running'), campaign: FIXTURE_CAMPAIGN } },
    { id: 'I', label: 'Complete', input: { events: full, ...status('completed'), campaign: FIXTURE_CAMPAIGN, completionTruth: truthFor(full, 'completed') } },
    { id: 'J', label: 'Blocked stagnation', input: { events: [...upTo(18), ev('BLOCKED', 'blocked', 'BLOCKED_STAGNATION')], ...status('blocked'), blocked: BLOCKED_DETAIL, campaign: FIXTURE_CAMPAIGN } },
    { id: 'K', label: 'Provider unavailable', input: { events: [], provider: { blocking: true, detail: 'Local Ollama provider is unreachable.' } } },
    { id: 'L', label: 'Rolled back completed mission', input: { events: full, ...status('rolled_back'), campaign: FIXTURE_CAMPAIGN, completionTruth: truthFor(full, 'rolled_back') } },
    { id: 'M', label: 'Productive rework', input: { events: productive.events, ...status('running'), campaign: { ...FIXTURE_CAMPAIGN, progress: { classification: 'PROGRESSING', credits: 1 } } } },
    { id: 'N', label: 'True stagnation', input: { events: stagnation.events, ...status('blocked'), blocked: stagnationBlockedDetail(stagnation.progress), campaign: { ...FIXTURE_CAMPAIGN, progress: { classification: 'STAGNATING', credits: 0 } } } },
  ]
}

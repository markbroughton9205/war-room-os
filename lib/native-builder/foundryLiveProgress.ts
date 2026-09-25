/**
 * Live mission progress for the Commander: an ordered set of human stages, each with a real status.
 *
 * Runtime truth only. Every stage state here is derived from the authoritative mission record: the persisted engineering
 * event stream (and, when present, the campaign's tasks and test receipts). There are no timers, no optimistic frontend
 * guesses, and no hard-coded phase order used as a substitute for state: a stage is QUEUED until an event says it started.
 * The same persisted record always produces the same panel, so a restart or a reopened session restores the exact progress.
 *
 * Presentation states are QUEUED / RUNNING / PASS / FAIL / PAUSED / SKIPPED. They are never shown as enum names in the main
 * panel; each state has plain-language text per stage. Raw evidence stays in `technical` (Activity / Technical details).
 *
 * Pure: no filesystem, network, clock, or React.
 */
import { humanFailure, shortFailureCause } from './foundryFailureText'
import type { QuietBlockedDetail, QuietEvent } from './foundryQuietPresentation'

export type LiveStepState = 'QUEUED' | 'RUNNING' | 'PASS' | 'FAIL' | 'PAUSED' | 'SKIPPED'
export type LiveStepId = 'understand' | 'plan' | 'build' | 'test' | 'fix' | 'review' | 'verify' | 'ready'

export type LiveStep = {
  id: LiveStepId
  state: LiveStepState
  /** State-specific plain-language line, e.g. "Running tests…" / "Tests found a problem". */
  label: string
  /** One short line of what is actually being checked or changed right now (active/failed/paused steps only). */
  detail: string | null
  /** Sub-lines that must stay visible as the mission changes course ("✓ Fixed missing import", "● Updating the plan…"). */
  notes: { state: 'PASS' | 'RUNNING' | 'FAIL'; text: string }[]
  /** Raw evidence for Technical details. Never rendered in the main panel. */
  technical: string[]
}

export type LiveProgress = {
  steps: LiveStep[]
  done: number
  total: number
  activeId: LiveStepId | null
  status: 'working' | 'paused' | 'complete' | 'stopped'
  /** Commander-facing title for the count, e.g. "Progress · 3/8". */
  countLabel: string
}

export type LiveProgressInput = {
  events: readonly QuietEvent[]
  missionStatus?: string | null
  blocked?: QuietBlockedDetail | null
  /** Optional task truth from the campaign record. Events remain the primary source. */
  tasks?: readonly { id: string; role: string; status: string }[] | null
  testReceipts?: readonly { result: string; command?: string }[] | null
}

const ORDER: LiveStepId[] = ['understand', 'plan', 'build', 'test', 'fix', 'review', 'verify', 'ready']

const TEXT: Record<LiveStepId, { QUEUED: string; RUNNING: string; PASS: string; FAIL: string; PAUSED: string; SKIPPED: string }> = {
  understand: { QUEUED: 'Understand the project', RUNNING: 'Understanding the project…', PASS: 'Understood the project', FAIL: 'Could not understand the project', PAUSED: 'Foundry paused', SKIPPED: 'Understanding skipped' },
  plan: { QUEUED: 'Plan the change', RUNNING: 'Planning the change…', PASS: 'Plan ready', FAIL: 'Planning hit a problem', PAUSED: 'Foundry paused', SKIPPED: 'Planning skipped' },
  build: { QUEUED: 'Update the code', RUNNING: 'Updating the code…', PASS: 'Code updated', FAIL: 'The update hit a problem', PAUSED: 'Foundry paused', SKIPPED: 'No code change needed' },
  test: { QUEUED: 'Run tests', RUNNING: 'Running tests…', PASS: 'Tests passed', FAIL: 'Tests found a problem', PAUSED: 'Foundry paused', SKIPPED: 'Tests skipped' },
  fix: { QUEUED: 'Fix any problem', RUNNING: 'Fixing the problem…', PASS: 'Problem fixed', FAIL: 'The fix did not work yet', PAUSED: 'Foundry paused', SKIPPED: 'No problem to fix' },
  review: { QUEUED: 'Review the change', RUNNING: 'Reviewing the change…', PASS: 'Review passed', FAIL: 'Review found a problem', PAUSED: 'Foundry paused', SKIPPED: 'Review skipped' },
  verify: { QUEUED: 'Verify from disk', RUNNING: 'Verifying from disk…', PASS: 'Verification passed', FAIL: 'Verification found a problem', PAUSED: 'Foundry paused', SKIPPED: 'Verification skipped' },
  ready: { QUEUED: 'Project ready', RUNNING: 'Finishing up…', PASS: 'Project ready', FAIL: 'Not ready yet', PAUSED: 'Foundry paused', SKIPPED: 'Project ready' },
}

const TERMINAL_STATUS = new Set(['completed', 'resolved', 'rolled_back'])
const STOPPED_STATUS = new Set(['cancelled'])

type Acc = {
  state: Record<LiveStepId, LiveStepState>
  detail: Record<LiveStepId, string | null>
  notes: Record<LiveStepId, LiveStep['notes']>
  tech: Record<LiveStepId, string[]>
}

function blank(): Acc {
  const rec = <T,>(v: () => T) => Object.fromEntries(ORDER.map(id => [id, v()])) as Record<LiveStepId, T>
  return { state: rec(() => 'QUEUED' as LiveStepState), detail: rec<string | null>(() => null), notes: rec<LiveStep['notes']>(() => []), tech: rec<string[]>(() => []) }
}

const roleOf = (summary: string | undefined): string | null => /^(ARCHITECT|BACKEND|FRONTEND|DATABASE|TEST|DEBUGGER|REVIEWER|VERIFIER)\b/.exec((summary ?? '').trim())?.[1] ?? null
const taskIdOf = (summary: string | undefined): string | null => /^[A-Z]+ ([a-z][\w-]*)$/.exec((summary ?? '').trim())?.[1] ?? null

function parsePayload(event: QuietEvent): { notes?: { icon: string; text: string }[]; signals?: string[]; stop?: { reason: string } | null; kind?: string | null; class?: string } | null {
  if (event.type !== 'PROGRESS_EVALUATED' || !event.detail) return null
  try { return JSON.parse(event.detail) } catch { return null }
}

/** Plain, single-sentence description of what a test run is checking, from real evidence (never a canned timer message). */
function testDetail(files: string[]): string {
  return files.length ? `Checking your changes to ${files.slice(0, 2).join(' and ')}` : 'Checking how the project behaves'
}

export function buildLiveProgress(input: LiveProgressInput): LiveProgress {
  const events = input.events
  const acc = blank()
  const set = (id: LiveStepId, state: LiveStepState) => { acc.state[id] = state }
  const editedFiles: string[] = []
  let testFailures = 0
  let lastTestOutcome: 'none' | 'running' | 'pass' | 'fail' = 'none'
  let failureCause: string | null = null
  let debugging = false, editedSinceFailure = false
  let firstBuildStarted = false, buildDone = false
  let deeper = false, resolvedLabel: string | null = null
  let failedAttempts = 0
  let replans = 0
  let reviewState: LiveStepState = 'QUEUED'
  // The reviewer can raise a concern the runtime judges non-actionable (nothing to change): that is not a failed review.
  // Only a rework that follows the finding makes the review step FAIL.
  let pendingReviewFail = false
  let sawBlocked = false
  let blockedAt: LiveStepId | null = null

  for (const e of events) {
    const summary = e.summary ?? ''
    const role = roleOf(summary)
    const id = taskIdOf(summary)
    // PROGRESS_EVALUATED and PLAN_REVISED are runtime bookkeeping that the runtime emits BETWEEN a review finding and its REWORKING event; they must not settle the review early.
    if (pendingReviewFail && e.type !== 'REVIEWING' && e.type !== 'PROGRESS_EVALUATED' && e.type !== 'PLAN_REVISED') {
      pendingReviewFail = false
      if (e.type === 'REWORKING') { reviewState = 'FAIL'; set('review', 'FAIL'); acc.tech.review.push('review finding led to a rework') }
      else { reviewState = 'PASS'; set('review', 'PASS'); acc.tech.review.push('reviewer raised a concern that needed no change') }
    }
    switch (e.type) {
      case 'CAMPAIGN_STARTED':
      case 'MISSION_STARTED':
        set('understand', 'RUNNING'); break
      case 'PLAN_READY':
        acc.tech.plan.push('plan recorded'); break
      case 'TASK_STARTED':
        if (role === 'ARCHITECT') { if (acc.state.understand !== 'PASS') set('understand', 'RUNNING'); else if (acc.state.plan !== 'PASS') set('plan', 'RUNNING') }
        else if (role === 'BACKEND' || role === 'FRONTEND' || role === 'DATABASE') {
          if (testFailures > 0) { debugging = false; set('fix', 'RUNNING'); acc.detail.fix = 'Applying a fix' } else { firstBuildStarted = true; set('understand', 'PASS'); set('plan', 'PASS'); set('build', 'RUNNING') }
        } else if (role === 'DEBUGGER') { debugging = true; set('fix', 'RUNNING'); if (acc.state.test === 'FAIL') acc.detail.fix = 'Tracing the cause' }
        else if (role === 'TEST') { /* the run itself is tracked by INTEGRATING / COMMAND events */ }
        else if (role === 'REVIEWER') { set('review', 'RUNNING'); reviewState = 'RUNNING' }
        else if (role === 'VERIFIER') { set('verify', 'RUNNING') }
        break
      case 'TASK_COMPLETE':
        if (role === 'ARCHITECT') {
          if (id === 'discover' || id === 'architect') { if (id === 'architect') set('understand', 'PASS') }
          if (id === 'contract') { set('understand', 'PASS'); set('plan', 'PASS') }
        }
        if (role === 'BACKEND' || role === 'FRONTEND') { if (testFailures === 0) { set('understand', 'PASS'); set('plan', 'PASS') } }
        break
      case 'FILE_EDITED':
        if (e.filePath && !editedFiles.includes(e.filePath)) editedFiles.push(e.filePath)
        if (testFailures > 0) { editedSinceFailure = true; if (e.filePath) acc.detail.fix = `Updated ${e.filePath}; checking it next` }
        break
      case 'INTEGRATING':
        set('understand', 'PASS'); set('plan', 'PASS')
        if (!buildDone) { buildDone = true; set('build', 'PASS') }
        set('test', 'RUNNING'); lastTestOutcome = 'running'
        if (testFailures > 0 && editedSinceFailure) { set('fix', 'QUEUED'); acc.detail.fix = 'Applied a fix; the tests will show whether it worked' }
        acc.detail.test = null
        break
      case 'COMMAND_STARTED':
        if (/integration|verification/i.test(summary)) { /* covered by INTEGRATING / VERIFICATION_STARTED */ }
        break
      case 'COMMAND_COMPLETED': {
        const passed = e.status === 'pass' || e.exitCode === 0
        if (acc.state.verify === 'RUNNING') break
        if (lastTestOutcome === 'running') {
          lastTestOutcome = passed ? 'pass' : 'fail'
          if (passed) { set('test', 'PASS'); if (testFailures > 0) { set('fix', 'PASS'); resolvedLabel = resolvedLabel ?? null } }
          else {
            testFailures += 1; editedSinceFailure = false; debugging = false
            set('test', 'FAIL')
            failureCause = shortFailureCause([e.outputTail, e.summary].filter(Boolean).join('\n'))
            acc.detail.test = null
            acc.tech.test.push(`failure: ${failureCause ?? 'unknown'}`)
          }
        }
        break
      }
      case 'REWORKING':
        if (lastTestOutcome === 'fail' || testFailures > 0) { set('fix', 'RUNNING'); if (!failureCause) failureCause = shortFailureCause(summary) }
        break
      case 'PROGRESS_EVALUATED': {
        const p = parsePayload(e)
        if (!p) break
        if ((p.class === 'STAGNATING' || p.class === 'REGRESSING') && !p.stop && (p.kind === 'TEST' || p.kind == null)) { failedAttempts += 1; acc.detail.fix = "That attempt didn't fix it, so I'm trying another approach" }
        acc.tech.fix.push(`${p.class ?? '?'}${p.signals?.length ? ` · ${p.signals.join(', ')}` : ''}${p.stop ? ` · stop ${p.stop.reason}` : ''}`)
        for (const note of p.notes ?? []) {
          if (note.text === 'Repairing it') continue
          if (/^Fixed /.test(note.text)) resolvedLabel = note.text.replace(/^Fixed /, '')
          if (/^Found a (deeper|different) test failure/.test(note.text)) deeper = true
        }
        break
      }
      case 'PLAN_REVISED': {
        // A real replan recorded by the runtime (never inferred): the plan changed because the evidence changed.
        let trigger = ''
        try { trigger = String((JSON.parse(e.detail ?? '{}') as { trigger?: string }).trigger ?? '') } catch { /* payload is technical detail only */ }
        if (['FAILURE_CHANGED', 'CONTRADICTION', 'REPAIR_RETARGET'].includes(trigger)) replans += 1
        acc.tech.plan.push(`plan revised${trigger ? ` · ${trigger}` : ''}`)
        break
      }
      case 'REVIEWING':
        if (e.status === 'fail') { pendingReviewFail = true; set('review', 'RUNNING') } else { reviewState = 'PASS'; set('review', 'PASS') }
        break
      case 'VERIFICATION_STARTED':
        set('verify', 'RUNNING'); if (acc.state.review === 'RUNNING') set('review', reviewState === 'FAIL' ? 'FAIL' : 'PASS'); break
      case 'VERIFICATION_FAILED':
        set('verify', 'FAIL'); break
      case 'PROJECT_READY':
        set('verify', 'PASS'); break
      case 'MISSION_COMPLETE':
        for (const step of ORDER) if (acc.state[step] === 'RUNNING' || acc.state[step] === 'QUEUED') set(step, step === 'fix' && testFailures === 0 ? 'SKIPPED' : 'PASS')
        set('ready', 'PASS'); break
      case 'BLOCKED':
        sawBlocked = true; break
      default:
        break
    }
    // a green run after a review-driven rework re-opens nothing: review is re-run by the runtime, and its own events update it.
    void debugging
  }

  if (pendingReviewFail && (events.some(e => e.type === 'PROJECT_READY' || e.type === 'MISSION_COMPLETE'))) { set('review', 'PASS') }
  const complete = events.some(e => e.type === 'MISSION_COMPLETE') || (input.missionStatus != null && TERMINAL_STATUS.has(input.missionStatus) && events.some(e => e.type === 'PROJECT_READY'))
  const blocked = Boolean(input.blocked) || sawBlocked || input.missionStatus === 'blocked'
  const stopped = input.missionStatus != null && STOPPED_STATUS.has(input.missionStatus)

  // A fix step that never had work to do is SKIPPED once the tests that follow have passed; it stays QUEUED while tests are still ahead.
  if (testFailures === 0 && (acc.state.test === 'PASS')) set('fix', 'SKIPPED')
  if (acc.state.build === 'PASS' && editedFiles.length === 0 && firstBuildStarted) acc.detail.build = null
  if (acc.state.test === 'RUNNING') acc.detail.test = testDetail(editedFiles.length ? editedFiles : [])
  if (testFailures > 0 && acc.state.test === 'RUNNING') acc.notes.test.push({ state: 'RUNNING', text: 'Running tests again…' })

  // Notes that keep the course-changes visible instead of resetting the panel.
  if (testFailures > 0) {
    const why = humanFailure(failureCause)
    void why
    if (resolvedLabel) acc.notes.fix.push({ state: 'PASS', text: `Fixed ${resolvedLabel}` })
    if (deeper) acc.notes.fix.push({ state: 'PASS', text: 'Found a deeper issue' })
    if (deeper && acc.state.fix === 'RUNNING') acc.notes.fix.push({ state: 'RUNNING', text: 'Updating the plan…' })
    if (replans > 0 && !deeper) acc.notes.fix.push({ state: 'PASS', text: 'Updated the plan' })
    if (deeper && acc.state.fix === 'PASS') acc.notes.fix.push({ state: 'PASS', text: 'Fixed the deeper issue' })
    if (failedAttempts === 1) acc.notes.fix.push({ state: 'FAIL', text: "That attempt didn't fix it" })
    if (failedAttempts > 1) acc.notes.fix.push({ state: 'FAIL', text: "Several attempts didn't fix it yet" })
    if (acc.state.fix === 'PASS' && !resolvedLabel && lastTestOutcome === 'pass') acc.notes.fix.push({ state: 'PASS', text: 'Fixed the problem' })
  }
  if (acc.state.build === 'PASS') acc.detail.build = null
  if (acc.state.build === 'PASS' && editedFiles.length) acc.tech.build.push(`edited ${editedFiles.join(', ')}`)

  // Terminal overlays: complete, paused (blocked), stopped. Prior stages keep their real state; nothing is reset.
  let status: LiveProgress['status'] = 'working'
  if (complete) status = 'complete'
  else if (stopped) status = 'stopped'
  else if (blocked) status = 'paused'
  if (status === 'paused' || status === 'stopped') {
    const running = ORDER.find(step => acc.state[step] === 'RUNNING')
    const failed = [...ORDER].reverse().find(step => acc.state[step] === 'FAIL')
    blockedAt = running ?? (testFailures > 0 ? 'fix' : failed ?? 'test')
    set(blockedAt, 'PAUSED')
    acc.detail[blockedAt] = status === 'stopped' ? 'You stopped this mission' : null
  }
  if (status === 'complete') for (const step of ORDER) if (acc.state[step] === 'QUEUED') set(step, step === 'fix' ? 'SKIPPED' : 'PASS')

  // Tests currently running: only one primary active step at a time.
  const steps: LiveStep[] = ORDER.map(id => {
    const state = acc.state[id]
    let label = TEXT[id][state]
    if (id === 'test' && state === 'RUNNING' && testFailures > 0) label = 'Running tests again…'
    if (id === 'build' && state === 'PASS' && editedFiles.length === 0) label = 'Checked the code — no change needed'
    if (id === 'build' && state === 'PASS' && editedFiles.length) label = `Updated ${editedFiles.slice(0, 2).join(', ')}`
    if (id === 'fix' && state === 'PASS' && resolvedLabel) label = deeper ? 'Problem fixed' : `Fixed ${resolvedLabel}`
    if (id === 'ready' && state === 'PASS') label = 'Project ready'
    if (id === 'test' && state === 'FAIL') label = `Tests found ${humanFailure(failureCause)}`.replace('Tests found the tests could not even load', 'Tests could not load')
    if (state === 'PAUSED' && status === 'stopped') label = 'Stopped'
    return { id, state, label, detail: state === 'RUNNING' || state === 'FAIL' || state === 'PAUSED' ? acc.detail[id] : null, notes: acc.notes[id], technical: acc.tech[id] }
  })
  const done = steps.filter(s => s.state === 'PASS' || s.state === 'SKIPPED').length
  const active = steps.find(s => s.state === 'RUNNING' || s.state === 'PAUSED') ?? null
  return { steps, done, total: steps.length, activeId: active?.id ?? null, status, countLabel: `Progress · ${done}/${steps.length}` }
}

/** State-specific wording for the application-builder (controller) stages. Unknown stages keep their own label. */
const CONTROLLER_TEXT: Record<string, Partial<Record<LiveStepState, string>>> = {
  'Understanding what you want': { RUNNING: 'Understanding what you want…', PASS: 'Understood the project', FAIL: 'Could not understand the request' },
  'Researching requirements': { RUNNING: 'Researching requirements…', PASS: 'Requirements researched' },
  'Planning the build': { RUNNING: 'Planning the build…', PASS: 'Build plan ready', FAIL: 'Planning hit a problem' },
  'Creating project': { RUNNING: 'Creating the project…', PASS: 'Project created' },
  'Building interface': { RUNNING: 'Building interface…', PASS: 'Interface updated', FAIL: 'The build hit a problem' },
  'Reviewing the build': { RUNNING: 'Reviewing the build…', PASS: 'Build reviewed', FAIL: 'Review found a problem' },
  'Running tests': { RUNNING: 'Running tests…', PASS: 'Tests passed', FAIL: 'Tests found a problem' },
  'Fixing a problem': { RUNNING: 'Fixing the problem…', PASS: 'Problem fixed', FAIL: 'The fix did not work yet' },
  'Launching preview': { RUNNING: 'Launching the preview…', PASS: 'Preview launched' },
  'Checking desktop': { RUNNING: 'Checking the app…', PASS: 'App checked', FAIL: 'The app check found a problem' },
  'Project ready': { RUNNING: 'Finishing up…', PASS: 'Project ready' },
}

/**
 * Progress for an application-builder (controller) mission from its persisted, already-deduplicated plan items
 * (foundryCommanderExperience.commanderProgressFromMission). Same states and rules: nothing is invented; a pending plan step is QUEUED.
 */
export function buildLiveProgressFromItems(input: {
  items: readonly { id: string; label: string; state: 'done' | 'failed' | 'active' | 'pending' | 'skipped' }[]
  missionStatus?: string | null
  blocked?: boolean
}): LiveProgress {
  const complete = input.missionStatus === 'COMPLETE' || input.missionStatus === 'PROJECT_READY'
  const paused = Boolean(input.blocked) || input.missionStatus === 'BLOCKED'
  let entries = input.items.map(item => ({
    id: item.id,
    label: item.label,
    state: (item.state === 'done' ? 'PASS' : item.state === 'failed' ? 'FAIL' : item.state === 'active' ? 'RUNNING' : item.state === 'skipped' ? 'SKIPPED' : 'QUEUED') as LiveStepState,
  }))
  if (paused) {
    const idx = entries.findIndex(entry => entry.state === 'RUNNING' || entry.state === 'FAIL')
    if (idx >= 0) entries[idx] = { ...entries[idx], state: 'PAUSED' }
  }
  if (complete) entries = entries.map(entry => (entry.state === 'QUEUED' ? { ...entry, state: 'PASS' as LiveStepState } : entry))
  const steps: LiveStep[] = entries.map(entry => ({
    id: entry.id as LiveStepId,
    state: entry.state,
    label: entry.state === 'PAUSED' ? 'Foundry paused' : CONTROLLER_TEXT[entry.label]?.[entry.state] ?? (entry.state === 'RUNNING' ? `${entry.label}…` : entry.label),
    detail: null,
    notes: [],
    technical: [`plan step: ${entry.id} (${entry.state})`],
  }))
  const done = steps.filter(step => step.state === 'PASS' || step.state === 'SKIPPED').length
  const active = steps.find(step => step.state === 'RUNNING' || step.state === 'PAUSED') ?? null
  return { steps, done, total: steps.length, activeId: active?.id ?? null, status: complete ? 'complete' : paused ? 'paused' : 'working', countLabel: `Progress · ${done}/${steps.length}` }
}

/** Stable text for tests and Technical details: the panel as plain lines. */
export function liveProgressLines(progress: LiveProgress): string[] {
  const mark: Record<LiveStepState, string> = { QUEUED: '○', RUNNING: '●', PASS: '✓', FAIL: '✕', PAUSED: '●', SKIPPED: '✓' }
  return progress.steps.map(s => `${mark[s.state]} ${s.label}`)
}

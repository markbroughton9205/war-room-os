/**
 * Long-horizon engineering campaign inside the existing Foundry engineering runtime.
 * One mission. FRK remains the reasoning owner. Specialists are subordinate roles.
 * This module does not call a model and does not write files.
 */
import type { PlannedEdit } from './foundryLargeProject'
import type { EngineeringPlan } from './foundryEngineeringPlan'
import type { ProjectContext } from './foundryProjectContext'
import { emptyCampaignProgress, type CampaignProgress } from './foundryProgressEvaluation'

export const MAX_ACTIVE_SUBTASKS = 8
export const MAX_CAMPAIGN_REWORK_CYCLES = 5
export const MAX_CAMPAIGN_INSPECT = 24
export const MAX_CAMPAIGN_COMMANDS = 12
export const MAX_MODEL_CALLS_PER_CAMPAIGN = 24

export type CampaignIntelligence = 'control' | 'model'

export type CampaignWorkerReceipt = {
  role: CampaignRole
  provider: string
  model: string
  routingDecisionId: string
  workerCallId: string
  taskId: string
  campaignId: string
  attempt: number
  evidenceInputs: string[]
  resultStatus: string
  summary: string
  failureClass: string | null
}

export const CAMPAIGN_ROLES = ['ARCHITECT', 'BACKEND', 'FRONTEND', 'DATABASE', 'TEST', 'DEBUGGER', 'REVIEWER', 'VERIFIER'] as const
export type CampaignRole = (typeof CAMPAIGN_ROLES)[number]

export const CAMPAIGN_PHASES = ['DISCOVER', 'ARCHITECT', 'PLAN', 'IMPLEMENT', 'INTEGRATE', 'TEST', 'DEBUG', 'REVIEW', 'VERIFY', 'COMPLETE'] as const
export type CampaignPhaseType = (typeof CAMPAIGN_PHASES)[number]

const CAMPAIGN_REQUEST = /\b(add|expose|implement|update)\b/i
const API_REQUEST = /\b(api|backend)\b/i
const UI_REQUEST = /\b(ui|frontend)\b/i

export type CampaignTaskStatus = 'PLANNED' | 'READY' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'BLOCKED'

export type CampaignTask = {
  id: string
  phase: CampaignPhaseType
  role: CampaignRole
  status: CampaignTaskStatus
  dependsOn: string[]
  purpose: string
  acceptance: string
  inputs: string[]
  outputs: string[]
  evidence: string[]
  workingSet: string[]
  writes: string[]
  attempt: number
  verification: 'PENDING' | 'PASS' | 'FAIL'
}

export type EngineeringCampaign = {
  missionId: string
  reasoningSessionId: string | null
  reasoningOwner: 'FRK'
  request: string
  acceptance: string[]
  phase: CampaignPhaseType
  phases: { id: string; type: CampaignPhaseType; status: CampaignTaskStatus; owner: CampaignRole }[]
  tasks: CampaignTask[]
  parallelGroups: string[][]
  serialExecution: true
  knowledge: {
    architecture: string[]
    interfaces: string[]
    decisions: string[]
    tests: string[]
    failures: string[]
  }
  writeLocks: { file: string; taskId: string }[]
  collisionCount: number
  reworkCycles: number
  blindRetryCount: number
  rawChainOfThoughtStored: number
  secondMissionTruthCount: number
  modelCalls: number
  modelDirectWrites: number
  frkDirectWrites: number
  commandsRun: number
  filesInspected: string[]
  filesMutated: string[]
  appliedEditKeys: string[]
  /** The last applied edit (file + unified diff). Only used to tell a repairer that its own edit broke the project. */
  recentEdits?: { file: string; diff: string }[]
  /** Files a repair edit was applied to without changing the failure: runtime evidence that the cause is elsewhere. Survives restart with the record. */
  ruledOut?: { file: string; layer: string; basis?: 'EDIT' | 'ISOLATED_TESTS' }[]
  /** Files where a worker proposed edits that would have changed nothing. Survives restart with the record, so a resumed mission does not start the same ineffective strategy again. */
  noEffect?: { file: string; layer: string; key: string; attempts: number }[]
  /** Passing/failing tests that were already used as alternate evidence for a file at a mutation generation, so the same diagnostic is not run twice. */
  isolationChecked?: string[]
  /** Identities of reviewer claims that already led to a rework. The same claim again, with tests green, does not start another repair. */
  reviewedClaims?: string[]
  checkpoints: string[]
  pauseAfter: string | null
  startedAt: string
  strategy: 'STALE_FIELD' | 'CONTRACT_FIELD'
  failureAttribution: string | null
  reviewFindings: string[]
  verification: string | null
  intelligence: CampaignIntelligence
  callsByRole: Partial<Record<CampaignRole, number>>
  workerReceipts: CampaignWorkerReceipt[]
  contradictions: string[]
  acceptedFacts: string[]
  workerSwitches: number
  duplicateWorkerCallCount: number
  modelCallBudget: number
  localOnly: boolean
  pin: { provider: string; model: string } | null
  repairFinding: string | null
  lastFailureSignature: string | null
  editsAtFailure: number
  mutationGeneration: number
  testReceipts: CampaignTestReceipt[]
  budgetExhausted: boolean
  repoFileCount: number
  preexistingDirty: string[]
  /** Typed progress/stagnation evidence (smart stagnation). Lives in the authoritative campaign record and survives restart. */
  progress: CampaignProgress
  componentFiles: { contract: string[]; backend: string[]; frontend: string[]; tests: string[]; database: string[] }
  /** The explicit engineering plan (goal, acceptance, dependency-ordered tasks, revisions). Optional so records written before plans existed still load. */
  plan?: EngineeringPlan | null
  /** Phase 3: how the layers were found. CONVENTION = directory names (Phase 2 fixtures); CONTEXT = goal-driven discovery. */
  contextMode?: 'CONVENTION' | 'CONTEXT'
  /** The mutated files as they were when the covering tests last passed, and what opened the current rework. A review-driven change that turns them red is put back. */
  greenSnapshot?: { generation: number; files: Record<string, string> }
  reworkOrigin?: 'TEST' | 'REVIEW'
  reverts?: number
  /** The files a review-driven rework was put back on (for engineering memory). */
  revertedFiles?: string[]
  /** The first failure of the mission, before any edit, as typed fields only (never raw output). Engineering memory is keyed on it. */
  baselineFailure?: { exception: string | null; tests: string[]; frames: string[] }
  /** Evidence trail for engineering memory: files edited in the cycle that turned failing tests green, files after whose edit the very same failure came back, and the last failure key seen. */
  memoryTrail?: { greenFiles: string[]; ineffective: string[]; lastKey: string | null; editsAtRun: number }
  /** Phase 4: what engineering memory did in this mission. The memory itself lives in the project store; this is the mission's record of using and saving it. */
  memory?: {
    status: 'FRESH' | 'SAME' | 'QUARANTINED'
    used: { id: string; kind: string; files: string[]; why: string[] }[]
    ignored: { id: string; kind: string; why: string }[]
    /** Files an earlier verified mission found unrelated to this kind of failure and the tests confirmed again now, so their first-pass edit is skipped. */
    skipped: string[]
    /** Files the earlier verified evidence points at, edited first. */
    forced: string[]
    notes: string[]
    saved: string[]
    savedAt?: string
    revalidated?: { id: string; from: string; to: string; why: string }[]
    told?: string[]
  }
  /** The working set, why each file is in it, the symbols, linked tests, changed files, refreshes and expansions. Survives restart with the record. */
  context?: ProjectContext
}

export function campaignShouldOwn(request: string): boolean {
  return CAMPAIGN_REQUEST.test(request) && API_REQUEST.test(request) && UI_REQUEST.test(request)
}

export function emptyEngineeringCampaign(request: string, pauseAfter?: string | null): EngineeringCampaign {
  return {
    missionId: '',
    reasoningSessionId: null,
    reasoningOwner: 'FRK',
    request,
    acceptance: [request],
    phase: 'DISCOVER',
    phases: [],
    tasks: [],
    parallelGroups: [],
    serialExecution: true,
    knowledge: { architecture: [], interfaces: [], decisions: [], tests: [], failures: [] },
    writeLocks: [],
    collisionCount: 0,
    reworkCycles: 0,
    blindRetryCount: 0,
    rawChainOfThoughtStored: 0,
    secondMissionTruthCount: 0,
    modelCalls: 0,
    modelDirectWrites: 0,
    frkDirectWrites: 0,
    commandsRun: 0,
    filesInspected: [],
    filesMutated: [],
    appliedEditKeys: [],
    checkpoints: [],
    pauseAfter: pauseAfter ?? null,
    startedAt: new Date().toISOString(),
    strategy: 'STALE_FIELD',
    failureAttribution: null,
    reviewFindings: [],
    verification: null,
    intelligence: 'control',
    callsByRole: {},
    workerReceipts: [],
    contradictions: [],
    acceptedFacts: [],
    workerSwitches: 0,
    duplicateWorkerCallCount: 0,
    modelCallBudget: MAX_MODEL_CALLS_PER_CAMPAIGN,
    localOnly: false,
    pin: null,
    repairFinding: null,
    lastFailureSignature: null,
    editsAtFailure: 0,
    mutationGeneration: 0,
    testReceipts: [],
    budgetExhausted: false,
    repoFileCount: 0,
    preexistingDirty: [],
    progress: emptyCampaignProgress(),
    componentFiles: { contract: [], backend: [], frontend: [], tests: [], database: [] },
  }
}

export function classifyCampaignFiles(names: readonly string[]): EngineeringCampaign['componentFiles'] {
  const take = (pattern: RegExp) => names.filter(name => pattern.test(name) && !name.startsWith('archive/') && !name.endsWith('/__init__.py') && name !== '__init__.py').slice(0, 8)
  return {
    contract: take(/(^|\/)(shared|contract|types)\//),
    backend: take(/(^|\/)(backend|api|server)\//),
    frontend: take(/(^|\/)(frontend|ui|client)\//),
    tests: take(/(^|\/)tests\/.*test_.*\.py$|\/test_.*\.py$/),
    database: take(/(^|\/)(schema|migrations)\//),
  }
}

export type CampaignTestReceipt = {
  testedMutationGeneration: number
  command: string
  exitCode: number | null
  startedAt: string
  completedAt: string | null
  /** PASSED_SCOPED: the runner exited non-zero, but every failure was proven unrelated to the request (see foundryGoalAnchor). The exit code stays as the runner reported it. */
  result: 'NOT_RUN' | 'RUNNING' | 'RUNNING_INTERRUPTED' | 'FAILED' | 'PASSED' | 'PASSED_SCOPED'
  /** Unrelated failures left as found when result is PASSED_SCOPED. */
  deferredFailures?: number
}

export function verificationBarrierSatisfied(campaign: {
  mutationGeneration: number
  testReceipts?: CampaignTestReceipt[]
  tasks: readonly { id: string; role: string; status: string }[]
}): boolean {
  const latest = [...(campaign.testReceipts ?? [])].reverse().find(item => item.command.includes('unittest'))
  if (!latest) return false
  const passedClean = latest.result === 'PASSED' && latest.exitCode === 0
  const passedScoped = latest.result === 'PASSED_SCOPED' && (latest.deferredFailures ?? 0) > 0
  if (!passedClean && !passedScoped) return false
  if (latest.testedMutationGeneration !== campaign.mutationGeneration) return false
  if (campaign.tasks.some(task => task.role === 'DEBUGGER' && task.status !== 'COMPLETE')) return false
  return true
}

export function recordTestStart(campaign: { mutationGeneration: number; testReceipts: CampaignTestReceipt[] }, command: string, startedAt: string): void {
  campaign.testReceipts.push({
    testedMutationGeneration: campaign.mutationGeneration,
    command,
    exitCode: null,
    startedAt,
    completedAt: null,
    result: 'RUNNING',
  })
}

export function recordTestFinish(campaign: { testReceipts: CampaignTestReceipt[] }, exitCode: number, completedAt: string, scoped?: { deferred: number }): void {
  const latest = [...campaign.testReceipts].reverse().find(item => item.result === 'RUNNING')
  if (!latest) return
  latest.exitCode = exitCode
  latest.completedAt = completedAt
  latest.result = exitCode === 0 ? 'PASSED' : scoped && scoped.deferred > 0 ? 'PASSED_SCOPED' : 'FAILED'
  if (exitCode !== 0 && scoped && scoped.deferred > 0) latest.deferredFailures = scoped.deferred
}

export function interruptRunningTest(campaign: { testReceipts?: CampaignTestReceipt[] }): void {
  for (const item of campaign.testReceipts ?? []) {
    if (item.result === 'RUNNING') item.result = 'RUNNING_INTERRUPTED'
  }
}

export function restoreInterruptedCampaignTasks(state: {
  tasks: CampaignTask[]
  workerReceipts?: CampaignWorkerReceipt[]
  testReceipts?: CampaignTestReceipt[]
}): void {
  interruptRunningTest(state)
  for (const task of state.tasks) {
    if (task.status !== 'RUNNING') continue
    if (task.id === 'integrate' || task.id === 'verify') {
      task.status = 'READY'
      task.verification = 'PENDING'
      if (task.attempt > 0) task.attempt -= 1
      continue
    }
    const receipt = (state.workerReceipts ?? []).find(item => item.taskId === task.id && item.attempt === task.attempt && !item.failureClass)
    if (receipt) {
      task.status = 'COMPLETE'
      task.verification = 'PASS'
      task.evidence.push('specialist receipt already stored')
      task.outputs.push('specialist receipt already stored')
    } else {
      task.status = 'READY'
      if (task.attempt > 0) task.attempt -= 1
    }
  }
}

export function readyCampaignTasks(tasks: readonly CampaignTask[]): CampaignTask[] {
  const done = new Set(tasks.filter(task => task.status === 'COMPLETE').map(task => task.id))
  return tasks.filter(task => (task.status === 'PLANNED' || task.status === 'READY') && task.dependsOn.every(id => done.has(id)))
}

export function claimWriteLock(locks: { file: string; taskId: string }[], file: string, taskId: string): { ok: boolean; collision: boolean } {
  const held = locks.find(lock => lock.file === file)
  if (!held) return { ok: true, collision: false }
  if (held.taskId === taskId) return { ok: true, collision: false }
  return { ok: false, collision: false }
}

function task(id: string, phase: CampaignPhaseType, role: CampaignRole, dependsOn: string[], purpose: string, acceptance: string, workingSet: string[]): CampaignTask {
  return {
    id,
    phase,
    role,
    status: dependsOn.length ? 'PLANNED' : 'READY',
    dependsOn,
    purpose,
    acceptance,
    inputs: [...dependsOn],
    outputs: [],
    evidence: [],
    workingSet,
    writes: [],
    attempt: 0,
    verification: 'PENDING',
  }
}

export function buildCampaignPlan(components: EngineeringCampaign['componentFiles'], request: string, contextDriven = false): { tasks: CampaignTask[]; parallelGroups: string[][] } {
  // A context-driven plan is worded from the request, not from the status-filter fixture the layered plan was first written for.
  const goal = request.replace(/\s+/g, ' ').trim().slice(0, 220)
  const tasks: CampaignTask[] = [
    task('discover', 'DISCOVER', 'ARCHITECT', [], 'Map the repository structure.', 'Components are named from paths, not from a guessed layout.', []),
    task('architect', 'ARCHITECT', 'ARCHITECT', ['discover'], 'Identify backend, frontend, and contract files.', 'At least three component kinds are evidenced.', [
      ...components.contract, ...components.backend, ...components.frontend, ...components.tests,
    ]),
  ]
  const implement: CampaignTask[] = []
  if (components.contract.length) implement.push(task('contract', 'IMPLEMENT', 'ARCHITECT', ['architect'], contextDriven ? 'Read the shared code the change depends on.' : 'Read the shared contract.', contextDriven ? 'The shared code is read before implementation edits.' : 'The contract field is recorded before implementation edits.', components.contract))
  if (components.backend.length) implement.push(task('backend', 'IMPLEMENT', 'BACKEND', ['architect'], contextDriven ? `Make the requested change in the code that owns it: ${goal}` : 'Filter the API by the evidenced field.', contextDriven ? 'The requested behavior works in this code.' : 'The API uses the accepted field.', components.backend))
  if (components.frontend.length) implement.push(task('frontend', 'IMPLEMENT', 'FRONTEND', ['architect'], contextDriven ? `Update the code that uses it so it works with the change, only if it needs to: ${goal}` : 'Pass the filter through the UI.', contextDriven ? 'The code that uses the change still works with it.' : 'The UI forwards the filter argument.', components.frontend))
  if (components.database.length) implement.push(task('database', 'IMPLEMENT', 'DATABASE', ['architect'], 'Record the data contract. Do not apply a schema migration.', 'No database mutation.', components.database))
  tasks.push(...implement)
  const implementIds = implement.map(item => item.id)
  tasks.push(
    task('integrate', 'INTEGRATE', 'TEST', implementIds, contextDriven ? 'Run the tests that cover the changed code.' : 'Run the tests that import the wired components.', contextDriven ? 'The covering tests pass.' : 'Backend and UI results agree.', components.tests),
    task('review', 'REVIEW', 'REVIEWER', ['integrate'], 'Check contract, scope, and unintended edits.', 'Review findings are empty or repaired.', []),
    task('verify', 'VERIFY', 'VERIFIER', ['review'], 'Re-run tests from disk truth.', contextDriven ? 'The requested change works and the tests pass.' : 'The requested filter works through API and UI.', components.tests),
  )
  const parallel = implementIds.filter(id => id === 'backend' || id === 'frontend')
  return { tasks, parallelGroups: parallel.length > 1 ? [parallel] : [] }
}

export function phaseProgress(tasks: readonly CampaignTask[]): { done: number; total: number; label: string } {
  const types = [...new Set(tasks.map(item => item.phase))]
  const done = types.filter(type => tasks.filter(item => item.phase === type).every(item => item.status === 'COMPLETE')).length
  return { done, total: types.length, label: `${done} / ${types.length} phases complete` }
}

function dataKeys(tests: readonly string[]): string[] {
  const keys = new Set<string>()
  for (const source of tests) {
    for (const hit of source.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/g)) keys.add(hit[1])
  }
  return [...keys].filter(key => key !== 'name' && key !== 'id' && key !== 'title').sort()
}

function contractField(sources: readonly string[]): string | null {
  for (const source of sources) {
    const hit = /FILTER_FIELD\s*=\s*["']([^"']+)["']/.exec(source)
    if (hit) return hit[1]
  }
  return null
}

function filterKey(strategy: EngineeringCampaign['strategy'], keys: string[], field: string | null): string {
  if (strategy === 'CONTRACT_FIELD') return field ?? keys.find(key => key === 'status') ?? keys[0] ?? 'status'
  if (field && keys.length <= 1) return field
  return keys[0] ?? field ?? 'status'
}

function replaceReturn(source: string, key: string, param: string): { start: number; end: number; line: string } | null {
  const signature = new RegExp(`def \\w+\\([^)]*\\b${param}\\b[^)]*\\):`)
  const found = signature.exec(source)
  if (!found) return null
  const bodyStart = found.index + found[0].length
  const nextDef = source.indexOf('\ndef ', bodyStart)
  const body = source.slice(bodyStart, nextDef === -1 ? source.length : nextDef)
  if (new RegExp(`\\b${param}\\b`).test(body)) return null
  const ret = /\n([ \t]+)return list\((\w+)\)/.exec(source.slice(bodyStart))
  if (!ret) return null
  const indent = ret[1]
  const variable = ret[2]
  const start = bodyStart + ret.index + 1
  const end = start + ret[0].length - 1
  const line = `${indent}selected = [item for item in ${variable} if item.get("${key}") == ${param}] if ${param} is not None else list(${variable})\n${indent}return selected`
  return { start, end, line }
}

export function campaignEdit(input: {
  role: 'BACKEND' | 'FRONTEND'
  file: string
  source: string
  strategy: EngineeringCampaign['strategy']
  tests: readonly string[]
  contracts: readonly string[]
}): PlannedEdit | null {
  const keys = dataKeys(input.tests)
  const field = contractField(input.contracts)
  const key = filterKey(input.strategy, keys, field)
  if (input.role === 'BACKEND') {
    const stale = /\.get\("([^"]+)"\)/.exec(input.source)
    if (stale && stale[1] !== key && input.source.split(`.get("${stale[1]}")`).length === 2) {
      const token = `.get("${stale[1]}")`
      const start = input.source.indexOf(token)
      return {
        file: input.file,
        before: input.source,
        after: input.source.slice(0, start) + `.get("${key}")` + input.source.slice(start + token.length),
        start,
        end: start + token.length,
        reason: `Filter key ${stale[1]} disagreed with the contract field ${key}.`,
      }
    }
    const span = replaceReturn(input.source, key, 'status')
    if (!span) return null
    return {
      file: input.file,
      before: input.source,
      after: input.source.slice(0, span.start) + span.line + input.source.slice(span.end),
      start: span.start,
      end: span.end,
      reason: `API filter uses ${key}.`,
    }
  }
  const imported = /from\s+\S*(?:backend|api|server)\S*\s+import\s+(\w+)/.exec(input.source)
  if (!imported) return null
  const call = new RegExp(`${imported[1]}\\(([^)\\n]+)\\)`)
  const found = call.exec(input.source)
  if (!found || found[1].includes('status')) return null
  const start = found.index
  const end = start + found[0].length
  const next = `${imported[1]}(${found[1]}, status=status)`
  return {
    file: input.file,
    before: input.source,
    after: input.source.slice(0, start) + next + input.source.slice(end),
    start,
    end,
    reason: 'UI forwards the status filter into the API.',
  }
}

export function reviewCampaign(input: { backend: string; frontend: string; contracts: readonly string[]; mutated: readonly string[]; dirty: readonly string[] }): string[] {
  const findings: string[] = []
  const field = contractField(input.contracts)
  if (field && !backendUsesField(input.backend, field) && !input.backend.includes(`["${field}"]`)) findings.push(`API filter does not use contract field ${field}.`)
  if (!/status\s*=\s*status/.test(input.frontend)) findings.push('UI does not forward the filter.')
  if (input.mutated.some(file => file.startsWith('archive/'))) findings.push('Archive file was mutated.')
  if (input.mutated.some(file => input.dirty.includes(file))) findings.push('Preexisting dirty file was mutated.')
  return findings
}

export function attributeFailure(strategy: EngineeringCampaign['strategy'], passed: boolean): string | null {
  if (passed) return null
  return strategy === 'STALE_FIELD' ? 'implementation: filter key did not match the contract' : 'unknown'
}

export function specialistActivity(role: CampaignRole): string {
  switch (role) {
    case 'ARCHITECT': return 'ARCHITECT — analyzing'
    case 'BACKEND': return 'BACKEND — implementing'
    case 'FRONTEND': return 'FRONTEND — implementing'
    case 'DATABASE': return 'DATABASE — recording'
    case 'TEST': return 'TEST — verifying'
    case 'DEBUGGER': return 'DEBUGGER — diagnosing'
    case 'REVIEWER': return 'REVIEWER — reviewing'
    case 'VERIFIER': return 'VERIFIER — verifying'
  }
}

export function resolveInterfaceContradiction(claim: string, diskFact: string): { contradiction: string; decision: string } | null {
  const left = claim.trim()
  const right = diskFact.trim()
  if (!left || !right || left === right) return null
  return {
    contradiction: `Architect named ${left}. Disk evidence shows ${right}.`,
    decision: `Contradiction recorded. Disk evidence ${right} is the interface. The architect claim ${left} is not accepted.`,
  }
}

export function contractFieldName(sources: readonly string[]): string | null {
  for (const source of sources) {
    const hit = /FILTER_FIELD\s*=\s*["']([^"']+)["']/.exec(source)
      ?? /STATUS_QUERY\s*=\s*["']([^"']+)["']/.exec(source)
    if (hit) return hit[1]
  }
  return null
}

const PYTHON_BUILTINS = new Set([
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'filter', 'float', 'int', 'isinstance',
  'len', 'list', 'max', 'min', 'next', 'open', 'print', 'range', 'set', 'sorted', 'str',
  'sum', 'super', 'tuple', 'type', 'zip', 'getattr', 'setattr', 'hasattr', 'property',
])

export function pythonLooksUnparseable(source: string): boolean {
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const stack: string[] = []
  let quote: string | null = null
  let triple = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next3 = source.slice(i, i + 3)
    if (quote) {
      if (triple) {
        if (next3 === quote) {
          quote = null
          triple = false
          i += 2
        }
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (next3 === '"""' || next3 === "'''") {
      quote = next3
      triple = true
      i += 2
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') stack.push(closing[ch])
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return true
    }
  }
  if (stack.length > 0) return true
  if (/def\s+\w+\s*\([^)]*\)\s*:\s*[\]\}]/.test(source)) return true
  return false
}

export function pythonNameBound(source: string, name: string): boolean {
  return new RegExp(
    String.raw`(?:^|[\n;])\s*(?:from\s+\S+\s+import\s+[^\n]*\b${name}\b|import\s+${name}\b|def\s+${name}\s*\(|class\s+${name}\b|${name}\s*=)`,
    'm',
  ).test(source)
}

export function sourceUsesUnboundName(source: string): boolean {
  if (pythonLooksUnparseable(source)) return true
  if (!/\bdef\s+\w+/.test(source)) return true
  for (const hit of source.matchAll(/(^|[^.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = hit[2]
    if (PYTHON_BUILTINS.has(name)) continue
    if (!pythonNameBound(source, name)) return true
  }
  if (/\bITEMS\b/.test(source) && !/\bITEMS\s*=/.test(source)) return true
  return false
}

export function failureSignature(finding: string): string {
  const line = finding.split('\n').map(item => item.trim()).find(item => /^(NameError|TypeError|KeyError|AssertionError|ImportError|AttributeError|SyntaxError)\b/.test(item))
    ?? finding.split('\n').map(item => item.trim()).find(item => /Error:/.test(item) && !/^ERROR:\s/.test(item))
    ?? finding
  return line.replace(/\s+/g, ' ').trim().slice(0, 180)
}

export function reworkImplementationIds(finding: string): string[] {
  const backend = /backend\/|\bapi\.py\b|NameError|list_items/i.test(finding)
  const frontend = /frontend\/|\bboard\.py\b|\bUI\b|forward/i.test(finding)
  if (backend && frontend) return ['backend', 'frontend']
  if (frontend) return ['frontend']
  if (backend) return ['backend']
  return ['backend']
}

export function stalledSameFailure(input: { finding: string; lastSignature: string | null; appliedEdits: number; editsAtFailure: number }): boolean {
  const signature = failureSignature(input.finding)
  return Boolean(input.lastSignature) && signature === input.lastSignature && input.appliedEdits === input.editsAtFailure
}

/**
 * origin REVIEW: a reviewer's sentence is a claim, not evidence. A claim that a name is undefined only reopens the code when the source
 * really uses an unbound name (checked above); otherwise passing tests and a clean source outweigh the sentence.
 */
/** A backend that special-cases "open" and never handles "closed" or a general status comparison. One that also handles the rest is not open-only. */
export function isOpenOnly(source: string): boolean {
  return /if status == ["']open["']/.test(source) && !/["']closed["']/.test(source) && !/\w+\.get\([^)]*\)\s*==\s*status\b/.test(source)
}

export function implementationNeedsEdit(role: 'BACKEND' | 'FRONTEND', source: string, contract: string, repairFinding: string | null, origin: 'TEST' | 'REVIEW' = 'TEST'): boolean {
  const field = contractFieldName([contract]) ?? 'status'
  const forwards = /status\s*=\s*status/.test(source)
  const openOnly = isOpenOnly(source)
  const missingSymbol = origin === 'TEST' && /NameError|not defined|not imported|ImportError|SyntaxError|parenthesis|invalid syntax/i.test(repairFinding ?? '')
  const appliesItemFilter = /normalize_status\(item\.get\(/.test(source) || new RegExp(`item\\.get\\(["']${field}["'](?:\\s*,[^()]*)?\\)\\s*==`).test(source)
  const hasUnfiltered = /return list\(/.test(source)
  const broken = sourceUsesUnboundName(source)
  if (broken) return true
  if (!repairFinding) {
    if (role === 'BACKEND') return !appliesItemFilter || !hasUnfiltered
    return !forwards && !appliesItemFilter
  }
  const mentionsUi = /ui|frontend|forward|board/i.test(repairFinding)
  const mentionsApi = /closed|api|backend|filter|partial|acceptance|contract|NameError|normalize_status|list_items/i.test(repairFinding)
  if (role === 'FRONTEND') return (mentionsUi && !forwards && !appliesItemFilter) || (missingSymbol && /frontend|board/i.test(repairFinding))
  if (missingSymbol || !appliesItemFilter || !hasUnfiltered) return true
  return mentionsApi && (openOnly || missingSymbol)
}

export function reviewerFoundGap(summary: string): boolean {
  return /STATUS fail|unmet|not implemented|does not|doesn't|missing/i.test(summary)
}

export function campaignCompletionAllowed(input: {
  verification: string
  testsPassed: boolean
  reviewClear: boolean
  unresolvedFailure: boolean
}): boolean {
  return input.verification === 'PROJECT_READY'
    && input.testsPassed
    && input.reviewClear
    && !input.unresolvedFailure
}

/** True when the backend reads the contract field from each item. A default argument (`.get("status", "")`) is still the same read. */
export function backendUsesField(backend: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\.get\\(\\s*["']${escaped}["']\\s*[,)]`).test(backend)
}

export function diskMeetsContract(contract: string, backend: string, frontend: string): boolean {
  const field = contractFieldName([contract])
  const usesField = !field
    || backendUsesField(backend, field)
    || backend.includes(`["${field}"]`)
    || backend.includes(`['${field}']`)
    || backend.includes('FILTER_FIELD')
  if (!usesField) return false
  if (/forwards status/i.test(contract) && !/status\s*=\s*status/.test(frontend)) return false
  if (/closed returns only closed/i.test(contract) && isOpenOnly(backend)) return false
  return true
}

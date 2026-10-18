/**
 * Deterministic replan + stagnation engine for the existing Command Center DAG.
 * Model proposals are advisory. Foundry validates contract, approval, write scope,
 * traceability, and graph consistency before applying.
 */
import { randomUUID } from 'node:crypto'
import type { FoundryAgentRole, FoundryCommandCenterGraph, FoundryTaskRecord } from './foundryAgentTypes'
import { FOUNDRY_AGENT_ROLES, isFoundryAgentRole } from './foundryAgentTypes'
import type { FoundryAcceptanceContract, FoundryMissionContract } from './foundryContractTypes'
import { foundryContentHash } from './foundryContractHash'
import { haltGraphForReapproval } from './foundryExecutionApproval'
import { promoteReady } from './foundryTaskGraph'
import {
  FOUNDRY_REPLAN_SCHEMA_VERSION,
  FOUNDRY_STAGNATION_THRESHOLDS as T,
  type FoundryActionObservation,
  type FoundryReplanBudgets,
  type FoundryReplanFailureClass,
  type FoundryReplanNewTask,
  type FoundryReplanRecord,
  type FoundryReplanStatus,
  type FoundryStagnationReport,
  type FoundryStructuredReplanProposal,
} from './foundryReplanTypes'
import { appendContractEvent, saveReplanRecord } from './foundryContractStore'
import { authorizeResourceAction, completeResourceUsage, beginResourceUsage, stagnationShouldBlockForBudget } from './foundryResourceGovernor'

export function planHashMaterial(graph: Pick<FoundryCommandCenterGraph, 'tasks'>): unknown {
  return {
    tasks: [...graph.tasks]
      .map(task => ({
        taskId: task.taskId,
        title: task.title,
        role: task.role,
        dependsOn: [...task.dependsOn].sort(),
        writeSet: [...task.writeSet].sort(),
        requirementIds: [...task.requirementIds].sort(),
        criterionIds: [...(task.criterionIds ?? [])].sort(),
        mutating: task.mutating,
        historical: task.status === 'COMPLETE' || task.status === 'CANCELLED' || task.status === 'SUPERSEDED' ? task.status : 'PENDING',
        replacesTaskId: task.replacedTaskId ?? null,
      }))
      .sort((a, b) => a.taskId.localeCompare(b.taskId)),
  }
}

export function hashCommandCenterPlan(graph: Pick<FoundryCommandCenterGraph, 'tasks'>): string {
  return foundryContentHash(planHashMaterial(graph))
}

export function actionFingerprint(input: {
  tool?: string
  args?: unknown
  result?: string
  error?: string
  tests?: string
}): string {
  return foundryContentHash({
    tool: input.tool ?? '',
    args: input.args ?? null,
    result: String(input.result ?? '').slice(0, 240),
    error: String(input.error ?? '').slice(0, 240),
    tests: String(input.tests ?? '').slice(0, 240),
  })
}

export function classifyReplanFailure(input: {
  error?: string | null
  blocker?: string | null
  tests?: { ok: boolean | null; detail: string } | null
  permission?: boolean
}): FoundryReplanFailureClass {
  const blob = `${input.error ?? ''} ${input.blocker ?? ''} ${input.tests?.detail ?? ''}`.toLowerCase()
  if (input.permission || /permission|eacces|not_owner|protected subsystem|authority/.test(blob)) return 'PERMISSION'
  if (/timeout|econnreset|temporar|unavailable|429|rate limit/.test(blob)) return 'TRANSIENT'
  if (/provider|context_limit|malformed|token/.test(blob)) return 'PROVIDER_LIMIT'
  if (/missing (prereq|dependency|module)|cannot find module|enoent|prerequisite/.test(blob)) return 'DEPENDENCY_MISSING'
  if (/outdated expectation|expected .* to (equal|be)|snapshot/.test(blob) && /test/.test(blob)) return 'TEST_EXPECTATION_OUTDATED'
  if (/contract|acceptance|scope|non-goal|out of contract/.test(blob)) return 'CONTRACT_SCOPE'
  if (/enospc|spawn|uv_thread|environment|no such file/.test(blob)) return 'ENVIRONMENT'
  if (input.tests?.ok === false || /assert|implementation|bug|fail/.test(blob)) return 'IMPLEMENTATION_BUG'
  return 'UNKNOWN'
}

export function graphReplanBudgets(graph: FoundryCommandCenterGraph): FoundryReplanBudgets {
  return {
    steerCount: graph.tasks.reduce((sum, task) => sum + (task.steerCount ?? 0), 0),
    taskReplanCount: graph.taskReplanCount ?? graph.tasks.reduce((sum, task) => sum + (task.taskReplanCount ?? 0), 0),
    dagReplanCount: graph.dagReplanCount ?? 0,
    missionReplanRequestCount: graph.missionReplanRequestCount ?? 0,
  }
}

export function recordObservation(graph: FoundryCommandCenterGraph, observation: FoundryActionObservation): void {
  const window = [...(graph.actionWindow ?? []), {
    at: observation.at ?? new Date().toISOString(),
    taskId: observation.taskId,
    fingerprint: observation.fingerprint,
    ok: observation.ok,
    kind: observation.kind,
    detail: observation.detail ?? '',
  }].slice(-T.actionWindow)
  graph.actionWindow = window
  const task = graph.tasks.find(item => item.taskId === observation.taskId)
  if (!task) return
  task.lastActionFingerprint = observation.fingerprint
  if (observation.ok === false || observation.kind === 'failure' || observation.kind === 'blocked') {
    task.lastFailureFingerprint = observation.fingerprint
    return
  }
  if (observation.kind === 'progress' || observation.ok) {
    task.lastProgressAt = observation.at ?? new Date().toISOString()
    task.lastProgressFingerprint = observation.fingerprint
    graph.lastProgressAt = task.lastProgressAt
    graph.lastProgressFingerprint = observation.fingerprint
  }
}

export function progressSignals(previous: FoundryCommandCenterGraph, next: FoundryCommandCenterGraph): string[] {
  const signals: string[] = []
  const prevFiles = new Set(previous.tasks.flatMap(task => task.filesChanged))
  if (next.tasks.flatMap(task => task.filesChanged).some(file => !prevFiles.has(file))) signals.push('new_file_evidence')
  if (next.tasks.filter(task => task.tests.ok === false).length < previous.tasks.filter(task => task.tests.ok === false).length) {
    signals.push('failing_tests_decrease')
  }
  if (next.tasks.filter(task => task.tests.ok === true).length > previous.tasks.filter(task => task.tests.ok === true).length) {
    signals.push('test_count_improves')
  }
  const prevComplete = previous.tasks.filter(task => task.status === 'COMPLETE').map(task => task.taskId)
  if (next.tasks.some(task => task.status === 'COMPLETE' && !prevComplete.includes(task.taskId))) signals.push('task_completes')
  if ((next.artifacts?.length ?? 0) > (previous.artifacts?.length ?? 0)) signals.push('new_valid_artifact')
  if (next.tasks.filter(task => task.status === 'READY').length > previous.tasks.filter(task => task.status === 'READY').length) {
    signals.push('new_dependency_resolved')
  }
  return signals
}

export function detectStagnation(graph: FoundryCommandCenterGraph, taskId?: string | null): FoundryStagnationReport {
  const window = (graph.actionWindow ?? []).filter(item => !taskId || item.taskId === taskId)
  const reasons: string[] = []
  const fingerprints = window.map(item => item.fingerprint)
  const failures = window.filter(item => item.ok === false || item.kind === 'failure' || item.kind === 'blocked')
  const last = window.at(-1)
  const identicalAction = Boolean(last && fingerprints.filter(item => item === last.fingerprint).length >= T.identicalActionRepeats)
  const sameFailure = Boolean(last && last.ok === false && failures.filter(item => item.fingerprint === last.fingerprint).length >= T.sameFailureRepeats)
  const recent = window.slice(-T.noProgressAttempts)
  const noProgress = recent.length >= T.noProgressAttempts && recent.every(item => item.kind !== 'progress' && !(item.ok && item.kind === 'action'))
  const diffs = window.filter(item => item.kind === 'diff')
  const unchangedDiff = diffs.length >= T.unchangedDiffRepeats && diffs.slice(-T.unchangedDiffRepeats).every(item => item.fingerprint === diffs.at(-1)?.fingerprint)
  let oscillation = false
  if (fingerprints.length >= 4) {
    const a = fingerprints.at(-1)
    const b = fingerprints.at(-2)
    if (a && b && a !== b) {
      const pairs = fingerprints.slice(-4)
      oscillation = pairs[0] === pairs[2] && pairs[1] === pairs[3]
    }
  }
  const ready = graph.tasks.filter(task => task.status === 'READY').length
  const running = graph.tasks.filter(task => task.status === 'RUNNING').length
  const failed = graph.tasks.filter(task => task.status === 'FAILED' || Boolean(task.blocker)).length
  const frontierStalled = ready === 0 && running === 0 && failed > 0 && (graph.frontierStallCycles ?? 0) >= T.frontierStallCycles
  const task = taskId ? graph.tasks.find(item => item.taskId === taskId) : null
  const retryExhausted = Boolean(task && task.retryCount >= task.maxRetries && task.status === 'FAILED')
  if (identicalAction) reasons.push('identical tool call/fingerprint repeated')
  if (sameFailure) reasons.push('same failure fingerprint repeated')
  if (noProgress) reasons.push('no measurable progress after bounded attempts')
  if (unchangedDiff) reasons.push('repeated unchanged diff')
  if (oscillation) reasons.push('oscillation between two states')
  if (frontierStalled) reasons.push('graph frontier does not advance')
  if (retryExhausted) reasons.push('task retry exhaustion')
  const repeatActionRefused = identicalAction && sameFailure
  const score = [identicalAction, sameFailure, noProgress, unchangedDiff, oscillation, frontierStalled, retryExhausted].filter(Boolean).length
  graph.stagnationDetected = reasons.length > 0
  graph.stagnationReason = reasons[0] ?? null
  graph.stagnationScore = score
  return {
    detected: reasons.length > 0,
    reasons,
    score,
    identicalAction,
    sameFailure,
    noProgress,
    unchangedDiff,
    oscillation,
    frontierStalled,
    retryExhausted,
    lastProgressAt: graph.lastProgressAt ?? task?.lastProgressAt ?? null,
    lastProgressFingerprint: graph.lastProgressFingerprint ?? task?.lastProgressFingerprint ?? null,
    attemptCount: window.length,
    repeatActionRefused,
  }
}

export function shouldRefuseRepeatedAction(graph: FoundryCommandCenterGraph, taskId: string, fingerprint: string): boolean {
  const prior = (graph.actionWindow ?? []).filter(item => item.taskId === taskId && item.fingerprint === fingerprint && item.ok === false)
  return prior.length >= T.identicalActionRepeats
}

export function dagCycleIds(tasks: FoundryTaskRecord[]): string[] {
  const byId = new Map(tasks.map(task => [task.taskId, task]))
  const visiting = new Set<string>()
  const done = new Set<string>()
  const cyclic: string[] = []
  const visit = (id: string): boolean => {
    if (done.has(id)) return false
    if (visiting.has(id)) {
      cyclic.push(id)
      return true
    }
    visiting.add(id)
    let hit = false
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (visit(dep)) hit = true
    }
    visiting.delete(id)
    done.add(id)
    return hit
  }
  for (const task of tasks) visit(task.taskId)
  return [...new Set(cyclic)]
}

export function validateDag(tasks: FoundryTaskRecord[]): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const ids = new Set(tasks.map(task => task.taskId))
  if (ids.size !== tasks.length) errors.push('duplicate task ids')
  for (const task of tasks) {
    if (!isFoundryAgentRole(task.role)) errors.push(`invalid role ${task.role} on ${task.taskId}`)
    if (task.dependsOn.includes(task.taskId)) errors.push(`self-dependency ${task.taskId}`)
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) errors.push(`dangling dependency ${task.taskId} → ${dep}`)
    }
  }
  const cycles = dagCycleIds(tasks)
  if (cycles.length) errors.push(`cycle involving ${cycles.join(',')}`)
  return { ok: errors.length === 0, errors }
}

export function parseStructuredReplan(value: unknown): FoundryStructuredReplanProposal | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const nested = raw.REPLAN && typeof raw.REPLAN === 'object' ? raw.REPLAN as Record<string, unknown> : raw
  const level = String(nested.level ?? '')
  if (!['L0', 'L1', 'L2', 'L3', 'L4'].includes(level)) return null
  return {
    level: level as FoundryStructuredReplanProposal['level'],
    reason: String(nested.reason ?? 'structured replan'),
    failureClass: (['IMPLEMENTATION_BUG', 'TEST_EXPECTATION_OUTDATED', 'TRANSIENT', 'PROVIDER_LIMIT', 'PERMISSION', 'DEPENDENCY_MISSING', 'ENVIRONMENT', 'CONTRACT_SCOPE', 'UNKNOWN'].includes(String(nested.failureClass))
      ? String(nested.failureClass) as FoundryReplanFailureClass
      : 'UNKNOWN'),
    changedTaskIds: Array.isArray(nested.changedTasks) ? nested.changedTasks.map(String) : (Array.isArray(nested.changedTaskIds) ? nested.changedTaskIds.map(String) : []),
    newTasks: Array.isArray(nested.newTasks) ? nested.newTasks as FoundryReplanNewTask[] : [],
    removedTaskIds: Array.isArray(nested.removedTaskIds) ? nested.removedTaskIds.map(String) : [],
    dependencyChanges: Array.isArray(nested.dependencyChanges) ? nested.dependencyChanges as FoundryStructuredReplanProposal['dependencyChanges'] : [],
    expectedProgressSignal: String(nested.expectedProgressSignal ?? 'measurable progress'),
    strategy: typeof nested.strategy === 'string' ? nested.strategy : undefined,
    writeSet: Array.isArray(nested.writeSet) ? nested.writeSet.map(String) : undefined,
    expandsMission: nested.expandsMission === true,
    changesAcceptance: nested.changesAcceptance === true,
    taskId: typeof nested.taskId === 'string' ? nested.taskId : null,
  }
}

function allowedWriteSet(graph: FoundryCommandCenterGraph): Set<string> {
  return new Set(graph.tasks.flatMap(task => task.writeSet))
}

function writeScopeExpansion(graph: FoundryCommandCenterGraph, proposal: FoundryStructuredReplanProposal): string[] {
  const allowed = allowedWriteSet(graph)
  const proposed = [...(proposal.writeSet ?? []), ...proposal.newTasks.flatMap(task => task.writeSet ?? [])]
  return proposed.filter(path => {
    if (!path || allowed.has(path)) return false
    return ![...allowed].some(existing => {
      const dir = existing.includes('/') ? existing.slice(0, existing.lastIndexOf('/') + 1) : ''
      return dir && path.startsWith(dir)
    })
  })
}

function tracesFor(task: Pick<FoundryTaskRecord, 'requirementIds' | 'criterionIds'>): boolean {
  return (task.requirementIds?.length ?? 0) > 0 || (task.criterionIds?.length ?? 0) > 0
}

export function proposalCrossesContract(
  graph: FoundryCommandCenterGraph,
  proposal: FoundryStructuredReplanProposal,
  missionContract?: FoundryMissionContract | null,
): boolean {
  if (proposal.expandsMission || proposal.changesAcceptance || proposal.level === 'L3') return true
  if (writeScopeExpansion(graph, proposal).length) return true
  const blob = `${proposal.reason} ${proposal.newTasks.map(task => task.title).join(' ')}`.toLowerCase()
  const nonGoals = (missionContract?.nonGoals ?? []).map(item => item.toLowerCase())
  if (nonGoals.some(item => item && blob.includes(item))) return true
  if (/new feature|billing|unrelated product|out of scope/.test(blob)) return true
  return false
}

export function proposeDeterministicReplan(input: {
  graph: FoundryCommandCenterGraph
  taskId?: string | null
  stagnation: FoundryStagnationReport
  failureClass: FoundryReplanFailureClass
  hint?: string | null
}): FoundryStructuredReplanProposal {
  const graph = input.graph
  const task = input.taskId ? graph.tasks.find(item => item.taskId === input.taskId) : graph.tasks.find(item => item.status === 'FAILED' || item.status === 'BLOCKED')
  const budgets = graphReplanBudgets(graph)
  const base = {
    failureClass: input.failureClass,
    changedTaskIds: task ? [task.taskId] : [],
    newTasks: [] as FoundryReplanNewTask[],
    removedTaskIds: [] as string[],
    dependencyChanges: [] as FoundryStructuredReplanProposal['dependencyChanges'],
    taskId: task?.taskId ?? null,
  }
  if (budgets.dagReplanCount >= T.maxDagReplans && budgets.taskReplanCount >= T.maxTaskReplans && (task?.steerCount ?? 0) >= T.maxSteerPerTask) {
    return { ...base, level: 'L4', reason: 'Replan budgets exhausted. No remaining safe authorized path.', expectedProgressSignal: 'commander_decision' }
  }
  if (input.failureClass === 'CONTRACT_SCOPE') {
    return { ...base, level: 'L3', reason: 'Failure is outside the approved Mission Contract.', expectedProgressSignal: 'commander_reapproval', expandsMission: true }
  }
  if (input.failureClass === 'DEPENDENCY_MISSING' && task && budgets.dagReplanCount < T.maxDagReplans) {
    return {
      ...base,
      level: 'L2',
      reason: 'Missing prerequisite discovered. Insert a bounded inspect/setup task.',
      expectedProgressSignal: 'new_dependency_resolved',
      newTasks: [{
        title: `Prerequisite for ${task.title}`,
        role: 'ARCHITECT',
        dependsOn: [],
        writeSet: [],
        requirementIds: task.requirementIds.slice(0, 1),
        criterionIds: task.criterionIds ?? [],
        mutating: false,
        strategy: 'inspect-prerequisite',
      }],
      dependencyChanges: [{ taskId: task.taskId, from: [...task.dependsOn], to: [...task.dependsOn, '__NEW_0__'], reason: 'wait for missing prerequisite' }],
    }
  }
  if (task && (task.writeSet.length >= 4 || /oversized|split/i.test(input.hint ?? '')) && task.status !== 'COMPLETE' && task.status !== 'RUNNING' && budgets.dagReplanCount < T.maxDagReplans) {
    const mid = Math.max(1, Math.floor(task.writeSet.length / 2))
    return {
      ...base,
      level: 'L2',
      reason: 'Pending task is oversized. Split into two traceable tasks.',
      expectedProgressSignal: 'new_dependency_resolved',
      newTasks: [
        {
          title: `${task.title} (part A)`,
          role: task.role,
          dependsOn: [...task.dependsOn],
          writeSet: task.writeSet.slice(0, mid),
          requirementIds: task.requirementIds,
          criterionIds: task.criterionIds ?? [],
          mutating: task.mutating,
          strategy: 'split-a',
          replacesTaskId: task.taskId,
        },
        {
          title: `${task.title} (part B)`,
          role: task.role,
          dependsOn: ['__NEW_0__'],
          writeSet: task.writeSet.slice(mid),
          requirementIds: task.requirementIds,
          criterionIds: task.criterionIds ?? [],
          mutating: task.mutating,
          strategy: 'split-b',
          replacesTaskId: task.taskId,
        },
      ],
    }
  }
  if (task && (task.taskReplanCount ?? 0) < T.maxTaskReplans && (input.stagnation.sameFailure || (task.retryCount ?? 0) >= 2)) {
    return {
      ...base,
      level: 'L1',
      reason: 'Implementation approach failed repeatedly. Change strategy inside the same task objective.',
      expectedProgressSignal: 'different_failure_fingerprint',
      strategy: `alternate-approach-${(task.taskReplanCount ?? 0) + 1}`,
    }
  }
  if (task && (task.steerCount ?? 0) < T.maxSteerPerTask) {
    return {
      ...base,
      level: 'L0',
      reason: input.stagnation.repeatActionRefused
        ? 'REPEAT_ACTION_REFUSED: identical failed action will not be repeated. Steer to another allowed inspection path.'
        : 'Local steer: use a different allowed tool or diagnostic query.',
      expectedProgressSignal: 'new_file_evidence',
      strategy: 'alternate-read-path',
    }
  }
  if (budgets.dagReplanCount < T.maxDagReplans && task) {
    return {
      ...base,
      level: 'L2',
      reason: 'Local/task replan budget consumed. Insert a verification follow-up without rewriting COMPLETE history.',
      expectedProgressSignal: 'new_valid_artifact',
      newTasks: [{
        title: `Rework after ${task.title}`,
        role: task.role === 'TEST' ? 'DEBUGGER' : 'TEST',
        dependsOn: task.status === 'COMPLETE' ? [task.taskId] : task.dependsOn,
        writeSet: [],
        requirementIds: task.requirementIds,
        criterionIds: task.criterionIds ?? [],
        mutating: false,
        strategy: 'follow-up-verify',
      }],
    }
  }
  return { ...base, level: 'L4', reason: 'No safe authorized alternative remains.', expectedProgressSignal: 'commander_decision' }
}

export function validateReplanProposal(input: {
  graph: FoundryCommandCenterGraph
  proposal: FoundryStructuredReplanProposal
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
}): { ok: boolean; status: FoundryReplanStatus; errors: string[]; untraceable: number; cycle: boolean; outOfContract: boolean } {
  const proposal = input.proposal
  if (proposal.level === 'L3' || proposalCrossesContract(input.graph, proposal, input.missionContract)) {
    return { ok: false, status: 'REAPPROVAL_REQUIRED', errors: ['OUT_OF_CONTRACT_REPLAN'], untraceable: 0, cycle: false, outOfContract: true }
  }
  if (proposal.level === 'L4') {
    return { ok: false, status: 'BLOCKED', errors: [proposal.reason], untraceable: 0, cycle: false, outOfContract: false }
  }
  const errors: string[] = []
  const untraceable = proposal.newTasks.filter(task => !tracesFor({ requirementIds: task.requirementIds ?? [], criterionIds: task.criterionIds ?? [] })).length
  if (untraceable) errors.push('UNTRACEABLE_REPLAN_TASK')
  const preview = previewGraph(input.graph, proposal)
  const dag = validateDag(preview.tasks)
  if (!dag.ok) errors.push(...dag.errors)
  const cycle = dag.errors.some(item => item.startsWith('cycle'))
  if (proposal.level === 'L2') {
    for (const id of proposal.changedTaskIds) {
      const existing = input.graph.tasks.find(task => task.taskId === id)
      if (existing?.status === 'COMPLETE' && proposal.newTasks.some(task => task.replacesTaskId === id)) errors.push('COMPLETE_TASK_REWRITE')
      if (existing?.status === 'RUNNING' && (proposal.removedTaskIds.includes(id) || proposal.newTasks.some(task => task.replacesTaskId === id))) {
        errors.push('RUNNING_TASK_REWRITE')
      }
    }
  }
  if (errors.length) return { ok: false, status: 'REFUSED', errors, untraceable, cycle, outOfContract: false }
  return { ok: true, status: 'PROPOSED', errors: [], untraceable: 0, cycle: false, outOfContract: false }
}

function nextTaskId(graph: FoundryCommandCenterGraph, extra = 0): string {
  const nums = graph.tasks.map(task => Number.parseInt(task.taskId.replace(/\D/g, ''), 10)).filter(n => Number.isFinite(n))
  return `TASK-${String((nums.length ? Math.max(...nums) : 0) + 1 + extra).padStart(3, '0')}`
}

function cloneTasks(graph: FoundryCommandCenterGraph): FoundryTaskRecord[] {
  return graph.tasks.map(task => ({
    ...task,
    dependsOn: [...task.dependsOn],
    writeSet: [...task.writeSet],
    requirementIds: [...task.requirementIds],
    criterionIds: [...(task.criterionIds ?? [])],
    filesChanged: [...task.filesChanged],
    guidance: [...task.guidance],
    repairHistory: [...task.repairHistory],
  }))
}

function previewGraph(graph: FoundryCommandCenterGraph, proposal: FoundryStructuredReplanProposal): FoundryCommandCenterGraph {
  const tasks = cloneTasks(graph)
  const addedIds: string[] = []
  proposal.newTasks.forEach((seed, index) => {
    const taskId = nextTaskId(graph, index)
    addedIds.push(taskId)
    const dependsOn = (seed.dependsOn ?? []).map(id => id === '__NEW_0__' ? addedIds[0] : id === '__NEW_1__' ? addedIds[1] : id)
    tasks.push({
      taskId,
      title: seed.title,
      projectId: graph.projectId,
      projectName: graph.projectName,
      missionId: graph.missionId,
      graphId: graph.graphId,
      role: (FOUNDRY_AGENT_ROLES as readonly string[]).includes(seed.role) ? seed.role as FoundryAgentRole : 'ARCHITECT',
      status: dependsOn.length ? 'QUEUED' : 'READY',
      priority: 'NORMAL',
      workspaceId: null,
      agentId: null,
      dependsOn,
      startedAt: null,
      currentPhase: 'queued',
      latestAction: `Replan ${proposal.level}: ${proposal.reason}`,
      tests: { ok: null, detail: '' },
      result: '',
      blocker: null,
      specId: graph.specId,
      specVersion: graph.specVersion,
      requirementIds: seed.requirementIds ?? [],
      filesChanged: [],
      guidance: seed.strategy ? [seed.strategy] : [],
      repairHistory: [],
      retryCount: 0,
      maxRetries: 2,
      mutating: seed.mutating ?? false,
      writeSet: seed.writeSet ?? [],
      modelRouting: null,
      missionContractId: graph.missionContractId,
      acceptanceContractId: graph.acceptanceContractId,
      strategy: seed.strategy ?? null,
      criterionIds: seed.criterionIds ?? [],
      replacedTaskId: seed.replacesTaskId ?? null,
      steerCount: 0,
      taskReplanCount: 0,
    })
  })
  for (const change of proposal.dependencyChanges) {
    const task = tasks.find(item => item.taskId === change.taskId)
    if (!task || task.status === 'COMPLETE' || task.status === 'RUNNING') continue
    task.dependsOn = change.to.map(id => id === '__NEW_0__' ? addedIds[0] : id === '__NEW_1__' ? addedIds[1] : id)
    if (task.status !== 'CANCELLED' && task.status !== 'SUPERSEDED') {
      task.status = task.dependsOn.length ? 'QUEUED' : 'READY'
      task.blocker = null
    }
    task.latestAction = change.reason
  }
  const replacementsByPrior = new Map<string, string[]>()
  proposal.newTasks.forEach((seed, index) => {
    if (!seed.replacesTaskId) return
    const nextId = addedIds[index]
    replacementsByPrior.set(seed.replacesTaskId, [...(replacementsByPrior.get(seed.replacesTaskId) ?? []), nextId])
  })
  for (const [priorId, replacements] of replacementsByPrior) {
    const previous = tasks.find(item => item.taskId === priorId)
    if (!previous || previous.status === 'COMPLETE' || previous.status === 'RUNNING') continue
    if (previous.status !== 'FAILED' && previous.status !== 'CANCELLED') previous.status = 'SUPERSEDED'
    previous.latestAction = 'Replaced by split/follow-up tasks. Historical row preserved.'
    for (const dependent of tasks) {
      if (dependent.taskId === priorId || replacements.includes(dependent.taskId)) continue
      if (dependent.status === 'COMPLETE' || dependent.status === 'RUNNING') continue
      if (!dependent.dependsOn.includes(priorId)) continue
      dependent.dependsOn = [...new Set([...dependent.dependsOn.filter(id => id !== priorId), ...replacements])]
      dependent.status = 'QUEUED'
      dependent.latestAction = `Dependent re-evaluated: prerequisite ${priorId} replaced by ${replacements.join(',')}.`
    }
  }
  return { ...graph, tasks }
}

function emit(missionId: string, type: Parameters<typeof appendContractEvent>[1], text: string, metadata?: Record<string, string | number | boolean | null>) {
  appendContractEvent(missionId, type, text, null, metadata)
}

function persistRecord(record: FoundryReplanRecord): FoundryReplanRecord {
  saveReplanRecord(record)
  const eventType = record.status === 'APPLIED' ? 'REPLAN_APPLIED'
    : record.status === 'REAPPROVAL_REQUIRED' ? 'REPLAN_REAPPROVAL_REQUIRED'
      : record.status === 'BLOCKED' ? 'MISSION_BLOCKED_STAGNATION'
        : record.status === 'REFUSED' ? 'REPLAN_REFUSED'
          : 'REPLAN_PROPOSED'
  emit(record.missionId, eventType, `${record.level} ${record.status}: ${record.reason}`, {
    replanId: record.replanId,
    level: record.level,
    graphId: record.graphId,
  })
  if (record.status === 'APPLIED' && record.level === 'L1') emit(record.missionId, 'TASK_PLAN_REPLACED', record.reason, { replanId: record.replanId })
  if (record.status === 'APPLIED' && record.level === 'L2') emit(record.missionId, 'DAG_REWIRED', record.reason, { replanId: record.replanId })
  return record
}

export function applyReplan(input: {
  graph: FoundryCommandCenterGraph
  proposal: FoundryStructuredReplanProposal
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
}): { graph: FoundryCommandCenterGraph; record: FoundryReplanRecord; applied: boolean } {
  const graph = input.graph
  const previousPlanHash = hashCommandCenterPlan(graph)
  const validation = validateReplanProposal(input)
  const createdAt = new Date().toISOString()
  const baseRecord = (status: FoundryReplanStatus, proposedPlanHash: string, extra?: Partial<FoundryReplanRecord>): FoundryReplanRecord => persistRecord({
    schemaVersion: FOUNDRY_REPLAN_SCHEMA_VERSION,
    replanId: `RP-${randomUUID()}`,
    missionId: graph.missionId,
    graphId: graph.graphId,
    taskId: input.proposal.taskId ?? null,
    level: input.proposal.level,
    reason: input.proposal.reason,
    failureClass: input.proposal.failureClass,
    previousPlanHash,
    proposedPlanHash,
    changedTaskIds: input.proposal.changedTaskIds,
    addedTaskIds: extra?.addedTaskIds ?? [],
    removedTaskIds: input.proposal.removedTaskIds,
    dependencyChanges: input.proposal.dependencyChanges,
    contractGeneration: graph.missionContractHash ?? null,
    approvalId: graph.approvalId ?? null,
    createdAt,
    status,
    expectedProgressSignal: input.proposal.expectedProgressSignal,
  })

  if (validation.outOfContract) {
    graph.missionReplanRequestCount = (graph.missionReplanRequestCount ?? 0) + 1
    haltGraphForReapproval(graph, `REAPPROVAL_REQUIRED: ${input.proposal.reason}`)
    const record = baseRecord('REAPPROVAL_REQUIRED', previousPlanHash)
    graph.lastReplan = { level: 'L3', reason: input.proposal.reason, status: 'REAPPROVAL_REQUIRED', attemptCount: graph.missionReplanRequestCount }
    return { graph, record, applied: false }
  }
  if (!validation.ok) {
    const status: FoundryReplanStatus = input.proposal.level === 'L4' || validation.status === 'BLOCKED' ? 'BLOCKED' : 'REFUSED'
    if (status === 'BLOCKED') {
      graph.status = 'BLOCKED'
      const task = input.proposal.taskId ? graph.tasks.find(item => item.taskId === input.proposal.taskId) : null
      if (task && task.status !== 'COMPLETE' && task.status !== 'RUNNING') {
        task.status = 'BLOCKED'
        task.blocker = input.proposal.reason
      }
    }
    const record = baseRecord(status, previousPlanHash)
    graph.lastReplan = { level: input.proposal.level, reason: input.proposal.reason, status, attemptCount: graphReplanBudgets(graph).taskReplanCount + graphReplanBudgets(graph).dagReplanCount }
    return { graph, record, applied: false }
  }

  if (input.proposal.level === 'L0') {
    const task = input.proposal.taskId ? graph.tasks.find(item => item.taskId === input.proposal.taskId) : null
    if (task && task.status !== 'COMPLETE' && task.status !== 'RUNNING') {
      task.steerCount = (task.steerCount ?? 0) + 1
      task.strategy = input.proposal.strategy ?? 'steer'
      task.guidance = [...task.guidance, input.proposal.reason].slice(-8)
      task.latestAction = `L0 STEER: ${input.proposal.reason}`
      if (task.status === 'FAILED' || task.status === 'BLOCKED') {
        task.status = 'READY'
        task.blocker = null
      }
    }
    const record = baseRecord('APPLIED', hashCommandCenterPlan(graph))
    graph.lastReplanId = record.replanId
    graph.lastReplan = { level: 'L0', reason: input.proposal.reason, status: 'APPLIED', attemptCount: task?.steerCount ?? 1 }
    graph.planHash = record.proposedPlanHash
    return { graph, record, applied: true }
  }

  if (input.proposal.level === 'L1') {
    const task = input.proposal.taskId ? graph.tasks.find(item => item.taskId === input.proposal.taskId) : null
    if (task && task.status !== 'COMPLETE' && task.status !== 'RUNNING') {
      task.taskReplanCount = (task.taskReplanCount ?? 0) + 1
      graph.taskReplanCount = (graph.taskReplanCount ?? 0) + 1
      task.strategy = input.proposal.strategy ?? `task-replan-${task.taskReplanCount}`
      task.guidance = [...task.guidance, `L1 ${input.proposal.reason}`].slice(-8)
      task.latestAction = `L1 TASK REPLAN: ${input.proposal.reason}`
      if (task.status === 'FAILED' || task.status === 'BLOCKED') {
        task.status = 'READY'
        task.blocker = null
      }
    }
    const record = baseRecord('APPLIED', hashCommandCenterPlan(graph))
    graph.lastReplanId = record.replanId
    graph.lastReplan = { level: 'L1', reason: input.proposal.reason, status: 'APPLIED', attemptCount: graph.taskReplanCount ?? 1 }
    graph.planHash = record.proposedPlanHash
    return { graph, record, applied: true }
  }

  const preview = previewGraph(graph, input.proposal)
  const dag = validateDag(preview.tasks)
  if (!dag.ok) {
    const record = baseRecord('REFUSED', previousPlanHash)
    graph.lastReplan = { level: 'L2', reason: dag.errors.join('; '), status: 'REFUSED', attemptCount: graph.dagReplanCount ?? 0 }
    return { graph, record, applied: false }
  }
  const addedTaskIds = preview.tasks.filter(task => !graph.tasks.some(existing => existing.taskId === task.taskId)).map(task => task.taskId)
  graph.tasks = preview.tasks
  graph.dagReplanCount = (graph.dagReplanCount ?? 0) + 1
  graph.traces = [
    ...graph.traces,
    ...addedTaskIds.flatMap(taskId => {
      const task = graph.tasks.find(item => item.taskId === taskId)
      return (task?.requirementIds ?? []).map(requirementId => ({
        requirementId,
        taskId,
        files: [],
        tests: [],
        status: 'PENDING' as const,
      }))
    }),
  ]
  promoteReady(graph.tasks)
  if (graph.status === 'FAILED' || graph.status === 'BLOCKED') graph.status = 'QUEUED'
  const record = baseRecord('APPLIED', hashCommandCenterPlan(graph), { addedTaskIds })
  graph.lastReplanId = record.replanId
  graph.lastReplan = { level: 'L2', reason: input.proposal.reason, status: 'APPLIED', attemptCount: graph.dagReplanCount }
  graph.planHash = record.proposedPlanHash
  graph.stagnationDetected = false
  graph.stagnationReason = null
  graph.frontierStallCycles = 0
  return { graph, record, applied: true }
}

export function evaluateCommandCenterReplan(input: {
  graph: FoundryCommandCenterGraph
  observation?: FoundryActionObservation | null
  taskId?: string | null
  hint?: string | null
  proposal?: FoundryStructuredReplanProposal | null
  missionContract?: FoundryMissionContract | null
  acceptanceContract?: FoundryAcceptanceContract | null
}): { graph: FoundryCommandCenterGraph; record: FoundryReplanRecord; stagnation: FoundryStagnationReport; applied: boolean } {
  const graph = input.graph
  if (input.observation) recordObservation(graph, input.observation)
  const taskId = input.taskId ?? input.observation?.taskId ?? input.proposal?.taskId ?? null
  const stagnation = detectStagnation(graph, taskId)
  if (stagnation.detected) {
    emit(graph.missionId, 'STAGNATION_DETECTED', stagnation.reasons.join('; '), { taskId: taskId ?? '', score: stagnation.score })
  }
  const task = taskId ? graph.tasks.find(item => item.taskId === taskId) : null
  const failureClass = classifyReplanFailure({
    error: input.observation?.detail ?? task?.blocker,
    blocker: task?.blocker,
    tests: task?.tests,
  })
  const recoverableFailed = Boolean(task && (task.status === 'FAILED' || task.status === 'BLOCKED'))
  let proposal = input.proposal ?? proposeDeterministicReplan({ graph, taskId, stagnation, failureClass, hint: input.hint })
  if (!input.proposal && !stagnation.detected && !stagnation.repeatActionRefused && !recoverableFailed) {
    const hash = hashCommandCenterPlan(graph)
    return {
      graph,
      record: {
        schemaVersion: FOUNDRY_REPLAN_SCHEMA_VERSION,
        replanId: 'RP-NONE',
        missionId: graph.missionId,
        graphId: graph.graphId,
        taskId,
        level: 'L0',
        reason: 'No stagnation; execution continues without replan.',
        failureClass,
        previousPlanHash: hash,
        proposedPlanHash: hash,
        changedTaskIds: [],
        addedTaskIds: [],
        removedTaskIds: [],
        dependencyChanges: [],
        contractGeneration: graph.missionContractHash ?? null,
        approvalId: graph.approvalId ?? null,
        createdAt: new Date().toISOString(),
        status: 'REFUSED',
        expectedProgressSignal: 'none',
      },
      stagnation,
      applied: false,
    }
  }
  emit(graph.missionId, 'REPLAN_PROPOSED', `${proposal.level}: ${proposal.reason}`, { level: proposal.level })
  if (stagnation.detected && stagnationShouldBlockForBudget(graph.missionId) && proposal.level !== 'L4' && proposal.level !== 'L3') {
    proposal.level = 'L4'
    proposal.reason = 'Stagnation detected near resource exhaustion. Remaining budget will not be burned on speculative alternatives.'
  }
  const replanKind = proposal.level === 'L0' ? 'replan-l0' : proposal.level === 'L1' ? 'replan-l1' : proposal.level === 'L2' ? 'replan-l2' : null
  if (replanKind) {
    const gate = authorizeResourceAction({ missionId: graph.missionId, kind: replanKind })
    if (!gate.ok && gate.code !== 'NO_BUDGET') {
      graph.status = 'BLOCKED'
      const record = persistRecord({
        schemaVersion: FOUNDRY_REPLAN_SCHEMA_VERSION,
        replanId: `RP-${randomUUID()}`,
        missionId: graph.missionId,
        graphId: graph.graphId,
        taskId,
        level: 'L4',
        reason: gate.reason,
        failureClass,
        previousPlanHash: hashCommandCenterPlan(graph),
        proposedPlanHash: hashCommandCenterPlan(graph),
        changedTaskIds: proposal.changedTaskIds,
        addedTaskIds: [],
        removedTaskIds: [],
        dependencyChanges: [],
        contractGeneration: graph.missionContractHash ?? null,
        approvalId: graph.approvalId ?? null,
        createdAt: new Date().toISOString(),
        status: 'BLOCKED',
        expectedProgressSignal: 'commander_decision',
      })
      graph.lastReplan = { level: 'L4', reason: gate.reason, status: 'BLOCKED', attemptCount: graphReplanBudgets(graph).dagReplanCount }
      return { graph, record, stagnation, applied: false }
    }
  }
  const applied = applyReplan({
    graph,
    proposal,
    missionContract: input.missionContract,
    acceptanceContract: input.acceptanceContract,
  })
  if (applied.applied && replanKind) {
    const actionId = `replan-${applied.record.replanId}`
    beginResourceUsage({ missionId: graph.missionId, kind: replanKind, actionId, graphId: graph.graphId, taskId })
    completeResourceUsage({ actionId, missionId: graph.missionId, ok: true, kind: replanKind })
  }
  return { graph: applied.graph, record: applied.record, stagnation, applied: applied.applied }
}

export function recoverReplanCounters(graph: FoundryCommandCenterGraph, history: FoundryReplanRecord[]): FoundryCommandCenterGraph {
  const forGraph = history.filter(item => item.graphId === graph.graphId)
  const applied = forGraph.filter(item => item.status === 'APPLIED')
  graph.taskReplanCount = Math.max(graph.taskReplanCount ?? 0, applied.filter(item => item.level === 'L1').length)
  graph.dagReplanCount = Math.max(graph.dagReplanCount ?? 0, applied.filter(item => item.level === 'L2').length)
  graph.missionReplanRequestCount = Math.max(graph.missionReplanRequestCount ?? 0, forGraph.filter(item => item.level === 'L3' || item.status === 'REAPPROVAL_REQUIRED').length)
  graph.planHash = hashCommandCenterPlan(graph)
  const last = forGraph.at(-1)
  if (last) {
    graph.lastReplanId = last.replanId
    graph.lastReplan = { level: last.level, reason: last.reason, status: last.status, attemptCount: graph.taskReplanCount + graph.dagReplanCount }
  }
  return graph
}

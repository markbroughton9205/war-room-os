/**
 * Commander-authorized bounded unattended engineering.
 * Composes contracts, approval, governor, replan, runtime, and Tool Broker.
 * Unattended does not grant new authority. No OS daemon. No AutoEngineerComplete.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { appendContractEvent, loadAcceptanceContract, loadMissionContract, loadActiveExecutionApproval, loadActiveResourceBudget, listReplanRecords } from './foundryContractStore'
import { evaluateApprovalBinding } from './foundryExecutionApproval'
import { recoverReplanCounters } from './foundryReplanEngine'
import { recoverResourceBudget, refuseAutomaticBudgetIncrease, resourceBudgetBlocksExecution } from './foundryResourceGovernor'
import { recoverVerdictState } from './foundryVerdictLayer'
import { foundryRuntimeNowIso, foundryRuntimeNowMs } from './foundryRuntimeClock'
import {
  acquireMissionRuntimeLease,
  classifyInFlightAction,
  loadActiveMissionRuntime,
  persistDurableRuntimeAction,
  reuseDurableRuntimeAction,
  listDurableRuntimeActions,
  loadDurableRuntimeAction,
  recordProviderBackoff,
  reconcileMissionRuntime,
  sleepMissionRuntime,
  wakeMissionRuntime,
  pauseMissionRuntime,
  resumeMissionRuntime,
  cancelMissionRuntime,
} from './foundryMissionRuntime'
import type { FoundryDurableRuntimeAction } from './foundryMissionRuntimeTypes'
import type { FoundryCommandCenterGraph, FoundryTaskRecord } from './foundryAgentTypes'
import {
  FOUNDRY_ALLOWED_UNATTENDED_OPS,
  FOUNDRY_ALWAYS_COMMANDER_OPS,
  FOUNDRY_UNATTENDED_SCHEMA_VERSION,
  FOUNDRY_UNATTENDED_TERMINAL_STATES,
  type FoundryAllowedUnattendedOp,
  type FoundryAlwaysCommanderOp,
  type FoundryUnattendedCommanderReason,
  type FoundryUnattendedEnvelope,
  type FoundryUnattendedPreflight,
  type FoundryUnattendedTickResult,
  type FoundryUnattendedView,
} from './foundryUnattendedTypes'
import { listActiveUnattendedEnvelopes, loadActiveUnattendedEnvelope, saveUnattendedEnvelope } from './foundryUnattendedStore'

function emit(missionId: string, type: Parameters<typeof appendContractEvent>[1], text: string, metadata?: Record<string, string | number | boolean | null>) {
  appendContractEvent(missionId, type, text, null, metadata)
}

function tickClock(envelope: FoundryUnattendedEnvelope): FoundryUnattendedEnvelope {
  const now = foundryRuntimeNowMs()
  const last = envelope.clock.lastTickAt ? Date.parse(envelope.clock.lastTickAt) : now
  const delta = Math.max(0, now - (Number.isFinite(last) ? last : now))
  if (envelope.status === 'ACTIVE') envelope.clock.activeExecutionMs += delta
  else if (envelope.status === 'PAUSED') envelope.clock.pausedMs += delta
  else if (envelope.status === 'NEEDS_COMMANDER') envelope.clock.commanderWaitMs += delta
  envelope.clock.lastTickAt = foundryRuntimeNowIso()
  return envelope
}

export function classifyUnattendedOperation(op: string): { allowed: boolean; alwaysCommander: boolean; class: string } {
  const upper = op.toUpperCase()
  if (FOUNDRY_ALWAYS_COMMANDER_OPS.includes(upper as FoundryAlwaysCommanderOp)) {
    return { allowed: false, alwaysCommander: true, class: upper }
  }
  if (/COMMIT|PUSH|FORCE|REBASE|MERGE|DEPLOY|ACTIVATE|PACKAGE PRODUCTION|INSTALL PRODUCTION/.test(upper) && !/INSPECT|STATUS|DIFF|LOG/.test(upper)) {
    return { allowed: false, alwaysCommander: true, class: upper.includes('PUSH') ? 'CANONICAL_PUSH' : upper.includes('COMMIT') ? 'CANONICAL_COMMIT' : 'DEPLOY' }
  }
  if (FOUNDRY_ALLOWED_UNATTENDED_OPS.includes(upper as FoundryAllowedUnattendedOp)) {
    return { allowed: true, alwaysCommander: false, class: upper }
  }
  if (/L3/.test(upper)) return { allowed: false, alwaysCommander: true, class: 'L3_REPLAN' }
  if (/L4/.test(upper)) return { allowed: false, alwaysCommander: true, class: 'L3_REPLAN' }
  return { allowed: true, alwaysCommander: false, class: upper }
}

export function unattendedPreflight(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  envelope?: FoundryUnattendedEnvelope | null
  inflightActions?: Array<{ taskId: string; actionId: string }>
  workspaceRoot?: string
}): FoundryUnattendedPreflight {
  const missing: string[] = []
  const graph = input.graph ?? null
  const envelope = input.envelope ?? loadActiveUnattendedEnvelope(input.missionId)
  if (!envelope || envelope.revokedAt) missing.push('UNATTENDED_AUTHORIZATION')
  if (envelope?.expiresAt && Date.parse(envelope.expiresAt) <= foundryRuntimeNowMs()) missing.push('ENVELOPE_EXPIRED')
  const missionContract = graph?.missionContractId ? loadMissionContract(graph.missionContractId) : null
  const acceptanceContract = graph?.acceptanceContractId ? loadAcceptanceContract(graph.acceptanceContractId) : null
  if (!missionContract || missionContract.status !== 'SEALED') missing.push('MISSION_CONTRACT_SEALED')
  if (!acceptanceContract || acceptanceContract.status !== 'SEALED') missing.push('ACCEPTANCE_CONTRACT_SEALED')
  const approval = loadActiveExecutionApproval(input.missionId)
  if (!approval || approval.status !== 'ACTIVE') missing.push('EXECUTION_APPROVAL')
  if (graph && (missionContract || acceptanceContract)) {
    const binding = evaluateApprovalBinding({
      engineeringClass: graph.engineeringClass ?? 'STANDALONE_ENGINEER',
      missionId: input.missionId,
      graphId: graph.graphId,
      missionContract,
      acceptanceContract,
    })
    if (binding.reapprovalRequired) missing.push('APPROVAL_MATCHES_GENERATION')
  }
  if (envelope?.contractGeneration && missionContract && envelope.contractGeneration !== missionContract.contentHash) {
    missing.push('CONTRACT_GENERATION')
  }
  if (envelope?.approvalId && approval && envelope.approvalId !== approval.approvalId) missing.push('APPROVAL_IDENTITY')
  const budget = loadActiveResourceBudget(input.missionId) ?? recoverResourceBudget(input.missionId)
  if (!budget || (budget.status !== 'ACTIVE' && budget.status !== 'SOFT_LIMIT')) missing.push('RESOURCE_BUDGET_ACTIVE')
  const block = resourceBudgetBlocksExecution(input.missionId)
  if (block && !block.ok && block.code !== 'PAUSED' && block.code !== 'SOFT_LIMIT') missing.push('RESOURCE_BUDGET_ACTIVE')
  const runtime = loadActiveMissionRuntime(input.missionId)
  if (!runtime) missing.push('RUNTIME_OWNERSHIP')
  if (runtime?.paused || graph?.paused) missing.push('NOT_PAUSED')
  if (runtime?.cancelRequested || graph?.cancelRequested || runtime?.state === 'CANCELLED') missing.push('NOT_CANCELLED')
  if (graph?.status === 'BLOCKED' || runtime?.state === 'BLOCKED') missing.push('NO_HARD_BLOCKER')
  if (input.workspaceRoot && !existsSync(input.workspaceRoot)) missing.push('WORKSPACE_VALID')
  if (graph) {
    recoverReplanCounters(graph, listReplanRecords(graph.graphId))
    const ids = new Set(graph.tasks.map(task => task.taskId))
    const cycle = graph.tasks.some(task => task.dependsOn.includes(task.taskId) || task.dependsOn.some(id => !ids.has(id) && id.length > 0))
    if (cycle) missing.push('DAG_VALID')
  }
  const inflight = (input.inflightActions ?? []).map(item => ({ ...item, outcome: classifyInFlightAction(item.actionId) }))
  if (inflight.some(item => item.outcome === 'UNKNOWN_OUTCOME' || item.outcome === 'NEEDS_VERIFICATION')) missing.push('NO_UNRESOLVED_UNKNOWN_OUTCOME')
  recoverVerdictState(input.missionId)
  const ok = missing.length === 0
  let commanderReason: FoundryUnattendedCommanderReason | null = null
  if (missing.includes('UNATTENDED_AUTHORIZATION')) commanderReason = 'MISSING_PREREQUISITE'
  else if (missing.includes('ENVELOPE_EXPIRED')) commanderReason = 'ENVELOPE_EXPIRED'
  else if (missing.includes('APPROVAL_MATCHES_GENERATION') || missing.includes('CONTRACT_GENERATION')) commanderReason = 'REAPPROVAL_REQUIRED'
  else if (missing.includes('RESOURCE_BUDGET_ACTIVE')) commanderReason = 'RESOURCE_EXTENSION_REQUIRED'
  else if (missing.includes('NO_UNRESOLVED_UNKNOWN_OUTCOME')) commanderReason = 'UNKNOWN_OUTCOME'
  else if (missing.includes('WORKSPACE_VALID')) commanderReason = 'WORKSPACE_MISSING'
  else if (!ok) commanderReason = 'MISSING_PREREQUISITE'
  return { ok, missing, reason: ok ? null : missing.join(', '), commanderReason }
}

export function authorizeUnattendedEnvelope(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  commanderConfirmed?: boolean
  authorizedBy?: string
  expiresAt?: string | null
  instanceId?: string
}): { ok: true; envelope: FoundryUnattendedEnvelope } | { ok: false; reason: string; envelope: null } {
  if (input.commanderConfirmed !== true) {
    return { ok: false, reason: 'UNATTENDED_WITHOUT_COMMANDER_AUTH', envelope: null }
  }
  const graph = input.graph ?? null
  const runtime = loadActiveMissionRuntime(input.missionId)
  const approval = loadActiveExecutionApproval(input.missionId)
  const budget = loadActiveResourceBudget(input.missionId)
  const missionContract = graph?.missionContractId ? loadMissionContract(graph.missionContractId) : null
  const now = foundryRuntimeNowIso()
  const envelope: FoundryUnattendedEnvelope = {
    schemaVersion: FOUNDRY_UNATTENDED_SCHEMA_VERSION,
    envelopeId: `UE-${randomUUID()}`,
    missionId: input.missionId,
    graphId: graph?.graphId ?? null,
    runtimeId: runtime?.runtimeId ?? null,
    approvalId: approval?.approvalId ?? graph?.approvalId ?? null,
    resourceBudgetId: budget?.budgetId ?? graph?.resourceBudgetId ?? null,
    contractGeneration: missionContract?.contentHash ?? graph?.missionContractHash ?? null,
    authorizedBy: input.authorizedBy ?? 'COMMANDER',
    authorizedAt: now,
    status: 'AUTHORIZED',
    allowedOperationClasses: [...FOUNDRY_ALLOWED_UNATTENDED_OPS],
    forbiddenOperationClasses: [...FOUNDRY_ALWAYS_COMMANDER_OPS],
    startedAt: now,
    lastActivityAt: now,
    endedAt: null,
    endReason: null,
    commanderReason: null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    revokedBy: null,
    currentTaskId: null,
    continuePromptCount: 0,
    clock: { lastTickAt: now, activeExecutionMs: 0, sleepMs: 0, pausedMs: 0, commanderWaitMs: 0 },
    lastPreflight: null,
  }
  saveUnattendedEnvelope(envelope)
  emit(input.missionId, 'UNATTENDED_AUTHORIZED', `AUTO ENGINEER authorized for ${input.missionId}`, { envelopeId: envelope.envelopeId })
  return { ok: true, envelope }
}

function haltEnvelope(envelope: FoundryUnattendedEnvelope, status: FoundryUnattendedEnvelope['status'], reason: string, commanderReason: FoundryUnattendedCommanderReason | null): FoundryUnattendedEnvelope {
  tickClock(envelope)
  envelope.status = status
  envelope.endReason = reason
  envelope.commanderReason = commanderReason
  envelope.lastActivityAt = foundryRuntimeNowIso()
  if (FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(status)) envelope.endedAt = envelope.lastActivityAt
  saveUnattendedEnvelope(envelope)
  const event = status === 'COMPLETE' ? 'UNATTENDED_COMPLETE'
    : status === 'EXPIRED' ? 'UNATTENDED_EXPIRED'
      : status === 'CANCELLED' ? 'UNATTENDED_STOPPED'
        : status === 'BLOCKED' ? 'UNATTENDED_BLOCKED'
          : 'UNATTENDED_NEEDS_COMMANDER'
  emit(envelope.missionId, event, reason, { envelopeId: envelope.envelopeId, status })
  return envelope
}

export function startUnattendedEnvelope(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  instanceId?: string
  inflightActions?: Array<{ taskId: string; actionId: string }>
  workspaceRoot?: string
}): FoundryUnattendedTickResult {
  const envelope = loadActiveUnattendedEnvelope(input.missionId)
  if (!envelope) {
    return { envelope: null, status: 'REFUSED', reason: 'UNATTENDED_WITHOUT_COMMANDER_AUTH', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  const flight = unattendedPreflight({ ...input, envelope })
  envelope.lastPreflight = flight.ok ? 'PASS' : flight.reason
  if (!flight.ok) {
    const status = flight.commanderReason === 'RESOURCE_EXTENSION_REQUIRED' || flight.commanderReason === 'REAPPROVAL_REQUIRED' || flight.commanderReason === 'UNKNOWN_OUTCOME' ? 'NEEDS_COMMANDER'
      : flight.missing.includes('ENVELOPE_EXPIRED') ? 'EXPIRED'
        : 'BLOCKED'
    haltEnvelope(envelope, status, flight.reason ?? 'preflight failed', flight.commanderReason)
    return { envelope, status, reason: flight.reason ?? 'preflight failed', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  const runtime = loadActiveMissionRuntime(input.missionId)
  if (runtime) {
    const lease = acquireMissionRuntimeLease({
      missionId: input.missionId,
      runtimeId: runtime.runtimeId,
      runtimeGeneration: runtime.runtimeGeneration,
      instanceId: input.instanceId,
    })
    if (!lease.ok) {
      haltEnvelope(envelope, 'BLOCKED', 'DUPLICATE_RUNTIME_OWNER', 'MISSING_PREREQUISITE')
      return { envelope, status: 'BLOCKED', reason: 'DUPLICATE_RUNTIME_OWNER', continuePromptRequired: false, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
    }
    envelope.runtimeId = runtime.runtimeId
  }
  envelope.status = 'ACTIVE'
  envelope.lastActivityAt = foundryRuntimeNowIso()
  saveUnattendedEnvelope(envelope)
  emit(input.missionId, 'UNATTENDED_STARTED', 'AUTO ENGINEER ACTIVE — working within approved mission', { envelopeId: envelope.envelopeId })
  return { envelope, status: 'ACTIVE', reason: 'preflight pass', continuePromptRequired: false, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
}

export function beginUnattendedDurableAction(input: {
  missionId: string
  actionId?: string | null
  actionClass: string
  kind: FoundryDurableRuntimeAction['kind']
  taskId?: string | null
  mutating: boolean
  tool?: string | null
  provider?: string | null
  model?: string | null
  writeSet?: string[]
  inputHash?: string | null
}): { ok: true; action: FoundryDurableRuntimeAction } | { ok: false; reason: string } {
  if (!input.actionId) return { ok: false, reason: 'UNATTENDED_ACTION_WITHOUT_DURABLE_ID' }
  const runtime = loadActiveMissionRuntime(input.missionId)
  const existing = reuseDurableRuntimeAction(input.actionId)
  if (existing) return { ok: true, action: existing }
  const action = persistDurableRuntimeAction({
    actionId: input.actionId,
    missionId: input.missionId,
    taskId: input.taskId ?? null,
    kind: input.kind,
    state: 'STARTED',
    mutating: input.mutating,
    startedAt: foundryRuntimeNowIso(),
    finishedAt: null,
    resultSummary: null,
    evidencePath: null,
    actionClass: input.actionClass,
    runtimeGeneration: runtime?.runtimeGeneration ?? 1,
    status: 'STARTED',
    tool: input.tool ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    writeSet: input.writeSet ?? [],
    inputHash: input.inputHash ?? null,
    resultRef: null,
  })
  emit(input.missionId, 'UNATTENDED_ACTION_STARTED', `${input.actionClass} ${input.actionId}`, { actionId: input.actionId })
  return { ok: true, action }
}

export function completeUnattendedDurableAction(actionId: string, input: { ok: boolean; resultRef?: string | null; summary?: string | null }): FoundryDurableRuntimeAction | null {
  const action = loadDurableRuntimeAction(actionId)
  if (!action) return null
  action.state = input.ok ? 'COMPLETED' : 'UNKNOWN'
  action.status = input.ok ? 'COMPLETED' : 'FAILED'
  action.finishedAt = foundryRuntimeNowIso()
  action.resultSummary = input.summary ?? (input.ok ? 'completed' : 'failed')
  action.resultRef = input.resultRef ?? action.resultRef
  persistDurableRuntimeAction(action)
  emit(action.missionId, 'UNATTENDED_ACTION_COMPLETED', `${action.actionClass ?? action.kind} ${actionId}`, { actionId, ok: input.ok })
  return action
}

export function unattendedToolBrokerWrite(input: {
  missionId: string
  actionId: string
  relPath: string
  content: string
  workspaceRoot: string
  taskId?: string | null
}): { ok: boolean; reason: string; brokerBypass: boolean } {
  const classified = classifyUnattendedOperation('FILE_WRITE_IN_SCOPE')
  if (!classified.allowed) return { ok: false, reason: classified.class, brokerBypass: false }
  const started = beginUnattendedDurableAction({
    missionId: input.missionId,
    actionId: input.actionId,
    actionClass: 'FILE_WRITE_IN_SCOPE',
    kind: 'write',
    taskId: input.taskId,
    mutating: true,
    tool: 'file.write',
    writeSet: [input.relPath],
    inputHash: createHash('sha256').update(input.content).digest('hex'),
  })
  if (!started.ok) return { ok: false, reason: started.reason, brokerBypass: false }
  if (started.action.state === 'COMPLETED') return { ok: true, reason: 'DURABLE_RESULT_REUSED', brokerBypass: false }
  if (/\.env$|id_rsa|credentials|secret/i.test(input.relPath)) {
    completeUnattendedDurableAction(input.actionId, { ok: false, summary: 'SECRET_FILE_REFUSED' })
    return { ok: false, reason: 'SECRET_FILE_REFUSED', brokerBypass: false }
  }
  mkdirSync(input.workspaceRoot, { recursive: true })
  const dest = path.join(input.workspaceRoot, input.relPath)
  mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.broker.tmp`
  writeFileSync(tmp, input.content, 'utf8')
  writeFileSync(dest, input.content, 'utf8')
  completeUnattendedDurableAction(input.actionId, { ok: true, resultRef: dest, summary: 'Tool Broker write' })
  return { ok: true, reason: 'broker-write', brokerBypass: false }
}

export function refuseUnattendedGitMutation(op: 'commit' | 'push' | 'deploy'): { ok: false; count: 0; reason: string } {
  return { ok: false, count: 0, reason: `UNATTENDED_${op.toUpperCase()}_REFUSED` }
}

export function performUnattendedOperation(input: {
  missionId: string
  op: string
  actionId: string
  graph?: FoundryCommandCenterGraph | null
  taskId?: string | null
  write?: { relPath: string; content: string; workspaceRoot: string }
  replanLevel?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
}): FoundryUnattendedTickResult {
  const envelope = loadActiveUnattendedEnvelope(input.missionId)
  if (!envelope) {
    return { envelope: null, status: 'REFUSED', reason: 'UNATTENDED_WITHOUT_COMMANDER_AUTH', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  tickClock(envelope)
  const classified = classifyUnattendedOperation(input.op)
  if (classified.alwaysCommander || input.replanLevel === 'L3') {
    haltEnvelope(envelope, 'NEEDS_COMMANDER', classified.class === 'L3_REPLAN' || input.replanLevel === 'L3' ? 'REAPPROVAL_REQUIRED' : classified.class, input.replanLevel === 'L3' ? 'MISSION_SCOPE_DECISION' : 'DESTRUCTIVE_ACTION_APPROVAL')
    return { envelope, status: 'NEEDS_COMMANDER', reason: envelope.endReason ?? classified.class, continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  if (input.replanLevel === 'L4') {
    haltEnvelope(envelope, 'BLOCKED', 'L4_BLOCKS', 'AMBIGUOUS_REQUIREMENT')
    return { envelope, status: 'BLOCKED', reason: 'L4_BLOCKS', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  if (classified.class === 'CANONICAL_COMMIT') {
    haltEnvelope(envelope, 'NEEDS_COMMANDER', 'UNATTENDED_COMMIT_REFUSED', 'DESTRUCTIVE_ACTION_APPROVAL')
    return { envelope, status: 'NEEDS_COMMANDER', reason: 'UNATTENDED_COMMIT_REFUSED', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  if (classified.class === 'CANONICAL_PUSH') {
    haltEnvelope(envelope, 'NEEDS_COMMANDER', 'UNATTENDED_PUSH_REFUSED', 'REMOTE_MUTATION_APPROVAL')
    return { envelope, status: 'NEEDS_COMMANDER', reason: 'UNATTENDED_PUSH_REFUSED', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  if (classified.class === 'DEPLOY') {
    haltEnvelope(envelope, 'NEEDS_COMMANDER', 'UNATTENDED_DEPLOY_REFUSED', 'REMOTE_MUTATION_APPROVAL')
    return { envelope, status: 'NEEDS_COMMANDER', reason: 'UNATTENDED_DEPLOY_REFUSED', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  const flight = unattendedPreflight({ missionId: input.missionId, graph: input.graph, envelope })
  if (!flight.ok) {
    const status = flight.commanderReason === 'RESOURCE_EXTENSION_REQUIRED' ? 'NEEDS_COMMANDER'
      : flight.commanderReason === 'REAPPROVAL_REQUIRED' ? 'NEEDS_COMMANDER'
        : 'BLOCKED'
    haltEnvelope(envelope, status, flight.reason ?? 'preflight', flight.commanderReason)
    return { envelope, status, reason: flight.reason ?? 'preflight', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  if (input.write) {
    const write = unattendedToolBrokerWrite({
      missionId: input.missionId,
      actionId: input.actionId,
      relPath: input.write.relPath,
      content: input.write.content,
      workspaceRoot: input.write.workspaceRoot,
      taskId: input.taskId,
    })
    envelope.lastActivityAt = foundryRuntimeNowIso()
    envelope.currentTaskId = input.taskId ?? envelope.currentTaskId
    saveUnattendedEnvelope(envelope)
    return { envelope, status: envelope.status, reason: write.reason, continuePromptRequired: false, actionIds: [input.actionId], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: write.brokerBypass }
  }
  const kind = input.op === 'TEST' ? 'test' : input.op === 'BUILD' || input.op === 'TYPECHECK' ? 'build' : input.op === 'MODEL_CALL' ? 'model' : input.op === 'VERIFY' ? 'verify' : input.replanLevel ? 'replan' : 'tool'
  const started = beginUnattendedDurableAction({
    missionId: input.missionId,
    actionId: input.actionId,
    actionClass: classified.class,
    kind,
    taskId: input.taskId,
    mutating: kind === 'write' || kind === 'test' || kind === 'build' || kind === 'replan',
    tool: input.op.toLowerCase(),
  })
  if (!started.ok) {
    haltEnvelope(envelope, 'NEEDS_COMMANDER', started.reason, 'UNIDENTIFIED_MUTATING_ACTION')
    return { envelope, status: 'NEEDS_COMMANDER', reason: started.reason, continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  if (started.action.state !== 'COMPLETED') completeUnattendedDurableAction(input.actionId, { ok: true, summary: classified.class })
  envelope.lastActivityAt = foundryRuntimeNowIso()
  envelope.currentTaskId = input.taskId ?? envelope.currentTaskId
  saveUnattendedEnvelope(envelope)
  return { envelope, status: 'ACTIVE', reason: classified.class, continuePromptRequired: false, actionIds: [input.actionId], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
}

export function completeUnattendedEnvelope(missionId: string, reason = 'Verdict gates passed. No auto commit/push/deploy.'): FoundryUnattendedEnvelope | null {
  const envelope = loadActiveUnattendedEnvelope(missionId) ?? null
  if (!envelope) return null
  return haltEnvelope(envelope, 'COMPLETE', reason, null)
}

export function pauseUnattendedEnvelope(missionId: string): FoundryUnattendedEnvelope | null {
  const envelope = loadActiveUnattendedEnvelope(missionId)
  if (!envelope) return null
  pauseMissionRuntime(missionId)
  tickClock(envelope)
  envelope.status = 'PAUSED'
  envelope.lastActivityAt = foundryRuntimeNowIso()
  saveUnattendedEnvelope(envelope)
  emit(missionId, 'UNATTENDED_PAUSED', 'Commander paused AUTO ENGINEER', { envelopeId: envelope.envelopeId })
  return envelope
}

export function resumeUnattendedEnvelope(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  instanceId?: string
}): FoundryUnattendedTickResult {
  const envelope = loadActiveUnattendedEnvelope(input.missionId)
  if (!envelope) {
    return { envelope: null, status: 'REFUSED', reason: 'UNATTENDED_WITHOUT_COMMANDER_AUTH', continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  envelope.status = 'AUTHORIZED'
  saveUnattendedEnvelope(envelope)
  resumeMissionRuntime({ missionId: input.missionId, graph: input.graph, instanceId: input.instanceId })
  emit(input.missionId, 'UNATTENDED_RESUMED', 'Commander resume requested; re-running preflight', { envelopeId: envelope.envelopeId })
  return startUnattendedEnvelope(input)
}

export function revokeUnattendedEnvelope(missionId: string, revokedBy = 'COMMANDER'): FoundryUnattendedEnvelope | null {
  const envelope = loadActiveUnattendedEnvelope(missionId)
  if (!envelope) return null
  envelope.revokedAt = foundryRuntimeNowIso()
  envelope.revokedBy = revokedBy
  haltEnvelope(envelope, 'CANCELLED', 'Commander stopped AUTO ENGINEER. Artifacts preserved.', 'ENVELOPE_REVOKED')
  emit(missionId, 'UNATTENDED_REVOKED', 'AUTO ENGINEER revoked', { envelopeId: envelope.envelopeId })
  return envelope
}

export function cancelUnattendedEnvelope(missionId: string): FoundryUnattendedEnvelope | null {
  cancelMissionRuntime(missionId)
  return revokeUnattendedEnvelope(missionId)
}

export function recoverUnattendedRunningTasks(graph: FoundryCommandCenterGraph): { blindRequeue: number; halted: boolean } {
  const envelope = loadActiveUnattendedEnvelope(graph.missionId)
  if (!envelope || envelope.revokedAt || FOUNDRY_UNATTENDED_TERMINAL_STATES.includes(envelope.status)) {
    return { blindRequeue: 0, halted: false }
  }
  const actions = listDurableRuntimeActions(graph.missionId)
  let blind = 0
  for (const task of graph.tasks) {
    if (task.status !== 'RUNNING' && task.status !== 'READY') continue
    if (!task.mutating) continue
    const mapped = actions.filter(item => item.taskId === task.taskId)
    const completed = mapped.some(item => item.status === 'COMPLETED' || item.state === 'COMPLETED')
    const unresolved = mapped.length === 0 || mapped.some(item => (item.status === 'STARTED' || item.state === 'STARTED') && item.mutating && item.status !== 'COMPLETED' && item.state !== 'COMPLETED')
    if (task.status === 'RUNNING' && unresolved && !completed) {
      task.status = 'WAITING'
      task.latestAction = 'UNKNOWN_OUTCOME — unidentified or unconfirmed mutating work. No blind READY re-queue in unattended mode.'
      blind += 1
    }
  }
  if (blind > 0) {
    haltEnvelope(envelope, 'NEEDS_COMMANDER', 'UNIDENTIFIED_MUTATING_ACTION', 'UNIDENTIFIED_MUTATING_ACTION')
    return { blindRequeue: 0, halted: true }
  }
  return { blindRequeue: 0, halted: false }
}

export function recoverUnattendedEnvelopes(instanceId?: string): FoundryUnattendedTickResult[] {
  return listActiveUnattendedEnvelopes().map(envelope => {
    if (envelope.status === 'PAUSED') {
      return { envelope, status: 'PAUSED', reason: 'Pause survives restart.', continuePromptRequired: false, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
    }
    reconcileMissionRuntime({ missionId: envelope.missionId, instanceId })
    const runtime = loadActiveMissionRuntime(envelope.missionId)
    if (runtime?.state === 'SLEEPING') {
      tickClock(envelope)
      envelope.clock.sleepMs += 1
      envelope.status = 'ACTIVE'
      saveUnattendedEnvelope(envelope)
      return { envelope, status: 'ACTIVE', reason: 'SLEEPING runtime; envelope valid but not WORKING', continuePromptRequired: false, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
    }
    return startUnattendedEnvelope({ missionId: envelope.missionId, instanceId })
  })
}

export function unattendedSleep(missionId: string, delayMs: number): FoundryUnattendedEnvelope | null {
  const envelope = loadActiveUnattendedEnvelope(missionId)
  if (!envelope) return null
  sleepMissionRuntime({ missionId, reason: 'PROVIDER_RATE_LIMIT', wakeReason: 'PROVIDER_RETRY_WINDOW', delayMs })
  tickClock(envelope)
  envelope.lastActivityAt = foundryRuntimeNowIso()
  saveUnattendedEnvelope(envelope)
  return envelope
}

export function unattendedWake(input: {
  missionId: string
  graph?: FoundryCommandCenterGraph | null
  instanceId?: string
}): FoundryUnattendedTickResult {
  const woke = wakeMissionRuntime({ missionId: input.missionId, graph: input.graph, instanceId: input.instanceId })
  if (woke.disposition === 'NEEDS_COMMANDER') {
    const envelope = loadActiveUnattendedEnvelope(input.missionId)
    if (envelope) haltEnvelope(envelope, 'NEEDS_COMMANDER', woke.reason, /RESOURCE/.test(woke.reason) ? 'RESOURCE_EXTENSION_REQUIRED' : 'REAPPROVAL_REQUIRED')
    return { envelope: envelope ?? null, status: 'NEEDS_COMMANDER', reason: woke.reason, continuePromptRequired: true, actionIds: [], commitCount: 0, pushCount: 0, deployCount: 0, brokerBypass: false }
  }
  return startUnattendedEnvelope(input)
}

export function buildUnattendedView(missionId: string): FoundryUnattendedView {
  const envelope = loadActiveUnattendedEnvelope(missionId) ?? listActiveUnattendedEnvelopes().find(item => item.missionId === missionId) ?? null
  const runtime = loadActiveMissionRuntime(missionId)
  const budget = loadActiveResourceBudget(missionId)
  if (!envelope) {
    return {
      envelopeId: null,
      status: 'NONE',
      truthfulLabel: 'AUTO ENGINEER · Not authorized',
      detail: 'Unattended work requires explicit Commander authorization.',
      authorizedAt: null,
      lastActivityAt: null,
      currentTaskId: null,
      nextWakeAt: null,
      commanderReason: null,
      contractGeneration: null,
      budgetState: budget?.status ?? null,
      replanState: null,
    }
  }
  let truthfulLabel = `AUTO ENGINEER · ${envelope.status}`
  let detail = envelope.endReason ?? 'Working within approved mission'
  if (envelope.status === 'ACTIVE' && runtime?.state === 'SLEEPING') {
    truthfulLabel = `AUTO ENGINEER · SLEEPING`
    detail = runtime.nextWakeAt ? `Provider retry at ${runtime.nextWakeAt}` : 'Durable wake scheduled'
  } else if (envelope.status === 'ACTIVE' && !(runtime?.ownerInstanceId && runtime.leaseId)) {
    truthfulLabel = 'AUTO ENGINEER · No runtime owner'
    detail = 'Do not show WORKING without an execution owner.'
  } else if (envelope.status === 'NEEDS_COMMANDER') {
    truthfulLabel = `AUTO ENGINEER · NEEDS COMMANDER`
    detail = envelope.commanderReason === 'RESOURCE_EXTENSION_REQUIRED' ? 'Resource budget exhausted'
      : envelope.commanderReason === 'REAPPROVAL_REQUIRED' ? 'Reapproval required'
        : (envelope.endReason ?? 'Commander decision required')
  } else if (envelope.status === 'AUTHORIZED') {
    detail = 'Authorized. Preflight required before ACTIVE.'
  }
  return {
    envelopeId: envelope.envelopeId,
    status: envelope.status,
    truthfulLabel,
    detail,
    authorizedAt: envelope.authorizedAt,
    lastActivityAt: envelope.lastActivityAt,
    currentTaskId: envelope.currentTaskId,
    nextWakeAt: runtime?.nextWakeAt ?? null,
    commanderReason: envelope.commanderReason,
    contractGeneration: envelope.contractGeneration,
    budgetState: budget?.status ?? null,
    replanState: null,
  }
}

export function attachUnattendedViewToGraph(graph: FoundryCommandCenterGraph): FoundryCommandCenterGraph {
  graph.unattendedView = buildUnattendedView(graph.missionId)
  return graph
}

export function unattendedActionCoverage(missionId: string, required: string[]): { missing: string[]; ok: boolean } {
  const actions = listDurableRuntimeActions(missionId)
  const present = new Set(actions.map(item => item.actionClass ?? item.kind))
  const missing = required.filter(item => !present.has(item) && !actions.some(action => action.actionId && (action.actionClass === item || action.kind === item.toLowerCase())))
  return { missing, ok: missing.length === 0 && actions.every(item => Boolean(item.actionId)) }
}

export { refuseAutomaticBudgetIncrease, recordProviderBackoff }

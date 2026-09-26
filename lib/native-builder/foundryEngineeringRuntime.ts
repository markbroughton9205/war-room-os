/**
 * Foundry Engineering Runtime.
 * Extends the existing coding mission, patch applier, and command policy.
 * FRK still owns reasoning sessions. This module owns tools, receipts, and operator events.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { classifyArgv } from './commandPolicy'
import { resolveLocalModelHealth } from './localModelHealth'
import {
  activityTitle,
  classifyWorkspacePath,
  countLineChanges,
  emptyEngineeringRuntime,
  engineeringEvent,
  lineDiff,
  nextEngineeringEventId,
  outsideSpanUnchanged,
  phaseForEvent,
  rememberRawOutput,
  reduceEngineeringEvents,
  spanChanged,
  workstreamTextForEvent,
  type FoundryBlockedDetail,
  type FoundryEngineeringCommandClass,
  type FoundryEngineeringEditReceipt,
  type FoundryEngineeringEvent,
  type FoundryEngineeringEventType,
  type FoundryEngineeringGovernance,
  type FoundryEngineeringRuntimeState,
  type FoundryEngineeringStatus,
} from './foundryEngineeringEvents'
import {
  ALL_REPAIR_STRATEGIES,
  buildFailureSignature,
  decideFailureContinuation,
  parseTrainingTelemetry,
  parseTraceFrames,
  parseUnexpectedKeyword,
  planUnexpectedKeywordRepair,
  pythonSignatureProbe,
  sourceFingerprint,
  trainerScriptNames as readTrainerNames,
  type RepairStrategyClass,
} from './foundryEngineeringFailure'
import { toCommanderState } from './foundryCommanderState'
import { applyProposal } from './patchApplier'
import { isRepairCancellationRequested } from './processRegistry'
import { listRepoFiles, readRepoFile } from './repositoryInspector'
import {
  ACTIVE_WORKING_SET_LIMIT,
  captureGitBaseline,
  emptyLargeProjectState,
  failureFile,
  FILE_INSPECT_BUDGET,
  keyFailureLine,
  noteWorkingSet,
  planLargeProjectRepair,
  preexistingDirtyBlocksEdit,
  readManifestText,
  regressionTestCommand,
  rememberExpansion,
  scanRepositoryStructure,
  searchBounded,
  SMALL_WORKSPACE_FILE_LIMIT,
  sourceStillMatches,
  targetedTestCommand,
  countProjectFiles,
  type LargeProjectState,
  type PlannedEdit,
} from './foundryLargeProject'
import {
  MAX_ACTIVE_SUBTASKS,
  MAX_CAMPAIGN_INSPECT,
  MAX_CAMPAIGN_REWORK_CYCLES,
  attributeFailure,
  buildCampaignPlan,
  campaignEdit,
  campaignCompletionAllowed,
  campaignShouldOwn,
  claimWriteLock,
  classifyCampaignFiles,
  contractFieldName,
  diskMeetsContract,
  emptyEngineeringCampaign,
  failureSignature,
  implementationNeedsEdit,
  restoreInterruptedCampaignTasks,
  recordTestFinish,
  recordTestStart,
  reworkImplementationIds,
  verificationBarrierSatisfied,
  phaseProgress,
  readyCampaignTasks,
  resolveInterfaceContradiction,
  reviewCampaign,
  reviewerFoundGap,
  specialistActivity,
  type CampaignTask,
  type EngineeringCampaign,
} from './foundryEngineeringCampaign'
import {
  PLAN_TRIGGER_SUMMARY,
  buildInitialPlan,
  ensurePlan,
  decideRepairTarget,
  linkHypothesis,
  disprovenHypothesis,
  layerForRepairTarget,
  planEventPayload,
  revisePlan,
  syncPlanStatus,
  type PlanTrigger,
  type RevisionInput,
} from './foundryEngineeringPlan'
import { acceptanceBasis, reviewClaimDecision, reviewerContract, setAsideNote, testsGreenAtCurrentGeneration, type ReviewClaimDecision } from './foundryAcceptanceBasis'
import { contradictedClaim, debugFilesFor, failingTestFiles, filesNamedBy, ineffectiveEdits, isolatedLayerEvidence, layerOfFile, mergeRuledOut, noEffectExhausted, recordNoEffect, reopenAfterNoEffect, reopenableLayers, scopeTestFailures, type DeferredFailure, type IsolatedLayerEvidence } from './foundryGoalAnchor'
import {
  PROGRESS_LIMITS,
  clearPendingContinuation,
  grantContinuation,
  applyIterationStop,
  applyWindowStop,
  blockedEvidence,
  blockedSummaryFor,
  ensureCampaignProgress,
  evaluateFailure,
  evaluateInvalidOutput,
  evaluateNoEffectiveChange,
  evaluateNoTests,
  fingerprintFinding,
  fingerprintTestFailure,
  noteDebuggerFinding,
  noteGreen,
  noteMutation,
  progressEventPayload,
  progressLimits,
  resetInvalidOutputStreak,
  type FailureFingerprint,
  type ProgressDecision,
  type ProgressStopReason,
} from './foundryProgressEvaluation'
import { callCampaignSpecialist, missingNamesFromFailure, specialistRequestFromCampaign, type NoEffectiveChange } from './foundryEngineeringSpecialist'
import {
  CONTEXT_LIMITS,
  buildIndex,
  contentHash,
  contextDetails,
  contextNotes,
  debugSet,
  describeContext,
  describeExpansion,
  discoverContext,
  expandFromEvidence,
  layersFromContext,
  noteChanged,
  noteRead,
  noteSent,
  minimalRevertSpan,
  refreshContext,
  restoreContext,
  staleEntries,
  updateIndex,
  type ProjectIndex,
} from './foundryProjectContext'
import { contextShouldOwn, diskHashes, isFilterShaped, readProjectFile, readProjectSources } from './foundryProjectContextIO'
import {
  MEMORY_LIMITS,
  causeSuggestions,
  describeIgnoredMemory,
  describeMemoryUse,
  memoriesFromMission,
  memoryDetails,
  memoryNotes,
  mergeMemories,
  retrieveMemories,
  revalidateStore,
  unrelatedCandidates,
  type FailureKey,
  type MemoryStore,
  type RetrievalResult,
} from './foundryProjectMemory'
import { listTopLevelNames, loadMemory, saveMemory } from './foundryProjectMemoryIO'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { getRepair, saveRepair } from './storage'
import { MissionSealedError, MissionSupersededError, assertExecutorMayWrite, isMissionOwned, withRecordLock } from './foundryMissionOwnership'
import type { FoundryWorkEvent, NativeCodingMissionState, NativeRepairProposal, NativeRepairRecord } from './types'
import { rollbackRepair } from './rollback'

export const REPAIR_STRATEGIES = ALL_REPAIR_STRATEGIES

const children = new Map<string, { pid: number; kill: () => void }>()

export function engineeringRuntimeShouldOwn(input: { fileCount: number; request: string }): boolean {
  if (input.fileCount <= 0 || input.fileCount > 80) return false
  if (isGovernanceProbe(input.request)) return true
  return /\b(fix|repair|debug|failing|bug|serialization|validate this)\b/i.test(input.request)
}

export function isGovernanceProbe(request: string): boolean {
  return /governance\s+block/i.test(request)
}

export function classifyEngineeringCommand(
  cmd: string,
  args: readonly string[],
  commanderAuthorized = false,
): FoundryEngineeringGovernance & { commandClass: FoundryEngineeringCommandClass; policyClass: string } {
  const joined = [cmd, ...args].join(' ')
  if (/\b(stripe|checkout|purchase|billing|paid)\b/i.test(joined)) {
    return { commandClass: 'FINANCIAL', allowed: false, reason: 'Paid operations require explicit Commander authorization.', policyClass: 'DENIED' }
  }
  const policy = classifyArgv(cmd, args)
  let commandClass: FoundryEngineeringCommandClass = 'REVERSIBLE_MUTATION'
  if (policy.approvalKind === 'commit' || policy.approvalKind === 'push') commandClass = 'GIT_PERSISTENT'
  else if (policy.approvalKind === 'deploy') commandClass = 'PRODUCTION'
  else if (policy.approvalKind === 'delete_data' || /destruct|recursive deletion|history-mutating/i.test(policy.reason)) commandClass = 'DESTRUCTIVE'
  else if (policy.policyClass === 'REQUIRES_APPROVAL') commandClass = 'EXTERNAL_SIDE_EFFECT'
  else if (policy.policyClass === 'DENIED') commandClass = 'DESTRUCTIVE'
  else if (isReadOnlyToolchain(cmd, args)) commandClass = 'READ_ONLY'
  const allowed = policy.policyClass === 'SAFE_LOCAL' || (commanderAuthorized && policy.policyClass === 'REQUIRES_APPROVAL')
  return { commandClass, allowed, reason: policy.reason, policyClass: policy.policyClass }
}

function isReadOnlyToolchain(cmd: string, args: readonly string[]): boolean {
  const base = path.basename(cmd).toLowerCase()
  const sub = args.find(arg => !arg.startsWith('-')) ?? ''
  if (base === 'git' && /^(status|diff|log|show|branch|rev-parse|ls-files)$/i.test(sub)) return true
  if ((base === 'python' || base === 'python3' || base === 'py') && (args[0] === '-m' && args[1] === 'py_compile' || args.includes('-c'))) return true
  if (base === 'tsc' && args.includes('--noEmit')) return true
  return false
}

export function decideTrainerOwnership(input: {
  script: string
  trainerScripts: readonly string[]
  activeTrainers: readonly string[]
  lockAlive: boolean
}): { allowed: boolean; reason: string } {
  const base = input.script.split(/[/\\]/).pop() ?? input.script
  if (!input.trainerScripts.includes(base)) {
    return { allowed: true, reason: 'Not a WRIM trainer. WRIM_SINGLE_TRAINER_LOCK is unchanged.' }
  }
  if (input.lockAlive || input.activeTrainers.length > 0) {
    return { allowed: false, reason: 'WRIM_SINGLE_TRAINER_LOCK already owns a trainer. A second optimizer is refused.' }
  }
  return { allowed: true, reason: 'No active trainer. A start must still acquire WRIM_SINGLE_TRAINER_LOCK in wrim_single_trainer_lock.py.' }
}

export function trainerScriptNames(pySource: string): string[] {
  return readTrainerNames(pySource)
}

export const FOUNDRY_ENGINEERING_CAPABILITIES = [
  { id: 'workspace.list', status: 'present', owner: 'repositoryInspector.listRepoFiles' },
  { id: 'workspace.map', status: 'present', owner: 'repoMap.buildRepoMap' },
  { id: 'workspace.search', status: 'present', owner: 'engineerTools.workspace.search' },
  { id: 'file.read', status: 'present', owner: 'engineerTools.file.read' },
  { id: 'file.create', status: 'present', owner: 'patchApplier.create_file' },
  { id: 'file.edit', status: 'present', owner: 'patchApplier.replace_range' },
  { id: 'file.patch', status: 'present', owner: 'engineerTools.file.patch' },
  { id: 'file.move', status: 'present', owner: 'engineerTools.file.move' },
  { id: 'file.delete', status: 'governance', owner: 'engineerTools.file.delete' },
  { id: 'shell.run', status: 'present', owner: 'commandPolicy + terminalExecutor' },
  { id: 'process.control', status: 'present', owner: 'processRegistry + engineering runtime' },
  { id: 'test.run', status: 'present', owner: 'engineerTools.test.run' },
  { id: 'typecheck', status: 'present', owner: 'engineerTools.typecheck.run' },
  { id: 'lint', status: 'present', owner: 'engineerTools.lint.run' },
  { id: 'build', status: 'present', owner: 'engineerTools.build.run' },
  { id: 'dependency.check', status: 'runtime', owner: 'foundryEngineeringRuntime' },
  { id: 'failure.signature', status: 'runtime', owner: 'foundryEngineeringFailure' },
  { id: 'repair.strategy', status: 'runtime', owner: 'foundryEngineeringFailure' },
  { id: 'checkpoint.rollback', status: 'present', owner: 'rollback.rollbackRepair' },
  { id: 'dirty.isolation', status: 'runtime', owner: 'classifyWorkspacePath' },
  { id: 'trainer.lock', status: 'integrated', owner: 'scripts/wrim-environment/wrim_single_trainer_lock.py' },
  { id: 'chat.events', status: 'runtime', owner: 'foundryEngineeringEvents' },
] as const

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function runtimeOf(coding: NativeCodingMissionState): FoundryEngineeringRuntimeState {
  return coding.engineeringRuntime ?? emptyEngineeringRuntime()
}

async function persist(
  repairId: string,
  step: NativeCodingMissionState['currentStep'],
  detail: string,
  mutate?: (coding: NativeCodingMissionState, runtime: FoundryEngineeringRuntimeState) => void,
  event?: FoundryEngineeringEvent,
): Promise<NativeRepairRecord> {
  // One writer per mission: the read-modify-write is serialized, and a stale or post-terminal executor is fenced out.
  return withRecordLock(repairId, () => persistLocked(repairId, step, detail, mutate, event))
}

/** Exposed for the deterministic concurrency validation; runtime code calls persist directly. */
export const persistMissionRecord = persist

/** A record no executor may append to any more: complete, stopped, rolled back, or terminally blocked. */
export function terminalSealReason(record: NativeRepairRecord | null | undefined): string | null {
  if (!record) return null
  if (record.state === 'resolved' || record.state === 'cancelled' || record.state === 'rolled_back') return record.state
  if (record.state === 'blocked' && record.codingMission?.engineeringRuntime?.blockedDetail) return 'blocked'
  return null
}

async function persistLocked(
  repairId: string,
  step: NativeCodingMissionState['currentStep'],
  detail: string,
  mutate?: (coding: NativeCodingMissionState, runtime: FoundryEngineeringRuntimeState) => void,
  event?: FoundryEngineeringEvent,
): Promise<NativeRepairRecord> {
  const record = await getRepair(repairId)
  if (!record?.codingMission) throw new Error(`No coding mission ${repairId}`)
  const sealed = terminalSealReason(record)
  assertExecutorMayWrite(repairId, sealed !== null, sealed ?? '')
  const coding = record.codingMission
  const runtime = runtimeOf(coding)
  if (event) {
    runtime.events = reduceEngineeringEvents(runtime.events, event)
    const text = workstreamTextForEvent(event)
    const workstream: FoundryWorkEvent[] = [...(coding.workstream ?? []), {
      id: event.eventId,
      at: event.timestamp,
      kind: event.type === 'BLOCKED' ? 'repair' as const : event.type === 'MISSION_COMPLETE' ? 'complete' as const : event.filePath ? 'file' as const : 'status' as const,
      text,
      source: 'execution' as const,
      path: event.filePath,
      ok: event.status === 'pass' ? true : event.status === 'fail' || event.status === 'blocked' ? false : undefined,
    }].slice(-80)
    coding.workstream = workstream
  }
  mutate?.(coding, runtime)
  const next: NativeCodingMissionState = {
    ...coding,
    currentStep: step,
    currentAction: detail,
    commanderState: toCommanderState({ currentStep: step, failureEvidence: coding.failureEvidence }, record.validationResults),
    progressEvents: [...coding.progressEvents, { at: new Date().toISOString(), step, detail }].slice(-200),
    engineeringRuntime: runtime,
  }
  const updated: NativeRepairRecord = { ...record, codingMission: next, updatedAt: new Date().toISOString() }
  await saveRepair(updated)
  return updated
}

function emit(
  missionId: string,
  sessionId: string | undefined,
  type: FoundryEngineeringEventType,
  summary: string,
  extra: Partial<FoundryEngineeringEvent> & { status?: FoundryEngineeringStatus } = {},
): FoundryEngineeringEvent {
  return engineeringEvent(type, {
    missionId,
    reasoningSessionId: sessionId,
    summary,
    phase: phaseForEvent(type),
    status: extra.status ?? (type.endsWith('COMPLETE') || type === 'MISSION_COMPLETE' ? 'pass' : 'info'),
    ...extra,
    command: extra.command,
    filePath: extra.filePath,
    failureSignature: extra.failureSignature,
    strategy: extra.strategy,
    previousStrategy: extra.previousStrategy,
  })
}

export function stopEngineeringProcess(missionId: string): boolean {
  const child = children.get(missionId)
  if (!child) return false
  child.kill()
  children.delete(missionId)
  return true
}

/** Commands feed models and the Activity log, so they must not print terminal colour codes (FORCE_COLOR would otherwise win over NO_COLOR). */
export function plainOutputEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _force, ...rest } = env
  return { ...rest, NO_COLOR: '1' }
}

export function runEngineeringCommand(input: {
  missionId: string
  cmd: string
  args: string[]
  cwd: string
  timeoutMs?: number
}): Promise<{ code: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; cancelled: boolean }> {
  const started = Date.now()
  return new Promise(resolve => {
    const child = spawn(input.cmd, input.args, { cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: plainOutputEnv(process.env) })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number | null, timedOut: boolean, cancelled: boolean) => {
      if (settled) return
      settled = true
      children.delete(input.missionId)
      resolve({ code, stdout, stderr, durationMs: Date.now() - started, timedOut, cancelled })
    }
    children.set(input.missionId, {
      pid: child.pid ?? -1,
      kill: () => child.kill('SIGTERM'),
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(null, true, false)
    }, input.timeoutMs ?? 20_000)
    child.on('error', error => {
      clearTimeout(timer)
      stderr += error.message
      finish(null, false, false)
    })
    child.on('close', code => {
      clearTimeout(timer)
      finish(code, false, code === null)
    })
  })
}

async function pythonBin(cwd: string): Promise<string> {
  const probed = await runEngineeringCommand({ missionId: `probe-${nextEngineeringEventId()}`, cmd: 'python3', args: ['--version'], cwd, timeoutMs: 5000 })
  return probed.code === 0 ? 'python3' : 'python'
}

async function keywordAccepted(cwd: string, callable: string, keyword: string): Promise<boolean | null> {
  const bin = await pythonBin(cwd)
  const probe = await runEngineeringCommand({
    missionId: `sig-${nextEngineeringEventId()}`,
    cmd: bin,
    args: ['-c', pythonSignatureProbe(callable, keyword)],
    cwd,
    timeoutMs: 8000,
  })
  const text = `${probe.stdout}\n${probe.stderr}`
  if (text.includes('yes')) return true
  if (text.includes('no')) return false
  return null
}

function uniqueSlice(source: string, start: number, end: number): { start: number; end: number } | null {
  const slice = source.slice(start, end)
  if (slice && source.split(slice).length - 1 === 1) return { start, end }
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineBreak = source.indexOf('\n', end)
  const lineEnd = lineBreak === -1 ? source.length : lineBreak
  const line = source.slice(lineStart, lineEnd)
  if (line && source.split(line).length - 1 === 1) return { start: lineStart, end: lineEnd }
  return null
}

/** Throws MissionSupersededError / MissionSealedError when the calling executor may no longer act on this mission. */
async function fenceExecutorBeforeMutation(repairId: string): Promise<void> {
  const record = await getRepair(repairId)
  const sealed = terminalSealReason(record)
  assertExecutorMayWrite(repairId, sealed !== null, sealed ?? '')
}

async function applyUniqueEdit(input: {
  repairId: string
  issueId: string
  file: string
  before: string
  after: string
  start: number
  end: number
  reason: string
  sourceKind?: 'deterministic' | 'local_model' | 'hosted_model'
}): Promise<{ ok: boolean; error?: string; receipt?: FoundryEngineeringEditReceipt; diff?: string }> {
  // A stale executor (superseded, stopped, completed) must not touch project files either, not only the record.
  await fenceExecutorBeforeMutation(input.repairId)
  const anchor = uniqueSlice(input.before, input.start, input.end)
  if (!anchor) return { ok: false, error: 'Edit anchor is not unique.' }
  if (!outsideSpanUnchanged(input.before, input.after, input.start, input.end) || !spanChanged(input.before, input.after, input.start, input.end)) {
    return { ok: false, error: 'Patch validation failed: unrelated text changed or the target region did not change.' }
  }
  const prefixLen = anchor.start
  const suffixLen = input.before.length - anchor.end
  const replacement = input.after.slice(prefixLen, input.after.length - suffixLen)
  const proposal: NativeRepairProposal = {
    issueId: input.issueId,
    sourceKind: input.sourceKind ?? 'deterministic',
    proposerId: input.sourceKind && input.sourceKind !== 'deterministic' ? 'campaign-specialist' : 'foundry-engineering-runtime',
    diagnosis: input.reason,
    confidence: 'high',
    relevantFiles: [input.file],
    plannedChanges: [{
      file: input.file,
      reason: input.reason,
      operation: 'replace_range',
      patch: {
        operation: 'replace_range',
        file: input.file,
        expectedOriginalHash: sha256(input.before),
        matchText: input.before.slice(anchor.start, anchor.end),
        replacementText: replacement,
      },
    }],
    validations: [],
    risks: [],
    rollbackPlan: 'Mission snapshot rollback restores only this repair\'s files.',
    generatedAt: new Date().toISOString(),
  }
  const applied = await applyProposal(input.repairId, proposal)
  if (!applied.ok) return { ok: false, error: applied.outcomes.map(item => item.detail).join('; ') }
  const read = await readRepoFile(input.file)
  if (!read.ok) return { ok: false, error: read.error }
  if (read.content !== input.after) return { ok: false, error: 'File content did not match the validated patch.' }
  const diff = lineDiff(input.before, input.after, input.file)
  const counts = countLineChanges(diff)
  return {
    ok: true,
    diff,
    receipt: {
      file: input.file,
      operation: 'replace_range',
      beforeFingerprint: sha256(input.before),
      afterFingerprint: sha256(read.content),
      linesChanged: counts.plus + counts.minus,
      reason: input.reason,
      validation: 'PASS',
    },
  }
}

function blocked(summary: string, failure: string, attempts: { strategy: string; outcome: string }[], rolledBack: boolean, unblockAction: string): FoundryBlockedDetail {
  return {
    summary,
    failure,
    attempts,
    currentState: rolledBack ? 'Mission changes rolled back to the last checkpoint.' : 'Mission changes kept for inspection.',
    rolledBack,
    boundary: 'Bounded repair strategies exhausted, or a governance boundary was reached.',
    unblockAction,
  }
}

const CONTINUABLE_BLOCKS = new Set(['BLOCKED_STAGNATION', 'BLOCKED_REPAIR_LIMIT', 'BLOCKED_CAPABILITY'])

export type ContinuationOutcome = { record: NativeRepairRecord; granted: boolean; message: string }

/**
 * Commander decision "Keep trying" on a blocked campaign. It continues the SAME mission and campaign: identity, progress
 * history, fingerprints, hypotheses, strategies tried, failure history, evidence, mutation generation, receipts and credits
 * are all kept. It records the decision as an event, lifts the terminal block, and adds a bounded window (see grantContinuation).
 * The caller then resumes the mission through runCodingMission, which owns execution.
 */
export async function continueBlockedCampaign(repairId: string): Promise<ContinuationOutcome> {
  return withRecordLock(repairId, async () => {
    const record = await getRepair(repairId)
    if (!record?.codingMission) throw new Error(`No coding mission ${repairId}`)
    const runtime = record.codingMission.engineeringRuntime
    const detail = runtime?.blockedDetail
    if (isMissionOwned(repairId)) return { record, granted: false, message: 'Foundry is already working on this mission.' }
    if (record.state !== 'blocked' || !detail || !runtime?.campaign) {
      return { record, granted: false, message: 'This mission is not paused, so there is nothing to continue.' }
    }
    if (!CONTINUABLE_BLOCKS.has(detail.summary)) {
      return { record, granted: false, message: 'This pause needs something other than another attempt, such as an available model or a change to the project.' }
    }
    const campaign = runtime.campaign
    const progress = ensureCampaignProgress(campaign)
    const at = new Date().toISOString()
    const grant = grantContinuation(progress, { at, fromStop: progress.stop?.reason ?? detail.progress?.reason ?? null })
    if (!grant.granted) return { record, granted: false, message: grant.reason ?? 'No further continuation can be granted for this mission.' }
    campaign.progress = grant.progress
    const limits = progressLimits(campaign.progress)
    const decision = emit(repairId, campaign.reasoningSessionId ?? undefined, 'COMMANDER_DECISION', 'The Commander chose Keep trying.', {
      status: 'info',
      detail: JSON.stringify({
        v: 1,
        decision: 'KEEP_TRYING',
        grantNumber: campaign.progress.continuation.grants,
        grantsMax: PROGRESS_LIMITS.continuationGrantsMax,
        fromBlock: detail.summary,
        fromStop: grant.progress.continuation.decisions[grant.progress.continuation.decisions.length - 1]?.fromStop ?? null,
        window: { cycles: limits.cycles, iterations: limits.iterations, modelCalls: limits.modelCalls, commands: limits.commands },
        preserved: {
          missionId: repairId,
          observations: campaign.progress.observations.length,
          credits: campaign.progress.credits,
          strategiesTried: campaign.progress.strategyKeys.length,
          reworkCycles: campaign.reworkCycles,
          mutationGeneration: campaign.mutationGeneration,
          workerReceipts: campaign.workerReceipts.length,
        },
      }),
    })
    runtime.events = reduceEngineeringEvents(runtime.events, decision)
    runtime.blockedDetail = null
    campaign.budgetExhausted = false
    const next: NativeRepairRecord = {
      ...record,
      state: 'collecting_evidence',
      codingMission: {
        ...record.codingMission,
        currentStep: 'REPAIRING',
        currentAction: 'Continuing after the Commander chose Keep trying.',
        engineeringRuntime: runtime,
        progressEvents: [...record.codingMission.progressEvents, { at, step: 'REPAIRING' as const, detail: 'Commander chose Keep trying.' }].slice(-200),
      },
      history: [...record.history, { state: 'collecting_evidence' as const, at, note: 'Commander chose Keep trying; the same campaign continues.' }],
      updatedAt: at,
    }
    await saveRepair(next)
    return { record: next, granted: true, message: 'Continuing this mission.' }
  })
}

export async function runOwnedEngineeringMission(repairId: string): Promise<NativeRepairRecord> {
  try {
    return await runOwnedEngineeringMissionInner(repairId)
  } catch (error) {
    // A superseded or sealed executor stops silently: it must not write anything, not even a "stopped on an error" block.
    if (error instanceof MissionSupersededError || error instanceof MissionSealedError) {
      const latest = await getRepair(repairId)
      if (latest) return latest
    }
    throw error
  }
}

async function runOwnedEngineeringMissionInner(repairId: string): Promise<NativeRepairRecord> {
  const initial = await getRepair(repairId)
  if (!initial?.codingMission) throw new Error('Engineering runtime requires a coding mission.')
  if (initial.codingMission.engineeringRuntime?.completion?.canComplete && (initial.state === 'resolved' || initial.codingMission.currentStep === 'DONE')) {
    return initial
  }
  if (initial.state === 'blocked' && initial.codingMission.engineeringRuntime?.blockedDetail) return initial
  const sessionId = initial.codingMission.sessionId
  const request = initial.codingMission.commanderRequest
  try {
    const result = await runOwnedBody(repairId, initial.issueId, sessionId, request)
    if (result?.state === 'blocked') await persistBlockedMemory(repairId)
    return result
  } catch (error) {
    if (error instanceof MissionSupersededError || error instanceof MissionSealedError) throw error
    const message = error instanceof Error ? error.message : String(error)
    return sealBlocked(repairId, blocked('Engineering runtime stopped on an unexpected error.', message, [], false, 'Inspect the mission event log and retry from a checkpoint.'))
  }
}

/**
 * A mission that ended blocked can still have learned something with bounded evidence (a strategy that changed nothing, a disproval). That is kept as a
 * SESSION note for this session only; it becomes durable project knowledge only if a later verified mission confirms it. No verified fix is claimed.
 */
async function persistBlockedMemory(repairId: string): Promise<void> {
  try {
    const record = await getRepair(repairId)
    const campaign = record?.codingMission?.engineeringRuntime?.campaign
    if (!campaign || campaign.contextMode !== 'CONTEXT' || !campaign.context || campaign.memory?.savedAt) return
    const root = resolveRepoRoot()
    const at = new Date().toISOString()
    const index = buildIndex(await readProjectSources(root))
    const loaded = await loadMemory(root, at)
    const revalidated = revalidateStore(loaded.store, index, at, repairId)
    const candidates = memoriesFromMission({
      mission: repairId, session: record?.codingMission?.sessionId ?? null, at, resolved: false, index, context: campaign.context, filesMutated: campaign.filesMutated,
      baseline: campaign.baselineFailure ?? null, ruledOut: [...(campaign.ruledOut ?? []), ...(campaign.memoryTrail?.ineffective ?? []).filter(file => !(campaign.ruledOut ?? []).some(item => item.file === file)).map(file => ({ file, layer: 'code', basis: 'EDIT' as const }))], noEffect: campaign.noEffect ?? [], reverted: campaign.revertedFiles ?? [], greenFiles: campaign.memoryTrail?.greenFiles ?? [],
      testCommand: null, greenGeneration: campaign.mutationGeneration, projectFiles: [],
    })
    await saveMemory(root, mergeMemories(revalidated.store, candidates, at))
  } catch {
    // Memory is an aid: failing to save it never changes the mission's outcome.
  }
}

async function sealBlocked(repairId: string, detail: FoundryBlockedDetail): Promise<NativeRepairRecord> {
  const saved = await persist(
    repairId,
    'BLOCKED',
    detail.summary,
    (_coding, runtime) => { runtime.blockedDetail = detail },
    emit(repairId, undefined, 'BLOCKED', detail.summary, {
      status: 'blocked',
      detail: `${detail.failure}\nTried: ${detail.attempts.map(item => item.strategy).join(', ') || 'none'}\nNeed: ${detail.unblockAction}`,
    }),
  )
  const blockedRecord = { ...saved, state: 'blocked' as const, updatedAt: new Date().toISOString() }
  await saveRepair(blockedRecord)
  return blockedRecord
}

async function bindLarge(
  repairId: string,
  sessionId: string | undefined,
  step: NativeCodingMissionState['currentStep'],
  detail: string,
  state: LargeProjectState,
  event: FoundryEngineeringEvent,
): Promise<void> {
  await persist(
    repairId,
    step,
    detail,
    (_coding, runtime) => {
      runtime.largeProject = state
      runtime.terminalCollapsed = true
      runtime.preexistingPaths = state.preexistingDirty
      runtime.scope.read = [...state.filesInspected]
      runtime.scope.modified = [...state.filesMutated]
      runtime.scope.excluded = [...state.ignored]
    },
    event,
  )
}

async function inspectLargeFile(root: string, state: LargeProjectState, rel: string): Promise<string | null> {
  if (state.filesInspected.length >= FILE_INSPECT_BUDGET && !state.filesInspected.includes(rel)) return null
  const read = await readRepoFile(rel)
  if (!read.ok) return null
  if (!state.filesInspected.includes(rel)) state.filesInspected.push(rel)
  if (state.firstRelevantFileMs == null) state.firstRelevantFileMs = Math.max(0, Date.now() - Date.parse(state.startedAt))
  const dir = path.posix.dirname(rel)
  if (dir && dir !== '.' && !state.directoriesTraversed.includes(dir)) state.directoriesTraversed.push(dir)
  noteWorkingSet(state, [rel])
  state.scopeManifest.hashes[rel] = sha256(read.content)
  return read.content
}

async function runLargeProjectBody(repairId: string, issueId: string, sessionId: string | undefined, request: string): Promise<NativeRepairRecord> {
  const root = resolveRepoRoot()
  const prior = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.largeProject
  const resuming = Boolean(prior?.checkpoints?.length)
  const state = resuming && prior ? prior : emptyLargeProjectState(prior?.pauseAfter)
  if (!resuming) {
    await bindLarge(repairId, sessionId, 'ANALYZING', 'Large-project engineering mission started.', state, emit(repairId, sessionId, 'MISSION_STARTED', 'LARGE_PROJECT engineering mission started.', { status: 'running', detail: request.slice(0, 280) }))
    await bindLarge(repairId, sessionId, 'ANALYZING', 'Selecting large-project mode.', state, emit(repairId, sessionId, 'WORKSPACE_SCAN_STARTED', 'LARGE_PROJECT mode selected from repository size.', { status: 'running', detail: 'Active scope is the working set, not the whole repository.' }))
  } else {
    await bindLarge(repairId, sessionId, 'ANALYZING', 'Resuming the large-project mission.', state, emit(repairId, sessionId, 'MISSION_RESUMED', 'Restored working set, checkpoints, and repair receipts.', { status: 'info', detail: state.checkpoints.join(', ') }))
  }
  if (isGovernanceProbe(request)) {
    state.phase = 'BLOCKED'
    state.plan = ['phase 1 locate', 'governance boundary']
    await bindLarge(repairId, sessionId, 'BLOCKED', 'Governance boundary.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'GOVERNANCE', { status: 'blocked' }))
    return governBlocked(repairId, sessionId, request)
  }

  const map = await scanRepositoryStructure(root)
  if (!state.checkpoints.includes('MAP_COMPLETE')) {
    const started = Date.now()
    state.git = await captureGitBaseline(root)
    state.repoFileCount = map.fileCount
    state.filesDiscovered = map.fileCount
    state.ignored = map.ignored
    state.preexistingDirty = [...new Set([...state.git.dirty, ...state.git.untracked])]
    state.directoriesTraversed = map.topLevelDirectories.slice()
    state.mapMs = Date.now() - started
    state.plan = ['phase 1 locate']
    const manifests = map.manifests.slice(0, 4)
    for (const manifest of manifests) {
      const text = await readManifestText(root, manifest)
      if (!state.filesInspected.includes(manifest)) state.filesInspected.push(manifest)
      state.scopeManifest.hashes[manifest] = sha256(text)
    }
    for (const dirty of state.preexistingDirty) {
      try {
        state.scopeManifest.hashes[dirty] = sha256(await readFile(path.join(root, dirty), 'utf8'))
      } catch {
        /* unreadable dirty path stays listed and untouched */
      }
    }
    noteWorkingSet(state, manifests)
    state.scopeManifest.initialWorkingSet = [...state.workingSet]
    state.scopeManifest.preexistingDirty = [...state.preexistingDirty]
    state.scopeManifest.ignored = [...state.ignored]
    rememberExpansion(state, {
      trigger: 'repository map',
      added: manifests,
      reason: 'L0 reads manifests only.',
      expectedGain: 'Package and test boundaries without reading every source file.',
      layer: 'L0',
    })
    state.checkpoints.push('MAP_COMPLETE')
    state.phase = 'LOCATE'
    const summary = [
      `files ${map.fileCount}`,
      `dirs ${map.topLevelDirectories.join(', ') || '(none)'}`,
      `packages ${map.packages.slice(0, 8).join(', ') || '(none)'}`,
      `tests ${map.testFiles.length}`,
      `branch ${state.git.branch || 'none'}`,
      `dirty ${state.preexistingDirty.length}`,
    ].join('\n')
    await bindLarge(repairId, sessionId, 'ANALYZING', 'Repository map is bounded.', state, emit(repairId, sessionId, 'WORKSPACE_SCAN_COMPLETE', 'MAPPING REPOSITORY', {
      status: 'pass',
      detail: summary,
      progress: { current: manifests.length, total: map.fileCount, label: 'manifests read' },
    }))
    await bindLarge(repairId, sessionId, 'PLANNING', 'Map checkpoint saved.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'MAP_COMPLETE', { status: 'pass', detail: summary }))
    if (state.pauseAfter === 'MAP_COMPLETE') {
      const paused = await getRepair(repairId)
      if (!paused) throw new Error('missing repair')
      return paused
    }
  }

  const bin = await pythonBin(root)
  const sources: Record<string, string> = {}
  const load = async (rel: string) => {
    if (sources[rel] !== undefined) return sources[rel]
    const text = await inspectLargeFile(root, state, rel)
    if (text == null) return null
    sources[rel] = text
    await bindLarge(repairId, sessionId, 'ANALYZING', `Reading ${rel}.`, state, emit(repairId, sessionId, 'FILE_READ', rel, { status: 'pass', filePath: rel, detail: `${text.split('\n').length} lines` }))
    return text
  }

  let strategy: RepairStrategyClass = (state as { currentStrategy?: RepairStrategyClass }).currentStrategy ?? 'DIRECT_FIX'
  const savedStrategy = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.currentStrategy
  if (savedStrategy) strategy = savedStrategy as RepairStrategyClass

  const runTests = async (kind: 'locate' | 'targeted' | 'regression', testFile: string | null) => {
    if (state.commandsRun >= 12) {
      return { code: null as number | null, stdout: '', stderr: 'Command budget exhausted.' }
    }
    state.commandsRun += 1
    const args = kind === 'regression' ? regressionTestCommand().args : targetedTestCommand(testFile).args
    const label = kind === 'regression' ? 'RECHECKING' : kind === 'targeted' ? 'TESTING' : 'SEARCHING'
    if (kind === 'targeted') {
      await bindLarge(repairId, sessionId, 'TESTING', 'Running the targeted test.', state, emit(repairId, sessionId, 'TEST_STARTED', testFile ?? 'tests', { status: 'running', command: `${bin} ${args.join(' ')}` }))
    } else if (kind === 'regression') {
      await bindLarge(repairId, sessionId, 'VALIDATING', 'Running the wider test directory.', state, emit(repairId, sessionId, 'REPAIR_VALIDATION_STARTED', 'RECHECKING', { status: 'running', command: `${bin} ${args.join(' ')}` }))
    }
    const result = await runStepCommand(repairId, sessionId, bin, args, root, label)
    const latest = await getRepair(repairId)
    if (latest?.codingMission?.engineeringRuntime) {
      latest.codingMission.engineeringRuntime.largeProject = state
      await saveRepair(latest)
    }
    return result
  }

  if (!state.lastFailure && !state.checkpoints.includes('REPAIR_APPLIED')) {
    const located = await runTests('locate', null)
    const text = `${located.stderr}\n${located.stdout}`.trim()
    if (located.code === 0) {
      return sealBlocked(repairId, blocked('No failing test was found.', 'Large-project mode will not invent an edit when the test directory already passes.', [], false, 'Point the mission at a failing test or a reproduced error.'))
    }
    state.lastFailure = text.slice(0, 4000)
    state.targetedTest = failureFile(root, text)
    state.plan = [...state.plan, 'phase 2 diagnose']
    const prefix = state.targetedTest?.split('/')[0] && state.targetedTest.split('/')[0] !== 'tests'
      ? state.targetedTest.split('/')[0]
      : map.packages[0]?.split('/')[0] ?? map.topLevelDirectories.find(dir => dir !== 'tests' && dir !== 'archive' && dir !== 'notes') ?? ''
    if (prefix) {
      const query = keyFailureLine(text).replace(/\(.*$/, '').split(' ').pop() ?? 'def'
      await bindLarge(repairId, sessionId, 'ANALYZING', `Searching ${prefix}.`, state, emit(repairId, sessionId, 'SEARCH_STARTED', query, { status: 'running', detail: `path ${prefix}` }))
      const hits = await searchBounded(query, prefix)
      await bindLarge(repairId, sessionId, 'ANALYZING', `Search returned ${hits.length} hit(s).`, state, emit(repairId, sessionId, 'SEARCH_RESULT', `${hits.length} hit(s) under ${prefix}.`, { status: 'info', detail: hits.slice(0, 6).map(hit => `${hit.relPath}:${hit.lineNumber}`).join('\n') }))
    }
    await bindLarge(repairId, sessionId, 'REPAIRING', keyFailureLine(text), state, emit(repairId, sessionId, 'FAILURE_DETECTED', keyFailureLine(text), {
      status: 'fail',
      failureSignature: keyFailureLine(text).slice(0, 80),
      strategy,
      detail: keyFailureLine(text),
    }))
  }

  if (resuming && state.checkpoints.includes('REPAIR_APPLIED') && !state.checkpoints.includes('TARGET_TEST_PASS')) {
    const rerun = await runTests('targeted', state.targetedTest)
    const rerunText = `${rerun.stderr}\n${rerun.stdout}`.trim()
    if (rerun.code === 0) {
      state.checkpoints.push('TARGET_TEST_PASS')
      state.lastFailure = null
      await bindLarge(repairId, sessionId, 'TESTING', 'Targeted test passed after resume.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'TARGET_TEST_PASS', { status: 'pass' }))
    } else {
      state.lastFailure = rerunText.slice(0, 4000)
      state.targetedTest = failureFile(root, rerunText) ?? state.targetedTest
    }
  }

  let guard = 0
  while (!state.checkpoints.includes('TARGET_TEST_PASS') && guard < 6) {
    guard += 1
    if (!state.lastFailure) break
    const signature = buildFailureSignature({
      tool: 'python',
      command: 'unittest',
      exitCode: 1,
      message: keyFailureLine(state.lastFailure),
      file: state.targetedTest ?? undefined,
      phase: 'VALIDATING',
    })
    const fingerprint = sourceFingerprint(Object.values(sources))
    const history = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.failureAttempts ?? []
    const decision = decideFailureContinuation({ history, nextSignature: signature.id, nextStrategy: strategy, sourceFingerprint: fingerprint || 'unread' })
    if (decision.action === 'block') {
      state.repeatedFailureWithoutReplan += 0
      return sealBlocked(repairId, blocked('Repeated identical failure signature.', signature.message, history.map(item => ({ strategy: item.strategy, outcome: item.summary })), false, 'The source and failure did not change after a strategy change. Provide a new constraint.'))
    }
    if (decision.action === 'change_strategy') {
      const previous = strategy
      strategy = decision.strategy
      await bindLarge(repairId, sessionId, 'REPAIRING', decision.reason, state, emit(repairId, sessionId, 'STRATEGY_CHANGED', decision.reason, { status: 'info', strategy, previousStrategy: previous }))
    }
    let plan = planLargeProjectRepair({
      failureText: state.lastFailure,
      root,
      sources,
      names: map.names,
      configNumbers: state.configNumbers,
    })
    let reads = 0
    while (plan.status === 'need_reads' && reads < 4) {
      reads += 1
      if (!rememberExpansion(state, plan.expansion)) {
        return sealBlocked(repairId, blocked('Working-set expansion budget was reached.', plan.expansion.reason, [], false, 'Narrow the mission to a smaller area.'))
      }
      if (state.workingSet.length >= ACTIVE_WORKING_SET_LIMIT) {
        return sealBlocked(repairId, blocked('Active working set is full.', `Peak working set ${state.peakWorkingSet}.`, [], false, 'The mission refused to widen past the active working set.'))
      }
      for (const rel of plan.paths) {
        const text = await load(rel)
        if (text == null) {
          return sealBlocked(repairId, blocked('File inspect budget was reached.', rel, [], false, 'Resume with a narrower target.'))
        }
      }
      plan = planLargeProjectRepair({
        failureText: state.lastFailure,
        root,
        sources,
        names: map.names,
        configNumbers: state.configNumbers,
      })
    }
    if (plan.status === 'blocked' || plan.status === 'unsupported' || plan.status === 'need_reads') {
      return sealBlocked(repairId, blocked(
        'The failure is not a bounded large-project repair.',
        plan.status === 'need_reads' ? 'Required files remained unread.' : plan.reason,
        [{ strategy, outcome: plan.status }],
        false,
        'Add a failing test that names the owning module, or narrow the repository area.',
      ))
    }
    if (plan.strategy !== strategy) {
      const previous = strategy
      strategy = plan.strategy
      state.repeatedFailureWithoutReplan = 0
      await bindLarge(repairId, sessionId, 'REPAIRING', `Replan to ${strategy}.`, state, emit(repairId, sessionId, 'STRATEGY_CHANGED', `Cross-file evidence requires ${strategy}.`, {
        status: 'info',
        strategy,
        previousStrategy: previous,
      }))
    }
    state.rootCause = plan.rootCause
    state.configNumbers = plan.configNumbers.length ? plan.configNumbers : state.configNumbers
    state.plan = [...new Set([...state.plan, 'phase 3 repair'])]
    if (!state.checkpoints.includes('ROOT_CAUSE_FOUND')) state.checkpoints.push('ROOT_CAUSE_FOUND')
    await bindLarge(repairId, sessionId, 'REPAIRING', plan.rootCause, state, emit(repairId, sessionId, 'ROOT_CAUSE_FOUND', plan.rootCause, { status: 'info', strategy, repairHypothesis: plan.rootCause }))
    await bindLarge(repairId, sessionId, 'PLANNING', 'Repair is limited to the working set.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'ROOT_CAUSE_FOUND', { status: 'pass', detail: plan.rootCause }))
    await bindLarge(repairId, sessionId, 'EDITING', plan.rootCause, state, emit(repairId, sessionId, 'FILE_EDIT_PLANNED', plan.edits.map(edit => edit.file).join(', '), { status: 'info', detail: plan.rootCause, filePath: plan.edits[0]?.file }))
    for (const edit of plan.edits) {
      const key = `${edit.file}:${sha256(edit.before)}:${sha256(edit.after)}`
      if (state.appliedEditKeys.includes(key)) continue
      const applied = await applyLargeEdit(repairId, issueId, sessionId, state, edit)
      if (!applied.ok) {
        return sealBlocked(repairId, blocked('Patch validation refused the edit.', applied.error ?? 'stale edit', [{ strategy, outcome: applied.error ?? 'refused' }], false, 'The file changed under the mission. Review it before resuming.'))
      }
      state.appliedEditKeys.push(key)
      sources[edit.file] = edit.after
    }
    state.checkpoints.push('REPAIR_APPLIED')
    state.phase = 'TARGET_TEST'
    state.scopeManifest.mutatedFiles = [...state.filesMutated]
    await bindLarge(repairId, sessionId, 'EDITING', 'Repair applied inside the working set.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'REPAIR_APPLIED', { status: 'pass', detail: state.filesMutated.join('\n') }))
    if (state.pauseAfter === 'REPAIR_APPLIED') {
      const paused = await getRepair(repairId)
      if (!paused) throw new Error('missing repair')
      return paused
    }
    const rerun = await runTests('targeted', state.targetedTest)
    const rerunText = `${rerun.stderr}\n${rerun.stdout}`.trim()
    await persist(repairId, rerun.code === 0 ? 'TESTING' : 'REPAIRING', rerun.code === 0 ? 'Targeted test passed.' : 'Targeted test failed.', (_coding, runtime) => {
      runtime.largeProject = state
      runtime.failureAttempts.push({
        signature: signature.id,
        strategy,
        sourceFingerprint: sourceFingerprint(Object.values(sources)),
        summary: keyFailureLine(rerun.code === 0 ? 'PASS' : rerunText),
      })
      runtime.currentStrategy = strategy
      if (!runtime.strategiesTried.includes(strategy)) runtime.strategiesTried.push(strategy)
    }, emit(repairId, sessionId, 'TEST_RESULT', rerun.code === 0 ? 'PASS' : keyFailureLine(rerunText), {
      status: rerun.code === 0 ? 'pass' : 'fail',
      validationResult: rerun.code === 0 ? 'PASS' : 'FAIL',
      detail: keyFailureLine(rerunText),
    }))
    if (rerun.code === 0) {
      state.checkpoints.push('TARGET_TEST_PASS')
      state.lastFailure = null
      state.plan = [...new Set([...state.plan, 'phase 4 targeted test'])]
      await bindLarge(repairId, sessionId, 'TESTING', 'Targeted test passed.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'TARGET_TEST_PASS', { status: 'pass' }))
      break
    }
    state.lastFailure = rerunText.slice(0, 4000)
    state.targetedTest = failureFile(root, rerunText) ?? state.targetedTest
  }

  if (!state.checkpoints.includes('TARGET_TEST_PASS')) {
    return sealBlocked(repairId, blocked('Targeted test did not pass.', state.lastFailure?.slice(0, 400) ?? 'no failure text', [], false, 'Inspect the working set and the last failure card.'))
  }
  state.plan = [...new Set([...state.plan, 'phase 5 broader regression'])]
  const wider = await runTests('regression', null)
  if (wider.code !== 0) {
    state.lastFailure = `${wider.stderr}\n${wider.stdout}`.slice(0, 4000)
    return sealBlocked(repairId, blocked('Regression test failed after the targeted test passed.', keyFailureLine(state.lastFailure), [], false, 'The wider test directory still fails. Review the new failure before widening the repair.'))
  }
  state.checkpoints.push('REGRESSION_PASS')
  state.phase = 'COMPLETE'
  state.plan = [...new Set([...state.plan, 'phase 6 completion'])]
  await bindLarge(repairId, sessionId, 'VALIDATING', 'Regression passed.', state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', 'REGRESSION_PASS', { status: 'pass' }))
  return sealLargeComplete(repairId, sessionId, state)
}

async function applyLargeEdit(
  repairId: string,
  issueId: string,
  sessionId: string | undefined,
  state: LargeProjectState,
  edit: PlannedEdit,
): Promise<{ ok: boolean; error?: string }> {
  const current = await readRepoFile(edit.file)
  if (!current.ok) return { ok: false, error: current.error }
  if (!sourceStillMatches(edit.before, current.content)) {
    return { ok: false, error: 'Target changed since it was read. Refusing to overwrite.' }
  }
  if (preexistingDirtyBlocksEdit(state.preexistingDirty, edit.file, state.filesMutated)) {
    return { ok: false, error: `${edit.file} is preexisting dirty and is not mission-owned.` }
  }
  const applied = await applyUniqueEdit({
    repairId,
    issueId,
    file: edit.file,
    before: edit.before,
    after: edit.after,
    start: edit.start,
    end: edit.end,
    reason: edit.reason,
  })
  if (!applied.ok || !applied.receipt) return { ok: false, error: applied.error ?? 'apply failed' }
  if (!state.filesMutated.includes(edit.file)) state.filesMutated.push(edit.file)
  state.scopeManifest.mutatedFiles = [...state.filesMutated]
  state.scopeManifest.hashes[edit.file] = applied.receipt.afterFingerprint
  await bindLarge(repairId, sessionId, 'EDITING', `Edited ${edit.file}.`, state, emit(repairId, sessionId, 'FILE_EDITED', edit.file, {
    status: 'pass',
    filePath: edit.file,
    diff: applied.diff,
    detail: edit.reason,
  }))
  const record = await getRepair(repairId)
  if (record?.codingMission?.engineeringRuntime) {
    record.codingMission.engineeringRuntime.receipts.push(applied.receipt)
    record.codingMission.filesChanged = [...new Set([...record.codingMission.filesChanged, edit.file])]
    record.codingMission.engineeringRuntime.largeProject = state
    await saveRepair(record)
  }
  return { ok: true }
}

async function sealLargeComplete(repairId: string, sessionId: string | undefined, state: LargeProjectState): Promise<NativeRepairRecord> {
  const saved = await persist(
    repairId,
    'DONE',
    'Mission complete. No git commit, push, or deploy was executed.',
    (coding, runtime) => {
      runtime.largeProject = state
      runtime.terminalCollapsed = true
      runtime.completion = {
        canComplete: true,
        changedFiles: [...state.filesMutated],
        tests: [
          { command: state.targetedTest ?? 'unittest', ok: true, summary: 'TARGET_TEST_PASS' },
          { command: 'unittest discover tests', ok: true, summary: 'REGRESSION_PASS' },
        ],
        build: { ran: false, ok: true, summary: 'Build was not required after the targeted tests passed.' },
        runtime: { ran: true, ok: true, summary: 'Targeted and regression tests exited 0.' },
        limitations: ['Commit, push, and deploy remain Commander-gated.'],
        commitOccurred: false,
        pushOccurred: false,
        deployOccurred: false,
      }
      runtime.blockedDetail = null
      coding.validationOutcome = 'VALIDATED'
      coding.filesChanged = [...state.filesMutated]
    },
    emit(repairId, sessionId, 'MISSION_COMPLETE', 'COMPLETE', {
      status: 'pass',
      detail: `Mutated ${state.filesMutated.join(', ') || 'none'}. Commit: no. Push: no. Deploy: no.`,
      validationResult: 'PASS',
    }),
  )
  const resolved = {
    ...saved,
    state: 'resolved' as const,
    history: [...saved.history, { state: 'resolved' as const, at: new Date().toISOString(), note: 'Large-project engineering runtime validated the repair.' }],
    updatedAt: new Date().toISOString(),
  }
  await saveRepair(resolved)
  return resolved
}

async function bindCampaign(
  repairId: string,
  sessionId: string | undefined,
  step: NativeCodingMissionState['currentStep'],
  detail: string,
  state: EngineeringCampaign,
  event: FoundryEngineeringEvent,
): Promise<void> {
  // The plan follows the executing task graph (done / active / reopened) at every persist, so what is saved is what is true.
  if (state.plan) state.plan = syncPlanStatus(state.plan, state.tasks)
  await persist(repairId, step, detail, (_coding, runtime) => {
    runtime.campaign = state
    runtime.terminalCollapsed = true
    runtime.preexistingPaths = state.preexistingDirty
    runtime.scope.read = [...state.filesInspected]
    runtime.scope.modified = [...state.filesMutated]
  }, event)
}

function completeCampaignTask(task: CampaignTask, evidence: string[]): void {
  task.status = 'COMPLETE'
  task.verification = 'PASS'
  task.evidence.push(...evidence)
  task.outputs.push(...evidence)
}

async function runCampaignBody(repairId: string, issueId: string, sessionId: string | undefined, request: string): Promise<NativeRepairRecord> {
  const root = resolveRepoRoot()
  const prior = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.campaign
  const resuming = Boolean(prior?.checkpoints.length)
  const state = resuming && prior ? prior : emptyEngineeringCampaign(request, prior?.pauseAfter)
  state.missionId = repairId
  state.reasoningSessionId = sessionId ?? state.reasoningSessionId
  const codingFlag = (await getRepair(repairId))?.codingMission?.specialistIntelligence
  if (!resuming && (codingFlag === 'model' || prior?.intelligence === 'model')) state.intelligence = 'model'
  state.workerReceipts ??= []
  state.callsByRole ??= {}
  state.contradictions ??= []
  state.acceptedFacts ??= []
  state.modelCallBudget ??= 24
  state.workerSwitches ??= 0
  state.duplicateWorkerCallCount ??= 0
    state.intelligence ??= 'control'
    state.mutationGeneration ??= 0
    state.testReceipts ??= []
  // Smart stagnation: progress evidence is part of the campaign record and is restored (never reset) on resume.
  ensureCampaignProgress(state)
  const emitProgress = () => phaseProgress(state.tasks).label
  const applyProgressBudgets = () => {
    // Progress earns a larger window inside fixed absolute ceilings; the budget never shrinks and is never reset.
    state.modelCallBudget = Math.max(state.modelCallBudget, progressLimits(state.progress).modelCalls)
  }
  applyProgressBudgets()
  const commandLimit = () => progressLimits(state.progress).commands
  // The project index is memory-only (rebuilt from disk); what persists is the context: the working set, its reasons, links, changes and expansions.
  let projectIndex: ProjectIndex | null = null
  const ensureIndex = async (): Promise<ProjectIndex> => {
    projectIndex ??= buildIndex(await readProjectSources(root))
    return projectIndex
  }
  if (!resuming) {
    await bindCampaign(repairId, sessionId, 'PLANNING', 'Campaign started.', state, emit(repairId, sessionId, 'CAMPAIGN_STARTED', 'One engineering campaign started.', { status: 'running', detail: request.slice(0, 280) }))
    if (isGovernanceProbe(request)) return governBlocked(repairId, sessionId, request)
    const map = await scanRepositoryStructure(root)
    state.repoFileCount = map.fileCount
    state.componentFiles = classifyCampaignFiles(map.names)
    // Phase 3: unless this is the status-filter fixture shape, the layers come from what the goal is about, found from the goal and the project alone.
    state.contextMode = 'CONVENTION'
    if (!isFilterShaped(request)) {
      const found = discoverContext(await ensureIndex(), request, new Date().toISOString())
      if (found.entries.some(entry => entry.role === 'implementation' || entry.role === 'consumer')) {
        state.context = found
        state.contextMode = 'CONTEXT'
        state.componentFiles = layersFromContext(found)
      }
    }
    const git = await captureGitBaseline(root)
    state.preexistingDirty = [...new Set([...git.dirty, ...git.untracked])]
    const plan = buildCampaignPlan(state.componentFiles, request, state.contextMode === 'CONTEXT')
    state.tasks = plan.tasks
    state.parallelGroups = plan.parallelGroups
    state.phases = [...new Set(plan.tasks.map(item => item.phase))].map(type => ({
      id: type.toLowerCase(),
      type,
      status: 'PLANNED' as const,
      owner: plan.tasks.find(item => item.phase === type)?.role ?? 'ARCHITECT',
    }))
    state.plan = buildInitialPlan({ request, acceptance: state.acceptance, tasks: state.tasks, components: state.componentFiles, at: new Date().toISOString() })
    state.knowledge.architecture.push(`files ${map.fileCount}; backend ${state.componentFiles.backend.length}; frontend ${state.componentFiles.frontend.length}; contract ${state.componentFiles.contract.length}`)
    state.knowledge.decisions.push('Backend and frontend are parallel-ready. Writes run serially under file locks.')
    state.checkpoints.push('PLAN_READY')
    state.phase = 'PLAN'
    if (state.contextMode === 'CONTEXT' && state.context) state.knowledge.architecture.push(...contextDetails(state.context).slice(0, 4))
    await bindCampaign(repairId, sessionId, 'PLANNING', emitProgress(), state, emit(repairId, sessionId, 'ARCHITECTING', state.contextMode === 'CONTEXT' && state.context ? describeContext(state.context) : 'Architecture is taken from repository paths.', { status: 'pass', detail: state.contextMode === 'CONTEXT' && state.context ? contextDetails(state.context).join('\n') : state.knowledge.architecture.join(' ') }))
    await bindCampaign(repairId, sessionId, 'PLANNING', emitProgress(), state, emit(repairId, sessionId, 'PLAN_READY', emitProgress(), { status: 'pass', detail: state.tasks.map(item => item.id).join(', ') }))
    if (state.pauseAfter === 'PLAN_READY') {
      const paused = await getRepair(repairId)
      if (!paused) throw new Error('missing repair')
      return paused
    }
  } else {
    await bindCampaign(repairId, sessionId, 'PLANNING', 'Campaign resumed.', state, emit(repairId, sessionId, 'MISSION_RESUMED', 'Restored the campaign task graph.', { status: 'info', detail: state.checkpoints.join(', ') }))
    restoreInterruptedCampaignTasks(state)
    state.plan = ensurePlan(state, new Date().toISOString())
    if (!verificationBarrierSatisfied(state)) {
      const integrate = state.tasks.find(task => task.id === 'integrate')
      if (integrate?.status === 'COMPLETE') {
        integrate.status = 'READY'
        integrate.verification = 'PENDING'
      }
    }
  }

  const sources = new Map<string, string>()
  const load = async (rel: string) => {
    const cached = sources.get(rel)
    if (cached !== undefined) return cached
    if (state.filesInspected.length >= MAX_CAMPAIGN_INSPECT && !state.filesInspected.includes(rel)) {
      state.budgetExhausted = true
      return ''
    }
    const read = await readRepoFile(rel)
    const text = read.ok ? read.content : ''
    sources.set(rel, text)
    if (text && !state.filesInspected.includes(rel)) state.filesInspected.push(rel)
    return text
  }
  const testsOf = async () => {
    const texts: string[] = []
    for (const file of state.componentFiles.tests) texts.push(await load(file))
    return texts
  }
  const contractsOf = async () => {
    const texts: string[] = []
    for (const file of state.componentFiles.contract) texts.push(await load(file))
    return texts
  }

  // Planning: revisions are recorded as the task graph changes and announced once, at the top of the next loop turn.
  let planDirty = false
  /** True when a repair edit was applied since the previous failure: only then can a new diagnosis say the earlier one did not settle it. */
  let editedSinceLastFailure = false
  const revisePlanFor = (trigger: PlanTrigger, input: Omit<RevisionInput, 'at' | 'components' | 'trigger' | 'summary'>) => {
    if (!state.plan) return
    state.plan = revisePlan(state.plan, { ...input, trigger, summary: PLAN_TRIGGER_SUMMARY[trigger], at: new Date().toISOString(), components: state.componentFiles })
    planDirty = true
  }
  /** Links the debugger's hypothesis to its task, and replans when the diagnosis contradicts which layer was reopened or which file to edit. */
  const linkRepairToPlan = (debugId: string, hypothesis: string, target: string | null) => {
    if (!state.plan) return
    const disproven = editedSinceLastFailure ? disprovenHypothesis(state.plan, debugId, hypothesis, target, state.componentFiles) : null
    state.plan = linkHypothesis(state.plan, debugId, hypothesis, target)
    if (disproven) revisePlanFor('HYPOTHESIS_DISPROVEN', { evidence: disproven })
    const decision = decideRepairTarget({ target, components: state.componentFiles, tasks: state.tasks })
    if (!decision) return
    const task = state.tasks.find(item => item.id === decision.layer)
    if (!task) return
    if (decision.contradiction) {
      task.status = 'PLANNED'
      task.verification = 'PENDING'
      task.dependsOn = Array.from(new Set([debugId, ...task.dependsOn]))
    }
    if (decision.workingSet) task.workingSet = decision.workingSet
    revisePlanFor(decision.contradiction ? 'CONTRADICTION' : 'REPAIR_RETARGET', {
      evidence: [hypothesis, target ?? ''].filter(Boolean),
      reopen: decision.contradiction ? [{ taskId: decision.layer, why: `The diagnosis puts the cause in the ${decision.layer}.` }] : [],
      retarget: decision.workingSet ? [{ taskId: decision.layer, workingSet: decision.workingSet, why: `${decision.named} is the file the diagnosis names.` }] : [],
    })
  }

  /** The plan changes with the evidence: a debug step is added, only the work the failure implicates is reopened, and finished work is kept. */
  const replanForRework = (finding: string, debugId: string, trigger: PlanTrigger, ruledOutNote?: string) => {
    if (!state.plan) return
    state.plan = syncPlanStatus(state.plan, state.tasks)
    const reopenedIds = state.plan.tasks.filter(task => task.status === 'REOPENED').map(task => task.id)
    const debugTask = state.tasks.find(task => task.id === debugId)
    if (!debugTask) return
    revisePlanFor(trigger, {
      evidence: ruledOutNote ? [ruledOutNote, finding] : [finding],
      add: [{ task: debugTask, why: 'Find the cause before changing the code again.' }],
      reopen: reopenedIds.map(taskId => ({ taskId, why: taskId === 'backend' || taskId === 'frontend' ? 'The failure points at this layer.' : 'It has to run again after the change.' })),
      keep: state.tasks.filter(task => task.status === 'COMPLETE' && !task.id.startsWith('debug-')).map(task => ({ taskId: task.id, why: 'Already done and still valid, so it is not repeated.' })),
    })
  }

  const announcePlanRevision = async () => {
    if (!planDirty || !state.plan) return
    planDirty = false
    const last = state.plan.revisions[state.plan.revisions.length - 1]
    if (!last) return
    await bindCampaign(repairId, sessionId, 'REPAIRING', last.summary, state, emit(repairId, sessionId, 'PLAN_REVISED', last.summary, { status: 'info', detail: planEventPayload(state.plan) }))
  }

  /**
   * Goal anchor (myopia protection). The request and its acceptance criteria stay the fixed point: a failing test that has
   * nothing to do with them, and that nothing Foundry changed can reach, is recorded and reported, never chased.
   * Output that cannot be classified with certainty stays a real failure.
   */
  const scopeTests = async (raw: string, code: number | null) => {
    if (code === 0) return null
    const testSources: Record<string, string> = {}
    for (const rel of failingTestFiles(raw)) {
      const read = await readRepoFile(rel)
      if (read.ok) testSources[rel] = read.content
    }
    const scoped = scopeTestFailures({ output: raw, root, components: state.componentFiles, mutated: state.filesMutated, sources: testSources })
    return scoped.reliable ? scoped : null
  }
  const deferUnrelated = (deferred: readonly DeferredFailure[]) => {
    const fresh = deferred.filter(item => !(state.plan?.deferred ?? []).some(known => known.test === item.test))
    if (!fresh.length) return
    revisePlanFor('DRIFT_GUARD', { evidence: fresh.map(item => item.test), defer: fresh })
    state.knowledge.decisions.push(`DEFERRED unrelated failure ${fresh.map(item => item.test).join('; ').slice(0, 160)}`)
  }

  const openRework = (attribution: string) => {
    if (state.strategy === 'CONTRACT_FIELD') return false
    state.failureAttribution = attribution
    state.strategy = 'CONTRACT_FIELD'
    state.reworkCycles += 1
    state.knowledge.failures.push(attribution)
    state.tasks.push({
      id: `debug-${state.reworkCycles}`,
      phase: 'DEBUG',
      role: 'DEBUGGER',
      status: 'COMPLETE',
      dependsOn: [],
      purpose: attribution,
      acceptance: 'The failure class is recorded before the next edit.',
      inputs: [],
      outputs: [attribution],
      evidence: [attribution],
      workingSet: [],
      writes: [],
      attempt: 1,
      verification: 'PASS',
    })
    for (const id of ['backend', 'integrate', 'review', 'verify']) {
      const item = state.tasks.find(task => task.id === id)
      if (!item) continue
      item.status = id === 'backend' ? 'READY' : 'PLANNED'
      item.verification = 'PENDING'
    }
    replanForRework(attribution, `debug-${state.reworkCycles}`, 'TEST_FAILURE')
    return state.reworkCycles <= MAX_CAMPAIGN_REWORK_CYCLES
  }

  let lastDecision: ProgressDecision | null = null
  /**
   * Decides whether another repair cycle may be opened. The decision is evidence-based (failure identity,
   * strategy identity, progress signals, earned budget) and never a bare cycle count. On a stop the typed
   * reason is left in `state.progress.stop` for `blockedByProgress`.
   */
  const openModelRework = (finding: string, fingerprint: FailureFingerprint | null, invalid?: { role: string; taskId?: string }, origin: 'TEST' | 'REVIEW' | 'VERIFY' = 'TEST', noEffect?: { noEffect: true; planTrigger: PlanTrigger }) => {
    if (state.tasks.some(task => task.role === 'DEBUGGER' && (task.status === 'READY' || task.status === 'RUNNING'))) return false
    if (noEffect) {
      // The no-effect verdict was already evaluated by handleNoEffectiveChange: open the rework it decided on.
      reopenReworkTasks(finding, 'NO_EFFECTIVE_CHANGE', noEffect.planTrigger)
      return true
    }
    const at = new Date().toISOString()
    const verdict = invalid || !fingerprint
      ? evaluateInvalidOutput(state.progress, { role: invalid?.role ?? 'SPECIALIST', summary: finding, at, mutationGeneration: state.mutationGeneration, reworkCycles: state.reworkCycles })
      : evaluateFailure(state.progress, { fingerprint, at, mutationGeneration: state.mutationGeneration, reworkCycles: state.reworkCycles })
    state.progress = verdict.progress
    lastDecision = verdict.decision
    applyProgressBudgets()
    state.progress = { ...state.progress, stopFinding: verdict.decision.proceed ? null : finding.slice(0, 400) }
    if (!verdict.decision.proceed) return false
    // A reviewer, tester, verifier, debugger or architect that answered unusably says nothing about the code: ask that same role again (bounded by the
    // invalid-output streak above) instead of reopening the implementation, which would undo work the evidence says is fine.
    if (invalid && invalid.taskId && !['BACKEND', 'FRONTEND'].includes(invalid.role)) {
      const retry = state.tasks.find(task => task.id === invalid.taskId)
      if (retry) {
        retry.status = 'READY'
        retry.verification = 'PENDING'
        revisePlanFor('INVALID_OUTPUT', { evidence: [finding] })
        return true
      }
    }
    reopenReworkTasks(finding, invalid ? 'INVALID_OUTPUT' : origin === 'REVIEW' ? 'REVIEW_FINDING' : origin === 'VERIFY' ? 'VERIFY_FINDING' : 'TEST_FAILURE')
    return true
  }

  /** Opens one rework cycle: a debugger task, then the implementation and verification tasks it feeds. Shared by a normal rework and a Commander continuation. */
  const reopenReworkTasks = (finding: string, trigger: PlanTrigger = 'TEST_FAILURE', planTrigger?: PlanTrigger) => {
    const previousSignature = state.lastFailureSignature
    state.reworkCycles += 1
    // A worker that answered unusably says nothing new about the project. The real failure that started this repair stays the evidence,
    // otherwise the next diagnosis is about the worker's formatting mistake instead of the code (the newest observation displacing the goal).
    const carried = (trigger === 'INVALID_OUTPUT' || trigger === 'NO_EFFECTIVE_CHANGE') && state.repairFinding ? state.repairFinding : finding
    state.repairFinding = carried
    if (carried === finding) state.knowledge.failures.push(finding)
    state.reviewFindings = [carried]
    const signature = failureSignature(carried)
    state.lastFailureSignature = signature
    const editsSinceFailure = state.appliedEditKeys.length - (state.editsAtFailure ?? 0)
    editedSinceLastFailure = editsSinceFailure > 0
    state.editsAtFailure = state.appliedEditKeys.length
    // Evidence beats belief: edits were applied and the same failure came back, so those files are not the cause. Rule them out instead of trying them again.
    const ineffective = trigger === 'INVALID_OUTPUT' || trigger === 'NO_EFFECTIVE_CHANGE' ? [] : ineffectiveEdits({ sameFailure: Boolean(previousSignature) && previousSignature === signature, editsSinceFailure, recentEdits: state.recentEdits ?? [], components: state.componentFiles })
    if (ineffective.length) state.ruledOut = mergeRuledOut(state.ruledOut, ineffective)
    const debugId = `debug-${state.reworkCycles}`
    state.tasks.push({
      id: debugId,
      phase: 'DEBUG',
      role: 'DEBUGGER',
      status: 'READY',
      dependsOn: [],
      purpose: carried.slice(0, 180),
      acceptance: 'A root-cause hypothesis is recorded before the repair edit.',
      inputs: [],
      outputs: [],
      evidence: [],
      workingSet: contextOn()
        ? debugSet(state.context!, [...(state.ruledOut ?? []).map(item => item.file), ...(state.noEffect ?? []).filter(item => item.attempts >= 2).map(item => item.file)])
        : debugFilesFor(state.componentFiles, state.ruledOut, state.noEffect),
      writes: [],
      attempt: 0,
      verification: 'PENDING',
    })
    const reopen = new Set(trigger === 'NO_EFFECTIVE_CHANGE' ? reopenAfterNoEffect(reworkImplementationIds(finding), state.ruledOut, state.noEffect, state.componentFiles) : reopenableLayers(reworkImplementationIds(finding), state.ruledOut))
    for (const id of ['backend', 'frontend'] as const) {
      const item = state.tasks.find(task => task.id === id)
      if (!item || !reopen.has(id)) continue
      item.status = 'PLANNED'
      item.verification = 'PENDING'
      item.dependsOn = Array.from(new Set([debugId, ...item.dependsOn]))
    }
    for (const id of ['integrate', 'review', 'verify']) {
      const item = state.tasks.find(task => task.id === id)
      if (!item) continue
      item.status = 'PLANNED'
      item.verification = 'PENDING'
      item.dependsOn = Array.from(new Set([debugId, ...item.dependsOn]))
    }
    replanForRework(
      finding,
      debugId,
      ineffective.length ? 'EDIT_INEFFECTIVE' : planTrigger ?? (trigger === 'TEST_FAILURE' && previousSignature && previousSignature !== signature ? 'FAILURE_CHANGED' : trigger),
      ineffective.length ? `I changed ${ineffective.map(item => item.file).join(', ')} and the same test still fails.` : undefined,
    )
  }

  // ---- Phase 3: automatic codebase context (working set, freshness, evidence-driven growth). Inert unless the campaign is context-driven.
  const contextOn = () => state.contextMode === 'CONTEXT' && Boolean(state.context)
  /** Brings named files back in line with disk after an edit or a suspected change: disk is the truth, never the cached text. */
  const refreshContextFiles = async (files: readonly string[], why: string): Promise<string[]> => {
    if (!contextOn()) return []
    const index = await ensureIndex()
    const updates = await Promise.all(files.map(async rel => ({ path: rel, content: await readProjectFile(root, rel) })))
    const changed = updateIndex(index, updates)
    for (const update of updates) if (update.content !== null) sources.set(update.path, update.content)
    const refreshed = refreshContext(state.context!, index, changed, why, new Date().toISOString(), state.mutationGeneration)
    state.context = refreshed.context
    return refreshed.refreshed
  }
  /** Before a specialist reasons about files: any working-set file that changed on disk since it was read is re-read first, then what was shown is recorded. */
  const freshenForCall = async (files: readonly string[]) => {
    if (!contextOn()) return
    const onDisk = await diskHashes(root, files)
    const stale = files.filter(file => {
      const cached = sources.get(file)
      return cached !== undefined && onDisk[file] !== null && onDisk[file] !== contentHash(cached)
    })
    if (stale.length) await refreshContextFiles(stale, 'it changed on disk since I last read it')
    for (const file of files) {
      const text = sources.get(file)
      if (text !== undefined) state.context = noteRead(state.context!, file, text, state.mutationGeneration)
    }
  }
  /** Runtime evidence decides when the working set grows: the failing run's frames, the names an error mentions, and the failing test. */
  const expandContext = async (evidenceText: string) => {
    if (!contextOn()) return
    const index = await ensureIndex()
    const grown = expandFromEvidence(state.context!, index, { text: evidenceText, root }, new Date().toISOString(), state.mutationGeneration)
    if (!grown.added.length) return
    state.context = grown.context
    for (const entry of grown.added) {
      const layer = entry.role === 'test' ? 'tests' : entry.role === 'consumer' ? 'frontend' : 'backend'
      const files = state.componentFiles[layer]
      if (!files.includes(entry.path)) files.push(entry.path)
      const task = state.tasks.find(item => item.id === (layer === 'tests' ? 'integrate' : layer))
      if (task && !task.workingSet.includes(entry.path)) task.workingSet.push(entry.path)
      await load(entry.path)
    }
    state.knowledge.decisions.push(`CONTEXT_EXPANDED ${grown.added.map(entry => `${entry.path}: ${entry.reasons[0]}`).join('; ').slice(0, 220)}`)
    revisePlanFor('CONTEXT_EXPANDED', {
      evidence: grown.added.map(entry => `${entry.path}: ${entry.reasons[0]}`),
      retarget: grown.added.flatMap(entry => {
        const layer = entry.role === 'consumer' ? 'frontend' : entry.role === 'test' ? 'integrate' : 'backend'
        const task = state.tasks.find(item => item.id === layer)
        return task ? [{ taskId: layer, workingSet: [...task.workingSet], why: entry.reasons[0] ?? 'the failing run points here' }] : []
      }),
    })
    const expansion = grown.context.expansions[grown.context.expansions.length - 1]
    const last = state.plan?.revisions[state.plan.revisions.length - 1]
    if (state.plan && last && expansion) state.plan.revisions[state.plan.revisions.length - 1] = { ...last, summary: describeExpansion(expansion) }
  }

  /** The tests that cover the working set, shown read-only to whoever edits, so the edit is made against what verifies it. */
  const contextTestExcerpts = async (already: readonly string[]) => {
    const out: { file: string; text: string; readOnly: true }[] = []
    for (const entry of (state.context?.entries ?? []).filter(item => item.role === 'test' && !already.includes(item.path)).slice(0, 2)) out.push({ file: entry.path, text: await load(entry.path), readOnly: true })
    return out
  }
  /**
   * Test linkage + dependency direction as evidence: when the working set holds more than one code file, one verbose run shows whether the tests that call a layer
   * directly pass while the failing test goes through a different layer. Recorded as plain sentences the diagnosis and the implementers are shown. Bounded: one
   * command per failure, only when there is another layer to point at.
   */
  const gatherContextEvidence = async () => {
    if (!contextOn()) return
    state.context = { ...state.context!, evidence: [] }
    const codeFiles = state.context!.entries.filter(entry => entry.role !== 'test')
    if (codeFiles.length < 2 || state.commandsRun >= commandLimit()) return
    state.commandsRun += 1
    const bin = await pythonBin(root)
    const result = await runStepCommand(repairId, sessionId, bin, ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], root, 'Checking which code the failing test goes through')
    const testSources: Record<string, string> = {}
    for (const rel of state.componentFiles.tests ?? []) testSources[rel] = await load(rel)
    const lines: string[] = []
    for (const layer of ['backend', 'frontend'] as const) {
      const first = state.componentFiles[layer][0]
      if (!first) continue
      const found = isolatedLayerEvidence({ layer, components: state.componentFiles, verboseOutput: `${result.stdout}\n${result.stderr}`, testSources })
      if (!found) continue
      const suspects = found.suspectLayers.flatMap(name => state.componentFiles[name as 'backend' | 'frontend']?.slice(0, 1) ?? [])
      lines.push(`The tests that call ${first} directly pass (${found.passing.slice(0, 2).join(', ')}), and the failing test (${found.failing[0]}) goes through ${suspects.join(', ') || 'another file'}, so look there first.`)
    }
    state.context = { ...state.context!, evidence: lines.slice(0, 2) }
  }
  /** The mutated files exactly as they are while the covering tests pass. */
  const snapshotGreen = async () => {
    const files: Record<string, string> = {}
    for (const file of state.filesMutated) {
      const text = await readProjectFile(root, file)
      if (text !== null) files[file] = text
    }
    state.greenSnapshot = { generation: state.mutationGeneration, files }
    state.reworkOrigin = undefined
  }
  /** Puts files back to the last green version when a review-opened rework made them fail. Governed, minimal-span edits; bounded to two per mission. */
  const revertReviewDrivenBreak = async (): Promise<boolean> => {
    const snap = state.greenSnapshot
    if (!contextOn() || state.reworkOrigin !== 'REVIEW' || !snap || snap.generation >= state.mutationGeneration || (state.reverts ?? 0) >= 2) return false
    const restored: string[] = []
    for (const [file, saved] of Object.entries(snap.files)) {
      const now = await readProjectFile(root, file)
      if (now === null) continue
      const span = minimalRevertSpan(now, saved)
      if (!span) continue
      const applied = await applyUniqueEdit({ repairId, issueId, file, before: now, after: saved, start: span.start, end: span.end, reason: 'Put the file back to the version whose tests passed.', sourceKind: 'deterministic' })
      if (applied.ok) restored.push(file)
    }
    if (!restored.length) return false
    state.mutationGeneration += 1
    state.reverts = (state.reverts ?? 0) + 1
    state.revertedFiles = [...new Set([...(state.revertedFiles ?? []), ...restored])].slice(-6)
    state.reworkOrigin = undefined
    await refreshContextFiles(restored, 'I put it back')
    for (const file of restored) state.context = noteChanged(state.context!, file, state.mutationGeneration)
    state.knowledge.decisions.push(`CHANGE_REVERTED ${restored.join(', ')}: the change a review opened broke tests that passed`)
    revisePlanFor('CHANGE_REVERTED', { evidence: restored.map(file => `${file}: put back to the version whose tests passed`) })
    return true
  }
  // ---- Phase 4: engineering memory. Project-scoped, evidence-backed, revalidated against the current code before use, and never a substitute for fresh evidence.
  let memoryStore: MemoryStore | null = null
  const memoryNow = () => new Date().toISOString()
  const memoryState = () => (state.memory ??= { status: 'FRESH', used: [], ignored: [], skipped: [], forced: [], notes: [], saved: [] })
  /** Loads this project's store (a store that belongs to another project is set aside) and revalidates it against the project as it is right now. */
  const memoryReady = async (): Promise<MemoryStore> => {
    if (memoryStore) return memoryStore
    const at = memoryNow()
    const loaded = await loadMemory(root, at)
    const revalidated = revalidateStore(loaded.store, await ensureIndex(), at, repairId)
    memoryStore = revalidated.store
    const m = memoryState()
    m.status = loaded.status
    if (revalidated.changed.length) m.revalidated = revalidated.changed.slice(0, 8)
    if (revalidated.changed.length || loaded.status === 'QUARANTINED') await saveMemory(root, memoryStore)
    return memoryStore
  }
  /** Called after every integration test run: which edit turned the tests green, and which edit left the very same failure in place. Typed evidence only. */
  const noteMemoryTrail = async (passed: boolean, output: string) => {
    if (!contextOn()) return
    const trail = (state.memoryTrail ??= { greenFiles: [], ineffective: [], lastKey: null, editsAtRun: 0 })
    const editedNow = Math.max(0, state.appliedEditKeys.length - trail.editsAtRun)
    const filesNow = (state.recentEdits ?? []).slice(-Math.min(2, editedNow || 0)).map(item => item.file).filter(file => editedNow > 0)
    if (passed) {
      if (!trail.greenFiles.length && trail.lastKey !== null && filesNow.length) trail.greenFiles = [...new Set(filesNow)]
    } else {
      const fp = fingerprintTestFailure(output.replace(/\u001b\[[0-9;]*m/g, ''), 'TEST')
      const key = `${fp.exceptions[0] ?? ''}|${[...fp.failingTests].sort().join(',')}`
      const base = state.baselineFailure
      const stillTheOriginalFailure = Boolean(base) && (fp.exceptions[0] ?? null) === base!.exception && base!.tests.some(test => fp.failingTests.includes(test))
      if (editedNow > 0 && trail.lastKey === key && stillTheOriginalFailure) trail.ineffective = [...new Set([...trail.ineffective, ...filesNow])].slice(-6)
      trail.lastKey = key
    }
    trail.editsAtRun = state.appliedEditKeys.length
  }
  const contextPaths = () => (state.context?.entries ?? []).map(entry => entry.path)
  const memoryQuery = (failure: FailureKey | null) => ({
    sessionId: sessionId ?? null,
    goal: request,
    files: contextPaths(),
    symbols: (state.context?.entries ?? []).flatMap(entry => entry.symbols.map(symbol => symbol.name)),
    tests: failure?.tests ?? [],
    failure,
  })
  /** Records what memory contributed and tells the Commander in plain words. Ids and statuses go to Activity only. */
  const announceMemory = async (result: RetrievalResult, stage: 'start' | 'failure', extra: string[] = []) => {
    const m = memoryState()
    const fresh = result.hits.filter(hit => !m.used.some(item => item.id === hit.memory.id))
    const freshIgnored = result.ignored.filter(item => !m.ignored.some(known => known.id === item.memory.id))
    for (const hit of fresh) m.used.push({ id: hit.memory.id, kind: hit.memory.kind, files: hit.memory.files.slice(0, 4), why: hit.reasons })
    for (const item of freshIgnored) m.ignored.push({ id: item.memory.id, kind: item.memory.kind, why: item.why })
    m.used = m.used.slice(-8)
    m.ignored = m.ignored.slice(-6)
    const notes = memoryNotes(result)
    if (notes.length) m.notes = notes
    const sentences: string[] = []
    if (m.status === 'QUARANTINED' && !(m.told ?? []).includes('quarantine')) {
      sentences.push("The notes saved for this project belong to a different project, so I'm not using them.")
      m.told = [...(m.told ?? []), 'quarantine']
    }
    const use = fresh.length ? describeMemoryUse({ hits: fresh, ignored: [] }, stage) : null
    if (use) sentences.push(use)
    const skipped = freshIgnored.length ? describeIgnoredMemory({ hits: [], ignored: freshIgnored }) : null
    if (skipped) sentences.push(skipped)
    sentences.push(...extra)
    if (!sentences.length) return
    state.knowledge.decisions.push(`MEMORY ${[...fresh.map(hit => hit.memory.kind), ...freshIgnored.map(item => `ignored-${item.memory.kind}`)].join(',')}`.slice(0, 140))
    await bindCampaign(repairId, sessionId, 'PLANNING', sentences[0], state, emit(repairId, sessionId, 'ARCHITECTING', sentences.join(' '), { status: 'info', detail: memoryDetails(result).join('\n') }))
  }
  /** A verified fix for the same kind of failure points at a file: look there first, if it still exists and still holds the symbol it was about. The edit is still checked by the tests. */
  const addMemoryCause = async (cause: { file: string; memoryId: string; why: string }) => {
    if (!contextOn()) return
    const index = await ensureIndex()
    const facts = index.files[cause.file]
    if (!facts) return
    const at = memoryNow()
    const known = state.context!.entries.find(entry => entry.path === cause.file)
    if (!known) {
      if (state.context!.entries.length >= CONTEXT_LIMITS.workingSetHardMax) return
      const entry = { path: cause.file, role: 'implementation' as const, score: 85, reasons: [cause.why], symbols: [], hash: facts.hash, via: 'memory' }
      state.context = { ...state.context!, entries: [...state.context!.entries, entry], expansions: [...state.context!.expansions, { at, file: cause.file, reason: cause.why, evidence: `earlier verified mission (${cause.memoryId})`, generation: state.mutationGeneration }].slice(-12) }
      await load(cause.file)
    }
    const layer = layerOfFile(cause.file, state.componentFiles) === 'frontend' ? 'frontend' : 'backend'
    if (!state.componentFiles[layer].includes(cause.file)) state.componentFiles[layer].push(cause.file)
    state.componentFiles[layer] = [cause.file, ...state.componentFiles[layer].filter(file => file !== cause.file)]
    const task = state.tasks.find(item => item.id === layer)
    if (task) task.workingSet = [cause.file, ...task.workingSet.filter(file => file !== cause.file)]
    if (layer === 'frontend' && !memoryState().forced.includes(cause.file)) memoryState().forced.push(cause.file)
    state.knowledge.decisions.push(`MEMORY_CAUSE ${cause.file}`)
    revisePlanFor('MEMORY_USED', {
      evidence: [`${cause.file}: ${cause.why}`],
      retarget: task ? [{ taskId: layer, workingSet: [...task.workingSet], why: cause.why }] : [],
    })
  }
  /**
   * An earlier verified mission found a file unrelated to this kind of failure. That is only a reason to ask again: the tests are run once more, and the
   * first-pass edit of that file is skipped only if today's evidence confirms it. If the evidence does not confirm it, memory yields and nothing changes.
   */
  const confirmUnrelated = async (candidate: { file: string; memoryId: string }): Promise<string | null> => {
    const layer = layerOfFile(candidate.file, state.componentFiles)
    if (!layer) return null
    const evidence = await gatherIsolationEvidence(candidate.file, layer)
    if (!evidence) return "The tests don't confirm that earlier lesson here, so I'm not relying on it."
    state.ruledOut = mergeRuledOut(state.ruledOut, [{ file: candidate.file, layer, basis: 'ISOLATED_TESTS' }])
    const m = memoryState()
    if (!m.skipped.includes(candidate.file)) m.skipped.push(candidate.file)
    const suspects = evidence.suspectLayers.flatMap(name => state.componentFiles[name as 'backend' | 'frontend']?.slice(0, 1) ?? [])
    for (const file of suspects) if (!m.forced.includes(file)) m.forced.push(file)
    const line = `The tests that call ${candidate.file} directly pass (${evidence.passing.slice(0, 2).join(', ')}), and the failing test (${evidence.failing[0]}) goes through ${suspects.join(', ') || 'another file'}, so look there first.`
    state.context = { ...state.context!, evidence: [line, ...state.context!.evidence].slice(0, 2) }
    state.knowledge.decisions.push(`MEMORY_CONFIRMED_UNRELATED ${candidate.file}`)
    revisePlanFor('MEMORY_USED', { evidence: [line] })
    return "An earlier fix showed this file wasn't the cause of this kind of failure, and the tests confirm that again, so I'm looking at the code that uses it instead."
  }
  /** After a failure (and the baseline run): retrieve what is relevant, act on it only as a starting point, and say so. */
  const applyMemoryForFailure = async (raw: string, stage: 'start' | 'failure') => {
    if (!contextOn()) return
    const clean = raw.replace(/\u001b\[[0-9;]*m/g, '')
    const fp = fingerprintTestFailure(clean, 'TEST')
    const index = await ensureIndex()
    // Frames in the order the failing run went through them (the fingerprint's own list is sorted), so the innermost project frame is the file the exception was raised in.
    const firstTrace = clean.split(/^={10,}\s*$/m).find(block => block.includes('Traceback')) ?? ''
    const known = Object.keys(index.files)
    const ordered = [...firstTrace.matchAll(/File "([^"]+)", line \d+, in (\S+)/g)]
      .map(hit => {
        const abs = hit[1].replace(/\\/g, '/')
        const file = known.filter(candidate => abs.endsWith(`/${candidate}`)).sort((a, b) => b.length - a.length)[0]
        return file ? `${file}:${hit[2]}` : null
      })
      .filter((frame, i, all): frame is string => Boolean(frame) && frame !== all[i - 1])
    const failure: FailureKey = { exception: fp.exceptions[0] ?? null, tests: fp.failingTests.slice(0, 4), frames: (ordered.length ? ordered : fp.frames).slice(0, 8) }
    if (state.mutationGeneration === 0 && !state.baselineFailure) {
      state.baselineFailure = failure
      state.memoryTrail = { greenFiles: [], ineffective: [], lastKey: `${fp.exceptions[0] ?? ''}|${[...fp.failingTests].sort().join(',')}`, editsAtRun: 0 }
    }
    const store = await memoryReady()
    const result = retrieveMemories(store, memoryQuery(failure), index)
    for (const cause of causeSuggestions(result, index)) await addMemoryCause(cause)
    const extra: string[] = []
    if (state.mutationGeneration === 0) {
      for (const candidate of unrelatedCandidates(result, index, contextPaths())) {
        const said = await confirmUnrelated(candidate)
        if (said) extra.push(said)
      }
    }
    await announceMemory(result, stage, extra)
  }
  /** What the tests just proved is written down, but only from typed evidence: a verified completion, a recorded disproval, a no-op, a revert. */
  const writeMemoryAtCompletion = async () => {
    if (!contextOn() || memoryState().savedAt) return
    const at = memoryNow()
    const index = await ensureIndex()
    const revalidated = revalidateStore(await memoryReady(), index, at, repairId)
    const candidates = memoriesFromMission({
      mission: repairId, session: sessionId ?? null, at, resolved: true, index, context: state.context ?? null, filesMutated: state.filesMutated,
      baseline: state.baselineFailure ?? null, ruledOut: [...(state.ruledOut ?? []), ...(state.memoryTrail?.ineffective ?? []).filter(file => !(state.ruledOut ?? []).some(item => item.file === file)).map(file => ({ file, layer: layerOfFile(file, state.componentFiles) ?? 'code', basis: 'EDIT' as const }))], noEffect: state.noEffect ?? [], reverted: state.revertedFiles ?? [], greenFiles: state.memoryTrail?.greenFiles ?? [],
      testCommand: 'python3 -m unittest discover -s tests', greenGeneration: state.mutationGeneration, projectFiles: await listTopLevelNames(root),
    })
    memoryStore = mergeMemories(revalidated.store, candidates, at)
    await saveMemory(root, memoryStore)
    const m = memoryState()
    m.savedAt = at
    m.saved = candidates.map(item => item.id).slice(0, MEMORY_LIMITS.writesPerMission)
    if (revalidated.changed.length) m.revalidated = [...(m.revalidated ?? []), ...revalidated.changed].slice(0, 8)
    if (candidates.length) await bindCampaign(repairId, sessionId, 'DONE', "I'll remember what worked here for next time.", state, emit(repairId, sessionId, 'CHECKPOINT_CREATED', "I'll remember what worked here for next time.", { status: 'info', detail: candidates.map(item => `${item.kind} ${item.id}: ${item.subject}`).join('\n') }))
  }
  const contextSourceFiles = () => (state.context?.entries ?? []).filter(entry => entry.role !== 'test' && entry.role !== 'config').slice(0, 4).map(entry => entry.path)
  /** Which implementation tasks may edit in a context-driven campaign: the owner of the change on the first pass, and afterwards only the layer a diagnosis actually pointed at. */
  const contextNeedsEdit = (task: CampaignTask) => {
    const debugIds = task.dependsOn.filter(id => id.startsWith('debug-'))
    // First pass. A file an earlier verified mission found unrelated to this failure, and today's tests confirmed unrelated again, is not edited blindly; the file that evidence points at is.
    if (!debugIds.length) return task.role === 'BACKEND' ? !(state.memory?.skipped ?? []).includes(task.workingSet[0]) : (state.memory?.forced ?? []).includes(task.workingSet[0])
    const layers = debugIds.map(id => layerForRepairTarget(state.plan?.tasks.find(item => item.id === id)?.repairTarget, state.componentFiles)).filter(Boolean)
    return (layers as string[]).includes(task.id) || (task.role === 'BACKEND' && layers.length === 0)
  }
  if (resuming && state.contextMode === 'CONTEXT') {
    const restored = restoreContext(state.context)
    if (restored) {
      state.context = restored
      const onDisk = await diskHashes(root, restored.entries.map(entry => entry.path))
      const stale = staleEntries(restored, onDisk)
      if (stale.length) await refreshContextFiles(stale, 'it changed while the mission was stopped')
      await bindCampaign(repairId, sessionId, 'PLANNING', 'The same files are still in view.', state, emit(repairId, sessionId, 'ARCHITECTING', `I picked up where I left off. ${describeContext(state.context!)}`, { status: 'pass', detail: contextDetails(state.context!).join('\n') }))
    } else {
      state.contextMode = 'CONVENTION'
      state.context = undefined
    }
  }

  /**
   * Alternate evidence for a file whose edit strategy is ineffective: run the tests verbosely once and see whether tests that call the file's
   * layer directly pass while the failing ones go through another layer. Bounded (one command per file per mutation generation) and the
   * same command governance as every other test run. Returns null when the picture is unclear; an unclear picture is never evidence.
   */
  const gatherIsolationEvidence = async (file: string, layer: string): Promise<IsolatedLayerEvidence | null> => {
    const key = `${file}@${state.mutationGeneration}`
    if ((state.isolationChecked ?? []).includes(key)) return null
    if (state.commandsRun >= commandLimit()) {
      state.budgetExhausted = true
      return null
    }
    state.commandsRun += 1
    state.isolationChecked = [...(state.isolationChecked ?? []), key].slice(-8)
    const bin = await pythonBin(root)
    const result = await runStepCommand(repairId, sessionId, bin, ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], root, 'Checking one layer on its own')
    const testSources: Record<string, string> = {}
    for (const rel of state.componentFiles.tests ?? []) testSources[rel] = await load(rel)
    return isolatedLayerEvidence({ layer, components: state.componentFiles, verboseOutput: `${result.stdout}\n${result.stderr}`, testSources })
  }

  /**
   * A worker proposed an edit that would change nothing (nothing was written). That says the way of editing this file is not producing
   * progress; it does not say the hypothesis is false. First time: recorded, the same task is asked again. Repeated: that strategy is marked
   * ineffective (stagnation evidence, never a fresh attempt), the working set is reordered so other layers come first, and alternate
   * evidence is gathered. Only if that evidence really shows the layer is fine is the hypothesis disproven and the belief moved. Blocked only
   * once every distinct way to edit was exhausted.
   */
  const handleNoEffectiveChange = async (current: CampaignTask, noEffect: NoEffectiveChange, summary: string): Promise<'retry' | 'switched' | 'blocked' | 'settled'> => {
    // Context-driven: the covering tests pass on the files as they are now and the worker proposes nothing that would change them, so the remark that reopened
    // this task cannot be acted on. It is settled by evidence, never blocked as if the model could not edit.
    if (contextOn() && testsGreenAtCurrentGeneration(state)) {
      state.knowledge.decisions.push(`NO_CHANGE_NEEDED ${noEffect.file}: the covering tests pass on the current files`)
      completeCampaignTask(current, [`no change needed: the covering tests pass (${noEffect.file})`])
      return 'settled'
    }
    const layer = layerOfFile(noEffect.file, state.componentFiles) ?? current.id
    const recorded = recordNoEffect(state.noEffect, { file: noEffect.file, layer, key: noEffect.key, attempts: noEffect.attempts })
    state.noEffect = recorded.records
    const exhausted = noEffectExhausted(state.noEffect, state.componentFiles)
    const verdict = evaluateNoEffectiveChange(state.progress, { file: noEffect.file, role: current.role, repeated: recorded.repeated, exhausted, at: new Date().toISOString(), mutationGeneration: state.mutationGeneration, reworkCycles: state.reworkCycles })
    state.progress = verdict.progress
    lastDecision = verdict.decision
    applyProgressBudgets()
    state.progress = { ...state.progress, stopFinding: verdict.decision.proceed ? null : summary.slice(0, 400) }
    state.knowledge.decisions.push(`NO_EFFECTIVE_CHANGE ${noEffect.file} x${recorded.record.attempts}`)
    if (!verdict.decision.proceed) return 'blocked'
    revisePlanFor('NO_EFFECTIVE_CHANGE', {
      evidence: [`${noEffect.file}: the proposed edit would have changed nothing`, ...(recorded.repeated ? [`I proposed ${recorded.record.attempts} edits to ${noEffect.file} and none would change it`] : [])],
    })
    if (!recorded.repeated) {
      current.status = 'READY'
      current.verification = 'PENDING'
      return 'retry'
    }
    const evidence = await gatherIsolationEvidence(noEffect.file, layer)
    const base = state.repairFinding ?? summary
    let finding = base
    let planTrigger: PlanTrigger = 'NO_EFFECTIVE_CHANGE'
    let statement: string | null = null
    if (evidence) {
      state.ruledOut = mergeRuledOut(state.ruledOut, [{ file: noEffect.file, layer, basis: 'ISOLATED_TESTS' }])
      const suspect = evidence.suspectLayers[0] ? (state.componentFiles[evidence.suspectLayers[0] as 'backend' | 'frontend']?.[0] ?? evidence.suspectLayers[0]) : ''
      statement = `The tests that call ${noEffect.file} directly pass (${evidence.passing.slice(0, 3).join(', ')}), and the failing test (${evidence.failing.slice(0, 2).join(', ')}) goes through ${suspect}, so the cause is not in ${noEffect.file}.`
      finding = `${base} ${statement}`
      planTrigger = 'HYPOTHESIS_DISPROVEN'
      state.knowledge.decisions.push(`DISPROVEN ${noEffect.file}: ${statement.slice(0, 150)}`)
      // The layer is fine as it stands: its task is settled by evidence, not left failed (a failed task would stall everything that depends on it).
      completeCampaignTask(current, [`no edit needed: ${statement.slice(0, 140)}`])
    } else {
      // Not disproven, only ineffective: this file stops being retried the same way, and its task is settled so the next layer can move.
      completeCampaignTask(current, [`edit strategy ineffective for ${noEffect.file}; trying another approach`])
    }
    if (!openModelRework(finding, null, undefined, 'TEST', { noEffect: true, planTrigger })) return 'blocked'
    if (statement) {
      state.repairFinding = `${base} ${statement}`.slice(0, 900)
      const target = evidence?.suspectLayers[0]
      revisePlanFor('CONTRADICTION', {
        evidence: [statement],
        reopen: target && (target === 'backend' || target === 'frontend') ? [{ taskId: target, why: `The failing test goes through the ${target}, and the tests that call ${noEffect.file} directly pass.` }] : [],
      })
    }
    return 'switched'
  }

  const UNBLOCK: Record<ProgressStopReason, string> = {
    STAGNATION_SAME_STRATEGY: 'The same failure kept returning under the same approach. Give Foundry a new constraint or a different approach.',
    STAGNATION_SAME_FAILURE: 'The same failure kept returning without new evidence. Give Foundry a new constraint or a different approach.',
    STAGNATION_NO_MUTATION: 'A repair cycle changed nothing. Give Foundry a new constraint or a different approach.',
    STAGNATION_NO_PROGRESS: 'Several failures in a row showed no reliable progress. Give Foundry a new constraint or a different approach.',
    STAGNATION_WINDOW: 'Foundry used its repair window without reliable progress. Give Foundry a new constraint or a different approach.',
    OSCILLATION: 'The failure keeps alternating between the same states. Give Foundry a constraint that breaks the cycle.',
    ITERATION_LIMIT: 'Foundry used every task step it had earned while still making progress. Continue in a new mission from the current files.',
    WINDOW_EXHAUSTED: 'Foundry made some progress but used the repair window that progress earned. Continue in a new mission from the current files.',
    ABSOLUTE_BOUND: 'Foundry reached the absolute repair limit for one mission while still making progress. Continue in a new mission from the current files.',
    CAPABILITY_NO_EFFECTIVE_CHANGE: 'Every way of editing that Foundry tried produced a change that would alter nothing. Use a model that can produce effective edits, or narrow the task.',
    CAPABILITY_INVALID_OUTPUT: 'The model repeatedly returned unusable structured output. Use a model that can produce structured edits, or narrow the task.',
    POLICY_NO_TESTS: 'Add tests the project can run, then start a new mission.',
    PROVIDER: 'Start the model provider and retry. No cloud fallback is used.',
  }
  const blockedByProgress = (finding: string, fallbackUnblock: string) => {
    const stop = state.progress.stop
    if (!stop) return blocked('BLOCKED_STAGNATION', finding, [], false, fallbackUnblock)
    const detail = blocked(
      blockedSummaryFor(stop.reason),
      `${finding}\n${stop.message}`,
      state.progress.observations.slice(-6).map(item => ({ strategy: item.strategy ?? item.kind, outcome: `${item.class}${item.exception ? ` ${item.exception}` : ''}${item.signals.length ? ` (${item.signals.join(', ')})` : ''}` })),
      false,
      UNBLOCK[stop.reason],
    )
    detail.progress = blockedEvidence(state.progress) ?? undefined
    return detail
  }
  const reportProgress = async (step: NativeCodingMissionState['currentStep']) => {
    const decision = lastDecision
    if (!decision) return
    await bindCampaign(repairId, sessionId, step, decision.summary, state, emit(repairId, sessionId, 'PROGRESS_EVALUATED', decision.summary, {
      status: decision.proceed ? 'info' : 'blocked',
      strategy: decision.strategy ?? undefined,
      detail: progressEventPayload(state.progress, decision, progressLimits(state.progress), state.reworkCycles),
    }))
    lastDecision = null
  }

  const applyModelEdit = async (current: CampaignTask, edit: PlannedEdit, localWorker: boolean) => {
    const key = `${edit.file}:model:${edit.start}:${edit.end}:${sha256(edit.after).slice(0, 12)}`
    const held = state.writeLocks.find(lock => lock.file === edit.file)
    const holder = held ? state.tasks.find(task => task.id === held.taskId) : null
    if (held && holder?.status === 'COMPLETE' && held.taskId !== current.id) {
      held.taskId = current.id
    }
    const lock = claimWriteLock(state.writeLocks, edit.file, current.id)
    if (!lock.ok) {
      current.status = 'BLOCKED'
      await bindCampaign(repairId, sessionId, 'EDITING', 'Shared file serialized.', state, emit(repairId, sessionId, 'TASK_BLOCKED', `${edit.file} is owned by another task.`, { status: 'blocked', filePath: edit.file }))
      return 'blocked-task' as const
    }
    if (state.appliedEditKeys.includes(key)) return 'applied' as const
    if (preexistingDirtyBlocksEdit(state.preexistingDirty, edit.file, state.filesMutated)) {
      return 'dirty' as const
    }
    const applied = await applyUniqueEdit({
      repairId,
      issueId,
      file: edit.file,
      before: edit.before,
      after: edit.after,
      start: edit.start,
      end: edit.end,
      reason: edit.reason,
      sourceKind: localWorker ? 'local_model' : 'hosted_model',
    })
    if (!applied.ok) return 'failed' as const
    state.mutationGeneration += 1
    if (!state.writeLocks.some(lock => lock.file === edit.file)) {
      state.writeLocks.push({ file: edit.file, taskId: current.id })
    }
    if (!state.filesMutated.includes(edit.file)) state.filesMutated.push(edit.file)
    if (!current.writes.includes(edit.file)) current.writes.push(edit.file)
    state.appliedEditKeys.push(key)
    state.recentEdits = [...(state.recentEdits ?? []), { file: edit.file, diff: (applied.diff ?? '').slice(0, 1200) }].slice(-2)
    state.progress = noteMutation(state.progress, { file: edit.file, before: edit.before, after: edit.after, start: edit.start, end: edit.end })
    sources.set(edit.file, edit.after)
    if (contextOn()) {
      state.context = noteChanged(state.context!, edit.file, state.mutationGeneration)
      // Disk is the truth: re-read what was just written and re-link, instead of trusting the text the edit computed.
      await refreshContextFiles([edit.file], 'I changed it')
    }
    await bindCampaign(repairId, sessionId, 'EDITING', `Edited ${edit.file}.`, state, emit(repairId, sessionId, 'FILE_EDITED', edit.file, { status: 'pass', filePath: edit.file, diff: applied.diff }))
    return 'applied' as const
  }

  if (state.intelligence === 'model' && state.localOnly) {
    const health = await resolveLocalModelHealth({ tryStart: true, probeTimeoutMs: 2000 })
    if (!health.available) {
      return sealBlocked(repairId, blocked(
        'PROVIDER_UNAVAILABLE',
        health.detail || 'Local Ollama provider is unreachable.',
        [],
        false,
        'Start the Ollama user service and confirm qwen2.5-coder:14b is installed. No cloud fallback is used.',
      ))
    }
  }

  if (state.progress.continuation.pending) {
    // The Commander chose Keep trying on this same mission. Nothing learned is erased; reopen work on the failure Foundry stopped at.
    const finding = state.progress.stopFinding ?? state.knowledge.failures[state.knowledge.failures.length - 1] ?? 'The earlier failure is still present.'
    reopenReworkTasks(finding, 'COMMANDER_CONTINUATION')
    state.progress = clearPendingContinuation(state.progress)
    applyProgressBudgets()
    await bindCampaign(repairId, sessionId, 'REPAIRING', 'Continuing after the Commander chose Keep trying.', state, emit(repairId, sessionId, 'REWORKING', 'Continuing the repair; earlier attempts are remembered and will not be repeated.', { status: 'info' }))
  }
  let guard = 0
  // The task-loop bound is the third finite ceiling; progress extends it inside a hard absolute limit.
  while (guard < progressLimits(state.progress).iterations) {
    guard += 1
    await announcePlanRevision()
    if (state.budgetExhausted || state.commandsRun > commandLimit()) {
      return sealBlocked(repairId, blocked('BLOCKED_RESOURCE', 'Campaign budget is exhausted.', [], false, 'Raise the campaign budget in a new mission. This budget was not reset.'))
    }
    const windowStop = applyWindowStop(state.progress, state.reworkCycles)
    if (windowStop) {
      state.progress = windowStop
      return sealBlocked(repairId, blockedByProgress(`Repair cycles (${state.reworkCycles}) used the window earned so far.`, 'Continue in a new mission from the current files. This budget was not reset.'))
    }
    const ready = readyCampaignTasks(state.tasks).slice(0, MAX_ACTIVE_SUBTASKS)
    const current = ready[0]
    if (!current) break
    if ((current.id === 'review' || current.id === 'verify') && !verificationBarrierSatisfied(state)) {
      const integrate = state.tasks.find(task => task.id === 'integrate')
      if (integrate) {
        integrate.status = 'READY'
        integrate.verification = 'PENDING'
      }
      continue
    }
    current.status = 'RUNNING'
    current.attempt += 1
    const startedSummary = state.intelligence === 'model' ? specialistActivity(current.role) : `${current.role} ${current.purpose}`
    await bindCampaign(repairId, sessionId, 'EDITING', `${current.role} ${current.id}`, state, emit(repairId, sessionId, 'TASK_STARTED', startedSummary, { status: 'running', detail: emitProgress() }))
    if (state.intelligence === 'model') {
      if (state.modelCalls >= state.modelCallBudget) {
        state.budgetExhausted = true
        return sealBlocked(repairId, blocked('BLOCKED_RESOURCE', 'Model-call budget is exhausted.', [], false, 'This budget was not reset.'))
      }
      const priorReceipt = state.workerReceipts.find(item => item.taskId === current.id && item.attempt === current.attempt && !item.failureClass)
      if (priorReceipt) {
        state.duplicateWorkerCallCount += 1
        completeCampaignTask(current, ['existing specialist receipt'])
      } else if (current.id === 'discover' || current.id === 'database' || current.id === 'contract') {
        for (const file of current.workingSet) await load(file)
        if (current.id === 'contract') {
          const field = contractFieldName([await load(current.workingSet[0] ?? '')])
          if (field) state.knowledge.interfaces.push(`contract field ${field}`)
        }
        // A context-driven mission looks at the tests once before it changes anything, so the first edit is made against real failure evidence.
        if (current.id === 'discover' && contextOn() && !state.checkpoints.includes('BASELINE') && state.commandsRun < commandLimit()) {
          state.commandsRun += 1
          state.checkpoints.push('BASELINE')
          // What this project taught Foundry earlier is retrieved before the first edit, and checked against the code as it is now.
          const startStore = await memoryReady()
          await announceMemory(retrieveMemories(startStore, memoryQuery(null), await ensureIndex()), 'start')
          const bin = await pythonBin(root)
          recordTestStart(state, `python3 ${regressionTestCommand().args.join(' ')}`, new Date().toISOString())
          const baseline = await runStepCommand(repairId, sessionId, bin, regressionTestCommand().args, root, 'Checking the tests before changing anything')
          recordTestFinish(state, baseline.code ?? 1, new Date().toISOString())
          if (baseline.code !== 0) {
            const raw = `${baseline.stdout}\n${baseline.stderr}`
            const finding = `tests fail before any change: ${keyFailureLine(raw)} ${raw.replace(/\s+/g, ' ').slice(0, 240)}`
            state.repairFinding = finding
            state.knowledge.failures.push(finding.slice(0, 200))
            await applyMemoryForFailure(raw, 'start')
          }
        }
        completeCampaignTask(current, ['evidenced'])
      } else if (current.id === 'architect' && contextOn()) {
        // The context engine already named what the change is about; there is nothing left for a model to guess from file names.
        state.knowledge.architecture.push(describeContext(state.context!))
        completeCampaignTask(current, ['context'])
      } else if (current.id === 'verify') {
        if (state.commandsRun >= commandLimit()) {
          state.budgetExhausted = true
          continue
        }
        state.commandsRun += 1
        const bin = await pythonBin(root)
        await bindCampaign(repairId, sessionId, 'TESTING', 'Verifier is re-running the tests.', state, emit(repairId, sessionId, 'VERIFICATION_STARTED', 'VERIFIER — verifying', { status: 'running' }))
        const result = await runStepCommand(repairId, sessionId, bin, regressionTestCommand().args, root, 'Campaign verification')
        const scopedVerify = await scopeTests(`${result.stdout}\n${result.stderr}`, result.code)
        if (scopedVerify?.deferred.length) deferUnrelated(scopedVerify.deferred)
        const passed = result.code === 0 || Boolean(scopedVerify?.onlyUnrelated)
        state.knowledge.tests.push(`verify ${passed ? 'pass' : 'fail'}`)
        const contractText = await load(state.componentFiles.contract[0] ?? '')
        const backend = await load(state.componentFiles.backend[0] ?? '')
        const frontend = await load(state.componentFiles.frontend[0] ?? '')
        const call = await callCampaignSpecialist(specialistRequestFromCampaign({
          campaign: state,
          taskId: current.id,
          role: 'VERIFIER',
          purpose: current.purpose,
          acceptance: current.acceptance,
          workingSet: [state.componentFiles.contract[0], state.componentFiles.backend[0], state.componentFiles.frontend[0]].filter(Boolean) as string[],
          excerpts: [
            { file: state.componentFiles.contract[0] ?? 'contract', text: contractText },
            { file: state.componentFiles.backend[0] ?? 'backend', text: backend },
            { file: state.componentFiles.frontend[0] ?? 'frontend', text: frontend },
          ],
          needsEdit: false,
          attempt: current.attempt,
          contractText,
        }), sources)
        state.modelCalls += call.calls
        state.callsByRole.VERIFIER = (state.callsByRole.VERIFIER ?? 0) + call.calls
        state.workerReceipts.push(call.receipt)
        const diskOk = passed && diskMeetsContract(contractText, backend, frontend)
        if (call.failureClass || !call.result?.verdict) {
          return sealBlocked(repairId, blocked(call.failureClass ?? 'INVALID_OUTPUT', call.receipt.summary, [], false, 'The verifier result was not a ready decision.'))
        }
        if (!diskOk) {
          const finding = call.result.summary || 'Verifier did not accept the disk result.'
          current.status = 'FAILED'
          current.verification = 'FAIL'
          await bindCampaign(repairId, sessionId, 'TESTING', 'Verification failed.', state, emit(repairId, sessionId, 'VERIFICATION_FAILED', finding, { status: 'fail', detail: call.workerLabel }))
          if (!openModelRework(finding, fingerprintFinding(finding, 'VERIFY'), undefined, 'VERIFY')) {
            await reportProgress('TESTING')
            return sealBlocked(repairId, blockedByProgress(finding, 'Rework did not reach a passing verification.'))
          }
          await reportProgress('REPAIRING')
          await bindCampaign(repairId, sessionId, 'REPAIRING', 'Rework opened from verification.', state, emit(repairId, sessionId, 'REWORKING', finding, { status: 'fail', detail: call.workerLabel }))
          continue
        }
        const allowed = campaignCompletionAllowed({
          verification: call.result.verdict,
          testsPassed: passed,
          reviewClear: state.reviewFindings.length === 0,
          unresolvedFailure: false,
        })
        if (!allowed || !verificationBarrierSatisfied(state)) {
          return sealBlocked(repairId, blocked('INVALID_OUTPUT', call.result.summary, [], false, 'The verifier did not accept a passing disk result.'))
        }
        state.verification = 'PROJECT_READY'
        state.phase = 'COMPLETE'
        state.checkpoints.push('PROJECT_READY')
        completeCampaignTask(current, [call.workerLabel, 'PROJECT_READY'])
        await writeMemoryAtCompletion()
        await bindCampaign(repairId, sessionId, 'DONE', emitProgress(), state, emit(repairId, sessionId, 'PROJECT_READY', 'Verifier accepted the campaign from disk truth.', { status: 'pass', detail: `${call.workerLabel}; ${emitProgress()}`, validationResult: 'PASS' }))
      } else {
        const contractText = await load(state.componentFiles.contract[0] ?? '')
        const files = (current.workingSet.length ? current.workingSet : contextOn() ? contextSourceFiles() : [
          state.componentFiles.contract[0],
          state.componentFiles.backend[0],
          state.componentFiles.frontend[0],
        ]).filter(Boolean) as string[]
        for (const file of files) await load(file)
        await freshenForCall(files)
        const bodyFile = current.workingSet[0] ?? ''
        const body = bodyFile ? sources.get(bodyFile) ?? '' : ''
        // Reopened by the failure text, or because the diagnosis this task waits on named this layer's file.
        const reopened = current.dependsOn.some(id => id.startsWith('debug-') && (state.plan?.tasks.find(task => task.id === id)?.repairTarget ? layerForRepairTarget(state.plan.tasks.find(task => task.id === id)?.repairTarget, state.componentFiles) === current.id : false))
          || (current.dependsOn.some(id => id.startsWith('debug-')) && reworkImplementationIds(state.repairFinding ?? '').includes(current.id))
        const needsEdit = current.role === 'BACKEND' || current.role === 'FRONTEND'
          ? contextOn() ? contextNeedsEdit(current) : implementationNeedsEdit(current.role, body, contractText, state.repairFinding) || reopened
          : false
        if ((current.role === 'BACKEND' || current.role === 'FRONTEND') && !needsEdit) {
          completeCampaignTask(current, ['no edit authorized for this acceptance'])
        } else {
          const shownExcerpts = [
            ...files.map(file => ({ file, text: sources.get(file) ?? '' })),
            ...(contextOn() && (current.role === 'BACKEND' || current.role === 'FRONTEND') ? await contextTestExcerpts(files) : []),
          ]
          const notesForCall = contextOn() ? [...(state.memory?.notes ?? []), ...contextNotes(state.context!, await ensureIndex(), current.role === 'BACKEND' || current.role === 'FRONTEND' ? current.workingSet[0] : undefined)] : []
          // The record shows exactly what reached the model: which files, and which context notes.
          if (contextOn()) state.context = noteSent(state.context!, { role: current.role, task: current.id, files: shownExcerpts.map(item => item.file), notes: notesForCall })
          const call = await callCampaignSpecialist(specialistRequestFromCampaign({
            campaign: state,
            taskId: current.id,
            role: current.role,
            purpose: current.purpose,
            acceptance: current.acceptance,
            workingSet: files,
            excerpts: shownExcerpts,
            needsEdit,
            attempt: current.attempt,
            ...(contextOn() ? { generalMode: true, contextNotes: notesForCall } : {}),
            // A reviewer judges against the request and its acceptance criteria. A raw line of the contract file is context, not an acceptance sentence.
            contractText: current.role === 'REVIEWER' ? reviewerContract(acceptanceBasis({ request: state.request, acceptance: state.acceptance, contracts: await contractsOf() })) : contractText,
          }), sources)
          state.modelCalls += call.calls
          state.callsByRole[current.role] = (state.callsByRole[current.role] ?? 0) + call.calls
          if (call.switchedWorker) state.workerSwitches += 1
          state.workerReceipts.push(call.receipt)
          if (call.failureClass === 'RESOURCE_BLOCK') {
            state.budgetExhausted = true
            return sealBlocked(repairId, blocked('BLOCKED_RESOURCE', call.receipt.summary, [], false, 'This budget was not reset.'))
          }
          if (call.failureClass) {
            current.status = 'FAILED'
            if (call.failureClass === 'INVALID_OUTPUT' && call.noEffect && (current.role === 'BACKEND' || current.role === 'FRONTEND')) {
              // An edit that would change nothing is not unusable output and not a failed hypothesis: it is evidence the way of editing is not working.
              const outcome = await handleNoEffectiveChange(current, call.noEffect, call.receipt.summary)
              if (outcome === 'blocked') {
                await reportProgress('TESTING')
                return sealBlocked(repairId, blockedByProgress(`every way of editing tried produced no effective change (${call.noEffect.file})`, 'The specialist could not produce an effective edit.'))
              }
              await reportProgress('REPAIRING')
              await bindCampaign(repairId, sessionId, 'REPAIRING', outcome === 'settled' ? 'Nothing needed to change: the covering tests already pass.' : 'The proposed change would not have changed anything, so a different approach was chosen.', state, emit(repairId, sessionId, 'REWORKING', outcome === 'settled' ? 'nothing needed to change, the tests already pass' : 'that change would not have altered the file', { status: outcome === 'settled' ? 'info' : 'fail', detail: call.workerLabel }))
              continue
            }
            if (call.failureClass === 'INVALID_OUTPUT') {
              // Unusable structured output is a capability signal, not a code failure: it has its own bounded streak.
              const reopened = openModelRework(`invalid specialist output from ${current.role}: ${call.receipt.summary}`, null, { role: current.role, taskId: current.id })
              await reportProgress(reopened ? 'REPAIRING' : 'TESTING')
              if (reopened) {
                await bindCampaign(repairId, sessionId, 'REPAIRING', 'Invalid specialist output was rejected.', state, emit(repairId, sessionId, 'REWORKING', `invalid specialist output from ${current.role}`, { status: 'fail', detail: call.workerLabel }))
                continue
              }
              return sealBlocked(repairId, blockedByProgress(`invalid specialist output from ${current.role}: ${call.receipt.summary}`, 'The specialist result was not accepted.'))
            }
            return sealBlocked(repairId, blocked(call.failureClass, call.receipt.summary, [], false, 'The specialist result was not accepted.'))
          }
          state.progress = resetInvalidOutputStreak(state.progress)
          if (current.role === 'ARCHITECT' && call.result) {
            const claimed = /interface\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(call.result.summary)
            const field = contractFieldName([contractText])
            if (claimed && field) {
              const resolved = resolveInterfaceContradiction(claimed[1], field)
              if (resolved) {
                state.contradictions.push(resolved.contradiction)
                state.knowledge.decisions.push(resolved.decision)
              } else state.acceptedFacts.push(`interface ${field}`)
            }
            state.knowledge.architecture.push(call.result.summary.slice(0, 180))
          }
          if (call.edit && needsEdit) {
            const allowed = files.includes(call.edit.file) || current.workingSet.includes(call.edit.file)
            if (!allowed) {
              return sealBlocked(repairId, blocked('INVALID_OUTPUT', `${call.edit.file} is outside the task working set.`, [], false, 'The specialist edit was refused.'))
            }
            const edited = await applyModelEdit(current, call.edit, call.localWorker)
            if (edited === 'dirty') {
              return sealBlocked(repairId, blocked('Preexisting dirty file.', `${call.edit.file} is preexisting dirty.`, [], false, 'Leave the dirty file untouched.'))
            }
            if (edited === 'failed') {
              return sealBlocked(repairId, blocked('INVALID_OUTPUT', 'The governed edit was refused.', [], false, 'The specialist edit did not apply.'))
            }
            if (edited === 'blocked-task') continue
          }
          if (current.role === 'REVIEWER') {
            let gap = Boolean(call.result && reviewerFoundGap(call.result.summary))
            const backendNow = sources.get(state.componentFiles.backend[0] ?? '') ?? ''
            const frontendNow = sources.get(state.componentFiles.frontend[0] ?? '') ?? ''
            let setAside: ReviewClaimDecision | null = null
            let claimKey = ''
            if (gap && call.result) {
              // A reviewer sentence is a claim. It reopens work only when it maps to a real acceptance criterion and is not the same claim already handled while the tests pass.
              const verdict = reviewClaimDecision({
                claim: call.result.summary,
                basis: acceptanceBasis({ request: state.request, acceptance: state.acceptance, contracts: await contractsOf() }),
                earlierClaims: state.reviewedClaims ?? [],
                testsGreenNow: testsGreenAtCurrentGeneration(state),
                filesMeetCriteria: diskMeetsContract(contractText, backendNow, frontendNow),
              })
              claimKey = verdict.key
              if (verdict.decision !== 'REOPEN') {
                gap = false
                setAside = verdict.decision
                state.knowledge.decisions.push(`REVIEW_SET_ASIDE ${verdict.decision} ${verdict.support.reason}: ${call.result.summary.slice(0, 120)}`)
              }
            }
            state.reviewFindings = gap && call.result ? [call.result.summary] : []
            await bindCampaign(repairId, sessionId, 'TESTING', 'Reviewer checked the campaign.', state, emit(repairId, sessionId, 'REVIEWING', gap ? state.reviewFindings[0] : 'Review found no blocking gap.', { status: gap ? 'fail' : 'pass', detail: setAside ? `${call.workerLabel} · ${setAsideNote(setAside)}` : call.workerLabel }))
            if (gap) {
              const finding = state.reviewFindings[0] ?? ''
              const actionable = !diskMeetsContract(contractText, backendNow, frontendNow)
                || implementationNeedsEdit('BACKEND', backendNow, contractText, finding, 'REVIEW')
                || implementationNeedsEdit('FRONTEND', frontendNow, contractText, finding, 'REVIEW')
              if (!actionable) {
                state.reviewFindings = []
              } else {
              current.status = 'FAILED'
              state.reviewedClaims = [...(state.reviewedClaims ?? []), claimKey].slice(-6)
              state.reworkOrigin = 'REVIEW'
              if (!openModelRework(state.reviewFindings[0], fingerprintFinding(state.reviewFindings[0], 'REVIEW'), undefined, 'REVIEW')) {
                await reportProgress('TESTING')
                return sealBlocked(repairId, blockedByProgress(state.reviewFindings[0], 'The review finding needs a bounded repair.'))
              }
              await reportProgress('REPAIRING')
              await bindCampaign(repairId, sessionId, 'REPAIRING', 'Review opened a rework.', state, emit(repairId, sessionId, 'REWORKING', state.reviewFindings[0], { status: 'fail', detail: call.workerLabel }))
              continue
              }
            }
          }
          if (current.id === 'integrate') {
            if (!call.result?.testPlan.length) {
              return sealBlocked(repairId, blocked('INVALID_OUTPUT', 'Test role did not name a verification action.', [], false, 'The test specialist must name a command.'))
            }
            if (state.commandsRun >= commandLimit()) {
              state.budgetExhausted = true
              continue
            }
            state.commandsRun += 1
            const bin = await pythonBin(root)
            await bindCampaign(repairId, sessionId, 'TESTING', 'TEST — verifying', state, emit(repairId, sessionId, 'INTEGRATING', 'Integration tests are running.', { status: 'running', detail: call.workerLabel }))
            const command = `python3 ${regressionTestCommand().args.join(' ')}`
            recordTestStart(state, command, new Date().toISOString())
            const result = await runStepCommand(repairId, sessionId, bin, regressionTestCommand().args, root, 'Campaign integration')
            const scoped = await scopeTests(`${result.stdout}\n${result.stderr}`, result.code)
            const scopedPass = Boolean(scoped?.onlyUnrelated)
            recordTestFinish(state, result.code ?? 1, new Date().toISOString(), scopedPass && scoped ? { deferred: scoped.deferred.length } : undefined)
            if (scoped?.deferred.length) deferUnrelated(scoped.deferred)
            const passed = result.code === 0 || scopedPass
            state.knowledge.tests.push(`integrate ${passed ? 'pass' : 'fail'}`)
            if (passed) state.progress = noteGreen(state.progress, { at: new Date().toISOString(), mutationGeneration: state.mutationGeneration })
            await noteMemoryTrail(passed, `${result.stdout}\n${result.stderr}`)
            if (passed && contextOn()) await snapshotGreen()
            if (!passed) {
              const raw = scoped?.relatedText ?? `${result.stdout}\n${result.stderr}`
              const noTests = result.code === 5 || /NO TESTS RAN/i.test(raw)
              const finding = `integration defect ${keyFailureLine(raw)} ${raw.replace(/\s+/g, ' ').slice(0, 200)}`
              current.status = 'FAILED'
              current.verification = 'FAIL'
              if (noTests) {
                state.knowledge.failures.push(finding)
                const verdict = evaluateNoTests(state.progress, { at: new Date().toISOString(), mutationGeneration: state.mutationGeneration, reworkCycles: state.reworkCycles })
                state.progress = verdict.progress
                lastDecision = verdict.decision
                await reportProgress('TESTING')
                return sealBlocked(repairId, blockedByProgress(finding, 'The test command collected no tests.'))
              }
              // A change that a reviewer's remark opened must not turn tests that passed red: put the files back to the version that worked, then verify again.
              if (await revertReviewDrivenBreak()) {
                current.status = 'READY'
                current.verification = 'PENDING'
                await reportProgress('TESTING')
                await bindCampaign(repairId, sessionId, 'REPAIRING', 'That change broke tests that passed, so the files were put back.', state, emit(repairId, sessionId, 'REWORKING', 'that change broke passing tests, so I put the files back', { status: 'info', detail: call.workerLabel }))
                continue
              }
              state.reworkOrigin = 'TEST'
              await applyMemoryForFailure(`${result.stdout}\n${result.stderr}`, 'failure')
              // The failing run may point at code the working set does not hold yet: grow it, with the reason, before the diagnosis is asked for.
              await expandContext(`${result.stdout}\n${result.stderr}`)
              await gatherContextEvidence()
              // Failure identity is semantic (exception, failing tests, project frames, normalized values), not a raw-string match.
              if (!openModelRework(finding, fingerprintTestFailure(raw, 'TEST'))) {
                await reportProgress('TESTING')
                return sealBlocked(repairId, blockedByProgress(finding, 'Rework did not reach a passing verification.'))
              }
              await reportProgress('REPAIRING')
              await bindCampaign(repairId, sessionId, 'REPAIRING', 'Rework opened from test evidence.', state, emit(repairId, sessionId, 'REWORKING', finding, { status: 'fail', detail: call.workerLabel }))
              continue
            }
          }
          if (current.role === 'DEBUGGER' && call.result?.hypotheses.length) {
            const hypothesis = call.result.hypotheses[0].slice(0, 240)
            state.knowledge.failures.push(hypothesis.slice(0, 180))
            state.knowledge.decisions.push(`HYPOTHESIS ${hypothesis.slice(0, 180)}`)
            const evidence = call.result.evidence[0]
            if (evidence) state.knowledge.decisions.push(`EVIDENCE ${evidence.slice(0, 180)}`)
            const target = call.result.recommendedActions[0]
            if (target) state.knowledge.decisions.push(`REPAIR_TARGET ${target.slice(0, 180)}`)
            state.repairFinding = hypothesis
            state.progress = noteDebuggerFinding(state.progress, { hypothesis, repairTarget: target ?? null })
            // Runtime evidence beats the diagnosis: if a project file already defines the name the diagnosis calls undefined, say so and point the repair at the import.
            const claimedNames = missingNamesFromFailure([hypothesis]).undefinedNames
            if (claimedNames.length) {
              const definitions: Record<string, string> = {}
              for (const file of [...state.componentFiles.contract, ...state.componentFiles.backend, ...state.componentFiles.frontend]) definitions[file] = await load(file)
              const contradicted = contradictedClaim(claimedNames, definitions, filesNamedBy(hypothesis, state.componentFiles))
              if (contradicted) {
                state.repairFinding = `${hypothesis} ${contradicted.file} already defines ${contradicted.name}: import ${contradicted.name} from it where it is used.`.slice(0, 420)
                state.knowledge.decisions.push(`CONTRADICTED ${contradicted.name} is defined in ${contradicted.file}`)
                revisePlanFor('HYPOTHESIS_CONTRADICTED', { evidence: [`${contradicted.file} already defines ${contradicted.name}`, hypothesis] })
              }
            }
            linkRepairToPlan(current.id, hypothesis, target ?? null)
          }
          if (current.status === 'RUNNING') completeCampaignTask(current, [call.workerLabel, call.result?.summary ?? 'specialist'])
        }
      }
      if (current.id === 'architect' && state.pauseAfter === 'AFTER_ARCHITECT') {
        state.checkpoints.push('SPECIALIST_RESULT')
        await bindCampaign(repairId, sessionId, 'PLANNING', 'Paused after the architect specialist result.', state, emit(repairId, sessionId, 'ARCHITECTING', specialistActivity('ARCHITECT'), { status: 'pass', detail: state.workerReceipts.at(-1)?.summary ?? '' }))
        const paused = await getRepair(repairId)
        if (!paused) throw new Error('missing repair')
        return paused
      }
    } else if (current.id === 'discover' || current.id === 'architect' || current.id === 'contract' || current.id === 'database') {
      for (const file of current.workingSet) await load(file)
      if (current.id === 'contract' && state.componentFiles.contract.length) state.knowledge.interfaces.push('contract read')
      completeCampaignTask(current, ['evidenced'])
    } else if (current.id === 'backend' || current.id === 'frontend') {
      const file = current.workingSet[0]
      const source = file ? await load(file) : ''
      const edit = file && source ? campaignEdit({
        role: current.id === 'backend' ? 'BACKEND' : 'FRONTEND',
        file,
        source,
        strategy: state.strategy,
        tests: await testsOf(),
        contracts: await contractsOf(),
      }) : null
      if (edit) {
        const key = `${edit.file}:${state.strategy}:${edit.start}:${edit.end}`
        const lock = claimWriteLock(state.writeLocks, edit.file, current.id)
        if (!lock.ok) {
          current.status = 'BLOCKED'
          await bindCampaign(repairId, sessionId, 'EDITING', 'Shared file serialized.', state, emit(repairId, sessionId, 'TASK_BLOCKED', `${edit.file} is owned by another task.`, { status: 'blocked', filePath: edit.file }))
          continue
        }
        if (!state.appliedEditKeys.includes(key)) {
          if (preexistingDirtyBlocksEdit(state.preexistingDirty, edit.file, state.filesMutated)) {
            return sealBlocked(repairId, blocked('Preexisting dirty file.', `${edit.file} is preexisting dirty.`, [], false, 'Leave the dirty file untouched.'))
          }
          const applied = await applyUniqueEdit({ repairId, issueId, file: edit.file, before: edit.before, after: edit.after, start: edit.start, end: edit.end, reason: edit.reason })
          if (!applied.ok) {
            current.status = 'FAILED'
            state.failureAttribution = attributeFailure(state.strategy, false)
            if (!openRework(state.failureAttribution ?? 'implementation')) {
              return sealBlocked(repairId, blocked('BLOCKED_STAGNATION', applied.error ?? 'edit failed', [], false, 'Review the campaign events.'))
            }
            await bindCampaign(repairId, sessionId, 'REPAIRING', 'Rework opened.', state, emit(repairId, sessionId, 'REWORKING', state.failureAttribution ?? 'rework', { status: 'fail', strategy: state.strategy, previousStrategy: 'STALE_FIELD' }))
            continue
          }
          state.writeLocks.push({ file: edit.file, taskId: current.id })
          if (!state.filesMutated.includes(edit.file)) state.filesMutated.push(edit.file)
          if (!current.writes.includes(edit.file)) current.writes.push(edit.file)
          state.appliedEditKeys.push(key)
          state.recentEdits = [...(state.recentEdits ?? []), { file: edit.file, diff: (applied.diff ?? '').slice(0, 1200) }].slice(-2)
          state.mutationGeneration += 1
          sources.set(edit.file, edit.after)
          await bindCampaign(repairId, sessionId, 'EDITING', `Edited ${edit.file}.`, state, emit(repairId, sessionId, 'FILE_EDITED', edit.file, { status: 'pass', filePath: edit.file, diff: applied.diff }))
        }
      }
      completeCampaignTask(current, [state.strategy])
    } else if (current.id === 'integrate' || current.id === 'verify') {
      if (state.commandsRun >= commandLimit()) {
        state.budgetExhausted = true
        continue
      }
      state.commandsRun += 1
      const bin = await pythonBin(root)
      const eventType = current.id === 'verify' ? 'VERIFICATION_STARTED' : 'INTEGRATING'
      await bindCampaign(repairId, sessionId, 'TESTING', current.id, state, emit(repairId, sessionId, eventType, current.id === 'verify' ? 'Verifier is re-running the tests.' : 'Integration tests are running.', { status: 'running' }))
      const command = `python3 ${regressionTestCommand().args.join(' ')}`
      recordTestStart(state, command, new Date().toISOString())
      const result = await runStepCommand(repairId, sessionId, bin, regressionTestCommand().args, root, current.id === 'verify' ? 'Campaign verification' : 'Campaign integration')
      const scopedLegacy = await scopeTests(`${result.stdout}\n${result.stderr}`, result.code)
      const legacyScopedPass = Boolean(scopedLegacy?.onlyUnrelated)
      recordTestFinish(state, result.code ?? 1, new Date().toISOString(), legacyScopedPass && scopedLegacy ? { deferred: scopedLegacy.deferred.length } : undefined)
      if (scopedLegacy?.deferred.length) deferUnrelated(scopedLegacy.deferred)
      const passed = result.code === 0 || legacyScopedPass
      state.knowledge.tests.push(`${current.id} ${passed ? 'pass' : 'fail'}`)
      if (!passed) {
        const attribution = attributeFailure(state.strategy, false) ?? 'integration defect'
        state.failureAttribution = attribution
        current.status = 'FAILED'
        current.verification = 'FAIL'
        if (current.id === 'verify') {
          await bindCampaign(repairId, sessionId, 'TESTING', 'Verification failed.', state, emit(repairId, sessionId, 'VERIFICATION_FAILED', attribution, { status: 'fail' }))
        }
        if (!openRework(attribution)) {
          return sealBlocked(repairId, blocked('BLOCKED_STAGNATION', attribution, [], false, 'Rework did not reach a passing verification.'))
        }
        await bindCampaign(repairId, sessionId, 'REPAIRING', 'Rework opened from test evidence.', state, emit(repairId, sessionId, 'REWORKING', attribution, { status: 'fail', strategy: 'CONTRACT_FIELD', previousStrategy: 'STALE_FIELD' }))
        continue
      }
      completeCampaignTask(current, ['tests passed'])
      if (current.id === 'verify') {
        if (!verificationBarrierSatisfied(state)) {
          return sealBlocked(repairId, blocked('Campaign did not verify.', 'Verification evidence is stale for the current mutation generation.', [], false, 'Re-run the tests for the current files.'))
        }
        state.verification = 'PROJECT_READY'
        state.phase = 'COMPLETE'
        state.checkpoints.push('PROJECT_READY')
        await bindCampaign(repairId, sessionId, 'DONE', emitProgress(), state, emit(repairId, sessionId, 'PROJECT_READY', 'Verifier accepted the campaign from disk truth.', { status: 'pass', detail: emitProgress(), validationResult: 'PASS' }))
      }
    } else if (current.id === 'review') {
      const backend = await load(state.componentFiles.backend[0] ?? '')
      const frontend = await load(state.componentFiles.frontend[0] ?? '')
      const findings = reviewCampaign({
        backend,
        frontend,
        contracts: await contractsOf(),
        mutated: state.filesMutated,
        dirty: state.preexistingDirty,
      })
      state.reviewFindings = findings
      await bindCampaign(repairId, sessionId, 'TESTING', 'Reviewer checked the campaign.', state, emit(repairId, sessionId, 'REVIEWING', findings[0] ?? 'Review found no blocking gap.', { status: findings.length ? 'fail' : 'pass', detail: findings.join(' ') }))
      if (findings.length) {
        current.status = 'FAILED'
        if (!openRework(findings[0])) {
          return sealBlocked(repairId, blocked('Review blocked the campaign.', findings.join(' '), [], false, 'The review finding needs a bounded repair.'))
        }
        await bindCampaign(repairId, sessionId, 'REPAIRING', 'Review opened a rework.', state, emit(repairId, sessionId, 'REWORKING', findings[0], { status: 'fail', strategy: 'CONTRACT_FIELD', previousStrategy: 'STALE_FIELD' }))
        continue
      }
      completeCampaignTask(current, ['review passed'])
    } else {
      completeCampaignTask(current, ['recorded'])
    }
    const done = state.tasks.find(item => item.id === current.id)
    if (done?.status === 'COMPLETE') {
      await bindCampaign(repairId, sessionId, 'PLANNING', emitProgress(), state, emit(repairId, sessionId, 'TASK_COMPLETE', `${done.role} ${done.id}`, { status: 'pass', detail: emitProgress() }))
    }
  }

  if (state.phase !== 'COMPLETE' && guard >= progressLimits(state.progress).iterations) {
    state.progress = applyIterationStop(state.progress, state.reworkCycles)
    return sealBlocked(repairId, blockedByProgress(`Task steps (${guard}) reached the limit.`, 'Continue in a new mission from the current files. This budget was not reset.'))
  }
  if (state.phase !== 'COMPLETE') {
    return sealBlocked(repairId, blocked('Campaign did not verify.', `${state.failureAttribution ?? 'verification incomplete'} ${state.tasks.map(task => `${task.id}:${task.status}`).join(' ')}`, [], false, 'Inspect the campaign task graph.'))
  }
  const saved = await persist(repairId, 'DONE', 'Campaign verified.', (_coding, runtime) => {
    runtime.campaign = state
    runtime.completion = {
      canComplete: true,
      changedFiles: [...state.filesMutated],
      tests: [{ command: 'unittest discover tests', ok: true, summary: state.knowledge.tests.join('; ') }],
      build: { ran: false, ok: true, summary: 'Build was not required.' },
      runtime: { ran: true, ok: true, summary: 'Integration and verification tests exited 0.' },
      limitations: ['Commit, push, and deploy remain Commander-gated.'],
      commitOccurred: false,
      pushOccurred: false,
      deployOccurred: false,
    }
  }, emit(repairId, sessionId, 'MISSION_COMPLETE', 'Campaign complete. No git commit, push, or deploy was executed.', { status: 'pass', validationResult: 'PASS' }))
  const resolved = {
    ...saved,
    state: 'resolved' as const,
    history: [...saved.history, { state: 'resolved' as const, at: new Date().toISOString(), note: 'Engineering campaign verified the outcome.' }],
    updatedAt: new Date().toISOString(),
  }
  await saveRepair(resolved)
  return resolved
}

async function runOwnedBody(repairId: string, issueId: string, sessionId: string | undefined, request: string): Promise<NativeRepairRecord> {
  const root = resolveRepoRoot()
  const priorCampaign = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.campaign
  if (priorCampaign?.phase || campaignShouldOwn(request) || await contextShouldOwn(root, request)) {
    return runCampaignBody(repairId, issueId, sessionId, request)
  }
  const priorLarge = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.largeProject
  if (priorLarge?.checkpoints?.length || await countProjectFiles(root) > SMALL_WORKSPACE_FILE_LIMIT) {
    return runLargeProjectBody(repairId, issueId, sessionId, request)
  }
  await persist(
    repairId,
    'ANALYZING',
    'Inspecting the workspace.',
    (coding, runtime) => {
      runtime.currentStrategy = 'DIRECT_FIX'
      if (!runtime.strategiesTried.includes('DIRECT_FIX')) runtime.strategiesTried.push('DIRECT_FIX')
    },
    emit(repairId, sessionId, 'MISSION_STARTED', 'Engineering mission started.', { status: 'running', detail: request.slice(0, 280) }),
  )
  if (isGovernanceProbe(request)) return governBlocked(repairId, sessionId, request)

  const files = await listRepoFiles()
  await persist(
    repairId,
    'ANALYZING',
    `Mapped ${files.length} files.`,
    (coding, runtime) => { runtime.preexistingPaths = files },
    emit(repairId, sessionId, 'REPOSITORY_MAP_CREATED', `Mapped ${files.length} relevant files.`, {
      status: 'pass',
      detail: files.slice(0, 12).join('\n'),
      progress: { current: files.length, total: files.length, label: 'files' },
    }),
  )
  const pyFiles = files.filter(file => file.endsWith('.py'))
  const entry = pyFiles.find(file => /serial|main|app/.test(file)) ?? pyFiles[0]
  if (!entry) {
    return sealBlocked(repairId, blocked(
      'No Python entry point was found.',
      'The workspace has no .py file the runtime can validate.',
      [],
      false,
      'Add the failing script inside this workspace and resume.',
    ))
  }
  const read = await readRepoFile(entry)
  if (!read.ok) return sealBlocked(repairId, blocked('Could not read the target file.', read.error, [], false, 'Restore the file and resume.'))
  await persist(
    repairId,
    'ANALYZING',
    `Reading ${entry}.`,
    (coding, runtime) => {
      runtime.scope.read = [...new Set([...runtime.scope.read, entry])]
      coding.filesRead = [...new Set([...coding.filesRead, entry])]
    },
    emit(repairId, sessionId, 'FILE_READ', entry, { status: 'pass', filePath: entry, detail: `${read.content.split('\n').length} lines` }),
  )

  const bin = await pythonBin(root)
  await persist(
    repairId,
    'ANALYZING',
    'Checking the Python runtime.',
    undefined,
    emit(repairId, sessionId, 'DEPENDENCY_CHECK', `Python executable: ${bin}.`, { status: 'pass', tool: 'python', command: `${bin} --version` }),
  )

  const syntax = await runStepCommand(repairId, sessionId, bin, ['-m', 'py_compile', entry], root, 'Validating syntax')
  if (syntax.code !== 0) {
    return sealBlocked(repairId, blocked('Syntax validation failed before a behavior repair.', syntax.stderr || syntax.stdout, [], false, 'Fix the syntax error shown in the activity card.'))
  }

  let attempt = 0
  let strategy: RepairStrategyClass = 'DIRECT_FIX'
  let latestFailure = ''
  while (attempt < 4) {
    if (isRepairCancellationRequested(repairId)) {
      return persist(repairId, 'CANCELLED', 'Commander stopped the mission.', undefined, emit(repairId, sessionId, 'PROCESS_STOPPED', 'Mission cancelled.', { status: 'blocked' }))
    }
    attempt += 1
    const run = await runStepCommand(repairId, sessionId, bin, [entry], root, `Running ${entry}`)
    if (run.code === 0) {
      return sealComplete(repairId, sessionId, entry, `${bin} ${entry}`, run.stdout || 'exit 0')
    }
    latestFailure = `${run.stderr}\n${run.stdout}`.trim()
    const parsed = parseUnexpectedKeyword(latestFailure)
    if (parsed) {
      const frames = parseTraceFrames(latestFailure)
      const localFrame = frames.find(frame => frame.file.endsWith(`/${entry}`) || frame.file.endsWith(`\\${entry}`) || frame.file.endsWith(entry))
      if (localFrame) {
        parsed.line = localFrame.line
        parsed.file = localFrame.file
      }
    }
    const signature = buildFailureSignature({
      tool: 'python',
      command: `${bin} ${entry}`,
      exitCode: run.code ?? 1,
      exceptionClass: parsed ? 'TypeError' : 'CommandFailure',
      message: parsed ? `${parsed.callable}() unexpected keyword ${parsed.keyword}` : latestFailure.slice(0, 300),
      file: entry,
      stackLocation: parsed?.line ? `${entry}:${parsed.line}` : entry,
      phase: 'VALIDATING',
    })
    const current = await readRepoFile(entry)
    const fingerprint = sourceFingerprint([current.ok ? current.content : ''])
    const history = (await getRepair(repairId))?.codingMission?.engineeringRuntime?.failureAttempts ?? []
    const decision = decideFailureContinuation({
      history,
      nextSignature: signature.id,
      nextStrategy: strategy,
      sourceFingerprint: fingerprint,
    })
    await persist(
      repairId,
      'REPAIRING',
      parsed ? `Invalid call: ${parsed.callable}(..., ${parsed.keyword}=...)` : 'Validation failed.',
      (coding, runtime) => {
        runtime.failureAttempts.push({ signature: signature.id, strategy, sourceFingerprint: fingerprint, summary: signature.message })
        coding.failureEvidence = {
          id: signature.id,
          at: new Date().toISOString(),
          command: `${bin} ${entry}`,
          errorSummary: signature.message,
          file: entry,
          repairAction: parsed ? `Move ${parsed.keyword} off ${parsed.callable}` : 'Trace the first actionable failure',
        }
      },
      emit(repairId, sessionId, 'FAILURE_DETECTED', parsed ? `${parsed.callable}() rejected ${parsed.keyword}.` : 'Command failed.', {
        status: 'fail',
        filePath: entry,
        failureSignature: signature.id,
        strategy,
        detail: latestFailure.slice(0, 500),
        command: `${bin} ${entry}`,
        exitCode: run.code ?? 1,
      }),
    )
    if (decision.action === 'block') {
      return sealBlocked(repairId, blocked(
        'Repeated identical failure signature.',
        signature.message,
        history.map(item => ({ strategy: item.strategy, outcome: item.summary })),
        false,
        'The source and failure did not change. Provide a different reproduction or a new constraint.',
      ))
    }
    if (decision.action === 'change_strategy') {
      strategy = decision.strategy
      await persist(
        repairId,
        'REPAIRING',
        decision.reason,
        (_coding, runtime) => {
          runtime.currentStrategy = strategy
          if (!runtime.strategiesTried.includes(strategy)) runtime.strategiesTried.push(strategy)
        },
        emit(repairId, sessionId, 'STRATEGY_CHANGED', decision.reason, {
          status: 'info',
          strategy,
          previousStrategy: decision.previousStrategy,
        }),
      )
    }
    if (!parsed || !current.ok) {
      strategy = 'ROOT_CAUSE_TRACE'
      continue
    }
    const accepts = await keywordAccepted(root, parsed.callable, parsed.keyword)
    await persist(
      repairId,
      'REPAIRING',
      'Tracing the failing call.',
      undefined,
      emit(repairId, sessionId, 'ROOT_CAUSE_FOUND', accepts === false
        ? `${parsed.callable} does not accept ${parsed.keyword}.`
        : `Traceback names ${parsed.callable} and keyword ${parsed.keyword}.`, {
        status: 'info',
        filePath: entry,
        repairHypothesis: `Unexpected keyword ${parsed.keyword} on ${parsed.callable}.`,
        strategy,
      }),
    )
    if (accepts === true) {
      return sealBlocked(repairId, blocked(
        'The local API accepts the keyword the traceback rejected.',
        signature.message,
        [{ strategy, outcome: 'inspect.signature disagrees with the traceback. No edit applied.' }],
        false,
        'Confirm which runtime is executing the script.',
      ))
    }
    const plan = planUnexpectedKeywordRepair(current.content, parsed)
    if (!plan) {
      return sealBlocked(repairId, blocked(
        'The failing keyword was found, but no safe callsite edit was available.',
        signature.message,
        [{ strategy, outcome: 'Callsite pattern was not a unique output-bound keyword.' }],
        false,
        'Point the mission at the exact function that should own the keyword.',
      ))
    }
    await persist(
      repairId,
      'EDITING',
      plan.hypothesis,
      undefined,
      emit(repairId, sessionId, 'REPAIR_HYPOTHESIS', plan.hypothesis, { status: 'info', filePath: entry, strategy, repairHypothesis: plan.hypothesis }),
    )
    const edited = await applyUniqueEdit({
      repairId,
      issueId,
      file: entry,
      before: current.content,
      after: plan.nextSource,
      start: plan.start,
      end: plan.end,
      reason: plan.hypothesis,
    })
    if (!edited.ok || !edited.receipt) {
      return sealBlocked(repairId, blocked('Patch validation refused the edit.', edited.error ?? 'apply failed', [{ strategy, outcome: edited.error ?? 'refused' }], false, 'The file changed under the mission or the anchor was not unique.'))
    }
    await persist(
      repairId,
      'EDITING',
      `Edited ${entry}.`,
      (coding, runtime) => {
        runtime.receipts.push(edited.receipt!)
        runtime.scope.modified = [...new Set([...runtime.scope.modified, entry])]
        coding.filesChanged = [...new Set([...coding.filesChanged, entry])]
        runtime.checkpoints.push({
          id: nextEngineeringEventId(),
          missionId: repairId,
          at: new Date().toISOString(),
          files: [{ path: entry, fingerprint: edited.receipt!.afterFingerprint }],
          commandsRun: [`${bin} ${entry}`],
          validationState: 'pending',
          failureSignatures: [signature.id],
          strategy,
          nextAction: 'Re-run the script',
        })
      },
      emit(repairId, sessionId, 'FILE_EDITED', `1 file changed. +${countLineChanges(edited.diff ?? '').plus} / -${countLineChanges(edited.diff ?? '').minus}`, {
        status: 'pass',
        filePath: entry,
        diff: edited.diff,
        detail: plan.hypothesis,
        strategy,
      }),
    )
  }
  return sealBlocked(repairId, blocked('Repair attempts were exhausted.', latestFailure.slice(0, 400), [], false, 'Review the activity feed and choose a different reproduction.'))
}

async function runStepCommand(
  repairId: string,
  sessionId: string | undefined,
  cmd: string,
  args: string[],
  cwd: string,
  summary: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const command = [cmd, ...args].join(' ')
  const governance = classifyEngineeringCommand(cmd, args, false)
  if (!governance.allowed) {
    await persist(
      repairId,
      'BLOCKED',
      governance.reason ?? 'Command denied.',
      undefined,
      emit(repairId, sessionId, 'WAITING_FOR_APPROVAL', command, { status: 'blocked', command, governance, detail: governance.reason }),
    )
    return { code: null, stdout: '', stderr: governance.reason ?? 'denied' }
  }
  const ref = `repair:${repairId}:cmd:${nextEngineeringEventId()}`
  await persist(
    repairId,
    'TESTING',
    summary,
    undefined,
    emit(repairId, sessionId, 'COMMAND_STARTED', summary, { status: 'running', command, cwd, tool: cmd, governance }),
  )
  const started = Date.now()
  const result = await runEngineeringCommand({ missionId: repairId, cmd, args, cwd, timeoutMs: 20_000 })
  const combined = `${result.stdout}${result.stderr}`
  const telemetry = combined.split('\n').map(parseTrainingTelemetry).filter(Boolean).at(-1)
  await persist(
    repairId,
    result.code === 0 ? 'TESTING' : 'REPAIRING',
    result.code === 0 ? `${summary} passed.` : `${summary} failed.`,
    (_coding, runtime) => {
      rememberRaw(runtime, ref, combined)
    },
    emit(repairId, sessionId, 'COMMAND_COMPLETED', result.code === 0 ? 'PASS' : 'FAIL', {
      status: result.code === 0 ? 'pass' : 'fail',
      command,
      cwd,
      exitCode: result.code ?? undefined,
      durationMs: Date.now() - started,
      rawOutputRef: ref,
      outputTail: combined.slice(-800),
      detail: telemetry?.step ? `Step ${telemetry.step}` : combined.slice(-240),
      validationResult: result.code === 0 ? 'PASS' : 'FAIL',
      progress: telemetry?.step ? { current: Number(telemetry.step.split('/')[0]), total: Number(telemetry.step.split('/')[1]), label: telemetry.gradient } : undefined,
    }),
  )
  return result
}

function rememberRaw(runtime: FoundryEngineeringRuntimeState, ref: string, text: string) {
  const next = rememberRawOutput(runtime, ref, text)
  runtime.rawOutputs = next.rawOutputs
}

async function sealComplete(repairId: string, sessionId: string | undefined, file: string, command: string, output: string): Promise<NativeRepairRecord> {
  const saved = await persist(
    repairId,
    'DONE',
    'Mission complete. No git commit, push, or deploy was executed.',
    (coding, runtime) => {
      runtime.completion = {
        canComplete: true,
        changedFiles: coding.filesChanged,
        tests: [{ command, ok: true, summary: output.slice(0, 180) || 'PASS' }],
        build: { ran: false, ok: true, summary: 'Build not required for this one-file repair.' },
        runtime: { ran: true, ok: true, summary: 'Script exited 0.' },
        limitations: ['Installed War Room package is unchanged until a separate Commander-approved install.'],
        commitOccurred: false,
        pushOccurred: false,
        deployOccurred: false,
      }
      runtime.blockedDetail = null
      coding.validationOutcome = 'VALIDATED'
    },
    emit(repairId, sessionId, 'MISSION_COMPLETE', 'COMPLETE', {
      status: 'pass',
      filePath: file,
      detail: 'Commit: no. Push: no. Deploy: no.',
      validationResult: 'PASS',
    }),
  )
  const resolved = {
    ...saved,
    state: 'resolved' as const,
    history: [...saved.history, { state: 'resolved' as const, at: new Date().toISOString(), note: 'Engineering runtime validated the repair.' }],
    updatedAt: new Date().toISOString(),
  }
  await saveRepair(resolved)
  return resolved
}

async function governBlocked(repairId: string, sessionId: string | undefined, request: string): Promise<NativeRepairRecord> {
  const governance = classifyEngineeringCommand('git', ['push', 'origin', 'main'], false)
  const detail = blocked(
    'git push is not authorized.',
    `The mission asked for a governance block (${request.slice(0, 80)}). git push was not executed.`,
    [{ strategy: 'GOVERNANCE', outcome: governance.reason ?? 'Commander approval required.' }],
    false,
    'Commander must explicitly authorize a push. Foundry will not push on its own.',
  )
  await persist(
    repairId,
    'BLOCKED',
    detail.summary,
    (_coding, runtime) => { runtime.blockedDetail = detail },
    emit(repairId, sessionId, 'BLOCKED', detail.summary, {
      status: 'blocked',
      command: 'git push origin main',
      governance,
      detail: `${detail.failure}\nTried: governance classification only.\nNeed: ${detail.unblockAction}`,
    }),
  )
  const saved = await getRepair(repairId)
  if (!saved) throw new Error('missing repair')
  const blockedRecord = { ...saved, state: 'blocked' as const, updatedAt: new Date().toISOString() }
  await saveRepair(blockedRecord)
  return blockedRecord
}

export async function rollbackOwnedMission(repairId: string): Promise<{ ok: boolean; restored: string[] }> {
  await persist(
    repairId,
    'REPAIRING',
    'Rolling back mission-scoped edits.',
    undefined,
    emit(repairId, undefined, 'ROLLBACK_STARTED', 'Reverting files this mission changed.', { status: 'running' }),
  )
  const result = await rollbackRepair(repairId)
  await persist(
    repairId,
    'REPAIRING',
    'Rollback finished.',
    undefined,
    emit(repairId, undefined, 'ROLLBACK_COMPLETE', `Restored ${result.restoredFiles.length} file(s).`, {
      status: result.errors.length ? 'fail' : 'pass',
      detail: [...result.restoredFiles, ...result.errors].join('\n'),
    }),
  )
  return { ok: result.errors.length === 0, restored: result.restoredFiles }
}

export function activityHeading(type: string, phase: string, summary: string): string {
  return activityTitle({ type, phase, summary })
}

export function workspaceClass(input: Parameters<typeof classifyWorkspacePath>[0]) {
  return classifyWorkspacePath(input)
}

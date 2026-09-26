/**
 * Autonomous bounded coding loop. Owns iteration; still uses runtime.ts for every state
 * transition and patch apply. Does not skip awaiting_local_execution_approval — bounded_coding
 * missions auto-grant that step because Commander already authorized the mission.
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  approveAndApply,
  adoptPreparedProposal,
  cancelMissionExecution,
  commanderResolve,
  planRepair,
} from './runtime'
import { getIssue, getRepair, saveRepair } from './storage'
import { buildRepoMap } from './repoMap'
import { buildTaskTrackerProposal, isTaskTrackerRequest } from './scaffold'
import { executeTypedTerminal, startOwnedProcess, stopOwnedProcesses } from './terminalExecutor'
import { appendProjectMemory, writeProjectMemory } from './projectMemory'
import { isRepairCancellationRequested } from './processRegistry'
import { acquireMissionOwnership, isMissionOwned, releaseMissionOwnership, runAsExecutor, withRecordLock } from './foundryMissionOwnership'
import { engineeringRuntimeShouldOwn, runOwnedEngineeringMission, terminalSealReason } from './foundryEngineeringRuntime'
import { countProjectFiles, largeProjectShouldOwn } from './foundryLargeProject'
import { campaignShouldOwn } from './foundryEngineeringCampaign'
import { contextShouldOwn } from './foundryProjectContextIO'
import { decideFailureContinuation, buildFailureSignature, sourceFingerprint } from './foundryEngineeringFailure'
import { emptyEngineeringRuntime, engineeringEvent, reduceEngineeringEvents, workstreamTextForEvent, type FoundryEngineeringEventType } from './foundryEngineeringEvents'
import { runFoundryMission } from './foundryLoop'
import { resolveLocalCoder } from './localCoder'
import { failureFromValidation, toCommanderState } from './foundryCommanderState'
import {
  invokeDirectCouncilProvider,
  resolveConfiguredProviderFamily,
} from '@/lib/council/providerDirectCall'
import type {
  NativeCodingMissionState,
  NativeEngineerProgressStep,
  NativeRepairRecord,
  NativeValidationResult,
} from './types'


function hashFailure(results: NativeValidationResult[]): string {
  const failed = results.filter(r => !r.ok).map(r => `${r.operation.id}:${r.exitCode}:${(r.stderr || r.stdout).slice(0, 400)}`)
  return createHash('sha256').update(failed.join('|') || 'ok').digest('hex').slice(0, 16)
}

export function isDuplicateFailureLoop(signatures: string[], next: string, limit = 3): boolean {
  return [...signatures, next].filter(s => s === next).length >= limit
}

async function bump(repairId: string, step: NativeEngineerProgressStep, detail: string, extra?: Partial<NativeCodingMissionState>): Promise<NativeRepairRecord> {
  const record = await getRepair(repairId)
  if (!record) throw new Error(`No repair ${repairId}`)
  const coding = record.codingMission
  if (!coding) return record
  const merged: NativeCodingMissionState = {
    ...coding,
    ...extra,
    currentStep: step,
    commanderState: toCommanderState({ currentStep: step, failureEvidence: extra?.failureEvidence ?? coding.failureEvidence }, record.validationResults),
    currentAction: extra?.currentAction ?? detail,
    progressEvents: [...coding.progressEvents, { at: new Date().toISOString(), step, detail }].slice(-200),
  }
  const eventType = eventTypeForStep(step, detail)
  const event = engineeringEvent(eventType, {
    missionId: repairId,
    reasoningSessionId: merged.sessionId,
    summary: detail,
    phase: phaseForCommanderStep(step),
    status: step === 'BLOCKED' ? 'blocked' : step === 'DONE' || step === 'COMPLETE' ? 'pass' : 'running',
    detail,
    failureSignature: extra?.blockingReason,
  })
  const runtime = merged.engineeringRuntime ?? emptyEngineeringRuntime()
  runtime.events = reduceEngineeringEvents(runtime.events, event)
  const next: NativeCodingMissionState = {
    ...merged,
    engineeringRuntime: runtime,
    workstream: [...(merged.workstream ?? []), {
      id: event.eventId,
      at: event.timestamp,
      kind: step === 'BLOCKED' ? 'repair' as const : 'status' as const,
      text: workstreamTextForEvent(event),
      source: 'execution' as const,
      ok: event.status === 'pass' ? true : event.status === 'fail' || event.status === 'blocked' ? false : undefined,
    }].slice(-80),
  }
  const updated = { ...record, codingMission: next, updatedAt: new Date().toISOString() }
  await saveRepair(updated)
  return updated
}

function eventTypeForStep(step: NativeEngineerProgressStep, detail: string): FoundryEngineeringEventType {
  if (step === 'BLOCKED') return 'BLOCKED'
  if (step === 'DONE' || step === 'COMPLETE') return 'MISSION_COMPLETE'
  if (step === 'CANCELLED') return 'PROCESS_STOPPED'
  if (step === 'ANALYZING') return 'WORKSPACE_SCAN_STARTED'
  if (step === 'PLANNING') return /Mapped/.test(detail) ? 'REPOSITORY_MAP_CREATED' : 'WORKSPACE_SCAN_COMPLETE'
  if (step === 'EDITING') return 'REPAIR_STARTED'
  if (step === 'TESTING') return 'TEST_STARTED'
  if (step === 'RUNNING' || step === 'BUILDING') return step === 'BUILDING' ? 'BUILD_STARTED' : 'PROCESS_STARTED'
  if (step === 'REPAIRING') return 'REPAIR_STARTED'
  if (step === 'WAITING_FOR_APPROVAL' || step === 'AWAITING_APPROVAL') return 'WAITING_FOR_APPROVAL'
  return 'MISSION_RESUMED'
}

function phaseForCommanderStep(step: NativeEngineerProgressStep): string {
  if (step === 'ANALYZING') return 'ANALYZING'
  if (step === 'EDITING') return 'EDITING'
  if (step === 'TESTING' || step === 'RUNNING') return 'VALIDATING'
  if (step === 'REPAIRING') return 'REPAIRING'
  if (step === 'BLOCKED' || step === 'PAUSED_PROVIDER_UNAVAILABLE') return 'BLOCKED'
  if (step === 'DONE' || step === 'COMPLETE') return 'COMPLETE'
  if (step === 'BUILDING') return 'RUNNING'
  return 'PLANNING'
}

function requireCoding(record: NativeRepairRecord): NativeCodingMissionState {
  if (!record.codingMission) throw new Error(`Repair ${record.id} is missing codingMission state.`)
  return record.codingMission
}

function loopHostedCoder() {
  const family = resolveConfiguredProviderFamily('claude')
  if (!family) return undefined
  return { family, invoke: invokeDirectCouncilProvider }
}

export function isCodingMissionRunning(repairId: string): boolean {
  return isMissionOwned(repairId)
}

/**
 * Runs (or resumes) a mission. Exactly one executor may own a mission id per process, and that ownership is process-global
 * (foundryMissionOwnership) so startup recovery and any API route converge on the same executor. A second request for a
 * mission that is already running ATTACHES: it returns the current record and starts nothing, writes nothing, resets nothing.
 */
export async function runCodingMission(repairId: string): Promise<NativeRepairRecord> {
  // A sealed mission (complete, stopped, rolled back, terminally paused) is never run: no executor is started, nothing is written.
  const existing = await getRepair(repairId)
  const sealed = terminalSealReason(existing)
  if (existing && sealed) {
    await logExecutor(repairId, 'sealed-noop')
    return existing
  }
  const owner = acquireMissionOwnership(repairId)
  if (!owner) {
    await logExecutor(repairId, 'attached')
    const current = await getRepair(repairId)
    if (!current) throw new Error(`No repair ${repairId}`)
    return current
  }
  await logExecutor(repairId, 'started', owner.token)
  try {
    return await runAsExecutor(owner, () => runCodingMissionUnlocked(repairId))
  } finally {
    releaseMissionOwnership(owner)
    await logExecutor(repairId, 'released', owner.token)
  }
}

/**
 * Diagnostic journal of executor ownership (NOT mission truth): one line per start / attach / release. It lets an operator prove
 * that exactly one executor ran for a mission while several resume requests arrived. Best effort; never blocks or fails a run.
 */
async function logExecutor(repairId: string, action: 'started' | 'attached' | 'released' | 'sealed-noop', token?: string): Promise<void> {
  try {
    const dir = path.join(resolveRepoRoot(), '.war-room', 'native-builder', 'executors')
    await mkdir(dir, { recursive: true })
    await appendFile(path.join(dir, `${repairId}.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), action, pid: process.pid, token: token?.slice(0, 8) })}\n`, 'utf8')
  } catch { /* diagnostics only */ }
}

async function runCodingMissionUnlocked(repairId: string): Promise<NativeRepairRecord> {
  let record = await getRepair(repairId)
  if (!record?.codingMission) {
    throw new Error('runCodingMission requires codingMission state on the repair record.')
  }
  if (record.codingMission.mode !== 'bounded_coding') {
    throw new Error('runCodingMission only runs bounded_coding missions.')
  }
  if (record.codingMission.engineeringRuntime?.completion?.canComplete && (record.state === 'resolved' || record.codingMission.currentStep === 'DONE')) {
    return record
  }
  if (record.state === 'blocked' && record.codingMission.engineeringRuntime?.blockedDetail) {
    return record
  }

  const signatures: string[] = []
  const maxAttempts = record.codingMission.maxAttempts || 8

  if (record.state === 'escalation_recommended') {
    const local = await resolveLocalCoder()
    return bump(repairId, 'PAUSED_PROVIDER_UNAVAILABLE', 'No executable proposal could be generated from available providers.', {
      blockingReason: 'PAUSED_PROVIDER_UNAVAILABLE',
      localCoderStatus: local.status,
      hostedCoderStatus: local.hostedStatus,
    })
  }

  if (record.codingMission.engineeringRuntime?.campaign?.phase || record.codingMission.engineeringRuntime?.largeProject?.phase) {
    return runOwnedEngineeringMission(repairId)
  }
  if (campaignShouldOwn(record.codingMission.commanderRequest ?? '') || await contextShouldOwn(resolveRepoRoot(), record.codingMission.commanderRequest ?? '')) {
    return runOwnedEngineeringMission(repairId)
  }
  const projectFileCount = await countProjectFiles()
  if (largeProjectShouldOwn({
    fileCount: projectFileCount,
    request: record.codingMission.commanderRequest ?? '',
  })) {
    return runOwnedEngineeringMission(repairId)
  }

  record = await bump(repairId, 'ANALYZING', 'Inspecting workspace and building a compact repository map.')
  const map = await buildRepoMap()
  await writeProjectMemory({
    architecture: map.architectureNotes,
    importantPaths: [...map.entryPoints, ...map.importantDirectories.slice(0, 12)],
    commands: [...map.testCommands, ...map.buildCommands],
    dependencies: map.dependencies,
  })
  record = await bump(repairId, 'PLANNING', `Mapped ${map.fileCount} files (${map.framework}/${map.runtime}).`, {
    filesRead: [...new Set([...(record.codingMission?.filesRead ?? []), ...map.entryPoints])],
    plan: [
      'Inspect workspace',
      'Apply bounded changes',
      'Run validation',
      'Repair failures',
      'Probe local runtime when applicable',
    ],
  })

  if (engineeringRuntimeShouldOwn({
    fileCount: map.fileCount,
    request: record.codingMission?.commanderRequest ?? '',
  })) {
    return runOwnedEngineeringMission(repairId)
  }

  const issue = await getIssue(record.issueId)
  if (!issue) throw new Error(`No issue for repair ${repairId}`)

  if (map.fileCount === 0 && isTaskTrackerRequest(requireCoding(record).commanderRequest)) {
    const proposal = buildTaskTrackerProposal(issue)
    record = await adoptPreparedProposal(repairId, proposal)
    record = await bump(repairId, 'EDITING', 'Scaffolding task-tracker files.', {
      filesChanged: proposal.relevantFiles,
    })
  } else if (map.fileCount === 0) {
    const local = await resolveLocalCoder()
    if (local.available) {
      return runFoundryMission(repairId)
    }
    const coding = requireCoding(record)
    record = await planRepair(repairId, { useLocalModel: false, hostedCoder: loopHostedCoder(), commanderRequestText: coding.commanderRequest, targetFiles: coding.filesRead.length ? coding.filesRead : undefined })
    if (!record.selectedProposal) {
      return bump(repairId, 'BLOCKED', local.detail, {
        foundryMode: 'FOUNDRY_LOCAL_MODE',
        localCoderStatus: 'LOCAL_CODER_UNAVAILABLE',
        hostedCoderStatus: local.hostedStatus,
        blockingReason: 'LOCAL_CODER_UNAVAILABLE',
        validationOutcome: 'BLOCKED_BY_ENVIRONMENT',
      })
    }
  } else if (!record.selectedProposal || record.state === 'collecting_evidence' || record.state === 'blocked') {
    const coding = requireCoding(record)
    const local = await resolveLocalCoder()
    record = await planRepair(repairId, { useLocalModel: local.available, hostedCoder: loopHostedCoder(), commanderRequestText: coding.commanderRequest, targetFiles: coding.filesRead.length ? coding.filesRead : undefined })
  }

  while (true) {
    record = (await getRepair(repairId)) ?? record
    if (!record.codingMission) break
    if (isRepairCancellationRequested(repairId) || record.state === 'cancelled') {
      return bump(repairId, 'CANCELLED', 'Commander stopped the mission. Workspace changes were preserved.')
    }
    if (record.codingMission.attempt >= maxAttempts) {
      return bump(repairId, 'BLOCKED', `No progress after ${maxAttempts} attempts.`, {
        blockingReason: `Iteration budget exhausted (${maxAttempts}).`,
        validationOutcome: 'BLOCKED_BY_ENVIRONMENT',
      })
    }

    if (record.state === 'awaiting_local_execution_approval' && record.codingMission.mode === 'bounded_coding') {
      record = await bump(repairId, 'EDITING', 'Applying in-workspace changes authorized by mission start.')
      record = await approveAndApply(repairId, true)
      const files = record.selectedProposal?.relevantFiles ?? []
      const coding = requireCoding(record)
      await bump(repairId, 'TESTING', 'Running planned validations.', {
        attempt: coding.attempt + 1,
        filesChanged: [...new Set([...(coding.filesChanged ?? []), ...files])],
        testsExecuted: (record.validationResults ?? []).map(v => v.operation.id),
        commandsExecuted: [...coding.commandsExecuted, ...((record.validationResults ?? []).map(v => v.operation.id))],
      })
      continue
    }

    if (record.state === 'verification_failed' || record.state === 'blocked') {
      const sig = hashFailure(record.validationResults ?? [])
      const failed = (record.validationResults ?? []).filter(item => !item.ok)
      const exitCode = failed[0]?.exitCode
      const signature = buildFailureSignature({
        tool: failed[0]?.operation.id,
        command: failed[0]?.operation.id,
        exitCode: exitCode === null || exitCode === undefined ? undefined : exitCode,
        message: (failed[0]?.stderr || failed[0]?.stdout || '').slice(0, 400),
        phase: 'VALIDATING',
      })
      const fingerprint = sourceFingerprint([
        ...(record.selectedProposal?.plannedChanges ?? []).map(change => JSON.stringify(change.patch)),
        sig,
      ])
      const history = record.codingMission?.engineeringRuntime?.failureAttempts ?? []
      const currentStrategy = record.codingMission?.engineeringRuntime?.currentStrategy ?? 'DIRECT_FIX'
      const decision = decideFailureContinuation({
        history,
        nextSignature: signature.id,
        nextStrategy: currentStrategy,
        sourceFingerprint: fingerprint,
      })
      if (decision.action === 'block') {
        const attempts = history.map(item => `${item.strategy}: ${item.summary}`)
        return bump(repairId, 'BLOCKED', 'Repeated identical failure signature — stopping to avoid a retry loop.', {
          blockingReason: `Duplicate failure signature ${signature.id}. Tried ${attempts.join(' | ') || 'none'}. Need a new source change or Commander direction.`,
          engineeringRuntime: {
            ...(record.codingMission?.engineeringRuntime ?? emptyEngineeringRuntime()),
            blockedDetail: {
              summary: 'Repeated identical failure signature.',
              failure: signature.message || sig,
              attempts: history.map(item => ({ strategy: item.strategy, outcome: item.summary })),
              currentState: 'No further automatic strategy remains for this unchanged failure.',
              rolledBack: false,
              boundary: decision.reason,
              unblockAction: 'Change the reproduction, the source, or give Foundry a narrower file to edit.',
            },
          },
        })
      }
      signatures.push(sig)
      record = await bump(repairId, 'REPAIRING', decision.action === 'change_strategy' ? decision.reason : 'Recording a new failure attempt.', {
        engineeringRuntime: {
          ...(record.codingMission?.engineeringRuntime ?? emptyEngineeringRuntime()),
          currentStrategy: decision.action === 'change_strategy' ? decision.strategy : currentStrategy,
          strategiesTried: [...new Set([
            ...(record.codingMission?.engineeringRuntime?.strategiesTried ?? []),
            decision.action === 'change_strategy' ? decision.strategy : currentStrategy,
          ])],
          failureAttempts: [...history, { signature: signature.id, strategy: currentStrategy, sourceFingerprint: fingerprint, summary: signature.message || sig }],
        },
      })
      const evidence = failureFromValidation(record.validationResults ?? [], 'Generating an evidence-backed repair')
      record = await bump(repairId, 'REPAIRING', evidence?.errorSummary || 'Validation failed — generating an evidence-backed repair.', {
        failureEvidence: evidence,
        currentAction: evidence?.repairAction || 'Generating repair',
        nextAction: 'Re-run validations',
      })
      record = await planRepair(repairId, {
        useLocalModel: true,
        hostedCoder: loopHostedCoder(),
        commanderRequestText: requireCoding(record).commanderRequest,
        targetFiles: record.selectedProposal?.relevantFiles,
      })
      continue
    }

    if (record.state === 'awaiting_commander_review' || record.state === 'partially_verified' || record.state === 'resolved') {
      const validations = record.validationResults ?? []
      const allOk = validations.length > 0 && validations.every(v => v.ok)
      if (!allOk) {
        const evidence = failureFromValidation(validations, 'Repairing failed or missing validations')
          ?? {
            id: 'missing-validation',
            at: new Date().toISOString(),
            errorSummary: validations.length ? 'Review reached without passing validations' : 'No validations recorded',
            action: 'validation',
            repairAction: 'Generate tests and repair',
          }
        record = await bump(repairId, 'REPAIRING', evidence.errorSummary, {
          failureEvidence: evidence,
          currentAction: evidence.repairAction,
          nextAction: 'Re-run validations',
        })
        record = await planRepair(repairId, { useLocalModel: true, hostedCoder: loopHostedCoder(), commanderRequestText: requireCoding(record).commanderRequest })
        continue
      }
      if (record.codingMission.mode === 'bounded_coding') {
        const looksLikeWeb = (record.selectedProposal?.relevantFiles ?? []).some(f => f.endsWith('server.mjs'))
        const alreadyProbed = validations.some(v => v.operation.id === 'http_probe')
        if (looksLikeWeb && !alreadyProbed) {
          await bump(repairId, 'RUNNING', 'Starting local HTTP server for runtime verification.')
          await startOwnedProcess({
            repairId,
            cmd: 'node',
            args: ['server.mjs'],
            label: 'node server.mjs',
          })
          await new Promise(resolve => setTimeout(resolve, 900))
          let probe = await executeTypedTerminal({
            operation: { id: 'http_probe', targets: ['http://127.0.0.1:18765/health'] },
            repairId,
          })
          if (!probe.ok) {
            await new Promise(resolve => setTimeout(resolve, 900))
            probe = await executeTypedTerminal({
              operation: { id: 'http_probe', targets: ['http://127.0.0.1:18765/health'] },
              repairId,
            })
          }
          const withProbe = { ...record, validationResults: [...validations, probe], updatedAt: new Date().toISOString() }
          await saveRepair(withProbe)
          record = withProbe
          await stopOwnedProcesses(repairId)
          const payloadOk = /"ok"\s*:\s*true/.test(probe.stdout)
          if (!probe.ok || !payloadOk) {
            return bump(repairId, 'BLOCKED', 'Application files validated but local HTTP probe failed.', {
              validationOutcome: 'PARTIALLY_VALIDATED',
              blockingReason: probe.stderr || probe.stdout || 'http_probe failed',
            })
          }
        }
        if (record.state !== 'resolved') {
          record = await commanderResolve(repairId, true)
        }
        await appendProjectMemory('completedMissions', repairId)
        const outcome = (record.verification?.status === 'resolved' || looksLikeWeb) ? 'VALIDATED' : 'PARTIALLY_VALIDATED'
        return bump(repairId, 'DONE', `Mission complete (${outcome}). No git commit or push was executed.`, {
          validationOutcome: outcome,
        })
      }
      return bump(repairId, 'DONE', 'Mission waiting on Commander accept (gated_repair).', {
        validationOutcome: 'IMPLEMENTED',
      })
    }

    if (record.state === 'escalation_recommended') {
      const local = await resolveLocalCoder()
      return bump(repairId, 'PAUSED_PROVIDER_UNAVAILABLE', 'No executable proposal could be generated from available providers.', {
        blockingReason: 'PAUSED_PROVIDER_UNAVAILABLE',
        localCoderStatus: local.status,
        hostedCoderStatus: local.hostedStatus,
      })
    }

    return bump(repairId, 'BLOCKED', `Stopped in unexpected state ${record.state}.`, {
      blockingReason: record.state,
    })
  }

  return (await getRepair(repairId)) ?? record
}

export async function resumeCodingMission(repairId: string): Promise<NativeRepairRecord> {
  const record = await getRepair(repairId)
  if (!record) throw new Error(`No repair ${repairId}`)
  if (record.state === 'cancelled') {
    throw new Error('Cancelled missions cannot auto-resume the state machine; create a follow-up mission or replan from a non-cancelled state.')
  }
  return runCodingMission(repairId)
}

export async function stopCodingMission(repairId: string, reason?: string): Promise<NativeRepairRecord> {
  await stopOwnedProcesses(repairId)
  // Serialized with the executor's own writes; once the record is cancelled the executor is sealed out at its next write.
  return withRecordLock(repairId, async () => {
    const cancelled = await cancelMissionExecution(repairId, reason ?? 'Commander STOP MISSION.')
    const coding = cancelled.codingMission
    if (!coding) return cancelled
    const updated = {
      ...cancelled,
      codingMission: {
        ...coding,
        currentStep: 'CANCELLED' as const,
        progressEvents: [...coding.progressEvents, { at: new Date().toISOString(), step: 'CANCELLED' as const, detail: reason ?? 'Commander STOP MISSION.' }],
      },
    }
    await saveRepair(updated)
    return updated
  })
}

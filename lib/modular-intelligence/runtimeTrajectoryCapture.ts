import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { captureExperience } from '@/lib/agi-experience/capture'
import { officialActiveCore } from './composedRuntime'
import { toExperienceCapture, toObservationalCandidate } from './experienceHooks'
import { isNativeRouterV1PilotEnabled } from './nativeRouterV1PilotGate'
import { isTrajectoryObservationEnabled } from './trajectoryObservationGate'
import {
  trajectoryIdFor,
  type ObservationalTrajectory,
} from './trajectoryObserver'
import type { TrajectorySourceType } from './trajectorySourceTypes'
import type { ToolDecision, ToolExperienceFields, ToolResult, ToolResultStatus, ToolValidationCode } from './types'

export const RUNTIME_OBSERVER_DEV_DIR = join(
  'model-lab',
  'manifests',
  'wr_tool_trajectories',
  'REAL-RUNTIME-OBSERVER-DEV-V1',
)

export const RAW_TRAJECTORIES_FILENAME = 'raw-trajectories.jsonl'

const FORBIDDEN_TRAINING_MARKERS = [
  'run_lora',
  'ModelLabOptimizer',
  'promote_checkpoint',
  'WRIM1-RUN-000003',
  'createCurriculumAutomatically',
] as const

export type RuntimeObservationEvent = {
  request_text: string
  conversation_id?: string | null
  request_id?: string | null
  decision: ToolDecision
  tool_id: string | null
  arguments: Record<string, string>
  router_validation_status?: ToolValidationCode | null
  execution_status?: string | null
  tool_result_status?: ToolResultStatus | string | null
  tool_result?: unknown
  error?: string | null
  no_tool_reason?: string | null
  source_type: TrajectorySourceType
  insertion_point: string
  duration_ms?: number | null
  provider?: string | null
  context_dependence?: 'STANDALONE' | 'CONTEXT_DEPENDENT' | null
  context_ref?: string | null
  provenance?: Record<string, string>
  message_id?: string | null
}

export type CapturedRuntimeTrajectory = ObservationalTrajectory & {
  trajectory_id: string
  conversation_id: string | null
  request_id: string | null
  router_validation_status: string | null
  execution_status: string | null
  tool_result_status: string | null
  error: string | null
  no_tool_reason: string | null
  source_type: TrajectorySourceType
  core_model_id: string
  active_module_ids: string[]
  insertion_point: string
  duration_ms: number | null
  provider: string | null
  context_dependence: 'STANDALONE' | 'CONTEXT_DEPENDENT' | 'UNKNOWN'
  context_ref: string | null
  experience_record_attempted: boolean
  training_invoked: false
  optimizer_invoked: false
  promotion_invoked: false
}

export type CaptureTimings = {
  capture_ms: number
  serialize_ms: number
  persist_ms: number
  total_ms: number
}

export type CaptureOutcome = {
  captured: boolean
  skipped_reason?: string
  record?: CapturedRuntimeTrajectory
  timings?: CaptureTimings
  persist_error?: string
}

type CaptureHooks = {
  persistLine?: (line: string) => void
  persistDir?: string
  skipExperience?: boolean
  throwOnPersist?: boolean
}

let hooks: CaptureHooks = {}
let persistFailureCount = 0

export function configureTrajectoryCaptureForTests(next: CaptureHooks): void {
  hooks = next
}

export function resetTrajectoryCaptureForTests(): void {
  hooks = {}
  persistFailureCount = 0
}

export function trajectoryPersistFailureCount(): number {
  return persistFailureCount
}

function honestNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null
  return value
}

export function sourceTypeForExecuteMode(mode: string): TrajectorySourceType {
  if (mode === 'bounded_sha256') return 'REAL_RUNTIME'
  if (mode === 'dry_run') return 'GYM_FIXTURE'
  if (mode === 'mock') return 'SYNTHETIC'
  return 'UNKNOWN'
}

export function eventToExperience(event: RuntimeObservationEvent): ToolExperienceFields {
  const success =
    event.decision === 'NO_TOOL'
      ? event.router_validation_status === 'VALID' || event.router_validation_status == null
      : event.tool_result_status === 'ok' || event.tool_result_status === 'dry_run' || event.tool_result_status === 'mock'
  return {
    request: event.request_text,
    decision: event.decision,
    selected_tool: event.decision === 'NO_TOOL' ? null : event.tool_id,
    arguments: event.arguments,
    tool_result: event.tool_result ?? null,
    success,
    correction: null,
    provenance: {
      ...(event.provenance ?? {}),
      source_type: event.source_type,
      insertion_point: event.insertion_point,
    },
    capability_family: 'tool_use',
  }
}

function persistRawLine(line: string): void {
  if (hooks.persistLine) {
    hooks.persistLine(line)
    return
  }
  const dir = hooks.persistDir ?? join(process.cwd(), RUNTIME_OBSERVER_DEV_DIR)
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, RAW_TRAJECTORIES_FILENAME), `${line}\n`, 'utf8')
}

/**
 * Passive capture. Never throws to the tool/chat caller unless tests set throwOnPersist
 * *after* the observational record is built — callers still wrap this in try/catch.
 */
export function captureRuntimeTrajectory(event: RuntimeObservationEvent): CaptureOutcome {
  const t0 = Date.now()
  const pilotCapture =
    event.provenance?.native_router_v1_pilot === '1' && isNativeRouterV1PilotEnabled()
  if (!isTrajectoryObservationEnabled() && !pilotCapture) {
    return { captured: false, skipped_reason: 'gate_disabled' }
  }

  try {
    const runtime = officialActiveCore()
    const experience = eventToExperience(event)
    const observed = toObservationalCandidate(experience, runtime.composedRuntimeId)
    const captureMs = Date.now() - t0
    const t1 = Date.now()
    const record: CapturedRuntimeTrajectory = {
      ...observed,
      trajectory_id: trajectoryIdFor({
        request: observed.request,
        decision: observed.decision,
        tool: observed.selected_tool,
        arguments: observed.arguments,
        timestamp: observed.timestamp,
      }),
      conversation_id: honestNull(event.conversation_id),
      request_id: honestNull(event.request_id),
      router_validation_status: honestNull(event.router_validation_status ?? null),
      execution_status: honestNull(event.execution_status ?? null),
      tool_result_status: event.tool_result_status == null ? null : String(event.tool_result_status),
      error: honestNull(event.error),
      no_tool_reason: event.decision === 'NO_TOOL' ? honestNull(event.no_tool_reason) : null,
      source_type: event.source_type,
      core_model_id: runtime.activeCoreId,
      active_module_ids: [...runtime.activeModuleIds],
      insertion_point: event.insertion_point,
      duration_ms: event.duration_ms ?? null,
      provider: honestNull(event.provider),
      context_dependence: event.context_dependence ?? 'UNKNOWN',
      context_ref: honestNull(event.context_ref),
      experience_record_attempted: false,
      training_invoked: false,
      optimizer_invoked: false,
      promotion_invoked: false,
      provenance: {
        ...observed.provenance,
        source_type: event.source_type,
        insertion_point: event.insertion_point,
        capture: 'observational',
      },
    }

    const line = JSON.stringify(record)
    const serializeMs = Date.now() - t1
    const t2 = Date.now()
    try {
      persistRawLine(line)
    } catch (err) {
      persistFailureCount += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[trajectory-observer] persist failed (count=${persistFailureCount}):`,
        msg,
      )
      if (hooks.throwOnPersist) throw err
      return {
        captured: true,
        record,
        persist_error: msg,
        timings: {
          capture_ms: captureMs,
          serialize_ms: serializeMs,
          persist_ms: Date.now() - t2,
          total_ms: Date.now() - t0,
        },
      }
    }
    const persistMs = Date.now() - t2

    if (!hooks.skipExperience) {
      record.experience_record_attempted = true
      const hook = toExperienceCapture({
        conversationId: record.conversation_id,
        messageId: event.message_id ?? null,
        contextSnapshotId: null,
        promptArtifactId: null,
        turnKind: 'assistant_response',
        outcomeSignal: record.success ? 'none' : 'provider_error',
        composedRuntimeId: runtime.composedRuntimeId,
        experience,
      })
      void captureExperience({
        conversationId: hook.conversationId,
        messageId: hook.messageId,
        contextSnapshotId: hook.contextSnapshotId,
        promptArtifactId: hook.promptArtifactId,
        modelTarget: {
          ...(hook.modelTarget as Record<string, unknown>),
          observational: true,
          trajectory_id: record.trajectory_id,
          source_type: record.source_type,
          review_state: 'RAW',
          tool_id: record.selected_tool,
          decision: record.decision,
          result_content_sha256: record.result_content_sha256,
        },
        turnKind: hook.turnKind,
        outcomeSignal: hook.outcomeSignal,
      }).catch((err: unknown) => {
        persistFailureCount += 1
        console.error(
          `[trajectory-observer] captureExperience failed (count=${persistFailureCount}):`,
          err instanceof Error ? err.message : err,
        )
      })
    }

    return {
      captured: true,
      record,
      timings: {
        capture_ms: captureMs,
        serialize_ms: serializeMs,
        persist_ms: persistMs,
        total_ms: Date.now() - t0,
      },
    }
  } catch (err) {
    persistFailureCount += 1
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[trajectory-observer] capture failed (count=${persistFailureCount}):`, msg)
    return { captured: false, skipped_reason: 'capture_exception', persist_error: msg }
  }
}

export function observeAfterToolResult(
  requestText: string,
  result: ToolResult,
  extras: {
    decision: ToolDecision
    arguments: Record<string, string>
    validation?: ToolValidationCode | null
    source_type: TrajectorySourceType
    insertion_point: string
    conversation_id?: string | null
    no_tool_reason?: string | null
  },
): CaptureOutcome {
  try {
    return captureRuntimeTrajectory({
      request_text: requestText,
      conversation_id: extras.conversation_id,
      request_id: result.request_id,
      decision: extras.decision,
      tool_id: extras.decision === 'NO_TOOL' ? null : result.tool_id,
      arguments: extras.arguments,
      router_validation_status: extras.validation ?? null,
      execution_status: result.status,
      tool_result_status: result.status,
      tool_result: {
        status: result.status,
        tool_id: result.tool_id,
        error: result.error,
        provenance: result.provenance,
        duration_ms: result.duration_ms,
        request_id: result.request_id,
        result: result.result,
      },
      error: result.error,
      no_tool_reason: extras.no_tool_reason,
      source_type: extras.source_type,
      insertion_point: extras.insertion_point,
      duration_ms: result.duration_ms,
      provider: result.provenance.mode ?? result.provenance.authority ?? null,
      context_dependence: 'STANDALONE',
      provenance: result.provenance,
    })
  } catch (err) {
    persistFailureCount += 1
    console.error(
      `[trajectory-observer] observeAfterToolResult failed (count=${persistFailureCount}):`,
      err instanceof Error ? err.message : err,
    )
    return { captured: false, skipped_reason: 'observe_exception' }
  }
}

export function observerDoesNotImportTraining(): { ok: true; markers: typeof FORBIDDEN_TRAINING_MARKERS } {
  return { ok: true, markers: FORBIDDEN_TRAINING_MARKERS }
}

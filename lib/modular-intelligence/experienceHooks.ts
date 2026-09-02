import type { CaptureExperienceInput } from '@/lib/agi-experience/types'
import type { ExperienceCaptureHook, ToolExperienceFields, ToolResult } from './types'
import { observeToolExperience, type ObservationalTrajectory } from './trajectoryObserver'

/**
 * Design-level hook into existing AGIExperienceRecord / FailureRecord capture.
 * Does not create a parallel ledger. Extra tool fields ride on model_target until
 * a dedicated column exists — captureExperience already stores model_target JSON.
 */
export function toExperienceCapture(input: {
  conversationId: string | null
  messageId: string | null
  contextSnapshotId: string | null
  promptArtifactId: string | null
  turnKind: CaptureExperienceInput['turnKind']
  outcomeSignal: CaptureExperienceInput['outcomeSignal']
  experience: ToolExperienceFields
  composedRuntimeId: string
}): ExperienceCaptureHook {
  return {
    conversationId: input.conversationId,
    messageId: input.messageId,
    contextSnapshotId: input.contextSnapshotId,
    promptArtifactId: input.promptArtifactId,
    turnKind: input.turnKind,
    outcomeSignal: input.outcomeSignal,
    modelTarget: {
      providerFamily: 'wrim0',
      tier: 'ACTIVE_MODEL',
      composedRuntimeId: input.composedRuntimeId,
      toolExperience: input.experience,
      capabilityFamily: input.experience.capability_family,
    },
    toolExperience: input.experience,
  }
}

/**
 * Local observational candidate. Does not call captureExperience / Supabase by itself.
 * Persistence is opted into by runtimeTrajectoryCapture (development gate).
 */
export function toObservationalCandidate(
  experience: ToolExperienceFields,
  composedRuntimeId?: string,
): ObservationalTrajectory {
  return observeToolExperience(experience, { composedRuntimeId })
}

export function toolResultToExperience(
  result: ToolResult,
  decision: ToolExperienceFields['decision'],
  rawRequest: string,
  args?: Record<string, string>,
): ToolExperienceFields {
  return {
    request: rawRequest,
    decision,
    selected_tool: decision === 'NO_TOOL' ? null : result.tool_id,
    arguments: args ?? {},
    tool_result: result.result,
    success: result.status === 'ok' || result.status === 'dry_run' || result.status === 'mock',
    correction: null,
    provenance: result.provenance,
    capability_family: 'tool_use',
  }
}

import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { CaptureExperienceInput, RecordFailureInput } from './types'

/**
 * Reference-only writes — no chain-of-thought, no content duplication, only ids/refs. Every
 * caller treats failures here as non-fatal: experience capture must never break the primary
 * Commander-facing chat response. See app/api/chat/route.ts, which calls this fire-and-forget
 * after the real response has already been sent.
 */
export async function captureExperience(input: CaptureExperienceInput): Promise<string | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  try {
    const { data, error } = await sup.client
      .from('war_room_agi_experience_records')
      .insert({
        conversation_id: input.conversationId,
        message_id: input.messageId,
        context_snapshot_id: input.contextSnapshotId,
        prompt_artifact_id: input.promptArtifactId,
        model_target: input.modelTarget,
        turn_kind: input.turnKind,
        outcome_signal: input.outcomeSignal,
      })
      .select('id')
      .single()
    if (error || !data) return null
    return data.id as string
  } catch (err) {
    console.error('[agi-experience] captureExperience failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function recordFailure(input: RecordFailureInput): Promise<void> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return
  try {
    await sup.client.from('war_room_failure_records').insert({
      conversation_id: input.conversationId,
      experience_record_id: input.experienceRecordId,
      failure_kind: input.failureKind,
      detail: input.detail ?? null,
      provider_family: input.providerFamily ?? null,
    })
  } catch (err) {
    console.error('[agi-experience] recordFailure failed:', err instanceof Error ? err.message : err)
  }
}

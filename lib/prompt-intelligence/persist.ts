import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { PromptArtifact, PromptIntent, PromptOutcome } from './types'

export type NewPromptArtifactInput = {
  conversationId: string | null
  projectId: string | null
  contextSnapshotId: string | null
  intent: PromptIntent
  targetAgentId: string
  promptText: string
}

export async function persistPromptArtifact(input: NewPromptArtifactInput): Promise<PromptArtifact | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client
    .from('war_room_prompt_artifacts')
    .insert({
      conversation_id: input.conversationId,
      project_id: input.projectId,
      context_snapshot_id: input.contextSnapshotId,
      intent: input.intent,
      target_agent_id: input.targetAgentId,
      prompt_text: input.promptText,
      status: 'delivered',
    })
    .select('id,conversation_id,project_id,context_snapshot_id,intent,target_agent_id,prompt_text,status,created_at')
    .single()
  if (error || !data) return null
  return data as PromptArtifact
}

export async function recordPromptOutcome(
  promptArtifactId: string,
  outcome: PromptOutcome['outcome'],
  commanderNote?: string,
): Promise<PromptOutcome | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client
    .from('war_room_prompt_outcomes')
    .insert({
      prompt_artifact_id: promptArtifactId,
      outcome,
      commander_note: commanderNote ?? null,
    })
    .select('id,prompt_artifact_id,outcome,commander_note,recorded_at')
    .single()
  if (error || !data) return null
  return data as PromptOutcome
}

/** PromptArtifacts with status='delivered' and no row in war_room_prompt_outcomes yet — used by
 * lib/next-action/resolve.ts's "follow_up_prompt_outcome" fallback. */
export async function getPendingPromptArtifacts(conversationId: string, limit = 5) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []
  const { data: artifacts } = await sup.client
    .from('war_room_prompt_artifacts')
    .select('id,intent,target_agent_id,created_at')
    .eq('conversation_id', conversationId)
    .eq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!artifacts?.length) return []

  const ids = artifacts.map(a => a.id as string)
  const { data: outcomes } = await sup.client
    .from('war_room_prompt_outcomes')
    .select('prompt_artifact_id')
    .in('prompt_artifact_id', ids)
  const hasOutcome = new Set((outcomes ?? []).map(o => o.prompt_artifact_id as string))

  return artifacts.filter(a => !hasOutcome.has(a.id as string))
}

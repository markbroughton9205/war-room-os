/**
 * Checkpoint / Resume engine.
 * Does not execute tools. Does not grant authority. Does not copy chain-of-thought.
 */
import { createEngineReceipt } from '../receipts'
import type { EngineReceipt } from '../types'
import type { LongHorizonMission, MissionCheckpoint } from '../long-horizon/types'
import { MISSION_CHECKPOINT_SCHEMA, TERMINAL_MISSION_STATES } from '../long-horizon/types'
import { hashCheckpoint, loadCheckpoint, loadLatestCheckpoint, saveCheckpoint, saveMission, verifyCheckpointIntegrity } from '../long-horizon/store'
import { advanceMission, isTerminal } from '../long-horizon/engine'

function ckId(missionId: string): string {
  return `ck-${missionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function checkpointReasonAllowed(reason: string): boolean {
  return /wave|authority|approval|decline|shutdown|replan|ebc|external wait|pause|budget|completion|cancel/i.test(reason)
}

export async function createCheckpoint(mission: LongHorizonMission, reason: string): Promise<{ checkpoint: MissionCheckpoint; mission: LongHorizonMission; receipt: EngineReceipt }> {
  const started = Date.now()
  const checkpoint_id = ckId(mission.mission_id)
  const parent = mission.checkpoint_refs.at(-1) ?? null
  const eligible = !isTerminal(mission.mission_state) || mission.mission_state === 'WAITING_AUTHORITY' || mission.mission_state === 'PAUSED'
  const draft: Omit<MissionCheckpoint, 'integrity_hash'> = {
    schema: MISSION_CHECKPOINT_SCHEMA,
    checkpoint_id,
    mission_id: mission.mission_id,
    parent_checkpoint_id: parent,
    created_at: new Date().toISOString(),
    reason,
    schema_version: MISSION_CHECKPOINT_SCHEMA,
    mission: { ...mission, hidden_cot: false },
    resume_cursor: mission.resume_cursor,
    runtime_identity: mission.last_known_runtime,
    resume_eligible: eligible || mission.mission_state === 'WAITING_AUTHORITY' || mission.mission_state === 'PAUSED',
    hidden_cot: false,
  }
  const checkpoint: MissionCheckpoint = { ...draft, integrity_hash: hashCheckpoint(draft) }
  await saveCheckpoint(checkpoint)
  const next: LongHorizonMission = {
    ...mission,
    checkpoint_refs: [...mission.checkpoint_refs, checkpoint_id],
    updated_at: checkpoint.created_at,
  }
  await saveMission(next)
  return {
    checkpoint,
    mission: next,
    receipt: createEngineReceipt({
      engine: 'mission-checkpoint',
      mission_id: mission.mission_id,
      started_at: started,
      decision_count: 1,
      decision: reason,
      input_refs: [mission.mission_id, parent ?? 'root'],
      output_refs: [checkpoint_id],
    }),
  }
}

export function validateCheckpointForResume(input: {
  checkpoint: MissionCheckpoint
  expected_mission_id: string
}): { ok: boolean; reason: string } {
  if (input.checkpoint.mission_id !== input.expected_mission_id) return { ok: false, reason: 'wrong mission checkpoint' }
  const integrity = verifyCheckpointIntegrity(input.checkpoint)
  if (!integrity.ok) return integrity
  if (isTerminal(input.checkpoint.mission.mission_state) && input.checkpoint.mission.mission_state !== 'WAITING_AUTHORITY') {
    return { ok: false, reason: 'checkpoint after mission completion' }
  }
  if (!input.checkpoint.resume_eligible && (TERMINAL_MISSION_STATES as readonly string[]).includes(input.checkpoint.mission.mission_state)) {
    return { ok: false, reason: 'resume ineligible' }
  }
  return { ok: true, reason: 'eligible' }
}

export async function resumeMission(input: {
  mission_id: string
  checkpoint_id?: string
  runtime?: string | null
}): Promise<{ ok: boolean; reason: string; mission: LongHorizonMission | null; skip_task_ids: string[]; completed_dispatch_ids: string[]; receipt: EngineReceipt }> {
  const started = Date.now()
  const checkpoint = input.checkpoint_id
    ? await loadCheckpoint(input.mission_id, input.checkpoint_id)
    : await loadLatestCheckpoint(input.mission_id)
  const fail = (reason: string) => ({
    ok: false,
    reason,
    mission: null as LongHorizonMission | null,
    skip_task_ids: [] as string[],
    completed_dispatch_ids: [] as string[],
    receipt: createEngineReceipt({
      engine: 'mission-checkpoint',
      mission_id: input.mission_id,
      started_at: started,
      decision_count: 1,
      decision: 'RESUME_REJECTED',
      failure_state: reason.includes('corrupt') ? 'input_invalid' : 'authority_blocked',
    }),
  })
  if (!checkpoint) return fail('checkpoint missing or corrupted')
  const valid = validateCheckpointForResume({ checkpoint, expected_mission_id: input.mission_id })
  if (!valid.ok) return fail(valid.reason)
  let mission = checkpoint.mission
  if (mission.mission_state === 'WAITING_AUTHORITY' && mission.authority_state === 'WAITING_AUTHORITY') {
    mission = { ...mission, last_known_runtime: input.runtime ?? mission.last_known_runtime, updated_at: new Date().toISOString() }
    await saveMission(mission)
    return {
      ok: true,
      reason: 'WAITING_AUTHORITY preserved',
      mission,
      skip_task_ids: mission.completed_task_ids,
      completed_dispatch_ids: mission.completed_dispatch_ids,
      receipt: createEngineReceipt({ engine: 'mission-checkpoint', mission_id: mission.mission_id, started_at: started, decision_count: 1, decision: 'RESUME_WAITING_AUTHORITY' }),
    }
  }
  mission = await advanceMission(mission, 'RESUMING', {
    resumed_at: new Date().toISOString(),
    last_known_runtime: input.runtime ?? mission.last_known_runtime,
    runtime_generation: input.runtime ?? mission.runtime_generation,
  })
  return {
    ok: true,
    reason: 'resumed remaining work',
    mission,
    skip_task_ids: mission.completed_task_ids,
    completed_dispatch_ids: mission.completed_dispatch_ids,
    receipt: createEngineReceipt({ engine: 'mission-checkpoint', mission_id: mission.mission_id, started_at: started, decision_count: 1, decision: 'RESUMED' }),
  }
}

export async function rejectCorruptCheckpoint(raw: MissionCheckpoint): Promise<{ ok: false; reason: string }> {
  const check = verifyCheckpointIntegrity(raw)
  return { ok: false, reason: check.ok ? 'unexpected' : check.reason }
}

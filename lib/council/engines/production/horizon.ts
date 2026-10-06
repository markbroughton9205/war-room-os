/**
 * ENGINE-04 production coordinator.
 * Wraps Engine-03; never a second executor.
 */
import {
  advanceMission,
  applyAuthorityDecision,
  cancelMission,
  completeMission,
  isTerminal,
  loadOrCreateLongHorizonMission,
  parseEngine04Command,
  pauseMission,
  queueAuthorityWait,
  recordCompletedWork,
  resolveMissionForCommand,
  commanderMissionStatus,
} from '../long-horizon/engine'
import { createCheckpoint, resumeMission } from '../checkpoint/engine'
import { fingerprintAction } from '../checkpoint/fingerprint'
import { retrieveMemories } from '../memory-retrieval/engine'
import { refreshSignal } from '../temporal-world/engine'
import type { LongHorizonMission, MemoryRetrievalResult, TemporalFactRecord } from '../long-horizon/types'
import type { LiveExecutionResult } from '../live-execution/types'
import { findLatestActiveByConversation, saveMission } from '../long-horizon/store'

export async function bindEngine04ToLive(input: {
  mission_id: string
  objective: string
  commanderMessage: string
  conversation_id?: string | null
  session_id?: string | null
  mission_type?: string
  live?: LiveExecutionResult | null
  ebc_evidence_ids?: string[]
  questions?: { question_id: string; text: string; answer_state: string }[]
  hypotheses?: { id: string; statement: string; status: string }[]
  temporal_facts?: TemporalFactRecord[]
  runtime?: string | null
  plan_snapshot?: unknown
  mode?: 'command' | 'commit'
}): Promise<{
  mission: LongHorizonMission
  memories: MemoryRetrievalResult
  skip_task_ids: string[]
  completed_dispatch_ids: string[]
  refresh: ReturnType<typeof refreshSignal>
  commander_status: string
  approval_fingerprint?: string
  execute_live: boolean
  current_verified_memory: boolean
}> {
  const command = input.mode === 'commit' ? null : parseEngine04Command(input.commanderMessage)
  let mission: LongHorizonMission | null = null
  if (input.mission_id) mission = await resolveMissionForCommand({ mission_id: input.mission_id })
  if (!mission && (command === 'pause' || command === 'resume' || command === 'cancel' || command === 'approve' || command === 'decline')) {
    mission = await resolveMissionForCommand({ conversation_id: input.conversation_id, session_id: input.session_id })
  }
  if (!mission && input.conversation_id) {
    const active = await findLatestActiveByConversation(input.conversation_id, input.session_id ?? null)
    if (active && !isTerminal(active.mission_state)) mission = active
  }
  if (!mission) {
    mission = await loadOrCreateLongHorizonMission({
      mission_id: input.mission_id,
      objective: input.objective,
      conversation_id: input.conversation_id,
      session_id: input.session_id,
      mission_type: input.mission_type,
      runtime: input.runtime,
    })
  }

  if (input.plan_snapshot && !mission.plan_snapshot) {
    mission = { ...mission, plan_snapshot: input.plan_snapshot, plan_ref: mission.plan_ref ?? 'atlas-plan' }
    await saveMission(mission)
  }

  let skip_task_ids = [...mission.completed_task_ids]
  let completed_dispatch_ids = [...mission.completed_dispatch_ids]

  if (command === 'resume') {
    const resumed = await resumeMission({ mission_id: mission.mission_id, runtime: input.runtime })
    if (resumed.ok && resumed.mission) {
      mission = resumed.mission
      skip_task_ids = resumed.skip_task_ids
      completed_dispatch_ids = resumed.completed_dispatch_ids
    }
  } else if (command === 'pause') {
    mission = await pauseMission(mission)
    const ck = await createCheckpoint(mission, 'manual Commander pause')
    mission = ck.mission
  } else if (command === 'cancel') {
    mission = await cancelMission(mission)
    const ck = await createCheckpoint(mission, 'cancel')
    mission = ck.mission
  } else if (command === 'approve' || command === 'decline') {
    const pending = mission.pending_approval_refs.find(row => row.state === 'PENDING')
    if (pending) {
      mission = applyAuthorityDecision(mission, command, pending.action_fingerprint)
      await saveMission(mission)
      const ck = await createCheckpoint(mission, command === 'approve' ? 'after Commander approval' : 'after Commander decline')
      mission = ck.mission
    }
  }

  const waitingWithoutApprove = mission.mission_state === 'WAITING_AUTHORITY' && command !== 'approve' && command !== 'resume'
  const pausedWithoutResume = mission.mission_state === 'PAUSED' && command !== 'resume'
  const terminal = isTerminal(mission.mission_state) && command !== 'resume'
  const execute_live = input.mode === 'commit'
    ? false
    : !terminal && !pausedWithoutResume && !waitingWithoutApprove && command !== 'pause' && command !== 'cancel' && command !== 'decline'

  if (!execute_live && !input.live) {
    return {
      mission,
      memories: emptyMemories(mission.mission_id),
      skip_task_ids,
      completed_dispatch_ids,
      refresh: 'FRESH',
      commander_status: commanderMissionStatus(mission),
      execute_live: false,
      current_verified_memory: false,
      approval_fingerprint: mission.pending_approval_refs.find(row => row.state === 'PENDING')?.action_fingerprint,
    }
  }

  const memories = (await retrieveMemories({
    mission_id: mission.mission_id,
    objective: input.objective,
    ebc_evidence_ids: input.ebc_evidence_ids,
  })).result
  const current_verified_memory = memories.hits.some(hit =>
    hit.selected && hit.truth_state === 'VERIFIED' && hit.temporal_state === 'CURRENT' && hit.confidence_state === 'PROVEN',
  )

  if (input.live) {
    if (mission.mission_state === 'PAUSED' || mission.mission_state === 'CANCELLED') {
      mission = {
        ...mission,
        question_graph: input.questions ?? mission.question_graph,
        hypotheses: input.hypotheses ?? mission.hypotheses,
      }
      await saveMission(mission)
    } else {
    const succeeded = input.live.tasks.filter(row => row.state === 'SUCCEEDED').map(row => row.task_id)
    mission = recordCompletedWork(mission, {
      task_ids: succeeded,
      dispatch_ids: input.live.dispatches.filter(row => row.ok).map(row => row.receipt_id),
      wave_ids: input.live.waves.map(row => row.wave_id),
      evidence_ids: input.live.ebc_evidence_ids,
      budget: {
        tool_calls_used: mission.budget_state.tool_calls_used + input.live.dispatches.length,
        retry_count: mission.budget_state.retry_count + input.live.dispatches.filter(row => row.retry_number > 0).length,
        wall_ms_used: mission.budget_state.wall_ms_used + (input.live.governor.latency_ms ?? 0),
        local_model_calls: input.live.governor.local_model_calls,
        external_calls: input.live.governor.external_calls,
      },
    })
    mission = {
      ...mission,
      question_graph: input.questions ?? mission.question_graph,
      hypotheses: input.hypotheses ?? mission.hypotheses,
      ebc_ref: input.live.mission_id,
      memory_context_refs: memories.hits.filter(h => h.selected).map(h => h.memory_ref),
      current_task_ids: input.live.tasks.filter(row => row.state !== 'SUCCEEDED' && row.state !== 'CANCELLED' && row.state !== 'SKIPPED').map(row => row.task_id),
    }
    const waiting = input.live.tasks.find(row => row.state === 'WAITING_AUTHORITY')
    if (waiting) {
      mission = queueAuthorityWait(mission, { task_id: waiting.task_id, action: waiting.selected_tool || 'restricted action' })
      const ck = await createCheckpoint(mission, 'before WAITING_AUTHORITY')
      mission = ck.mission
    } else if (input.live.completion === 'COMPLETE') {
      mission = await completeMission(mission, 'COMPLETED', 'EBC/live completion satisfied')
      const ck = await createCheckpoint(mission, 'mission completion')
      mission = ck.mission
    } else {
      mission = await advanceMission(mission, 'RUNNING')
      const ck = await createCheckpoint(mission, 'end of execution wave')
      mission = ck.mission
    }
    }
  }

  const refresh = refreshSignal({ question: input.objective, facts: input.temporal_facts ?? [] })
  return {
    mission,
    memories,
    skip_task_ids,
    completed_dispatch_ids,
    refresh,
    commander_status: commanderMissionStatus(mission),
    approval_fingerprint: mission.pending_approval_refs.find(row => row.state === 'PENDING' || row.state === 'APPROVED')?.action_fingerprint,
    execute_live,
    current_verified_memory,
  }
}

function emptyMemories(mission_id: string): MemoryRetrievalResult {
  return {
    schema: 'memory-retrieval.v1',
    mission_id,
    hits: [],
    retrieved_count: 0,
    included_count: 0,
    excluded_count: 0,
    token_estimate: 0,
    trains_wrim: false,
  }
}

export { fingerprintAction }

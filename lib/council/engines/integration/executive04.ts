import { ENGINE_04_VERSION } from '../types'
import type { LongHorizonMission, MemoryRetrievalResult } from '../long-horizon/types'

export type CouncilEngine04Public = {
  schema: typeof ENGINE_04_VERSION
  ebc_canonical: true
  grants_authority: false
  mission_id?: string
  mission_state?: string
  phase?: string | null
  checkpoint?: string | null
  resume_cursor?: string | null
  completed_tasks?: number
  pending_tasks?: number
  authority_state?: string
  budget_remaining?: number
  memory_refs?: number
  refresh?: string
  resume_available?: boolean
  commander_status?: string
}

export function attachCouncilEngine04Public(input: {
  mission?: LongHorizonMission | null
  memories?: MemoryRetrievalResult | null
  refresh?: string
  commander_status?: string
}): CouncilEngine04Public {
  const mission = input.mission
  return {
    schema: ENGINE_04_VERSION,
    ebc_canonical: true,
    grants_authority: false,
    mission_id: mission?.mission_id,
    mission_state: mission?.mission_state,
    phase: mission?.current_phase_id,
    checkpoint: mission?.checkpoint_refs.at(-1) ?? null,
    resume_cursor: mission?.resume_cursor,
    completed_tasks: mission?.completed_task_ids.length ?? 0,
    pending_tasks: mission?.current_task_ids.length ?? 0,
    authority_state: mission?.authority_state,
    budget_remaining: mission ? Math.max(0, mission.budget_state.tool_calls_max - mission.budget_state.tool_calls_used) : undefined,
    memory_refs: input.memories?.included_count ?? mission?.memory_context_refs.length ?? 0,
    refresh: input.refresh,
    resume_available: mission ? !['COMPLETED', 'CANCELLED', 'FAILED'].includes(mission.mission_state) : false,
    commander_status: input.commander_status,
  }
}

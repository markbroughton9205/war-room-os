import { ENGINE_03_VERSION } from '../types'
import type { LiveExecutionResult } from '../live-execution/types'
import type { EngineReceipt } from '../types'

export type CouncilEngine03Public = {
  schema: typeof ENGINE_03_VERSION
  ebc_canonical: true
  grants_authority: false
  atlas_role: 'ATLAS'
  production_invoked?: boolean
  injection?: boolean
  proof_level?: LiveExecutionResult['proof_level']
  decision?: string
  dispatches?: number
  avoided_tool_calls?: number
  overlap_ms?: number
  parallelism?: 'PARALLEL' | 'SERIAL'
  completion?: LiveExecutionResult['completion']
  waves?: Array<{ wave_id: string; task_ids: string[]; overlap_ms: number; parallelism: string }>
  tasks?: Array<{ task_id: string; state: string; selected_tool: string | null }>
  authority_waits?: string[]
  cancelled?: string[]
  replans?: number
  context_tokens?: number
  phases?: string[]
  approval_request?: string | null
  receipts: EngineReceipt[]
}

export function attachCouncilEngine03Public(input: {
  live?: LiveExecutionResult | null
  production_invoked?: boolean
  injection?: boolean
  phases?: string[]
  approval_request?: string | null
}): CouncilEngine03Public {
  const live = input.live
  return {
    schema: ENGINE_03_VERSION,
    ebc_canonical: true,
    grants_authority: false,
    atlas_role: 'ATLAS',
    production_invoked: input.production_invoked ?? false,
    injection: input.injection ?? (Boolean(live) && input.production_invoked !== true),
    proof_level: live?.proof_level,
    decision: live?.tasks[0]?.decision ?? (
      live && live.dispatches.length === 0 && (live.avoided_tool_calls > 0 || live.completion === 'COMPLETE')
        ? 'NO_TOOL_REQUIRED'
        : undefined
    ),
    dispatches: live?.dispatches.length ?? 0,
    avoided_tool_calls: live?.avoided_tool_calls ?? 0,
    overlap_ms: live?.overlap_ms ?? 0,
    parallelism: live?.parallelism ?? 'SERIAL',
    completion: live?.completion,
    waves: live?.waves.map(wave => ({
      wave_id: wave.wave_id,
      task_ids: wave.task_ids,
      overlap_ms: wave.overlap_ms,
      parallelism: wave.parallelism,
    })),
    tasks: live?.tasks.map(row => ({
      task_id: row.task_id,
      state: row.state,
      selected_tool: row.selected_tool,
    })),
    authority_waits: live?.tasks.filter(row => row.state === 'WAITING_AUTHORITY').map(row => row.task_id),
    cancelled: live?.cancelled_tasks,
    replans: live?.replans,
    context_tokens: live?.dispatches.reduce((sum, row) => sum + row.context_tokens, 0),
    phases: input.phases,
    approval_request: input.approval_request ?? null,
    receipts: live?.receipts ?? [],
  }
}

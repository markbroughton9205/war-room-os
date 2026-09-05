import { captureRuntimeTrajectory } from './runtimeTrajectoryCapture'

export function observeWarRoomApiTool(input: {
  toolId: 'memory' | 'files' | 'web' | 'research'
  requestText: string
  arguments: Record<string, string>
  ok: boolean
  status: string
  error?: string | null
  resultMeta: Record<string, unknown>
  conversationId?: string | null
}): void {
  try {
    captureRuntimeTrajectory({
      request_text: input.requestText,
      conversation_id: input.conversationId ?? null,
      decision: 'TOOL',
      tool_id: input.toolId,
      arguments: input.arguments,
      router_validation_status: 'VALID',
      execution_status: input.ok ? 'ok' : 'error',
      tool_result_status: input.ok ? 'ok' : 'error',
      tool_result: input.resultMeta,
      error: input.error ?? null,
      source_type: 'REAL_RUNTIME',
      insertion_point: `app/api/tools-or-files:${input.toolId}`,
      provider: 'war_room_api',
      provenance: { endpoint_status: input.status, authority: 'war_room_tool_registry' },
    })
  } catch (err) {
    console.error(
      '[trajectory-observer] war-room API observe failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

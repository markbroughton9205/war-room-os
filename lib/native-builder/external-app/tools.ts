import { ExternalAppBroker } from './broker'
import { EXTERNAL_APP_TOOL_NAMES, isExternalAppToolName, type ExternalAppToolName } from './types'

export { EXTERNAL_APP_TOOL_NAMES, isExternalAppToolName }
export type { ExternalAppToolName }

export async function executeExternalAppTool(
  tool: ExternalAppToolName,
  input: Record<string, unknown>,
  ctx: { repairId: string; mission?: { missionId?: string; workspace?: string } | null },
): Promise<{ ok: boolean; tool: ExternalAppToolName; result?: unknown; error?: string }> {
  const outcome = await ExternalAppBroker.execute(tool, input, {
    repairId: ctx.repairId,
    missionId: ctx.mission?.missionId || ctx.repairId,
    taskId: ctx.repairId,
    projectId: ctx.mission?.workspace || 'war-room-os',
  })
  return {
    ok: outcome.ok,
    tool,
    result: {
      ...((outcome.result && typeof outcome.result === 'object') ? outcome.result as Record<string, unknown> : { value: outcome.result }),
      backend: outcome.backend,
      actionSuccess: outcome.actionSuccess,
      stateSuccess: outcome.stateSuccess,
      binding: outcome.binding,
      attention: outcome.attention,
    },
    error: outcome.error,
  }
}

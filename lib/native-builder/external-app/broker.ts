import { CURSOR_APP_ID, getRegisteredApp, listRegisteredApps, genericDesktopAuthorityGranted, isRegisteredAppId } from './registry'
import { CursorExternalAppAdapter, READ_ONLY_BRIDGE_PROMPT } from './cursorAdapter'
import { auditExternalAction } from './audit'
import { classifyExternalSafety, createAttentionEvent } from './attention'
import { invalidateAllBindings } from './targetBinding'
import { discoverCursorElectronDebug } from './cursorElectronDebug'
import { externalPython } from './backends'
import type { ExternalActionResult, ExternalAppToolName } from './types'

const sessions = new Map<string, CursorExternalAppAdapter>()

function adapterFor(missionId: string): CursorExternalAppAdapter {
  const existing = sessions.get(missionId)
  if (existing) return existing
  const created = new CursorExternalAppAdapter()
  sessions.set(missionId, created)
  return created
}

export const ExternalAppBroker = {
  listApps: listRegisteredApps,
  genericDesktopAuthorityGranted,
  isRegistered: isRegisteredAppId,

  recoverAfterRestart(): void {
    invalidateAllBindings()
    for (const adapter of sessions.values()) adapter.recover()
  },

  cancel(missionId: string): ExternalActionResult {
    const adapter = sessions.get(missionId)
    adapter?.cancel()
    return { ok: true, tool: 'external_app.cancel', actionSuccess: true, stateSuccess: true, result: { cancelled: true, killedCursor: false } }
  },

  async execute(
    tool: ExternalAppToolName,
    input: Record<string, unknown>,
    ctx: { repairId: string; missionId?: string; taskId?: string; projectId?: string },
  ): Promise<ExternalActionResult> {
    const appId = String(input.app || CURSOR_APP_ID)
    const missionId = ctx.missionId || ctx.repairId
    const taskId = ctx.taskId || ctx.repairId
    const projectId = ctx.projectId || 'war-room-os'
    if (genericDesktopAuthorityGranted()) {
      return { ok: false, tool, error: 'generic desktop authority is forbidden' }
    }
    if (!getRegisteredApp(appId)) {
      return { ok: false, tool, error: `application ${appId} is not registered` }
    }
    if (appId !== CURSOR_APP_ID) {
      return { ok: false, tool, error: 'only the cursor adapter is implemented in phase 1' }
    }
    const adapter = adapterFor(missionId)
    const text = String(input.text ?? input.prompt ?? '')
    const safety = classifyExternalSafety(tool, text)
    if (safety === 'BLOCKED') {
      const attention = createAttentionEvent({
        reason: 'blocked external action',
        missionId,
        taskId,
        application: appId,
        requestedAction: tool,
        currentState: 'blocked',
        whatFoundryNeeds: 'Do not proceed. Destructive or out-of-authority action.',
      })
      await auditExternalAction({
        application: appId,
        backend: 'broker',
        target: appId,
        action: tool,
        expectedState: 'blocked',
        observedState: 'blocked',
        mission: missionId,
        task: taskId,
        timestamp: new Date().toISOString(),
        result: 'BLOCKED',
      })
      return { ok: false, tool, error: 'BLOCKED', attention }
    }
    if (safety === 'COMMANDER_APPROVAL_REQUIRED') {
      const attention = createAttentionEvent({
        reason: 'Commander approval required for this external action',
        missionId,
        taskId,
        application: appId,
        requestedAction: tool,
        currentState: 'awaiting-approval',
        whatFoundryNeeds: 'Approve or deny. Foundry will not guess.',
      })
      await auditExternalAction({
        application: appId,
        backend: 'broker',
        target: appId,
        action: tool,
        expectedState: 'approved',
        observedState: 'attention',
        mission: missionId,
        task: taskId,
        timestamp: new Date().toISOString(),
        result: 'ATTENTION_REQUIRED',
      })
      return { ok: false, tool, error: 'COMMANDER_APPROVAL_REQUIRED', attention }
    }

    adapter.bindMission({
      missionId,
      taskId,
      projectId,
      cursorWorkspaceIdentity: typeof input.workspace === 'string' ? input.workspace : null,
      prompt: text || READ_ONLY_BRIDGE_PROMPT,
    })

    let outcome: ExternalActionResult
    switch (tool) {
      case 'external_app.discover':
        outcome = await adapter.discoverWindow()
        break
      case 'external_app.focus':
        outcome = await adapter.focus()
        break
      case 'external_app.observe':
        outcome = await adapter.observeAndBindComposer()
        break
      case 'external_app.insert_text':
        outcome = await adapter.insertText(text)
        break
      case 'external_app.cancel':
        outcome = this.cancel(missionId)
        break
      case 'external_app.status': {
        const debug = await discoverCursorElectronDebug()
        const portal = await externalPython('portal_status')
        outcome = {
          ok: true,
          tool,
          result: {
            registered: getRegisteredApp(appId),
            window: adapter.window,
            composerBound: Boolean(adapter.composerBinding),
            cancelled: adapter.cancelled,
            electronDebug: debug,
            portal,
            genericDesktopAuthority: false,
          },
        }
        break
      }
      case 'cursor.submit_prompt':
        outcome = await adapter.submit()
        break
      case 'cursor.observe_generation':
        outcome = await adapter.observeGeneration(Number(input.timeoutMs) || 90_000)
        break
      case 'cursor.read_response':
        outcome = await adapter.readResponse()
        break
      default:
        outcome = { ok: false, tool, error: `unhandled ${tool}` }
    }

    await auditExternalAction({
      application: appId,
      backend: String(outcome.backend || 'broker'),
      target: adapter.composerBinding?.semanticTarget || 'window',
      action: tool,
      expectedState: 'ACTION_SUCCESS+STATE_SUCCESS',
      observedState: outcome.stateSuccess ? 'STATE_SUCCESS' : outcome.actionSuccess ? 'ACTION_ONLY' : 'FAIL',
      mission: missionId,
      task: taskId,
      timestamp: new Date().toISOString(),
      result: outcome.ok ? (outcome.stateSuccess ? 'STATE_SUCCESS' : 'ACTION_SUCCESS') : (outcome.attention ? 'ATTENTION_REQUIRED' : 'FAIL'),
    })
    return outcome
  },
}

export type { ExternalActionResult }

import 'server-only'
import { cancelMission, engineeringRepo, getMission, serviceDeps, startFromApi } from '@/lib/agents/ops/engineering/missions/service'
import { autonomyController } from '@/lib/agents/ops/engineering/autonomy/service'
import type { FoundryCommandView, FoundryMissionView, FoundryPort } from './foundryPort'

/** Council's connection to Foundry: Foundry's own mission service, called with the Commander actor. No second execution system. */
export function createRealFoundryPort(): FoundryPort {
  const deps = serviceDeps()
  const missionView = (id: string): FoundryMissionView | null => {
    const v = getMission(deps, id)
    if (!v) return null
    return {
      id: v.id, state: v.state, stateReason: v.stateReason, stateAt: v.stateAt,
      progress: v.progress ? { stepsDone: v.progress.stepsDone, stepsTotal: v.progress.stepsTotal, modelCalls: v.progress.modelCalls, filesChanged: v.progress.filesChanged, lastEvent: v.progress.lastEvent } : null,
      result: v.result ? { status: v.result.status, reason: v.result.reason, completionClass: v.result.completionClass, verifierExit: v.result.verifierExit } : null,
      receipt: v.receipt ? { receiptSha256: v.receipt.receiptSha256, verifier: v.receipt.verifier, integration: v.receipt.integration, filesCreated: v.receipt.filesCreated.map(f => ({ path: f.path })), filesModified: v.receipt.filesModified.map(f => ({ path: f.path })), testsAdded: v.receipt.testsAdded } : null,
      receiptCheck: v.receiptCheck,
    }
  }
  return {
    async submitCommand(text, origin, actor) {
      return autonomyController().submit(text, { kind: 'council', conversationId: origin.conversationId, ownerId: origin.ownerId }, actor)
    },
    getCommand(commandId): FoundryCommandView | null {
      const c = autonomyController().getCommand(commandId)
      if (!c) return null
      const step = c.steps[c.currentStep]
      const mid = step?.missions.at(-1)?.id ?? c.steps.flatMap(s => s.missions).at(-1)?.id ?? null
      return { id: c.id, state: c.state, stateReason: c.stateReason, stateAt: c.stateAt, title: c.interpretation.title, missionId: mid, stepIndex: c.currentStep, stepCount: c.steps.length, ladder: c.ladder, installPath: c.evidence.install?.path ?? null, mission: mid ? missionView(mid) : null }
    },
    async cancelCommand(commandId, actor, reason) { await autonomyController().cancel(commandId, actor, reason) },
    availability() {
      const repo = engineeringRepo(deps.log)
      return repo ? { ok: true } : { ok: false, reason: 'no engineering repository is configured on this machine (WAR_ROOM_ENGINEERING_REPO or engineering-config.json)' }
    },
    async start(body, actor) {
      const rec = await startFromApi(deps, body as unknown as Record<string, unknown>, actor)
      return { missionId: rec.id, state: rec.state }
    },
    get(missionId): FoundryMissionView | null {
      const v = getMission(deps, missionId)
      if (!v) return null
      return {
        id: v.id,
        state: v.state,
        stateReason: v.stateReason,
        stateAt: v.stateAt,
        progress: v.progress
          ? { stepsDone: v.progress.stepsDone, stepsTotal: v.progress.stepsTotal, modelCalls: v.progress.modelCalls, filesChanged: v.progress.filesChanged, lastEvent: v.progress.lastEvent }
          : null,
        result: v.result ? { status: v.result.status, reason: v.result.reason, completionClass: v.result.completionClass, verifierExit: v.result.verifierExit } : null,
        receipt: v.receipt
          ? {
              receiptSha256: v.receipt.receiptSha256,
              verifier: v.receipt.verifier,
              integration: v.receipt.integration,
              filesCreated: v.receipt.filesCreated.map(f => ({ path: f.path })),
              filesModified: v.receipt.filesModified.map(f => ({ path: f.path })),
              testsAdded: v.receipt.testsAdded,
            }
          : null,
        receiptCheck: v.receiptCheck,
      }
    },
    cancel(missionId, actor, reason) {
      cancelMission(deps, missionId, actor as never, reason)
    },
  }
}

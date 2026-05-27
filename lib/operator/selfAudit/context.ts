import type { GapFinderContext } from '../gapFinder'
import type { SelfAuditContext } from './types'

export function gapFinderToSelfAuditContext(ctx: GapFinderContext): SelfAuditContext {
  return {
    visibleMessages: ctx.visibleMessages,
    hiddenMessageCount: ctx.hiddenMessageCount,
    collapsedNoiseCount: ctx.collapsedNoiseCount,
    councilPaused: ctx.councilPaused,
    councilFlowMode: ctx.councilFlowMode,
    showOldDiagnostics: ctx.showOldDiagnostics,
    canonicalStatus: ctx.canonicalStatus,
    canonicalStatusUnavailable: ctx.canonicalStatusUnavailable,
    viewportNarrow: ctx.viewportNarrow,
    viewportWidthPx: ctx.viewportWidthPx,
    activeDockPanelId: ctx.activeDockPanelId,
    gapVerification: ctx.gapVerification,
    evolutionReadinessScore: ctx.evolutionReadinessScore,
    internetUsable: ctx.internetUsable,
    chatHealthLabel: ctx.chatHealthLabel,
    persistenceHealthLabel: ctx.persistenceHealthLabel,
    providerConnection: ctx.providerConnection,
    silentUi: ctx.silentUi,
    operatorLabels: ctx.operatorLabels,
    revenue: ctx.revenue,
    memory: ctx.memory,
    orchestration: ctx.orchestration,
    commanderDismissedIds: ctx.commanderDismissedIds,
  }
}

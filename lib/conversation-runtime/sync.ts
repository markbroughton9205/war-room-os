import type { CouncilPersistedV1 } from '@/components/council/councilSessionTypes'
import type { CouncilOutputMode } from '@/lib/council/compression'
import { applyRollingContextCompression } from '@/lib/context-compression/rolling'
import type { CouncilConversationRuntime } from '@/lib/conversation-runtime/types'
import {
  createConversationRuntime,
  syncRuntimeFromCouncilStore,
} from '@/lib/conversation-runtime/sessionStore'
import { mergeProviderStatesFromMessages } from '@/lib/provider-state/store'

export function rebuildConversationRuntime(
  council: CouncilPersistedV1,
  threadId: string | null,
  existing: CouncilConversationRuntime | null,
  outputMode: CouncilOutputMode = 'standard',
  stabilityMode?: boolean,
): CouncilConversationRuntime {
  const base = existing?.sessionId === council.sessionId
    ? existing
    : createConversationRuntime(council.sessionId, threadId)

  const compressionMessages = council.messages.map(m => ({
    id: m.id,
    familyName: m.familyName,
    content: m.content,
    provider: m.provider,
    messageType: m.messageType,
    repairPacket: m.repairPacket,
  }))

  const rolling = applyRollingContextCompression(compressionMessages, outputMode, { stabilityMode })
  const providerStates = mergeProviderStatesFromMessages(base.providerStates, council.messages)

  const contradictionMap: Record<string, string[]> = {}
  for (const [family, state] of Object.entries(providerStates)) {
    if (state?.contradictions.length) contradictionMap[family] = state.contradictions
  }

  const investigations = [
    ...new Set(
      Object.values(providerStates).flatMap(s => s?.pendingInvestigations ?? []),
    ),
  ].slice(0, 12)

  let synced = syncRuntimeFromCouncilStore(
    {
      ...base,
      threadId: threadId ?? base.threadId,
      providerStates,
      rollingSummary: rolling.applied ? rolling.summaryBlock : base.rollingSummary,
      compressedSnapshot: rolling.compressed,
      unresolvedInvestigations: investigations,
      contradictionMap,
      latestSynthesis: rolling.compressed.decisionSummary[0] ?? base.latestSynthesis,
    },
    council,
  )

  if (rolling.applied) {
    synced = {
      ...synced,
      councilMomentum:
        rolling.compressed.risk.level === 'high'
          ? 'rising'
          : rolling.compressed.disagreements.length > 2
            ? 'decaying'
            : 'stable',
    }
  }

  return synced
}

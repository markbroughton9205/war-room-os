import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { publishCognitiveBusEvent } from '@/lib/cognitive-bus/bus'
import type { StructuredProviderPacket } from '@/lib/cognitive-bus/types'
import { buildPeerContextBlock, priorProviderPacketsInThread } from '@/lib/council-routing/threadContext'
import { logCognitiveBusAudit } from '@/lib/orchestration/cognitiveAudit'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type RoutedProviderMessage = {
  fromFamily: CouncilOrchestrationFamily
  toFamily: CouncilOrchestrationFamily
  threadId: string
  routingReason: string
  peerContextBlock: string
  priorPackets: StructuredProviderPacket[]
}

export function routeProviderMessage(input: {
  threadId: string
  fromFamily: CouncilOrchestrationFamily
  toFamily: CouncilOrchestrationFamily
  reason: string
  correlationId?: string
}): RoutedProviderMessage {
  const peerContextBlock = buildPeerContextBlock(input.threadId, input.toFamily)
  publishCognitiveBusEvent({
    threadId: input.threadId,
    type: 'routing',
    correlationId: input.correlationId,
    payload: {
      from: input.fromFamily,
      to: input.toFamily,
      reason: input.reason,
      hasPeerContext: Boolean(peerContextBlock.trim()),
    },
  })
  return {
    fromFamily: input.fromFamily,
    toFamily: input.toFamily,
    threadId: input.threadId,
    routingReason: input.reason,
    peerContextBlock,
    priorPackets: priorProviderPacketsInThread(input.threadId, input.toFamily),
  }
}

export async function auditProviderRouting(
  client: WarRoomSupabase | null,
  row: { threadId: string; from: string; to: string; reason: string },
): Promise<void> {
  await logCognitiveBusAudit(client, {
    action: 'provider_routing',
    threadId: row.threadId,
    detail: { from: row.from, to: row.to, reason: row.reason.slice(0, 200) },
  })
}

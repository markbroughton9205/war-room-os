import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { buildProviderMemoryInjection, type ProviderMemoryInjection } from '@/lib/provider-memory/inject'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type CouncilMemoryBridgeResult = ProviderMemoryInjection & {
  approvedOnly: true
  injectionAllowed: boolean
}

/**
 * Approved memory only — bridges Phase provider-memory into conversational runtime prompts.
 * Never injects unapproved or session-only learning.
 */
export async function buildCouncilMemoryBridge(
  client: WarRoomSupabase | null,
  family: CouncilOrchestrationFamily,
  limit = 12,
): Promise<CouncilMemoryBridgeResult> {
  const injection = await buildProviderMemoryInjection(client, family, limit)
  const injectionAllowed = Boolean(injection.block.trim()) && injection.snippetCount > 0
  return {
    ...injection,
    approvedOnly: true,
    injectionAllowed,
  }
}

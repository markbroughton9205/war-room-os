import 'server-only'
/**
 * Owner-scoped persistence of Stage 1 turn records inside the local conversation metadata.
 * Uses the existing local-ownership store: no new database, no cross-owner reads.
 */
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { buildTurnRecord, readStage1Metadata, STAGE1_METADATA_KEY, upsertTurn, type Stage1TurnRecord } from './record'

export type PersistResult = { persisted: boolean; reason?: string }

export async function persistStage1Turn(req: Request, conversationId: string | null | undefined, rec: Stage1TurnRecord): Promise<PersistResult> {
  if (!conversationId) return { persisted: false, reason: 'no conversation id on request' }
  try {
    const { localCommanderOwnerId } = await import('@/lib/war-room/localConversationGateway')
    const ownerId = await localCommanderOwnerId(req)
    if (!ownerId) return { persisted: false, reason: 'not an authenticated local Commander request' }
    const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const conv = store.getCouncilConversation(ownerId, conversationId)
    if (!conv) return { persisted: false, reason: 'conversation not found for this owner' }
    const next = upsertTurn(readStage1Metadata(conv.metadata), rec)
    store.patchCouncilConversation(ownerId, conversationId, { metadata: { ...conv.metadata, [STAGE1_METADATA_KEY]: next } })
    return { persisted: true }
  } catch (err) {
    return { persisted: false, reason: err instanceof Error ? err.message : 'persist failed' }
  }
}

/** Owner-scoped read of the persisted turn records (empty when unauthenticated or not found). */
export async function readStage1Turns(req: Request, conversationId: string | null | undefined): Promise<Stage1TurnRecord[]> {
  if (!conversationId) return []
  try {
    const { localCommanderOwnerId } = await import('@/lib/war-room/localConversationGateway')
    const ownerId = await localCommanderOwnerId(req)
    if (!ownerId) return []
    const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const conv = store.getCouncilConversation(ownerId, conversationId)
    return conv ? readStage1Metadata(conv.metadata)?.turns ?? [] : []
  } catch {
    return []
  }
}

export { buildTurnRecord }

/**
 * Durable assistant message for a turn the SERVER answered (Stage 1 deterministic reply, or a single attributed member turn the
 * client does not write). Without this the reply is visible live and gone after a restart. Idempotent: an identical assistant
 * message already stored for this conversation in the last two minutes is not written again.
 */
export async function persistStage1Assistant(req: Request, conversationId: string | null | undefined, input: {
  content: string
  family: string
  metadata: Record<string, unknown>
}): Promise<PersistResult> {
  if (!conversationId) return { persisted: false, reason: 'no conversation id on request' }
  const content = input.content.trim()
  if (!content) return { persisted: false, reason: 'empty content' }
  try {
    const { localCommanderOwnerId } = await import('@/lib/war-room/localConversationGateway')
    const ownerId = await localCommanderOwnerId(req)
    if (!ownerId) return { persisted: false, reason: 'not an authenticated local Commander request' }
    const store = getLocalOwnershipStore(process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const conv = store.getCouncilConversation(ownerId, conversationId)
    if (!conv) return { persisted: false, reason: 'conversation not found for this owner' }
    const recent = store.listCouncilMessages(ownerId, conversationId) ?? []
    const cutoff = Date.now() - 120_000
    const dup = recent.some(m => m.role === 'assistant' && m.content.trim() === content && Date.parse(m.created_at) >= cutoff)
    if (dup) return { persisted: false, reason: 'identical assistant message already stored' }
    store.addCouncilMessage(ownerId, conversationId, { role: 'assistant', content, family: input.family, metadata: { responseSuccessful: true, ...input.metadata } })
    return { persisted: true }
  } catch (err) {
    return { persisted: false, reason: err instanceof Error ? err.message : 'persist failed' }
  }
}

import 'server-only'
import type { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import type { CouncilMissionStorage } from './service'
import type { CouncilMissionProposal } from './types'

type Store = ReturnType<typeof getLocalOwnershipStore>

/** Proposals persist in the owning conversation's metadata (`councilMissions`): owner scoped, restart safe, and they follow Trash/Restore. */
export function conversationMissionStorage(store: Store, ownerId: string, conversationId: string): CouncilMissionStorage {
  return {
    read() {
      const conv = store.getCouncilConversation(ownerId, conversationId)
      if (!conv) return null
      const rows = conv.metadata.councilMissions
      return Array.isArray(rows) ? (rows as CouncilMissionProposal[]) : []
    },
    write(next) {
      const conv = store.getCouncilConversation(ownerId, conversationId)
      if (!conv) throw new Error('conversation not found for this owner')
      store.patchCouncilConversation(ownerId, conversationId, { metadata: { ...conv.metadata, councilMissions: next } })
    },
    postMessage(input) {
      const message = store.addCouncilMessage(ownerId, conversationId, {
        role: input.role,
        content: input.content,
        family: input.family,
        metadata: { responseSuccessful: true, ...input.metadata },
      })
      return { id: message?.id ?? null }
    },
  }
}

/**
 * #22 Phase 11C — Local conversation chat via Phase 11B model router.
 * Requires authenticated local Commander session + conversation ownership.
 */
import { runLocalModelInference } from '@/lib/sovereign-runtime/local-model'
import type { LocalOwnershipStore } from './store'
import type { LocalConversationRecord, LocalMessageRecord } from './types'

export async function runLocalOwnedChat(input: {
  store: LocalOwnershipStore
  ownerLocalIdentityId: string
  conversationId: string
  prompt: string
}): Promise<
  | {
      ok: true
      conversation: LocalConversationRecord
      user_message: LocalMessageRecord
      assistant_message: LocalMessageRecord
      inference: Awaited<ReturnType<typeof runLocalModelInference>>
    }
  | { ok: false; reason: string; code: string }
> {
  const conv = input.store.getConversation(input.ownerLocalIdentityId, input.conversationId)
  if (!conv) return { ok: false, reason: 'Conversation not found.', code: 'NOT_FOUND' }

  const prompt = String(input.prompt || '').trim()
  if (!prompt) return { ok: false, reason: 'Empty prompt.', code: 'EMPTY_PROMPT' }

  const user_message = input.store.addMessage(input.ownerLocalIdentityId, input.conversationId, {
    role: 'user',
    content: prompt,
  })
  if (!user_message) return { ok: false, reason: 'Failed to persist user message.', code: 'PERSIST_FAILED' }

  const inference = await runLocalModelInference({
    prompt,
    system: 'You are War Room local assistant. Be brief. You are not WRIM or Ra\'el.',
    ownerUserId: input.ownerLocalIdentityId,
    resourceOwnerUserId: conv.owner_local_identity_id,
    conversationId: input.conversationId,
  })

  if (!inference.ok || !inference.content) {
    input.store.audit(input.ownerLocalIdentityId, 'LOCAL_CHAT_INFER_FAILED', input.conversationId, inference.status)
    return {
      ok: false,
      reason: inference.error || 'Local inference failed.',
      code: inference.status,
    }
  }

  const assistant_message = input.store.addMessage(input.ownerLocalIdentityId, input.conversationId, {
    role: 'assistant',
    content: inference.content,
    actual_provider: inference.actual_provider,
    actual_model: inference.actual_model,
    local_or_remote: inference.local_or_remote,
    fallback_used: inference.fallback_used,
    intelligence_class: inference.intelligence_class,
  })
  if (!assistant_message) return { ok: false, reason: 'Failed to persist assistant message.', code: 'PERSIST_FAILED' }

  input.store.audit(input.ownerLocalIdentityId, 'LOCAL_CHAT_OK', input.conversationId, 'OK')
  return {
    ok: true,
    conversation: input.store.getConversation(input.ownerLocalIdentityId, input.conversationId)!,
    user_message,
    assistant_message,
    inference,
  }
}

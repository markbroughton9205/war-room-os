import { captureExperience, recordFailure } from './capture'
import { reconcileAssistantMessageId } from './reconcileMessageId'

type FamilyDeliberationTurnLike = {
  completion_status?: string
  provider_family?: string
  full_response?: string
}

/**
 * Best-effort experience/failure capture for ordinary (non-pre-routed) Council turns, called from
 * both /api/chat/route.ts and /api/chat/stream/route.ts right after execute.ts's response JSON is
 * available. Skips entirely when the response was already handled by the intent pre-router (which
 * writes its own, more complete experience record referencing a real message id) — see
 * lib/intent-prerouter/handle.ts.
 *
 * AGI Wave 2 (Phase 4): message_id is now reconciled to a real war_room_messages row via
 * lib/agi-experience/reconcileMessageId.ts's short polling match, closing the Wave 1 limitation
 * where this was always null — without any change to the client's own message-write call sites.
 * Handles both a single synthesized response (councilSingleResponse) and, separately, each
 * completed family-deliberation turn (data.familyDeliberation.turns) — a family-deliberation
 * response can contain multiple independent assistant messages in one HTTP response.
 */
export async function captureExperienceFromChatJson(data: Record<string, unknown>): Promise<void> {
  if (data.agiIntentPreRouted) return
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null
  if (!conversationId) return

  const contextSnapshotId = typeof data.agiContextSnapshotId === 'string' ? data.agiContextSnapshotId : null
  const startedAt = new Date(Date.now() - 5000).toISOString() // small back-window; server clocks may drift slightly

  const providerStatus = typeof data.councilProviderHttpStatus === 'string' ? data.councilProviderHttpStatus : null
  const outcomeSignal = providerStatus === 'timed_out' || providerStatus === 'failed' ? 'provider_error' : 'none'

  const singleResponse = typeof data.councilSingleResponse === 'string' ? data.councilSingleResponse : null
  if (singleResponse?.trim()) {
    const providerFamily = typeof data.councilSingleFamily === 'string' ? data.councilSingleFamily : null
    const messageId = await reconcileAssistantMessageId(conversationId, singleResponse, startedAt)
    const experienceRecordId = await captureExperience({
      conversationId,
      messageId,
      contextSnapshotId,
      promptArtifactId: null,
      modelTarget: providerFamily ? { providerFamily } : {},
      turnKind: 'assistant_response',
      outcomeSignal,
    })
    if (outcomeSignal === 'provider_error') {
      await recordFailure({
        conversationId,
        experienceRecordId,
        failureKind: 'provider_error',
        providerFamily: providerFamily ?? undefined,
        detail: typeof data.councilProviderHttpDetail === 'string' ? data.councilProviderHttpDetail : undefined,
      })
    }
  }

  const deliberation = data.familyDeliberation as { turns?: FamilyDeliberationTurnLike[] } | undefined
  for (const turn of deliberation?.turns ?? []) {
    if (turn.completion_status !== 'complete' || !turn.full_response?.trim()) continue
    const messageId = await reconcileAssistantMessageId(conversationId, turn.full_response, startedAt)
    await captureExperience({
      conversationId,
      messageId,
      contextSnapshotId,
      promptArtifactId: null,
      modelTarget: turn.provider_family ? { providerFamily: turn.provider_family } : {},
      turnKind: 'assistant_response',
      outcomeSignal: 'none',
    })
  }
}

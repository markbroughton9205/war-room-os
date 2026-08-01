/**
 * Decides whether a server-fetched transcript (loaded once on mount to reconcile the durable
 * conversation store) is allowed to replace the already-hydrated local session transcript
 * (sessionStorage/localStorage, read synchronously before this fetch resolves).
 *
 * Every provider-response persist write is fire-and-forget (never awaited), so a reload shortly
 * after a round completes can race ahead of those in-flight writes. If the server response were
 * applied unconditionally, it could truncate the transcript back to an earlier round and, because
 * synthesis/runtime state is rebuilt from `council.messages`, revert the synthesis card too.
 */

type PersistableTranscriptMessage = { messageType: string }

/** Only decree and response messages are ever present in a server-persisted transcript fetch. */
export function countPersistableTranscriptMessages(messages: readonly PersistableTranscriptMessage[]): number {
  return messages.filter(m => m.messageType === 'decree' || m.messageType === 'response').length
}

/**
 * The server fetch may only ever extend what's already visible locally, never shrink it — a
 * persisted transcript with fewer decree/response messages than what's already hydrated locally
 * is stale (still catching up to in-flight writes), not authoritative.
 */
export function shouldReplacePersistedTranscript(
  localMessages: readonly PersistableTranscriptMessage[],
  fetchedMessages: readonly PersistableTranscriptMessage[],
): boolean {
  return countPersistableTranscriptMessages(fetchedMessages) > countPersistableTranscriptMessages(localMessages)
}

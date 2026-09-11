/**
 * #17 identity mapping (authoritative).
 *
 * conversationId
 *   = war_room_conversations.id
 *   = DeliberationSession.session_id (current #16 convention)
 *   Durable Council conversation. Same id across Round 1, Round 2, …
 *
 * roundId
 *   = DeliberationSession.round_id
 *   = DeliberationSession.commander_turn_id (today equal)
 *   = councilLogicalRequestId on the live client
 *   One deliberation round within a conversation. Never reused across rounds.
 *
 * deliberationSessionId
 *   = DeliberationSession.session_id (execution provenance; currently == conversationId)
 *   Kept as a field so future decoupling does not break durable records.
 *
 * turnId
 *   = DeliberationTurn.turn_id
 *   Execution provenance for a single seat/stage contribution.
 *
 * messageId
 *   = war_room_messages.id when dual-written
 *   Linked from DurableTurnRef.messageId / output_message_id when available.
 *
 * Browser CouncilPersistedV1.sessionId
 *   Local UI orchestration UUID only. NEVER treated as conversationId or roundId.
 */
export const SESSION_INTELLIGENCE_IDENTITY_DOC = {
  conversationId: 'war_room_conversations.id / DeliberationSession.session_id',
  roundId: 'DeliberationSession.round_id (= commander_turn_id / councilLogicalRequestId)',
  deliberationSessionId: 'DeliberationSession.session_id (execution; currently equals conversationId)',
  turnId: 'DeliberationTurn.turn_id',
  messageId: 'war_room_messages.id',
  browserSessionId: 'CouncilPersistedV1.sessionId — local only, not durable',
} as const

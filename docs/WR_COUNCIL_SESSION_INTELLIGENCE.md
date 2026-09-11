# Council Session Intelligence (#17)

## Identity

| Concept | Canonical value |
| --- | --- |
| `conversationId` | `war_room_conversations.id` (= `#16 DeliberationSession.session_id`) |
| `roundId` | `DeliberationSession.round_id` (= `commander_turn_id` / `councilLogicalRequestId`) |
| `deliberationSessionId` | execution provenance (`session_id`; currently equals conversationId) |
| `turnId` | `DeliberationTurn.turn_id` |
| Browser `CouncilPersistedV1.sessionId` | **local only** — never durable FK |

## Persistence

**Primary authority:** `war_room_messages.metadata.councilDeliberationRound`  
(`CouncilDeliberationRoundV1` / `DurableDeliberationRound`)

**Session cache / read model:** `war_room_conversations.metadata.council.sessionIntelligence`  
(`CouncilSessionIntelligenceV1` — rebuildable from message round records; bounded)

Server persist writes both. Cache eviction/truncation must never delete message-level
`councilDeliberationRound` records.

No new table. Full transcript remains in `war_room_messages.content`.

## Continuation

Same `conversationId`, new `roundId`. Prior round context is injected as a bounded prompt block derived from durable intelligence (not full transcript, not hidden CoT).

## Cache bounds

| Bound | Value |
| --- | --- |
| Conversation cache rounds retained | `MAX_DURABLE_ROUNDS` = 40 |
| Digest chars | `MAX_DIGEST_CHARS` = 2400 |
| Turn refs / round | `MAX_TURN_REFS` = 48 |
| Evidence refs / round | `MAX_EVIDENCE_REFS_PER_ROUND` = 40 |
| Turn summary excerpt | `MAX_TURN_SUMMARY_CHARS` = 280 |
| Round serialized soft / hard | 48_000 / 96_000 bytes |

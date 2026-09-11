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

Stored under existing JSON metadata:

`war_room_conversations.metadata.council.sessionIntelligence` → `CouncilSessionIntelligenceV1`

No new table. Message dual-write metadata carries bounded turn linkage (`roundId`, `turnId`, `seatId`, stage, provider/runtime, evidence/challenge/revision refs). Full transcript remains in `war_room_messages.content`.

## Continuation

Same `conversationId`, new `roundId`. Prior round context is injected as a bounded prompt block derived from durable intelligence (not full transcript, not hidden CoT).

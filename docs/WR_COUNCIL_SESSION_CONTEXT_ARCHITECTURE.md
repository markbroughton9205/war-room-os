# WR Council Session + Context Architecture

Session entity is existing `war_room_conversations.id` (UUID). No parallel session table.

## Hierarchy

WORKSPACE → SESSION (`war_room_conversations`) → TURN (`commander_turn_id` / `councilLogicalRequestId`) → ROUND (`DeliberationSession.round_id`) → MESSAGE (`war_room_messages` + optional `metadata.councilStage`)

## New Chat

Creates a new conversation UUID, empty stream, empty evidence, no inherited synthesis. Durable memory remains stored and is not auto-injected.

Mount restore no longer selects the first `live_council` row. Missing storage creates a new session. Prior Panama threads remain listable.

## Context layers

Implemented in `assembleContext` via `influencePolicy` from `lib/council/session-orchestration`:

- Current turn: always
- Session history: same conversation only; skipped on FAST turns
- Durable memory: retrieval-gated; off on FAST/greetings
- Turn evidence: live research packet for this request
- Terra: only when pinned
- Standing instructions: operator_preference / safety_policy / architecture_decision when relevant

Commander profile no longer includes a Panama relocation goal. Planning content is durable memory, not standing profile.

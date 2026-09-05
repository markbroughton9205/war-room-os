# WR Live Council Orchestration

Mission `WR-LIVE-COUNCIL-ORCHESTRATION-001` extends the Council Foundation Rebuild. It does not replace session isolation, `war_room_conversations`, research-first evidence packets, or Native Router / WRIM.

## What changed

- Social check-in is a first-class turn lane (`SOCIAL_CHECKIN`) reused by `classifyCouncilTurn`, lightweight ping, greeting prompts, and client roster width.
- `"Hi council"` no longer collapses to a single family via the generic `council` bus keyword.
- `"Council check in"` is no longer a short-timeout attendance wave or a full strategy/synthesis turn.
- Visible Council families are floor-scheduled one at a time.
- Provider adapters stream OpenAI, Anthropic, xAI, and Gemini into existing `/api/chat/stream` progress events (`TEXT_DELTA`).
- Memory approval UX is gated before `"Council asks permission to save this memory."`

## Live evidence this mission

OpenAI streaming canary: PASS. Anthropic Council-path canary: HTTP 400 credit/billing (`invalid_request_error`) on both stream and non-stream. xAI/Gemini secrets in this environment are unusable sentinels. Node01 was not modified.

## Protected systems

WRIM-0, LoRA, Native Router V1, multi-tool planner, Terra/AIS/aircraft/road normalization: untouched.

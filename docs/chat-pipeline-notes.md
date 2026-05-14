# Live Council / Ra’el chat pipeline

## Duplicate paths (historical)

| Location | What |
|----------|------|
| `app/page.tsx` | Two `fetch('/api/chat')` call sites (orchestration + decree round). |
| `Phase3WarRoomPanels` | Thread `textarea` + `POST .../messages` — persistence thread, not council LLM. |

## Canonical surface

- **`postCouncilChat`** — `lib/council/liveChatPipeline.ts` — sole `/api/chat` wrapper for council calls from the home War Room.
- **`sendLiveCouncilThroneMessage`** — same file — textarea / Send / Enter path: expansion gate → `sendDecree` (append + round).

## Standing permissions

- Blocking `window.confirm` removed for standing gates; use **`resolveStandingPostExtra`** (`lib/permissions/standingInlineGate.ts`) + tab acknowledgement strip.

## Red Sentinel

- Category **`chat_integrity`** — static checks on `app/page.tsx` (duplicate fetches, placeholders, reducer surface). Optional `POST /api/red-sentinel/scan` body `{ "categories": ["chat_integrity"] }`.

## Remaining intentional splits

- Local agent invoke, repo scan, internet tools — separate routes.
- Supabase conversation messages — audit trail / thread UI, not the live council model path.

# #19 Conversation Ownership Migration — Deployment & Rollback

**Status:** PASS / LIVE-MIGRATED / CROSS-USER-VALIDATED / CLOSED  
**#19_LIVE_MIGRATION:** CONFIRMED  
**Implementation commit:** `1e1c218688d88cc9ca3bffb4377285eee2ec1995`  
Live SCHEMA → BACKFILL (AUTH_USER_A) → ENFORCE applied. Do not re-run blind backfill.

The structural runner (`scripts/run-conversation-ownership-validation.mjs`) does **not** re-probe production. A stale “SQL has not been applied” note was documentation-only and is repaired. Historical live A/B + zero-null evidence remains the closeout record; this file is not a live query.

## Security contract

- `owner_user_id` on `war_room_conversations` is authoritative.
- `war_room_messages` inherit ownership via `conversation_id`.
- **SERVICE ROLE BYPASSES RLS** — application-layer owner checks are mandatory.
- RLS authenticated policies are defense in depth only.

## SQL phases (repo)

1. `supabase/war_room_conversations_ownership.sql` — SCHEMA (nullable column, FK `ON DELETE RESTRICT`, index, authenticated policies)
2. `supabase/war_room_conversations_ownership_backfill.sql` — BACKFILL via session setting `war_room.backfill_owner_user_id` (**never commit a UUID**)
3. `supabase/war_room_conversations_ownership_enforce.sql` — ENFORCE `NOT NULL` after zero-null verify

## Recommended live ordering

1. Verify historical ownership strategy (Commander decision if >1 legitimate user).
2. Backup `war_room_conversations` / `war_room_messages`.
3. Apply SCHEMA.
4. Set `war_room.backfill_owner_user_id` to verified `auth.users.id`; apply BACKFILL.
5. Verify `count(*) where owner_user_id is null = 0` (includes archived).
6. Apply ENFORCE.
7. Deploy owner-aware application build.
8. Restart production app process (not cloudflared/Ollama unless required).
9. USER A positive acceptance (list/get/patch/chat/#17 continue).
10. USER B denial acceptance (404/non-enumerating on A's UUID).
11. Audit no new null-owner rows (post-ENFORCE should reject inserts).
12. Keep additive column on rollback (prefer app rollback over dropping column).

## Compatibility / fail-closed

Owner-aware app code expects `owner_user_id` to exist. Missing column → HTTP 503 `CONVERSATION_OWNERSHIP_MIGRATION_REQUIRED`. There is **no** permanent fallback to global conversation access.

## Rollback (non-destructive)

1. Redeploy previous application revision (pre-ownership filters) **only if** emergency access requires it — understand this re-opens IDOR until re-secured.
2. Prefer leaving `owner_user_id` column and data in place.
3. Do **not** `DROP TABLE`, delete history, or erase `#17` metadata.
4. RLS policies may remain; they do not stop service-role paths.

## Baby / ASTRA / #17

- Baby private-chat tables are out of scope.
- ASTRA creates conversations only with `mission.commanderUserId` as owner (no ownerless retry).
- `#17` semantics unchanged; persist requires `ownerUserId`.

-- =============================================================================
-- War Room Phase 46P-E Rollback — Migration A Conservative Schema Rollback
-- =============================================================================
-- Review-only artifact.
--
-- This rollback intentionally does NOT drop:
--   * public.war_room_memory_authorities
--   * created_by_user_id columns
--   * ownership_authority_basis columns
--   * any ownership data
--
-- It only removes nonessential indexes/comments after Migration B policies have
-- already been rolled back. Keeping the lookup function is safer because other
-- review artifacts may reference it during burn-in.
-- =============================================================================

begin;

drop index if exists public.memories_created_by_user_created_idx;
drop index if exists public.war_room_memory_proposals_owner_status_created_idx;

-- Authority records and ownership columns are retained by design.

commit;

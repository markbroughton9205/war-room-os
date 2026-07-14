-- =============================================================================
-- War Room Phase 46P-E Rollback — Migration C Tightening Rollback
-- =============================================================================
-- Review-only artifact.
--
-- This rollback relaxes only final burn-in constraints. It preserves ownership
-- columns, ownership values, Commander authority rows, and anonymous revocation.
-- =============================================================================

begin;

alter table public.memories
  alter column created_by_user_id drop not null;

alter table public.memories
  alter column ownership_authority_basis drop not null;

alter table public.memories
  drop constraint if exists memories_ownership_basis_check;

alter table public.war_room_memory_proposals
  alter column created_by_user_id drop not null;

alter table public.war_room_memory_proposals
  alter column ownership_authority_basis drop not null;

alter table public.war_room_memory_proposals
  drop constraint if exists war_room_memory_proposals_ownership_basis_check;

commit;

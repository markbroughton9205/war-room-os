-- =============================================================================
-- War Room Phase 46P-E Rollback — Migration B Policy Rollback
-- =============================================================================
-- Review-only artifact.
--
-- This rollback NEVER restores anonymous access, drops ownership history, or
-- removes Commander authority records. It removes only the new authenticated
-- memory authority policies and authenticated grants from Migration B.
-- =============================================================================

begin;

drop policy if exists memories_commander_select on public.memories;
drop policy if exists memories_commander_insert on public.memories;
drop policy if exists war_room_memory_proposals_commander_select on public.war_room_memory_proposals;
drop policy if exists war_room_memory_proposals_commander_insert on public.war_room_memory_proposals;
drop policy if exists war_room_approved_memories_commander_select on public.war_room_approved_memories;

revoke select, insert on table public.memories from authenticated;
revoke select, insert on table public.war_room_memory_proposals from authenticated;
revoke select on table public.war_room_approved_memories from authenticated;

revoke execute on function public.war_room_is_memory_commander(uuid) from authenticated;

-- Keep anon revoked. Keep service_role access unchanged. Keep authority data.

commit;

-- Rollback for War Room Phase 48-DB-A.
--
-- BASELINE-DEPENDENT ROLLBACK (Option A: baseline-specific).
--
-- This rollback restores the confirmed pre-migration baseline only. It does
-- not attempt to reconstruct an unknown historical privilege state, and it
-- does not touch any privilege the forward migration did not itself change:
--
--   - service_role held none of the SELECT/INSERT/UPDATE grants added by the
--     forward migration on the seven target tables before Phase 48-DB-A
--     (confirmed for war_room_economic_provider_effectiveness via a direct
--     `service_role SELECT = false` privilege test; inferred for the other
--     six tables from the shared postgres default-ACL defect documented in
--     PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md, since all seven tables were
--     created under the same defective default ACL).
--   - anon and authenticated held TRUNCATE, REFERENCES, TRIGGER, and
--     version-supported MAINTAIN on all seven tables before the forward
--     migration revoked them from anon/authenticated only.
--   - service_role's TRUNCATE/REFERENCES/TRIGGER/MAINTAIN privileges were
--     never touched by the forward migration, so this rollback never grants
--     or revokes them for service_role. Restoring TRUNCATE/REFERENCES/
--     TRIGGER/MAINTAIN to service_role here would be a scope expansion this
--     rollback did not earn: the forward migration never removed those
--     privileges from service_role in the first place.
--
-- Precondition guard: this rollback restores the previously observed insecure default acl
-- posture for anon/authenticated table privileges created by postgres, and
-- only proceeds if two conditions both hold: (1) service_role currently
-- holds every privilege the forward migration is documented to have
-- granted, and (2) service_role does NOT hold DELETE on any of the seven
-- target tables. Condition (1) proves the required privileges are present
-- before they are removed; it does not by itself prove the live state is
-- an exact total match with no additional, unrelated privileges beyond
-- what this rollback checks for -- this guard is a required-privilege
-- presence check plus an explicit dangerous-extra rejection (service_role
-- DELETE), not a full state diff. If either condition fails, the
-- transaction aborts instead of guessing which privileges are safe to
-- remove. This is a static, read-before-write guard; it requires no
-- Production access to define and performs no query until the rollback is
-- actually executed.
--
-- It does not restore anonymous CRUD access, does not disable RLS, does not
-- drop policies, does not change ownership, and does not modify data or
-- schema.

begin;

do $$
begin
  if not (
    has_table_privilege('service_role', 'public.war_room_permissions_state', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_permissions_state', 'INSERT')
    and has_table_privilege('service_role', 'public.war_room_permissions_state', 'UPDATE')
    and has_table_privilege('service_role', 'public.war_room_sentinel_scans', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_sentinel_scans', 'INSERT')
    and has_table_privilege('service_role', 'public.war_room_economic_proposals', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_economic_proposals', 'INSERT')
    and has_table_privilege('service_role', 'public.war_room_economic_telemetry', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_economic_telemetry', 'INSERT')
    and has_table_privilege('service_role', 'public.war_room_economic_provider_effectiveness', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_economic_provider_effectiveness', 'INSERT')
    and has_table_privilege('service_role', 'public.war_room_economic_provider_effectiveness', 'UPDATE')
    and has_table_privilege('service_role', 'public.war_room_economic_active_missions', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_economic_active_missions', 'INSERT')
    and has_table_privilege('service_role', 'public.war_room_economic_unresolved_operations', 'SELECT')
    and has_table_privilege('service_role', 'public.war_room_economic_unresolved_operations', 'INSERT')
  ) then
    raise exception 'Phase 48-DB-A rollback precondition failed: service_role does not currently hold the required privilege set the forward migration granted. Refusing to revoke, to avoid removing a privilege this rollback did not add. Run preflight_war_room_server_table_privileges.sql or verify_war_room_server_table_privileges.sql to inspect actual state before retrying.';
  end if;

  if (
    has_table_privilege('service_role', 'public.war_room_permissions_state', 'DELETE')
    or has_table_privilege('service_role', 'public.war_room_sentinel_scans', 'DELETE')
    or has_table_privilege('service_role', 'public.war_room_economic_proposals', 'DELETE')
    or has_table_privilege('service_role', 'public.war_room_economic_telemetry', 'DELETE')
    or has_table_privilege('service_role', 'public.war_room_economic_provider_effectiveness', 'DELETE')
    or has_table_privilege('service_role', 'public.war_room_economic_active_missions', 'DELETE')
    or has_table_privilege('service_role', 'public.war_room_economic_unresolved_operations', 'DELETE')
  ) then
    raise exception 'Phase 48-DB-A rollback precondition failed: service_role holds DELETE on at least one of the seven target tables. This was never part of the forward migration''s scope and this rollback refuses to run against a state that includes it. Investigate before retrying.';
  end if;
end
$$;

revoke select, insert, update on table public.war_room_permissions_state from service_role;
revoke select, insert on table public.war_room_sentinel_scans from service_role;
revoke select, insert on table public.war_room_economic_proposals from service_role;
revoke select, insert on table public.war_room_economic_telemetry from service_role;
revoke select, insert, update on table public.war_room_economic_provider_effectiveness from service_role;
revoke select, insert on table public.war_room_economic_active_missions from service_role;
revoke select, insert on table public.war_room_economic_unresolved_operations from service_role;

grant truncate, references, trigger on table public.war_room_permissions_state to anon, authenticated;
grant truncate, references, trigger on table public.war_room_sentinel_scans to anon, authenticated;
grant truncate, references, trigger on table public.war_room_economic_proposals to anon, authenticated;
grant truncate, references, trigger on table public.war_room_economic_telemetry to anon, authenticated;
grant truncate, references, trigger on table public.war_room_economic_provider_effectiveness to anon, authenticated;
grant truncate, references, trigger on table public.war_room_economic_active_missions to anon, authenticated;
grant truncate, references, trigger on table public.war_room_economic_unresolved_operations to anon, authenticated;

-- MAINTAIN restore uses the same exception-trap approach as the forward
-- migration: no version-string parsing, just a caught
-- syntax_error_or_access_rule_violation on PostgreSQL versions predating
-- MAINTAIN (PostgreSQL 17). Scope is anon/authenticated only, matching the
-- forward migration's revoke scope exactly.
do $$
begin
  execute 'grant maintain on table public.war_room_permissions_state to anon, authenticated';
  execute 'grant maintain on table public.war_room_sentinel_scans to anon, authenticated';
  execute 'grant maintain on table public.war_room_economic_proposals to anon, authenticated';
  execute 'grant maintain on table public.war_room_economic_telemetry to anon, authenticated';
  execute 'grant maintain on table public.war_room_economic_provider_effectiveness to anon, authenticated';
  execute 'grant maintain on table public.war_room_economic_active_missions to anon, authenticated';
  execute 'grant maintain on table public.war_room_economic_unresolved_operations to anon, authenticated';
exception
  when syntax_error_or_access_rule_violation then
    raise notice 'MAINTAIN privilege is not supported by this PostgreSQL version; rollback restored TRUNCATE/REFERENCES/TRIGGER only.';
end
$$;

alter default privileges for role postgres in schema public grant truncate, references, trigger on tables to anon, authenticated;

do $$
begin
  execute 'alter default privileges for role postgres in schema public grant maintain on tables to anon, authenticated';
exception
  when syntax_error_or_access_rule_violation then
    raise notice 'Default MAINTAIN privilege is not supported by this PostgreSQL version; rollback restored TRUNCATE/REFERENCES/TRIGGER defaults only.';
end
$$;

commit;

-- War Room Phase 48-DB-A
-- Service-role table privilege repair + default ACL hardening.
--
-- Build artifact only until reviewed and explicitly approved for Production.
-- This migration grants only the CRUD operations required by current
-- server-side callers and removes inherited dangerous non-CRUD privileges
-- from browser roles on the seven confirmed server-only tables.

begin;

grant usage on schema public to service_role;

grant select, insert, update on table public.war_room_permissions_state to service_role;
grant select, insert on table public.war_room_sentinel_scans to service_role;
grant select, insert on table public.war_room_economic_proposals to service_role;
grant select, insert on table public.war_room_economic_telemetry to service_role;
grant select, insert, update on table public.war_room_economic_provider_effectiveness to service_role;
grant select, insert on table public.war_room_economic_active_missions to service_role;
grant select, insert on table public.war_room_economic_unresolved_operations to service_role;

revoke truncate, references, trigger on table public.war_room_permissions_state from anon, authenticated;
revoke truncate, references, trigger on table public.war_room_sentinel_scans from anon, authenticated;
revoke truncate, references, trigger on table public.war_room_economic_proposals from anon, authenticated;
revoke truncate, references, trigger on table public.war_room_economic_telemetry from anon, authenticated;
revoke truncate, references, trigger on table public.war_room_economic_provider_effectiveness from anon, authenticated;
revoke truncate, references, trigger on table public.war_room_economic_active_missions from anon, authenticated;
revoke truncate, references, trigger on table public.war_room_economic_unresolved_operations from anon, authenticated;

-- MAINTAIN was introduced as a table privilege in PostgreSQL 17. Rather than
-- gate on a version-correlated catalog probe (unreliable across versions),
-- this relies purely on exception trapping: on any PostgreSQL version where
-- MAINTAIN is not a recognized privilege type, the REVOKE raises
-- syntax_error_or_access_rule_violation, which is caught and logged, and the
-- already-applied TRUNCATE/REFERENCES/TRIGGER revokes above are unaffected.
do $$
begin
  execute 'revoke maintain on table public.war_room_permissions_state from anon, authenticated';
  execute 'revoke maintain on table public.war_room_sentinel_scans from anon, authenticated';
  execute 'revoke maintain on table public.war_room_economic_proposals from anon, authenticated';
  execute 'revoke maintain on table public.war_room_economic_telemetry from anon, authenticated';
  execute 'revoke maintain on table public.war_room_economic_provider_effectiveness from anon, authenticated';
  execute 'revoke maintain on table public.war_room_economic_active_missions from anon, authenticated';
  execute 'revoke maintain on table public.war_room_economic_unresolved_operations from anon, authenticated';
exception
  when syntax_error_or_access_rule_violation then
    raise notice 'MAINTAIN privilege is not supported by this PostgreSQL version; continuing after revoking TRUNCATE/REFERENCES/TRIGGER.';
end
$$;

alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;

do $$
begin
  begin
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  exception
    when syntax_error_or_access_rule_violation then
      raise notice 'Default MAINTAIN privilege is not supported by this PostgreSQL version; no MAINTAIN default ACL change applied.';
  end;
end
$$;

commit;

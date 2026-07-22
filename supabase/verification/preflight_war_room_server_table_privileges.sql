-- War Room Phase 48-DB-A preflight.
-- Read-only. Do not modify grants, RLS, policies, ownership, or data.
-- This script only reports actual queried state; it does not claim
-- Production behavior that has not been directly observed by running it.

with affected_tables(table_name, required_privileges) as (
  values
    ('war_room_permissions_state', array['SELECT','INSERT','UPDATE']),
    ('war_room_sentinel_scans', array['SELECT','INSERT']),
    ('war_room_economic_proposals', array['SELECT','INSERT']),
    ('war_room_economic_telemetry', array['SELECT','INSERT']),
    ('war_room_economic_provider_effectiveness', array['SELECT','INSERT','UPDATE']),
    ('war_room_economic_active_missions', array['SELECT','INSERT']),
    ('war_room_economic_unresolved_operations', array['SELECT','INSERT'])
),
roles(role_name) as (
  values ('postgres'), ('service_role'), ('authenticated'), ('anon'), ('public')
),
-- MAINTAIN is intentionally excluded here and checked separately below: on
-- PostgreSQL versions before 17, has_table_privilege(..., 'MAINTAIN') raises
-- "unrecognized privilege type" and would abort this entire read-only
-- report. TRUNCATE/REFERENCES/TRIGGER are valid privilege-type strings on
-- every supported PostgreSQL version, so they stay in the generic cross join.
privileges(privilege_name) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
select
  t.table_name,
  to_regclass('public.' || t.table_name) is not null as table_exists,
  c.relowner::regrole::text as table_owner,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_enabled,
  r.role_name,
  p.privilege_name,
  case
    when to_regclass('public.' || t.table_name) is null then false
    else has_table_privilege(r.role_name, 'public.' || t.table_name, p.privilege_name)
  end as has_privilege,
  p.privilege_name = any(t.required_privileges) as required_for_service_role,
  c.relacl as raw_acl
from affected_tables t
cross join roles r
cross join privileges p
left join pg_class c on c.oid = to_regclass('public.' || t.table_name)
order by t.table_name, r.role_name, p.privilege_name;

-- Version-gated MAINTAIN check, reported separately so a pre-PG17
-- environment still gets a complete report instead of a hard error.
select
  t.table_name,
  r.role_name,
  case
    when current_setting('server_version_num')::int >= 170000
      then has_table_privilege(r.role_name, 'public.' || t.table_name, 'MAINTAIN')
    else null
  end as has_maintain,
  current_setting('server_version_num')::int >= 170000 as maintain_privilege_type_supported
from (
  values
    ('war_room_permissions_state'), ('war_room_sentinel_scans'),
    ('war_room_economic_proposals'), ('war_room_economic_telemetry'),
    ('war_room_economic_provider_effectiveness'), ('war_room_economic_active_missions'),
    ('war_room_economic_unresolved_operations')
) as t(table_name)
cross join (values ('postgres'), ('service_role'), ('authenticated'), ('anon'), ('public')) as r(role_name)
order by t.table_name, r.role_name;

-- Explicit ACL entries, decoded, so individual grants are visible rather
-- than only as an effective has_table_privilege() boolean.
select
  t.table_name,
  (acl.grantee)::regrole::text as grantee,
  acl.privilege_type,
  acl.is_grantable
from (
  values
    ('war_room_permissions_state'), ('war_room_sentinel_scans'),
    ('war_room_economic_proposals'), ('war_room_economic_telemetry'),
    ('war_room_economic_provider_effectiveness'), ('war_room_economic_active_missions'),
    ('war_room_economic_unresolved_operations')
) as t(table_name)
left join pg_class c on c.oid = to_regclass('public.' || t.table_name)
left join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl on true
order by t.table_name, grantee, acl.privilege_type;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'war_room_permissions_state',
    'war_room_sentinel_scans',
    'war_room_economic_proposals',
    'war_room_economic_telemetry',
    'war_room_economic_provider_effectiveness',
    'war_room_economic_active_missions',
    'war_room_economic_unresolved_operations'
  )
order by tablename, policyname;

-- Whether any policy is discoverable in the connected database's live
-- pg_policies catalog per table, and the explicit non-blocking warning for
-- tables with RLS enabled but no policy found by this query (service_role
-- BYPASSRLS may still make this safe; see the BYPASSRLS query below).
with target_tables(table_name) as (
  values
    ('war_room_permissions_state'), ('war_room_sentinel_scans'),
    ('war_room_economic_proposals'), ('war_room_economic_telemetry'),
    ('war_room_economic_provider_effectiveness'), ('war_room_economic_active_missions'),
    ('war_room_economic_unresolved_operations')
),
policy_presence as (
  select
    t.table_name,
    exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.table_name
    ) as policy_discovered,
    coalesce(c.relrowsecurity, false) as rls_enabled
  from target_tables t
  left join pg_class c on c.oid = to_regclass('public.' || t.table_name)
)
select
  table_name,
  rls_enabled,
  policy_discovered,
  case
    when rls_enabled and not policy_discovered
      then 'RLS_ENABLED_NO_DATABASE_POLICY_DISCOVERED_REQUIRES_RUNTIME_CONFIRMATION'
    else null
  end as non_blocking_warning
from policy_presence
order by table_name;

-- service_role BYPASSRLS status. If true, RLS policy presence/absence is
-- less relevant for service_role access; this reports the confirmed flag
-- rather than assuming it.
select
  rolname,
  rolbypassrls
from pg_roles
where rolname in ('service_role', 'postgres');

-- Sequence dependency for INSERT paths: identity/serial columns and whether
-- service_role holds USAGE on the owned sequence (required for nextval()
-- during INSERT even when the column itself is not directly referenced).
select
  cols.table_name,
  cols.column_name,
  cols.column_default,
  pg_get_serial_sequence('public.' || cols.table_name, cols.column_name) as owned_sequence,
  case
    when pg_get_serial_sequence('public.' || cols.table_name, cols.column_name) is not null
      then has_sequence_privilege('service_role', pg_get_serial_sequence('public.' || cols.table_name, cols.column_name), 'USAGE')
    else null
  end as service_role_has_sequence_usage
from information_schema.columns cols
where cols.table_schema = 'public'
  and cols.table_name in (
    'war_room_permissions_state',
    'war_room_sentinel_scans',
    'war_room_economic_proposals',
    'war_room_economic_telemetry',
    'war_room_economic_provider_effectiveness',
    'war_room_economic_active_missions',
    'war_room_economic_unresolved_operations'
  )
  and cols.column_default like 'nextval(%'
order by cols.table_name, cols.column_name;

-- Default ACL state for both the postgres creator (the confirmed defect
-- owner) and supabase_admin, reported side by side so any supabase_admin
-- drift is directly visible without this script asserting it either way.
select
  defaclrole::regrole::text as default_acl_creator,
  defaclnamespace::regnamespace::text as default_acl_schema,
  defaclobjtype as default_acl_object_type,
  defaclacl as default_acl
from pg_default_acl
where defaclnamespace = 'public'::regnamespace
  and defaclobjtype = 'r'
  and defaclrole::regrole::text in ('postgres', 'supabase_admin')
order by default_acl_creator;

select
  t.table_name,
  c.relowner::regrole::text as owner,
  c.relowner::regrole::text <> 'postgres' as unexpected_owner
from (
  values
    ('war_room_permissions_state'),
    ('war_room_sentinel_scans'),
    ('war_room_economic_proposals'),
    ('war_room_economic_telemetry'),
    ('war_room_economic_provider_effectiveness'),
    ('war_room_economic_active_missions'),
    ('war_room_economic_unresolved_operations')
) as t(table_name)
left join pg_class c on c.oid = to_regclass('public.' || t.table_name);

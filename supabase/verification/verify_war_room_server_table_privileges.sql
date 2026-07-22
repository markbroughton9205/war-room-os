-- War Room Phase 48-DB-A verification.
-- Read-only. Intended to run after the approved forward migration.

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
required_checks as (
  select
    t.table_name,
    privilege_name,
    has_table_privilege('service_role', 'public.' || t.table_name, privilege_name) as service_role_has_required
  from affected_tables t
  cross join lateral unnest(t.required_privileges) as privilege_name
),
extra_delete_check as (
  select
    t.table_name,
    has_table_privilege('service_role', 'public.' || t.table_name, 'DELETE') as service_role_has_delete
  from affected_tables t
),
browser_checks as (
  select
    t.table_name,
    role_name,
    privilege_name,
    has_table_privilege(role_name, 'public.' || t.table_name, privilege_name) as browser_has_privilege
  from affected_tables t
  cross join (values ('anon'), ('authenticated'), ('public')) as r(role_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(privilege_name)
),
table_checks as (
  select
    t.table_name,
    to_regclass('public.' || t.table_name) is not null as table_exists,
    c.relowner::regrole::text = 'postgres' as owner_is_postgres,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls_enabled,
    exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.table_name
        and 'service_role' = any(p.roles)
    ) as service_role_policy_present,
    exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = t.table_name
    ) as any_policy_present,
    -- service_role BYPASSRLS is a role-level flag (not per-table), pulled
    -- in here so it can sit alongside the per-table policy result below.
    -- STEP 7: the boolean used in downstream OR/AND logic is explicitly
    -- COALESCE-guarded to false when service_role is absent -- a raw NULL
    -- here would silently propagate through `NULL OR pass_boolean`, which
    -- in SQL three-valued logic is NULL whenever pass_boolean is false,
    -- turning an absent role into an ambiguous (neither PASS nor FAIL)
    -- result instead of a hard, explicit FAIL.
    coalesce((select rolbypassrls from pg_roles where rolname = 'service_role'), false) as service_role_bypassrls,
    -- Explicit three-state label so "service_role does not exist" is never
    -- silently indistinguishable from "service_role exists with
    -- BYPASSRLS = false" in the reported output.
    case
      when not exists (select 1 from pg_roles where rolname = 'service_role')
        then 'SERVICE_ROLE_ABSENT'
      when (select rolbypassrls from pg_roles where rolname = 'service_role')
        then 'SERVICE_ROLE_PRESENT_BYPASSRLS_TRUE'
      else 'SERVICE_ROLE_PRESENT_BYPASSRLS_FALSE'
    end as service_role_bypassrls_state
  from affected_tables t
  left join pg_class c on c.oid = to_regclass('public.' || t.table_name)
)
select
  t.table_name,
  bool_and(rc.service_role_has_required) as pass_service_role_required_privileges,
  not edc.service_role_has_delete as pass_no_service_role_delete,
  not exists (
    select 1 from browser_checks bc
    where bc.table_name = t.table_name
      and bc.browser_has_privilege
  ) as pass_no_browser_or_public_table_privileges,
  tc.table_exists as pass_table_exists,
  tc.owner_is_postgres as pass_owner_unchanged_postgres,
  tc.rls_enabled as pass_rls_enabled,
  tc.force_rls_enabled as force_rls_state,
  tc.service_role_policy_present as pass_service_role_policy_present,
  tc.service_role_bypassrls as service_role_bypassrls,
  tc.service_role_bypassrls_state as service_role_bypassrls_state,
  -- STEP 7: service_role's real RLS access path is EITHER an explicit
  -- named policy OR BYPASSRLS -- either one alone is sufficient, so this
  -- must never require a named policy when BYPASSRLS already confirms
  -- access. This is metadata only: it does not prove any application code
  -- path actually succeeds, only that a route to RLS-gated data exists.
  (tc.service_role_bypassrls or tc.service_role_policy_present) as pass_service_role_rls_access_path,
  tc.any_policy_present as any_database_discoverable_policy_present,
  (not tc.any_policy_present) as policy_absence_surfaced,
  (
    bool_and(rc.service_role_has_required)
    and not edc.service_role_has_delete
    and not exists (
      select 1 from browser_checks bc
      where bc.table_name = t.table_name
        and bc.browser_has_privilege
    )
    and tc.table_exists
    and tc.owner_is_postgres
    and tc.rls_enabled
    and (tc.service_role_bypassrls or tc.service_role_policy_present)
  ) as pass_table_privilege_repair
from affected_tables t
join required_checks rc on rc.table_name = t.table_name
join extra_delete_check edc on edc.table_name = t.table_name
join table_checks tc on tc.table_name = t.table_name
group by t.table_name, edc.service_role_has_delete, tc.table_exists, tc.owner_is_postgres, tc.rls_enabled, tc.force_rls_enabled, tc.service_role_policy_present, tc.service_role_bypassrls, tc.service_role_bypassrls_state, tc.any_policy_present
order by t.table_name;

-- Full policy metadata by role/command/mode/predicate, so pass/fail booleans
-- above are never the only evidence for policy state.
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

-- STEP 8: explicit tri-state MAINTAIN result. This is a label, not a
-- boolean PASS/FAIL, precisely so an unsupported PostgreSQL version is
-- never reported as either a pass or a fail -- it is reported as not
-- checked. has_table_privilege(..., 'MAINTAIN') itself raises
-- "unrecognized privilege type" on PostgreSQL versions before 17, so the
-- privilege check only runs once the version gate confirms support.
select
  t.table_name,
  r.role_name,
  case
    when current_setting('server_version_num')::int < 170000
      then 'UNSUPPORTED_POSTGRESQL_VERSION'
    when has_table_privilege(r.role_name, 'public.' || t.table_name, 'MAINTAIN')
      then 'SUPPORTED_BUT_UNEXPECTEDLY_PRESENT'
    else 'SUPPORTED_AND_CORRECTLY_ABSENT'
  end as maintain_result
from (
  values
    ('war_room_permissions_state'), ('war_room_sentinel_scans'),
    ('war_room_economic_proposals'), ('war_room_economic_telemetry'),
    ('war_room_economic_provider_effectiveness'), ('war_room_economic_active_missions'),
    ('war_room_economic_unresolved_operations')
) as t(table_name)
cross join (values ('anon'), ('authenticated'), ('public'), ('service_role')) as r(role_name)
order by t.table_name, r.role_name;

-- STEP 6: default ACL verification via aclexplode(), not raw aclitem text
-- LIKE matching. Compares decoded (grantee, privilege_type) pairs directly
-- against role OIDs rather than parsing printed ACL characters, and OID 0
-- is the well-known aclitem representation of the PUBLIC pseudo-role (no
-- text parsing of a "-" placeholder is used to detect it).
with default_acl_entries as (
  select
    acl.grantee as grantee_oid,
    acl.privilege_type
  from pg_default_acl d
  left join lateral aclexplode(coalesce(d.defaclacl, array[]::aclitem[])) as acl on true
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'r'
),
dangerous_privileges(privilege_type) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
select
  'postgres_public_table_default_acl' as check_name,
  not exists (
    select 1 from default_acl_entries e
    join dangerous_privileges dp on dp.privilege_type = e.privilege_type
    where e.grantee_oid = 'anon'::regrole
  ) as pass_no_anon_default_crud_or_dangerous_privilege,
  not exists (
    select 1 from default_acl_entries e
    join dangerous_privileges dp on dp.privilege_type = e.privilege_type
    where e.grantee_oid = 'authenticated'::regrole
  ) as pass_no_authenticated_default_crud_or_dangerous_privilege,
  not exists (
    select 1 from default_acl_entries e
    join dangerous_privileges dp on dp.privilege_type = e.privilege_type
    where e.grantee_oid = 0
  ) as pass_no_public_default_crud_or_dangerous_privilege,
  not exists (
    select 1 from default_acl_entries e
    where e.grantee_oid = 'service_role'::regrole
      and e.privilege_type = 'DELETE'
  ) as pass_no_service_role_default_delete,
  not exists (
    select 1 from default_acl_entries e
    where e.grantee_oid not in (0, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole, 'postgres'::regrole)
  ) as pass_no_unexpected_default_acl_grantee;

-- supabase_admin default ACL for public tables, reported for visual
-- comparison against its state before the forward migration ran. This
-- migration never targets supabase_admin defaults; any difference here
-- indicates drift from an unrelated cause, not from Phase 48-DB-A.
select
  defaclrole::regrole::text as default_acl_creator,
  defaclnamespace::regnamespace::text as default_acl_schema,
  defaclobjtype as default_acl_object_type,
  defaclacl as default_acl
from pg_default_acl
where defaclnamespace = 'public'::regnamespace
  and defaclobjtype = 'r'
  and defaclrole::regrole::text = 'supabase_admin';

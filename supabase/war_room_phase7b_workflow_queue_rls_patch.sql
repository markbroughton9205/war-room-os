-- War Room Phase 7B production patch: workflow queue service-role access.
-- Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

do $$
begin
  if to_regclass('public.war_room_economic_workflow_queue') is not null then
    execute 'grant select, insert, update, delete on table public.war_room_economic_workflow_queue to service_role';
    execute 'alter table public.war_room_economic_workflow_queue enable row level security';
    execute 'drop policy if exists war_room_economic_workflow_service_role_all on public.war_room_economic_workflow_queue';
    execute 'create policy war_room_economic_workflow_service_role_all on public.war_room_economic_workflow_queue for all to service_role using (true) with check (true)';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');

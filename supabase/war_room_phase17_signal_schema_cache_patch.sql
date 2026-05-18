-- War Room Phase 17: signal schema cache repair.
-- Safe to run after Phase 14. It does not seed fake signal rows.
-- If any table is missing, apply supabase/war_room_phase14_signals.sql first,
-- then run this patch to refresh PostgREST/Supabase schema cache.

do $$
begin
  if to_regclass('public.war_room_signal_sources') is null
    or to_regclass('public.war_room_signal_scans') is null
    or to_regclass('public.war_room_signal_results') is null
    or to_regclass('public.war_room_signal_scores') is null
    or to_regclass('public.war_room_signal_alerts') is null
  then
    raise notice 'MIGRATION_REQUIRED: run supabase/war_room_phase14_signals.sql before this schema-cache patch.';
  end if;
end $$;

grant usage on schema public to service_role;

do $$
begin
  if to_regclass('public.war_room_signal_sources') is not null then
    execute 'grant select, insert, update, delete on table public.war_room_signal_sources to service_role';
  end if;
  if to_regclass('public.war_room_signal_scans') is not null then
    execute 'grant select, insert, update, delete on table public.war_room_signal_scans to service_role';
  end if;
  if to_regclass('public.war_room_signal_results') is not null then
    execute 'grant select, insert, update, delete on table public.war_room_signal_results to service_role';
  end if;
  if to_regclass('public.war_room_signal_scores') is not null then
    execute 'grant select, insert, update, delete on table public.war_room_signal_scores to service_role';
  end if;
  if to_regclass('public.war_room_signal_alerts') is not null then
    execute 'grant select, insert, update, delete on table public.war_room_signal_alerts to service_role';
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');

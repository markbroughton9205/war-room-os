-- War Room Phase 7B production patch: workflow queue dedupe schema.
-- Safe to run repeatedly. Preserves existing rows and asks PostgREST to reload schema cache.

alter table if exists public.war_room_economic_workflow_queue
  add column if not exists dedupe_key text;

do $$
begin
  if to_regclass('public.war_room_economic_workflow_queue') is not null then
    update public.war_room_economic_workflow_queue
    set dedupe_key = coalesce(dedupe_key, metadata->>'dedupe_key', id::text)
    where dedupe_key is null;

    create unique index if not exists war_room_economic_workflow_dedupe_idx
      on public.war_room_economic_workflow_queue (dedupe_key)
      where dedupe_key is not null;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');

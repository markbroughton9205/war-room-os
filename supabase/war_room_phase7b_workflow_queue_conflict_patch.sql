-- War Room Phase 7B production patch: align workflow queue upsert conflict target.
-- PostgREST upsert uses on_conflict=dedupe_key, which requires a real unique
-- constraint/index matching that column. Partial unique indexes do not satisfy it.

alter table if exists public.war_room_economic_workflow_queue
  add column if not exists dedupe_key text;

do $$
begin
  if to_regclass('public.war_room_economic_workflow_queue') is not null then
    update public.war_room_economic_workflow_queue
    set dedupe_key = coalesce(dedupe_key, metadata->>'dedupe_key', id::text)
    where dedupe_key is null;

    with duplicate_dedupe as (
      select id, dedupe_key, row_number() over (partition by dedupe_key order by created_at, id) as rn
      from public.war_room_economic_workflow_queue
      where dedupe_key is not null
    )
    update public.war_room_economic_workflow_queue q
    set dedupe_key = q.dedupe_key || ':' || q.id::text
    from duplicate_dedupe d
    where q.id = d.id
      and d.rn > 1;

    drop index if exists public.war_room_economic_workflow_dedupe_idx;

    alter table public.war_room_economic_workflow_queue
      alter column dedupe_key set not null;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'war_room_economic_workflow_queue_dedupe_key_key'
        and conrelid = 'public.war_room_economic_workflow_queue'::regclass
    ) then
      alter table public.war_room_economic_workflow_queue
        add constraint war_room_economic_workflow_queue_dedupe_key_key unique (dedupe_key);
    end if;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');

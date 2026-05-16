-- War Room Phase 7C production patch: Opportunity Scout persistence contract.
-- Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

do $$
begin
  if to_regclass('public.war_room_economic_opportunities') is not null then
    alter table public.war_room_economic_opportunities
      add column if not exists source_provider text not null default 'unknown',
      add column if not exists notes text not null default '',
      add column if not exists source_details jsonb not null default '{}'::jsonb,
      add column if not exists dedupe_key text;

    update public.war_room_economic_opportunities
    set dedupe_key = coalesce(
      dedupe_key,
      lower(coalesce(source_provider, 'unknown') || ':' || coalesce(metadata->>'session_id', 'global') || ':' || regexp_replace(title, '[^a-zA-Z0-9]+', ' ', 'g') || ':' || id::text)
    )
    where dedupe_key is null;

    update public.war_room_economic_opportunities
    set source_provider = 'unknown'
    where source_provider is null or source_provider = '';

    update public.war_room_economic_opportunities
    set notes = ''
    where notes is null;

    update public.war_room_economic_opportunities
    set source_details = '{}'::jsonb
    where source_details is null;

    alter table public.war_room_economic_opportunities
      alter column dedupe_key set not null,
      alter column source_provider set not null,
      alter column notes set not null,
      alter column source_details set not null;

    with duplicate_dedupe_keys as (
      select
        ctid,
        id,
        dedupe_key,
        row_number() over (partition by dedupe_key order by created_at, id) as row_number
      from public.war_room_economic_opportunities
    )
    update public.war_room_economic_opportunities opportunity
    set dedupe_key = duplicate_dedupe_keys.dedupe_key || ':' || duplicate_dedupe_keys.id::text
    from duplicate_dedupe_keys
    where opportunity.ctid = duplicate_dedupe_keys.ctid
      and duplicate_dedupe_keys.row_number > 1;

    alter table public.war_room_economic_opportunities
      drop constraint if exists war_room_economic_opportunities_status_check;

    alter table public.war_room_economic_opportunities
      add constraint war_room_economic_opportunities_status_check check (
        status in ('discovered','investigating','approved','queued','executing','completed','rejected','archived')
      );

    alter table public.war_room_economic_opportunities
      drop constraint if exists war_room_economic_opportunities_source_provider_check;

    alter table public.war_room_economic_opportunities
      add constraint war_room_economic_opportunities_source_provider_check check (
        source_provider in ('chatgpt','claude','grok','gemini','red_team','unknown')
      );

    drop index if exists public.war_room_economic_opportunities_dedupe_idx;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'war_room_economic_opportunities_dedupe_key_key'
        and conrelid = 'public.war_room_economic_opportunities'::regclass
    ) then
      alter table public.war_room_economic_opportunities
        add constraint war_room_economic_opportunities_dedupe_key_key unique (dedupe_key);
    end if;

    create index if not exists war_room_economic_opportunities_status_idx
      on public.war_room_economic_opportunities (status, discovered_at desc);

    create index if not exists war_room_economic_opportunities_category_idx
      on public.war_room_economic_opportunities (category, discovered_at desc);

    grant select, insert, update, delete on table public.war_room_economic_opportunities to service_role;

    alter table public.war_room_economic_opportunities enable row level security;

    drop policy if exists war_room_economic_opportunities_service_role_all on public.war_room_economic_opportunities;
    create policy war_room_economic_opportunities_service_role_all
      on public.war_room_economic_opportunities
      for all to service_role using (true) with check (true);
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');

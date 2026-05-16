-- War Room Phase 7D immutable patch.
-- Supabase/Postgres rejects non-immutable generated expressions for recall_index.
-- Convert recall_index to a normal tsvector column maintained by a trigger.

grant usage on schema public to service_role;

create table if not exists public.war_room_archived_transcripts (
  id uuid primary key default gen_random_uuid(),
  source_message_id text not null,
  session_id text,
  decree_id text,
  message_timestamp timestamptz not null,
  message_date date not null,
  role text not null,
  family text,
  provider text,
  content text not null,
  message_type text,
  tags text[] not null default '{}'::text[],
  topic text,
  source_mode text not null default 'live_chat_window',
  archived_at timestamptz not null default now(),
  archive_date date not null default current_date,
  operator_id text,
  operator_name text,
  visibility text not null default 'private',
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_archived_transcripts_visibility_check check (
    visibility in ('private', 'shared', 'household')
  )
);

alter table if exists public.war_room_archived_transcripts
  add column if not exists archive_date date not null default current_date;

create unique index if not exists war_room_archived_transcripts_source_idx
  on public.war_room_archived_transcripts (session_id, source_message_id);

create index if not exists war_room_archived_transcripts_date_idx
  on public.war_room_archived_transcripts (message_date, message_timestamp desc);

create index if not exists war_room_archived_transcripts_archive_date_idx
  on public.war_room_archived_transcripts (archive_date, archived_at desc);

create index if not exists war_room_archived_transcripts_session_idx
  on public.war_room_archived_transcripts (session_id, message_timestamp desc);

create index if not exists war_room_archived_transcripts_topic_idx
  on public.war_room_archived_transcripts (topic, message_timestamp desc);

create index if not exists war_room_archived_transcripts_family_idx
  on public.war_room_archived_transcripts (family, message_timestamp desc);

alter table public.war_room_archived_transcripts enable row level security;

drop policy if exists war_room_archived_transcripts_service_role_all on public.war_room_archived_transcripts;
create policy war_room_archived_transcripts_service_role_all
  on public.war_room_archived_transcripts
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_archived_transcripts to service_role;

create table if not exists public.war_room_session_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  summary_date date not null default current_date,
  summary_kind text not null default 'archive_batch',
  summary text not null,
  key_decrees text[] not null default '{}'::text[],
  decisions text[] not null default '{}'::text[],
  opportunities_created text[] not null default '{}'::text[],
  failures_errors text[] not null default '{}'::text[],
  provider_performance_notes text[] not null default '{}'::text[],
  unfinished_tasks text[] not null default '{}'::text[],
  next_recommended_action text,
  recall_index tsvector not null default ''::tsvector,
  created_at timestamptz not null default now(),
  operator_id text,
  operator_name text,
  visibility text not null default 'private',
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_session_summaries_visibility_check check (
    visibility in ('private', 'shared', 'household')
  )
);

do $$
begin
  if to_regclass('public.war_room_session_summaries') is not null then
    if exists (
      select 1
      from pg_attribute
      where attrelid = 'public.war_room_session_summaries'::regclass
        and attname = 'recall_index'
        and attgenerated <> ''
    ) then
      alter table public.war_room_session_summaries
        drop column recall_index;
    end if;

    alter table public.war_room_session_summaries
      add column if not exists recall_index tsvector not null default ''::tsvector;
  end if;
end;
$$;

create index if not exists war_room_session_summaries_date_idx
  on public.war_room_session_summaries (summary_date, created_at desc);

create index if not exists war_room_session_summaries_session_idx
  on public.war_room_session_summaries (session_id, created_at desc);

create or replace function public.set_war_room_session_summaries_recall_index()
returns trigger
language plpgsql
as $$
begin
  new.recall_index :=
    to_tsvector(
      'english',
      coalesce(new.summary, '') || ' ' ||
      coalesce(array_to_string(new.key_decrees, ' '), '') || ' ' ||
      coalesce(array_to_string(new.decisions, ' '), '') || ' ' ||
      coalesce(array_to_string(new.opportunities_created, ' '), '') || ' ' ||
      coalesce(array_to_string(new.failures_errors, ' '), '') || ' ' ||
      coalesce(array_to_string(new.provider_performance_notes, ' '), '') || ' ' ||
      coalesce(array_to_string(new.unfinished_tasks, ' '), '')
    );
  return new;
end;
$$;

update public.war_room_session_summaries
set recall_index =
  to_tsvector(
    'english',
    coalesce(summary, '') || ' ' ||
    coalesce(array_to_string(key_decrees, ' '), '') || ' ' ||
    coalesce(array_to_string(decisions, ' '), '') || ' ' ||
    coalesce(array_to_string(opportunities_created, ' '), '') || ' ' ||
    coalesce(array_to_string(failures_errors, ' '), '') || ' ' ||
    coalesce(array_to_string(provider_performance_notes, ' '), '') || ' ' ||
    coalesce(array_to_string(unfinished_tasks, ' '), '')
  );

drop trigger if exists war_room_session_summaries_set_recall_index on public.war_room_session_summaries;
create trigger war_room_session_summaries_set_recall_index
  before insert or update of summary, key_decrees, decisions, opportunities_created, failures_errors, provider_performance_notes, unfinished_tasks
  on public.war_room_session_summaries
  for each row
  execute procedure public.set_war_room_session_summaries_recall_index();

create index if not exists war_room_session_summaries_recall_idx
  on public.war_room_session_summaries using gin (recall_index);

alter table public.war_room_session_summaries enable row level security;

drop policy if exists war_room_session_summaries_service_role_all on public.war_room_session_summaries;
create policy war_room_session_summaries_service_role_all
  on public.war_room_session_summaries
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_session_summaries to service_role;

select pg_notify('pgrst', 'reload schema');

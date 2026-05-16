-- War Room Phase 7D: Memory + Conversation Separation.
-- Live chat windowing is UI-only. These tables preserve recallable raw transcript rows and additive summaries.
-- Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

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
  importance_tier text not null default 'operational',
  importance_score numeric(4,3) not null default 0.5,
  decay_weight numeric(4,3) not null default 0.55,
  memory_tags text[] not null default '{}'::text[],
  last_recalled_at timestamptz,
  recall_count integer not null default 0,
  strategic_pinned boolean not null default false,
  mission_critical boolean not null default false,
  compressed_count integer not null default 1,
  compression_key text,
  promoted_to_strategic_at timestamptz,
  promoted_by text,
  operator_id text,
  operator_name text,
  visibility text not null default 'private',
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_archived_transcripts_importance_check check (
    importance_tier in ('trivial', 'operational', 'strategic', 'critical')
  ),
  constraint war_room_archived_transcripts_visibility_check check (
    visibility in ('private', 'shared', 'household')
  )
);

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

create index if not exists war_room_archived_transcripts_importance_idx
  on public.war_room_archived_transcripts (importance_tier, importance_score desc, message_timestamp desc);

create index if not exists war_room_archived_transcripts_compression_idx
  on public.war_room_archived_transcripts (compression_key, message_timestamp desc);

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
  importance_tier text not null default 'operational',
  importance_score numeric(4,3) not null default 0.5,
  decay_weight numeric(4,3) not null default 0.55,
  last_recalled_at timestamptz,
  recall_count integer not null default 0,
  strategic_pinned boolean not null default false,
  mission_critical boolean not null default false,
  created_at timestamptz not null default now(),
  operator_id text,
  operator_name text,
  visibility text not null default 'private',
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_session_summaries_importance_check check (
    importance_tier in ('trivial', 'operational', 'strategic', 'critical')
  ),
  constraint war_room_session_summaries_visibility_check check (
    visibility in ('private', 'shared', 'household')
  )
);

create index if not exists war_room_session_summaries_date_idx
  on public.war_room_session_summaries (summary_date, created_at desc);

create index if not exists war_room_session_summaries_session_idx
  on public.war_room_session_summaries (session_id, created_at desc);

create index if not exists war_room_session_summaries_recall_idx
  on public.war_room_session_summaries using gin (recall_index);

create index if not exists war_room_session_summaries_importance_idx
  on public.war_room_session_summaries (importance_tier, importance_score desc, created_at desc);

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

drop trigger if exists war_room_session_summaries_set_recall_index on public.war_room_session_summaries;
create trigger war_room_session_summaries_set_recall_index
  before insert or update of summary, key_decrees, decisions, opportunities_created, failures_errors, provider_performance_notes, unfinished_tasks
  on public.war_room_session_summaries
  for each row
  execute procedure public.set_war_room_session_summaries_recall_index();

alter table public.war_room_session_summaries enable row level security;

drop policy if exists war_room_session_summaries_service_role_all on public.war_room_session_summaries;
create policy war_room_session_summaries_service_role_all
  on public.war_room_session_summaries
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_session_summaries to service_role;

create table if not exists public.war_room_strategic_memories (
  id uuid primary key default gen_random_uuid(),
  source_archive_id uuid references public.war_room_archived_transcripts (id) on delete set null,
  session_id text,
  title text not null,
  content text not null,
  memory_kind text not null default 'platform_evolution',
  importance_tier text not null default 'strategic',
  importance_score numeric(4,3) not null default 0.7,
  topic text,
  tags text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  promoted_at timestamptz not null default now(),
  promoted_by text,
  pinned boolean not null default false,
  mission_critical boolean not null default false,
  decay_weight numeric(4,3) not null default 0.85,
  last_recalled_at timestamptz,
  recall_count integer not null default 0,
  operator_id text,
  operator_name text,
  visibility text not null default 'private',
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_strategic_memories_importance_check check (
    importance_tier in ('strategic', 'critical')
  ),
  constraint war_room_strategic_memories_visibility_check check (
    visibility in ('private', 'shared', 'household')
  )
);

create unique index if not exists war_room_strategic_memories_source_idx
  on public.war_room_strategic_memories (source_archive_id);

create index if not exists war_room_strategic_memories_importance_idx
  on public.war_room_strategic_memories (importance_tier, importance_score desc, promoted_at desc);

create index if not exists war_room_strategic_memories_topic_idx
  on public.war_room_strategic_memories (topic, promoted_at desc);

alter table public.war_room_strategic_memories enable row level security;

drop policy if exists war_room_strategic_memories_service_role_all on public.war_room_strategic_memories;
create policy war_room_strategic_memories_service_role_all
  on public.war_room_strategic_memories
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_strategic_memories to service_role;

select pg_notify('pgrst', 'reload schema');

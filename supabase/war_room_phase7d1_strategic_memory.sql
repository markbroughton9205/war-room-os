-- War Room Phase 7D.1: strategic memory filtering + importance metadata.
-- Additive only: existing archives remain intact; new archive writes classify/filter/compress before persistence.

grant usage on schema public to service_role;

alter table if exists public.war_room_archived_transcripts
  add column if not exists importance_tier text not null default 'operational',
  add column if not exists importance_score numeric(4,3) not null default 0.5,
  add column if not exists decay_weight numeric(4,3) not null default 0.55,
  add column if not exists memory_tags text[] not null default '{}'::text[],
  add column if not exists last_recalled_at timestamptz,
  add column if not exists recall_count integer not null default 0,
  add column if not exists strategic_pinned boolean not null default false,
  add column if not exists mission_critical boolean not null default false,
  add column if not exists compressed_count integer not null default 1,
  add column if not exists compression_key text,
  add column if not exists promoted_to_strategic_at timestamptz,
  add column if not exists promoted_by text;

do $$
begin
  if to_regclass('public.war_room_archived_transcripts') is not null then
    alter table public.war_room_archived_transcripts
      drop constraint if exists war_room_archived_transcripts_importance_check;

    alter table public.war_room_archived_transcripts
      add constraint war_room_archived_transcripts_importance_check check (
        importance_tier in ('trivial', 'operational', 'strategic', 'critical')
      );
  end if;
end;
$$;

create index if not exists war_room_archived_transcripts_importance_idx
  on public.war_room_archived_transcripts (importance_tier, importance_score desc, message_timestamp desc);

create index if not exists war_room_archived_transcripts_compression_idx
  on public.war_room_archived_transcripts (compression_key, message_timestamp desc);

alter table if exists public.war_room_session_summaries
  add column if not exists importance_tier text not null default 'operational',
  add column if not exists importance_score numeric(4,3) not null default 0.5,
  add column if not exists decay_weight numeric(4,3) not null default 0.55,
  add column if not exists last_recalled_at timestamptz,
  add column if not exists recall_count integer not null default 0,
  add column if not exists strategic_pinned boolean not null default false,
  add column if not exists mission_critical boolean not null default false;

do $$
begin
  if to_regclass('public.war_room_session_summaries') is not null then
    alter table public.war_room_session_summaries
      drop constraint if exists war_room_session_summaries_importance_check;

    alter table public.war_room_session_summaries
      add constraint war_room_session_summaries_importance_check check (
        importance_tier in ('trivial', 'operational', 'strategic', 'critical')
      );
  end if;
end;
$$;

create index if not exists war_room_session_summaries_importance_idx
  on public.war_room_session_summaries (importance_tier, importance_score desc, created_at desc);

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

drop index if exists public.war_room_strategic_memories_source_idx;
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

-- War Room Phase 6: family memory proposals + approved memories (apply after phase 4 events).
-- Service-role API pattern: RLS enabled, no anon policies.

-- ---------------------------------------------------------------------------
-- Audit: allow category `memory`
-- ---------------------------------------------------------------------------
alter table public.war_room_audit_logs drop constraint if exists war_room_audit_logs_category_check;

alter table public.war_room_audit_logs
  add constraint war_room_audit_logs_category_check check (
    category in (
      'action',
      'engine',
      'internet',
      'repo',
      'sentinel',
      'permissions',
      'event',
      'memory'
    )
  );

-- ---------------------------------------------------------------------------
-- Memory proposals (pending approval; content is redacted at ingest)
-- ---------------------------------------------------------------------------
create table if not exists public.war_room_memory_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  family_partition text not null,
  proposed_by text not null default 'user',
  title text not null,
  content_redacted text not null,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  constraint war_room_memory_proposals_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint war_room_memory_proposals_partition_check check (
    family_partition in (
      'ChatGPT Family',
      'Claude Family',
      'Grok Family',
      'Gemini Family',
      'Kimi Family',
      'Red Team',
      'Bridge Architect',
      'Baby AI Observer'
    )
  )
);

create index if not exists war_room_memory_proposals_status_created_idx
  on public.war_room_memory_proposals (status, created_at desc);

create index if not exists war_room_memory_proposals_partition_idx
  on public.war_room_memory_proposals (family_partition, created_at desc);

alter table public.war_room_memory_proposals enable row level security;

create or replace function public.touch_war_room_memory_proposals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_memory_proposals_set_updated_at on public.war_room_memory_proposals;
create trigger war_room_memory_proposals_set_updated_at
  before update on public.war_room_memory_proposals
  for each row
  execute procedure public.touch_war_room_memory_proposals_updated_at();

-- ---------------------------------------------------------------------------
-- Approved memories (immutable-ish content snapshot at approval time)
-- ---------------------------------------------------------------------------
create table if not exists public.war_room_approved_memories (
  id uuid primary key default gen_random_uuid(),
  approved_at timestamptz not null default now(),
  family_partition text not null,
  title text not null,
  content text not null,
  source_proposal_id uuid references public.war_room_memory_proposals (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_approved_memories_partition_check check (
    family_partition in (
      'ChatGPT Family',
      'Claude Family',
      'Grok Family',
      'Gemini Family',
      'Kimi Family',
      'Red Team',
      'Bridge Architect',
      'Baby AI Observer'
    )
  )
);

create index if not exists war_room_approved_memories_partition_approved_idx
  on public.war_room_approved_memories (family_partition, approved_at desc);

create index if not exists war_room_approved_memories_source_idx
  on public.war_room_approved_memories (source_proposal_id);

alter table public.war_room_approved_memories enable row level security;

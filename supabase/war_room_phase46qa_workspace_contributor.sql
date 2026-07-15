-- Phase 46Q-A Workspace Contributor Foundation
-- Additive only. Do not run until reviewed.

create table if not exists public.workspace_members (
  workspace_owner_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'workspace_contributor',
  ai_access_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_members_role_check check (role = 'workspace_contributor')
);

create or replace function public.workspace_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.workspace_prevent_created_at_update()
returns trigger
language plpgsql
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at_is_immutable';
  end if;
  return new;
end;
$$;

create table if not exists public.workspace_settings (
  workspace_owner_id uuid primary key references public.workspace_members(workspace_owner_id) on delete cascade,
  layout jsonb not null default '{}',
  widgets jsonb not null default '{}',
  theme jsonb not null default '{}',
  enabled_tools jsonb not null default '{}',
  council_preferences jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  workspace_owner_id uuid not null references public.workspace_members(workspace_owner_id) on delete cascade,
  title text not null,
  description text not null,
  category text not null,
  status text not null default 'draft',
  contributor_review_summary text null,
  commander_council_summary text null,
  commander_decision text null,
  commander_decision_reason text null,
  decided_by_user_id uuid null references auth.users(id),
  decided_at timestamptz null,
  implementation_ref text null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_proposals_category_check check (category in ('feature', 'ui', 'workflow', 'council_behavior')),
  constraint workspace_proposals_status_check check (status in ('draft', 'submitted', 'contributor_review', 'commander_council_review', 'revision_requested', 'approved', 'rejected', 'implemented', 'verified', 'closed')),
  constraint workspace_proposals_decision_consistency check (
    (
      status in ('approved', 'rejected', 'revision_requested', 'implemented', 'verified', 'closed')
      and commander_decision is not null
      and decided_by_user_id is not null
      and decided_at is not null
    )
    or
    (
      status not in ('approved', 'rejected', 'revision_requested', 'implemented', 'verified', 'closed')
      and commander_decision is null
      and decided_by_user_id is null
      and decided_at is null
    )
  ),
  constraint workspace_proposals_implementation_consistency check (
    (status in ('implemented', 'verified') and implementation_ref is not null)
    or
    (status not in ('implemented', 'verified'))
  ),
  constraint workspace_proposals_verified_consistency check (
    (status = 'verified' and verified_at is not null)
    or
    (status <> 'verified')
  ),
  constraint workspace_proposals_owner_pair_unique unique (proposal_id, workspace_owner_id)
);

create table if not exists public.workspace_proposal_events (
  event_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  workspace_owner_id uuid not null,
  event_sequence bigint not null,
  idempotency_key uuid not null,
  event_type text not null,
  from_status text null,
  to_status text not null,
  actor_user_id uuid not null references auth.users(id),
  actor_role text not null,
  reason text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint workspace_proposal_events_owner_fk foreign key (workspace_owner_id) references public.workspace_members(workspace_owner_id) on delete cascade,
  constraint workspace_proposal_events_proposal_owner_fk foreign key (proposal_id, workspace_owner_id) references public.workspace_proposals(proposal_id, workspace_owner_id) on delete cascade,
  constraint workspace_proposal_events_actor_role_check check (actor_role in ('workspace_contributor', 'commander')),
  constraint workspace_proposal_events_to_status_check check (to_status in ('draft', 'submitted', 'contributor_review', 'commander_council_review', 'revision_requested', 'approved', 'rejected', 'implemented', 'verified', 'closed')),
  constraint workspace_proposal_events_from_status_check check (from_status is null or from_status in ('draft', 'submitted', 'contributor_review', 'commander_council_review', 'revision_requested', 'approved', 'rejected', 'implemented', 'verified', 'closed')),
  constraint workspace_proposal_events_sequence_unique unique (proposal_id, event_sequence),
  constraint workspace_proposal_events_idempotency_unique unique (proposal_id, idempotency_key)
);

create table if not exists public.workspace_proposal_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  workspace_owner_id uuid not null,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  content_sha256 text not null,
  uploaded_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint workspace_proposal_attachments_owner_fk foreign key (workspace_owner_id) references public.workspace_members(workspace_owner_id) on delete cascade,
  constraint workspace_proposal_attachments_proposal_owner_fk foreign key (proposal_id, workspace_owner_id) references public.workspace_proposals(proposal_id, workspace_owner_id) on delete cascade,
  constraint workspace_proposal_attachments_mime_check check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain')),
  constraint workspace_proposal_attachments_size_check check (size_bytes > 0 and size_bytes <= 10485760),
  constraint workspace_proposal_attachments_path_check check (storage_path !~ '(^/|\\.\\.|\\\\)')
);

create index if not exists workspace_members_role_idx on public.workspace_members(role);
create index if not exists workspace_proposals_owner_idx on public.workspace_proposals(workspace_owner_id);
create index if not exists workspace_proposals_status_idx on public.workspace_proposals(status);
create index if not exists workspace_proposals_category_idx on public.workspace_proposals(category);
create index if not exists workspace_proposals_created_at_idx on public.workspace_proposals(created_at desc);
create index if not exists workspace_proposal_events_proposal_created_idx on public.workspace_proposal_events(proposal_id, event_sequence, created_at, event_id);
create index if not exists workspace_proposal_events_owner_idx on public.workspace_proposal_events(workspace_owner_id);
create index if not exists workspace_proposal_attachments_proposal_idx on public.workspace_proposal_attachments(proposal_id);
create index if not exists workspace_proposal_attachments_owner_idx on public.workspace_proposal_attachments(workspace_owner_id);
create index if not exists workspace_proposal_attachments_sha_idx on public.workspace_proposal_attachments(content_sha256);

alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_proposals enable row level security;
alter table public.workspace_proposal_events enable row level security;
alter table public.workspace_proposal_attachments enable row level security;

drop trigger if exists workspace_members_set_updated_at on public.workspace_members;
create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function public.workspace_set_updated_at();

drop trigger if exists workspace_settings_set_updated_at on public.workspace_settings;
create trigger workspace_settings_set_updated_at
before insert or update on public.workspace_settings
for each row execute function public.workspace_set_updated_at();

drop trigger if exists workspace_proposals_set_updated_at on public.workspace_proposals;
create trigger workspace_proposals_set_updated_at
before update on public.workspace_proposals
for each row execute function public.workspace_set_updated_at();

drop trigger if exists workspace_members_prevent_created_at_update on public.workspace_members;
create trigger workspace_members_prevent_created_at_update
before update on public.workspace_members
for each row execute function public.workspace_prevent_created_at_update();

drop trigger if exists workspace_proposals_prevent_created_at_update on public.workspace_proposals;
create trigger workspace_proposals_prevent_created_at_update
before update on public.workspace_proposals
for each row execute function public.workspace_prevent_created_at_update();

revoke all on public.workspace_members from anon;
revoke all on public.workspace_settings from anon;
revoke all on public.workspace_proposals from anon;
revoke all on public.workspace_proposal_events from anon;
revoke all on public.workspace_proposal_attachments from anon;

grant select on public.workspace_members to authenticated;
grant select on public.workspace_settings to authenticated;
grant select on public.workspace_proposals to authenticated;
grant select on public.workspace_proposal_events to authenticated;
grant select on public.workspace_proposal_attachments to authenticated;

grant all on public.workspace_members to service_role;
grant all on public.workspace_settings to service_role;
grant all on public.workspace_proposals to service_role;
grant all on public.workspace_proposal_events to service_role;
grant all on public.workspace_proposal_attachments to service_role;

create policy workspace_members_select_own
on public.workspace_members for select to authenticated
using (workspace_owner_id = auth.uid());

create policy workspace_settings_select_own
on public.workspace_settings for select to authenticated
using (workspace_owner_id = auth.uid());

create policy workspace_proposals_select_own
on public.workspace_proposals for select to authenticated
using (workspace_owner_id = auth.uid());

create policy workspace_events_select_own
on public.workspace_proposal_events for select to authenticated
using (workspace_owner_id = auth.uid());

create policy workspace_attachments_select_own
on public.workspace_proposal_attachments for select to authenticated
using (workspace_owner_id = auth.uid());

create or replace function public.workspace_is_valid_transition(
  p_from text,
  p_to text,
  p_actor_role text
) returns boolean
language sql
stable
as $$
  select case
    when p_actor_role = 'workspace_contributor' then
      (p_from = 'draft' and p_to = 'submitted')
      or (p_from = 'revision_requested' and p_to = 'submitted')
    when p_actor_role = 'commander' then
      (p_from = 'submitted' and p_to = 'contributor_review')
      or (p_from = 'contributor_review' and p_to = 'commander_council_review')
      or (p_from = 'commander_council_review' and p_to in ('revision_requested', 'approved', 'rejected'))
      or (p_from = 'approved' and p_to = 'implemented')
      or (p_from = 'implemented' and p_to = 'verified')
      or (p_from = 'verified' and p_to = 'closed')
      or (p_from = 'rejected' and p_to = 'closed')
    else false
  end;
$$;

create or replace function public.workspace_event_type(
  p_from text,
  p_to text,
  p_actor_role text
) returns text
language sql
stable
as $$
  select case
    when p_from is null and p_to = 'draft' then 'proposal_created'
    when p_actor_role = 'commander' and p_to in ('approved', 'rejected', 'revision_requested') then 'commander_decision'
    when p_to = 'submitted' then 'proposal_submitted'
    else 'proposal_transitioned'
  end;
$$;

create or replace function public.workspace_create_proposal(
  p_workspace_owner_id uuid,
  p_title text,
  p_description text,
  p_category text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.workspace_proposals;
  v_event public.workspace_proposal_events;
begin
  insert into public.workspace_proposals (workspace_owner_id, title, description, category, status)
  values (p_workspace_owner_id, p_title, p_description, p_category, 'draft')
  returning * into v_proposal;

  insert into public.workspace_proposal_events (
    proposal_id,
    workspace_owner_id,
    event_sequence,
    idempotency_key,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    actor_role,
    metadata
  )
  values (
    v_proposal.proposal_id,
    v_proposal.workspace_owner_id,
    1,
    gen_random_uuid(),
    'proposal_created',
    null,
    'draft',
    p_workspace_owner_id,
    'workspace_contributor',
    '{}'::jsonb
  )
  returning * into v_event;

  return jsonb_build_object('proposal', to_jsonb(v_proposal), 'event', to_jsonb(v_event));
end;
$$;

create or replace function public.workspace_transition_proposal(
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_to_status text,
  p_idempotency_key uuid,
  p_reason text default null,
  p_commander_decision text default null,
  p_commander_decision_reason text default null,
  p_implementation_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.workspace_proposals;
  v_updated public.workspace_proposals;
  v_event public.workspace_proposal_events;
  v_existing_event public.workspace_proposal_events;
  v_event_sequence bigint;
begin
  select * into v_existing
  from public.workspace_proposals
  where proposal_id = p_proposal_id
  for update;

  if not found then
    raise exception 'proposal_not_found';
  end if;

  select * into v_existing_event
  from public.workspace_proposal_events
  where proposal_id = p_proposal_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event.to_status = p_to_status
      and v_existing_event.actor_user_id = p_actor_user_id
      and v_existing_event.actor_role = p_actor_role
    then
      return jsonb_build_object('proposal', to_jsonb(v_existing), 'event', to_jsonb(v_existing_event), 'idempotentReplay', true);
    end if;
    raise exception 'idempotency_conflict';
  end if;

  if p_actor_role = 'workspace_contributor' and v_existing.workspace_owner_id <> p_actor_user_id then
    raise exception 'proposal_owner_mismatch';
  end if;

  if not public.workspace_is_valid_transition(v_existing.status, p_to_status, p_actor_role) then
    raise exception 'invalid_workspace_transition';
  end if;

  select coalesce(max(event_sequence), 0) + 1 into v_event_sequence
  from public.workspace_proposal_events
  where proposal_id = p_proposal_id;

  update public.workspace_proposals
  set
    status = p_to_status,
    updated_at = now(),
    commander_decision = case when p_actor_role = 'commander' and p_to_status in ('revision_requested', 'approved', 'rejected') then coalesce(p_commander_decision, p_to_status) else commander_decision end,
    commander_decision_reason = case when p_actor_role = 'commander' and p_to_status in ('revision_requested', 'approved', 'rejected') then p_commander_decision_reason else commander_decision_reason end,
    decided_by_user_id = case when p_actor_role = 'commander' and p_to_status in ('revision_requested', 'approved', 'rejected') then p_actor_user_id else decided_by_user_id end,
    decided_at = case when p_actor_role = 'commander' and p_to_status in ('revision_requested', 'approved', 'rejected') then now() else decided_at end,
    implementation_ref = case when p_actor_role = 'commander' and p_to_status = 'implemented' then p_implementation_ref else implementation_ref end,
    verified_at = case when p_actor_role = 'commander' and p_to_status = 'verified' then now() else verified_at end
  where proposal_id = p_proposal_id
  returning * into v_updated;

  insert into public.workspace_proposal_events (
    proposal_id,
    workspace_owner_id,
    event_sequence,
    idempotency_key,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    actor_role,
    reason,
    metadata
  )
  values (
    v_updated.proposal_id,
    v_updated.workspace_owner_id,
    v_event_sequence,
    p_idempotency_key,
    public.workspace_event_type(v_existing.status, p_to_status, p_actor_role),
    v_existing.status,
    p_to_status,
    p_actor_user_id,
    p_actor_role,
    p_reason,
    jsonb_build_object('commanderDecision', p_commander_decision, 'implementationRef', p_implementation_ref)
  )
  returning * into v_event;

  return jsonb_build_object('proposal', to_jsonb(v_updated), 'event', to_jsonb(v_event));
end;
$$;

revoke all on function public.workspace_create_proposal(uuid, text, text, text) from anon, authenticated;
revoke all on function public.workspace_transition_proposal(uuid, uuid, text, text, uuid, text, text, text, text) from anon, authenticated;
grant execute on function public.workspace_create_proposal(uuid, text, text, text) to service_role;
grant execute on function public.workspace_transition_proposal(uuid, uuid, text, text, uuid, text, text, text, text) to service_role;

comment on table public.workspace_members is 'Workspace contributor membership. Commander authority is not represented here.';
comment on table public.workspace_proposal_events is 'Append-only workspace proposal event log. Application routes must not update/delete rows.';
comment on function public.workspace_transition_proposal(uuid, uuid, text, text, uuid, text, text, text, text) is 'Atomic proposal lifecycle transition plus immutable event insertion. Idempotency key identifies the logical request; event_sequence identifies committed order.';

-- Private Supabase Storage bucket to create manually after review:
-- Bucket id: workspace-proposal-attachments
-- Public: false
-- File size limit: 10485760
-- Allowed MIME types: image/png, image/jpeg, image/webp, application/pdf, text/plain

-- Manual Jasmine bootstrap, to run only after Commander approval with Jasmine auth user UUID:
-- insert into public.workspace_members (workspace_owner_id, role, ai_access_enabled)
-- values ('<JASMINE_AUTH_USER_UUID>', 'workspace_contributor', true)
-- on conflict (workspace_owner_id) do update
-- set ai_access_enabled = excluded.ai_access_enabled, updated_at = now();

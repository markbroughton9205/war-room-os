-- War Room Phase 54A: Wave 4.2 durable real engineering evidence capture.
-- Additive, service-role only, observable evidence only. No hidden reasoning and no training RPC.
grant usage on schema public to service_role;

create table if not exists public.war_room_engineering_missions (
  id text primary key, project_id uuid references public.war_room_projects(id) on delete set null,
  conversation_id uuid references public.war_room_conversations(id) on delete set null,
  prompt_artifact_id uuid references public.war_room_prompt_artifacts(id) on delete set null,
  initiated_by text not null check (initiated_by in ('commander','code_operator')), executor text not null,
  repo_path text not null, worktree_path text not null, branch text not null, base_commit text not null,
  started_at timestamptz not null, completed_at timestamptz,
  terminal_status text not null check (terminal_status in ('completed_verified','completed_unverified','failed_verification','failed_execution','cancelled','blocked','awaiting_review')),
  objective text not null, capability_tags text[] not null default '{}', curriculum_tags text[] not null default '{}',
  source_task_lineage_id text not null, patch_lineage_id text not null, audit_event_ids text[] not null default '{}',
  audit_segment text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  constraint war_room_engineering_mission_terminal_check check ((terminal_status in ('awaiting_review','blocked') and completed_at is null) or (terminal_status not in ('awaiting_review','blocked') and completed_at is not null))
);
create index if not exists war_room_engineering_missions_lineage_idx on public.war_room_engineering_missions(source_task_lineage_id, patch_lineage_id);

create table if not exists public.war_room_engineering_artifacts (
  id text primary key, mission_id text not null references public.war_room_engineering_missions(id) on delete cascade,
  artifact_kind text not null, path_ref text not null, media_type text not null, size_bytes bigint not null check(size_bytes >= 0),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), secret_scan_passed boolean not null,
  hidden_cot_scan_passed boolean not null, created_at timestamptz not null
);
create index if not exists war_room_engineering_artifacts_mission_idx on public.war_room_engineering_artifacts(mission_id);

create table if not exists public.war_room_engineering_actions (
  id text primary key, mission_id text not null references public.war_room_engineering_missions(id) on delete cascade,
  action_type text not null, executor text not null, started_at timestamptz not null, completed_at timestamptz not null,
  description text not null, command_description text, exit_code integer, stdout_artifact_id text references public.war_room_engineering_artifacts(id),
  stderr_artifact_id text references public.war_room_engineering_artifacts(id), input_artifact_ids text[] not null default '{}', output_artifact_ids text[] not null default '{}',
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), result_status text not null check(result_status in ('passed','failed')),
  validator_type text, metadata jsonb not null default '{}'
);
create index if not exists war_room_engineering_actions_mission_idx on public.war_room_engineering_actions(mission_id, started_at);

create table if not exists public.war_room_engineering_validators (
  id text primary key, mission_id text not null references public.war_room_engineering_missions(id) on delete cascade,
  action_id text not null references public.war_room_engineering_actions(id) on delete cascade,
  validator_type text not null, passed boolean not null, exit_code integer not null, artifact_ids text[] not null,
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'), observed_at timestamptz not null
);
create index if not exists war_room_engineering_validators_mission_idx on public.war_room_engineering_validators(mission_id, passed);

alter table public.war_room_agi_experience_records
  add column if not exists engineering_mission_id text references public.war_room_engineering_missions(id) on delete set null,
  add column if not exists engineering_action_ids text[] not null default '{}',
  add column if not exists engineering_validator_ids text[] not null default '{}',
  add column if not exists engineering_artifact_ids text[] not null default '{}',
  add column if not exists capability_tags text[] not null default '{}',
  add column if not exists curriculum_tags text[] not null default '{}';

do $$ declare table_name text; begin
  foreach table_name in array array['war_room_engineering_missions','war_room_engineering_artifacts','war_room_engineering_actions','war_room_engineering_validators'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;
select pg_notify('pgrst', 'reload schema');

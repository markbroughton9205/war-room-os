-- War Room Phase 53A: AGI Wave 4 training-dataset and checkpoint improvement manifests.
-- Additive and service-role only. These tables cannot start training or execute promotion.
grant usage on schema public to service_role;

create table if not exists public.war_room_training_dataset_manifests (
  id text primary key,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  policy_version text not null check (policy_version = 'wave4-v1'),
  parent_candidate_manifest_ids text[] not null,
  dataset_hash text not null unique check (dataset_hash ~ '^[a-f0-9]{64}$'),
  records jsonb not null check (jsonb_typeof(records) = 'array'),
  exclusions jsonb not null default '[]' check (jsonb_typeof(exclusions) = 'array'),
  split_counts jsonb not null,
  immutable boolean not null default true check (immutable is true),
  training_started boolean not null default false check (training_started is false),
  created_at timestamptz not null
);

create table if not exists public.war_room_checkpoint_candidates (
  id text primary key,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  model_id text not null check (model_id = 'WRIM-1-candidate'),
  parent_checkpoint_id text not null check (parent_checkpoint_id like 'WRIM-0:%'),
  parent_checkpoint_hash text not null check (parent_checkpoint_hash ~ '^[a-f0-9]{64}$'),
  dataset_manifest_id text not null references public.war_room_training_dataset_manifests (id),
  dataset_hash text not null check (dataset_hash ~ '^[a-f0-9]{64}$'),
  tokenizer_artifact_hash text not null check (tokenizer_artifact_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('registered','evaluated','rejected','recommended')),
  rollback_checkpoint_id text not null,
  training_started boolean not null default false check (training_started is false),
  created_at timestamptz not null,
  constraint war_room_checkpoint_rollback_parent_check check (rollback_checkpoint_id = parent_checkpoint_id)
);

create table if not exists public.war_room_checkpoint_eval_manifests (
  id text primary key,
  checkpoint_candidate_id text not null references public.war_room_checkpoint_candidates (id),
  benchmark_refs text[] not null check (cardinality(benchmark_refs) > 0),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'array' and jsonb_array_length(metrics) > 0),
  content_hash text not null unique check (content_hash ~ '^[a-f0-9]{64}$'),
  recommendation text not null check (recommendation in ('recommend','reject')),
  recommendation_reasons text[] not null default '{}',
  commander_authorization text not null default 'not_requested' check (commander_authorization = 'not_requested'),
  promotion_executed boolean not null default false check (promotion_executed is false),
  created_at timestamptz not null default now()
);

create or replace function public.war_room_phase53a_reject_immutable_update()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  raise exception 'Wave 4 lineage manifests are immutable; create a new version';
end $$;
revoke all on function public.war_room_phase53a_reject_immutable_update() from public, anon, authenticated;
grant execute on function public.war_room_phase53a_reject_immutable_update() to service_role;

drop trigger if exists war_room_training_dataset_manifests_immutable on public.war_room_training_dataset_manifests;
create trigger war_room_training_dataset_manifests_immutable before update or delete on public.war_room_training_dataset_manifests
for each row execute function public.war_room_phase53a_reject_immutable_update();
drop trigger if exists war_room_checkpoint_candidates_immutable on public.war_room_checkpoint_candidates;
create trigger war_room_checkpoint_candidates_immutable before update or delete on public.war_room_checkpoint_candidates
for each row execute function public.war_room_phase53a_reject_immutable_update();
drop trigger if exists war_room_checkpoint_eval_manifests_immutable on public.war_room_checkpoint_eval_manifests;
create trigger war_room_checkpoint_eval_manifests_immutable before update or delete on public.war_room_checkpoint_eval_manifests
for each row execute function public.war_room_phase53a_reject_immutable_update();

do $$ declare table_name text; begin
  foreach table_name in array array['war_room_training_dataset_manifests','war_room_checkpoint_candidates','war_room_checkpoint_eval_manifests'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');

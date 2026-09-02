-- War Room Phase 55A: Wave 5 continuous evidence, capability metrics, and immutable lineage.
-- Additive, service-role only, observable outcomes only. No training or promotion functions.
grant usage on schema public to service_role;

create table if not exists public.war_room_continuous_evidence (
  id text primary key, evidence_kind text not null, source_type text not null,
  subject_ref text not null, outcome text not null check (outcome in ('pass','fail','inconclusive','corrected')),
  observed_at timestamptz not null, valid_until timestamptz, provenance_refs text[] not null,
  source_lineage_ids text[] not null, capability_tags text[] not null, curriculum_tags text[] not null default '{}',
  validator_types text[] not null, verifier_id text not null, evaluator_id text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'), quality_metrics jsonb not null,
  retry_of_evidence_id text references public.war_room_continuous_evidence(id) on delete set null,
  metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  constraint war_room_continuous_evidence_identity_check check (verifier_id <> evaluator_id),
  constraint war_room_continuous_evidence_provenance_check check (cardinality(provenance_refs) > 0 and cardinality(source_lineage_ids) > 0)
);
create unique index if not exists war_room_continuous_evidence_hash_idx on public.war_room_continuous_evidence(content_hash);
create index if not exists war_room_continuous_evidence_lineage_idx on public.war_room_continuous_evidence using gin(source_lineage_ids);

create table if not exists public.war_room_capability_evidence_metrics (
  capability_key text primary key, successes integer not null check(successes >= 0), failures integer not null check(failures >= 0),
  validator_types text[] not null, distinct_mission_lineages integer not null check(distinct_mission_lineages >= 0),
  last_observed_at timestamptz, held_out_passes integer not null default 0, held_out_failures integer not null default 0,
  evidence_density integer not null check(evidence_density >= 0), average_evidence_quality double precision not null check(average_evidence_quality between 0 and 1),
  confidence double precision not null check(confidence between 0 and 1), strength text not null check(strength in ('unobserved','isolated','emerging','repeated')),
  evidence_ids text[] not null, updated_at timestamptz not null default now()
);

alter table public.war_room_training_dataset_manifests
  add column if not exists predecessor_manifest_id text references public.war_room_training_dataset_manifests(id) on delete restrict,
  add column if not exists predecessor_manifest_hash text,
  add column if not exists added_evidence_ids text[] not null default '{}',
  add column if not exists removed_evidence_ids text[] not null default '{}',
  add column if not exists rejected_evidence jsonb not null default '[]',
  add column if not exists lineage_groups jsonb not null default '{}',
  add column if not exists capability_distribution jsonb not null default '{}',
  add column if not exists evidence_quality jsonb not null default '{}',
  add column if not exists held_out_isolation_proof jsonb not null default '{}';

alter table public.war_room_training_dataset_manifests
  alter column created_at set default now();

alter table public.war_room_training_dataset_manifests
  drop constraint if exists war_room_training_dataset_manifests_policy_version_check;
alter table public.war_room_training_dataset_manifests
  add constraint war_room_training_dataset_manifests_policy_version_check
  check (policy_version in ('wave4-v1', 'wave5-real-v1'));

do $$ declare table_name text; begin
  foreach table_name in array array['war_room_continuous_evidence','war_room_capability_evidence_metrics'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;
select pg_notify('pgrst', 'reload schema');

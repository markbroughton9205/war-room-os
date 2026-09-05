-- War Room Phase 52A: AGI Wave 3 — active learning and curriculum intelligence.
-- Additive only. These records store observable actions/outcomes and provenance references;
-- never prompts' hidden reasoning or chain-of-thought. Eligibility and Commander authorization
-- are separate, and no database RPC or application path in Wave 3 starts model training.

grant usage on schema public to service_role;

create table if not exists public.war_room_study_missions (
  id text primary key,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  gap_id uuid not null references public.war_room_knowledge_gaps (id) on delete cascade,
  objective text not null,
  questions text[] not null default '{}',
  mission_kind text not null,
  generator_id text not null,
  verifier_id text not null,
  evaluator_id text not null,
  status text not null default 'planned',
  evidence_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_study_missions_kind_check check (mission_kind in ('research', 'targeted_verification', 'code_skill')),
  constraint war_room_study_missions_status_check check (status in ('planned', 'running', 'completed', 'blocked')),
  constraint war_room_study_missions_role_separation_check check (
    generator_id <> verifier_id and generator_id <> evaluator_id and verifier_id <> evaluator_id
  )
);
create index if not exists war_room_study_missions_scope_idx on public.war_room_study_missions (project_id, user_id, status, created_at desc);
create unique index if not exists war_room_study_missions_open_gap_idx on public.war_room_study_missions (gap_id) where status in ('planned', 'running');

create table if not exists public.war_room_learning_evidence (
  id text primary key,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  evidence_kind text not null,
  subject_ref text not null,
  outcome text not null,
  observed_at timestamptz not null,
  valid_until timestamptz,
  provenance_refs text[] not null default '{}',
  verifier_id text,
  evaluator_id text,
  poisoned boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint war_room_learning_evidence_kind_check check (evidence_kind in ('research_result','verification','evaluation','code_operator_result','commander_correction','failure','terra_observation','prediction_outcome')),
  constraint war_room_learning_evidence_outcome_check check (outcome in ('pass','fail','inconclusive','corrected')),
  constraint war_room_learning_evidence_time_check check (valid_until is null or valid_until > observed_at),
  constraint war_room_terra_evidence_time_check check (evidence_kind <> 'terra_observation' or valid_until is not null)
);
create index if not exists war_room_learning_evidence_scope_idx on public.war_room_learning_evidence (project_id, user_id, evidence_kind, observed_at desc);
create index if not exists war_room_learning_evidence_subject_idx on public.war_room_learning_evidence (subject_ref, observed_at desc);

create table if not exists public.war_room_capability_nodes (
  id text primary key,
  capability_key text not null,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  level numeric(4,3) not null default 0,
  confidence numeric(4,3) not null default 0,
  pass_count integer not null default 0,
  fail_count integer not null default 0,
  evidence_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint war_room_capability_nodes_bounds_check check (level between 0 and 1 and confidence between 0 and 1),
  constraint war_room_capability_nodes_evidence_check check ((pass_count + fail_count = 0 and cardinality(evidence_ids) = 0) or cardinality(evidence_ids) > 0)
);
create unique index if not exists war_room_capability_nodes_scope_key_idx
  on public.war_room_capability_nodes (capability_key, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.war_room_prediction_records (
  id text primary key,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  statement text not null,
  predicted_at timestamptz not null,
  verify_after timestamptz not null,
  valid_until timestamptz,
  provenance_refs text[] not null default '{}',
  status text not null default 'pending',
  verification_evidence_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint war_room_prediction_records_status_check check (status in ('pending','verified','falsified','expired')),
  constraint war_room_prediction_records_time_check check (verify_after >= predicted_at and (valid_until is null or valid_until > predicted_at))
);
create index if not exists war_room_prediction_records_due_idx on public.war_room_prediction_records (project_id, user_id, status, verify_after);

create table if not exists public.war_room_training_candidate_manifests (
  id text primary key,
  project_id uuid references public.war_room_projects (id) on delete cascade,
  user_id uuid,
  policy_version text not null,
  model_lineage text not null default 'wrim-1-candidate',
  eligibility_state text not null default 'not_eligible',
  authorization_state text not null default 'not_requested',
  training_state text not null default 'not_started',
  training_authorized boolean not null default false,
  commander_authorized_by text,
  commander_authorized_at timestamptz,
  candidate_refs jsonb not null default '[]',
  exclusions jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint war_room_training_candidate_lineage_check check (model_lineage = 'wrim-1-candidate'),
  constraint war_room_training_candidate_eligibility_check check (eligibility_state in ('not_eligible','eligible')),
  constraint war_room_training_candidate_authorization_check check (authorization_state in ('not_requested','awaiting_commander_authorization','authorized')),
  constraint war_room_training_candidate_training_state_check check (training_state in ('not_started','training','completed','failed')),
  constraint war_room_training_candidate_candidate_array_check check (jsonb_typeof(candidate_refs) = 'array'),
  constraint war_room_training_candidate_provenance_check check (
    eligibility_state = 'not_eligible' or (
      jsonb_array_length(candidate_refs) > 0
      and not jsonb_path_exists(candidate_refs, '$[*] ? (!exists(@.provenanceRefs) || @.provenanceRefs.size() == 0 || !exists(@.evidenceIds) || @.evidenceIds.size() < 2)')
    )
  ),
  constraint war_room_training_candidate_authorization_gate_check check (
    (authorization_state = 'not_requested' and training_authorized is false and commander_authorized_by is null and commander_authorized_at is null)
    or (authorization_state = 'awaiting_commander_authorization' and eligibility_state = 'eligible' and training_authorized is false and commander_authorized_by is null and commander_authorized_at is null)
    or (authorization_state = 'authorized' and eligibility_state = 'eligible' and training_authorized is true and commander_authorized_by is not null and commander_authorized_at is not null)
  ),
  constraint war_room_training_candidate_start_gate_check check (
    training_state = 'not_started'
    or (eligibility_state = 'eligible' and authorization_state = 'authorized' and training_authorized is true)
  )
);
create index if not exists war_room_training_candidate_scope_idx on public.war_room_training_candidate_manifests (project_id, user_id, created_at desc);

do $$ declare table_name text; begin
  foreach table_name in array array['war_room_study_missions','war_room_learning_evidence','war_room_capability_nodes','war_room_prediction_records','war_room_training_candidate_manifests'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', table_name || '_service_role_all', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');

-- War Room Phase 51F: AGI Wave 2 — additive expansion of ContextSnapshot/ExperienceRecord/
-- FailureRecord for context traceability, latency measurement, World Learning references, and
-- Terra/Code Operator forward-compatibility hooks. All additive; no existing column altered.

alter table public.war_room_context_snapshots
  add column if not exists retrieval_strategy_version text not null default 'v2-fts-structured';

alter table public.war_room_agi_experience_records
  add column if not exists latency_metadata jsonb not null default '{}'::jsonb,
  add column if not exists learning_session_id uuid references public.war_room_learning_sessions (id) on delete set null,
  add column if not exists source_record_id uuid references public.war_room_source_records (id) on delete set null,
  add column if not exists world_knowledge_record_id uuid references public.war_room_world_knowledge_records (id) on delete set null,
  add column if not exists retrieval_ids jsonb not null default '[]'::jsonb,
  add column if not exists terra_observation_ref jsonb not null default '{}'::jsonb,
  add column if not exists code_operator_ref jsonb not null default '{}'::jsonb;

-- failure_kind check constraint must be dropped and recreated to add the Wave 2 failure kinds —
-- Postgres has no "alter constraint to add an enum value" for a plain CHECK constraint.
alter table public.war_room_failure_records drop constraint if exists war_room_failure_records_kind_check;
alter table public.war_room_failure_records add constraint war_room_failure_records_kind_check check (
  failure_kind in (
    'commander_rejection', 'commander_correction', 'provider_error', 'validation_failure',
    'retrieval_failure', 'knowledge_gap', 'source_failure', 'parse_failure',
    'claim_extraction_failure', 'verification_failure', 'contradiction_unresolved',
    'stale_knowledge', 'context_overflow', 'context_misranking', 'unsupported_claim',
    'citation_mismatch'
  )
);

select pg_notify('pgrst', 'reload schema');

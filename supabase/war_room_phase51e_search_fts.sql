-- War Room Phase 51E: AGI Wave 2 — additive FTS (tsvector generated columns + GIN indexes) for
-- conversation/memory/open-loop/prompt-artifact search. No existing pgvector/trigram
-- infrastructure was found anywhere in this repo (checked supabase/*.sql and lib/** before
-- writing this) — Postgres full-text search is used instead, matching the brief's explicit
-- instruction not to introduce a vector dependency for Wave 2.

alter table public.war_room_messages
  add column if not exists fts tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored;
create index if not exists war_room_messages_fts_idx on public.war_room_messages using gin (fts);

alter table public.war_room_memory_records
  add column if not exists fts tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored;
create index if not exists war_room_memory_records_fts_idx on public.war_room_memory_records using gin (fts);

alter table public.war_room_open_loops
  add column if not exists fts tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;
create index if not exists war_room_open_loops_fts_idx on public.war_room_open_loops using gin (fts);

alter table public.war_room_prompt_artifacts
  add column if not exists fts tsvector generated always as (to_tsvector('english', coalesce(prompt_text, ''))) stored;
create index if not exists war_room_prompt_artifacts_fts_idx on public.war_room_prompt_artifacts using gin (fts);

-- World Learning tables (Phase 51a-d) got plain functional GIN indexes at creation time; Supabase
-- JS's .textSearch() helper requires an actual column (not an arbitrary expression) to build a
-- @@ websearch_to_tsquery(...) filter through PostgREST, so a generated `fts` column is added
-- here too, consolidating all searchable-column definitions in this one migration.
alter table public.war_room_world_knowledge_records
  add column if not exists fts tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored;
create index if not exists war_room_world_knowledge_records_fts_idx on public.war_room_world_knowledge_records using gin (fts);

alter table public.war_room_source_records
  add column if not exists fts tsvector generated always as (to_tsvector('english', coalesce(title, ''))) stored;
create index if not exists war_room_source_records_fts_idx on public.war_room_source_records using gin (fts);

alter table public.war_room_claim_records
  add column if not exists fts tsvector generated always as (to_tsvector('english', normalized_claim_text)) stored;
create index if not exists war_room_claim_records_fts_idx on public.war_room_claim_records using gin (fts);

alter table public.war_room_entity_records
  add column if not exists fts tsvector generated always as (
    to_tsvector('english', coalesce(label, '') || ' ' || coalesce(description, ''))
  ) stored;
create index if not exists war_room_entity_records_fts_idx on public.war_room_entity_records using gin (fts);

select pg_notify('pgrst', 'reload schema');

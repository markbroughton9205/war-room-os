-- Phase 32: Persistent conversational council runtime (additive; idempotent).

alter table public.war_room_council_thread_state
  add column if not exists conversation_runtime jsonb not null default '{}'::jsonb;

comment on column public.war_room_council_thread_state.conversation_runtime is
  'Phase 32 council conversation runtime: topic, provider states, rolling summary, turn metadata.';

select pg_notify('pgrst', 'reload schema');

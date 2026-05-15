-- =============================================================================
-- War Room — repair grants + RLS for public.war_room_audit_logs (PostgREST 403)
-- =============================================================================
-- Prerequisite: table must already exist (e.g. supabase/war_room_production_init.sql).
-- Symptom: service_role inserts to war_room_audit_logs fail with 403.
-- Safe to re-run: DROP POLICY IF EXISTS + CREATE; GRANT is idempotent.
-- =============================================================================

alter table public.war_room_audit_logs enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.war_room_audit_logs to service_role;

drop policy if exists war_room_audit_logs_service_role_all on public.war_room_audit_logs;

create policy war_room_audit_logs_service_role_all
  on public.war_room_audit_logs
  for all
  to service_role
  using (true)
  with check (true);

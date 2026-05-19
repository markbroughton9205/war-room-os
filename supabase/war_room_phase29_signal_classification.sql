-- Phase 29: Intelligence classification layer (additive).
-- Raw evidence remains in metadata (rawHeadline, rawSummary).

alter table public.war_room_signal_results
  add column if not exists intelligence_category text,
  add column if not exists operational_class text,
  add column if not exists intelligence_severity text,
  add column if not exists classification_confidence numeric;

alter table public.war_room_signal_results
  drop constraint if exists war_room_signal_results_operational_class_check;

alter table public.war_room_signal_results
  add constraint war_room_signal_results_operational_class_check check (
    operational_class is null
    or operational_class in ('ACTIONABLE', 'WATCHLIST', 'ARCHIVAL', 'CONFLICTED')
  );

alter table public.war_room_signal_results
  drop constraint if exists war_room_signal_results_intelligence_severity_check;

alter table public.war_room_signal_results
  add constraint war_room_signal_results_intelligence_severity_check check (
    intelligence_severity is null
    or intelligence_severity in ('low', 'moderate', 'elevated', 'critical')
  );

create index if not exists war_room_signal_results_operational_class_idx
  on public.war_room_signal_results (operational_class, highest_leverage_score desc);

select pg_notify('pgrst', 'reload schema');

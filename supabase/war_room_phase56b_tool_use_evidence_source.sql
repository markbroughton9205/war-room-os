-- War Room Phase 56B: Wave 6 semantic correction — first-class tool_use evidence source.
-- Additive only. Does not rewrite historical rows. Not applied to production.
grant usage on schema public to service_role;

alter table public.war_room_learning_evidence
  drop constraint if exists war_room_learning_evidence_kind_check;
alter table public.war_room_learning_evidence
  add constraint war_room_learning_evidence_kind_check
  check (evidence_kind in (
    'research_result','verification','evaluation','code_operator_result','commander_correction',
    'failure','terra_observation','prediction_outcome','tool_use_result'
  ));

alter table public.war_room_agi_gym_runs
  add column if not exists objective_evaluated boolean not null default true;
alter table public.war_room_agi_gym_runs
  add column if not exists objective_satisfied boolean not null default false;
alter table public.war_room_agi_gym_runs
  add column if not exists claim_status text;
alter table public.war_room_agi_gym_runs
  drop constraint if exists war_room_agi_gym_runs_claim_status_check;
alter table public.war_room_agi_gym_runs
  add constraint war_room_agi_gym_runs_claim_status_check
  check (claim_status is null or claim_status in ('observed','candidate','supported','contested','verified','superseded','retracted'));

select pg_notify('pgrst', 'reload schema');

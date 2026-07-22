-- War Room Phase 48-OPS-A Batch 2
-- Adds 'deferred' and 'archived' to the war_room_actions status lifecycle.
--
-- Context: Batch 2 introduces POST /api/actions/defer and POST /api/actions/archive,
-- which transition a war_room_actions row's status to 'deferred' or 'archived'
-- respectively. Neither status was previously permitted by
-- war_room_actions_status_check, so those routes fail every call with a
-- Postgres check-constraint violation until this migration is applied.
--
-- Scope: this migration touches ONLY the war_room_actions_status_check
-- constraint. It changes no other constraint, table, policy, grant, trigger,
-- function, or row data. It preserves every previously-allowed status value —
-- it only appends 'deferred' and 'archived' to the allow-list.
--
-- Idempotency: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT is safe to re-run;
-- re-running this file after it has already been applied is a no-op change
-- (same constraint definition re-added).
--
-- Build artifact only until reviewed and explicitly approved for Production.
-- Not executed as part of this repair pass — apply manually, then run
-- select pg_notify('pgrst', 'reload schema'); to reload PostgREST.

begin;

alter table public.war_room_actions
  drop constraint if exists war_room_actions_status_check;

alter table public.war_room_actions
  add constraint war_room_actions_status_check check (
    status in (
      'requested',
      'planned',
      'routed',
      'waiting_approval',
      'approved',
      'executing',
      'qa_check',
      'completed',
      'failed',
      'rollback_available',
      'rolled_back',
      'deferred',
      'archived'
    )
  );

commit;

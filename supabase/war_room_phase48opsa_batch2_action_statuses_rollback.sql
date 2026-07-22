-- War Room Phase 48-OPS-A Batch 2 — ROLLBACK
-- Reverts war_room_actions_status_check to its pre-Batch-2 definition,
-- removing 'deferred' and 'archived' from the allowed status list.
--
-- WARNING: this rollback does NOT modify any row. If any war_room_actions
-- row currently has status = 'deferred' or status = 'archived', the
-- ADD CONSTRAINT below will FAIL with a check-constraint violation, because
-- Postgres validates existing rows against a newly added CHECK constraint by
-- default. That failure is intentional and expected — it is the system
-- refusing to silently strand rows in a status the schema no longer permits.
--
-- Before running this rollback, first decide how to handle any existing
-- 'deferred' / 'archived' rows (e.g. manually transition them to another
-- status such as 'failed' or 'rollback_available'), or accept that this
-- rollback cannot be applied until they are handled. This file makes no such
-- decision on your behalf and performs no row updates.
--
-- Scope: touches ONLY war_room_actions_status_check. No other constraint,
-- table, policy, grant, trigger, function, or row data is changed.
--
-- Not executed as part of this repair pass.

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
      'rolled_back'
    )
  );

commit;

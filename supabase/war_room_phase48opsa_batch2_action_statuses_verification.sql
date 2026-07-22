-- War Room Phase 48-OPS-A Batch 2 verification.
-- Read-only. Reports the current war_room_actions_status_check definition,
-- whether 'deferred' / 'archived' are currently permitted, and whether any
-- rows currently use those statuses. Makes no schema or data changes.

with constraint_def as (
  select
    conname,
    pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.war_room_actions'::regclass
    and conname = 'war_room_actions_status_check'
),
permitted as (
  select
    definition,
    definition ilike '%''deferred''%' as deferred_permitted,
    definition ilike '%''archived''%' as archived_permitted
  from constraint_def
),
row_usage as (
  select
    count(*) filter (where status = 'deferred') as deferred_row_count,
    count(*) filter (where status = 'archived') as archived_row_count
  from public.war_room_actions
)
select
  p.definition as current_constraint_definition,
  p.deferred_permitted,
  p.archived_permitted,
  r.deferred_row_count,
  r.archived_row_count
from permitted p
cross join row_usage r;

-- If this query returns zero rows, war_room_actions_status_check does not
-- exist under the expected name — check for a renamed or missing constraint
-- before assuming the forward migration applied cleanly.

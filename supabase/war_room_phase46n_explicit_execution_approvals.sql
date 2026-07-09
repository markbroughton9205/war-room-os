-- Phase 46N: Approval Authority
--
-- Standalone ExplicitExecutionApproval issuer/store. Deliberately its own
-- table, not an extension of auto_mode_single_use_ledger: that table's
-- action_type/target_system columns were built for exactly one action type
-- (mark_apple_reminder_read / apple_reminders), and 46N's whole point is to
-- be action-type-agnostic. See docs/architecture (46N doc, once written) for
-- the full design rationale.
--
-- This table answers "is this action authorized to begin?" only. It has no
-- knowledge of packets, receipts, or Apple Reminders, and no foreign key to
-- auto_mode_single_use_ledger -- that table separately answers "what
-- actually happened after authorization?" and links back to an approval
-- only via its own explicit_execution_approval_id text column.

create table if not exists public.explicit_execution_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_pattern text not null default 'ExplicitExecutionApproval',
  exact_approved_text text not null,
  commander_input text not null,
  approved_by text not null,
  action_type text not null,
  target_system text not null,
  target_id text not null,
  single_use boolean not null default true,
  nonce text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  status text not null default 'active',

  constraint explicit_execution_approvals_status_check check (
    status in ('active', 'expired', 'consumed', 'revoked')
  ),

  -- Claim-matches-reality at the database level: status and its
  -- corresponding timestamp can never disagree, no matter what writes it.
  -- Every state transition through issue()/consumeIfValid()/revoke() already
  -- sets status and its timestamp together, so this should never actually
  -- fire in normal operation -- it exists to fail loudly if a future code
  -- path or a manual dashboard edit ever tries to desync them. Each branch
  -- also asserts the OTHER timestamp stays null, so 'consumed' and 'revoked'
  -- are mutually exclusive at the database level, not just by convention --
  -- a row can never claim to be both.
  constraint approval_lifecycle_consistency check (
    (status = 'active'   and consumed_at is null     and revoked_at is null) or
    (status = 'expired'  and consumed_at is null     and revoked_at is null) or
    (status = 'consumed' and consumed_at is not null and revoked_at is null) or
    (status = 'revoked'  and revoked_at is not null  and consumed_at is null)
  )
);

create index if not exists explicit_execution_approvals_status_idx
  on public.explicit_execution_approvals (status);

create index if not exists explicit_execution_approvals_target_idx
  on public.explicit_execution_approvals (action_type, target_system, target_id);

create index if not exists explicit_execution_approvals_created_at_idx
  on public.explicit_execution_approvals (created_at desc);

alter table public.explicit_execution_approvals enable row level security;

-- War Room API routes use SUPABASE_SERVICE_ROLE_KEY (server-only).
-- Service role bypasses RLS; no anon policies are required.

create or replace function public.touch_explicit_execution_approvals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists explicit_execution_approvals_set_updated_at on public.explicit_execution_approvals;

create trigger explicit_execution_approvals_set_updated_at
  before update on public.explicit_execution_approvals
  for each row
  execute procedure public.touch_explicit_execution_approvals_updated_at();

select pg_notify('pgrst', 'reload schema');

-- War Room payments/deposit notification persistence.
-- Server routes use SUPABASE_SERVICE_ROLE_KEY. No bank credentials, passwords,
-- debit/card data, or outbound money movement records belong in these tables.

create table if not exists public.war_room_deposits (
  deposit_id text primary key,
  opportunity_id text,
  income_worker_id text,
  provider text not null default 'manual_proof',
  payer_name text not null default 'Unknown platform',
  expected_amount numeric,
  confirmed_amount numeric,
  currency text not null default 'USD',
  expected_date timestamptz,
  confirmed_date timestamptz,
  proof_required boolean not null default true,
  proof_status text not null default 'required',
  deposit_status text not null default 'pending_proof',
  notification_status text not null default 'not_sent',
  risk_status text not null default 'clear',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_deposits_proof_status_check check (
    proof_status in ('not_required', 'required', 'submitted', 'verified', 'rejected')
  ),
  constraint war_room_deposits_deposit_status_check check (
    deposit_status in ('expected', 'pending_proof', 'proof_submitted', 'awaiting_confirmation', 'confirmed', 'notified', 'disputed', 'failed', 'rejected')
  ),
  constraint war_room_deposits_notification_status_check check (
    notification_status in ('not_sent', 'queued', 'sent', 'failed')
  ),
  constraint war_room_deposits_risk_status_check check (
    risk_status in ('clear', 'review', 'blocked')
  )
);

create table if not exists public.war_room_deposit_proofs (
  id uuid primary key default gen_random_uuid(),
  deposit_id text not null references public.war_room_deposits (deposit_id) on delete cascade,
  proof_url text,
  proof_metadata jsonb not null default '{}'::jsonb,
  proof_status text not null default 'submitted',
  created_at timestamptz not null default now(),
  constraint war_room_deposit_proofs_status_check check (
    proof_status in ('submitted', 'verified', 'rejected')
  )
);

create table if not exists public.war_room_deposit_notifications (
  id uuid primary key default gen_random_uuid(),
  deposit_id text not null references public.war_room_deposits (deposit_id) on delete cascade,
  notification_status text not null,
  message text,
  created_at timestamptz not null default now(),
  constraint war_room_deposit_notifications_status_check check (
    notification_status in ('queued', 'sent', 'failed')
  )
);

create table if not exists public.war_room_payment_guard_findings (
  id text primary key,
  deposit_id text references public.war_room_deposits (deposit_id) on delete set null,
  severity text not null,
  kind text not null,
  message text not null,
  blocks_confirmation boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint war_room_payment_guard_findings_severity_check check (
    severity in ('info', 'warn', 'error', 'critical')
  )
);

create index if not exists war_room_deposits_status_idx on public.war_room_deposits (deposit_status);
create index if not exists war_room_deposits_opportunity_idx on public.war_room_deposits (opportunity_id);
create index if not exists war_room_deposit_proofs_deposit_idx on public.war_room_deposit_proofs (deposit_id, created_at desc);
create index if not exists war_room_deposit_notifications_deposit_idx on public.war_room_deposit_notifications (deposit_id, created_at desc);
create index if not exists war_room_payment_guard_deposit_idx on public.war_room_payment_guard_findings (deposit_id);

alter table public.war_room_deposits enable row level security;
alter table public.war_room_deposit_proofs enable row level security;
alter table public.war_room_deposit_notifications enable row level security;
alter table public.war_room_payment_guard_findings enable row level security;

-- Server-only API routes use service role. Do not add broad anon policies.

create or replace function public.touch_war_room_deposits_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_deposits_set_updated_at on public.war_room_deposits;
create trigger war_room_deposits_set_updated_at
  before update on public.war_room_deposits
  for each row
  execute procedure public.touch_war_room_deposits_updated_at();

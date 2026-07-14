-- Invite-Gated Signup for War Room OS
--
-- This migration creates the server-only invitation ledger for War Room
-- signup. It stores only keyed token hashes, never raw invitation tokens.
-- Lifecycle:
--   pending -> claimed -> account_created -> confirmed
-- Terminal failure states:
--   expired, revoked
--
-- Access model:
--   RLS enabled.
--   No anon policies.
--   No authenticated direct table access.
--   Server-side War Room routes/scripts use service_role only.

create table if not exists public.signup_invitations (
  invitation_id uuid primary key default gen_random_uuid(),
  normalized_email text not null,
  token_hash text not null unique,
  status text not null default 'pending',
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  account_created_at timestamptz,
  confirmed_at timestamptz,
  claimed_by_auth_user_id uuid,
  revoked_at timestamptz,
  revoked_reason text,

  constraint signup_invitations_status_check check (
    status in ('pending', 'claimed', 'account_created', 'confirmed', 'expired', 'revoked')
  ),

  constraint signup_invitations_normalized_email_check check (
    normalized_email = lower(btrim(normalized_email))
    and normalized_email <> ''
    and position('@' in normalized_email) > 1
  ),

  constraint signup_invitations_expires_after_created_check check (
    expires_at > created_at
  ),

  -- Claim-matches-reality at the database level:
  -- every lifecycle status must agree with its timestamps. This prevents
  -- manual dashboard edits or future code paths from claiming one state while
  -- the row's evidence says another.
  constraint signup_invitations_lifecycle_consistency check (
    (
      status = 'pending'
      and claimed_at is null
      and account_created_at is null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'claimed'
      and claimed_at is not null
      and account_created_at is null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'account_created'
      and claimed_at is not null
      and account_created_at is not null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'confirmed'
      and claimed_at is not null
      and account_created_at is not null
      and confirmed_at is not null
      and claimed_by_auth_user_id is not null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'expired'
      and claimed_at is null
      and account_created_at is null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'revoked'
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is not null
      and revoked_reason is not null
    )
  )
);

create index if not exists signup_invitations_status_idx
  on public.signup_invitations (status);

create index if not exists signup_invitations_normalized_email_idx
  on public.signup_invitations (normalized_email);

create unique index if not exists signup_invitations_active_email_unique_idx
  on public.signup_invitations (normalized_email)
  where status in ('pending', 'claimed', 'account_created', 'confirmed');

create index if not exists signup_invitations_expires_at_idx
  on public.signup_invitations (expires_at);

create index if not exists signup_invitations_created_at_idx
  on public.signup_invitations (created_at desc);

alter table public.signup_invitations enable row level security;

-- War Room invitation access is server-side only. service_role bypasses RLS;
-- anon and authenticated users receive no direct table policies.
revoke all on table public.signup_invitations from anon;
revoke all on table public.signup_invitations from authenticated;
grant select, insert, update, delete on table public.signup_invitations to service_role;

select pg_notify('pgrst', 'reload schema');

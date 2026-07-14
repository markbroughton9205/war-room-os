-- Rollback for invite-gated signup claim nonce hardening.
--
-- This rollback removes only the claim_nonce column/index and restores the
-- previous lifecycle consistency constraint shape. It does not create anon or
-- authenticated policies, does not broaden grants, and does not weaken RLS.

begin;

drop index if exists public.signup_invitations_claim_nonce_idx;

alter table public.signup_invitations
  drop constraint if exists signup_invitations_lifecycle_consistency;

alter table public.signup_invitations
  add constraint signup_invitations_lifecycle_consistency check (
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
  );

alter table public.signup_invitations
  drop column if exists claim_nonce;

select pg_notify('pgrst', 'reload schema');

commit;

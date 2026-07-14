-- Invite-Gated Signup claim nonce hardening
--
-- Adds a dedicated cryptographic claim identity so failed Auth attempts can
-- release only their own in-flight invitation claim. This migration is
-- additive and does not weaken RLS, grants, token handling, or password
-- handling.

begin;

alter table public.signup_invitations
  add column if not exists claim_nonce uuid;

update public.signup_invitations
set claim_nonce = gen_random_uuid()
where status in ('claimed', 'account_created', 'confirmed')
  and claim_nonce is null;

alter table public.signup_invitations
  drop constraint if exists signup_invitations_lifecycle_consistency;

alter table public.signup_invitations
  add constraint signup_invitations_lifecycle_consistency check (
    (
      status = 'pending'
      and claimed_at is null
      and claim_nonce is null
      and account_created_at is null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'claimed'
      and claimed_at is not null
      and claim_nonce is not null
      and account_created_at is null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'account_created'
      and claimed_at is not null
      and claim_nonce is not null
      and account_created_at is not null
      and confirmed_at is null
      and claimed_by_auth_user_id is null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'confirmed'
      and claimed_at is not null
      and claim_nonce is not null
      and account_created_at is not null
      and confirmed_at is not null
      and claimed_by_auth_user_id is not null
      and revoked_at is null
      and revoked_reason is null
    )
    or (
      status = 'expired'
      and claimed_at is null
      and claim_nonce is null
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

create index if not exists signup_invitations_claim_nonce_idx
  on public.signup_invitations (invitation_id, claim_nonce)
  where claim_nonce is not null;

select pg_notify('pgrst', 'reload schema');

commit;

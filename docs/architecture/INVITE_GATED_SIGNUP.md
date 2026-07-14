# Invite-Gated Signup

War Room signup is invitation-gated. The invitation table is server-only:

- `public.signup_invitations`
- RLS enabled
- no `anon` table access
- no direct `authenticated` table access
- service-role access only through server-side routes/scripts

## Lifecycle

Invitations move through:

`pending -> claimed -> account_created -> confirmed`

Terminal states:

`expired`, `revoked`

`confirmed` is only set after the Supabase Auth callback exchanges the
confirmation code, resolves the authenticated user server-side, and matches the
verified email to an `account_created` invitation.

## Token Handling

Raw invitation tokens are generated with cryptographic randomness and returned
once in a private invite URL:

`/signup?invite=<raw-token>`

The database stores only `token_hash`, generated with HMAC-SHA256 and the
server-only `WAR_ROOM_SIGNUP_INVITATION_SECRET`. There is no default or fallback
secret, and no `NEXT_PUBLIC_*` variable is used for invitation hashing.

## Retry Rule

If Supabase Auth account creation fails after the invitation has been claimed,
War Room releases the row from `claimed` back to `pending` only when:

- the row is still `claimed`
- `account_created_at` is still null
- the dedicated `claim_nonce` matches the in-flight claim

This makes temporary rate-limit, SMTP, provider, or network failures retryable
without restoring an invitation after account creation.

`claimed_at` is audit evidence only. It is never treated as the claim identity.
Each successful claim writes a fresh cryptographically random `claim_nonce`, and
all release/account-created transitions require the exact `invitation_id` plus
that exact `claim_nonce`.

## Stranded Claim Recovery Runbook

Legacy or interrupted rows may remain in `claimed` if Auth failed before the
claim-nonce hardening was deployed, or if an operator intentionally stops a
signup flow mid-flight. Do not manually confirm or assign authority from a
stranded row.

Recommended recovery:

1. Verify the user does not already have a confirmed Supabase Auth account.
2. Verify `status = 'claimed'`, `account_created_at is null`, and
   `confirmed_at is null`.
3. Prefer issuing a fresh invitation rather than editing the row manually.
4. If a manual release is required, perform it through a reviewed
   service-role SQL session and preserve an operator note outside the table.

Rows with `account_created_at` set must not be restored to `pending`; retrying
after that point requires a new invitation and reconciliation of the existing
Auth user.

## Production Configuration Checklist

Verify before live signup:

- Supabase Auth signup is enabled.
- Supabase email confirmation is enabled.
- Production Site URL is correct.
- `/auth/callback` redirect URL is allowlisted.
- `SUPABASE_SERVICE_ROLE_KEY` is Production-only.
- `WAR_ROOM_SIGNUP_INVITATION_SECRET` is Production-only and server-only.
- Custom SMTP status is known. Do not assume custom SMTP is configured unless
  verified in Supabase. Supabase's built-in email provider has a low project-wide
  send quota and may block live end-to-end testing.

## Security Boundaries

- No client-supplied role, Commander flag, ownership, membership, or user id is
  trusted.
- Invitation creation requires an authenticated Commander session.
- Passwords are passed only to Supabase Auth and are never logged, stored,
  serialized, written to invitation metadata, sent to a model, or placed in
  telemetry.
- The callback never assigns Commander authority, family membership, or any
  War Room role.

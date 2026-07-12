# Phase 46P — Authenticated Approval Issuance Surface

## Objective

Phase 46P adds the first authenticated approval-issuance surface for `explicit_execution_approvals`.

This phase does not change approval consumption semantics from 46N/46O. It creates a narrowly gated way for the authenticated Commander to issue a pre-action approval row that later phases and existing consumers can consume.

Flow:

1. Deployment environment gate.
2. Authenticated Supabase session resolution.
3. Commander UUID check.
4. Server-generated canonical approval text preview.
5. Exact canonical text confirmation.
6. `SupabaseApprovalAuthority.issue()`.
7. Operator UI displays issued approval metadata.

## Explicit Decision 1 — Commander Config Loader Timing

Decision proposed for implementation: lazy validation inside the route path, not module-load throwing.

`lib/security/commanderIdentity.ts` should expose a small typed result API such as:

```ts
type CommanderIdentityConfigResult =
  | { ok: true; commanderUserId: string }
  | { ok: false; reason: 'missing' | 'malformed'; message: string }
```

The loader reads only `process.env.WAR_ROOM_COMMANDER_USER_ID`.

It must not read:

- request headers
- request body
- cookies
- `NEXT_PUBLIC_*`
- email address
- fallback aliases

Validation should happen when the route handler calls the loader. Missing or malformed config must be mapped by the route to:

```json
{
  "ok": false,
  "status": "approval_issuance_unavailable",
  "message": "Approval issuance is unavailable because Commander identity is not configured."
}
```

HTTP status: `503`.

Rationale:

- A module-load throw would make local import/build/test failures harder to map to the intended route response.
- A lazy typed result lets the route distinguish configuration unavailability from authorization mismatch.
- The build-time Production gate will still hard-fail Production builds when `WAR_ROOM_COMMANDER_USER_ID` is missing or malformed.
- Preview/local runtime remains blocked by 46P-A before this config can grant live authority.

## Explicit Decision 2 — Existing `approved_by` Handling

Decision proposed for implementation: keep populating the existing required `approved_by text` column for backward compatibility and display, but treat the new `issued_by_user_id uuid` column as the authoritative machine-checked identity.

`approved_by` should be populated from authenticated user metadata when available, using a stable display-safe value such as:

1. `user.email` if present.
2. Otherwise `user.id`.

The route must not authorize based on email. Authorization is only:

```txt
authenticated user.id === WAR_ROOM_COMMANDER_USER_ID
```

Rationale:

- `approved_by` is already `text not null`, so new rows must still populate it.
- Existing display/diagnostic code may rely on it as human-readable context.
- Email is mutable and not authority-grade.
- `issued_by_user_id` is the new authoritative identity column.

## Current Approval Table

Source migration:

`supabase/war_room_phase46n_explicit_execution_approvals.sql`

Current columns:

- `approval_id uuid primary key default gen_random_uuid()`
- `approval_pattern text not null default 'ExplicitExecutionApproval'`
- `exact_approved_text text not null`
- `commander_input text not null`
- `approved_by text not null`
- `action_type text not null`
- `target_system text not null`
- `target_id text not null`
- `single_use boolean not null default true`
- `nonce text not null unique`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- `consumed_at timestamptz`
- `revoked_at timestamptz`
- `revoked_reason text`
- `status text not null default 'active'`

Current constraints:

- Primary key on `approval_id`.
- Unique constraint on `nonce`.
- `explicit_execution_approvals_status_check`: `status in ('active', 'expired', 'consumed', 'revoked')`.
- `approval_lifecycle_consistency`: keeps `status`, `consumed_at`, and `revoked_at` aligned.

Current indexes:

- `explicit_execution_approvals_status_idx` on `status`.
- `explicit_execution_approvals_target_idx` on `(action_type, target_system, target_id)`.
- `explicit_execution_approvals_created_at_idx` on `created_at desc`.

Current security:

- RLS enabled.
- `service_role` has `select`, `insert`, `update`, `delete`.
- No anon/client policies are required.

Known follow-up, out of scope for 46P:

The database has `approval_pattern`, but `ExplicitExecutionApproval` and `SupabaseApprovalAuthority.selectColumns()` do not expose it. 46P must not fix this mismatch.

## Nullable-First Migration Plan

Create a new migration for review before running.

Add nullable columns first:

```sql
alter table public.explicit_execution_approvals
  add column if not exists issued_by_user_id uuid,
  add column if not exists authority_basis text,
  add column if not exists issuance_route text;
```

Backfill legacy rows:

```sql
update public.explicit_execution_approvals
set
  authority_basis = coalesce(authority_basis, 'legacy_pre_46p'),
  issuance_route = coalesce(issuance_route, 'legacy_unknown')
where authority_basis is null
   or issuance_route is null;
```

Add constraints after backfill:

```sql
alter table public.explicit_execution_approvals
  add constraint explicit_execution_approvals_authority_basis_check
  check (authority_basis in ('configured_commander_user_id', 'legacy_pre_46p'));

alter table public.explicit_execution_approvals
  add constraint explicit_execution_approvals_issuance_route_check
  check (issuance_route in ('operator_approval_surface', 'legacy_unknown'));
```

Do not add `issuance_session_hash`.

Do not make `issued_by_user_id` non-null in 46P, because legacy rows intentionally remain null.

## Approval Authority Additive Extension

`SupabaseApprovalAuthority.issue()` already exists and inserts active approvals.

46P should extend, not rewrite:

- `IssueApprovalInput`
- insert payload
- selected columns
- row mapping

New optional input fields:

- `issued_by_user_id?: string | null`
- `authority_basis?: 'configured_commander_user_id' | 'legacy_pre_46p'`
- `issuance_route?: 'operator_approval_surface' | 'legacy_unknown'`

The new 46P route must pass:

- `issued_by_user_id = authenticated user.id`
- `authority_basis = 'configured_commander_user_id'`
- `issuance_route = 'operator_approval_surface'`

Existing tests/scripts that call `issue()` without these fields should continue to work against nullable columns.

## New Route

Path:

`app/api/council/approval/issue/route.ts`

Required first statement:

```ts
const environmentBlocked = assertLiveActionsAllowed()
if (environmentBlocked) return environmentBlocked
```

This must run before:

- body parsing
- Supabase session lookup
- service-role/admin-client construction
- `SupabaseApprovalAuthority` construction
- any DB query

Then resolve the authenticated user with:

```ts
import { createSupabaseServerClient } from '@/lib/supabase/server'
```

Guardrail:

Do not import `@/lib/supabaseServer`; that deprecated alias returns the service-role admin client and must not be used for Commander identity.

Auth outcomes:

- No authenticated user: `401`.
- Authenticated user does not match `WAR_ROOM_COMMANDER_USER_ID`: `403`.
- Commander config missing/malformed: `503 approval_issuance_unavailable`.
- Live actions blocked by 46P-A environment policy: `403`.

## Canonical Approval Text

The server owns canonical approval text.

Client request may include:

- `actionType`
- `targetSystem`
- `targetId`
- `templateVersion`
- `commanderInput`
- `exactApprovedText`
- `ttlSeconds`
- `confirmed`

The route must regenerate canonical text server-side from:

- `actionType`
- `targetSystem`
- `targetId`
- `templateVersion`

Initial supported template:

```txt
apple_reminder_mark_read_v1
```

Unknown or deprecated template versions must be blocked.

The route should support preview and issue modes:

- Preview mode returns the server-generated canonical text.
- Issue mode requires the submitted `exactApprovedText` to exactly equal the regenerated text.

If client text differs:

- no approval row is created
- response status should clearly indicate `template_mismatch_blocked`

Template rule:

Once any approval exists under a template version, that generator must never be edited or deleted. Future wording changes require a new version, for example `apple_reminder_mark_read_v2`.

## TTL Policy

Default: `300` seconds.

Allowed range:

- minimum `60` seconds
- maximum `900` seconds

Invalid TTL behavior:

- reject
- do not silently clamp
- do not create approval row

## Operator UI

New component under:

`components/war-room/operator/`

Recommended model:

`LogEarningsModal.tsx`

Use:

- `FormEvent`
- required fields
- explicit confirmation checkbox
- disabled submit while loading
- POST JSON
- local message display
- distinct error messages for:
  - `503 approval_issuance_unavailable`
  - `403` wrong Commander user
  - `template_mismatch_blocked`

The UI must show canonical preview text before submission.

It should not issue an approval until the Commander explicitly confirms.

## Build-Time Production Gate

No prebuild hook exists today.

Add a `prebuild` script that validates `WAR_ROOM_COMMANDER_USER_ID`.

The validator should use `VERCEL_ENV`, matching 46P-A.

Behavior:

- `VERCEL_ENV=production`: missing or malformed `WAR_ROOM_COMMANDER_USER_ID` hard-fails build.
- `VERCEL_ENV=preview`: no hard fail.
- `VERCEL_ENV=development`: no hard fail.
- `VERCEL_ENV` absent/local: no hard fail.

This build gate complements the runtime route behavior. It does not replace route-level validation.

## Gate 16 — 46P Approval Issuance Suite

This is separate from 46P-A's environment-action-route policy validation.

Required cases:

1. Valid authenticated user with Commander UUID mismatch returns `403`, zero approval row created.
2. Commander identity config missing returns `503 approval_issuance_unavailable`, zero DB call.
3. Commander identity config malformed returns `503 approval_issuance_unavailable`, zero DB call.
4. Client-supplied `authority_basis` is ignored; server value is used.
5. Client-supplied `issuance_route` is ignored; server value is used.
6. Client-supplied `issued_by_user_id` is ignored; authenticated user ID is used.
7. Server canonical text X, client submits Y: blocked, zero approval row.
8. Client alters `targetId` after preview and resubmits: blocked.
9. Unknown template version: blocked.
10. V1 issued approval remains valid/consumable after v2 exists.
11. TTL below 60 seconds is rejected, not clamped.
12. TTL above 900 seconds is rejected, not clamped.
13. `assertLiveActionsAllowed()` is structurally first statement in the route.
14. Full 46K through 46P-A regression sweep remains clean.

## Route Response Shape

Suggested success preview response:

```json
{
  "ok": true,
  "mode": "preview",
  "canonicalText": "...",
  "templateVersion": "apple_reminder_mark_read_v1"
}
```

Suggested success issue response:

```json
{
  "ok": true,
  "status": "issued",
  "approval": {
    "approval_id": "...",
    "action_type": "...",
    "target_system": "...",
    "target_id": "...",
    "expires_at": "...",
    "status": "active",
    "issued_by_user_id": "...",
    "authority_basis": "configured_commander_user_id",
    "issuance_route": "operator_approval_surface"
  }
}
```

Suggested blocked config response:

```json
{
  "ok": false,
  "status": "approval_issuance_unavailable",
  "message": "Approval issuance is unavailable because Commander identity is not configured."
}
```

## Non-Goals

46P does not:

- consume approvals
- execute Apple Reminders
- create callback endpoints
- bypass 46P-A environment blocking
- authorize by email
- add `issuance_session_hash`
- change `approval_pattern`
- make legacy rows non-null for `issued_by_user_id`
- change 46K/46L/46M/46N/46O consumption semantics

## Review Stop

Before implementation, review and approve these two decisions:

1. Commander config loader validates lazily inside route flow and returns typed sentinel results, rather than throwing at module import.
2. `approved_by` remains populated for backward-compatible display, but `issued_by_user_id` becomes the authoritative machine-checked identity.

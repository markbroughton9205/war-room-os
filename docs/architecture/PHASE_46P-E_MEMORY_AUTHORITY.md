# Phase 46P-E — Memory Authority Implementation

Phase 46P-E implements the approved memory authority architecture as reviewable
code and migration artifacts only. No SQL is applied by this phase.

## Scope

This phase covers:

- `public.memories`
- `public.war_room_memory_proposals`
- `public.war_room_approved_memories`
- Commander-scoped ownership metadata
- Commander-only authenticated policies for safe session access
- Service-role continuity for server-owned approval, diagnostics, and legacy flows

This phase does not approve broad authenticated access, anonymous access,
service-role removal, or approve/reject route conversion to session-only.

## Ownership Model

New memory rows and memory proposal rows receive:

- `created_by_user_id`
- `ownership_authority_basis`

The value must come from the authenticated server-side Supabase session. It must
never come from request body fields, client-provided `userId`, client role
claims, or UI state.

For Baby Chat, the authenticated session is already verified against the
configured Commander UUID before any memory read, memory write, research, or
provider call. Baby Chat writes `created_by_user_id` directly from that verified
session.

For legacy/manual memory routes, new writes are prepared to derive ownership
from the authenticated server session. Existing service-role reads remain during
the compatibility window.

## Commander Authority

Migration A creates `public.war_room_memory_authorities` with one active
Commander row allowed at a time. The active Commander is looked up through
`public.war_room_current_memory_commander_user_id()`.

Migration B adds the RLS helper:

`public.war_room_is_memory_commander(candidate_user_id uuid)`

The function is:

- schema-qualified
- `stable`
- `security definer`
- restricted with `set search_path = public, pg_temp`
- null-safe
- free of dynamic SQL
- free of dynamic identifiers
- executable by `authenticated` and `service_role`, not `anon` or `public`

Owner assumption: the function owner must be a trusted database role that can
read `public.war_room_memory_authorities`. It must not be owned by an
untrusted application role.

## Migration Order

1. Review all artifacts.
2. Apply Migration A only after prechecks are accepted.
3. Insert or verify exactly one active Commander authority row.
4. Backfill ownership for existing rows using approved Commander attribution.
5. Apply Migration B to remove anonymous access and activate Commander policies.
6. Burn in with production logs and validation.
7. Apply Migration C only after all target rows have ownership metadata.

## Deployment Order

1. Deploy code that writes ownership metadata.
2. Apply Migration A.
3. Backfill and verify Commander authority.
4. Apply Migration B.
5. Monitor Baby Chat, Council proposal ingestion, Memory panels, Academy,
   Briefing, runtime integrity, and canonical status.
6. Apply Migration C after burn-in.

## Rollback Order

Rollback preserves ownership data and Commander authority records.

1. If Migration C causes failures, run the Migration C tightening rollback.
2. If Migration B causes policy failures, run the Migration B policy rollback.
3. Migration A should not be destructively rolled back. Ownership columns and
   authority rows are historical security data and must remain.

Rollback must never restore anonymous access.

## Commander Rotation

Commander rotation must be explicit:

1. Insert or update a new Commander authority record with
   `authority_basis = 'manual_commander_rotation'`.
2. Revoke the previous Commander authority row.
3. Verify only one active Commander row exists.
4. Re-run validation before trusting session-scoped memory access.

Do not rely on client state or local UI identity for rotation.

## Service-Role Justification

Service-role access remains justified for:

- proposal approval
- proposal rejection
- Council proposal ingestion
- runtime/canonical health probes
- Academy and Briefing status surfaces
- compatibility with existing server-owned memory workflows

Service-role access does not authorize browser-direct memory access and should
not be interpreted as user authority.

## Route Authorization Matrix

Phase 46P-E1 hardens the memory routes without changing their API shape.

| Route | Method | Anonymous | Authenticated Non-Commander | Commander | Service Role | Ownership Required | Environment Gate | Justification |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `/api/memory` | GET | No | No | Yes | Yes, server-side read | No | Yes | Legacy private memory read exposes sensitive memory rows. |
| `/api/memory` | POST | No | No | Yes | Yes, server-side write | Yes | Yes | Durable memory mutation. |
| `/api/tools/memory` | GET | No | No | Yes | Yes, server-side read/health | No | Yes | Memory tool read/health can expose private persistence state. |
| `/api/tools/memory` | POST | No | No | Yes | Yes, server-side write | Yes | Yes | Durable memory mutation from War Room/Baby UI. |
| `/api/memory/proposals` | GET | No | No | Yes | Yes, server-side read | No | Yes | Pending proposals are private review material. |
| `/api/memory/proposals` | POST | No | No | Yes | Yes, server-side write | Yes | Yes | Creates durable pending memory proposal. |
| `/api/memory/approve` | POST | No | No | Not yet enforced in 46P-E | Yes | Existing proposal id | Not changed | Approval hardening is intentionally deferred; do not convert to session-only without explicit Commander action authorization. |
| `/api/memory/reject` | POST | No | No | Not yet enforced in 46P-E | Yes | Existing proposal id | Not changed | Rejection hardening is intentionally deferred; do not convert to session-only without explicit Commander action authorization. |

Privileged memory reads are environment-gated because memory confidentiality is
protected alongside memory mutation. Preview/local deployments must not expose
Commander-only private memory or pending proposal information. Write routes are
also environment-gated because they mutate durable War Room memory state.

## Deprecated Admin Alias Status

`app/api/tools/memory/route.ts` no longer imports the deprecated
`@/lib/supabaseServer` alias. It imports `createSupabaseAdminClient` directly
from `@/lib/supabase/admin`, preserving service-role behavior while removing
the privilege-footgun alias from this route.

## Validation Harness Status

`lib/memory-authority/validation.ts` and
`scripts/run-memory-authority-validation.mjs` are static architecture validation
tools. They inspect source artifacts for expected route ordering, ownership
fields, migration boundaries, rollback boundaries, and policy shapes. They are
not behavioral route tests and must not be represented as proof of live request
behavior.

Executable behavioral route tests were not added in 46P-E1 because these routes
construct Next.js cookie-backed Supabase clients and service-role clients
directly. They do not currently expose dependency injection seams for safe inert
request execution without either a Next runtime harness or refactoring route
handlers, which is outside 46P-E1 scope.

## Temporary Compatibility Window

During burn-in:

- `created_by_user_id` is nullable.
- `ownership_authority_basis` is nullable.
- service-role reads continue for existing server routes.
- proposal approve/reject remain service-side.
- dashboard health probes continue to use service-side checks.

Migration C closes this window by requiring ownership metadata.

## Burn-In Procedure

Before Migration C:

- verify no ownerless `public.memories` rows remain
- verify no ownerless `public.war_room_memory_proposals` rows remain
- verify Baby Chat writes owned proposals
- verify Council proposal ingestion still works
- verify Phase 6 Memory panels still load and mutate proposals
- verify Academy and Briefing still load
- verify runtime integrity and canonical status still report memory status
- verify Preview remains fail-closed where service-role secrets are absent

## Known Risks

- Broad authenticated policies would expose private memories.
- Anonymous access must not be restored.
- Approve/reject routes require explicit Commander authorization before they can
  safely become session-only.
- The deprecated `@/lib/supabaseServer` alias remains a privilege-footgun and
  should be cleaned up in a separate phase.
- Service-role health probes should eventually be separated from content access.

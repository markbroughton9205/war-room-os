# Workspace Contributor Foundation

Phase 46Q-A creates the first non-Commander workspace role for War Room OS.

## Role Model

`workspace_contributor` is a personal workspace role for Jasmine and future contributors. It is not Commander authority and cannot be upgraded to Commander through `workspace_members`.

Contributors may manage their own workspace preferences, proposals, and proposal attachments. They may submit ideas for UI, workflows, features, and council behavior.

Contributors may not approve proposals, change global settings, change RLS/auth policy, deploy, push to `main`, access Commander-private memory, or authorize privileged actions.

## Permission Matrix

| Surface | Contributor | Commander | Service Role |
| --- | --- | --- | --- |
| Own membership | read own | review all through Commander routes if implemented later | execute server-side |
| Own settings | read/write own only | no direct workspace-setting mutation required | execute server-side |
| Proposals | create/read/edit draft/revision, submit | review and transition lifecycle | execute server-side |
| Events | read own proposal events | read proposal events | insert through RPC only |
| Attachments | upload/read/delete own proposal metadata | review via short-lived signed URL | execute server-side |
| Commander memory | no access | Commander only | execute server-side |

## Data Separation

All contributor-owned tables carry `workspace_owner_id`. The browser never supplies authority for this value. Server routes derive it from the authenticated Supabase session and membership lookup.

## Proposal Lifecycle

Allowed contributor transitions:

- `draft -> submitted`
- `revision_requested -> submitted`

Allowed Commander transitions:

- `submitted -> contributor_review`
- `contributor_review -> commander_council_review`
- `commander_council_review -> revision_requested`
- `commander_council_review -> approved`
- `commander_council_review -> rejected`
- `approved -> implemented`
- `implemented -> verified`
- `verified -> closed`
- `rejected -> closed`

No ad hoc status updates are allowed. Transitions must use the lifecycle function or RPC.

## Event Log

`workspace_proposal_events` is append-only from the application perspective. Application routes do not expose update/delete behavior. Creation and transition RPCs insert exactly one event per successful status transition.

Each event has a per-proposal `event_sequence` and a unique per-proposal `idempotency_key`. These intentionally solve different problems:

- `idempotency_key` identifies one logical transition request. The caller generates one UUID for the user action and reuses it on retry after a timeout or lost response.
- `event_sequence` identifies committed event order only. It is generated inside the transaction and must never be used as retry identity.

On retry, the transition RPC checks `(proposal_id, idempotency_key)` before executing. If the existing event matches the requested actor and target status, it returns the already committed result without another update/event. If the key is reused for a different actor or target status, the RPC rejects with `idempotency_conflict`.

Event ownership is database-enforced by a composite foreign key to `(proposal_id, workspace_owner_id)`, so an event cannot claim a different owner than its proposal.

## Attachment Rules

Bucket: `workspace-proposal-attachments`

Storage must be private. No public URLs are used. Paths are server generated:

`<workspace_owner_id>/<proposal_id>/<generated-uuid>.<validated-extension>`

Allowed MIME types:

- `image/png`
- `image/jpeg`
- `image/webp`
- `application/pdf`
- `text/plain`

Maximum size is 10 MB. The server validates MIME, extension, actual file signature, size, original filename safety, ownership, and SHA-256.

Upload compensation is explicit because Storage and Postgres are not one transaction: the server validates, uploads the object, inserts metadata, and deletes the uploaded object if metadata insertion fails. Delete removes the object first and then metadata; failed deletes are safe to retry. Orphan reconciliation remains a future operator maintenance task and should compare bucket objects against `workspace_proposal_attachments.storage_path`.

## Authorization Chains

Contributor route order:

1. environment gate
2. authenticated session
3. workspace membership lookup
4. ownership validation
5. input validation
6. database/storage action

Commander route order:

1. environment gate
2. authenticated Commander session
3. fetch current proposal
4. lifecycle validation
5. privileged server-side database/storage action

The service-role client is an executor, never an authorizer.

## RLS Model

Anon access is revoked. Authenticated contributors can select only their own rows. Direct member insert/update/delete, proposal insert/update/delete, settings insert/update, attachment insert/delete, and event insert/update/delete are not granted. Service role retains server execution capability after route-level authorization.

Proposal creation is server-only through `workspace_create_proposal`, which atomically inserts the proposal and first draft event. A proposal should never exist without its initial event.

`workspace_members.role` is immutable to contributors: authenticated users receive only SELECT on their own membership row, the role column has a check constraint allowing only `workspace_contributor`, and membership bootstrap remains a manual Commander-approved service-role action.

## Storage Model

Create the private Supabase Storage bucket manually after review:

- Bucket ID: `workspace-proposal-attachments`
- Public: `false`
- Size limit: `10485760`
- Allowed MIME types: `image/png`, `image/jpeg`, `image/webp`, `application/pdf`, `text/plain`

Commander attachment review obtains short-lived signed URLs only after Commander authorization.

Signed URLs expire after 10 minutes.

## Settings Safety

Workspace settings use runtime schemas with recognized top-level sections only. The validator rejects unknown keys, prototype-pollution keys, secret-like strings, provider keys, Commander/global settings language, URLs, oversized JSON, excessive depth, excessive key count, and non-JSON values.

## Rate Limits

Phase 46Q-A1 adds process-local route limits for proposal creation, attachment uploads, signed URL generation, and settings updates. These limits are defensive guardrails only; a future distributed deployment phase should replace or augment them with durable per-user counters.

## Delete Semantics

Proposals are not deleted by contributor or Commander routes in this phase. Lifecycle completion uses `closed`, preserving proposal rows, events, decisions, and attachment metadata. Attachment delete is allowed for a contributor's own proposal attachment and removes the private object plus metadata; proposal history remains intact.

## GitHub Workflow

This phase does not configure GitHub branch protection in code. Contributors must not push directly to `main`; proposal approval remains an internal review process before any implementation work.

## Rollout Sequence

1. Review SQL migration and rollback.
2. Apply migration only after Commander approval.
3. Create private storage bucket manually.
4. Bootstrap Jasmine membership with her actual auth user UUID.
5. Verify RLS with anon, member, non-member, and service-role contexts.
6. Enable UI navigation after route verification.

## Manual Bootstrap

Do not include Jasmine's UUID in migration files. After review, run:

```sql
insert into public.workspace_members (workspace_owner_id, role, ai_access_enabled)
values ('<JASMINE_AUTH_USER_UUID>', 'workspace_contributor', true)
on conflict (workspace_owner_id) do update
set ai_access_enabled = excluded.ai_access_enabled, updated_at = now();
```

## Rollback

Rollback drops the new functions, policies, and tables in dependency order. It destroys workspace proposal data. It does not touch Commander, auth, memory, invitation, approval, or recovery tables, and it does not restore anonymous access.

## Explicit Exclusions

This phase does not build:

- Jasmine's personalized council runtime
- Codex/Claude integration for Jasmine
- GitHub branch protection configuration
- Production deployment automation
- AI execution on proposals
- Commander-private memory sharing

## Future Personalized Council Phase

A later phase may give Jasmine a personalized council experience scoped to her workspace. That phase must keep Commander authority, memory, deployment, and global settings separate.

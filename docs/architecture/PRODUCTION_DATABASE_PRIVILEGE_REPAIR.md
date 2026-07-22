# Production Database Privilege Repair

Phase 48-DB-A prepares a narrow SQL repair for seven confirmed server-only War Room tables. It is build-only until Mark authorizes SQL execution and Claude Code independently validates the package.

## Incident Summary

Production reported PostgreSQL error `42501 permission denied for table war_room_economic_provider_effectiveness`. A direct privilege test confirmed `service_role SELECT = false`, while the table has a `service_role` RLS policy. This means RLS policy presence was not enough: PostgreSQL table privileges still blocked access.

## Table Grants Versus RLS

PostgreSQL first requires the active role to have table privileges such as `SELECT`, `INSERT`, or `UPDATE`. RLS policies then decide which rows that role may access. Existing `service_role` policies are preserved; this repair adds missing table grants so those policies can be reached.

## Scope

Affected server-only tables:

- `public.war_room_permissions_state`
- `public.war_room_sentinel_scans`
- `public.war_room_economic_provider_effectiveness`
- `public.war_room_economic_proposals`
- `public.war_room_economic_telemetry`
- `public.war_room_economic_unresolved_operations`
- `public.war_room_economic_active_missions`

These tables are accessed by server code through `createSupabaseAdminClient` / `tryWarRoomSupabase`. They must not be directly exposed to `anon` or `authenticated`.

## Current Default ACL Defect

The reported `postgres` default ACL grants `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` to `anon`, `authenticated`, and `service_role`, but omits `SELECT`, `INSERT`, `UPDATE`, and `DELETE` for `service_role`. This is both overly permissive for browser roles and insufficient for server-side service-role CRUD.

## Forward Repair

The migration:

- grants only currently required `service_role` operations
- revokes `TRUNCATE`, `REFERENCES`, `TRIGGER`, and version-supported `MAINTAIN` from `anon` and `authenticated`
- repairs `postgres` creator-specific default table ACL for future public tables
- preserves existing RLS policies
- preserves table ownership
- performs no data mutation
- creates no functions, RPC endpoints, or `SECURITY DEFINER` helpers

### MAINTAIN compatibility

`MAINTAIN` is a table privilege introduced in PostgreSQL 17. The forward migration and rollback both handle it purely through exception trapping — each `MAINTAIN` grant/revoke runs inside a `DO` block via dynamic `EXECUTE`, and a caught `syntax_error_or_access_rule_violation` produces a `RAISE NOTICE` and continues rather than aborting the transaction. There is no reliance on parsing `server_version_num` or probing an unrelated catalog function's signature as a stand-in for MAINTAIN support inside the migration/rollback themselves — the earlier draft did this via a `pg_proc` check for `has_table_privilege`'s argument signature, which does not actually correlate with MAINTAIN availability and has been removed. Preflight and verification, which need to *report* MAINTAIN state rather than change it, use the accurate and safe `current_setting('server_version_num')::int >= 170000` gate instead, since `has_table_privilege(..., 'MAINTAIN')` itself raises an error on unsupported versions and a read-only reporting script cannot rely on catching an exception mid-`SELECT`.

### EXECUTE parser limitation

The static validator's `extractExecuteStrings` (and the checks built on it — MAINTAIN statement validation, the fail-closed EXECUTE-form check) only recognizes `EXECUTE` followed directly by a simple single-quoted SQL literal, e.g. `execute 'grant maintain on table ... to anon, authenticated'`. It does not parse or accept:

- string concatenation (`execute 'grant ' || 'maintain ...'`)
- dollar-quoted dynamic SQL (`execute $sql$ ... $sql$`)
- a function call producing the SQL text (`execute format(...)`)

Introducing any of these forms into DB-A's SQL requires extending the validator first — the validator fails closed (reports a validation failure) rather than silently ignoring an `EXECUTE` usage it cannot parse in this simple form, so a dynamic-SQL form outside this constraint is caught as a validator failure, not silently passed through unchecked.

## Execution Prerequisites

The forward repair must be executed by the PostgreSQL owner role of the seven target tables (confirmed `postgres`) or an equivalent administrative role with `GRANT`/`REVOKE` authority on those tables and on `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`. In the normal Supabase production workflow, this is the Supabase Dashboard SQL Editor or an equivalent administrative execution context connecting as that role. This document does not guarantee which specific runtime identity a given Supabase project's SQL Editor session uses — that is an operational fact of the target project, confirmed at execution time, not asserted here in advance.

If the forward repair is run from a lower-privilege role lacking sufficient `GRANT`/`REVOKE` authority, PostgreSQL raises an `insufficient_privilege` error inside the transaction; because the migration is wrapped in `BEGIN...COMMIT`, this fails the whole transaction with no partial privilege changes applied. This is expected, safe behavior, not a condition this script attempts to detect or work around in advance.

## CRUD Matrix

| Table | Current operations required | Not required |
| --- | --- | --- |
| `war_room_permissions_state` | `SELECT`, `INSERT`, `UPDATE` | `DELETE` |
| `war_room_sentinel_scans` | `SELECT`, `INSERT` | `UPDATE`, `DELETE` |
| `war_room_economic_proposals` | `SELECT`, `INSERT` | `UPDATE`, `DELETE` |
| `war_room_economic_telemetry` | `SELECT`, `INSERT` | `UPDATE`, `DELETE` |
| `war_room_economic_provider_effectiveness` | `SELECT`, `INSERT`, `UPDATE` | `DELETE` |
| `war_room_economic_active_missions` | `SELECT`, `INSERT` | `UPDATE`, `DELETE` |
| `war_room_economic_unresolved_operations` | `SELECT`, `INSERT` | `UPDATE`, `DELETE` |

## Default ACL Decision

Phase 48-DB-A uses strict default deny for future `service_role` CRUD. It does not automatically grant CRUD on every future table created by `postgres`. Future migrations must explicitly grant `service_role` privileges table by table. This avoids broad schema-wide privilege expansion.

`supabase_admin` default privileges are not changed because the confirmed defect is for tables owned/created by `postgres`, and no direct evidence shows `supabase_admin` created the affected tables.

## Root Cause

The observed path is:

PostgREST authenticator -> JWT assumes `service_role` -> `service_role` reaches table -> `service_role` lacks required table privilege -> PostgreSQL returns `42501`.

After repair:

`service_role` has required table privileges -> existing service-role RLS policy permits access -> server route can complete.

This repair corrects a confirmed privilege defect regardless of which current server request produced the log entry. It does not claim caller identity solely from a database log.

## Verification Plan

Preflight SQL reports, per affected table: existence, owner, RLS enabled, force-RLS state, effective role privileges (postgres/service_role/authenticated/anon/PUBLIC), explicit decoded ACL entries (grantee/privilege/is_grantable), policies by name/roles/command/permissive-mode/predicate, whether no policy is discoverable in the connected database's live `pg_policies` catalog, a non-blocking `RLS_ENABLED_NO_DATABASE_POLICY_DISCOVERED_REQUIRES_RUNTIME_CONFIRMATION` warning for tables where that applies, service_role's `BYPASSRLS` role flag, identity/serial column sequence ownership and whether service_role holds sequence `USAGE`, and default ACL state for both `postgres` and `supabase_admin` side by side. MAINTAIN privilege checks are version-gated (`server_version_num >= 170000`) and reported in a separate query, since `has_table_privilege(..., 'MAINTAIN')` raises `unrecognized privilege type` on PostgreSQL versions before 17 and would otherwise abort the entire read-only report.

Post-repair verification SQL reports PASS/FAIL-style columns for required service-role privileges, absence of service-role `DELETE`, absence of any anon/authenticated/PUBLIC table privilege, RLS preservation and force-RLS state, service-role policy presence, service_role `BYPASSRLS` (as a `COALESCE(..., false)`-guarded boolean used in access-path logic, so an absent `service_role` role never silently collapses into an ambiguous SQL `NULL`) alongside an explicit three-state `service_role_bypassrls_state` label (`SERVICE_ROLE_ABSENT`, `SERVICE_ROLE_PRESENT_BYPASSRLS_TRUE`, `SERVICE_ROLE_PRESENT_BYPASSRLS_FALSE`) and a `pass_service_role_rls_access_path` result that passes when EITHER a named service_role policy exists OR `BYPASSRLS` is confirmed — it never requires a named policy when BYPASSRLS already proves the access path, and it does not by itself prove any application code path succeeds, only that a database-level route to RLS-gated data exists. Verification also reports full policy metadata (role/command/mode/predicate — not just policy names), postgres ownership, corrected `postgres` default ACL decoded via `aclexplode()` (not raw `aclitem` text matching) covering PUBLIC/anon/authenticated CRUD-or-dangerous privileges, service-role default DELETE, and any unexpected default-ACL grantee, an explicit three-state MAINTAIN result per table/role (`UNSUPPORTED_POSTGRESQL_VERSION`, `SUPPORTED_AND_CORRECTLY_ABSENT`, or `SUPPORTED_BUT_UNEXPECTEDLY_PRESENT` — never a false pass for a version where it wasn't actually checked), and `supabase_admin` default ACL reported for visual drift comparison (this migration never modifies `supabase_admin` defaults, so verification surfaces that state rather than asserting it programmatically).

Preflight and verification only report state actually queried against the connected database; neither script claims Production behavior it has not observed by running.

## Evidence Capture

Before the forward repair is executed against Production, the operator must run `preflight_war_room_server_table_privileges.sql` and retain its full output. After the forward repair is executed, the operator must run `verify_war_room_server_table_privileges.sql` and retain its full output. Together, the saved preflight and verification output become the audit evidence for this production privilege repair — the record of the privilege state immediately before the change and the confirmed privilege state immediately after it.

This requirement describes what must be captured when execution is authorized; it does not itself imply that preflight or verification has been run, or that the forward repair has been executed, at the time this document is written. As stated elsewhere in this document, no SQL in this package has been executed against Production or Supabase.

## Rollback Plan

**Design: Option A, baseline-specific rollback.** The rollback restores the confirmed pre-migration baseline only — it does not attempt to reconstruct an unknown historical privilege state, and it never touches a privilege the forward migration itself did not change.

Concretely:

- Revokes exactly the `SELECT`/`INSERT`/`UPDATE` grants the forward migration added to `service_role`, for exactly the seven target tables — the mirror image of the forward `GRANT` statements, no more.
- Restores `TRUNCATE`, `REFERENCES`, `TRIGGER`, and version-supported `MAINTAIN` to `anon, authenticated` only. Earlier drafts of this rollback also re-granted these to `service_role`, which was a scope-expansion defect: the forward migration never revoked `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` from `service_role` in the first place, so there was nothing legitimate for the rollback to restore there. That has been corrected.
- Runs a precondition guard before revoking anything, checking two conditions: (1) `service_role` currently holds every privilege the forward migration is documented to have granted, and (2) `service_role` does not hold `DELETE` on any of the seven target tables. This is a required-privilege presence check plus an explicit dangerous-extra rejection — it is not a full state diff proving the live privilege set is an exact total match with nothing else unaccounted for. Either condition failing raises an exception (aborting the transaction, no partial changes) instead of guessing which privileges are safe to remove — for example, if state has drifted from an unrelated manual grant applied after Phase 48-DB-A. This is a static, read-before-write guard, not a Production connection made by this repository.
- Never restores anonymous CRUD, never disables RLS, never drops policies, never changes ownership, never modifies data or schema.

### Rollback limitations

The rollback is explicitly baseline-dependent. It restores the state confirmed for `war_room_economic_provider_effectiveness` (direct `service_role SELECT = false` test) and infers the same pre-migration state for the other six tables from the shared `postgres` default-ACL defect. If any of those six tables had a privilege history that diverges from that inference (for example, a manual grant applied outside this default-ACL story), the rollback's assumed baseline would not reflect it — the precondition guard mitigates this by refusing to run rather than guessing, but it cannot reconstruct a truly unknown prior state. A snapshot-driven design (Option B: preflight captures a reproducible privilege snapshot that rollback is required to match and restore exactly) would close this gap, at the cost of requiring an operational snapshot-storage step outside this repository. Option A was chosen as the narrowest design implementable statically without Production access; if Mark wants Option B's stronger guarantee, that requires a follow-up phase, not a change to this build.

Rollback should be used only if the repair breaks a production server-only workflow and Mark authorizes reverting to the prior posture.

## Application Validation Plan

- `/api/economic/surface`: expects service-role `SELECT` on economic proposals, telemetry, provider effectiveness, active missions, and unresolved operations.
- `/api/red-sentinel/status`: expects service-role `SELECT` on sentinel scans.
- `/api/red-sentinel/scan`: expects service-role `INSERT` on sentinel scans and `SELECT`/`UPDATE` on permissions state through standing-permission tracking.
- Permissions-state read path: expects service-role `SELECT`.
- Permissions-state write path: expects service-role `SELECT`, `UPDATE`, and fallback `INSERT`.
- Economic provider effectiveness read/write: expects service-role `SELECT`, `INSERT`, and `UPDATE`.
- Proposals read/write: expects service-role `SELECT` and `INSERT`.
- Telemetry read/write: expects service-role `SELECT` and `INSERT`.
- Active missions read/write: expects service-role `SELECT` and `INSERT`.
- Unresolved operations read/write: expects service-role `SELECT` and `INSERT`.

No live provider actions should be run as part of SQL review.

## Security Boundary

This phase does not:

- grant browser roles table reads
- weaken RLS
- expose service-role keys
- add public access
- create `SECURITY DEFINER` functions
- add RPC endpoints
- change schema exposure
- change CORS
- change Auth
- change provider behavior
- change application code behavior
- touch Phase 48-C4C files

## Execution Authorization

Do not execute this SQL against Production or Supabase until independent security validation is complete and Mark explicitly authorizes the exact SQL artifact.

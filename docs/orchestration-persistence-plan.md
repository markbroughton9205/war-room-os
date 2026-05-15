# Orchestration persistence plan

This document captures the **current limitation** of War Room orchestration state (routing decisions, interim council coordination context, and similar runtime structs) and outlines how durable persistence could evolve **without prescribing implementation work here**.

## Current limitation

Much of the orchestration stack keeps **working memory in-process**: conversation-adjacent routing hints, ephemeral tool snapshots, and UI hydration bridges often assume a warm Node runtime. Restarts, horizontal scaling, or cold starts discard data that never reaches Supabase (`war_room_*` tables) or the client session layer.

Effects:

- Recovery after deploy relies on **re-fetching** authoritative rows (messages, permissions, queued actions) rather than reconstructing orchestration scratch space.
- Parallel tabs or instances cannot share fine-grained orchestration telemetry unless it is modeled explicitly in persisted tables.

## Recommended primary table (conceptual)

Introduce or extend a dedicated row keyed by **`conversation_id`** (and optionally `family` / `engine_run_id`) holding:

- Version / schema discriminator (`payload_version`).
- Compact JSON/BLOB for orchestration snapshot (`payload`), bounded in size with pruning rules.
- `updated_at` for optimistic concurrency or TTL sweep jobs.

Naming candidates (pick one during implementation): `war_room_orchestration_snapshots`, `war_room_engine_sessions`, or an extension column on `war_room_conversations.metadata` if payloads stay tiny.

## Migration outline

1. **Inventory**: enumerate every structure written during orchestration (`router`, attendance bookkeeping adjacent surfaces, streaming coordinators). Exclude behaviors explicitly frozen by policy (for example attendance protocol semantics themselves — only persistence boundaries move).
2. **Shape payloads**: define JSON schema per version; enforce server-side max depth/size.
3. **Dual-write window**: persist snapshots while retaining in-memory paths; verify parity on read during QA.
4. **Read path**: hydrate orchestration hints from DB after cache miss; fall back to empty defaults without blocking chat.
5. **Retention**: TTL or archival job for stale snapshots tied to archived conversations.

## Risks

- **Payload creep**: unconstrained JSON invites oversized rows and accidental secret embedding — enforce redaction at write time.
- **Race conditions**: multi-tab writes require versioning or merge semantics for `payload`.
- **Latency**: synchronous writes on every hop could regress latency — prefer batched/async persistence with loss acceptance documented per field.

## Operational steps (non-code)

1. Confirm retention expectations with operators (hours vs months).
2. Size Postgres storage vs projected snapshot churn.
3. Roll out behind a feature flag; monitor PostgREST latency and row growth.

No persistence behavior is implemented by this note; it exists to align schema and rollout conversations before coding begins.

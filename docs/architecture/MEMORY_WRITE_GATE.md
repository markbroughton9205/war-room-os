# Memory Write Gate

Phase 46I introduces a fake-storage-only persistence boundary for memory and lesson writes. It does not turn on production memory. It proves War Room can stage, verify, approve, commit to an injected fake store, audit, detect integrity issues, and roll back without poisoning future reasoning.

## Position

46I adds:

MemoryWriteProposal -> StagedMemoryWrite -> ExplicitMemoryWriteApproval -> MemoryWriteCommitResult -> MemoryRollbackPlan / MemoryRollbackResult

Provider execution approval from 46G/46H is not memory approval. A provider call is transient; a memory write changes future reasoning and requires a separate approval object.

## Core Boundaries

- fake storage only
- no Supabase
- no production memory table
- no file writes
- no browser storage
- no vector database
- no embeddings provider
- no provider calls
- no network calls
- no Auto Mode memory write

## Approval Object

Only `ExplicitMemoryWriteApproval` can authorize a memory commit. It must match proposal id, staged write id, memory scope, target entity, memory type, expiration, exact approval phrase, commander approver, single-write limit, and all unsafe allow-flags set to false.

The required phrase is:

`I APPROVE THIS MEMORY WRITE`

Loose booleans such as `approved: true`, 46F preview state, 46G/46H execution approvals, provider success, or UI save actions do not authorize memory writing.

## Stage Then Commit

Every write stages first. Staging normalizes content, fingerprints the memory, checks duplicates and conflicts, creates a review checklist, requires second confirmation, and creates a rollback plan before commit.

Commit requires:

- evidence attached
- duplicate check
- conflict check
- scope verification
- privacy check
- commander approval
- Auto Mode disabled
- provider-authored memory blocked unless commander approval is valid

## Rollback

Rollback is append-only. Committed records are revoked or superseded, never physically deleted. Uncommitted staged writes roll back as no-op. Rollback itself appends an audit event.

## Validation Gates

Gate 1: TypeScript, ESLint, build.

Gate 2: Behavioral validation for staging, approval, blocking, realistic proposals.

Gate 3: Regression validation for 46E, 46F, 46G, and 46H behavior harnesses where available.

Gate 4: Architecture validation confirming one-way dependencies and no live storage imports.

Gate 5: Execution boundary validation confirming no provider calls, tools, repo mutation, messages, deployment, or Auto Mode writes.

Gate 6: Approved-call regression confirming provider-call approval cannot authorize memory writes.

Gate 7: Real-network-call regression confirming 46I introduces no fetch/provider/Supabase request path.

Gate 8: Persistence integrity verification using an independent spy snapshot to prove blocked attempts leave fake storage unchanged, duplicate retry creates no duplicate, partial failure is detected, rollback plans exist before commit, rollback revokes without deleting, and audit is append-only.


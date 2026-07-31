# Canonical Phase Roadmap

This document reconciles the repository's disconnected phase-numbering
schemes into one authoritative index, records the completed
architecture/operations timeline with its real commit SHAs, and defines the
gate that must be passed before any new implementation branch is created.

This document is documentation and planning only. It authorizes nothing, it
does not execute SQL, and it does not imply Commander approval of any
pending action.

## 1. Three Disconnected Phase Schemes

The repository currently contains three separate phase-numbering schemes.
They do not share a sequence, a numbering convention, or a common
successor/predecessor relationship. A phase number in one scheme has no
bearing on any phase number in another.

- **Platform Phase A–D** (`docs/runtime-roadmap.md`): the long-range runtime
  target — stable web/PWA shell (A), Windows desktop shell (B), mobile
  companion (C), AI-first operating environment (D).
- **Aspirational Phase 8–10** (`docs/phases/phase-8.md`, `phase-9.md`,
  `phase-10.md`, and `docs/phases/future-vision.md`): a separate long-term
  direction track (Phase 10 = "Agent Foundry"). Written independently of the
  platform-shell roadmap above.
- **Architecture/Operations Phase 46–49** (`docs/architecture/PHASE_46P-*`,
  `COUNCIL_SKILLS_46B_DESIGN.md`, `COMMANDER_RUNTIME_DIAGNOSTICS.md`,
  `DISCIPLINE_REGISTRY.md`, `PHASE_48_C4D_*`, `PHASE_49_A_*`, plus the
  lettered sub-phases recorded in git history and section 2 below): the
  actual track this document indexes. Phase 48 is an umbrella number
  covering two distinct kinds of work, not one uniform relationship:
  - **Phase 48-C4A through 48-C4D are a documented layered/sequential
    Council-runtime progression, not parallel work.** Per
    `docs/architecture/PHASE_48_C4D_COUNCIL_RUNTIME_TRUTHFULNESS_AND_RESPONSE_INTEGRITY.md`
    section 20: "C4A owns truthful completed-transcript projection into
    Commander operation cards. C4B connects that timeline to the
    authoritative progress-event runtime. C4C adds incremental
    browser-visible transport for the same authoritative events. ... Phase
    48-C4D operates one layer beneath all three... C4D does not change
    event ordering, event identity, or transport envelopes owned by
    C4B/C4C." That same document's opening line states C4D "closes and
    documents runtime hardening already implemented on top of Phase
    48-C3A, 48-C4A, 48-C4B, and 48-C4C." This document does not add any
    detail about C4A or C4B beyond what that C4D document states — no
    dedicated C4A or C4B document or commit was found (the same limitation
    noted for C4C in section 2).
  - **Phase 48-DB-A and Phase 48-OPS-A are separate operational
    workstreams under the same Phase 48 umbrella number** — a database
    privilege repair and a set of ops batches, respectively — unrelated in
    subject matter to the C4A–D Council-runtime lineage and to each other.
    These two are the only items in this document actually characterized
    as parallel/independent.

**These are separate workstreams unless explicitly mapped.** No document in
this repository maps platform Phase A–D or aspirational Phase 8–10 onto the
46–49 architecture/operations track, and this document does not attempt to
invent such a mapping.

## 2. Completed Architecture/Operations Timeline

All SHAs below were verified directly against `git log` at the time this
document was written (base: `main` @ `5c397fc9578aa79e12e2aec73f3e31d7e893fd81`).

| Item | Source document | Commit SHA(s) |
|---|---|---|
| Phase 46B — Council Skills Design | `docs/architecture/COUNCIL_SKILLS_46B_DESIGN.md` | `8abfce3` |
| Phase 46P — Authenticated Approval Issuance Surface | `docs/architecture/PHASE_46P_APPROVAL_ISSUANCE_SURFACE.md` | `c20acac` |
| Phase 46P-A — Environment-Aware Action Route Policy | `docs/architecture/PHASE_46P-A_ACTION_ROUTE_POLICY.md` | `ba501da` |
| Phase 46P-E — Memory Authority Implementation | `docs/architecture/PHASE_46P-E_MEMORY_AUTHORITY.md` | `edc1fbf` |
| Phase 47A — Commander Runtime Diagnostics | `docs/architecture/COMMANDER_RUNTIME_DIAGNOSTICS.md` | `954ac4c` (initial trace capture), `7b414c7` (trace linkage/isolation repair), `fb32190` (finalize — doc states "Phase 47A is closed") |
| Phase 47B Stage A — Discipline Registry | `docs/architecture/DISCIPLINE_REGISTRY.md` | `5211726` |
| Phase 48-OPS-A, Batch 1 | (git history only; no dedicated architecture doc found) | `20bcbab` |
| Phase 48-OPS-A, Batch 2 | (git history only; no dedicated architecture doc found) | `5647ed9` |
| Phase 48-OPS-A, Batch 3 | (git history only; no dedicated architecture doc found) | `242d8ec` |
| Phase 48-DB-A build package | `docs/architecture/PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md` | `7b7dc4f` (package), `569b4c9` (execution-evidence requirements doc) |
| Phase 48-C4C | `docs/architecture/INCREMENTAL_COUNCIL_TRANSPORT.md` | `db0f848` |
| Phase 48-C4D | `docs/architecture/PHASE_48_C4D_COUNCIL_RUNTIME_TRUTHFULNESS_AND_RESPONSE_INTEGRITY.md` | `48c1dc1` (main pass), `370577c` (`app/page.tsx` fragment) |
| Phase 49-A | `docs/architecture/PHASE_49_A_RUNTIME_TRUTHFULNESS_UI_SWEEP.md` | `f0c7e3f` (25-file sweep), `085dc9f` (DockPanel finalize), `9f24ecc` (`app/page.tsx` fragment) |
| Native Builder (no phase number — named subsystem) | `docs/architecture/NATIVE_BUILDER_ARCHITECTURE_AND_GOVERNANCE.md` | `64ac14e` (initial), `6757ce7` (Commander approval gate for live research) |
| Sovereign Model Lab (no phase number — internally "Phase 1 + Phase 2A" per its own source comments only) | `docs/architecture/SOVEREIGN_MODEL_LAB_ARCHITECTURE_AND_GOVERNANCE.md` | `fb2aa74` (initial), `90d07ef` (tokenizer-execution approval gate), `c78195e` (isolated storage-root validation) |
| Live Council: Incremental Transport and Persona Cluster (no phase number — named subsystem) | `docs/architecture/LIVE_COUNCIL_INCREMENTAL_TRANSPORT_AND_PERSONA.md` | `7a9e2a9` (main pass), `c610304` (`app/page.tsx` fragment) |

Adjacent, standalone fix not tied to a named phase, landed in the same
commit range: `7ec3158` (operator self-repair infinite-recursion fix).
Recorded here for completeness only.

Phase 48-C4C's row above rests on real repository evidence: its own
architecture document (`docs/architecture/INCREMENTAL_COUNCIL_TRANSPORT.md`)
exists and was introduced by `db0f848`. No dedicated commit or document was
found using the exact label "Phase 48-C4A" or "Phase 48-C4B" individually —
they are referenced only as prior context inside the C4C and C4D documents
— so they are not given their own row here.

## 3. "Release B" Is Not a Formal Roadmap Phase

**"Release B" was the title given to GitHub PR #1** (which merged the
Phase 48-C4D, Phase 49-A, Native Builder, Sovereign Model Lab, and Live
Council Incremental Transport/Persona items above into `main`). It does not
appear in any architecture, roadmap, or planning document. It is a PR label,
not an existing or authorized roadmap phase, and should not be treated as
one in any future planning.

## 4. Status Categories

### COMPLETE
- Phase 46B — Council Skills Design
- Phase 46P — Authenticated Approval Issuance Surface
- Phase 46P-A — Environment-Aware Action Route Policy
- Phase 46P-E — Memory Authority Implementation
- Phase 47A — Commander Runtime Diagnostics (its own document states
  "Phase 47A is closed")
- Phase 47B Stage A — Discipline Registry. **Stage A only.** The source
  document's own title is "Phase 47B Stage A — Discipline Registry"; no
  evidence of further completed stages of Phase 47B was found, so this
  entry should not be read as claiming all of Phase 47B is complete.
- Phase 48-OPS-A (Batches 1–3)
- Phase 48-C4C — see section 1 for its documented relationship to
  Phase 48-C4A/C4B/C4D; no dedicated C4A or C4B document or commit exists
- Phase 48-C4D
- Phase 49-A — **substantively complete.** Its own completion document
  (`docs/architecture/PHASE_49_A_RUNTIME_TRUTHFULNESS_UI_SWEEP.md`, section
  21, criterion (e)) contains stale pre-commit wording: it literally states
  "no commit, push, or deploy has occurred (true)," which was true only at
  the moment that document was written, before `f0c7e3f`, `085dc9f`, and
  `9f24ecc` were committed and later merged to `main`. The substance of the
  phase (file/symbol ownership confirmation, validation runner, TypeScript/
  ESLint/build results) was independently satisfied; the document's text
  simply predates the commits it now describes as not-yet-made.
- Native Builder
- Sovereign Model Lab
- Live Council: Incremental Transport and Persona Cluster

### OPERATIONAL FOLLOW-UP — REQUIRES EXPLICIT AUTHORIZATION
- **Phase 48-DB-A production SQL execution.** The repair package itself
  (`7b7dc4f`, documented further by `569b4c9`) is built and on `main`, but
  per `docs/architecture/PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md`: *"It is
  build-only until Mark authorizes SQL execution and Claude Code
  independently validates the package"* and *"no SQL in this package has
  been executed against Production or Supabase."* This document does not
  execute that SQL, does not validate it, and does not imply any
  authorization has been granted. Execution remains gated on: (1)
  independent security validation, and (2) Mark's explicit authorization of
  the exact SQL artifact, per the source document's own "Execution
  Authorization" section.

### PROPOSED / NOT YET AUTHORIZED
- None. No new implementation scope is proposed by this document (see
  section 5).

### UNMAPPED LEGACY ROADMAPS
- Platform Phase A–D (`docs/runtime-roadmap.md`)
- Aspirational Phase 8–10 (`docs/phases/phase-8.md`, `phase-9.md`,
  `phase-10.md`, `docs/phases/future-vision.md`)

Both remain valid long-range direction documents. Neither is superseded,
contradicted, or advanced by this roadmap; they are simply unmapped to the
46–49 architecture/operations track indexed above.

## 5. Next Phase Decision Gate

No new phase number, implementation scope, or branch name is defined by
this document. Specifically, this document does **not** define, imply, or
reserve a "Phase 49-B," "Phase 50," or any other successor phase.

Before any new implementation branch is created, the Commander must
explicitly select the next product objective. That selection must specify,
at minimum:

1. A phase identifier (or explicit confirmation that no phase number
   applies).
2. A scope statement describing what will and will not change.
3. Acceptance criteria the work must satisfy to be considered complete.
4. Which of the three schemes in section 1 (if any) the objective belongs
   to, or confirmation that it belongs to none of them.

Until that selection is made, this document is a reconciliation record
only — it does not authorize, define, or begin any new implementation
work.

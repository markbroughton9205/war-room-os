# Native Builder: Architecture and Governance

This document describes what the Native Builder subsystem's code actually does and actually
restricts, verified by direct source inspection and by `scripts/run-native-builder-validation.mjs`
(84/84 checks). It does not describe intentions or a roadmap — every claim below is either a cited
source location or a passing automated check. Where a real capability exists that a naive reading
of the subsystem's name might not expect (e.g. real outbound network calls in one file), it is
stated plainly rather than omitted.

**Commander hardening decision (post-commit 64ac14e):** session authentication alone is not
sufficient authority for Native Builder to make Tavily searches, direct external fetches, or any
other non-local network request. Live research now requires an explicit, request-bound Commander
approval on every call — see section 15.

## 1. Designation And Status

Native Builder is implemented and present in the working tree; as of this document, four commits
exist ahead of it in this branch's history (Phase 48-C4D, Phase 49-A, the Operator self-repair
storage fix, and a DockPanelContent wiring fix) and the Native Builder subsystem itself is
committed at `64ac14e`. This follow-up hardening (the live-research approval gate) is a separate,
focused fix on top of that commit, not yet committed itself at the time this section was written.
This document, the fixture-classification fix, the resolve-route approval-gate fix, and the
extended static safety suite were produced together as one completion pass. `npm run build`,
`npx tsc --noEmit`, and ESLint on owned files all pass (see section 23).

## 2. Purpose

Native Builder detects, diagnoses, and — only with explicit Commander approval before any file is
written — repairs small, well-understood classes of code defects in this repository (a TypeScript
error, an ESLint violation, a build failure, a reported panel crash, a known repeat pattern like an
off-by-one loop bound or a duplicated import). It is explicitly **not** a general autonomous coding
agent: `lib/native-builder/types.ts`'s file header states this directly — "the first subsystem in
this repo allowed to actually apply a file patch," contrasted with every other repair-adjacent
system in the codebase (`lib/operator/selfRepair`, `lib/red-team-coder/repairPlanner`,
`lib/council-repair/model.ts`, `lib/runtime/runtimeRepairMap.ts`), which remain advisory-only by
design. Every patch this subsystem writes must pass a deterministic structural policy gate
(`patchPolicy.ts`) and every repair must be explicitly approved by the Commander before it is
applied, and again before it is finally accepted.

## 3. Owned-File Map

**`lib/native-builder/`** (16 files): `types.ts` (domain types, state machine, terminal-operation
registry), `runtime.ts` (the only orchestrator — drives every state transition), `patchApplier.ts`
(the only file that calls `writeFile`), `patchPolicy.ts` (the deterministic safety gate),
`rollback.ts` (content-level snapshot/restore), `repositoryInspector.ts` (the only read path,
denylist-enforced), `validationRunner.ts` (the only process-execution path, fixed argv only),
`storage.ts` (JSON persistence under `.war-room/native-builder/`), `repairVerifier.ts` (resolution
proof), `repairPlanner.ts` (deterministic templates + local-model + advisory-council reasoning),
`repairScopeClassifier.ts` (pure regex classification, no I/O), `issueIngest.ts` (pure data
shaping, no I/O), `immunity.ts` (honest regression-artifact derivation), `intelligenceMission.ts`
(reuses the pre-existing live research router — see section 15), `systemHealthSnapshot.ts`
(projects the pre-existing canonical runtime status), `ollamaClient.ts` (local-only HTTP client).

**`lib/native-builder/__fixtures__/`** (3 files, non-production — see section 24):
`knownIssueFixture.ts`, `knownIssueFixture.validation.ts`, `patchApplierScratch.ts`.

**`app/api/native-builder/`** (12 route files): `status`, `issues`, `repair-system`,
`system-health`, `intelligence-mission` (top-level); `repairs`, `repairs/[id]`,
`repairs/[id]/plan`, `repairs/[id]/approve`, `repairs/[id]/resolve`, `repairs/[id]/rollback`,
`repairs/[id]/cancel`.

**UI**: `app/native-builder/page.tsx`, `components/war-room/native-builder/NativeBuilderPanel.tsx`.

**Validators**: `lib/native-builder/nativeBuilder.validation.ts` (+ `scripts/run-native-builder-
validation.mjs`, the release gate — 74/74), `lib/native-builder/__fixtures__/
knownIssueFixture.validation.ts` (+ `scripts/run-native-builder-fixture-validation.mjs`, a live
demonstration script excluded from the release gate — see section 24),
`lib/native-builder/systemHealthAndIntelligence.validation.ts` (+ `scripts/run-system-health-
intelligence-validation.mjs`, excluded from the release gate — see section 23).

## 4. Entry Points

The only entry point into a repair's state machine is `lib/native-builder/runtime.ts`. Every other
file that mutates a `NativeRepairRecord`/`NativeIssueRecord` does so only by calling into
`runtime.ts`'s exported functions (`reportIssue`, `planRepair`, `approveAndApply`,
`commanderResolve`, `rollbackNow`, `cancelRepair`, `runRepairSystemSweep`) — mirroring the same
"storage/leaves never call back into the driver" discipline established by the Operator
self-repair-storage recursion fix.

## 5. UI Exposure

One page, `/native-builder`, rendering `NativeBuilderPanel`. The panel shows System Health
(healthPercentage, evaluated/total checks, unresolved-issue count, active-repair count), a
`[ REPAIR SYSTEM ]` sweep button, an issue-report form, a repair list, and — for a selected repair
— its issue, diagnosis (including any advisory council opinions), planned changes, patch-policy
result, live validation results, diff evidence, immunity outcome, and Commander action buttons
(Request re-analysis, Approve local repair, Accept repair, Reject plan, Cancel, Rollback). This
panel is not currently mounted anywhere else in the app (confirmed: no other component imports
`NativeBuilderPanel`); it is reachable only via its own route.

## 6. API Routes

| Route | Method | Mutates files? | Approval-gated? |
| --- | --- | --- | --- |
| `/api/native-builder/status` | GET | No | N/A (read-only) |
| `/api/native-builder/issues` | GET/POST | No (creates issue/repair *records*, not file patches) | No — not dangerous per this codebase's action-kind taxonomy |
| `/api/native-builder/repair-system` | POST | No | No — read + issue-creation only |
| `/api/native-builder/system-health` | GET | No | N/A |
| `/api/native-builder/intelligence-mission` | POST | No (network read only) | No — see section 15 |
| `/api/native-builder/repairs` | GET | No | N/A |
| `/api/native-builder/repairs/[id]` | GET | No | N/A |
| `/api/native-builder/repairs/[id]/plan` | POST | No (inspection + reasoning only) | No |
| `/api/native-builder/repairs/[id]/approve` | POST | **Yes** — the only route that writes a patch | **Yes** — `assertAutoOrApproval`, `actionKind: 'file_modification'` |
| `/api/native-builder/repairs/[id]/resolve` | POST | Only when `accepted: false` (triggers rollback) | **Yes when `accepted: false`** — `assertAutoOrApproval`, `actionKind: 'rollback'` (fixed in this pass — see section 21) |
| `/api/native-builder/repairs/[id]/rollback` | POST | **Yes** | **Yes** — `assertAutoOrApproval`, `actionKind: 'rollback'` |
| `/api/native-builder/repairs/[id]/cancel` | POST | No (only legal pre-apply) | No |

## 7. Authentication Requirements

`middleware.ts` applies `lib/supabase/middleware.ts`'s session gate to every request path except
static assets, matching all `/api/native-builder/*` routes; no Native Builder route appears in this
codebase's public-API exemption list (confirmed by direct grep — zero matches for `native-builder`
in `lib/supabase/middleware.ts`). A session is required to reach any Native Builder route.

## 8. Authorization Requirements

Beyond session authentication, file-mutating actions require the codebase's existing standing-
permission gate (`lib/permissions/policy.ts`): `file_modification` and `rollback` are both in
`DANGEROUS_ACTION_KINDS`, which `assertAutoOrApproval` never auto-allows regardless of standing
mode — a request must carry `approval_granted: true` in its JSON body. Native Builder introduces no
new authorization primitive; it reuses the same gate that governs every other dangerous action in
this application.

## 9. Commander Approval Gates

Two real, enforced gates exist in the state machine (`lib/native-builder/types.ts`'s
`NATIVE_REPAIR_TRANSITIONS`): (1) `planning` → `awaiting_local_execution_approval` → `applying_patch`
— a plan can never advance to `applying_patch` except through the approval state, and
`approveAndApply()` itself throws if called with `approvalGranted !== true`; (2)
`awaiting_commander_review` → `resolved` — only `commanderResolve(id, true)` can mark an issue
resolved. Both gates are proven, not just described: `state_03_planning_cannot_skip_approval_to_apply`
and `e2e_05_state_awaiting_approval`/`e2e_13_commander_accept_marks_resolved` in the validation
suite.

## 10. Repository-Read Authority

`repositoryInspector.ts` is the sole read path. It denies: any path resolving outside the repo root
(`resolveRepoRelativePath`), any path touching `node_modules`, `.git`, `.next`, `.war-room`,
`.turbo`, `dist`, `build`, `coverage`, and any file matching `.env*`, `*.pem`, `*.key`, `id_rsa*`,
or names containing `credentials`/`secret` (case-insensitive). Reads are capped at 512KB and text
search is capped at 4000 files walked / 200 results. Proven by `containment_01`–`containment_05` in
the validation suite (path traversal, `.env.local`, `node_modules`, `.git/config` all rejected;
a valid in-repo path resolves).

## 11. Repository-Write Authority

`patchApplier.ts` is the sole write path (the only file in the subsystem that imports `writeFile`).
Every write is preceded by a rollback snapshot and gated by `patchPolicy.ts`'s independent
re-check (never trusting the caller). A write only ever happens as the direct result of an
approved `approveAndApply()` call (see section 9) or a rollback restore. There is no code path from
issue-report, planning, or the repair-system sweep directly to a file write.

## 12. Filesystem Boundaries

`patchPolicy.ts`'s `BLOCKED_PATH_PATTERNS` refuses to touch: `.env*`, `node_modules`, `.git`,
`.war-room`, lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`), `package.json` itself
(dependency changes blocked outright), `supabase/**/*.sql` (schema migrations), `.github/workflows/`
(CI/deployment config), `vercel.json`, `netlify.toml`, `next.config.[jt]s`, `middleware.[jt]s`
(auth/routing policy), `lib/permissions/` (the approval policy itself), `lib/payments/`,
`app/api/payments/`, `lib/billing/`, and any path matching `secret`/`credential`. Only `.ts`,
`.tsx`, `.js`, `.jsx`, `.mjs`, `.md` extensions are writable at all. A single patch is capped at 5
files / 150 changed lines (`MAX_CHANGED_FILES`, `MAX_CHANGED_LINES`). Proven by `policy_01`–`policy_06`
in the validation suite.

## 13. Shell/Process Boundaries

`validationRunner.ts` is the sole process-execution path. Every invocation is a fixed, pre-defined
argv array — `pnpm exec tsc --noEmit`, `pnpm exec eslint <files> --max-warnings=0`, `pnpm run
build`, `git diff --check`, or `node <registered-script>` — passed to `execFile` (never a shell
string). `shell: process.platform === 'win32'` is set only because pnpm resolves via a `.cmd` shim
on Windows; arguments remain an array either way, so no string-concatenation injection surface
exists. `NATIVE_TERMINAL_OPERATION_IDS` (the complete registry of everything this subsystem can
execute) contains no raw shell/exec/cmd/bash/powershell operation, no `git_commit`, and no
`git_push`. Proven by `shell_01`–`shell_04` and the new `safety_arbitrary_shell_absent_across_
owned_files` / `safety_unrestricted_git_mutation_absent_across_owned_files` checks (10/10 new
static safety assertions, section 23).

## 14. Git-Command Boundaries

The only git commands ever invoked are `git diff --check` (via `validationRunner.ts`) and
(elsewhere, pre-existing, reused) `getRepoStatus()`/`previewDiff()` from `lib/repo/status.ts` and
`lib/repo/diff.ts` for read-only status/diff. No file in this subsystem invokes `git commit`,
`git push`, `git merge`, `git reset`, `git rebase`, `git checkout`, or `git clean` — confirmed both
by the pre-existing `testNoCommitPushDeployCapability` (4 files) and the new, broader
`safety_unrestricted_git_mutation_absent_across_owned_files` check (all 27 owned files).

## 15. Network/Provider Boundaries

**This is the one section where a real, live capability exists and must not be understated.**
Three files make real network calls:

- `ollamaClient.ts` — HTTP to `http://localhost:11434` only (configurable via `OLLAMA_BASE_URL`,
  which still defaults to loopback). Never throws; returns `available: false` honestly if nothing
  is listening. Used only to generate a *proposal* — any resulting patch still passes through the
  same `patchPolicy.ts` gate as every other source (`local_model_01_cannot_bypass_path_denylist`
  proves a malicious/hallucinated model proposal touching `.env.local` is rejected identically to a
  deterministic one).
- `intelligenceMission.ts` — reuses `lib/research/researchRouter.ts`'s `runLiveResearchRouter`,
  which makes **real external HTTP calls**: a Tavily search request and an independent, SSRF-guarded
  direct URL fetch. This is pre-existing, already-audited infrastructure (the file's own header:
  "already real, already running Tavily search... as three INDEPENDENT parallel legs"), not new
  capability invented by Native Builder. It is read-only evidence gathering — no filesystem write,
  no repo mutation, no code-execution consequence from its results. It is reachable via
  `POST /api/native-builder/intelligence-mission`. This route is **not wired into the Native
  Builder UI panel** — it exists in the API surface but `NativeBuilderPanel.tsx` never calls it.
- `validationRunner.ts` — `terminalDevServerStatus()` calls `http://localhost:3000` only (a local
  dev-server liveness probe), never an external host.

Every other owned file is proven, by the new `safety_no_hidden_provider_calls_outside_declared_
network_files` check, to contain no `fetch(`/`http(s)://` reference at all. Council-family advisory
opinions (`repairPlanner.ts`'s `requestCouncilOpinions`) are wired via dependency injection and are
**never called by any current route** — no route in section 6 passes `councilFamilies`/
`councilInvoke` to `planRepair`. This path is present in the code but currently unreachable through
the live API surface.

### 15a. Live-Research Approval Gate (Commander Hardening Decision)

**Session authentication alone is necessary but not sufficient authority for live research.**
`assertLiveResearchApproved()` (`lib/native-builder/intelligenceMission.ts`) is a pure, side-
effect-free gate that `POST /api/native-builder/intelligence-mission` calls *before*
`runGlobalIntelligenceMission` is ever invoked — a blocked result guarantees zero Tavily/fetch
calls were attempted for that request (proven by `research_03_blocked_case_makes_zero_network_calls`,
which injects a call-counting stub in place of the real router and asserts the count stays `0`).

All four of the following must hold, checked fresh on every single call:

1. **A valid authenticated session.** `middleware.ts`'s `updateSession()` already blocks any
   unauthenticated request from reaching this route at all (section 7); the gate function still
   declares `hasSession` as its own explicit, independently unit-tested parameter rather than
   silently assuming truthiness (`research_01_unauthenticated_rejected`).
2. **The current permission state permits the action.** Read via the existing
   `fetchWarRoomPermissionsState()` — if the standing safety lock is active, live research is
   blocked outright, with **no override** for this action (unlike the standing auto-allow catalog's
   `standing_override` mechanism). This is intentionally stricter than the pre-existing dangerous-
   action pattern (`file_modification`/`rollback`), which lets `approval_granted: true` bypass the
   lock; live research does not get that bypass (`research_08_safety_lock_blocks_even_with_valid_
   approval`).
3. **An explicit, well-formed approval for this exact action.** The request body must carry a
   `liveResearchApproval` object shaped `{ kind: 'native_builder_live_research', granted: true,
   decreeTextHash: <sha256 of decreeText> }`. None of the following ever count as approval — each is
   explicitly tested and rejected: a signed-in session alone, visiting the Native Builder page,
   creating or approving a repair plan, an approval object with the wrong `kind` (e.g. one meant for
   `file_modification`), a bare `{ approval_granted: true }` with no `kind`/hash at all, or a missing/
   truncated/wrong-type `decreeTextHash` (`research_02`, `research_06`, `research_07`).
4. **The approval is bound to this one request's exact mission text.** `decreeTextHash` must equal
   `sha256(decreeText)` for *this* request. An approval minted for one decree's text does not
   authorize a different decree — proven by `research_05_approval_not_reusable_across_missions`,
   which mints a valid approval for "Mission A decree text" and shows it is rejected against
   "Mission B decree text". Nothing about this approval is stored server-side between requests —
   there is no session flag, no standing toggle, and no cached "already approved" state a second
   call could rely on. **No standing or background live-research permission exists anywhere in this
   subsystem.**

`research_10_no_hidden_ungated_route_starts_the_mission` scans every owned file for any call site
of `runGlobalIntelligenceMission` other than its own definition, and confirms the one real caller
(`intelligence-mission/route.ts`) is the only one, and that it references the gate. There is
currently exactly one route capable of triggering a live mission, and it is gated.

**Local Ollama access does not require this gate, and this fix did not broaden its authority.**
`ollamaClient.ts` targets `localhost:11434` only, with no external fallback anywhere in its source
(confirmed: no non-loopback URL literal exists in the file). It is local-machine network access, not
external research, and it never itself mutates anything — any patch a local-model proposal produces
still must pass through the separate, already-gated `/approve` file-write flow (section 9) before
anything happens. Under current policy this file is explicitly exempted from the live-research
approval requirement (it is one of the three files listed in `NETWORK_ALLOWED_FILES` alongside
`intelligenceMission.ts` and `validationRunner.ts`'s local dev-server probe), and this pass leaves
it exactly as it was — no new capability, no new gate, no removed restriction.

## 16. Database/Supabase Boundaries

Native Builder's own state (`NativeIssueRecord`, `NativeRepairRecord`) is stored as JSON files under
`.war-room/native-builder/` (`storage.ts`), not Supabase — a deliberate choice to avoid a new
migration for local dev-runtime state. `intelligence-mission`'s route passes a Supabase client
through to `runGlobalIntelligenceMission`, but `intelligenceMission.ts` never calls a Supabase
method on it directly in the code paths exercised here — check `safety_supabase_privilege_mutation_
absent_across_owned_files` confirms no owned file matches `service_role`, `rolbypassrls`, `ALTER
DEFAULT PRIVILEGES`, or an admin grant/revoke pattern, and `safety_sql_execution_absent_across_
owned_files` confirms no owned file matches raw SQL execution patterns. No Native Builder file
touches Phase 48-DB-A's files or scope.

## 17. Deployment Boundaries

No file in this subsystem references `vercel deploy`, `pnpm run deploy`, `netlify deploy`, or any
CI/deployment config path (`.github/workflows/`, `vercel.json`, `netlify.toml` are all in
`patchPolicy.ts`'s denylist, so even a *patch* could never touch them). Proven by
`safety_deploy_command_absent_across_owned_files`. The `/status` route self-declares this
explicitly in its own response: `autoDeployCapable: false`.

## 18. Rollback Model

`rollback.ts` implements real, content-level rollback (a gap the Phase 1 audit found nowhere else
in this repo — existing checkpoint metadata recorded *that* something changed, not the prior
content). Before every write, `snapshotFileBeforePatch()` records the exact pre-patch content (or
`existedBefore: false` for a newly created file) under `.war-room/native-builder/snapshots/<repairId>/`.
`rollbackRepair()` restores every snapshotted file to that exact content, in reverse apply order, or
deletes a file the patch created. Both the mid-apply transactional rollback (`patchApplier.ts`: any
file failing in a multi-file patch reverts everything already written in that run) and the
explicit post-acceptance rollback (`rollbackNow`, reachable from `resolved` state) are proven by
`apply_02_roundtrip_replace_and_rollback`, `apply_03_create_file_then_rollback_deletes_it`, and
`e2e_15_rollback_restores_original_fixture`.

## 19. Audit Logging

Every state transition calls `logWarRoomRepoAudit('native-builder: ...', { repairId, state,
issueId })` via `runtime.ts`'s `persist()` helper — issue detection, occurrence merges, evidence
collection, planning, apply attempts (success and failure), verification outcomes, Commander
accept/reject, and rollback are all logged. This reuses the pre-existing `lib/war-room/repoAudit.ts`
audit sink rather than inventing a parallel logging path.

## 20. Failure Handling

A failed patch application rolls back everything written in that run and transitions to `blocked`
(never leaves a half-applied state). A validation failure or a recurred issue fingerprint blocks
resolution (`verification_blocked` → `verification_failed`, never `resolved`) —
`repairVerifier.ts`'s header states this as a hard rule: "War Room must never mark an issue resolved
because a patch was applied." A verification that passed but didn't directly re-check the original
failure class is labeled `partially_verified`, not silently folded into `resolved` — an honest,
distinct outcome the Commander sees before deciding.

## 21. Prohibited Autonomous Actions

Confirmed absent, by direct source inspection and by the new static safety suite (section 23):
commit, push (including force push), merge, deploy, SQL execution, Supabase privilege/role
mutation, secret/credential value access or logging, raw/arbitrary shell execution, background
autonomous scheduling (`setInterval`/cron/queue-processing — none found; `autoRepairMode` defaults
`false` and is never set `true` anywhere in the owned source). **One real gap was found and fixed in
this pass**: `POST /api/native-builder/repairs/[id]/resolve` with `{ accepted: false }` calls the
exact same file-restoring `rollbackRepairFiles()` mutation as `/rollback`, but — before this fix —
did not require `approval_granted: true` the way `/rollback` does. This route now requires the same
gate when `accepted: false`, and the UI's "Reject plan" button now sends `approval_granted: true`
to match (previously it sent only `{ accepted: false }`). Proven by
`safety_every_file_mutating_route_requires_commander_approval`.

## 22. Production Enablement State

Not deployed, not pushed, not merged into `main`. The `/native-builder` page and its API routes
exist in this branch's working tree only. `autoRepairEligible`/`autoRepairMode` on every repair
record default to `false` and no code path sets either to `true` — every repair requires the manual
Commander approval flow described in section 9 regardless of how the issue was detected (including
issues opened automatically by the `[ REPAIR SYSTEM ]` sweep).

## 23. Deterministic Validation Requirements

**Release gate** (must pass before commit — all confirmed passing):
- `node scripts/run-native-builder-validation.mjs` — **84/84 PASS** (64 original + 10 static
  safety-boundary assertions [no force push, no unrestricted git mutation, no SQL execution, no
  Supabase privilege mutation, no secret dumping, no arbitrary shell, no deploy command, no hidden
  provider calls outside three declared local/reused-infra files, every file-mutating route
  requires Commander approval, no background autonomous scheduling] + 10 live-research-gate
  assertions added in this hardening pass [section 15a]: unauthenticated rejected, authenticated-
  but-unapproved rejected, blocked case makes zero network calls, approved request reaches the
  research boundary, approval not reusable across missions, malformed approval rejected, unrelated
  approval kind rejected, safety lock blocks even a valid approval, offline validation still works,
  no hidden ungated route starts the mission).
- `npx tsc --noEmit` — clean.
- ESLint on owned files — clean.
- `npm run build` — succeeds.
- `git diff --check` — clean (CRLF advisories only, no errors).

**Excluded from the release gate, by design, with reasons stated in the check's own output/comments
rather than silently omitted:**
- `scripts/run-native-builder-fixture-validation.mjs` — expected to FAIL at rest; see section 24.
- `scripts/run-system-health-intelligence-validation.mjs` — its `testLiveIntelligenceMission()`
  makes a real external network call (Tavily + a real fetch to `https://example.com`) and its
  `resetNativeBuilderState()`/`testRepairSystemSweep()`/`testIssueBadgeAccuracy()` perform real
  filesystem mutation under `.war-room/native-builder/`. Per this packet's instruction not to
  execute anything with live network/filesystem side effects as a release gate, this script was not
  run in this pass. It is not deleted or weakened — it remains available for a Commander to run
  deliberately, with real credentials and full awareness that it will make live calls and reset
  local state. The deterministic, offline release gate for Native Builder is
  `run-native-builder-validation.mjs` (above), which already exercises the deterministic subset of
  this subsystem's behavior (repair-scope classification, immunity artifacts, state-machine
  extensions) through its own coverage.

## 24. Known Limitations

- `lib/native-builder/__fixtures__/knownIssueFixture.ts` (seeded off-by-one bug) and
  `patchApplierScratch.ts` (scratch content for apply/rollback round-trip tests) are **not**
  production code, scratch debris, or duplicated logic — they are deterministic, intentionally-
  seeded test fixtures for `nativeBuilder.validation.ts`'s `testEndToEndFixtureRepair()` and
  `testStaleHashRejectionAndApplierRoundTrip()`. That suite genuinely runs the full repair pipeline
  against them (detect → plan → apply → validate → verify → accept → rollback) and unconditionally
  restores both fixtures to their known-seeded state when it finishes, regardless of outcome
  (`resetFixtureToBroken()` runs in a `.then()` after every run; the scratch round-trip test asserts
  `restoredExactly` itself). Running `scripts/run-native-builder-fixture-validation.mjs` in
  isolation, at rest, will therefore correctly report `FAIL` (`fixture_01_sum_includes_last_element`)
  — this is proof the fixture is correctly seeded and awaiting a real demonstration, not a
  production defect. No code was changed to make this report differently; the fixture's loop bound
  was not touched. Eight near-miss tests were added to the same file in this pass (empty array, one
  element, two elements, final-of-five-elements, negative values, an all-zero blind-spot case, and
  a no-input-mutation check) — 3 of the 9 total cases pass at rest (empty array, all-zero, no-
  mutation) and 6 fail at rest (every case where the seeded bug actually manifests), exactly as
  expected.
- Static-text safety scanning (section 23's new checks) cannot prove a capability is absent from
  anything an owned file merely calls into — only that the capability is not invoked directly from
  this subsystem's own source text (comments stripped before matching, to avoid a doc comment
  masking or falsely triggering a check).
- The Council-family advisory-opinion path exists in code (`repairPlanner.ts`) but is not wired to
  any live route (section 15) — untested via the real API surface, only via direct unit calls
  (`independent_01`–`independent_03`).
- No React/JSDOM/Vitest test stack exists in this repository (pre-existing, repo-wide limitation);
  `NativeBuilderPanel.tsx`'s UI behavior is confirmed by source inspection, not a rendered-component
  test.
- `intelligence-mission`'s real network capability (section 15) is not gated by the dangerous-action
  approval gate. This matches the codebase's existing precedent (`/api/income/search`), but the
  Commander should be aware this is a discretionary continuation of an existing pattern, not a new
  policy decision made unilaterally in this pass.

## 25. Completion Criteria

This pass is complete when: (a) every owned file has been read and classified (done — section 3);
(b) the fixture-validation "failure" has a proven root cause and a resolution consistent with not
touching the seeded bug, not weakening the validator, and not hiding the fixture (done — section
24, zero changes to fixture business logic, 8 new near-miss tests added); (c) this document exists
and covers all 25 required sections (done); (d) the release-gate validator passes deterministically
offline (done — 84/84, including 10 static safety assertions and 10 live-research-gate assertions);
(e) `tsc`, ESLint, `build`, and
`git diff --check` all pass (done — section 23); (f) any real capability contradicting the required
boundary list is either fixed or explicitly reported (done — section 21's resolve-route gate gap
was fixed; section 15/24's network/live-validator findings are reported, not hidden). Committing
this work to version control, pushing, merging, and deploying are separate, later steps not
authorized by this document.

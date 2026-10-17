# Foundry Full Autonomy: one sentence starts a tracked, verified engineering mission

Branch `foundry/full-autonomy` (worktree `~/Codex/war-room-os-autonomy`), based on canonical source `55824923` (`live-council-intelligence-repair`). Not merged, not pushed, launcher not repointed. Validation: `pnpm run validate:foundry-autonomy` (`AUTONOMY_ONLY=O,K` runs chosen sections).

## 1. Architecture (extends the existing mission engine; no second engine)
`lib/agents/ops/engineering/autonomy/`
- `controller.ts` — persistent command controller around `missions/*`. A *command* = the Commander's sentence; it owns an ordered list of *steps* (subtasks), each step one or more real missions. State is durable JSON (`<agent-foundry>/autonomy/commands/`), advanced by a single-flight, bounded `advance()` (called after submit, on every supervisor tick and on reads of nothing else), so a restart continues where it stopped.
- `interpret.ts` + `recipes.ts` — sentence → plan: classification, repository discovery (names, paths, content hits, with reasons), derived acceptance criteria, decomposition by area into chained subtasks (each seeded from the previous subtask's integrated commit via `source.ref`), recipe for a recognised class (pointer/cursor: logic module + client component + global mount, with a **hidden independent verifier** and a real-input UI proof spec). Model help is optional, validated, and only used when the builder is already resident.
- `strategy.ts` — failure diagnosis (INFRA / VERIFIER / TESTS / GATE / INTEGRATION / INSTALL / ENGINE) with fingerprints and a repair ladder `initial → diagnosed → reverse-context → split`; no strategy is used twice for one step.
- `ssr.ts` + `missions/runner.ts` — before integration, application code is scanned for browser-global reads during render; hazards are repaired with the exact lines named.
- `uiproof.ts` — boots the freshly built installation (inside bwrap: read-only host, empty HOME, private data dir) and drives real Chrome (CDP over a pipe, no TCP debugging port) with real mouse events.
- `promote.ts` — reversible promotion (backup copy, atomic launcher rewrite, `rollbackPromotion`); refuses a build whose Electron sandbox helper is not root-owned/setuid or that was built from a dirty tree.
- `config.ts` / `capabilities.ts` / `resources.ts` — Commander authority (persisted once), Emergency Stop file, probed OS capabilities, GPU/RAM governance.
- `runtime/activity.ts` — registry of child processes and in-flight model calls that Emergency Stop terminates.
- UI: `FoundryAutonomyCenter` (Agent Ops top), `FoundryCommandStrip` (Foundry composer; messages starting "Foundry," go to the controller). API: `/api/foundry/autonomy`. Council: `lib/intent-prerouter/foundry.ts` hook in `/api/chat` (local `lcnv_…` conversation ids included) → `createCouncilMissionService().command()` → same controller.

## 2. Authority and execution model
- Full Autonomy is a one-time Commander switch (default OFF). Deployment authority is separate (default OFF). Settings persist and are audited (`settings-history.jsonl`).
- Within workspaces and git branches Foundry edits, builds, tests, repairs, commits and builds versioned installs without per-step approval. It never uses sudo (probed: UNAVAILABLE), never creates accounts or spends money (always NOT_AUTHORIZED), cannot write security/build/config surfaces (`SENSITIVE_WRITE`, extended to the engineering kernel, `app/api/foundry/`, intent pre-routers, `.gitattributes`).
- Every entry point (command box, Council, the legacy form) goes through `RunnerDeps.guard`: Emergency Stop and Pause refuse create/launch/resume.
- Delivery ladder (never merged): code generated · tests passed · independent verification · build created · installed · running (only after real input) · promoted.

## 3. Real acceptance run (isolated: port 3871, data dir `~/.local/share/war-room-os-autonomy-accept`, target worktree `~/Codex/war-room-os-autonomy-target`; the live War Room on 3847/3848 was never touched)
Evidence: `~/WarRoomProjects/autonomy-evidence/` (`run1-first-attempt-failed`, `run2`, `run3`–`run5`, `run6` recovery, `run8` Council + Emergency Stop, `final/` command JSON + proof screenshots).
Honest history of the spaceship command `cmd-20261017T091146-3828853b` (one command, never duplicated):
1. Run 1 (cmd-…085404): two attempts failed identically — the engine runs the independent verifier *before* it writes test files, and my recipe verifier required the test file. Fixed (verifier tolerates missing tests; controller requires the planned test file afterwards). That command was cancelled.
2. Run 2: mission passed verification, repaired a TypeScript gate failure itself, then `next build` failed while prerendering: the model-written component read `window.matchMedia` while rendering. Installation correctly rolled back; command BLOCKED honestly.
3. Fixes found by that: build-failure repair chain, exact build-error capture, SSR hazard scan naming the line (builder repair attempts had produced NO_CHANGE because they were not told the line), "continue from checkpoint" (same command, no duplicate), validator deadlock fix.
4. Continued: the SSR pre-check found the hazard, repaired it, verification and gates passed, versioned install built: `~/.local/opt/war-room-os-0.2.0-2f4d75ff-foundry-b16e790f`.
5. The first real-input proof failed on 5 checks — two defects of *my proof*, not the build: headless Chrome reported `(pointer: none)` (the model's fine-pointer gate was correct), and the model put the test id on a full-viewport wrapper. Fixed both; "continue" re-proved the existing installation (no new mission): 16/16 checks pass (ship follows pointer at distance 0 px, native cursor hidden, click emits a pulse that is removed, click/selection/drag still work, toggle back to standard cursor and persistence across reload). Screenshots in `final/ui-proof/`.

Other live proofs: hard `SIGKILL` of the server mid-mission → after restart the same mission resumed from its checkpoint automatically and was delivered (`run6`); Council "Council, build a small helper…" → Foundry mission in the same conversation, Emergency Stop in 27 ms (model call aborted, mission checkpointed, both entry points refused new work), clear + restart, delivered, progress and result messages written into the same conversation (`run8`).

## 4. Independent reviews
Review 1 (before activation): 17 findings; fixed — Chrome debugging port reachable from the sandboxed app (now a pipe), proof hang (deadlines, signal-killed process), directory-wide write-scope fallback and engineering-kernel paths (blocked), promotion/finalize ignoring Emergency Stop/Pause, step-skipping races (guards), "Council," over-matching, false "driven with real input" claim, config fail-closed, rollback path/launcher shape checks, no advance on GET. Review 2 covers the later changes (see completion report).

## 5. Limitations (status re-verified 2026-10-17 against the source at `bba19fc5`)
Resolved since the first version of this document (each by a commit and a passing check in `validate:foundry-install` / `validate:foundry-autonomy`):
- **Model-written build code is sandboxed.** `installRuntime` (`b5a95df4`, `eeed5d64`) builds in a scratch worktree with a read-only host, an empty private HOME and **no network**; if the sandbox is unavailable it refuses to build rather than build unsandboxed (I09, I16). The repository only advances by one fast-forward after the whole build succeeded (I01, I05, I11-I14).
- **Emergency Stop during an install is safe.** The build is killed, the install fails truthfully, the repository is untouched and the scratch is removed because cleanup runs outside the stop (I07, I08). A crash's leftovers are removed by a janitor that spares live missions (I15).
- **Recovery**: failures are classified by cause, decided on evidence, escalated only to locally qualified specialists, bounded by budgets, and a failed deployment health check rolls back automatically (`5b0eb2f0`).

Still true:
- Emergency Stop kills processes registered in the *serving process*; a worker in another process is stopped by the stop file/lease, not killed.
- A new Electron install needs its `chrome-sandbox` root-owned 4755 to launch natively; Foundry cannot run sudo. Promotion is refused until that is true.
- Pause takes effect at the next safe boundary; verify/apply/install phases finish first.
- Discovery is heuristic: a request that matches no file is refused with instructions rather than guessed.
- A command that exhausts its mission budget ends `BLOCKED` with the reason (observed on the Autonomy Control Center timing request: 12 missions, stopped instead of looping).

## 6. Rollback
Nothing canonical was changed. To discard: `git worktree remove ~/Codex/war-room-os-autonomy` (branch `foundry/full-autonomy`) and the target worktree/branch `foundry/autonomy-accept`; installs under `~/.local/opt/*-foundry-*` are additive and can be deleted. A promotion (never performed) is undone with `cp -p <launcher>.rollback-<sha>-<ts> <launcher>` or the `rollback-promotion` API action.

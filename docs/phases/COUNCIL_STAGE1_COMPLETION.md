# Council Stage 1 — completion receipt

Branch `council/stage1-intelligence`. Installed build under test: `war-room-os-0.2.0-d70d69d5-council-stage1`
(commit `d70d69d5bd0968c2011f2c1773903471b8eae3bf`, tree `e6e37fc3e11766fe40c171160102c5fb67487306`, clean).
This document is the only change after that commit; it is documentation.

## Result

**COUNCIL_STAGE1_COMPLETE** for the isolated installed runtime. Not yet promoted to the canonical War Room (see "Before promotion").

## How it was tested

The installed package (`.deb` extracted to `~/.local/opt/<id>`) was run as its own UI server on `127.0.0.1:3001` with its own data
directory (`~/.local/share/war-room-os-council-stage1-final3`). Port 3001 is already an allowed local origin; no security setting was
changed. The canonical launcher (`~/.local/bin/war-room-os-user`) and the canonical runtime on 3847/3848 were not touched.
Scenarios were driven through the real Council UI in a browser, not scripted mocks. The model for every member turn was the one
local model `huihui_ai/qwen3-abliterated:14b` served by Ollama (no cloud provider keys are configured in this environment).
Evidence export: `<data dir>/evidence/stage1-conversations.json` (turn records + persisted messages) and screenshots.

## Results

| | Scenario | Result | What the record shows |
|---|---|---|---|
| A | Self-knowledge: "What's your purpose inside War Room?" | PASS | `stage1_self_knowledge`, no member and no model call, no external research. Installed state (install stamp, registry roster) is separated from `[PLANNED]` Stage 2/3 items; the shared-model note is stated. |
| B | Language: slang, misspelling, follow-up, correction, back-reference | PASS | "yo wats foundry do in war rom" normalised (`wats`→what is, `war rom`→war room) and answered as a Foundry question; "and the sandbox part?" stays on Foundry; "no i meant the build sandbox not the browser one" is acknowledged and answered; "what did u say before about it" resolves `it`→Foundry and quotes the earlier reply from the conversation record. |
| C | Group discussion (architecture question) | PASS | ORION, then LUMEN (responding to ORION), then AURORA (responding to both) — three separate model turns, each with model `huihui_ai/qwen3-abliterated:14b`, provider `ollama`, latency, and `respondsTo`. Disagreement is visible in the text; the record states that the members share one model. |
| D | Research integrity | PASS | Real retrieval (arXiv, Crossref, NCBI via the research router): 24 considered, 4 accepted, 20 rejected with reasons (`no usable content retrieved` 12, `off-topic` 8). Status requires two accepted sources that each address most of the question's key terms, otherwise PARTIAL with the reason. Tools that ran are listed. |
| E | Session persistence | PASS | After a graceful restart of the installed runtime, all four conversations returned from the server with identical message counts, roles, model attribution and Stage 1 turn records; the research record stayed attached to its own session; "what did lumen say before about it" was answered from the reopened thread. |
| F | Resource discipline | PASS (see limits) | Simple question = one member, one model call. Unselected family calls stay silent and are not recorded. Members run strictly one after another on one model. With the model backend made unreachable, the round is recorded `FAILED` (members UNAVAILABLE/FAILED), no assistant answer is persisted, the UI shows "Council round failed", and research with a failed round is shown PARTIAL, never complete. Canonical Foundry state and its `REPO_WRITE` lock were not touched. |

## Defects found by installed acceptance and fixed (all generic, with validator coverage)

1. Architecture/engineering/research questions were handed to the deterministic evidence-board engine, which makes no member model calls, so no real discussion happened and unrelated canned text could be returned.
2. A research question could return a stale reply from earlier mission state with no retrieval.
3. Typo repair turned "boundary" into "foundry".
4. A correction or short follow-up lost the thread subject; a back-reference could resolve to a topic a member merely mentioned.
5. Deterministic Council replies and single-member replies were never persisted as assistant messages (lost after reopen); message rows carried no model/provider.
6. The client's per-family gather caused one simple question to produce several model calls.
7. Research status could read "completed" for loosely related sources.
8. Retrieved web text was inserted into member prompts unlabelled (independent review MAJOR-1): now sanitised and delimited as untrusted data.
9. UI research payload hard-coded `responseCompletion: 'complete'` (review MAJOR-2): now follows the real round status.
10. The recall detector could capture non-conversation questions such as "what did they say about the rate hike" (review MAJOR-3): tightened.
11. electron-builder `linux.syncDesktopName` is not a supported option: removed (`desktopName` + `StartupWMClass` already cover it).

## Validation

- `validate:council-stage1` 121/121 (was 92 at the start of this session).
- Neighbouring Council validators, all pass: session-intelligence 44/44, deliberation-pipeline 35/35, live-routing 42/42, nebula 34/34, general-local-activation 26/26, local-continuity 32/32, backend-status-ui 31/31, local-backend 20/20, identity-restoration 21/21.
- `tsc --noEmit` clean; eslint 0 errors on touched files (3 pre-existing warnings).
- Independent review (separate reviewing agent, read-only): verdict PASS_WITH_FIXES, 0 blockers, 3 MAJOR (all fixed and re-validated), minors listed below.

## Known limits (not hidden)

- All members run on one local model; they differ by role contract and prompt, not by weights. This is stated in the record.
- No Foundry mission was executing during the tests, so behaviour under simultaneous Foundry GPU load was not exercised.
- With no cloud keys, the "different expertise" comes from role contracts only.
- `addCouncilMessage` and `persistStage1Assistant` scan a conversation's messages per assistant write (O(n)); fine for current sizes, worth an indexed lookup later.
- The existing client "continue" command sends its own continuation prompt; Stage 1's persisted-record recovery applies to the bare phrase only.
- Chrome sandbox (`chrome-sandbox` root:root 4755) was not applied: the acceptance used the node-mode UI server, not the Electron GUI.

## Before promotion to the canonical War Room

`git merge-tree` of `council/stage1-intelligence` against the main lane (`861c68f5`) is conflict-free. The same unsupported
`syncDesktopName` key exists on the main lane's `desktop/package.json` and arrives with this branch's `f1525ee7`. Promotion needs the
Commander's go-ahead, a build of the merged tree, activation by the production-owner path, and the same A–F pass on the canonical runtime.

## Rollback

Nothing canonical changed. Remove `~/.local/opt/war-room-os-0.2.0-d70d69d5-council-stage1` (and the earlier intermediate installs
`-f1525ee7-`, `-9f0deab2-`, `-2031b02a-`, `-904c8931-`), the acceptance data directories `~/.local/share/war-room-os-council-stage1*`,
and branch `council/stage1-intelligence` / worktree `~/Codex/war-room-os-council`.

## NEXT STEPS FOR OPERATOR

1. **Environment changes:** none required. No new variables. `OLLAMA_BASE_URL` was used only to simulate an outage in the isolated test runtime.
2. **SQL / migrations:** none. Persistence uses the existing local-ownership SQLite store.
3. **Restart:** none for the canonical runtime (it was not changed). To try the build: run `~/.local/share/war-room-os-council-stage1-final3/start-ui.sh` (serves 127.0.0.1:3001 with its own data dir); stop it with SIGTERM.
4. **Verification routes:** open `http://127.0.0.1:3001/`, create the local commander in the isolated profile, then run scenarios A–F from the Council composer.
5. **Expected output:** self-knowledge answers with `[PLANNED]` items and no research; three named members with the same model attribution in a group question; a research reply followed by "Research status: … N accepted, M rejected" and the tools that ran; identical conversations after a restart.
6. **Feature flags:** none added.
7. **Visible UI change:** member replies carry real model attribution; research HUD shows accepted/considered/rejected honestly and "Council round failed" when a round fails.
8. **Rollback:** see above — delete the install directory and data directories; the canonical launcher and runtime were never repointed.

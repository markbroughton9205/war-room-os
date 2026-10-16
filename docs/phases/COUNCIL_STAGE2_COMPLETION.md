# Council Stage 2 — completion receipt

Branch `council/stage2-integration` (Stage 1 merged onto main lane `861c68f5`). Installed build under test:
`war-room-os-0.2.0-0b282f07-council-stage2` (commit `0b282f07`). This document is the only change after that commit.

## What exists (all verified in the installed build, through the real UI unless noted)

1. **Session cleanup.** New Chat no longer mints empty sessions (an unused empty "New Council Session" is reused; `forceNew` overrides). Sidebar:
   per-row checkboxes, Select All / Deselect All, Move to Trash, Archive, bulk Rename (prefix/suffix/numbered), "Clean up N empty sessions"
   (only unused empties: default title, no messages, no research, no mission link), Trash tab with Restore, Empty Trash and Delete Permanently
   behind a confirmation dialog (server also requires `confirm: DELETE_PERMANENTLY` and the session must already be in Trash). Counts, search and
   Trash survive a restart. Delete (×) now moves to Trash. Sessions that own a running Foundry mission cannot be trashed/purged.
2. **Stage 1 integrated** with the current Foundry lane; Stage 1 A–F re-run in the integrated app (below).
3. **Council → Foundry.** "Propose mission" drafts a proposal in the conversation; nothing runs until the Commander clicks Approve. Foundry runs it
   through its existing mission service. Status shown is only what Foundry's own records say; COMPLETED requires state COMPLETED + result COMPLETED +
   verifier exit 0 + verified receipt. The result is posted once into the same conversation (family FOUNDRY) with mission id, verifier, integration
   commit and receipt hash. Proposals persist in the conversation (server-owned; clients cannot overwrite them).
4. **Subsystems.** Terra, Terra World, Higher Vision Studios report AVAILABLE/DEGRADED/UNAVAILABLE from bounded live probes, with reasons; every
   capability is READ_ONLY and non-exposed capabilities say so. HVS is DEGRADED on this machine (`ffmpeg`/`ffprobe` missing) — shown as such.
5. **Council computer.** A visible browser work screen in the Council pane: live frame, explicit control owner (Council / You), Take Over, Return
   Control, Commander click/type/key input, secure private sign-in (the Commander types into the page; the typed text is never stored or logged —
   audit keeps character counts only; the page masks it), signed-in state reusable by Council through an encrypted trusted profile.
6. **One-GPU discipline.** While a live Foundry mission holds the GPU, Council model turns are deferred with a persisted explanation instead of
   evicting Foundry's resident model (opt-out: `WAR_ROOM_COUNCIL_GPU_POLICY=ALLOW`).

## Installed acceptance (isolated runtime, 127.0.0.1:3001, own data dir; canonical runtime untouched)

| Check | Result |
|---|---|
| Select All → Move to Trash → Trash tab → Restore → restart → Empty Trash (cancel/confirm) | PASS (real clicks; counts and Trash identical after restart) |
| Bulk rename / archive / unarchive / trash / purge-without-confirm refused / purge | PASS (installed API, owner-scoped) |
| A self-knowledge | PASS — states the installed stamp; Stage 2 listed as installed, only external-AI consultation and Stage 3 shown as PLANNED |
| B slang/typo/follow-up/correction/back-reference | PASS |
| C architecture discussion | PASS — PULSAR/ORION → LUMEN → AURORA, each a separate model turn with model attribution |
| D research | PASS — real arXiv/PubMed retrieval: 24 considered, 5 accepted, status PARTIAL with reason (none of the sources address "reducing"); not reported complete |
| E restart + reopen | PASS — sessions, messages, missions and attribution restored after three restarts |
| F failure honesty (model backend unreachable) | PASS — round recorded FAILED, UI "Council offline", no fabricated reply |
| Council → Foundry mission (installed UI) | PASS — `msn-20261016T080204-2e9b827b` COMPLETED, verifier exit 0, integration APPLIED on branch `foundry/msn-20261016T080204-2e9b827b` (commit `f0f9c65`, `add()` now `a + b`), receipt verified, result in same conversation |
| Concurrent Council + Foundry | PASS — Council turn during the live mission was deferred with an explanation; non-model features kept working |
| Subsystem probes | PASS — Terra and Terra World AVAILABLE, HVS DEGRADED (truthful) |
| Browser: Council browse, live frame, takeover, Commander sign-in, return, Council reads signed-in page | PASS |
| Security gates | PASS — private/loopback/link-local/IPv6/`0.0.0.0` hosts refused; click/type/navigate-as-commander refused unless the Commander holds control (409); bulk route refuses requests without its header (403) |

## Reviews

Independent read-only review (separate agent): PASS_WITH_FIXES. 3 MAJOR + several MINOR findings, all fixed and re-verified in the installed build:
approve race (single start per approval; re-read-before-write), SSRF (host policy incl. IPv6/private ranges + DNS check, enforced on every request and
redirect for non-local sessions; auto-browse now only when the message *is* an open/visit request), Commander-only input gated on control state and owner,
bulk-route CSRF header, sensitive mission targets (`.git`, `.env*`, CI, `node_modules`, keys) refused, browsed page text stored as untrusted and excluded
from mission drafts, running-mission sessions protected, PATCH can no longer trash or forge the trash marker.

## Defects found by installed acceptance and fixed

Self-knowledge said Stage 2 was planned; ML/AI-literature research questions were routed to news feeds (0 accepted sources) — scholarly router now matches
them; mission form said acceptance criteria were optional but Foundry requires one (explicit default criterion now stated); the panel stack above the
messages could not scroll so the browser frame was cut off (now a scrollable region).

## Known limits (not hidden)

- All Council members share one local model on this machine; no cloud keys are configured. GPU deferral applies to every Council model turn during a live Foundry mission, including turns that would use only cloud members (document: policy env opt-out).
- The broker still launches its own Chromium with `--no-sandbox` (pre-existing; the Electron app's own sandbox is unchanged). Redirect blocking is implemented per request but only the initial-URL and literal-host/DNS cases were exercised live.
- `/api/runtime/browser-broker` still accepts a client-supplied owner (pre-existing, not changed).
- The GPU-busy chat banner and "SYNTHESIZING" header can lag behind a finished round until the next poll.
- Repeated "open <url>" requests create ephemeral browser sessions that are only closed by Close Session / restart (no cap yet).
- `ffmpeg`/`ffprobe` are not installed, so HVS media tooling is DEGRADED here.
- eslint: 0 errors in Stage 2 files; 6 pre-existing `prefer-const` errors in an unrelated file remain.
- Chrome sandbox (`chrome-sandbox` setuid) not exercised: acceptance ran the installed UI server in node mode.

## Rollback

Nothing destructive. Remove `~/.local/opt/war-room-os-0.2.0-*-council-stage2` installs and `~/.local/share/war-room-os-stage2-*`, the worktree
`~/Codex/war-room-os-stage2` and branch `council/stage2-integration`. If promoted: restore `~/.local/bin/war-room-os-user` from its dated backup
(see the promotion note in the final report) and restart; revert the merge commit on `live-council-intelligence-repair`.

## NEXT STEPS FOR OPERATOR

1. **Environment changes:** none required. Optional: `WAR_ROOM_COUNCIL_GPU_POLICY=ALLOW` to let Council model turns run during a Foundry mission.
2. **SQL / migrations:** none (local SQLite store gains a `trashed` conversation state in metadata only).
3. **Restart:** the desktop app must be restarted to load the new install.
4. **Verification:** open the Council pane; the session list shows Sessions / Trash / Archived with Select All; "Foundry missions", "Connected systems" and "Council computer" panels sit above the messages.
5. **Expected output:** self-knowledge lists Stage 2 as installed; missions show PROPOSED until you approve; COMPLETED only with verifier exit 0 and a verified receipt.
6. **Feature flags:** none added; GPU policy env above is optional.
7. **Visible UI change:** session management toolbar, Trash tab, three new panels.
8. **Rollback:** see above.

# Council Stage 3 — immersive command experience: completion receipt

Branch `council/stage3-immersive`, built on the Stage 2 tip `7e61e916`. Installed build under test:
`war-room-os-0.2.0-e065c055-council-stage3` (commit `e065c055`). This document is the only change after that commit.

## Result — read this first

**Stage 3 is accepted in the installed Electron window.** The canonical launcher runs `war-room-os-0.2.0-d06afa12-council-stage3` (commit `d06afa12`, native sandbox, setuid `chrome-sandbox`); ports 3847/3848 answer. Verified over the app's local debugging port in the real window (960×503 CSS px, DPR 2): the running executable is the `d06afa12` install; view `immersive`; dock with 7 controls; Foundry/HVS/Terra planets all READY with their real status; single-row floating input; measured bounding boxes show **no overlap** between planets, text block, input and dock; Sessions drawer lists the Commander's real sessions (1 active, 34 archived, Trash 0) with Select All/Trash/Archive controls; Foundry drawer and Foundry planet panel show the real mission history.

**Commander data preserved across both promotions:** 1 active + 34 archived sessions, 23 messages, 11 Foundry mission records (5 COMPLETED with verifier exit 0 and verified receipt, 5 FAILED, 1 CANCELLED) — identical to the pre-Stage-3 baseline. No test messages or missions were written into canonical data.

**Rollback preserved:** previous Stage 3 install `…e065c055-council-stage3`, Stage 2 install `…0b282f07-council-stage2`, Foundry install `…861c68f5-foundry-reverse-engineer`, and launcher backups `war-room-os-user.bak-pre-council-stage3-1792143250` (Stage 2 launcher) and `…-1792143869` (e065c055 launcher).

Earlier stages of the evidence: `e065c055` was Electron-verified first; at the window's real size it showed overlaps (empty-state box, two-row composer, planet badges), which `d06afa12` fixes. Missions, Council turns and browser/takeover were exercised in the installed package as an isolated UI server (see table), not inside the canonical window, to keep test data out of the Commander's sessions.

**VR: foundation and plan only; no headset test.**

## Addendum — Foundry planet 404 (fixed in `6964268d`, canonical)

Root cause: the Foundry planet panel hard-coded `/foundry`, which has no page (the workspace is `/war-room/engineering`). Fix: link via `FOUNDRY_CANONICAL_PATH` with the Foundry resume href, a `/foundry` → `/war-room/engineering` redirect in `next.config.ts`, and a validator that every planet link resolves to an existing page. Verified in the real Electron window on the canonical `6964268d` install: Foundry planet → "Open Foundry" → the real Foundry workspace (the Commander's projects) with no 404; "← War Room" returns to the immersive Council, still authenticated. Foundry mission records unchanged (5 COMPLETED, 5 FAILED, 1 CANCELLED).

## What was built (on top of the unchanged Stage 2 operations layer)

- **Immersive Council view (default; "Classic panel view" one click away in Settings, and "Immersive view" button in Classic).** Deep-space canvas (≈120 stars, 12 fps, static when reduced-motion/hidden/unfocused/model-busy/mission-live), the real Terra globe in the centre, **materializing Council text** near the bottom (only text that arrives while the view is open animates; history appears instantly; full text always available to screen readers), a **compact floating Commander input** (the existing composer, same attachments/commands), contributing members shown as labelled chips with their role/provider.
- **Dock + drawers** instead of permanently crowded panels: Sessions (full Stage 2 navigator: Select All, Archive, Trash, Restore, Empty Trash), Conversation (the classic full thread), Research, Foundry missions (propose/approve/receipts), Connected systems, Council computer (visible browser, Commander takeover, secure sign-in), Settings & help. Keyboard: `Alt+1…7`, `Esc`, normal Tab order; panels that must keep polling stay mounted while hidden.
- **Planets with real status** (`/api/council/immersive/planets`, Commander-only, read-only, 3 s cache): **Foundry** (live worker/heartbeat/step, recent missions with verifier exit and receipt verification, "Open Foundry"), **Higher Vision Studios** (projects, render jobs, media-toolchain state — on this machine DEGRADED because `ffmpeg`/`ffprobe` are missing), **Terra** (Terra and Terra World probes). The ring pulses only while the source reports a live, alive worker/render; queued, stalled, dead, stale or unreadable sources are stated as such.
- **Truthful progress stars** (`lib/council/immersive/signals.ts`): one star per real signal with its evidence on focus. `verified` only for a Foundry mission with state COMPLETED + verifier exit 0 + verified receipt (or research with ≥2 accepted sources); a finished Council round is "finished (not independently verified)"; research that merely responded is "partial — not independently checked"; failed/blocked/interrupted/pending-approval/pending-request each have their own state; the computer star says who holds control.
- **VR foundation** (`lib/council/immersive/scene.ts`, `docs/phases/COUNCIL_STAGE3_VR_PLAN.md`): seated, no-locomotion scene model (planets, floating panels, controller input map, comfort limits), WebXR capability line in Settings & help, step plan V1–V6 and a Commander test procedure. No WebXR renderer yet; no headset testing.

## Installed acceptance (e065c055 / dea0cf0d runs, isolated runtime)

| # | Requirement | Result |
|---|---|---|
| 1 | Real multi-member discussion in the immersive UI | PASS — ORION → LUMEN → AURORA, each attributed, separate model turns |
| 2 | Materializing text and compact input | PASS |
| 3 | Session manager and Trash | PASS — Select All, Move to Trash (confirm), Trash tab, Restore from the drawer; counts survive restart |
| 4 | Navigable Foundry / HVS / Terra planets | PASS — each opens its panel with real facts and an "Open …" link |
| 5 | Mission progress linked to real Foundry status | PASS — pending star → active star with Foundry planet ACTIVE → verified star only after COMPLETED, verifier exit 0, receipt verified (`msn-20261016T091914-381eee81`, integration APPLIED `83afd4e3`; a second mission verified on e065c055); planet returned to READY afterwards |
| 6 | Browser/computer visibility and takeover | PASS — Council browse with live frame, Take over (star "You hold the Council computer"), Return control |
| 7 | Restart persistence | PASS — sessions, per-member attribution, mission records, verified star and Trash counts identical after a runtime restart |
| 8 | Acceptable performance beside local inference | PASS — renderer CPU 4.6 % (animated) vs 4.4 % (reduced); animation stops by itself during model turns and live missions; planets poll every 3 s only while a mission runs, otherwise 8 s (×multiplier), nothing while hidden |
| 9 | Independent review and rollback | PASS_WITH_FIXES (below); rollback = restore the launcher backup |

Regression: `validate:council-immersive` 9/9, council-stage1 121/121, session-management 10/10, missions 10/10, subsystems 6/6, gpu-arbitration, session-intelligence, nebula all pass; tsc clean; eslint 0 errors in new files.

## Independent review (separate read-only agent)

Verdict FAIL on first pass (1 BLOCKER) → all fixed → PASS_WITH_FIXES. Findings fixed: **B1** refetch loop in the mission panel (inline callbacks re-created the fetch; verified in the installed build: 1 request in 100 s), stale planet/star data on poll failure (data cleared and shown unavailable), research star overstating evidence ("responded", not "accepted"), pending continuation requests invisible in immersive mode (now a star + dock badge), stale/unconfirmed HVS "running" jobs, HVS READY on unreadable sources, queued/stalled Foundry missions lighting the ring, unverified receipts shown as "not checked", animate-all-history in the text view, live-region noise during streaming, Esc/IME handling, inert background while a drawer is open, layout overlaps, path-leaking error strings, uncached route cost.

## Known limits (not hidden)

- Missions, Council turns and the browser/takeover flow were exercised in the installed package run as an isolated UI server, not inside the canonical Electron window (to avoid writing test data into the Commander's sessions); the Electron window was verified for rendering, drawers, planets and the Commander's real session/mission data. `Alt+N` shortcuts can clash with some desktop/browser shortcuts; they are listed in Settings & help.
- In an empty session the one-line hint can touch the globe's caption text (cosmetic).
- A flash of Immersive can appear for users whose saved view is Classic (the preference is read after hydration).
- All Council members share one local model on this machine; HVS media tooling is missing; WebXR is not available in this runtime.
- Planet status can lag a real change by up to one poll (3 s during a mission, 8 s otherwise).
- Visual verification covered ≈1568×703, 960×457 (browser) and the real 960×503 Electron window; other sizes were reviewed from the layout rules only.

## Rollback

Nothing canonical changed before promotion. Remove `~/.local/opt/war-room-os-0.2.0-e065c055-council-stage3` and `~/.local/share/war-room-os-stage3-*`. After promotion: copy the newest `~/.local/bin/war-room-os-user.bak-pre-council-stage3-*` back over `war-room-os-user` and restart; the Stage 2 install `war-room-os-0.2.0-0b282f07-council-stage2` is kept for exactly this.

## NEXT STEPS FOR OPERATOR

1. **Environment changes:** none. 2. **SQL / migrations:** none.
3. **Restart/promotion:** done (`d06afa12` is the canonical launcher target).
4. **Verification:** the Council opens in the immersive view; Settings & help → "Classic panel view" restores the old layout.
5. **Expected output:** deep-space scene with the Earth globe, Foundry and HVS planets with truthful status, stars that only turn green on a verified Foundry receipt.
6. **Feature flags:** none (view and motion preferences are stored in the browser). 7. **UI change:** as above.
8. **Rollback:** see above.

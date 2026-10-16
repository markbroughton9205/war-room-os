# Council Stage 3 — immersive command experience: completion receipt

Branch `council/stage3-immersive`, built on the Stage 2 tip `7e61e916`. Installed build under test:
`war-room-os-0.2.0-e065c055-council-stage3` (commit `e065c055`). This document is the only change after that commit.

## Result — read this first

**Desktop immersive experience: implemented and accepted in the installed runtime** (installed package run as its own UI server on 127.0.0.1:3001 with its own data directory, driven through the real UI in Chrome).
**Not yet accepted in the Electron window**: the Electron app binds the fixed ports 3847/3848 that the canonical (Stage 2) app owns, and the new install's `chrome-sandbox` needs the same one-time `sudo` setup as before. Electron acceptance therefore happens at promotion (`promote.sh`), with an immediate rollback available. **VR: foundation and plan only; no headset test.** Stage 3 is not called complete until the Electron step is confirmed.

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

- Not yet exercised in the Electron window (ports/sandbox, see Result). `Alt+N` shortcuts can clash with some desktop/browser shortcuts; they are listed in Settings & help.
- A flash of Immersive can appear for users whose saved view is Classic (the preference is read after hydration).
- All Council members share one local model on this machine; HVS media tooling is missing; WebXR is not available in this runtime.
- Planet status can lag a real change by up to one poll (3 s during a mission, 8 s otherwise).
- Visual verification was done at ≈1568×703; other window sizes were reviewed from the layout rules only.

## Rollback

Nothing canonical changed before promotion. Remove `~/.local/opt/war-room-os-0.2.0-e065c055-council-stage3` and `~/.local/share/war-room-os-stage3-*`. After promotion: copy the newest `~/.local/bin/war-room-os-user.bak-pre-council-stage3-*` back over `war-room-os-user` and restart; the Stage 2 install `war-room-os-0.2.0-0b282f07-council-stage2` is kept for exactly this.

## NEXT STEPS FOR OPERATOR

1. **Environment changes:** none. 2. **SQL / migrations:** none.
3. **Restart/promotion:** run `bash ~/.local/share/war-room-os-stage3-accept/promote.sh` (one `sudo` prompt for the native sandbox helper; it backs up the launcher), then quit and relaunch War Room.
4. **Verification:** the Council opens in the immersive view; Settings & help → "Classic panel view" restores the old layout.
5. **Expected output:** deep-space scene with the Earth globe, Foundry and HVS planets with truthful status, stars that only turn green on a verified Foundry receipt.
6. **Feature flags:** none (view and motion preferences are stored in the browser). 7. **UI change:** as above.
8. **Rollback:** see above.

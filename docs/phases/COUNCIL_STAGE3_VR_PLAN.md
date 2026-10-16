# Council Stage 3 — VR (Meta Quest 3S) plan and foundation

Status: **foundation only. Nothing here has been run on a headset.** Do not read "supported" anywhere in the UI as "accepted on Quest".

## What exists today (desktop build)

- `lib/council/immersive/scene.ts` — a renderer-agnostic `SceneModel` in metres (viewer at the origin facing −Z, eye height 1.2 m, *seated*, `locomotion: 'none'`):
  - three planets (Foundry left, Terra up-centre, HVS right) at 7–9 m;
  - six floating panels (Conversation, Commander input, Sessions/Trash/Archive, Foundry missions, Connected systems, Council computer) at 1.2–1.7 m, inside the 0.8–2.5 m comfortable reading/reach band;
  - input map: controller ray + trigger = click/Enter, B/Y = Esc, thumbstick snap-turn 30°, system recenter; each has a desktop equivalent;
  - comfort defaults: snap turn with vignette, reduced motion on by default in VR.
- `xrReadiness()` + the **Settings & help → VR** line: capability detection through `navigator.xr.isSessionSupported('immersive-vr')`. It reports *"supported by browser"* at most, with the note that the scene is untested on a headset.
- The 2D immersive UI uses the same data sources the VR scene will use (planet status, progress signals, materializing text blocks), so VR adds a renderer, not a second truth.
- `three@0.184` is already a dependency (Terra/Cesium stack); no new package and no model download is needed for the VR renderer.

## Implementation plan (each step is bounded and testable)

| Step | Deliverable | How it is verified |
|---|---|---|
| V1 | `ImmersiveXrScene` (three.js `WebXRManager`, `immersive-vr`, `local-floor` reference space): renders the planets and billboarded panels from `SceneModel`; panels are `CanvasTexture`/DOM-to-texture of the existing text blocks and status (read-only first). | Desktop "Preview scene" in a normal canvas (no headset): layout, distances and legibility checked against the model; unit-validate that every panel is within comfort limits. |
| V2 | **Enter Council in VR** button (shown only when `xrReadiness` says supported) — requests the session from a user gesture, shows a clear "Exit VR" panel, falls back to the 2D view on session end. | Real Quest 3S via Quest Browser over the local network (Commander-run; see below). |
| V3 | Controller input: ray select → the same action handlers as clicks (open drawer, approve/reject a mission, take over the computer); B/Y closes the open panel; thumbstick snap-turn; **seated recenter**. No locomotion. | Quest session; logged input events compared with the desktop action log. |
| V4 | Optional environments: deep space (default) and a **white room** (flat light background, same panels) for readability; chosen in Settings & help, remembered. | Quest session, both environments. |
| V5 | Direct interaction with Terra / Foundry / HVS: the planets open the same planet panels as on desktop (facts, receipts, "Open Foundry"); deeper Terra globe interaction reuses the existing Cesium/Terra scene only after V1–V4 are accepted. | Quest session. |
| V6 | Performance guardrails: fixed 72 Hz target, fixed-foveation, no post-processing, pause the starfield while a local model turn or a Foundry mission is running (same rule as desktop), texture atlases for panels. | Frame-time capture on the headset; local inference latency compared with and without the VR session open. |

## Safety and truthfulness rules carried into VR

- Approving a mission, taking over the browser, or any destructive action requires the same explicit confirmation panel as on desktop; controller "trigger" alone never approves anything.
- Progress stars and planet status come from the same authoritative records; VR adds no animation that implies progress.
- Secure sign-in never happens inside VR text entry: the Commander signs in on the desktop view (the VR headset keyboard is not treated as a trusted secret path).
- The session is local-network only (the app already allows only loopback and its fixed local origins); serving to the headset needs an explicit, separate Commander decision (a LAN bind or a USB port forward) and is **not enabled by Stage 3**.

## What the Commander must do to test on a headset (not done here)

1. Quest 3S on the same network; enable Developer Mode.
2. Either port-forward `adb reverse tcp:3847 tcp:3847` (USB, no LAN exposure) and open `http://127.0.0.1:3847/` in Quest Browser, or approve a LAN bind for a test session.
3. Settings & help → VR should then report WebXR immersive VR support; V2+ then become testable.

## Current acceptance statement

Desktop immersive experience: implemented and tested in the installed build. VR: **layout/interaction model and capability detection implemented; no WebXR renderer yet; no headset testing performed.**

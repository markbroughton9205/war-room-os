# HIGHER VISION STUDIOS
# MASTER FILM PRODUCTION CAPABILITY MATRIX
# + MASTER BUILD ROADMAP

**Commander:** Mark  
**Date:** 2026-09-22  
**Mode:** LIVE BUILD — Phase 1 closed; Wave 1 shared foundations; Wave 2 first real paths; no commit, no push  
**Code slice audited:** `HVS-WAVE-2` (Phase-1 closure remains `HVS-P1-SLICE-G`)  
**Research canon:** eight completed waves (`docs/hvs-waves/HVS_WAVE_1` … `HVS_WAVE_8`) + Wave A + this directive  

This document does not shrink scope. Every capability in the Master Film Production Directive and the eight-wave research is listed. Later-phase items stay on the roadmap. Higher Vision Studios remains the place a film is finished — not a prompt box, not a CapCut clone, not a handoff to another editor.

---

## 0. Architecture locks (do not replace)

These already exist. Phase work builds on them.

| Lock | Current evidence |
|---|---|
| Native War Room section, not a separate product | `/higher-vision-studios/*`, `HVS_DISPLAY_NAME`, `HvsShell` |
| `.hvsproj` is source of truth | `lib/media-command/types.ts`, `project-format.ts`, `store.ts` |
| Tracks are authoring truth; magnetic = EditOps/UX | `Timeline.tracks`, `edit-ops.ts` |
| Rational media time | `lib/media-command/time.ts` (ticks + timescale, default 24000) |
| Humans and AI share typed EditCommands | `edit-commands.ts` + `applyEditCommand` — no model→ffmpeg, no UI RPA |
| Original media is immutable | `AssetRecord.immutableOriginal: true`; policy forbids silent delete |
| Generated media becomes `AssetRecord` + provenance, then optional EditCommand | `provider-router.ts` contract; jobs do not write timeline directly |
| Multicam ≠ CameraSpec ≠ VirtualCamera | `camera.ts` `CAMERA_CONCEPTS` |
| Beauty identity morphing OFF unless authorized | `HvsProject.beautyIdentityMorphing` |
| CapCut / FCP / Premiere / Resolve / AE are not runtime and not SoR | Wave 8 lock; no vendor project writers |
| OTIO / EDL / FCPXML are interchange, never SoT | researched; not yet coded |
| HVS ≠ Media Player ≠ Terra ≠ Council | Wave 7; typed handoffs only |
| Draft ≠ publish | Wave 4; AI Director FIRST_CUT/DRAFT requires `createVersion` |
| Sora / OpenAI Videos API excluded | Wave 5 sunset; no adapter |

---

## 1. Status vocabulary

| Mark | Meaning |
|---|---|
| **SHIPPED** | Working code that performs the capability for the current slice |
| **PARTIAL** | Real code exists; major required behavior is missing |
| **SHELL** | Types, registry, API stub, and/or boundary page — no real production capability |
| **NOT STARTED** | No kernel object, service, or UI |
| **RESEARCHED** | Designed in the eight waves (and/or this directive) but not in the kernel yet |
| **BLOCKED** | Policy, legal, vendor-dead, or hardware hold — do not “just build” |

A row can be SHELL in code and RESEARCHED in waves. The **Current state** column is the code state. Research coverage is in **Research wave/source**.

---

## 2. Rollup (code state, this audit)

Counted from the matrix rows (same inventory as the interactive canvas).

| State | Rows | Read |
|---|---|---|
| SHIPPED | 59 | Wave 8 live closure: G27-01 local Video Intelligence subset (watch/search/remember with timestamped observations). Prior SHIPPED rows unchanged. |
| PARTIAL | 30 | Wave 9: G19-03 HSL/luma qualifiers (not skin-tone/roto); G39-02 technical QC (not editorial). ColorPipeline remaining grade depth (G19-02), Audio extras, and other PARTIAL rows. |
| SHELL | 28 | Generate* backends remain SHELL (no physical generation). G27-02 people/objects/speech remain SHELL. |
| RESEARCHED | 47 | OCIO/ACES, full wheels/curves UI, DAW extras remain researched. G19-03 and G39-02 promoted to PARTIAL in Wave 9. |
| NOT STARTED | 19 | Screenplay graph, dailies hierarchy, credits crawl, … |
| BLOCKED | 4 | Sora; WRIM-as-backend until WRIM is real; Ultralytics AGPL tracker; realtime 4K track HOLD |

**187 capability rows total** across the 48 directive groups, the production kernel (G0), and research extras (GX).

### Phase 1 totals

| State | Before 1.3 | After 1.3 (evidence only) | After P1-B | After P1-C | After P1-D | After P1-E | After P1-F | After P1-G (closure set, phase=`1`) |
|---|---|---|---|---|---|---|---|---|
| SHIPPED | 38 | 38 | 40 | 42 | 44 | 44 | 46 | **52** |
| PARTIAL | 20 | 20 | 19 | 17 | 16 | 16 | 14 | **0** |
| SHELL | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| NOT STARTED | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| BLOCKED | 1 | 1 | 1 | 1 | 1 | 1 | 1 | **0** |

P1-G does **not** inflate later-phase rows. It promotes only Phase-1 obligations that were already real (preview/commit, Blade, manual markers, thin grade, ffprobe gate, productionMode, visible AI ops) and **removes later-phase leftovers from the Phase-1 closure set** (GPU compositor, preview-only ThemeSpec, NVENC, bins, transcription, animated lower thirds, beat detection, generation provenance). Global PARTIAL remains 24. See `docs/hvs-waves/HVS_PHASE_1_ACCEPTANCE_CONTRACT.md`.

Slice 1.3 did **not** inflate SHIPPED. Tracking/follow rows that were already SHIPPED received real-person evidence. P1-B ships Source Monitor and speed/reverse/freeze. P1-D ships clip pan and dissolve Program/render mix, and lowers supported looks. P1-E ships the Version Browser (restore, branch, compare, lineage) on G43-01 which was already SHIPPED as snapshot kernel — **no SHIPPED count inflation**. Program Viewer and render fidelity stay PARTIAL (no GPU compositor; remaining preview-only ThemeSpec).

HVS-P1-UX-SLICE-STUDIO is a **surface integration** slice. It did **not** change SHIPPED / PARTIAL / SHELL counts. Studio chrome, Projects→Studio navigation, Media Library filters, docked AI Director, versions selector, and render access are UI evidence against existing rows. Program Viewer remains PARTIAL. Generate Video/Image/Voice/Music/SFX remain SHELL. Version Browser is now P1-E. Panel resize is later polish.


### Row transitions (do not inflate)

| Slice | Capability | Prior | New | Location | Evidence | Validator | Acceptance | Phase |
|---|---|---|---|---|---|---|---|---|
| HVS-V1-SLICE-1.2 | Undo | PARTIAL | SHIPPED | `store.ts`, `HvsEditorShell.tsx` | Live drag + typed undo restores clip position | `hvs.slice12.validation.ts` + prior live proof | Last N commits undo without asset loss | 1 |
| HVS-V1-SLICE-1.2 | Insert…move (move evidence only) | PARTIAL | PARTIAL | `moveClip` drag | Live HTML5 drag → moveClip persists after reload | slice-1.2 | Move proven; append/overwrite still missing until P1-A | 1 |
| HVS-P1-SLICE-A | Redo | SHELL | SHIPPED | `store.ts` `projectRedoDir`; editor Redo | Kernel history + live undo→redo restores 3rd clip | `hvs.p1.sliceA.validation.ts` + browser | Undo then redo identical timeline | 1 |
| HVS-P1-SLICE-A | Insert / overwrite / append / split / trim / ripple / move | PARTIAL | SHIPPED | `edit-ops.ts`, editor toolbar | Overwrite carves remnants; append at track end; 1.2 drag remains | slice A kernel + UI locks | Each named op has command + visible result + undo | 1 |
| HVS-P1-SLICE-A | Lift / extract | NOT STARTED | SHIPPED | `liftClip`, `extractClip` | Kernel gap vs ripple; toolbar + Director | slice A | Lift leaves hole; extract closes | 1 |
| HVS-P1-SLICE-A | Roll / slip / slide / extend | NOT STARTED | SHIPPED | `rollEdit`/`slipClip`/`slideClip`/`extendEdit` | Kernel duration invariants | slice A | Roll preserves span; slip/slide preserve duration | 1 |
| HVS-P1-SLICE-A | Duplicate | NOT STARTED | SHIPPED | `duplicateClip` | Live 2→3 clips; undo 3→2; redo 2→3 | slice A + browser | Duplicate is a command | 1 |
| HVS-P1-SLICE-A | Snapping | PARTIAL | SHIPPED | `snapTimelineSeconds` + Snap toggle | Live Snap on → Snap off | slice A UI lock + browser | Snap toggle | 1 |
| HVS-P1-SLICE-A | Markers / ranges | SHELL | PARTIAL | `addMarker` | Kernel range + live Marker commit | slice A | Add marker yes; beat detection still missing | 1 |
| HVS-V1-SLICE-1.3 | TrackSubject V1 person in a shot | SHIPPED | SHIPPED | `track-subject.ts`, `tracking.ts` | Commander Sample.mp4; 60 keys; conf 0.630–0.951 avg 0.791; shot-local FACE LOCK | `hvs.slice13.validation.ts` + live editor | Select person → keys; crop not center | 1 |
| HVS-V1-SLICE-1.3 | Follow this person / object | SHIPPED | SHIPPED | `setVirtualCamera`; Follow this person | Real-person FACE LOCK; 60 VCam keys; left crop 0.130→0.028 | slice-1.3 + 1080×1920 render | Shot-local follow, not identity | 1 |
| HVS-V1-SLICE-1.3 | Tracking → crop / pan / zoom / keyframes | SHIPPED | SHIPPED | `followFramingCrop` + sourceRatio | Dynamic 9:16; not static center crop | slice-1.3 | Rendered 9:16 follows subject | 1 |
| HVS-P1-SLICE-B | Source monitor | NOT STARTED | SHIPPED | `source-monitor.ts`, editor dual monitors | Live `hvs-muafr0xk-vb95`: plate → Source; play/pause; seek 0.5s; Mark In `00:00:00:12`; seek 2s; Mark Out `00:00:02:00`; Insert via `insertClip`; clip `sourceIn=0.5 sourceOut=2`; PROXY preview URL; marks session-only (cleared on reload) | `hvs.p1.sliceB.validation.ts` + authenticated browser | Mark In/Out then insert range | 1 |
| HVS-P1-SLICE-B | Program Viewer | PARTIAL | PARTIAL | `preview-engine.ts`, editor | Gap black; speed/reverse/freeze mapping; stack order; independent Source clock | slice B | Scrub matches shipped ops; dissolve still open | 1 |
| HVS-P1-SLICE-B | Slow / fast / reverse / freeze | PARTIAL | SHIPPED | `setSpeed`, `reverseClip`, `createFreezeFrame`; render graph | Live 0.5x duration 1.5→3; Reverse undo/redo; freeze still `parentAssetId=asset-muafr0xm-oo1b`; kernel libx264 render; gap black at 4s | slice B + ffprobe + browser | Timeline + Program + render agree | 1 |
| HVS-P1-SLICE-B | Render fidelity vs timeline | PARTIAL | PARTIAL | `clipVideoFilter` / `clipAudioFilter` | Speed atempo, reverse, freeze now in graph | slice B | pan/dissolve/CSS looks still missing | 1 |
| HVS-P1-UX-SLICE-STUDIO | Studio workspace surface | (existing rows) | unchanged | `HvsEditorShell.tsx`, `/projects`, `/studio` | Projects cards → Studio; compact chrome; Media Library filters; Program center; docked AI Director; versions/render access; honest Generate SHELL | `hvs.p1.studio.validation.ts` + live browser | Surface only — no SHIPPED promotion | 1 |
| HVS-P1-SLICE-C | Caption tracks + cues + ASS | PARTIAL | SHIPPED | `captions.ts`, `ass.ts`, `updateCaption`, editor inspector | Live `hvs-muagwoeo-5y83`: CAPTION inspector; top-center move; Program overlay; ASS one cue; 16:9/9:16 gold-pixel frames | `hvs.p1.sliceC.validation.ts` + browser | Captions on Program and burned master | 1 |
| HVS-P1-SLICE-C | Titles, logos, static overlays | SHIPPED | SHIPPED | `title-presets.ts`, `updateTitle`/`setTitleStyle`/`removeTitle` | Coming Soon cinematic title; inspector; ASS titles; logo PNG | slice C + frames | Evidence only; already SHIPPED | 1 |
| HVS-P1-SLICE-C | Lower thirds foundation | PARTIAL | PARTIAL | `addLowerThird` | Static lower-third OverlaySpec + secondary line; no motion engine | slice C | Foundation only; animation remains Phase 5 | 5 |
| HVS-P1-SLICE-C | Safe-area / guides | PARTIAL | SHIPPED | `safe-area.ts`, Program guides | Title-safe 10% + action-safe 5%; live WARNING on logo 16:9; 9:16/1:1 math | slice C + browser | Guide visible; overflow flagged; no auto-move | 1 |
| HVS-P1-SLICE-C | Program Viewer | PARTIAL | PARTIAL | editor overlays | Slice-C elements match layout module; dissolve still open | slice C | Slice-C PASS; GPU compositor still open | 1 |
| HVS-P1-SLICE-C | Render fidelity vs timeline | PARTIAL | PARTIAL | `ass.ts` + logo overlay | Caption+title+lower-third ASS; logo PNG; pan/dissolve/CSS-look still open | slice C frames | Slice-C elements in master | 1 |
| HVS-P1-SLICE-D | Pan | SHELL | SHIPPED | `setPan`, `pan.ts`, inspector L/C/R, Web Audio StereoPanner, FFmpeg `pan=stereo` | Live Studio pan L/C/R + undo; RMS L=0.125/R=0, C balanced, R=0.125/L=0 | `hvs.p1.sliceD.validation.ts` + browser + channel energy | Pan audible/measurable in mix | 1 |
| HVS-P1-SLICE-D | Parameterized transition model | PARTIAL | SHIPPED | `addTransition`/`updateTransition`/`removeTransition`; overlap by D; Program dual-video; FFmpeg `xfade` | Live dissolve 1s; Program mix opacities 0.58/0.42 at 02:09; frames before RGB(166,15,39) mid(97,105,110) after(30,195,183) | slice D + extracted frames | Adding dissolve changes Program and master | 1 |
| HVS-P1-SLICE-D | Program Viewer | PARTIAL | PARTIAL | dual `<video>` dissolve + Web Audio pan + look CSS | GPU compositor still absent; filmstrip later | slice D | Dissolve playback proven; not a GPU compositor | 1 |
| HVS-P1-SLICE-D | Render fidelity vs timeline | PARTIAL | PARTIAL | `xfade`, `pan=stereo`, look-lowering eq/sepia/hue | clip.effects, preview-only ThemeSpec, no GPU compositor | slice D physical | Shipped ops including pan+dissolve+supported looks in master | 1 |
| HVS-P1-SLICE-D | Rendered look matches preview | PARTIAL | PARTIAL | `look-lowering.ts` registry; cinematic eq in graph | PREVIEW-ONLY letterSpacing/glow/grain/film/gold-veil remain | slice D luma/eq | Supported properties lowered; not pixel-identical | 1 |
| HVS-P1-SLICE-D | Markers / beat detection | PARTIAL | PARTIAL | unchanged | Beat *detection* is Phase 5 (G34-03 RESEARCHED) | — | Do not fake beats | 1 |
| HVS-P1-SLICE-D | Pan | SHELL | SHIPPED | `setPan`, `pan.ts`, inspector L/C/R, Web Audio StereoPanner, FFmpeg `pan=stereo` | Live Studio pan L/C/R + undo; RMS L=0.125/R=0, C balanced, R=0.125/L=0 | `hvs.p1.sliceD.validation.ts` + browser + channel energy | Pan audible/measurable in mix | 1 |
| HVS-P1-SLICE-D | Parameterized transition model | PARTIAL | SHIPPED | `addTransition`/`updateTransition`/`removeTransition`; overlap by D; Program dual-video; FFmpeg `xfade` | Live dissolve 1s; Program mix opacities 0.58/0.42 at 02:09; frames before RGB(166,15,39) mid(97,105,110) after(30,195,183) | slice D + extracted frames | Adding dissolve changes Program and master | 1 |
| HVS-P1-SLICE-D | Program Viewer | PARTIAL | PARTIAL | dual `<video>` dissolve + Web Audio pan + look CSS | GPU compositor still absent; filmstrip later | slice D | Dissolve playback proven; not a GPU compositor | 1 |
| HVS-P1-SLICE-D | Render fidelity vs timeline | PARTIAL | PARTIAL | `xfade`, `pan=stereo`, look-lowering eq/sepia/hue | clip.effects, preview-only ThemeSpec, no GPU compositor | slice D physical | Shipped ops including pan+dissolve+supported looks in master | 1 |
| HVS-P1-SLICE-D | Rendered look matches preview | PARTIAL | PARTIAL | `look-lowering.ts` registry; cinematic eq in graph | PREVIEW-ONLY letterSpacing/glow/grain/film/gold-veil remain | slice D luma/eq | Supported properties lowered; not pixel-identical | 1 |
| HVS-P1-SLICE-D | Markers / beat detection | PARTIAL | PARTIAL | unchanged | Beat *detection* is Phase 5 (G34-03 RESEARCHED) | — | Do not fake beats | 1 |
| HVS-P1-SLICE-E | Edit versions + snapshots + Version Browser | SHIPPED | SHIPPED | `versions.ts`, `restoreVersion`/`createVersionFrom`, `HvsVersionBrowser.tsx` | Live `hvs-muajcgy6-zcvw`: ALT CUT 1 clip immutable vs DIRECTOR CUT 2 clips; restore confirmation; PRE-RESTORE v7; lineage; compare Added 1; persist after reload | `hvs.p1.sliceE.validation.ts` | See versions, create named snapshot, restore with confirmation, branch without mutating parent | 1 |
| HVS-P1-SLICE-E | Never silent overwrite of approved work | PARTIAL | PARTIAL | restore safety snapshot + Policy B history reset | Discipline approval still Phase 6 | slice E | Safety version exists; no approval workflow | 6 |
| HVS-P1-SLICE-F | Occlusion / lost / reacquisition / human correction | PARTIAL | SHIPPED | `reacquireTrack`, `correctTrack`, lost-target plate, Inspector REACQUIRE/CORRECT | Lost-target fixture + Sample.mp4; keys preserved across reacquire; humanCorrected stored | `hvs.p1.sliceF.validation.ts` | Lost frames flagged; human fix stores correction; no silent re-ID | 1 |
| HVS-P1-SLICE-F | Follow modes (face/upper/full/center/thirds/cinematic/dynamic) | PARTIAL | SHIPPED | `followFramingCrop` distinct crop per mode; Inspector 7-mode UI | FACE_LOCK ≠ CENTER_LOCK ≠ THIRDS ≠ CINEMATIC | slice F | Each mode changes crop window predictably | 1 |
| HVS-P1-SLICE-F | Follow this person / object (Studio UX) | SHIPPED | SHIPPED | Track Subject pick → confirm → run; SHOW/HIDE TRACK; source vs VirtualCamera preview | Viewer overlays never in render graph | slice F + live Studio | Shot-local follow of selected person; not biometric ID | 1 |
| HVS-P1-SLICE-F | Auto reframe from track | SHIPPED | SHIPPED | Inspector AUTO REFRAME 16:9 / 9:16 / 1:1 | Normalized geometry via followFramingCrop | slice F | 16:9→9:16/1:1 uses subject, not center-crop-only | 1 |
| HVS-P1-SLICE-F | Program Viewer | PARTIAL | PARTIAL | pick overlay, track path, source/camera preview toggle | GPU compositor still absent | slice F | Tracking controls added; not a GPU compositor | 1/5 |
| HVS-P1-SLICE-G | EditTransaction preview vs commit | PARTIAL | SHIPPED | `commitCommands(..., { preview })`; Preview/Commit/Reject | Preview does not write `.hvsproj`; commit persists; reject leaves disk | `hvs.p1.sliceG.validation.ts` | Preview ≠ commit | 1 |
| HVS-P1-SLICE-G | Blade as tool | PARTIAL | SHIPPED | Select vs Blade; click clip → `splitClip` at pointer | Timeline tool + typed split | slice G | Dedicated Blade, not only splitClip semantics | 1 |
| HVS-P1-SLICE-G | Markers / ranges (manual) | PARTIAL | SHIPPED | `addMarker`/`updateMarker`/`removeMarker`; inspector | Add/edit/move/remove + undo/redo. Beat detection stays Phase 5 | slice G | Manual markers closed; beats later | 1 |
| HVS-P1-SLICE-G | Thin grade | PARTIAL | SHIPPED | `look-lowering.ts` exposure/contrast/saturation/temperature RENDER-LOWERED | CSS Program + FFmpeg eq/colorbalance | slice D + G contract | No ACES/OCIO/HDR | 1 |
| HVS-P1-SLICE-G | ffprobe success gate | PARTIAL | SHIPPED | render-engine rejects output if probe fails | Failed encode cannot mark completed | slice G | Gate exists | 1 |
| HVS-P1-SLICE-G | productionMode enum | PARTIAL | SHIPPED | `PRODUCTION_MODES` on `.hvsproj` + catalog | Hierarchy objects remain Phase 6 | slice G | Mode is stored | 1 |
| HVS-P1-SLICE-G | Visible typed previewable AI ops | PARTIAL | SHIPPED | Director proposal + Preview/Commit/Reject + actor + undo | LLM Director remains Phase 7 | slice G | AI cannot silently mutate | 1 |
| HVS-P1-SLICE-G | Program Viewer | PARTIAL | PARTIAL | Phase-1 HTML5 contract accepted; GPU compositor deferred | Not a Phase-1 blocker | slice G | phase ownership `1/5` | 5 |
| HVS-P1-SLICE-G | NVENC / CUDA workers | PARTIAL | PARTIAL | Moved off Phase 1; vendor-neutral CPU/libx264 remains | Hardware later | slice G | phase ownership `9` | 9 |

Slice 1.3 closed real-person FACE LOCK as shot-local follow. P1-F exercised lost-target + manual reacquisition + correction in Studio. P1-B adds Source Monitor and motion fidelity. It is not yet a film studio.

**Verdict:** Slice 1.1 was a proving kernel. Slice 1.2 proved live drag + typed undo. Slice 1.3 proved real-person follow. Slice A added core NLE ops + redo. Slice B adds Source Monitor + speed/reverse/freeze in Program and render. Studio is the workstation surface over that kernel. Slice C ships caption editing+ASS and title-safe guides; lower thirds stay PARTIAL (static foundation, animation Phase 5). Slice D ships clip pan + dissolve Program/render + supported look lowering. Slice E ships Version Browser restore/branch/compare/lineage. Slice F ships object-follow UX. Slice G **closes Phase 1** as Professional Editor Foundation: remaining GPU compositor, preview-only ThemeSpec, generation, DAW, VFX, Review/QC, beat detection, and NVENC are **later-phase**, not Phase-1 blockers. Do not start Phase 2 automatically. Phase 10 remains last.

Slice 1.3 closed real-person FACE LOCK as shot-local follow. P1-F exercised lost-target + manual reacquisition + correction in Studio. P1-B adds Source Monitor and motion fidelity. It is not yet a film studio.

**Verdict:** Slice 1.1 was a proving kernel. Slice 1.2 proved live drag + typed undo. Slice 1.3 proved real-person follow. Slice A added core NLE ops + redo. Slice B adds Source Monitor + speed/reverse/freeze in Program and render. Studio is the workstation surface over that kernel. Slice C ships caption editing+ASS and title-safe guides; lower thirds stay PARTIAL (static foundation). Slice D ships clip pan + dissolve Program/render + supported look lowering. Slice E ships Version Browser restore/branch/compare/lineage on the existing snapshot model (G43-01 stays SHIPPED; no count inflation). Slice F ships object-follow UX over the existing TrackSubject/VirtualCamera engines. Remaining Phase 1: Program Viewer GPU compositor (stays PARTIAL), look preview-only properties, animated lower thirds (Phase 5), beat detection (Phase 5). Do not start Phase 2 automatically. Phase 10 remains last.

---

## 3. Current foundation (keep)

| Capability | Files |
|---|---|
| Native HVS chrome + home/projects/editor/library/render-queue | `components/war-room/higher-vision-studios/*`, `app/higher-vision-studios/*` |
| `.hvsproj` v0 persist/load/list/versions | `types.ts`, `project-format.ts`, `store.ts`, `app/api/media-command/projects/**` |
| EditCommand kinds (50) + command log | `edit-commands.ts`, `edit-ops.ts`, `projects/[id]/commands` |
| Ingest → SHA-256 → ffprobe → thumb → 1280 proxy → waveform peaks | `ingest.ts`, `probe.ts` |
| Program Viewer (HTML5 + proxy + CSS look + overlays + 9:16 object-position) | `preview-engine.ts`, `HvsEditorShell.tsx` |
| TrackSubject V1 (FFmpeg gray frames + SAD search) | `track-subject.ts`, `tracking.ts` |
| VirtualCamera follow → crop keyframes → 9:16 derive + render crop | `tracking.ts`, `deriveVerticalVersion`, `render-engine.ts` |
| ThemeSpec `luxury_beauty_v1` + 11 CSS FilterSpecs | `themes.ts`, `filters.ts` |
| Captions (cues + ASS burn-in), titles, logos (SVG→PNG) | `graphics.ts`, `render-engine.ts` |
| Volume / fade / duck / addMusic / addVoice | `edit-ops.ts`, render `amix`/`afade` |
| ColorGrade exposure/contrast/saturation/temperature → ffmpeg `eq` | `types.ts`, `applyColor` |
| FFmpeg render + NVENC probe + queue + output AssetRecord | `ffmpeg.ts`, `render-engine.ts`, `render-queue` |
| AI Director regex → EditCommand[] preview/commit + six modes | `ai-director.ts` |
| Provider Router category table (all `configured: false`) | `provider-router.ts` |
| Video Intelligence types + stub jobs + `TechniqueRecord` | `video-intelligence.ts` |
| STARRDOM fixture (script body, 5 boards, characters, logo) | `starrdom.ts` |
| Policy: no silent original delete, no publish, no spend | `policy.ts` |

Boundary-only pages (do not confuse with shipped product): `ai-video`, `ai-images`, `storyboards`, `scripts`, `characters`, `effects`, `voice`, `video-intelligence`.

---

## 4. Wave → directive map

| Directive groups | Research |
|---|---|
| 13 NLE, time, tracks, EditOps | Wave 1, Wave A, Wave 8 |
| 17 Filters, 18 Themes, captions speed, looks | Wave 2 |
| 7 CameraSpec, 8 Multicam, 9 TrackSubject, 10 VirtualCamera | Wave 3, Wave A |
| 30 AI Director, 47 collab modes, 48 pipeline gates | Wave 4 |
| 22–24 gen + Character Bible + STARRDOM + Router | Wave 5 |
| 14–16, 19–21, 31–37, 40 render/audio/color/VFX | Wave 6 |
| 41 interchange, 44 plugins, 46 rights, UI, hardware, boundaries | Wave 7 |
| Inventory, V1–V4, first slice, STARRDOM walkthrough | Wave 8 |
| 1–6 creative/script/board/shot, 12 dailies, 25–26 bible/continuity, 28 learning, 38 credits, 39 QC, 42 film structure, 45 production mgmt | Wave 4/8 hooks + **this directive expands them to first-class film objects** (TechniqueRecord already typed in code; VideoAgent/VideoSeek/VideoAgentTrek named here) |

Wave 8 V1–V4 is **not replaced**. The ten HVS phases below are the same destination at film-complete resolution:

| Wave 8 | HVS phases |
|---|---|
| SLICE-0 / V1 kernel + STARRDOM path | Phase 1 (close editor) + Phase 2 (make Router real) |
| V2 professional post | Phase 5 |
| V3 film/show/gaming scale | Phase 6 |
| V4 sovereign intel | Phase 8 (plus measured local gen) |
| *(directive additions)* | Phase 3 Video Intelligence, Phase 4 Creative Development, Phase 7 AI Director expansion, Phase 9 advanced film production, Phase 10 prompt-to-film |

---

# MASTER CAPABILITY MATRIX

Columns: **Capability · Research · Subsystem · State · Existing · Missing · Dependencies · Phase · Acceptance**

Kernel objects cited live under `lib/media-command/` unless noted. UI live routes are `/higher-vision-studios/...`.

---

### G0 — Production kernel (prerequisite for every later group)

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Native HVS section inside War Room | W7 UI, W8 | Shell / nav | SHIPPED | `HvsShell`, home, 24 routes, Alt+H resume | CREATE/EDIT/GENERATE/AUDIO/COLOR/EFFECTS/DELIVER tab chrome from W7 | Foundry home href | 1 | Commander opens `/higher-vision-studios` from War Room and never lands in Media Player |
| `.hvsproj` SoT | W7 Q19, W8 | ProjectStore | SHIPPED | `format:'hvsproj'` v0 JSON; parse/serialize/version gate | Schema migrations; show/episode/scene keys still absent | — | 1 | Save/reload round-trips timeline, assets, versions without silent field drop |
| Rational media time | W1 | Time | SHIPPED | ticks+timescale; timecode; convert | Drop-frame; multi-rate sequences | — | 1 | 23.976/24/25/29.97/30/48/60 map without float drift on split/trim |
| Tracks = authoring truth | W1 hybrid C | TimelineEngine | SHIPPED | Clip `start` stored; magnetic insert ripples as EditOp | Nested timelines; gap objects | EditCommands | 1 | Deleting a clip does not rewrite unrelated clip ids; magnetic is optional op |
| Typed EditCommands human+AI | W1–W6, W4 `hvs.edit.v1` | EditCommandLayer | SHIPPED | 47 kinds; schema; actor; JSONL log; API; P1-A trim-family + redo; P1-B createFreezeFrame | Nested sequences; keyframe tracks | `.hvsproj` | 1 | AI cannot mutate project except by committing an EditCommand |
| Project persistence | W8 SLICE-0 | store.ts | SHIPPED | `~/.local/share/war-room-os/data/media-command/projects` | Cloud/sync; multi-user | paths.ts | 1 | Create, list, open, save survive process restart |
| EditTransaction preview vs commit | W4 | EditCommandLayer | SHIPPED | `commitCommands` `{ preview }`; director Preview/Commit/Reject; preview does not write `.hvsproj` | PreviewTicket; cost ladder; dry-run compose | Director, render | 1 | Preview shows proposal and does not write until commit |
| Undo | W4; HVS-V1-SLICE-1.2 | store snapshots | SHIPPED | Pre-command `.hvsproj` snapshots; typed `undo`; editor Undo; live drag restore | Inverse-ops (snapshots are the engine) | EditCommands | 1 | Last N commits undo without corrupting assets |
| Redo | W4; HVS-P1-SLICE-A | store | SHIPPED | Typed `redo`; `projectRedoDir` snapshots; editor Redo; AI Director utterance | History panel UI | Undo | 1 | Undo then redo restores identical timeline |
| Immutable originals + no silent delete | W4, W6, W8 | Policy / AssetRecord | SHIPPED | `immutableOriginal`; policy blocks delete/publish/spend | Rights UX; reject-bin (non-delete) | Provenance | 1 | Rank/exclude never unlinks original file |

---

### G1 — Creative development

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Concept / premise / logline / synopsis / treatment | W4 IDEA stage G0 | Development | RESEARCHED | — | `DevelopmentBrief` object; CREATE UI | ScriptProject | 4 | Prompt “psychological horror about…” yields structured premise+logline+synopsis stored on project |
| Tone / genre / audience / visual direction | W2 ThemeSpec, W4 | Development | RESEARCHED | ThemeSpec can later bind style | Brief fields; look refs | ThemeSpec, WorldBible | 4 | Brief drives ThemeSpec suggestion without applying until human commit |
| Subject / historical / industry / location / visual / cinematography / technique research | W7 Research handoff | Research interface | SHELL | Wave 7 typed handoff to War Room Research Engine (not HVS scrapers) | Research records on `.hvsproj`; citation objects | War Room Research, rights | 4 | Research packets attach to project; HVS does not scrape arbitrarily |
| Creative brief (objective, audience, message, style, tone, runtime, platform, restrictions) | W4, W5 STARRDOM | Development | RESEARCHED | `productionMode` enum only | `CreativeBrief` kernel object | G0 | 4 | Brief is inspectable, versioned, and readable by AI Director |
| Prompt → structured development project | W4 pipeline; directive §48 | Development + Director | RESEARCHED | Regex director does not create development graph | Orchestration over development tools | Phases 4+7, never Phase 10-only | 4 | One utterance creates brief+script shell+shot list **as objects**, not a blob of prose |

---

### G2 — Script system

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| ScriptProject | W4 SCRIPT gate; W5 STARRDOM | Script | SHELL | `ScriptDocument` `{title, body}` plain text; STARRDOM seed | Scene graph; `ScriptProject` | G0 | 4 | Script is a structured document, not only a string |
| Scene / Beat / Dialogue / Action / CharacterCue / Transition | Directive §2 | Script | NOT STARTED | — | Typed nodes; screenplay pagination | ScriptProject | 4 | Scene heading, action, dialogue, parenthetical, transition round-trip |
| Screenplay formatting + scene numbering + page estimates | Industry + directive | Script UI | NOT STARTED | Boundary page copy | Formatter; numbering; page math | Script graph | 4 | Printed/exported pages match production numbering |
| Revision / ScriptVersion / draft comparison | W4 Version nodes | Script versions | NOT STARTED | ProjectVersion is edit-timeline, not script | Script-specific versions + diff | G43 | 4 | Two drafts diff by scene/dialogue without clobber |
| Notes + character dialogue search | Directive §2 | Script | NOT STARTED | — | Index; notes layer | Media search later | 4 | “Find every line spoken by X” returns cues |
| AI write / rewrite / shorten / extend / change tone / continuity / polish / pacing | W4 | Script + Director | RESEARCHED | Director does not write screenplay structure | Typed ScriptOps (not free text dump) | LLM via Router, continuity | 4 | AI scene rewrite is a previewable ScriptOp, undoable, attributed |
| Scripts UI | W7 CREATE tab | `/scripts` | SHELL | `HvsNamedModule` boundary | Real editor | Script graph | 4 | Open script from project; edit scene; AI panel emits ScriptOps |

---

### G3 — Script breakdown

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Breakdown elements: cast, extras, props, wardrobe, makeup, vehicles, locations, sets, VFX, SFX, stunts, animals, equipment, music, sound, notes | Film production; W8 V3 | Breakdown | RESEARCHED | — | `BreakdownItem` + per-scene lists | Script Scene | 4 | Each scene shows structured elements; unchecking does not delete script text |
| AI scene → production requirements | W4 | Breakdown + Director | RESEARCHED | — | Extractor with human confirm | Script graph, CharacterBible | 4 | Running breakdown on a scene proposes items; human accepts; AI cannot silently drop |

---

### G4 — Storyboard

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| StoryboardFrame on project | W4 BOARD; W5 STARRDOM | Storyboard | SHELL | `{index,title,description,assetId,duration}`; STARRDOM 5 frames | Links to scene/shot/CameraSpec/characters/location/annotations | Script, ShotSpec, CameraSpec | 4 | Frame binds to scene + shot + optional generated still Asset |
| AI storyboard generation | W5 IMAGE_GENERATOR | Storyboard + Router | SHELL | generateImage queues blocked job | Board-aware prompts; style lock; variations | Router image adapter, CharacterBible | 4 | Generate panel → AssetRecord → frame.assetId; provider never owns board |
| Manual replace / reorder / variations / visual style lock / shot continuity | Directive §4 | Storyboard | NOT STARTED | — | EditCommands for boards; continuity warnings | Continuity, CameraSpec | 4 | Reorder persists; style lock reused across frames |
| Storyboard UI | W7 | `/storyboards` | SHELL | Boundary page | Panel grid, replace, generate | G4 kernel | 4 | Operator can replace a panel and see it in sequence |

---

### G5 — Previs / animatics

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Storyboard animatic (timing, temp VO, temp music, temp SFX) | W4, W6 audio | Previs | RESEARCHED | Duration field on frame only | Animatic sequence; temp A/V tracks | Storyboard, audio tracks | 4 | Play boards in time with scratch audio |
| Camera path / shot duration / sequence preview | W3 CameraSpec | Previs | RESEARCHED | CameraSpec type unused | Path keyframes; sequence player | CameraSpec, timeline | 4 | Sequence preview uses CameraSpec durations |
| Basic 3D previs / blocking | W8 Blender/Natron subprocess later | Previs 3D | RESEARCHED | — | Isolated subprocess; never GPL-link | Legal isolation, Phase 9 | 9 | Optional Blender blocking imports as reference movie + CameraSpec, not as SoT |

---

### G6 — Shot planner

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Shot as first-class object (ShotSpec) | W3 CameraSpec; directive §6 | Shot | SHELL | `CameraSpec` covers size/angle/movement/lens/DOF only | Full ShotSpec: purpose, dialogue, VO, cast, props, wardrobe, location, continuity, generation method, source assets, provider requirements | Scene, CameraSpec, CharacterBible | 4 | Shot list for a scene is complete enough to generate or shoot |
| Shot ID / description / duration / references | W4 shot plan | Shot | NOT STARTED | StoryboardFrame is a weak proxy | Shot records + IDs | Script Scene | 4 | Shot IDs stable across versions |
| Generation method + provider requirements on shot | W5 Router | Shot + Router | RESEARCHED | ProviderJob categories exist | Per-shot routing spec | Router | 2/4 | Missing establishing shot can be queued as VIDEO_GENERATOR against that ShotSpec |

---

### G7 — Camera system (generative CameraSpec)

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Camera A ≠ B ≠ C documented in product | W3, W7, W8 | camera.ts | SHIPPED | `CAMERA_CONCEPTS` + camera module copy | Inspector that enforces the split in UI | — | 1 | UI never labels follow-crop as “multicam” or “generated camera” |
| CameraSpec structured data | W3, Wave A | CameraSpec | SHELL | Type: ECU/CU/MCU/MS/MLS/WS/EWS; eye/high/low/dutch/overhead; static/pan/tilt/dolly/orbit/handheld/follow | EditCommand `setCameraSpec`; UI; full language below | ShotSpec | 2 | CameraSpec stored, versioned, sent to Router as structured intent not a prose blob |
| Shot sizes: EWS, wide, full, medium full, medium, MCU, CU, ECU | W3 + directive | CameraSpec | PARTIAL | Subset of enums; missing explicit full / medium-full / profile-as-size | Enum + UI complete set | — | 2 | Every listed size is selectable and serializes |
| Angles: eye, low, high, overhead, bird’s-eye, worm’s-eye, Dutch, profile, 3/4, POV, OTS | Directive §7 | CameraSpec | PARTIAL | eye/high/low/dutch/overhead | bird’s-eye, worm’s-eye, profile, 3/4, POV, OTS | — | 2 | Same |
| Movements: static, pan, tilt, dolly, truck, pedestal, orbit, crane, jib, drone, push, pull, tracking, follow, handheld, Steadicam, whip, rack focus | Directive §7 | CameraSpec | PARTIAL | static/pan/tilt/dolly/orbit/handheld/follow | truck, pedestal, crane, jib, drone, push, pull, tracking, Steadicam, whip, rack focus | — | 2 | Same |
| Framing / lens intent / DOF / focus target / subject target / lighting / trajectory | W3 | CameraSpec | PARTIAL | framing string, lensIntent, DOF, subjectTargetId, trajectory, trackingBehavior | Lighting; focus target; richer trajectory | TrackSubject | 2 | Spec is enough to brief a camera or a generator |

---

### G8 — Real camera / multicam

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| MulticamGroup type | W3 MulticamSession | Multicam | SHELL | `{cameraAssetIds, syncOffset}` empty array | Sync engine, switch EditOps | Ingest | 9 | Group two+ angles; offsets persist |
| Camera metadata / timecode | W1, W3 | Ingest | PARTIAL | ffprobe codec/fps/wh; no TC | Timecode, reel, camera index | probe.ts | 9 | Slate/TC visible per asset |
| Audio / waveform sync | W3, W6 | Multicam | RESEARCHED | Per-asset waveforms exist | Cross-asset alignment | Waveforms | 9 | Sync by waveform within tolerance; human override |
| Angle viewer + switch/cut + multicam timeline | W3, W8 V2 | Editor | NOT STARTED | — | Angle strip; `switchAngle` EditCommand | MulticamGroup | 9 | Cut between angles without ungrouping |
| AI speaker detection / best-angle suggestions | W3 later, W8 | Multicam + Intel | RESEARCHED | — | Observations → suggestions, never auto-cut without mode | Video Intelligence | 9 | Suggestions are EditCommands in ASSIST/SUGGEST |

---

### G9 — Subject / person / object tracking

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| TrackSubject V1 person in a shot | W3, W8 V1; 1.3 | Tracking | SHIPPED | SAD template match; confidence; lost; reacquired; humanCorrected; editor inspector; Commander Sample.mp4 60 keys conf 0.630–0.951 | Identity tracking; SAM2 VOS | ffmpeg, asset file | 1 | Select person → keyframes written; follow crop is not center-crop |
| Kinds: face, body, person, hands, product, object, custom | W3 | TrackSubject | PARTIAL | kinds `person\|face\|body\|object` | hands, product, custom selection UI | SAM2 later | 5 | Person is G9-01. Other kinds are Phase 5 |
| Mask / attachment / text / graphics attachment / tracked effects | W3 `AttachOverlayToSubject` | Tracking + graphics | RESEARCHED | OverlaySpec is free-floating | Attach-to-subject; mask field | TrackSubject, overlays | 5 | Logo/text stays on face/product through motion |
| Occlusion / lost / reacquisition / human correction in record | W3; P1-F | TrackSubject | SHIPPED | status + confidence + `correctTrack` + `reacquireTrack` (preserves prior keys) + Inspector lost UX | Explicit occlusion masks; identity-within-shot | — | 1 | Lost frames flagged; human fix stores correction |
| SAM2 VOS + optional ByteTrack (not Ultralytics AGPL) | W3, Wave A ESTABLISHED | Tracking | RESEARCHED | Template match stand-in | Local SAM2 worker on Nebula | CUDA, license | 5 | Tracker quality on moving talent; HOLD realtime 4K remains |
| Auto reframe from track | W3, W8 | VirtualCamera | SHIPPED | `autoReframe` + `deriveVerticalVersion` | Hair-mask reframe (W8 V2) | TrackSubject | 1 | 16:9→9:16 uses subject, with human override |

---

### G10 — AI follow camera (virtual)

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Follow this person / object | W3; 1.3; P1-F | VirtualCamera | SHIPPED | `setVirtualCamera`; Track Subject pick/confirm; SHOW/HIDE TRACK; source vs camera preview; real-person FACE LOCK 9:16 | Object-first UX beyond person seed | TrackSubject | 1 | Shot-local follow of selected person; not biometric ID |
| Modes: face lock, upper-body, full-body, center lock, thirds, cinematic, dynamic social | W3; P1-F | VirtualCamera | SHIPPED | All 7 modes in `followFramingCrop` with distinct crop/focus; Inspector exposes all 7 | Independent lead-room slider | — | 1 | Each mode changes crop window predictably |
| Convert tracking → crop / pan / zoom / keyframes / framing | W3; 1.3 | tracking.ts | SHIPPED | `followFramingCrop`; interpolated crop keyframes; sourceRatio; render crop; dynamic 9:16 (not center crop) | Independent pan/zoom channels; bezier | Render engine | 1 | Rendered 9:16 matches Program Viewer framing |

---

### G11 — Media library / asset management

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Ingest + proxy + thumbnails + waveforms | W1, W8 | Ingest | SHIPPED | Original copy, SHA-256, probe, JPEG thumb, 1280 proxy, peaks JSON | Proxy ladder; optimized media | FFmpeg/NVENC | 1 | Library shows thumb; timeline uses proxy; original untouched |
| AssetRecord | W5, W7 | Library | SHIPPED | kind, paths, codec, fps, channels, generated flag, provenance | Bins; ratings; keywords; slate | — | 1 | Every file on timeline is an AssetRecord |
| Bins / folders / collections / favorites / rejected / ratings / keywords / tags | W8 MAM later | Library | NOT STARTED | Flat asset list | Organization graph; reject ≠ delete | Policy | 1/6 | Rejected take hidden from selects, original kept |
| Metadata: camera, take, scene, slate, date, location, talent, lens, codec, resolution, fps, audio channels | W8 dailies V3 | Library | PARTIAL | Probe: codec, resolution, fps, channels, duration | Camera/take/scene/slate/lens/talent/location | Dailies, breakdown | 6 | Filter library by scene+take |
| Origins: camera, upload, generated, derived, captured, stock, render, audio, still, graphic | W5 provenance | AssetRecord | PARTIAL | `generated`, `kind`, render `outputOfRenderJobId`, provenance.provider | Explicit origin enum | Router, render | 2 | Origin visible on every asset |

---

### G12 — Dailies

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Scene/take grouping, slate, takes, selects, circle, rejected, notes, director notes, continuity notes | W8 film UI V3 | Dailies | RESEARCHED | — | `TakeRecord`; dailies UI | Library metadata, film structure | 6 | Group by scene/take; circle take; reject does not delete |
| Sync sound + proxy for dailies | W6, W8 | Dailies | PARTIAL | Generic ingest proxy/waveform | Daily-specific sync + review player | Multicam later | 6 | Daily review plays sync picture+sound |
| AI best-take suggestions | W4 quality rank; W8 | Dailies + Director | RESEARCHED | — | Ranker; never auto-delete alts | Video Intelligence, QC | 6 | Suggestions create a Version of selects; alts remain |

---

### G13 — Professional NLE

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Insert / overwrite / append / split / trim / ripple delete / move | W1, W8 V1; 1.2 drag; P1-A | EditOps + timeline UI | SHIPPED | Kernel+UI: insert, overwrite (carve remnants), append, split, trim, rippleDelete, moveClip drag | Blade click-to-cut (separate row) | G0 | 1 | Each op has EditCommand + visible timeline result + undo |
| Lift / extract | W1; HVS-P1-SLICE-A | EditOps | SHIPPED | `liftClip` leaves gap; `extractClip` ripples closed; editor + Director | Range lift/extract | Tracks SoT | 1 | Lift leaves hole; extract closes via optional ripple |
| Blade as tool | W1; P1-G | UI | SHIPPED | Select vs Blade; click clip → typed `splitClip` at pointer | Razor on magnetic tracks | — | 1 | Click cut on clip |
| Roll / slip / slide / extend | W1; HVS-P1-SLICE-A | EditOps | SHIPPED | `rollEdit`, `slipClip`, `slideClip`, `extendEdit`; toolbar + Director | On-clip trim handles | Adjacent clips | 1 | Roll preserves total duration; slip/slide preserve duration |
| Duplicate | W1; HVS-P1-SLICE-A | EditOps | SHIPPED | `duplicateClip` command; editor + Director | Clipboard copy/paste | — | 1 | Duplicate is a command, not copy-paste of raw JSON |
| Nested sequences / compound clips | W1, W8 later | Timeline | NOT STARTED | Single timeline-main | Nested timeline ids | G0 | 5/9 | Nest sequence; open in place; render uses nest |
| Synchronized clips / multicam clips | W3 | Timeline | NOT STARTED | MulticamGroup shell | Sync clip type | G8 | 9 | Linked A/V stay linked through trim |
| Adjustment / effect layers | W6 EffectGraph | Timeline | NOT STARTED | V2 graphics track is clip-based | Adjustment track kind | Effects | 5 | Grade on adjustment layer affects below |
| Snapping | W1; HVS-P1-SLICE-A | UI | SHIPPED | Snap toggle; snap to clip edges, playhead, markers | Magnetic vs snap prefs beyond toggle | Markers | 1 | Snap toggle |
| Markers / ranges | W4; HVS-P1-SLICE-A; P1-G | Timeline | SHIPPED | `addMarker`/`updateMarker`/`removeMarker`; inspector; undo/redo | Beat detection; cut-on-beat (Phase 5 G34-03) | Music beat grid | 1 | Add/edit/move/remove marker; beat detection is later |
| Source monitor | W8 V1; HVS-P1-SLICE-B | Preview | SHIPPED | Dual Source\|Program; rational source playhead; Mark In/Out session state; insert/overwrite/append via existing EditOps; proxy preferred. Live proof: `hvs-muafr0xk-vb95` IN 00:00:00:12 OUT 00:00:02:00 insert | Nested sequences from source | Ingest | 1 | Mark In/Out from source then insert |
| Program Viewer | W8; P1-B; P1-C; P1-D; P1-F; P1-G | Preview | PARTIAL | HTML5 + overlays + CSS filters + 9:16 framing + gap black + speed/reverse/freeze + captions/titles + dissolve dual-video + Web Audio pan + Track Subject pick/overlays. **Phase-1 contract accepted.** | GPU compositor; filmstrip | Render graph | 1/5 | Scrub matches shipped ops. GPU compositor is Phase 5/9 |

---

### G14 — Keyframe / animation

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Subject/camera keyframes | W3 | TrackSubject / VirtualCamera | SHIPPED | Time-keyed boxes and crops; linear interpolate | Bezier | — | 1 | Follow is keyframed |
| General keyframes: position, scale, rotation, opacity, crop, audio, filters, effects, masks, camera, speed | W2, W6 | Animation | NOT STARTED | Clip has static transform/opacity/volume | Keyframe tracks; copy/paste | EffectGraph | 5 | Animate opacity with ease; copy keyframes between clips |
| Interpolation: linear / ease / bezier | Directive §14 | Animation | RESEARCHED | Linear on follow only | Curve editor | — | 5 | Bezier handles persist in `.hvsproj` |

---

### G15 — Speed / motion

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Slow / fast / reverse / freeze | W1; W6; HVS-P1-SLICE-B | Clip + EditOps | SHIPPED | `setSpeed` scales timeline duration; `reverseClip` remaps source; `createFreezeFrame` derived still + provenance; Program + libx264 render; atempo audio (pitch-preserving 0.5–2) | Variable speed ramps | Render | 1 | Timeline + Program + render agree on 0.5x / reverse / freeze |
| Variable speed / speed ramp | W2 `SetSpeedRamp`; W6 | Clip | RESEARCHED | — | Ramp keyframes | G14 | 5 | Ramp 1.0→0.3 over a beat |
| Optical flow / interpolation / motion blur | W6 INTERPOLATION provider | Motion | SHELL | Router category INTERPOLATION stub | Real adapter; in-graph motion blur kind exists unrendered | Router or local | 5 | Optional flow interp is an Asset derivation, then EditCommand |
| Stabilization | W6 | Motion | RESEARCHED | — | Stab pass → derived asset | FFmpeg vidstab or similar | 5 | Stabilize is non-destructive derived media |
| Rolling shutter correction | Directive later | Motion | RESEARCHED | — | Later | — | 9 | Documented as later; not a Phase 1 blocker |

---

### G16 — Transitions

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Parameterized transition model | W2, W6; P1-D | transitions.ts | SHIPPED | Dissolve object + add/update/removeTransition; Program dual-video; FFmpeg xfade; audio afade | Full family (wipe/dip/3D) | Render graph | 1/5 | Adding dissolve changes Program and master |
| Full family: cut, dissolve, dip, wipe, push, slide, blur, zoom, spin, glitch, mask, morph, light, 3D, camera | W2 + directive | Transitions | PARTIAL | Subset registered; glitch as effect | dip, spin, morph, 3D | EffectGraph | 5 | New kinds are data, not one-off code paths |
| Cut (default) | W1 | Timeline | SHIPPED | Adjacent clips | — | — | 1 | Straight cut is default with no transition object |

---

### G17 — Filters / looks

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| HVS-owned looks (non-destructive, adjustable) | W2 | filters.ts | SHIPPED | 11 CSS looks; `applyFilter` amount 0–1; preview | Horror, sci-fi, music-video packs; render uses CSS≠ffmpeg | ThemeSpec | 1 | Apply look in Program; amount adjustable; undo |
| Rendered look matches preview | W6; P1-D; P1-G | Render | PARTIAL | `look-lowering.ts`: eq/sepia/hue/colorbalance for Phase-1 supported properties | PREVIEW-ONLY letterSpacing, glow, grain, film, gold-veil (Phase 5) | G19 | 1/5 | Phase-1 looks lowered; remaining preview-only is later |
| Versioned looks | W2 cloud-vanish lesson | FilterSpec | PARTIAL | ids stable | Look version field; user SaveAsLook | ThemeSpec | 1 | Updating a look does not silently rewrite old projects |

---

### G18 — Themes

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| ThemeSpec engine (font, caption, title, transition, effects, color, pacing, motion, music, logo, overlays, camera hints) | W2 ThemePack; W7–8 ThemeSpec | themes.ts | SHIPPED | Full ThemeSpec type; `luxury_beauty_v1`; `applyTheme` | Most slots not executed (motion graphics names are strings) | Captions, color, logo | 1 | Applying luxury_beauty_v1 sets caption style + color + optional transition |
| Genre theme library (commercial, beauty, luxury, documentary, cinematic, horror, gaming, music video, wedding, automotive, real estate, social, YouTube) | W2, W8 | Theme registry | PARTIAL | One theme | Pack library | G18 engine | 2 | At least one pack per listed genre, versioned, local |
| No CapCut runtime | All waves | Policy | SHIPPED | Comment + owned packs | — | — | 1 | Zero CapCut API/scrape |

---

### G19 — Color grading

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Thin grade: exposure, contrast, saturation, temperature | W6 V1 thin; P1-G | ColorGrade | SHIPPED | Fields + inspector + CSS Program + ffmpeg `eq`/`colorbalance`; RENDER-LOWERED | Tint; UI scopes; ACES/OCIO/HDR (Phase 5) | Render | 1 | Skin-safe STARRDOM look adjustable |
| Curves, hue curves, wheels, lift/gamma/gain | W6 V2 | Color | RESEARCHED | NamedModule reserves them | Color engine | OCIO | 5 | Shot match via wheels without flattening to CSS |
| Masks, qualifiers, tracking, skin-tone protection | W6, W3 | Color | PARTIAL | HSL+luma qualifier FFmpeg; not skin-tone or full track-qualify | Qualifier + track bind | TrackSubject, EffectGraph | 5 | Grade face not background |
| LUTs | W6 V1 LUT | Color | RESEARCHED | lookId string | LUT load/apply | OCIO or cube | 5 | Load .cube; non-destructive |
| Scopes: waveform, parade, vectorscope, histogram | W6 | Color UI | NOT STARTED | Audio waveform ≠ luma waveform | Scope renderer | Preview | 5 | Scopes update on playhead |
| HDR / log / OCIO / ACES | W6, W8 V2 | Color | RESEARCHED | — | OCIO 2.5 + ACES 2.0 configs | Legal/config | 5 | Log footage views through OCIO; display-referred delivery still works |

---

### G20 — VFX / compositing

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Effect kind registry | W6, W7 | effects.ts | SHELL | 17 kinds; `applyEffect` stores params on clip | Evaluation; OpenFX not hosted (correct) | — | 5 | Applying glow is visible in Program and render |
| EffectGraph architecture | W6–W7 | VFX | RESEARCHED | — | Node graph object in `.hvsproj` | Clip effects | 5 | Graph is data; renderer lowers it; plugins cannot own SoT |
| Masks, rotoscope, keying (chroma/luma), planar/motion track, paint/remove, insert, relight, sky/bg replace, matte, alpha, blend, particles, glow, blur, distortion, lens, grain | W6 + directive | VFX | RESEARCHED | glow/blur/grain/distortion registered unused | Operators + mattes (SAM2) | Tracking, Router IMAGE_EDITOR | 5/9 | Chroma key + tracked matte as EffectGraph; originals kept |
| Future 3D compositing | W8 Natron/Blender subprocess | VFX | RESEARCHED | — | Subprocess lane | GPL isolation | 9 | Comp comes back as Asset + graph ref |

---

### G21 — Background / object editing (AI)

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Remove/replace/blur background; remove person/object; insert object; isolate subject/product; relight; sky replace; depth-aware | W5 EditImage/ReplaceBackground; W6 | Router IMAGE_EDITOR | SHELL | Category stub `configured:false`; generate jobs blocked | Adapters; depth; human preview | AssetRecord, provenance, consent | 2 | Result is new Asset; original remains; optional Replace on timeline via EditCommand |

---

### G22 — AI video generation

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Provider-neutral Router | W5, W7, W8 | provider-router.ts | SHELL | Categories + stub adapters | ≥1 real image + ≥1 real video adapter; download-before-timeline | Keys (names only), provenance | 2 | Job → file in library → AssetRecord; `.hvsproj` has no vendor timeline objects |
| T2V / I2V / V2V / ref-image / character-ref / first-last frame / continuation / B-roll / style / motion / performance transfer / camera control / relight / bg change / scene extend / insert-remove | W5 | VIDEO_GENERATOR | SHELL | `generateVideo` queues blocked ProviderJob | Mode matrix; CameraSpec plumbing; character refs | ShotSpec, CharacterBible, Router | 2 | Each mode is a request category+params; output is Asset |
| Sora excluded | W5 DEAD | Router | BLOCKED | No Sora adapter (correct) | Keep excluded | — | — | Router defaults never list Sora |
| Anti fake-local | W7 | Router | RESEARCHED | Policy text | Enforce download + hash before insert | Ingest | 2 | Insert fails if file not in library |

---

### G23 — AI image production

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Concept art, storyboard art, posters, thumbnails, key art, characters, locations, backgrounds, product, mattes, textures, promo | W5 | IMAGE_GENERATOR | SHELL | `generateImage` blocked job; `/ai-images` boundary | Purpose enum; board/poster templates | Router, Storyboard, CharacterBible | 2 | Generated still is Asset with purpose + provenance |
| Image edit | W5 | IMAGE_EDITOR | SHELL | Stub adapter | Real edit ops | G21 | 2 | Edit yields child asset with parentAssetId |

---

### G24 — Character system

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| CharacterRecord | W5 CharacterBible | Characters | SHELL | `{name,role,notes,referenceAssetIds,identityMorphing}`; STARRDOM seed | Full bible fields | Consent | 4 | Character exists on project; morphing default off |
| CharacterBible: appearance, age, wardrobe, hair, voice, personality, behavior, relationships, approved refs, expressions, gestures, history, canon, usage rights, looks over time | W5 | Characters | RESEARCHED | Thin record | Bible schema + multi-look | Rights, Voice | 4 | Episode 2 wardrobe B does not overwrite wardrobe A |
| Characters UI | W7 | `/characters` | SHELL | Boundary page | Bible editor | — | 4 | Approve a reference image; it is the only likeness source for gen |

---

### G25 — World bible

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Locations, architecture, geography, history, factions, technology, culture, props, rules, visual language, lighting, weather, time periods | W8 long-form V3; directive §25 | WorldBible | NOT STARTED | — | `WorldBible` object | Continuity, locations in breakdown | 4/6 | Location “night rain alley” is canonical across scenes |

---

### G26 — Continuity memory

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Track wardrobe, hair, makeup, injuries, props, location state, object placement, time, weather, knowledge, relationships, dialogue facts, prior actions | W8 V3 continuity | Continuity | RESEARCHED | — | ContinuityStore per scene/shot | Script, Character, World, Dailies | 6 | Changing a prop in scene 4 flags scene 7 |
| AI continuity warnings | W4 | Director | RESEARCHED | — | Checker emits warnings, not silent fixes | ContinuityStore | 7 | Warning is visible; auto-fix only via Edit/Script command after confirm |

---

### G27 — Video Intelligence

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Watch / understand / search / remember / learn boundary | W4 intel hooks; W8 live local subset | video-intelligence.ts | SHIPPED | local-ffmpeg-vision writes timestamped observations; MEDIA search; cache; Director sourceSeek; authorized/local only | ASR, objects, action, embeddings, identity, biometrics stay on G27-02/G29 | Ingest | 3 | Watch of a clip writes observations with timestamps |
| Analyze scenes, shots, people, objects, actions, speech, camera, composition, transitions, effects, color, music, sound, pacing | W8 CLIP V2; directive | Intel | SHELL | Observation fields exist empty | Detectors; transcript; camera classify | ASR, tracking | 3 | Queryable observations for a STARRDOM clip |
| Never scrape the open web automatically | W7, video-intelligence header | Policy | SHIPPED | Comment + local-only design | Keep | — | 3 | No implicit Firecrawl of random URLs from Watch |

---

### G28 — Video learning / production knowledge

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| TechniqueRecord | Directive §28; typed ahead of waves | video-intelligence.ts | SHELL | Full type + in-memory save; `verifiedByHuman` | Persist in `.hvsproj`; extraction pipeline | G27 | 8 | “Learn this transition” → TechniqueRecord requiring human verify |
| VideoAgent-style memory / VideoSeek evidence / VideoAgentTrek procedure extraction | Directive §28 (inspirations; not HVS SoT names in waves) | Learning | RESEARCHED | — | Evidence spans; procedure graph | Intel, TechniqueRecord | 8 | Procedure cites timestamps; unverified techniques cannot run |
| Human verification → Production Knowledge → Director applies via EditOps | W4 Tips≠Ops | Director | RESEARCHED | Director already emits EditCommands only | Technique → EditCommand recipe | G30, G13 | 8 | Applied technique is a transaction, undoable, attributed |

---

### G29 — Media search

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Natural language: close-ups, actions, actor, object, lines, best reaction | W4 SearchMedia; W8 | MediaSearchIndex | SHELL | In-memory substring over observations (empty) | Visual+transcript+metadata index | G27, captions, CameraSpec | 3 | “Find every close-up” and “find the red car” return timed hits |
| CLIP / clusters | W8 V2 | Intel | RESEARCHED | — | Embeddings | Local CLIP MIT | 3 | Semantic similar-shot search |

---

### G30 — AI Director

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Six control modes | W4 | DirectorMode | SHIPPED | MANUAL / AI_ASSIST / AI_SUGGEST / AI_FIRST_CUT / AI_DIRECTOR / AUTOMATIC_DRAFT | Mode-specific UX gates complete | — | 1 | FIRST_CUT always createVersion; DRAFT never publishes |
| Utterance → typed EditCommands | W4 | ai-director.ts | PARTIAL | Regex mapper (STARRDOM-ish phrases); preview/commit API + editor panel | LLM planner; tool-use over all kernel objects | EditCommands | 1/7 | “Follow the actor” / “color colder” / “cut on the beat” (with markers) commit real ops |
| Rough cut / best takes / scene tense / trailer / missing establishing / fix continuity / add rain / replace background | Directive §30 | Director | SHELL | Fallback often `createVersion` bookmark | Requires G3–G6, G12, G22, G26, G27 | Phases 2–7 | 7 | Each command listed is a typed plan with preview |
| Tips ≠ Ops | W4 | Director | SHIPPED | Proposal.commands is the op list | Keep; never RPA | — | 1 | UI explanation cannot mutate state alone |
| LLM-backed director | W4 | Director | NOT STARTED | No provider LLM call | Planner constrained to command schema | Router or Council handoff | 7 | Model output that is not a valid command is rejected |

---

### G31 — Audio editing

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Waveform display | W6 | Timeline | SHIPPED | Peak JSON on audio clips | Sample-accurate zoom | Ingest | 1 | Waveform visible on A tracks |
| Multitrack + volume + fades + duck | W6 V1 | Audio | SHIPPED | A1/A2 tracks; setVolume; setFade; duckMusic; render amix/afade | More buses; automation curves | — | 1 | Music ducks under VO in render |
| Pan | W6; P1-D | Clip.pan | SHIPPED | `setPan` -1..+1; inspector L/C/R; Web Audio StereoPanner preview; FFmpeg pan=stereo; undo/redo | Clip-level only (no DAW automation lanes) | — | 1 | Pan audible in mix |
| EQ / compressor / limiter / gate / de-esser / reverb / delay | W6 V2 Fairlight-class | Audio | NOT STARTED | NamedModule reserved | DSP graph | EffectGraph | 5/9 | Dialogue chain audible; params in `.hvsproj` |
| Loudness / normalization / automation / buses / stems | W6 | Audio | RESEARCHED | — | LUFS; buses; stem export | Render | 5/9 | Stem export + LUFS target |

---

### G32 — AI audio

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Denoise, dereverb, isolate, enhance, silence/filler removal, stems, generate SFX/ambience/Foley/music, translation, dubbing | W6 Router TTS/MUSIC/SFX | Router | SHELL | Categories TTS/VOICE/MUSIC/SFX/TRANSCRIPTION/TRANSLATION stubs | Real adapters; derived Assets | G22 pattern | 2 | Each tool writes a child Asset; original kept |

---

### G33 — Voice / ADR

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Insert VO clip | W6 | addVoice | SHIPPED | EditOp places audio on dialogue track | Recording booth | — | 1 | Imported VO sits on A1 |
| Voice Studio: record, generated voice, character voice, ADR, timing, sync | W5 ElevenLabs via Router; W6 | Voice | SHELL | `/voice` boundary; LIP_SYNC category stub | Recorder; ADR takes; character voice bind | CharacterBible, Router | 2/9 | ADR take is a TakeRecord linked to dialogue cue |
| Multilingual dubbing / future lip-sync | W5 Dub | Voice | RESEARCHED | Stub LIP_SYNC | Adapters; lip-sync later | Translation | 9 | Dub Asset + optional lip-sync derivation; consent required |

---

### G34 — Music

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Import + place + duck | W6 V1 | addMusic | SHIPPED | EditOp + duck | — | G31 | 1 | Licensed bed on A2, ducked |
| Generation | W5/W6 MUSIC router | Router | SHELL | Stub | Adapter; provenance/license | Rights | 2 | Generated cue is Asset with commercialUse |
| Score-to-scene / BPM / beat / downbeat / phrase / markers / beat-sync cut | W6 BeatGrid; CapCut Auto Cut REFUSE | BeatGrid | RESEARCHED | Director can cut-on-beat **if** beat markers exist | librosa-first BeatGrid; madmom NC REFUSE | Markers | 5 | Detect beats → markers → optional beat-sync EditCommands; no CapCut Auto Cut |

---

### G35 — Sound effects / Foley

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| SFX library + generated SFX + Foley + ambience + room tone + beds + impacts + transition whooshes + sync | W6 | Audio + Router SFX | SHELL | Music page label includes SFX; stub SFX adapter | Library bins; generate; sync-to-hit | G11, G32 | 2/5 | Footstep Foley lined to picture hits |

---

### G36 — Captions / subtitles

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Caption tracks + cues + speaker + theme styling + ASS burn-in | W2, W6, W8 V1; P1-C | Captions | SHIPPED | Typed add/updateCaption; inspector; Program overlay; ffmpeg ASS; dedupe | Word-level UI; karaoke; sidecar (other rows) | ThemeSpec | 1 | Captions on Program and burned master |
| Transcription / word-level timing / speaker labels | W6 Whisper hybrid | TRANSCRIPTION | SHELL | `words[]` on cue type; stub transcribe adapter | ASR job → cues | Router or local Whisper | 1/2 | Transcribe clip fills cues with word times |
| Animated / karaoke captions | W2 | Captions | PARTIAL | animationStyle string | Engine | ThemeSpec | 2 | Karaoke uses word times |
| Translation + subtitle export + accessibility | W6 TRANSLATION | Captions | SHELL | Stub translate | Tracks per language; SRT/VTT export | Router | 2 | Export SRT; second language track |

---

### G37 — Titles / motion graphics

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Titles, logos, static overlays | W2 TitlePack; W8; P1-C | graphics.ts | SHIPPED | add/update/move/setStyle/remove; HVS presets; ASS+logo PNG | CTA pack beyond lower-third foundation | ThemeSpec | 1 | Logo + title on STARRDOM 16:9 master |
| Lower thirds / CTA / animated text / templates / keyframeable graphics | W2; P1-C foundation | Graphics | PARTIAL | Static lower-third OverlaySpec + addLowerThird | Animation; CTA packs | G14 | 5 | Lower third animates in/out |
| Node/graph motion design | W7 Extension Host | Motion | RESEARCHED | motionGraphics string ids on theme | Graph later | EffectGraph | 9 | Optional graph; SoT remains `.hvsproj` |

---

### G38 — Opening / end credits

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Cast, crew, roles, legal, music credits, logos, crawl, cards, end titles | Directive §38 | Credits | NOT STARTED | Theme logoPlacement.endCard boolean only | `CreditsRoll` object + crawler | Characters, rights, G37 | 6/9 | End crawl from crew list; legal cards hold |

---

### G39 — Quality control

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| ffprobe success gate on render | W8 quality flags; P1-G | Render | SHIPPED | Probe width/height/duration/hasA/V; failed encode cannot complete | Not a QC suite (Phase 6) | — | 1 | Failed encode cannot mark completed |
| Auto QC: blur, focus, shake, clipped highs/crushed blacks, bad audio, silence, clipping, dup/corrupt frames, missing media, aspect, caption overflow, logo safe, black/flash frames, continuity | W8 V1 flag/rank; directive | QC | PARTIAL | Technical detectors implemented; editorial QC not claimed | Policy never silent-delete | QC report object; flags on ranges | Intel, scopes, captions | 6 | QC list is ranked; media not deleted |
| Safe-area / guides | W7 UI; P1-C | Preview | SHIPPED | Title-safe 10% + action-safe 5% for 16:9/9:16/1:1; overflow WARNING; Director clamp EditOp | Full QC suite (other row) | Captions, logo | 1 | Guide visible; overflow flagged |

---

### G40 — Render / mastering

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| FFmpeg compose + NVENC or libx264 + queue + output Asset | W1, W6, W8 | render-engine | SHIPPED | Queue UI; encoder probe; 16:9/9:16/1:1 1080 H.264 AAC; speed/reverse/freeze in graph | Transitions/effects/CSS filters/pan in graph | ffmpeg.ts | 1 | STARRDOM 16:9 and 9:16 files exist as Assets with provenance |
| Render fidelity vs timeline | W6 PreviewTicket; P1-B; P1-C; P1-D; P1-G | Render | PARTIAL | Color eq, crop follow, captions, logos, titles, volume/fades/duck, speed, reverse, freeze, pan, dissolve xfade, supported CSS looks | clip.effects; remaining preview-only looks; GPU compositor | G13–G17 | 1/5 | Every SHIPPED timeline op appears in master. Advanced compositor later |
| Presets: H.264, H.265, AV1, ProRes (if lawful), DNx, image sequence, alpha, audio masters, subtitles, platform variants | W6, W8 | RenderTarget | PARTIAL | Hardcoded mp4/h264/aac | Codec/legal matrix; mezzanine; archive | Counsel on nonfree/GPL | 9 | Delivery preset is data; film mezzanine researched then offered if legal |
| Background render / cache / proxies / optimized media | W6 | Media plane | PARTIAL | Proxy on ingest; queue | Render cache; optimized media | NVENC | 1/9 | Re-render uses cache where graph unchanged |
| Theatrical / archive master research | Directive §40 | Mastering | RESEARCHED | — | Research note → later preset | Legal | 9 | Documented; not a Phase 1 claim |

---

### G41 — Project interchange

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| `.hvsproj` remains SoT | W7–W8 | Project | SHIPPED | — | — | — | 1 | Import never becomes SoT |
| OTIO | W1, W8 V1 thin | Interchange | RESEARCHED | No importer/exporter in media-command | Thin adapter | otio Apache-2.0 | 9 | Export OTIO for cut; re-import is lossy and labeled |
| EDL / FCPXML / AAF research / subtitle formats / media manifests | W8 later | Interchange | RESEARCHED | — | Exporters; AAF research note | OTIO first | 9 | EDL out; AAF not claimed until researched |

---

### G42 — Film / show structure

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| productionMode enum (COMMERCIAL…FILM_SHOW) | W8 schema keys V1; P1-G | Project | SHIPPED | Enum + STARRDOM flag persisted on `.hvsproj` + catalog | Hierarchy objects (Phase 6) | — | 1 | Mode is stored |
| Production → Season → Episode → Act → Sequence → Scene → Shot → Take → Asset | W8 V3 UI; directive | Structure | NOT STARTED | Optional keys were supposed to be ignored in v0 — not present | Nested ids on project | Script, dailies | 6 | Episode 2 scene 4 shot 3 take 2 is addressable |
| Film → Act → Sequence → Scene → Shot → Take | Directive | Structure | NOT STARTED | SHORT_FILM / FILM_SHOW modes only | Same objects, no season | — | 6 | Feature navigable by act/scene |

---

### G43 — Version / revision system

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Edit versions + snapshots + derived 9:16 version | W4 CreateVersion; P1-E | ProjectVersion | SHIPPED | snapshotVersion; restoreVersion; createVersionFrom; Version Browser; deriveVerticalVersion | Discipline version lanes (Phase 6) | store.ts | 1 | 9:16 is derived, not an overwrite of 16:9; restore never deletes history |
| Script / storyboard / scene / VFX / color / audio / render versions | W4; directive | Versions | NOT STARTED | One version stream for whole project | Discipline version lanes | G2,G4,G20,G19,G31,G40 | 6 | Approving color v3 does not clobber edit v7 |
| Never silent overwrite of approved work | W4 | Policy | PARTIAL | FIRST_CUT requires new version | Approval states per discipline | G45 | 6 | Approved node is immutable except via new child version |

---

### G44 — Plugin / extension system

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Extension Host for effects/generators/transitions/analyzers/exporters/codecs | W7 | Plugins | RESEARCHED | Kind registry only | Host ABI; sandbox | EffectGraph | 9 | Plugin cannot write `.hvsproj` except via validated commands |
| OpenFX as one integration layer, not SoT | W6–W8 V2 | OFX | RESEARCHED | Explicitly not hosted (correct for V1) | Host later | Legal BSD-3 | 9 | OFX effect params stored in HVS graph |

---

### G45 — Production management

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Tasks, scene/shot/production status, notes, assignments, dependencies, approvals | W7 Client Work adjacent; directive | Production | NOT STARTED | `productionMode` only | Task graph | Structure G42 | 6 | Shot status does not block editor |
| Call sheets / schedules / shot schedules / budget (later) | Directive later | Production | RESEARCHED | — | After editor+structure | G45 core | 6+ | Explicitly non-blocking for Phases 1–5 |

---

### G46 — Rights / provenance

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| AssetProvenance (provider, model, prompt, refs, license/commercialUse, parent, params) | W5, W7, W8 V1 | Provenance | PARTIAL | Type filled on render/graphics; commercialUse enum | Talent/location/music releases; timeline-usage index | Router | 1/2 | Generated asset shows provider+prompt+commercialUse |
| Talent release / location release / music rights / usage on timeline | W7 Domain 32 Client Work | Rights | RESEARCHED | Client agreement-before-ingest in research | Clearance objects; ingest gate | Client Work | 2/6 | Ingest blocked without agreement when Client Work mode on |
| C2PA evaluate | W8 V2 | Provenance | RESEARCHED | — | Evaluate/export | — | 5 | Optional C2PA on export; not required to edit |
| Beauty OFF / consent / disclose AI plates | W2, W5 ethics | Policy | SHIPPED | Default off; STARRDOM comments | Disclose UI on delivery | CharacterBible | 1 | Cannot morph identity without authorization flag |

---

### G47 — Human / AI collaboration

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| Visible, typed, previewable, undoable, versioned, attributable AI ops | W4; P1-A redo; P1-G | Director + EditCommands | SHIPPED | Actor field; Preview/Commit/Reject; version on FIRST_CUT; snapshot undo+redo | LLM Director (Phase 7) | G0 | 1 | Every AI commit shows actor + command list |
| AI can draft; cannot silently publish final | W4 G9 publish gate | Policy | SHIPPED | Policy blocks publish | Delivery “publish” still human | G40 | 1 | No API publishes |
| Observed vs Scenario layers | W1, W4 | Kernel | RESEARCHED | Single working timeline | Named Observed vs Scenario | Versions | 7 | Scenario edit does not mutate Observed media |

---

### G48 — Create from prompt (on top of real tools)

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| “Tell HVS what I want” invoking research→script→characters→world→boards→shots→generators→editor→camera→audio→music→color→VFX→render | W4 G0–G9; directive §48 | Director orchestration | RESEARCHED | Regex director is phrase→few EditOps | Full tool orchestration | **All prior groups** | 10 | “12-minute sci-fi short” produces a production plan + objects + first-cut Version, not a single MP4 from a vendor |
| Forbidden: fake prompt-to-film bypass | Directive §48 | Policy | SHIPPED as doctrine | No bypass product exists | Keep; Phase 10 must call real tools | — | 10 | No route that writes a timeline from a provider file without EditCommands |

---

### GX — Research extras (not in the 48, still in scope)

| Capability | Research | Subsystem | State | Existing | Missing | Dependencies | Phase | Acceptance |
|---|---|---|---|---|---|---|---|---|
| STARRDOM luxury-ad proving path | W5, W8 §5 | Fixture + ethics | PARTIAL | `starrdom.ts` fixture + theme + follow + 16:9/9:16 render | Router gen plates; ASR; look-render parity; beat markers | Phases 1–2 | 1/2 | W8 walkthrough executable inside HVS with human gates |
| Client Work contracts / commercial tiers | W7 Domain 32 | Client Work | RESEARCHED | — | Contract objects; ingest gate | Rights | 6 | Footage ingest requires recorded agreement when enabled |
| Nebula Linux CUDA/NVENC workers; author UI anywhere | W3, W7; P1-G | Hardware | PARTIAL | NVENC live probe in ffmpeg.ts; **not a Phase-1 requirement** | Dedicated worker queue vs UI process | Hardware | 9 | Heavy track/render can run on Nebula encode path later |
| War Room typed handoffs (Council, Terra, Foundry, WRIM, Research, Memory) | W7 Domain 33 | Boundaries | SHELL | Nav isolation | Actual handoff types | — | 7 | Council receives EditPlan/provenance; Terra not embedded |
| PreviewTicket cost ladder | W4, W6, W7 | Preview | RESEARCHED | — | Ticket object + cost | Render | 5 | Expensive preview is explicit |
| Compose spike: custom+FFmpeg vs MLT vs GES (default custom+FFmpeg) | W7, W8 | Media plane | RESEARCHED | Custom+FFmpeg in render-engine | Timeboxed spike if graph outgrows ffmpeg filters | Legal | 5 | One compose SoR; never dual |
| WRIM as Router backend only if production WRIM exists | W8 V4 | Router | BLOCKED until WRIM real | — | Do not pretend | WRIM | 8 | No fake-local WRIM |
| Ultralytics AGPL in tracker | W8 risks | Tracking | BLOCKED | Prefer SAD now; later ByteTrack MIT / SAM2 | Never silently add YOLO Ultralytics | License | — | Tracker licenses documented |
| Realtime 4K tracking | W3 HOLD | Tracking | BLOCKED | V1 offline-ish SAD | Keep HOLD | Hardware | — | Not a Phase 1 acceptance item |

---

# MASTER BUILD ROADMAP

Goal of the last phase: **a complete film can be developed, shot/generated, edited, finished, and mastered inside Higher Vision Studios.** External providers may generate pixels/sound. They may not own the project.

Do not skip a capability because it is late. Do not finish in another NLE.

---

## Phase dependency

```
Phase 1 Professional editor completion
   ├─→ Phase 2 Generative production
   ├─→ Phase 3 Video Intelligence
   ├─→ Phase 4 Creative development          (parallel after kernel)
   └─→ Phase 5 Professional post
         │
         Phase 2 + 3 + 4 + 5
              └─→ Phase 6 Film / episodic system
                     ├─→ Phase 7 AI Director expansion
                     │      └─→ Phase 8 Video learning / production knowledge
                     └─→ Phase 9 Advanced film production
                            └─→ Phase 10 Prompt-to-film
```

Phase 10 is forbidden until Phases 1–9 tools exist for the path being orchestrated. A commercial can complete earlier (Phases 1–2 + thin 4). A feature cannot.

---

## HVS PHASE 1 — Professional editor completion

**Wave 8 mapping:** close SLICE-1.1 toward V1 honesty (slim path + STARRDOM without gen plates).  
**Why first:** every later phase writes EditCommands into this editor.

### Work packages
1. Close timeline ops: overwrite UI, move/drag, append, lift, extract, blade tool, roll, slip, slide, extend, duplicate, snap, markers.
2. Source monitor + Program fidelity: speed/reverse/freeze, pan, transition playback for cut+dissolve at minimum.
3. Undo/redo in the editor chrome.
4. Caption completeness: word-level optional, export SRT later can wait for Phase 2 ASR — **burn-in already works**.
5. Graphics: keep titles/logos; template lower-third can be thin.
6. Basic audio: pan EditOp + render; keep duck/fade.
7. Tracking/follow: keep V1; add object-follow UX; lead-room mode alias; never center-crop-only.
8. Render graph: lower speed, reverse, freeze, pan, dissolve, CSS-look approximation so master matches Program for shipped ops.
9. Version browser UI (read-only list is enough).
10. Marker UI so beat-cut has somewhere to land (beat *detection* is Phase 5).

### Kernel / UI / services / providers
- Kernel: existing EditCommandLayer + new trim-family commands  
- UI: `HvsEditorShell`  
- Service: `render-engine` fidelity  
- Provider: none required  

### Dependencies / risk
Depends on current slice. Risk: ffmpeg filter_complex complexity — stay custom+FFmpeg; do not introduce MLT/GES in this phase.

### Phase 1 acceptance
- Operator can ingest, cut with pro-ish tools, caption, title, logo, duck music, follow a person to 9:16, undo, and render 16:9+9:16 **inside HVS**.
- STARRDOM fixture still renders without CapCut/FCP/Premiere/Resolve.
- AI Director still only emits EditCommands.

---

## HVS PHASE 2 — Generative production

**Wave 8 mapping:** V1 Router + STARRDOM missing plates.  
**Why:** generation must land as Assets, not as “the product.”

### Work packages
1. Configure Media Provider Router with ≥1 image and ≥1 video adapter (not Sora). Download-to-library before any insert.
2. Real `generateVideo` / `generateImage` / image-edit / TTS / music / SFX / transcription jobs → AssetRecord + provenance.
3. CameraSpec EditCommand + inspector (full size/angle/movement language).
4. ShotSpec minimum so a generated shot has a home.
5. Theme pack library beyond `luxury_beauty_v1`.
6. ASR → caption cues.
7. Background/object edit via IMAGE_EDITOR as derived assets.
8. Disclose AI + commercialUse on library cards.

### Kernel / UI / services / providers
- Kernel: ProviderJob completion path; CameraSpec; ShotSpec v0  
- UI: `/ai-video`, `/ai-images`, `/voice`, `/music` become live, not boundary  
- Service: Router workers; ingest of downloads  
- Providers: commercial APIs (Veo/Kling/Luma/Runway/Firefly/Seedance class; ElevenLabs optional) behind interface  

### Dependencies / risk
Depends on Phase 1 library+timeline. Risks: URL TTL (download immediately); single-vendor lock-in (Router); identity morph (keep OFF).

### Phase 2 acceptance
- Missing B-roll generated → library → human Insert/Replace.
- CameraSpec travels with the request.
- `.hvsproj` opens with zero vendor-specific objects.
- STARRDOM walkthrough step 8 (optional gen plates) works.

---

## HVS PHASE 3 — Video Intelligence

**Wave 8 mapping:** thin V1 intel, then CLIP V2.  
**Why:** search, dailies, director, and learning need observations.

### Work packages
1. Replace `startWatch` stub with real local analysis jobs (scene bounds, people, objects, actions, transcript hook, camera size/movement classify, color/audio events).
2. Persist observations on project or side index (not only memory Maps).
3. Media search UI: the seven example queries in directive §29.
4. Quality-rank flags as observations (not deletes).
5. CLIP/OpenCLIP clusters when ready (can trail 3a).

### Dependencies / risk
Ingested media; optional ASR from Phase 2. No web scrape. GPU on Nebula.

### Phase 3 acceptance
- Watch a clip → non-zero observations.
- “Find every close-up” / “find the red car” / “find this line” return hits.
- Watch never mutates timeline except via later Director commands.

---

## HVS PHASE 4 — Creative development

**Wave 8 mapping:** CREATE tab; STARRDOM steps 1–3; film objects the waves left as “schema later.”  
**Why:** a film starts before the timeline.

### Work packages
1. `CreativeBrief` + development records.
2. `ScriptProject` graph (Scene, Beat, Dialogue, Action, CharacterCue, Transition, Revision, ScriptVersion) + screenplay UI.
3. Breakdown extractor + `BreakdownItem`.
4. Storyboard linked to scene/shot/CameraSpec + generate/replace/reorder.
5. Shot planner (`ShotSpec` complete).
6. Animatic from boards + temp audio (2D).
7. `CharacterBible` replacing thin CharacterRecord.
8. `WorldBible` v0 (locations + visual rules).
9. Research handoff records from War Room Research Engine.
10. ScriptOps for write/rewrite/shorten/extend/tone/continuity/polish/pacing — previewable.

### Dependencies / risk
Phase 1 project store. Phase 2 for generated boards. Do not block editor if script is empty.

### Phase 4 acceptance
- “Make a psychological horror film about…” creates a development project with brief, structured script, breakdown, boards, and shot list **inside HVS**.
- Script is not a single unstructured string.

---

## HVS PHASE 5 — Professional post

**Wave 8 mapping:** V2 post (OCIO, OFX boundary, audio, looks, intel-adjacent).  
**Why:** finishing lives here, not in Resolve.

### Work packages
1. General keyframe system + interpolation.
2. Speed ramp; optical flow as derived asset; stabilization; motion blur.
3. Transition renderer (parameterized family).
4. EffectGraph v0 evaluating registry kinds (glow, blur, grain, key, mask).
5. Color: tint, curves, wheels, LGG, LUT, scopes; OCIO/ACES path.
6. Tracked masks / attach overlay to subject; SAM2 VOS (Apache-2.0) replacing SAD where measured better.
7. Audio: pan already in P1; EQ, comp, limiter, buses, LUFS, BeatGrid (librosa; no madmom NC; no CapCut Auto Cut).
8. Motion graphics keyframes / lower thirds.
9. Compose spike only if ffmpeg graph is insufficient — pick one SoR.

### Dependencies / risk
Phase 1 editor. Legal: OCIO configs; OpenFX host can start as boundary and complete in Phase 9. SAM2 local on Nebula.

### Phase 5 acceptance
- A scene can be graded, mixed, transitioned, and speed-ramped with Program≈master.
- Looks are HVS-owned, not CapCut.

---

## HVS PHASE 6 — Film / episodic system

**Wave 8 mapping:** V3 episode/season + continuity.  
**Why:** features and shows need hierarchy, dailies, bibles.

### Work packages
1. Hierarchy: Production/Season/Episode/Act/Sequence/Scene/Shot/Take (films omit season/episode).
2. Dailies: slate, takes, selects, circle, reject, notes, sync, AI suggest-best without deleting.
3. Library bins/keywords/ratings/slate metadata.
4. ContinuityStore + warnings.
5. World bible filled from production.
6. Discipline versions (script/board/edit/VFX/color/audio/render).
7. Credits object (can be thin cards; crawl in Phase 9).
8. Production tasks/status/approvals that **do not block** the editor.
9. Client Work ingest gate when enabled.
10. QC report (flags only).

### Dependencies / risk
Phases 1, 3, 4. Kitchen-sink risk: keep editor usable on a commercial with hierarchy unused.

### Phase 6 acceptance
- A short film is navigable by act/scene/shot/take.
- Circle take vs rejected take; originals kept.
- Continuity warning on wardrobe mismatch.

---

## HVS PHASE 7 — AI Director expansion

**Wave 8 mapping:** Domain 28 control modes already stubbed; this makes them production-brain.  
**Why:** Director must operate the real tools, not regex a few phrases.

### Work packages
1. LLM planner constrained to command/schema catalogs (EditCommands + ScriptOps + ShotOps + Router jobs).
2. Rough cut, best takes, scene assembly, pacing, camera decisions, continuity check, trailer, missing establishing, “make this tense,” “add rain,” “replace background.”
3. Observed vs Scenario layer.
4. Council handoff of EditPlan/provenance (typed; no module merge).
5. Mode gates: ASSIST confirms destructive; SUGGEST is non-mutating until accept; FIRST_CUT versions; DRAFT never publishes.

### Dependencies / risk
Needs Phase 1 ops, Phase 2 gen, Phase 3 search, Phase 4 script/shots, Phase 5 finishing, Phase 6 takes. Risk: model emitting illegal commands — schema gate.

### Phase 7 acceptance
- Every directive §30 command is a previewable typed plan on a real project.
- No arbitrary state mutation.

---

## HVS PHASE 8 — Video learning / production knowledge

**Wave 8 mapping:** V4 sovereign intel (partial). Directive adds TechniqueRecord pipeline.  
**Why:** HVS should learn procedures from authorized videos and apply them as EditOps.

### Work packages
1. Persist TechniqueRecord in `.hvsproj`.
2. VideoSeek-style evidence windows; VideoAgentTrek-style step extraction (inspirations, HVS-owned types).
3. Human verification queue.
4. Production Knowledge store.
5. Director applies verified technique as EditCommand recipes.
6. Local analysis scale as Nebula measured; WRIM only if production WRIM exists.

### Dependencies / risk
Phase 3 observations. Forbidden: unverified technique auto-run; AGPL tracker; fake WRIM.

### Phase 8 acceptance
- “Watch this tutorial and learn this transition” → TechniqueRecord → human verify → Director applies on a sequence via EditOps.

---

## HVS PHASE 9 — Advanced film production

**Wave 8 mapping:** remainder of V2 host + V3 subprocess + interchange + mastering.  
**Why:** feature finishing and multi-camera production.

### Work packages
1. Multicam: TC, waveform sync, angle viewer, switch, multicam timeline; AI angle suggest using Phase 3.
2. ADR studio + dubbing; lip-sync as later adapter.
3. Full sound post: buses, stems, Foley library, score-to-scene.
4. EffectGraph depth + OpenFX host + optional Blender/Natron subprocess (GPL isolated).
5. 3D previs import.
6. Plugin/extension ABI.
7. Interchange: OTIO, EDL, FCPXML where appropriate; AAF research note; subtitle formats; manifests. Interchange ≠ SoT.
8. Mastering: H.265/AV1, ProRes/DNx if lawful, image sequences, alpha, audio masters, mezzanine, archive/theatrical research → presets.
9. Credit crawls.
10. Rolling shutter / deeper motion as time allows.

### Dependencies / risk
Legal (codecs, GPL, OFX). Hardware. Never let OFX or OTIO become SoT.

### Phase 9 acceptance
- Multicam interview or film scene switchable on a multicam clip.
- OTIO out for a cut; round-trip loss documented.
- Mezzanine + web delivery from same graph.

---

## HVS PHASE 10 — Prompt-to-film

**Only after underlying tools are real.**

Pipeline (must invoke the same tools a human uses):

Prompt → production plan → research → CreativeBrief → ScriptProject → CharacterBible / WorldBible → breakdown → storyboards → ShotSpecs / CameraSpecs → generate/capture/ingest → dailies/selects → edit EditCommands → VFX EffectGraph → sound/music/ADR → color → QC → first-draft Version → human review → final master.

### Forbidden
- Single vendor “make a movie” button that dumps an MP4 onto a track.
- Bypassing breakdown, continuity, provenance, or human publish gate.

### Phase 10 acceptance
- “Create a 12-minute sci-fi short about…” produces a navigable HVS production with script, boards, shots, generated+edited material, sound, color, and a first-cut Version.
- Commander can take over at any gate in MANUAL.
- Final master still requires a human.

**This is the ability to produce an entire film inside HVS.** Phases 1–9 are not optional prologue; they are the film tools.

---

## Format-complete map (nothing omitted)

| Format | When it becomes honest inside HVS |
|---|---|
| Advertisements / social / YouTube / beauty commercial (STARRDOM) | Phase 1–2 (Phase 4 brief optional) |
| Music videos | Phase 2 + 5 (beat grid) |
| Gaming content | Phase 1 ingest + Phase 6/8 highlights (OBS remains external capture) |
| Documentaries | Phase 3 search + Phase 6 dailies + Phase 5 color/audio |
| Animated productions | Phase 2 image/video gen + Phase 4 boards + Phase 5 keyframes; 3D subprocess Phase 9 |
| Hybrid live-action + AI | Phase 2 + 5 + 6 continuity |
| Short films | Phase 4–7 |
| Feature films / episodic | Phase 6–10 |

---

## What this roadmap will not do

- Will not reduce HVS to an NLE, prompt-to-video box, ad generator, social editor, CapCut clone, client portal, or link farm.
- Will not throw away `.hvsproj`, tracks-as-truth, EditCommands, TrackSubject, VirtualCamera, ThemeSpec, render queue, or AI Director.
- Will not tell the Commander to finish in another editor.
- Will not implement all 48 groups in one pass.
- Will not start Phase 10 early.

---

## Recommended first implementation (when Commander authorizes)

**Do not start until authorized.** Suggested first build after this matrix:

**HVS PHASE 1.A — Editor blocker closure**  
Roll/slip/slide/lift/extract/blade/move UI, undo/redo, render fidelity for speed/reverse/freeze/pan/dissolve, marker UI, Source monitor if cheap.

Then **PHASE 1.B** tracking/object-follow polish, then **PHASE 2.A** Router adapters.

---

## Sources

- `docs/HVS_8_WAVES_COMPLETE_INDEX.md`
- `docs/hvs-waves/HVS_WAVE_1_NLE_FOUNDATION.md` … `HVS_WAVE_8_INVENTORY_ROADMAP.md`
- `docs/HVS_WAVE_A_NLE_CAPCUT_TRACKING.md`
- `docs/HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md`
- Code: `lib/media-command/*`, `components/war-room/higher-vision-studios/*`, `app/higher-vision-studios/*`, `app/api/media-command/*`

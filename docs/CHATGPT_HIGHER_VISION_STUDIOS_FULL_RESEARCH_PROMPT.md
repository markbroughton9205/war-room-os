# HIGHER VISION STUDIOS — MASTER MEDIA PRODUCTION RESEARCH ASSIGNMENT
# Shared prompt for The Avengers (War Room Research) + ChatGPT / Cursor paste
# Commander: Mark | Date context: September 2026
# MODE: DEEP RESEARCH ONLY — DO NOT MODIFY CODE / BUILD / PACKAGE / INSTALL / COMMIT / PUSH / DEPLOY

---

## MISSION

Research and design **Higher Vision Studios** as a **MAJOR NATIVE SECTION** inside War Room — an AI-native professional media-production environment.

This is NOT:
- a client portal
- merely an AI advertisement generator
- a collection of links to external AI websites
- a prompt-only interface
- "CapCut inside War Room"
- "Final Cut Pro inside War Room"
- a pile of AI buttons

This IS:
War Room's own coherent production system where:
- **Professional editing capability is the foundation**
- CapCut-style creative speed is a layer
- AI generation is a layer
- AI understanding is a layer
- AI Director is a layer
- Camera intelligence is a layer
- Research is a layer

War Room remains the private AI operating environment.
Higher Vision Studios becomes a major production section within War Room.

---

## PRODUCT TREE (TARGET CONCEPT)

```
WAR ROOM
│
├── Council
├── Terra
├── Foundry
├── WRIM
│
└── HIGHER VISION STUDIOS
     ├── Projects
     ├── Professional Editor
     ├── Media Library
     ├── AI Director
     ├── AI Video
     ├── AI Images
     ├── Storyboards
     ├── Scripts
     ├── Characters
     ├── Camera
     ├── Effects
     ├── Filters
     ├── Themes / Templates
     ├── Motion Graphics
     ├── Audio
     ├── Voice
     ├── Music / SFX
     ├── Color
     ├── Client Work
     └── Render / Delivery
```

Media may come from:
A. entirely AI-generated assets
B. entirely real uploaded/recorded footage
C. mixtures of real + generated
D. gameplay / screen capture
E. existing projects and media libraries

The Professional Editor should eventually offer depth comparable to major NLEs while being **AI-native**.
The AI must NOT merely tell the operator HOW to edit — it should eventually **ACTUALLY operate** the underlying edit model via structured editing commands.

Example target workflow (acceptance-class):
> "Take these STARRDOM clips and create a 30-second luxury hair-extension commercial. Follow the model during the reveal, use close-ups of the hair, remove weak sections, match the cuts to the beat, use a luxury filter, add captions, use the STARRDOM logo, create an AI beauty shot if we're missing one, then make 9:16 and 16:9 versions."

---

## RESEARCH STANDARD (MANDATORY)

DO NOT design from memory alone.
Research current products and documentation as of **September 2026**.

Prefer (in order):
1. official product documentation
2. official technical documentation
3. official release notes
4. vendor developer/API documentation
5. official GitHub repositories for open-source components
6. strong technical sources

Clearly separate for every claim:
- **VERIFIED CURRENT FEATURE**
- **PROPOSED HIGHER VISION FEATURE**
- **FUTURE / EXPERIMENTAL FEATURE**

Rules:
- Do not pretend an API exists if it does not.
- Do not assume a commercial app exposes internal capability programmatically.
- Do not call something open source merely because code is visible.
- Do not call a product locally runnable unless verified.
- Do not call a model commercially usable unless terms support it.
- Do not invent product features as of Sept 2026.

For every major **external** capability determine:
| Field | Required |
|---|---|
| what it actually does | yes |
| API? | yes |
| SDK? | yes |
| commercial use? | yes |
| local run? | yes |
| open source? | yes |
| license | yes |
| approx hardware | yes |
| integration realistic? | yes |
| build our own equivalent instead? | yes |

For every open-source repo provide:
- official repo URL
- current license
- latest activity / maintenance state
- platform support (esp. Linux)
- integration implications

---

## SYSTEMS TO RESEARCH (MINIMUM)

### PROFESSIONAL EDITORS
Apple Final Cut Pro · Adobe Premiere Pro · Adobe After Effects · DaVinci Resolve · DaVinci Fusion · DaVinci Fairlight

### CREATOR / SOCIAL EDITORS
CapCut · Descript · VEED · Canva video · other serious creator editors if relevant

### AI VIDEO / MEDIA (Sept 2026)
OpenAI video · Google Veo · Runway · Kling · Seedance / ByteDance video · Adobe Firefly Video · Luma · Pika · HeyGen · Synthesia · ElevenLabs video/audio · other leading systems verified for Sept 2026

### OPEN / LOCAL COMPONENTS
video gen · image gen · segmentation · optical flow · pose · motion tracking · object tracking · depth · face/body/hand tracking · lip sync · voice · ASR · sound gen · upscaling · frame interpolation · bg removal · rotoscoping · stabilization · denoising · color · compositing

### PRODUCTION INFRASTRUCTURE
FFmpeg · GStreamer · OpenTimelineIO · OpenColorIO · OpenFX · Blender · Natron · MLT · OSS NLE libs · GPU video libs · HW encode/decode APIs · CUDA / ROCm · Vulkan compute/video

Assess architectural fit — do NOT automatically adopt any of these.

---

## 37 RESEARCH DOMAINS (ALL REQUIRED)

### DOMAIN 1 — PROFESSIONAL TIMELINE / NLE
Source/program monitors, timeline, bins, events, libraries, clips, subclips, sequences, magnetic vs traditional tracks, connected clips, primary storyline, compound/nested, sync, multicam, adjustment layers.

Ops: insert, overwrite, append, replace, lift, extract, ripple delete, blade/split, trim, ripple trim, roll, slip, slide, extend, match frame, freeze, reverse, duplicate, move, copy/paste attributes, snapping, markers, ranges, favorites, rejection, auditions/versions.

Keyframes: transform, opacity, audio, effects, masks, speed, curves, easing, bezier.

Recommend with evidence: **A traditional tracks | B magnetic | C hybrid**.

### DOMAIN 2 — CAPCUT-STYLE CREATIVE SYSTEM (CRITICAL)
Deep CapCut research: filters, effects, transitions, themes/templates.
Higher Vision must support OUR OWN template/theme engine (ad, luxury, cinematic, TikTok, Reels, YouTube intro, gaming, documentary, beauty/salon, product-commercial, sports, music-video, wedding, real-estate, automotive).
A theme may encapsulate: typography, fonts, caption style, grade, transitions, music, animation, effects, pacing, logo placement, motion graphics, overlays, aspect presets.
**Do not depend on CapCut itself.**

### DOMAIN 3 — AI PERSON / SUBJECT FOLLOWING (REQUIRED)
Distinguish: object / person / face / body / hand / pose tracking; semantic vs instance segmentation; depth; camera tracking; optical flow; re-ID across shots.
Commands like: keep Jasmine centered; follow stylist; track hair; keep product label; blur everyone except subject; attach text to head; grade subject only; 16:9→9:16 face-centered; zoom with subject; virtual camera follow.
Commercial: FCP / Premiere / Resolve / CapCut + OSS models/libs.
Target stack concept: `TrackSubject(id) → tracking data → virtual camera → transform/keyframe → reframed output`.

### DOMAIN 4 — AI CAMERA SYSTEM (TWO MEANINGS — DO NOT MIX)
**A. Real footage / multicam:** sync by audio/timecode, angle viewer, live switch, AI speaker detection, best-angle, auto cuts, continuity, reactions.
**B. AI-generated camera:** shot sizes, angles, movements, lens language; prompt vs trajectory vs reference video vs motion brush vs camera path vs depth vs first/last frame vs 3D scene.
Higher Vision should represent camera intent **STRUCTURALLY** (CameraSpec), not only as text.

### DOMAIN 5 — AI CAMERA FOLLOWS A PERSON
Modes: center lock, rule-of-thirds, lead room, face/upper/full-body/product lock, dynamic/smooth/aggressive follow.
Stack: subject track + saliency + virtual camera + smoothing + crop limits + zoom + composition.
16:9 → 9:16 without dumb center crop. Research auto-reframe behavior.

### DOMAIN 6 — AI EDITOR / AI DIRECTOR
Design AI EDIT COMMAND LAYER — not UI button clicking for ordinary ops.
Command families: insert/remove/trim/split/move/replace clip; speed/reverse/freeze; transition/effect/filter/theme; trackSubject/setVirtualCamera/autoReframe; keyframes; captions/titles; music/voice/duck/normalize; color; mask/bg remove; generateVideo/Image; extendShot; replaceBackground; createVersion; render.
Cover: schema, edit transaction, undo/redo, version history, deterministic replay, AI explanations, preview-before-commit, non-destructive, checkpoints.

### DOMAIN 7 — AUTOMATIC VIDEO CREATION
IDEA → SCRIPT → STORYBOARD → SHOTS → ASSETS → EDIT → MUSIC → VOICE → CAPTIONS → RENDER with human control.
Modes: MANUAL | AI ASSIST | AI FIRST CUT | AI DIRECTOR | FULL DRAFT.
Draft ≠ authority to publish.

### DOMAIN 8 — AI VIDEO GENERATION
Compare providers factually (no hype ranks). Per provider fields:
Provider, Model, API?, Inputs, Outputs, Max duration, Resolution, FPS, Reference support, Character consistency, Camera control, Motion control, Editing support, Commercial terms, Privacy, Cost model, Local/cloud, Strengths, Limitations, War Room integration fit.
Cover: T2V, I2V, V2V, first/last frame, refs, persistent/multi characters, lip sync, expression/performance/pose/motion/style transfer, scene extend, inpaint/outpaint, object insert/remove, bg replace, relight, weather/time, product placement, camera control, shot continuation, B-roll.

### DOMAIN 9 — CHARACTERS / PEOPLE
Character Bible: name, appearance, approved refs, wardrobe, voice, mannerisms, relationships, age, canon, visual embeddings/refs, performance refs, usage rights.
Research: identity consistency, LoRAs/adapters where appropriate, lawful identity embeddings.

### DOMAIN 10 — BEAUTY / STARRDOM USE CASE (PROVING SCENARIO)
STARRDOM hair-extension commercial path: beauty retouch, hair detail, skin correction, face track, hair segmentation, before/after, slow-mo, model track, product closeups, AI beauty B-roll, salon enhance, logo animation, luxury titles, captions, CTA, music, VO, cinematic salon shots.
Do not destroy identity or produce obvious artifacts. Research face-aware + hair-aware tech.

### DOMAIN 11 — COLOR / LOOKS / FILTER ENGINE
Pro color: exposure, contrast, sat, WB, curves, HSL, wheels, qualifiers, masks/power windows, scopes (waveform/vectorscope/histogram), LUT, HDR, log, ACES, OCIO, shot match, auto color, skin-tone protection.
Fast creative looks on top (adjustable, non-destructive): Luxury Gold, Clean Beauty, Cinematic Teal, Warm Lifestyle, Dark Luxury, Commercial Clean, Film 35, Dream, Vintage, Street, Gaming Neon.

### DOMAIN 12 — EFFECTS / COMPOSITING / VFX
Masks, rotoscope, chroma/luma key, tracking, planar track, camera solve, stabilize, motion blur, particles, lens, glow, blur, grain, compositing, blend modes, alpha, mattes, 2D/3D titles, motion graphics, keyframes, procedural, plugins.
OpenFX + whether Higher Vision needs its own effect graph.

### DOMAIN 13 — CAPTIONS / TEXT / GRAPHICS
ASR, word-level timing, karaoke/animated captions, highlighted words, emojis, social captions, speaker labels, subs, translation, typography, lower thirds, titles, end cards, logos, CTA, motion graphics, reusable templates. CapCut ease + pro control.

### DOMAIN 14 — AUDIO
Pro: waveform, multitrack, fades, EQ, compressor, limiter, gate, de-esser, reverb, delay, pan, loudness, normalize, automation.
AI: denoise, voice isolate, dialogue enhance, dereverb, music/stem separation, silence/filler removal, music/SFX gen, voice gen/replace, dubbing, translation, lip sync.
Fairlight, Premiere, CapCut, Descript, ElevenLabs, OSS.

### DOMAIN 15 — MUSIC / BEAT EDITING
BPM, beat/downbeat/phrase, auto markers, rhythm-aware cut, montage, ducking, beat-synced effects/transitions, music replace. Command: "Cut this on the beat."

### DOMAIN 16 — SEARCH / MEDIA INTELLIGENCE
"Find clips where Jamila smiles / stylist applying extensions / close-ups / drone / customer saying X / three people / outdoor."
Visual embeddings, semantic search, transcripts, face/person grouping, objects, actions, scenes, OCR, metadata, shot boundaries, quality scoring → Media Intelligence index.

### DOMAIN 17 — AUTOMATIC QUALITY ANALYSIS
Blur, shake, clipping, under/over exposure, low-res, bad audio, silence, duplicates, jump cuts, bad composition, faces OOF, occlusion, corrupt frames, compression artifacts, audio clip/noise.
Rank candidates — **never silently delete source media**.

### DOMAIN 18 — SPEED / MOTION
Variable speed, speed ramp, optical flow, frame interp, slo-mo, fast, freeze, reverse, motion blur, stabilize, rolling-shutter. AI + OSS interp.

### DOMAIN 19 — BACKGROUND / OBJECT EDITING
Remove/replace/blur bg, cutout, remove/insert object, remove people, sky replace, product isolation, hair-quality masking, depth seg, relight. Local vs generative.

### DOMAIN 20 — IMAGE PRODUCTION
T2I, image edit, ref gen, product photo, character refs, backgrounds, thumbnails, ad graphics, posters, storyboard frames, key art. Flow directly into projects.

### DOMAIN 21 — STORYBOARD / PREVIS
Script breakdown, auto storyboard, shot plan, animatics, camera viz, blocking, refs, lens/framing plans, duration, continuity. AI vs manual.

### DOMAIN 22 — FILMS / SHOWS (LONG-TERM)
Scenes, sequences, acts, episodes, seasons, characters, locations, props, continuity, wardrobe, script revisions, takes, VFX, ADR, audio, subs, credits.
**Not required in V1** — architecture must not block it.

### DOMAIN 23 — YOUTUBE / SOCIAL
YouTube, Shorts, TikTok, Reels, Facebook, ads: hooks, dead-space removal, captions, punch zooms, memes, reactions, B-roll, silence/filler removal, reframe, platform-safe framing, thumbnails, long→clips, CTA.

### DOMAIN 24 — ROBLOX / MINECRAFT / GAMING
Screen/game capture, OBS concepts, multi audio, gameplay event/highlight detection, narration, facecam, overlays, memes, captions, zooms, SFX, episodic edit, thumbnails, shorts. Same underlying editor.

### DOMAIN 25 — PLUGIN / EXTENSION SYSTEM
Effects, transitions, generators, AI providers, codecs, exporters, analyzers.
OpenFX, Adobe concepts, FCP effects, Resolve plugins, FFmpeg filters, WASM, sandboxed plugins.
**Do not copy proprietary formats.** Design our own extension boundary.

### DOMAIN 26 — RENDER ENGINE
FFmpeg, GPU encode (NVENC/AMD/Intel/Apple concepts), H.264/H.265/AV1/ProRes/DNx, image sequences, alpha, proxies, optimized media, caching, background render.
Need: preview, proxies, render cache, final, batch, platform variants, queue, resumability.

### DOMAIN 27 — PROJECT FORMAT (CRITICAL)
Research OTIO, FCPXML concepts, EDL, AAF, XML, Premiere/Resolve concepts.
Design **INTERNAL Higher Vision project format**: deterministic, versionable, inspectable, migration-capable, AI-readable, UI-editable, non-destructive, provenance-aware, undo/history; eventual lawful import/export where feasible.

### DOMAIN 28 — AI + HUMAN CONTROL MODEL
Modes: MANUAL EDIT | AI ASSIST | AI SUGGEST | AI FIRST CUT | AI DIRECTOR | AUTOMATIC DRAFT.
Every meaningful AI edit action: visible, undoable, versioned, attributable, inspectable.
AI FIRST CUT creates v2 leaving v1 untouched.

### DOMAIN 29 — HARDWARE (NEBULA GENESIS LINUX)
CPU/RAM/VRAM/GPU/NVMe/external/NAS for: originals, proxies, cache, thumbs, embeddings, models, render cache, generated media, masters.
**Linux carefully — no Apple-only assumptions.**

### DOMAIN 30 — LOCAL VS CLOUD
Classify every major capability: LOCAL | CLOUD | HYBRID.
War Room owns orchestration + project state. Providers may supply generation. Replaceable. Sovereign-now vs frontier-cloud.

### DOMAIN 31 — PROVIDER ROUTER
Categories: VIDEO_GENERATOR, IMAGE_GENERATOR, IMAGE_EDITOR, VOICE, TTS, MUSIC, SFX, LIP_SYNC, UPSCALE, INTERPOLATION, TRANSCRIPTION, TRANSLATION, MOTION_TRANSFER.
Selection: capability, quality, latency, cost, rights, privacy, res, duration, character consistency, camera control, refs, local/cloud, availability.
**Never hardwire one vendor.**

### DOMAIN 32 — RIGHTS / PROVENANCE
Track: source/client/generated asset, provider, model, prompt, refs, params, parent, license, commercial-use, consent/release, date, project/timeline usage.

### DOMAIN 33 — WAR ROOM INTEGRATION
Clear boundaries with Council, Terra, Foundry, WRIM, Research Engine, Memory.
Do not merge all systems into one module.

### DOMAIN 34 — UI
Left: Media/Projects/Assets/Effects/Filters/Themes
Center: Viewer/Canvas
Right: Inspector
Bottom: Timeline
AI Panel: AI Director/Assistant
Top tabs candidate: CREATE | EDIT | GENERATE | AUDIO | COLOR | EFFECTS | DELIVER
Cinematic + professional + War Room identity.

### DOMAIN 35 — FEATURE INVENTORY MATRIX
Columns: FEATURE | FCP | PREMIERE | AE | RESOLVE | CAPCUT | DESCRIPT/OTHER | CURRENT AI TOOLS | OSS OPTION | HVS TARGET | BUILD/INTEGRATE/LATER
Capability coverage only — **do not copy proprietary UI**.

### DOMAIN 36 — BUILD VS INTEGRATE
Per subsystem: BUILD OURSELVES | OSS INTEGRATION | COMMERCIAL API | HYBRID | RESEARCH ONLY + reasoning.
(timeline, render, tracking, segmentation, captions, video/image gen, voice, effects, color, project format, …)

### DOMAIN 37 — V1 / V2 / V3 / V4
Master architecture anticipates everything; ship in slices.
- **V1** — functional AI production studio (must complete a real project)
- **V2** — advanced professional post
- **V3** — film/show/gaming scale
- **V4** — increasingly sovereign media intelligence

**V1 ACCEPTANCE (STARRDOM):**
Create a complete STARRDOM advertisement inside Higher Vision Studios end-to-end:
research → concept → script → shot plan → media analysis → subject tracking → selection → AI-generated missing shots → professional timeline edit → filter/look → transitions → music → voice → captions → graphics → color → multiple aspect ratios → final render
**WITHOUT** exporting to CapCut / Final Cut / Premiere / DaVinci to finish basic production.

---

## CRITICAL QUESTIONS (ANSWER EXPLICITLY)

1. Can we realistically build our own professional NLE inside War Room?
2. What parts build ourselves vs FFmpeg/OTIO/etc.?
3. How should the underlying timeline engine work?
4. Can Linux support the intended architecture?
5. How do we get professional preview performance?
6. How should proxy/caching work?
7. How should AI manipulate the timeline?
8. How do we implement subject/person following?
9. How do we implement AI camera tracking?
10. How do we implement CapCut-like themes?
11. How do we implement CapCut-like filters/effects?
12. How should camera-angle intelligence work?
13. How do generated camera angles differ from multicam angles?
14. Which current video-generation providers offer useful camera control?
15. What open-source trackers/segmenters are viable?
16. What should remain provider-based instead of local?
17. What local models could Nebula realistically run?
18. What architecture prevents provider lock-in?
19. What project format should Higher Vision use?
20. Should OpenTimelineIO be part of the architecture?
21. What should the internal edit command API look like?
22. How should undo/version/history work?
23. How should AI-generated assets flow directly into the timeline?
24. How do we avoid copying proprietary software while matching capability?
25. What is the smallest V1 that still deserves the name "AI media production studio"?

---

## AVENGERS ROLE SPLIT (PARALLEL WAVES)

| Agent | Primary lanes |
|---|---|
| **Avenger Evidence** | Official docs, API/SDK existence, licenses, commercial terms, repo URLs, release notes (Domains 2–5, 8, 14–15, 25–26, Sources) |
| **Avenger Historian** | Product lineage FCP/Premiere/AE/Resolve/CapCut/Descript; OTIO/AAF/EDL/FCPXML history; prior War Room Media densify locks that still apply (no autoplay; VERIFIED+streamUrl; duck Extreme/Severe; scanners LINK-OUT/REFUSE Terra rebroadcast where previously locked) |
| **Avenger Science** | Tracking/segmentation/optical flow/pose/depth; beat detection; embeddings; frame interp; color science/OCIO/ACES; CameraSpec math; Media Intelligence models |
| **Avenger Blind Spot** | License traps, API gaps, Linux blockers, provider lock-in, beauty-identity destruction, silent delete risks, fake "local" claims, CapCut dependency, Google-on-Cesium-style hardwires, overclaim vs Sept 2026 reality |
| **Avenger Engineer** | Build vs integrate matrix; timeline/project format/edit-command schema; proxy/render/cache; Nebula Linux hardware map; Provider Router; V1 first build slice; Cursor-ready implementation requirements (research only — no code) |

**Coordination:**
1. Evidence + Science open Domains 1–8, 11–19, 26–27 in parallel.
2. Historian maps competitive feature landscape + interchange formats.
3. Blind Spot challenges every VERIFIED claim that smells like marketing.
4. Engineer synthesizes MASTER ARCHITECTURE + EXACT FIRST BUILD SLICE after waves land.
5. PA2 folds into one report for Commander Mark.

---

## REQUIRED OUTPUT DOCUMENT

Title:

# HIGHER VISION STUDIOS
# MASTER MEDIA PRODUCTION RESEARCH REPORT

Sections (exact):

1. EXECUTIVE FINDINGS
2. VERIFIED STATE OF MODERN MEDIA EDITING — 2026
3. FINAL CUT / PREMIERE / RESOLVE FEATURE ANALYSIS
4. CAPCUT CREATIVE FEATURE ANALYSIS
5. MODERN AI VIDEO LANDSCAPE
6. SUBJECT / PERSON / CAMERA TRACKING RESEARCH
7. AI CAMERA / CAMERA-ANGLE RESEARCH
8. THEMES / FILTERS / EFFECTS RESEARCH
9. PROFESSIONAL NLE ARCHITECTURE
10. MEDIA INTELLIGENCE ARCHITECTURE
11. AI DIRECTOR / EDIT-COMMAND ARCHITECTURE
12. GENERATIVE MEDIA ARCHITECTURE
13. AUDIO / VOICE / MUSIC ARCHITECTURE
14. COLOR / VFX / COMPOSITING ARCHITECTURE
15. PROJECT FORMAT + TIMELINE MODEL
16. RENDER / CACHE / PROXY ARCHITECTURE
17. LOCAL / CLOUD / HYBRID ANALYSIS
18. LINUX + NEBULA FEASIBILITY
19. BUILD VS OPEN-SOURCE VS API MATRIX
20. COMPLETE FEATURE INVENTORY
21. PROPOSED HIGHER VISION STUDIOS UI
22. V1 / V2 / V3 / V4 ROADMAP
23. STARRDOM END-TO-END ACCEPTANCE SCENARIO
24. RISKS / LICENSING / PERFORMANCE ISSUES
25. RECOMMENDED MASTER ARCHITECTURE
26. EXACT FIRST BUILD SLICE
27. SOURCES

Also answer all **25 CRITICAL QUESTIONS** explicitly (can live under Executive Findings or appendix).

---

## SOURCE REQUIREMENTS

Cite claims. Prefer direct official sources.
Flag uncertain/unverified.
Separate VERIFIED FACT | VENDOR CLAIM | INFERENCE | RECOMMENDATION.

---

## FINAL PRINCIPLE

We are designing **Higher Vision Studios** — War Room's own AI-native professional media-production environment.

Professional editing = foundation.
CapCut-style creative speed = layer.
AI generation = layer.
AI understanding = layer.
AI Director = layer.
Camera intelligence = layer.
Research = layer.

Bring them together into **ONE coherent production system**.

---

## STOP CONDITIONS

RESEARCH ONLY.
DO NOT MODIFY THE REPOSITORY.
DO NOT BUILD.
DO NOT PACKAGE / INSTALL / COMMIT / PUSH / DEPLOY.

When complete: write report to `/home/box/higher-vision-studios/HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md` and notify Commander Mark via PA2.

END PROMPT.

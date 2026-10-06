# HIGHER VISION STUDIOS
# MASTER MEDIA PRODUCTION RESEARCH REPORT
# Commander Mark | Sunday Sep 20, 2026 · ~2:40 PM EDT (America/New_York)
# Mode: RESEARCH ONLY — VERIFIED / PROPOSED / FUTURE · Builds HOLD
# Fold: WAVE_1.md … WAVE_8.md + Legal/Blind Spot locks + misfiled Understanding/Distribution

> **STATUS:** Complete 27-section structure after Wave 8 fold.  
> Wave stamps: `waves/WAVE_1.md` … `waves/WAVE_8.md` · Map/locks: `HVS_8_WAVES.md` · Assignment: `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`  
> Stamps: **WAVE_7 DONE | READY FOR WAVE 8** · **WAVE_8 DONE | MASTER REPORT READY**  
> Research ≠ shipped. Do not modify repository / build / commit / deploy from this packet.

Label legend:
- **VERIFIED** — grounded in official docs/repos cited in §27
- **PROPOSED** — HVS design recommendation (not an existing product API)
- **FUTURE** — deferred / experimental / not required for V1
Claim tags: VERIFIED FACT | VENDOR CLAIM | INFERENCE | RECOMMENDATION

---

## 1. EXECUTIVE FINDINGS

1. **HVS is a War Room–native production kernel**, not CapCut-in-WR, not FCP-in-WR, not a pile of AI website links. (**PROPOSED**)
2. **Linux + Nebula CUDA can host the architecture.** FFmpeg+NVENC, GES/MLT, OTIO, OCIO, OpenFX are Linux-capable. (**VERIFIED** components; Nebula SKU unmeasured.)
3. **Own `.hvsproj` + EditCommandLayer**; OTIO = interchange only; CapCut/Premiere/Resolve/FCP projects ≠ SoR. (**RECOMMENDATION** / OTIO purpose **VERIFIED**)
4. **Timeline = hybrid C:** traditional tracks as authoring SoR; magnetic behaviors as EditOps/UX. (**RECOMMENDATION** Wave 1)
5. **ThemeSpec is HVS-owned** — CapCut = prior-art UX speed only; scrape/SDK/SoR **REFUSE**. (**PROPOSED** / Legal lock)
6. **Camera A ≠ B ≠ C:** multicam real · generative CameraSpec · virtual TrackSubject follow — never one slider. (**PROPOSED** Wave 3)
7. **AI acts via structured EditCommands** (preview|commit), never tips-only. Draft ≠ publish. (**PROPOSED** Wave 4)
8. **Gen = Media Provider Router, cloud-first V1;** Sora / OpenAI Videos API = **DEAD** post ~2026-09-24 — exclude. (**VERIFIED** sunset / **PROPOSED** Router)
9. **Beauty / STARRDOM:** real talent authoritative; beauty morph off-by-default; disclose AI plates; prefer track+grade over identity destroy. (**PROPOSED** / Blind Spot)
10. **V1 slim ≠ STARRDOM acceptance:** slim = ingest→cut→captions→export; finished V1 = STARRDOM path inside HVS without CapCut/FCP/Premiere/Resolve finish. (**RECONCILIATION** Wave 8)
11. **Exact first build slice:** `HVS-V1-SLICE-0 — Kernel + STARRDOM Path` (§26). (**RECOMMENDATION**)
12. **Hard WR boundaries:** Council/Terra/Foundry/WRIM/Research/Memory stay separate — typed handoffs only. (**PROPOSED** / doctrine)

**25 CRITICAL QUESTIONS:** answered explicitly in Appendix A (and Wave 8 §9).

---

## 2. VERIFIED STATE OF MODERN MEDIA EDITING — 2026

| Layer | Pattern | HVS implication |
|---|---|---|
| Timeline | Tracks/layers + clips + transitions (GES, MLT, OTIO; FCP magnetic UX) | Build HVS TimelineEngine; hybrid UX later |
| Interchange | OTIO, EDL, FCPXML concepts | OTIO adapter; `.hvsproj` canonical |
| Color | OCIO / ACES in pro tools | OCIO **INTEGRATE V2**; V1 thin looks |
| Encode | NVENC/AMF/QSV/Vulkan via FFmpeg | FFmpeg media plane; NVENC on Nebula |
| Effects | OpenFX hosts (Resolve-class); proprietary Adobe/FCP packs | Own EffectGraph V1; OpenFX host V2 |
| Creator speed | CapCut themes/filters/captions UX | Own ThemeSpec — no CapCut runtime |
| AI edit agents | Descript-class agent jobs inside *their* model | Prior-art pattern only — not HVS SoR |
| AI gen | Cloud T2V/I2V APIs dominate; Sora API sunset | Router; multi-vendor; no Sora dependency |

---

## 3. FINAL CUT / PREMIERE / RESOLVE FEATURE ANALYSIS

Capability classes only — **do not copy proprietary UI**.

| Class | FCP | Premiere | Resolve | HVS take |
|---|---|---|---|---|
| Timeline model | Magnetic primary storyline + connected clips (**VERIFIED** Apple docs) | Traditional tracks + ripple/roll/slip/slide | Traditional tracks + Fairlight/Fusion pages | **Tracks SoR**; magnetic = optional UX (Wave 1) |
| Edit ops depth | Append/insert/overwrite/ripple/roll/slip/slide/compound/multicam | Full track edit + adjustment layers | Cut page + Edit page depth | V1: insert/overwrite/split/trim/ripple-delete; full suite V2 |
| Color | Color board / wheels | Lumetri | World-class Color page + ACES | Thin looks V1; OCIO V2 |
| Audio | Roles | Essential Sound | Fairlight | Multitrack+duck V1; Fairlight-class V2 |
| Reframe | Smart Conform | Auto Reframe | Smart Reframe Studio | **UX benchmarks only** — no War Room-callable APIs (**Blind Spot**) |
| Interchange | FCPXML | XML/AAF concepts | XML/AAF/OTIO tools | OTIO primary; others later |
| Platform | **macOS only** | Win/mac | Win/mac/Linux Studio | **Linux-first** for Nebula |

**API reality (VERIFIED pattern):** No public remote write API that makes FCP/Premiere/Resolve the War Room SoR. Host scripting ≠ HVS project store. (**REFUSE invented NLE APIs**)

---

## 4. CAPCUT CREATIVE FEATURE ANALYSIS

**VERIFIED CURRENT (product UX, CapCut Help / marketing — not a developer theme API):** templates/themes, filters, effects, transitions, auto captions, auto reframe, beat-ish cut UX, social aspect presets.

**Critical locks:**
- CapCut ≠ system of record · ≠ runtime dependency · scrape / RE / asset theft **REFUSE**
- Live CapCut OpenAPI fetch 2026-09-20 returned unavailable — do not claim a verified full NLE/gen API (**Wave 2**)

**HVS response (PROPOSED Domain 2):** Own **ThemeSpec** packs (ad, luxury, cinematic, TikTok/Reels, beauty/salon, gaming neon, …) encapsulating typography, caption style, grade, transitions, music bed refs, logo slots, overlays, aspect presets — applied as non-destructive EditOps on the hybrid timeline.

---

## 5. MODERN AI VIDEO LANDSCAPE (Sep 2026)

| Provider / class | API? | Notes | HVS fit |
|---|---|---|---|
| Google Veo | Yes (Gemini/Veo docs) | T2V/I2V; prompt + first/last/refs | Router `VIDEO_GENERATOR` |
| Kling | Yes (Open Platform) | Motion Control notable | Router; strong motion |
| Luma Ray | Yes (Agents docs) | Keyframes; `video_reframe` | Structured camera control leader |
| Runway | Yes (Dev API) | Gen + editing tools | Router; **no invented camera JSON** |
| Adobe Firefly Video | Yes (Firefly Services) | Commercial terms via Adobe | Router optional |
| Pika | Public API cited Wave 5 | Verify ToS at integrate | Router optional |
| Seedance / ByteDance-class | Via aggregators/ModelArk | Caps vary — re-verify | Router optional |
| HeyGen / Synthesia | Yes | Avatar/talking-head | Optional; not STARRDOM hero |
| ElevenLabs | Yes | TTS / SFX / music APIs | Router `TTS`/`MUSIC`/`SFX` |
| **OpenAI Sora / Videos API** | **DEAD / UNAVAILABLE** | Shutdown ~2026-09-24; no verified replacement | **EXCLUDE from defaults** |

**Character consistency / beauty:** Prefer consented refs + Character Bible; refuse non-consensual deepfake/replica; beauty morph **off-by-default**.

---

## 6. SUBJECT / PERSON / CAMERA TRACKING RESEARCH

**Taxonomy (do not conflate):** object / person / face / body / hand / pose · semantic vs instance seg · depth · optical flow · re-ID · camera track.

**Target stack (PROPOSED):**  
`TrackSubject(id) → TrackData → VirtualCamera → Transform keyframes → reframed output`

**OSS viable (VERIFIED licenses):** SAM2 (Apache-2.0) · ByteTrack/BoT-SORT (MIT) · MediaPipe · OpenCV flow. **Caution:** Ultralytics AGPL without Enterprise.

**Commercial NLE auto-reframe** = UX benchmarks only — no War Room-callable Smart Conform / Auto Reframe / CapCut Auto Reframe APIs.

---

## 7. AI CAMERA / CAMERA-ANGLE RESEARCH

| Meaning | What it is | HVS representation |
|---|---|---|
| **A Multicam** | Sync real angles; switch on speaker/best take | Multicam Intelligence UI + EditOps |
| **B Generative** | Synthesized viewpoint from prompt/keyframes/motion | **CameraSpec** → Router adapters |
| **C Virtual follow** | Crop/zoom window on one real clip | TrackSubject + VirtualCamera |

**Never present gen as alternate physical takes without disclosure.**  
Structured camera control leaders (evidence-ranked): Luma keyframes/reframe → Kling Motion Control → Veo/Seedance/Runway prompt+refs → Firefly short → **Sora excluded**.

---

## 8. THEMES / FILTERS / EFFECTS RESEARCH

| Layer | V1 | V2+ |
|---|---|---|
| ThemeSpec packs | `luxury_beauty_v1` stub + few owned packs | Full catalog |
| Looks / filters | Non-destructive parameterized looks (Luxury Gold, Clean Beauty, …) | OCIO Looks / ACES |
| Effects / transitions | Thin EffectGraph | OpenFX plugin leaves |
| Motion graphics | Logo/CTA/title slots in themes | Blender/Natron subprocess later |

Match CapCut *speed* and capability class — **do not** clone packs or proprietary plugin binaries.

---

## 9. PROFESSIONAL NLE ARCHITECTURE (PROPOSED)

```
WAR ROOM UI — HVS section
  → EditCommands (preview|commit) + PreviewTickets
HVS KERNEL
  • ProjectStore (.hvsproj + asset index + AssetProvenance)
  • EditCommandLayer (tx, undo, Version nodes, attribution)
  • TimelineEngine (traditional tracks SoR; magnetic = EditOps/UX)
  • ThemeSpec / Look engine (non-destructive)
  • TrackSubject + VirtualCamera + CameraSpec adapters
  • MediaIntelligence (V1 thin)
  • MediaProviderRouter (category → adapter → AssetRef)
MEDIA PLANE          CACHE                 PROVIDERS
  FFmpeg I/O+NVENC     proxies/thumbs        VIDEO/IMAGE/VOICE/…
  (compose spike:      render cache          never hardwired in SoT
   custom|MLT|GES)     preview tickets
INTERCHANGE: OTIO (± FCPXML/EDL later, lossy) — NOT SoT
V2+: OCIO, OpenFX host · LATER: Blender/Natron subprocess
```

---

## 10. MEDIA INTELLIGENCE ARCHITECTURE

Folded from assignment Domains 16–17 + misfiled Understanding draft.

**V1 thin (PROPOSED):** FFmpeg probe · thumbs · shot boundaries · basic quality flags · optional ASR transcript · operator tags.  
**V2:** CLIP/OpenCLIP embeddings · person clusters · object/action/scene tags · semantic search (“Jamila smiles”).  
**V4:** Deeper sovereign index as Nebula capacity measured.

**Quality analysis (Domain 17):** Rank/flag blur, shake, exposure, audio clip/silence, duplicates, corrupt frames — **never silently delete source media**. AI may exclude ranges in a *new Version* only.

**Blind Spot:** Do not claim “find smiling Jamila” until clustering+expression verified on measured VRAM. Do not invent Sensei/CapCut search APIs.

---

## 11. AI DIRECTOR / EDIT-COMMAND ARCHITECTURE

**Principles (PROPOSED):** AI never primary-path “clicks UI”; emits structured commands; every meaningful action previewable, undoable, attributable, versioned; Draft ≠ publish.

**Schema sketch (`hvs.edit.v1` — PROPOSED, not a vendor API):**
```json
{
  "schemaVersion": "hvs.edit.v1",
  "transactionId": "uuid",
  "projectId": "uuid",
  "actor": { "type": "human|ai_director|ai_assist", "id": "string" },
  "mode": "preview|commit",
  "ops": [
    { "op": "insertClip", "trackId": "V1", "at": {"rate": 30, "value": 0}, "assetId": "uuid", "sourceRange": {"start": 0, "duration": 90} },
    { "op": "trimClip", "clipId": "uuid", "edge": "out", "deltaFrames": -15 },
    { "op": "trackSubject", "clipId": "uuid", "subjectId": "jamila", "mode": "face_center" },
    { "op": "setVirtualCamera", "clipId": "uuid", "aspect": "9:16", "follow": "smooth" },
    { "op": "applyTheme", "themeId": "luxury_beauty_v1", "scope": "sequence" },
    { "op": "render", "preset": "delivery_h264_1080p", "aspects": ["16:9", "9:16"] }
  ],
  "explain": "optional NL rationale — NOT a substitute for ops"
}
```

**Modes (Domain 28):** MANUAL EDIT → AI ASSIST → AI SUGGEST → AI FIRST CUT → AI DIRECTOR → AUTOMATIC DRAFT.  
**Pipeline (Domain 7):** IDEA → SCRIPT → STORYBOARD → SHOTS → ASSETS → EDIT → MUSIC → VOICE → CAPTIONS → RENDER with human gates.

---

## 12. GENERATIVE MEDIA ARCHITECTURE

Router returns `AssetRef` + `AssetProvenance` → Media Library ingest → EditCommand `insertClip`/`replaceClip`. No orphan blobs; download immediately (provider retention TTLs). Character Bible + consented refs for identity. STARRDOM missing beauty B-roll = Router gen with disclosure; real salon footage remains authoritative.

---

## 13. AUDIO / VOICE / MUSIC ARCHITECTURE

| Tier | Scope |
|---|---|
| **V1** | Multitrack · fades · duck · import licensed music/VO · optional Router TTS/music · beat *markers* |
| **V2** | Fairlight-class EQ/comp/limiter/de-esser · stem tools · stronger dialogue enhance |
| **FUTURE** | Full auto beat-sync montage (“cut on the beat” Director op) |

ElevenLabs etc. = optional Router adapters with commercial-tier checks. Descript Studio Sound = UX prior art inside Descript, not HVS SoR.

---

## 14. COLOR / VFX / COMPOSITING ARCHITECTURE

| Component | License | HVS use |
|---|---|---|
| HVS EffectGraph / looks | Owned | **BUILD V1** |
| OpenColorIO | BSD-3 (ASWF) | **INTEGRATE V2** ACES/looks |
| OpenFX | BSD-3 (ASWF) | **INTEGRATE V2** host boundary |
| Natron | GPLv2 | Subprocess / research only — do not link core |
| Blender | GPL binary; Cycles Apache-2.0 | Headless subprocess later |

Beauty morph ≠ grade/skinToneProtect. Beauty packs opt-in + `consent_id`.

---

## 15. PROJECT FORMAT + TIMELINE MODEL

**SoT (PROPOSED):** `.hvsproj` — inspectable JSON V1 (± SQLite asset index later); deterministic, versionable, migratable, AI-readable, UI-editable, non-destructive, provenance-aware; optional ignored `show/episode/scene` keys (Domain 22 non-blocking).

**OTIO (VERIFIED + RECOMMENDATION):** Editorial cut interchange (Apache-2.0 ASWF); external media refs; **not** media container; **not** sole project DB. Round-trip may drop ThemeSpec / EditCommand history / full provenance — document lossiness.

**Timeline (RECOMMENDATION):** Traditional tracks as authoring truth; rational frame timebase; magnetic ripple/gap as ops/UX.

---

## 16. RENDER / CACHE / PROXY ARCHITECTURE

**Owned detail:** WAVE_6 Domain 26 (Wave 7 points only).

| Tier | Form |
|---|---|
| Originals | Immutable NVMe/NAS |
| Proxies | 720p/1080p H.264/HEVC via NVENC (else software) |
| Thumbs / scrub | JPEG/WebP strip |
| Render cache | Segments keyed by content hash + graph hash |
| PreviewTickets | Short proxy renders of AI transaction diffs |
| Delivery | NVENC H.264/H.265 (+ software fallback); ProRes/DNx later if licensing OK |

**License posture (VERIFIED ffmpeg.org/legal):** Prefer LGPL build; no redistributable `--enable-nonfree`; GPL configure only with counsel; dynamic link + source offer.

---

## 17. LOCAL / CLOUD / HYBRID ANALYSIS

| Capability | Class |
|---|---|
| Timeline, `.hvsproj`, undo/version | **LOCAL** |
| Proxy/preview/final encode | **LOCAL** (Nebula) |
| Themes / looks / caption style | **LOCAL** |
| Subject track / basic reframe | **LOCAL** (hybrid CV optional) |
| ASR / captions | **HYBRID** |
| TTS / music / SFX gen | **HYBRID / CLOUD-first** |
| T2V / I2V / beauty B-roll | **CLOUD-first** |
| Upscale / interp | **HYBRID** |
| OpenFX host | **LOCAL V2** |
| Research for ad concept | **Research Engine** (not merged into HVS) |

War Room owns orchestration + project state. Providers supply generation. Adapters replaceable.

---

## 18. LINUX + NEBULA FEASIBILITY

**VERIFIED:** Primary OSS stack targets Linux; NVIDIA documents FFmpeg GPU accel on Linux (Video Codec SDK 13.1).  
**INFERENCE:** Nebula Genesis = default CUDA worker; exact GPU/VRAM/NVMe **unmeasured** — inventory before locking local model set.  
**Avoid:** Apple-only encode assumptions; CapCut dependency; AMF-only path; offline Windows Nebula as sole GPU; linking GPL DCC into proprietary core.

**Local models realistic (INFERENCE):** Whisper-class ASR, SAM2-class seg, CLIP/OpenCLIP, MediaPipe, small image tools — **not** frontier T2V parity.

---

## 19. BUILD VS OPEN-SOURCE VS API MATRIX

| Subsystem | Decision | Reasoning |
|---|---|---|
| Timeline / `.hvsproj` / EditCommandLayer | **BUILD** | No WR-callable FCP/Premiere/Resolve/CapCut write API |
| Compose/preview graph | **HYBRID — spike** | Default lean custom+FFmpeg; evaluate MLT *or* GES once |
| Decode/encode/proxy/render | **OSS INTEGRATE** | FFmpeg + NVENC; LGPL-prefer |
| OTIO | **OSS INTEGRATE** | Interchange only |
| Themes / filters V1 | **BUILD** | Own ThemeSpec |
| Subject track / reframe | **BUILD + OSS models** | SAM2 + ByteTrack + MediaPipe |
| Captions / ASR | **HYBRID** | Whisper and/or cloud |
| Video / image gen | **COMMERCIAL API** | Router; exclude Sora |
| Voice / music / SFX | **HYBRID / CLOUD-first** | Router + licensed import |
| Color OCIO/ACES | **INTEGRATE V2** | |
| OpenFX host | **INTEGRATE V2** | BSD-3; refuse Adobe/FCP plugin SoT |
| Blender / Natron | **SUBPROCESS LATER** | GPL isolation |
| Media Intelligence deep | **BUILD V2+** | |
| Film/show / gaming highlights | **RESEARCH → V3** | Non-blocking metadata keys in v0 |

---

## 20. COMPLETE FEATURE INVENTORY

Condensed Domain 35 matrix (capability classes — no proprietary UI copy). Full table: `waves/WAVE_8.md` §2.

| FEATURE | HVS TARGET | BUILD / INTEGRATE / LATER |
|---|---|---|
| Track timeline + cut ops | V1 hybrid tracks SoR | **BUILD** |
| Source/Program monitors | V1 | **BUILD** |
| Magnetic UX assist | V2 optional Story mode | **BUILD** UX |
| Multicam sync/switch | V2 | **BUILD** |
| Auto-reframe 16:9→9:16 | V1 basic face-center | **BUILD** local |
| Themes / templates | V1 ThemeSpec stub | **BUILD** |
| Filters / looks | V1 thin; OCIO V2 | **BUILD** / **LATER** |
| Effects / OpenFX | V2 OFX host | **INTEGRATE V2** |
| Captions / ASR | V1 | **HYBRID** |
| Beat markers / auto-cut | Markers V1; AutoCut FUTURE | **BUILD** |
| Pro audio | Duck+import V1; Fairlight-class V2 | **BUILD** + **ROUTER** |
| Subject / hair track | Person V1; hair V2 | **BUILD**+OSS |
| Generative T2V/I2V | V1 Router | **COMMERCIAL API** |
| Proxy / HW encode | V1 | **INTEGRATE** |
| Project SoR `.hvsproj` | V1 | **BUILD** |
| OTIO interchange | V1 thin adapter | **INTEGRATE** |
| Media Intelligence | Thin V1; semantic V2 | **BUILD**+OSS |
| Quality analysis | Flag/rank V1 | **BUILD** |
| Film/show episodic | Schema keys V1; UI V3 | **LATER** |
| Gaming/OBS ingest | Files V1; highlights V3 | External OBS |
| Provider Router | V1 skeleton | **BUILD** |
| Provenance / C2PA | AssetProvenance V1; C2PA export V2+ | **BUILD** / evaluate |

---

## 21. PROPOSED HIGHER VISION STUDIOS UI

Detail stamp: **WAVE_7 Domain 34**.

**Layout:** Left media/projects/assets/effects/filters/themes · Center Source|Program viewer · Right inspector · Bottom tracks timeline · AI Director panel · Top tabs CREATE | EDIT | GENERATE | AUDIO | COLOR | EFFECTS | DELIVER.

**Tab recommendation:** Keep all seven in V1 chrome with **thin** CREATE/AUDIO/COLOR bodies; **never** drop DELIVER or GENERATE. If forced slim: EDIT+GENERATE+DELIVER + left-rail Themes/Effects.

**Identity:** Cinematic + professional + War Room — not CapCut pastel, not Adobe/FCP clone. Mandatory A/B/C camera splits + Tips≠Ops + Draft≠Publish.

---

## 22. V1 / V2 / V3 / V4 ROADMAP

| Version | Ships | Waits |
|---|---|---|
| **V1** | `.hvsproj` + EditCommandLayer + track timeline (core ops) + FFmpeg proxy/NVENC render + ThemeSpec stub + captions + Router (≥1 image + ≥1 video) + basic TrackSubject/9:16 + AssetProvenance + STARRDOM path **inside HVS** | Full trim suite, multicam AI, OpenFX, OCIO finishing, Fairlight-class, semantic search, local T2V, film UI |
| **V2** | OCIO/ACES, OpenFX host, richer tracking/hair, advanced audio, Media Intelligence (CLIP+clusters), C2PA evaluate, optional Story magnetic UX | Sovereign frontier gen |
| **V3** | Episode/season containers, Blender/Natron subprocess, OBS watch-folder, gaming highlight heuristics, long-form continuity | Full MAM replacement |
| **V4** | More local gen/analysis as Nebula measured; WRIM-as-Router-backend **only if** production WRIM exists | Never pretend WRIM early |

**Slim vs STARRDOM:** Slim gate = ingest→cut→captions→export. Product-vision V1 = STARRDOM acceptance (§23). Ship SLICE-0 first, then close STARRDOM gaps before calling V1 done.

---

## 23. STARRDOM END-TO-END ACCEPTANCE SCENARIO

**Bar:** 30s luxury STARRDOM hair-extension commercial (real salon + optional AI plates) → 16:9 + 9:16 **without** finishing in CapCut/FCP/Premiere/Resolve.

| Step | Mechanism | Gate |
|---|---|---|
| Research/brief | Research Engine typed handoff | Brand/rights |
| Script / shot plan | CREATE objects + CameraSpec | Human approve |
| Ingest | Media Library; client agreement first | Rights |
| Analyze | Thin MI + quality flags; never silent delete | QA |
| Track / select | TrackSubject; Version excludes weak ranges | Override |
| Missing B-roll | Router gen; not Sora; disclose AI | Asset QA |
| Edit / theme | EditCommands + `luxury_beauty_v1` | Brand |
| Music/VO/captions | Audio tracks + Router TTS + caption track | Legal/brand |
| Thin color + multi-aspect | Look stack + local reframe | Skin-tone / both QC |
| Render / Publish | FFmpeg/NVENC; explicit Publish | Commander/client |

### Social / YouTube (Domain 23 — brief)
Own **delivery presets** matching official YouTube encoding Help (MP4/H.264/AAC; 16:9 + 9:16). Hooks, dead-space removal, punch zooms, long→clips = V2 Theme/Director ops. Multi-publish APIs = later. Re-verify Shorts duration rules at ship.

### Gaming (Domain 24 — brief)
OBS/game capture = **external** ingest into the same Professional Editor. Facecam/overlays/memes via Themes. Highlight AI = V3 research — no invented Roblox/Minecraft telemetry APIs. No separate gaming NLE.

### Film/show (Domain 22 — brief)
Not V1. `.hvsproj` may carry ignored `show/episode/scene` keys so architecture does not block V3.

---

## 24. RISKS / LICENSING / PERFORMANCE ISSUES

| Risk | Mitigation |
|---|---|
| FFmpeg GPL/`--enable-nonfree` + patents | LGPL-prefer; counsel; dynamic link |
| GPL contamination (Blender/Natron) | Subprocess only |
| Ultralytics AGPL in tracker stack | Prefer MIT ByteTrack/BoT-SORT |
| Invented NLE/cloud write APIs | Refuse |
| CapCut/Adobe scrape or SoR | ThemeSpec owned; CapCut prior art only |
| Sora dependency post-sunset | Router exclude |
| Single-provider lock-in | Media Provider Router |
| Beauty identity / FTC disclosure | Real footage authoritative; consent; disclose |
| Silent media delete | Rank/flag only; versions exclude ranges |
| Overclaim local T2V / Nebula VRAM | Measure `nvidia-smi`; cloud-first gen V1 |
| AMF Linux gaps | NVIDIA NVENC primary |
| OTIO field loss | Document; SoT = `.hvsproj` |
| Kitchen-sink V1 | SLICE-0 then STARRDOM closeout |
| Windows Nebula offline | Linux CUDA first-class |
| Provider retention TTLs | Download into Media Library immediately |

Legal locks carried: paid commercial tiers for client work; client agreement before ingest; OTIO Apache-2.0; FFmpeg LGPL preferred; provenance per asset.

---

## 25. RECOMMENDED MASTER ARCHITECTURE

**One sentence:** Higher Vision Studios is a War Room–native production kernel that owns `.hvsproj` state and structured Edit Commands, integrates FFmpeg(+NVENC) for media/proxy/render, uses OTIO only for interchange, routes generative work through a vendor-neutral Media Provider Router, keeps TrackSubject/CameraSpec as first-class local types, and interfaces Council/Terra/Foundry/WRIM/Research/Memory via typed handoffs — never merges modules.

**Stack decisions:**
1. Canonical SoR = `.hvsproj` + EditCommandLayer + TimelineEngine (**BUILD**)
2. Media plane = FFmpeg; NVENC primary on Nebula Linux (**INTEGRATE**)
3. Compose spike timeboxed: custom+FFmpeg vs MLT vs GES — pick one; default lean custom+FFmpeg
4. OTIO = interchange only (**VERIFIED** purpose)
5. Hybrid timeline: tracks = authoring truth; magnetic = ops/UX
6. Gen = Router cloud-first V1; local CV for identity-bearing track/reframe
7. War Room boundaries hard (WAVE_7 Domain 33)

### War Room integration boundaries

| System | Rule |
|---|---|
| Council | Opt-in edit plans/explanations; does not own timeline |
| Terra | No merge; optional later location deep-links |
| Foundry | Consume artifacts; do not absorb |
| WRIM | FUTURE Router backend only if production WRIM exists; never relabel third-party as WRIM |
| Research Engine | Call existing contracts — no duplicated scrapers in HVS |
| Memory | Provenance in Media Library; Memory writes via proposal gates only |

---

## 26. EXACT FIRST BUILD SLICE

**Name:** `HVS-V1-SLICE-0 — Kernel + STARRDOM Path`

**In scope (build order):**
1. `.hvsproj` schema v0 — sequences, tracks, clips, asset refs, provenance stubs, version nodes; optional ignored show/episode/scene keys
2. EditCommandLayer — `insertClip`, `overwriteClip`, `trimClip`, `splitClip`, `moveClip`, `rippleDelete`, `applyTheme`, `addCaptions`, `render` + preview/commit + undo + attribution
3. Media Library ingest — FFmpeg probe → proxy (NVENC else software) → thumbs; originals immutable
4. Timeline UI minimal + Program monitor scrubbing proxies
5. MediaProviderRouter skeleton — categories + **one** image + **one** video adapter; provenance on every gen asset
6. Theme pack stub — `luxury_beauty_v1`
7. Basic TrackSubject / 9:16 — face/person center when tracker ready; else center crop with human override
8. Aspect export — 16:9 + 9:16 delivery presets
9. STARRDOM sample project fixture — proves end-to-end render **inside HVS**

**Out of SLICE-0:** OpenFX host · full OCIO/ACES · Natron/Blender · full Media Intelligence/CLIP · multicam AI · local T2V · Fairlight-class · CapCut/FCP/Premiere/Resolve runtime · Terra/Council merge · WRIM-required inference

**Definition of done for “deserves the name”:** SLICE-0 complete **and** STARRDOM walkthrough (§23) executable with human gates — still research≠shipped until Builds leave HOLD.

---

## 27. SOURCES

### Wave stamps (primary fold)
1. `waves/WAVE_1.md` — Domain 1 NLE  
2. `waves/WAVE_2.md` — Domain 2 ThemeSpec  
3. `waves/WAVE_3.md` — Domains 3–5 camera/track (+ `WAVE_2_SEED.md`, `HVS_AI_VIDEO_CAMERA_FOLLOW_RESEARCH_SEP2026.md`)  
4. `waves/WAVE_4.md` — Domains 6/7/28 EditOps  
5. `waves/WAVE_5.md` + `/workspace/terra-swarm/hvs-waves/HVS_WAVE_5_GENERATIVE_CHARACTERS_STARRDOM.md` — Domains 8–10/20/21  
6. `waves/WAVE_6.md` — Domains 11–15/18/19/26  
7. `waves/WAVE_6_MISFILED_UNDERSTANDING_DISTRIBUTION_from_old_map.md` — Domains 16–17/22–24 fold  
8. `waves/WAVE_7.md` — Domains 25/27/29–34  
9. `waves/WAVE_8.md` — Domains 35–37 + 25 Qs  
10. `HVS_8_WAVES.md` · `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`

### Official / primary (selected)
11. OTIO — https://opentimelineio.readthedocs.io/ · https://github.com/AcademySoftwareFoundation/OpenTimelineIO  
12. FFmpeg legal — https://www.ffmpeg.org/legal.html  
13. NVIDIA FFmpeg GPU (SDK 13.1) — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html  
14. OpenFX — https://github.com/AcademySoftwareFoundation/openfx  
15. OCIO — https://github.com/AcademySoftwareFoundation/OpenColorIO  
16. OpenAI Sora discontinuation / Deprecations — https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation · https://developers.openai.com/api/docs/deprecations  
17. Google Veo — https://ai.google.dev/gemini-api/docs/veo  
18. Luma Agents generation + reframing docs  
19. Kling Open Platform — https://kling.ai/document-api  
20. Runway Dev API — https://docs.dev.runwayml.com/  
21. Adobe Firefly usage notes — https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/  
22. Descript API — https://docs.descriptapi.com/  
23. SAM2 — https://github.com/facebookresearch/sam2 · ByteTrack — https://github.com/ifzhang/ByteTrack  
24. C2PA Specification — https://spec.c2pa.org/  
25. YouTube upload encoding — https://support.google.com/youtube/answer/1722171  
26. GStreamer GES / MLT copyright / Blender license / Natron — as cited in WAVE_6/WAVE_7

### Explicit unknowns
- Nebula Genesis exact GPU/VRAM/NVMe inventory  
- Compose spike winner (custom vs MLT vs GES)  
- Redistributable NVENC FFmpeg without nonfree/GPL for shipping SKU  
- Post–Sep 24, 2026 OpenAI video successor (none verified)  
- ThemeSpec JSON Schema freeze (research-level only)

---

## APPENDIX A — ALL 25 CRITICAL QUESTIONS (concise)

**Q1** Yes, in slices — not a Resolve/FCP clone day one. Linux NLE stacks + FFmpeg prove feasibility.  
**Q2** BUILD: project, EditCommands, Router, ThemeSpec, UI, provenance, TrackSubject/CameraSpec. INTEGRATE: FFmpeg, OTIO, later OCIO/OpenFX. EVALUATE: MLT|GES. API: gen via Router.  
**Q3** Hybrid C — tracks SoR; magnetic = EditOps/UX; rational frames.  
**Q4** Linux YES for primary stack; AMF caveats; avoid Apple-only; Linux CUDA first-class.  
**Q5** Proxy-first; GPU decode/encode; render-cache; no full-res 4K software scrub V1.  
**Q6** Ingest→proxy+thumbs; originals immutable; cache = content+graph hash; PreviewTickets; conform at final.  
**Q7** Only `hvs.edit.v1` EditCommands in transactions; tips≠ops; Versions immutable.  
**Q8** Detect→ByteTrack→SAM2→MediaPipe→TrackSubject→VirtualCamera→keyframes. NLE reframe = UX only.  
**Q9** Split A/B/C — never one slider.  
**Q10** Own ThemeSpec packs; CapCut prior art only.  
**Q11** V1 EffectGraph+looks; V2 OCIO+OpenFX; no CapCut pack clone.  
**Q12** Multicam: score face/audio/thirds → switchAngle ops. Follow: score virtual window. Gen: CameraSpec intent.  
**Q13** Multicam = real sensors; gen = synthesized viewpoint — disclose.  
**Q14** Luma > Kling Motion > Veo/Seedance/Runway prompt+refs > Firefly; Sora excluded.  
**Q15** SAM2 + ByteTrack/BoT-SORT + MediaPipe; caution Ultralytics AGPL.  
**Q16** Frontier T2V/I2V, many TTS/music/SFX — CLOUD via Router until local proven.  
**Q17** Whisper/SAM2/CLIP/MediaPipe class — not frontier T2V; measure VRAM.  
**Q18** Media Provider Router by category; AssetRef+provenance in `.hvsproj`; never vendor objects as SoT.  
**Q19** `.hvsproj` SoT.  
**Q20** OTIO YES interchange; NO sole internal DB.  
**Q21** Versioned JSON envelope with typed `ops[]`, `preview|commit`, optional `explain`.  
**Q22** Append-only history + snapshots; AI cuts = new Version; media never deleted by undo.  
**Q23** Provider→Router→AssetRecord(+provenance)→Library→insert/replaceClip.  
**Q24** Match capability classes via owned schemas + legal OSS/APIs; refuse UI clones, scrapes, invented APIs, GPL core contamination.  
**Q25** SLICE-0 + STARRDOM path inside HVS — not AI-link pile, not export-to-CapCut-to-finish.

---

## APPENDIX B — WAVE STAMP LINES

- **WAVE_7 DONE | READY FOR WAVE 8**
- **WAVE_8 DONE | MASTER REPORT READY**

*End of Master Media Production Research Report. Research only. Builds HOLD.*

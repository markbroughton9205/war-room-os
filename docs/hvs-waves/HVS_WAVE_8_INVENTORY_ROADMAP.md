# HVS WAVE 8 — INVENTORY + ROADMAP + MASTER ARCHITECTURE
## Higher Vision Studios | RESEARCH SYNTHESIS ONLY | Commander Mark
## Date: Sunday Sep 20, 2026 · ~2:40 PM EDT (America/New_York)
## Domains: 35–37 + all 25 CRITICAL QUESTIONS · Fold of Waves 1–7
## Mode: RESEARCH ONLY — no code / build / commit / deploy
## Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE
## Rule: Never invent APIs. CapCut ≠ SoR. HVS ≠ Media Player ≠ Terra.

**Canonical wave map (`HVS_8_WAVES.md`):** W1 Domain 1 · W2 Domain 2 · W3 Domains 3–5 · W4 Domains 6/7/28 · W5 Domains 8–10/20/21 · W6 Domains 11–15/18/19/26 · W7 Domains 25/27/29–34 · W8 Domains 35–37 + 25 Qs. Older misfiled drafts (camera/AI Director/generative/look-sound/understanding-distribution) remain on disk under `WAVE_*_MISFILED_*` and are folded where useful — **not** alternate SoT. Domain 34 UI detail stamped in WAVE_7; this Wave 8 keeps the UI concept for synthesis. ThemeSpec = **PROPOSED HVS**, not a CapCut SDK.

**Companion deliverables:**
- Master architecture report (refreshed): `../HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md`
- Paste-ready ChatGPT critique brief: `../HVS_CHATGPT_FULL_RESEARCH_PROMPT.md`

Claim tags: VERIFIED FACT | VENDOR CLAIM | INFERENCE | RECOMMENDATION

---

## 1. UI CONCEPT (`PROPOSED HVS`)

> Full Domain 34 stamp (tab keep/slim evaluation, War Room chrome rules): **`waves/WAVE_7.md` §1.9**. Synthesis retained here for inventory/roadmap readers.

### 1.1 Layout (Domain 34)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ WAR ROOM · HIGHER VISION STUDIOS                                         │
│ Top tabs: CREATE | EDIT | GENERATE | AUDIO | COLOR | EFFECTS | DELIVER   │
├────────────┬─────────────────────────────────────┬───────────────────────┤
│ LEFT RAIL  │ CENTER VIEWER / CANVAS              │ RIGHT INSPECTOR       │
│ Projects   │  Source | Program (dual-monitor)    │ Clip / Effect / Theme │
│ Media Lib  │  Multicam angle strip (V2)          │ TrackSubject / Camera │
│ Assets     │  AI PreviewTicket overlay           │ Provenance / Rights   │
│ Effects    │                                     │ Character Bible       │
│ Filters    ├─────────────────────────────────────┤                       │
│ Themes     │ BOTTOM: Timeline (tracks SoR)       │ AI PANEL (Director)   │
│ Captions   │  V/A tracks · markers · versions    │ Modes · ops · explain │
└────────────┴─────────────────────────────────────┴───────────────────────┘
```

**Identity:** Cinematic + professional + War Room chrome — **not** CapCut pastel clone, **not** Adobe/FCP chrome copy.

### 1.2 Mandatory UI splits (Blind Spot locks)

| Control family | Must remain separate | Why |
|---|---|---|
| Multicam Intelligence (A) | Real angle switch / sync | Physical cameras ≠ synthesis |
| Generative CameraSpec (B) | Shot/movement intent → Router | Prompt/keyframe adapters only |
| Virtual Follow / Reframe (C) | TrackSubject → crop window | Local track on real footage |
| Tips vs Ops | `explain` string ≠ committed `ops[]` | Tips-only AI refused |
| Draft vs Publish | FULL DRAFT never auto-publishes | Human authority |

### 1.3 Control modes (Domain 28 — `PROPOSED`)

MANUAL EDIT → AI ASSIST → AI SUGGEST → AI FIRST CUT → AI DIRECTOR → AUTOMATIC DRAFT  
Every meaningful AI edit: **visible, undoable, versioned, attributable, inspectable.**

---

## 2. FEATURE INVENTORY — CONDENSED MATRIX (Domain 35)

Capability classes only — **do not copy proprietary UI**.

| FEATURE | FCP | Premiere | AE | Resolve | CapCut | Descript/Other | AI tools Sep 2026 | OSS option | HVS TARGET | BUILD / INTEGRATE / LATER |
|---|---|---|---|---|---|---|---|---|---|---|
| Track timeline + cut ops | Magnetic | Tracks | Layers≠NLE | Tracks | Creator tracks | Text-first | — | OTIO shape; GES/MLT eval | **V1** hybrid tracks SoR | **BUILD** model + EditOps |
| Source/Program monitors | Y | Y | Comp | Y | Single-ish | Canvas | — | — | **V1** | **BUILD** |
| Magnetic UX assist | Native | — | — | — | Magnetic-ish | — | — | — | **V2** Story mode optional | **BUILD** UX only |
| Multicam sync/switch | Y | Y | — | Y | Limited | — | Partial | Audio fingerprint | **V2** | **BUILD** |
| Auto-reframe 16:9→9:16 | Smart Conform | Auto Reframe | — | Smart Reframe Studio | Auto Reframe | — | Luma `video_reframe` (gen) | SAM2+ByteTrack+MediaPipe | **V1** basic face-center | **BUILD** local |
| Themes / templates | Motion | MOGRT | — | Titles/Lottie 21 | Theme packs | — | — | Lottie later | **V1** ThemeSpec stub | **BUILD** (own packs) |
| Filters / looks | Y | Lumetri | Y | Color page | Themed filters | — | — | OCIO V2; LUT V1 | **V1** thin looks | **BUILD**; OCIO **LATER** |
| Effects / OpenFX | FCP fx | Adobe fx | Native | OFX host | Creator fx | — | — | OpenFX BSD-3 | **V2** OFX host | **INTEGRATE V2** |
| Captions / ASR | Auto sub | Speech→Text | — | Subtitles | Auto captions | Core | Whisper / cloud ASR | Whisper MIT | **V1** | **HYBRID** |
| Beat-sync cut | Beat edit | Remix≠beat-cut | — | Audio-driven Fusion | Auto Cut | — | — | Beat markers OSS | Markers **V1**; AutoCut **FUTURE** | **BUILD** |
| Pro audio / DAW | Roles | Essential Sound | — | Fairlight | Light | Studio Sound | ElevenLabs TTS/SFX/music | — | Duck+import **V1**; Fairlight-class **V2** | **BUILD** + **ROUTER** |
| Subject / hair track | Limited | Limited | Trackers | Magic Mask Studio | Auto tools | — | — | SAM2 Apache-2.0; ByteTrack MIT | **V1** person; hair **V2** | **BUILD**+OSS |
| Generative T2V/I2V | — | Firefly | Firefly | — | In-app | — | Veo, Kling, Luma, Runway, Firefly, Seedance; **Sora sunset** | Not SOTA local | **V1** Router | **COMMERCIAL API** |
| Avatar / talking head | — | — | — | — | — | — | HeyGen, Synthesia, Runway avatars | — | Optional; not STARRDOM hero | **ROUTER** optional |
| Color / ACES | Color board | Lumetri | OCIO 26.5 | ACES Color | Filters only | — | — | OCIO 2.5 ACES 2.0 | **V2** | **INTEGRATE** |
| Proxy / HW encode | Optimized | Proxies | — | Optimized | — | — | — | FFmpeg+NVENC | **V1** | **INTEGRATE** |
| Project SoR | .fcpbundle | .prproj | .aep | .drp | CapCut proj | Descript | — | OTIO interchange | **`.hvsproj`** | **BUILD** |
| OTIO interchange | Via tools | Via tools | Limited | Via tools | No | — | — | ASWF Apache-2.0 | **V1** thin adapter | **INTEGRATE** |
| Media Intelligence | Limited | Sensei | — | IntelliSearch | Search UX | Transcript | CLIP/OpenCLIP | CLIP MIT; OpenCLIP | Thin **V1**; semantic **V2** | **BUILD**+OSS |
| Quality analysis | Manual | Manual | — | — | — | — | — | FFmpeg signalstats | Flag/rank **V1** | **BUILD** |
| Film/show episodic | — | — | — | — | — | — | — | — | Schema keys only **V1**; UI **V3** | **LATER** |
| Gaming/OBS ingest | — | — | — | — | — | — | OBS capture | OBS external | Ingest files **V1** | External OBS |
| Plugin host | FCP | UXP/native | Native | OFX | — | — | — | OpenFX | Own EffectGraph **V1**; OFX **V2** | **BUILD** then **INTEGRATE** |
| Provider Router | — | — | — | — | Lock-in risk | — | Multi-vendor APIs | — | **V1** skeleton | **BUILD** |
| Provenance / C2PA | Limited | — | — | — | — | — | C2PA specs | C2PA evaluate | AssetProvenance **V1**; C2PA export **V2+** | **BUILD** / evaluate |

---

## 3. BUILD VS INTEGRATE (Domain 36)

| Subsystem | Decision | Reasoning |
|---|---|---|
| Timeline / `.hvsproj` / EditCommandLayer | **BUILD** | No War Room-callable FCP/Premiere/Resolve/CapCut write API; Descript proves agent-edit only inside *its* model |
| Compose/preview graph | **HYBRID — spike** | Default lean custom+FFmpeg; evaluate MLT *or* GES once — never dual SoR |
| Decode/encode/proxy/render | **OSS INTEGRATE** | FFmpeg + NVENC (Nebula); LGPL-prefer; Legal on nonfree/GPL configures |
| OTIO | **OSS INTEGRATE** | Interchange only — not SoT (`VERIFIED` OTIO purpose) |
| Themes / filters / looks V1 | **BUILD** | Own ThemeSpec packs; CapCut = prior-art UX only |
| Subject track / virtual camera / reframe | **BUILD + OSS models** | SAM2 + ByteTrack/BoT-SORT + MediaPipe; NLE auto-reframe = UX benchmark only |
| Captions / ASR | **HYBRID** | Whisper-class local and/or cloud ASR via Router `TRANSCRIPTION` |
| Video / image gen | **COMMERCIAL API** | Veo / Kling / Luma / Runway / Firefly / Seedance via Router; **exclude Sora** post-sunset |
| Voice / music / SFX | **HYBRID / CLOUD-first** | ElevenLabs documented TTS/SFX/music APIs optional; import licensed music |
| Color (ACES/OCIO) | **INTEGRATE V2** | OCIO 2.5 + ACES 2.0 configs (`VERIFIED`) |
| OpenFX host | **INTEGRATE V2** | BSD-3 ASWF; refuse Adobe/FCP plugin SoT |
| Blender / Natron | **SUBPROCESS LATER** | GPL isolation; not V1 core link |
| Media Intelligence deep | **BUILD V2+** | CLIP/OpenCLIP; V1 = thin index only |
| Fairlight-class DAW | **BUILD V2** / partner | V1 = multitrack + duck + import |
| Film/show / gaming AI highlights | **RESEARCH ONLY → V3** | Non-blocking metadata keys in `.hvsproj` v0 |

---

## 4. V1–V4 ROADMAP (Domain 37)

| Version | Ships | Explicitly waits |
|---|---|---|
| **V1 — Functional AI production studio** | `.hvsproj` + EditCommandLayer + track timeline (insert/overwrite/split/trim/ripple-delete) + FFmpeg proxy/NVENC render + ThemeSpec stub (`luxury_beauty_v1`) + captions + Router (≥1 image + ≥1 video adapter) + basic TrackSubject/9:16 reframe + AssetProvenance + STARRDOM path **without** CapCut/FCP/Premiere/Resolve finish | Full trim suite, multicam AI, OpenFX, OCIO finishing, Fairlight-class, semantic search, local T2V, film episodic UI |
| **V2 — Advanced professional post** | OCIO/ACES looks, OpenFX host boundary, richer tracking/hair masks, advanced audio, Media Intelligence (CLIP + person clusters), C2PA export evaluate, Story magnetic UX optional, stronger CameraSpec adapters | Sovereign frontier gen |
| **V3 — Film / show / gaming scale** | Episode/season containers, Blender/Natron subprocess lanes, OBS watch-folder, highlight heuristics, long-form continuity | Full studio MAM replacement |
| **V4 — Sovereign media intelligence** | More local gen/analysis as Nebula capacity measured; WRIM-as-Router-backend only if production WRIM exists | Never pretend WRIM early |

### V1 slim lock vs STARRDOM acceptance (honest reconciliation)

| Path | Content | Status |
|---|---|---|
| **Blind Spot V1 slim** | ingest → cut/assembly → captions → export | Minimum research gate for early engineering |
| **STARRDOM V1 acceptance (product vision)** | research→concept→script→shot plan→analyze→track→select→gen missing shots→edit→look→transitions→music/VO→captions/graphics→thin color→16:9+9:16→render **inside HVS** | **Acceptance bar for “deserves the name”** |
| **Reconciliation** | Ship **SLICE-0 kernel** first (slim path works), then close STARRDOM gaps (Theme stub, Router gen, basic reframe, multi-aspect) **before calling V1 done** | Wave 8 lock: slim ≠ finished V1 |

---

## 5. STARRDOM ACCEPTANCE WALKTHROUGH (`PROPOSED` path · components `VERIFIED` where cited)

**Scenario:** 30s luxury STARRDOM hair-extension commercial — real salon footage + optional AI plates — deliver 16:9 and 9:16 **without** finishing in CapCut/FCP/Premiere/Resolve.

| Step | Operator / AI action | HVS mechanism | Gate |
|---|---|---|---|
| 1 Research / brief | Concept via Research Engine interface (not HVS scrapers) | Typed handoff | Brand/rights OK? |
| 2 Script | Script object in CREATE | Human approve | Script gate |
| 3 Shot plan | Shots + CameraSpec structs | Storyboard cells optional | Board gate |
| 4 Ingest | Client footage → Media Library | FFmpeg probe; **client agreement before ingest** | Rights |
| 5 Analyze | Quality flags + shot bounds (+ ASR if available) | Thin Media Intelligence; **never silent delete** | QA |
| 6 Subject track | Follow model / hair reveal | TrackSubject → VirtualCamera (`PROPOSED`; SAM2+ByteTrack stack `VERIFIED` OSS) | Override keyframes |
| 7 Select | Rank takes; exclude weak ranges in **new Version** | EditCommands; sources immutable | Cut approve |
| 8 Missing beauty B-roll | Gen empty/product plates or **consented** refs | Router → Veo/Kling/Luma/Firefly; **not Sora**; real talent authoritative | Asset QA + disclose AI |
| 9 Timeline edit | Insert/trim/transitions; beat markers if music known | EditCommandLayer preview→commit | Cut approve |
| 10 Look / theme | `luxury_beauty_v1` + logo slot | ThemeSpec apply | Brand |
| 11 Music / VO | Licensed bed + recorded or ElevenLabs TTS | Audio tracks + Router `TTS`/`MUSIC` | Audio approve |
| 12 Captions / graphics | ASR captions + CTA/titles | Caption track + theme typography | Legal/brand |
| 13 Color thin | Exposure/contrast/look strength (not full ACES) | Non-destructive look stack | Skin-tone check |
| 14 Multi-aspect | 16:9 master + 9:16 smart reframe | Local track-reframe (prefer over Luma reframe for real talent) | Both QC |
| 15 Render | H.264 delivery via FFmpeg/NVENC | Delivery presets (YouTube Help MP4/H.264/AAC class) | Delivery QC |
| 16 Publish | Explicit human Publish | Draft ≠ authority | Commander/client |

**Ethics locks:** No default beauty face-rewrite; no unauthorized voice clone; label AI-assisted vs real before/after; prefer track+grade over identity destruction.

---

## 6. RISKS

| Risk | Class | Mitigation |
|---|---|---|
| FFmpeg GPL/`--enable-nonfree` + codec patents | Legal (`VERIFIED` ffmpeg.org/legal) | LGPL-prefer builds; counsel before redistribute; dynamic link |
| GPL contamination (Blender/Natron link) | Legal | Subprocess only; never link into proprietary core |
| Ultralytics AGPL in tracker stack | Legal | Prefer MIT ByteTrack/BoT-SORT; Enterprise if YOLO Ultralytics |
| Invented NLE/cloud write APIs | Blind Spot | Refuse; host scripting ≠ War Room SoR |
| CapCut / Adobe scrape or SoR dependency | Blind Spot / Legal | ThemeSpec owned; CapCut = prior art only |
| Sora dependency after Sep 24, 2026 | Product | Router exclude; no replacement listed (`VERIFIED` OpenAI deprecations) |
| Single-provider lock-in | Architecture | Media Provider Router; `.hvsproj` stores AssetRef not vendor objects |
| Beauty identity destruction / FTC disclosure | Ethics / Legal | Real footage authoritative; consent; disclose gen |
| Silent media delete | Policy | Rank/flag only; versions exclude ranges |
| Overclaim local T2V / Nebula VRAM | Performance | Measure `nvidia-smi`; cloud-first gen V1 |
| AMF Linux Vulkan init gap | Hardware | NVIDIA NVENC primary on Nebula |
| OTIO round-trip field loss | Interchange | Document; SoT remains `.hvsproj` |
| Kitchen-sink V1 | Process | SLICE-0 then STARRDOM closeout; film/show UI V3 |
| Windows Nebula offline | Hardware | Linux CUDA first-class |
| Veo ~2-day retention / URL TTLs | Ops | Download assets immediately into Media Library |

---

## 7. MASTER ARCHITECTURE (`PROPOSED` · evidence-backed integrations)

**One sentence:** Higher Vision Studios is a War Room–native production kernel that owns `.hvsproj` state and structured Edit Commands, integrates FFmpeg(+NVENC) for media/proxy/render, uses OTIO only for interchange, routes generative work through a vendor-neutral Media Provider Router, keeps TrackSubject/CameraSpec as first-class local types, and interfaces Council/Terra/Foundry/WRIM/Research/Memory via typed handoffs — never merges modules.

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
MEDIA PLANE          CACHE                 CLOUD/LOCAL PROVIDERS
  FFmpeg I/O+NVENC     proxies/thumbs        VIDEO/IMAGE/VOICE/...
  (compose spike:      render cache          never hardwired in SoT
   custom|MLT|GES)     preview tickets
INTERCHANGE: OTIO (± FCPXML/EDL later, lossy) — NOT SoT
V2+: OCIO, OpenFX host
LATER: Blender/Natron subprocess
```

**Stack decisions:**
1. Canonical SoR = `.hvsproj` + EditCommandLayer + TimelineEngine (**BUILD**).
2. Media plane = FFmpeg; NVENC primary on Nebula Linux (**INTEGRATE**).
3. Compose spike timeboxed: custom+FFmpeg vs MLT vs GES — pick one; default lean custom+FFmpeg.
4. OTIO = interchange only (`VERIFIED`).
5. Hybrid timeline: tracks = authoring truth; magnetic behaviors = ops/UX (`RECOMMENDATION` Wave 1).
6. Gen = Router cloud-first V1; local CV for identity-bearing track/reframe.
7. War Room boundaries hard (Wave 7 Domain 33).

---

## 8. EXACT FIRST BUILD SLICE

**Name:** `HVS-V1-SLICE-0 — Kernel + STARRDOM Path`

### In scope (build order)

1. **`.hvsproj` schema v0** — sequences, tracks, clips, asset refs, provenance stubs, version nodes; optional ignored `show/episode/scene` keys (non-blocking).
2. **EditCommandLayer** — `insertClip`, `overwriteClip`, `trimClip`, `splitClip`, `moveClip`, `rippleDelete`, `applyTheme`, `addCaptions`, `render` + transaction preview/commit + undo log + actor attribution.
3. **Media Library ingest** — FFmpeg probe → proxy (NVENC if available else software) → thumbs; originals immutable.
4. **Timeline UI minimal** + Program monitor scrubbing proxies (Source monitor nice-to-have in same slice if cheap).
5. **MediaProviderRouter skeleton** — categories + **one** image + **one** video generator adapter behind interface (no hardwire); provenance on every gen asset.
6. **Theme pack stub** — `luxury_beauty_v1` (look LUT/params + caption style + logo slot + CTA).
7. **Basic TrackSubject / 9:16** — face/person center crop from TrackData when tracker ready; else center crop with human override (must not ship dumb-only without override).
8. **Aspect export** — 16:9 + 9:16 via FFmpeg delivery presets.
9. **STARRDOM sample project fixture** — proves end-to-end render **inside HVS** with no external NLE finish.

### Explicitly out of SLICE-0

OpenFX host · full OCIO/ACES · Natron/Blender · full Media Intelligence/CLIP · multicam AI switcher · local T2V training · Fairlight-class · CapCut/FCP/Premiere/Resolve runtime · merge with Terra/Council · WRIM-required inference.

### Definition of done for “V1 deserves the name”

SLICE-0 complete **and** STARRDOM walkthrough (§5) executable end-to-end with human gates — still research≠shipped until Builds leave HOLD.

---

## 9. ANSWERS TO ALL 25 CRITICAL QUESTIONS

### Q1 — Can we realistically build our own professional NLE inside War Room?
**Yes, in slices — not as a Resolve/FCP clone on day one.** (`RECOMMENDATION`) Linux NLEs (Kdenlive/Shotcut via MLT) and GES prove editor stacks on Linux; FFmpeg+NVENC covers media I/O. HVS owns UX + `.hvsproj` + commands; full FCP/Premiere/Resolve parity is **FUTURE**.

### Q2 — What parts build ourselves vs FFmpeg/OTIO/etc.?
**BUILD:** project format, EditCommandLayer, Router, ThemeSpec, UI, AI Director orchestration, provenance, War Room section, TrackSubject/CameraSpec types.  
**INTEGRATE:** FFmpeg (I/O/encode), OTIO (interchange), later OCIO/OpenFX.  
**EVALUATE:** MLT or GES compose.  
**SUBPROCESS LATER:** Blender/Natron.  
**API:** generative providers via Router.

### Q3 — How should the underlying timeline engine work?
**Hybrid C (`RECOMMENDATION` Wave 1):** traditional **tracks** as authoring SoR (aligns OTIO Track lists, GES, Premiere/Resolve); magnetic-style **ripple/gap/connect-overlay** as EditOps and optional later Story UX — magnetism is not the data model. Timebase = rational frames. SoR ≠ GES/MLT/Resolve scripting.

### Q4 — Can Linux support the intended architecture?
**VERIFIED YES** for FFmpeg/NVENC, GStreamer/GES, MLT, OTIO, OCIO, OpenFX, Blender, Natron. Caveats: AMF Vulkan init Linux gap; avoid Apple-only codecs/APIs; Windows Nebula often offline — Linux CUDA first-class.

### Q5 — How do we get professional preview performance?
Proxy-first UI; GPU decode/encode when present; keep frames on GPU where documented (`hwaccel_output_format cuda` per NVIDIA Video Codec SDK 13.1 guidance); render-cache by content+graph hash; no full-res 4K software scrub in V1.

### Q6 — How should proxy/caching work?
On ingest: NVENC (or software) edit proxies + thumbs; originals immutable on NVMe/NAS; cache keys = content hash + graph hash; PreviewTickets for AI txs; conform to originals at final; resumable batch; multi-aspect as render forks.

### Q7 — How should AI manipulate the timeline?
**Only** via structured `hvs.edit.v1` EditCommands inside EditTransactions (`preview|commit`), with explain separate from ops, undo, Version nodes, attribution — never tips-only and never UI-click automation as primary path. Descript agent-jobs = UX shape inspiration only (`VERIFIED` Descript API exists; not HVS SoR).

### Q8 — How do we implement subject/person following?
HVS-owned stack: detect → ByteTrack/BoT-SORT (MIT) → optional SAM2 masks (Apache-2.0) → MediaPipe landmarks → `TrackSubject` time series → VirtualCamera → Transform keyframes. FCP/Premiere/Resolve/CapCut auto-reframe = **UX benchmarks only** — no War Room-callable APIs.

### Q9 — How do we implement AI camera tracking?
**Split three meanings — never one slider:**  
**(A)** Multicam sync + best-angle on real footage.  
**(B)** Generative CameraSpec → verified provider fields + prompt (Luma keyframes, Kling Motion Control, Veo first/last).  
**(C)** Virtual follow = track → crop (STARRDOM follow on uploads).

### Q10 — How do we implement CapCut-like themes?
**Own ThemeSpec engine (`PROPOSED`)** — HVS-owned packs encapsulating typography, caption style, grade/look, transitions, music bed refs, animation, logo placement, overlays, aspect presets (ad, luxury, beauty/salon, TikTok, etc.). CapCut themes = prior-art UX speed reference only — **no CapCut scrape/SDK/SoR**.

### Q11 — How do we implement CapCut-like filters/effects?
V1: non-destructive HVS EffectGraph + look presets (Luxury Gold, Clean Beauty, …) parameterized strength. V2: OCIO Looks + OpenFX plugin leaves. Match *capability class* and speed — do not clone CapCut effect packs or proprietary Adobe/FCP plugin binaries.

### Q12 — How should camera-angle intelligence work?
Real multicam: score face visibility, audio energy, thirds, shake, occlusion → `switchAngle`/`cutOnSpeaker` commands. Single-cam follow: score virtual window framing. Generative: CameraSpec is authoring intent, not angle-intelligence over sensors.

### Q13 — How do generated camera angles differ from multicam angles?
Multicam = discrete real sensors; switch = edit/cut; physical continuity. Generated = synthesized viewpoint from prompt/keyframes/motion-control; no true light-field. **Never** present gen as alternate physical takes without disclosure.

### Q14 — Which current video-generation providers offer useful camera control?
Ranked by structured control (Sep 2026 evidence): **1 Luma Ray 3.2** (keyframe indexes, start/end, `video_reframe`) · **2 Kling Motion Control** · **3 Veo / Seedance / Runway** (prompt + first/last/refs; no verified CameraSpec object) · **4 Firefly Video** prompt/short · **5 Sora** prompt — **API shutdown Sep 24, 2026, do not depend** · HeyGen/Synthesia = avatar framing only. Never invent undocumented fields (e.g. unofficial Runway `camera_motion` JSON).

### Q15 — What open-source trackers/segmenters are viable?
**SAM2 (Apache-2.0)** + **ByteTrack/BoT-SORT (MIT)** + **MediaPipe** + OpenCV flow. Caution: **Ultralytics AGPL-3.0** without Enterprise. CoTracker-class for hair tips after license check. Sufficient for V1 subject follow + 9:16 without CapCut.

### Q16 — What should remain provider-based instead of local?
Frontier T2V/I2V, many TTS/music/SFX generators, some neural upscalers/interp — **CLOUD via Router** until local quality/cost proven. War Room still owns project state and assets after download.

### Q17 — What local models could Nebula realistically run?
**INFERENCE (hardware-dependent, unmeasured SKU):** Whisper-class ASR, SAM2-class seg, CLIP/OpenCLIP embeddings, MediaPipe, small image tools — **not** assumed frontier T2V. Inventory VRAM before V4 sovereignty claims.

### Q18 — What architecture prevents provider lock-in?
**Media Provider Router** with categories (`VIDEO_GENERATOR`, `IMAGE_GENERATOR`, `IMAGE_EDITOR`, `VOICE`, `TTS`, `MUSIC`, `SFX`, `LIP_SYNC`, `UPSCALE`, `INTERPOLATION`, `TRANSCRIPTION`, `TRANSLATION`, `MOTION_TRANSFER`). Selection by capability/cost/rights/privacy/availability. `.hvsproj` stores AssetRef + provenance — never “only VendorX timeline objects.”

### Q19 — What project format should Higher Vision use?
**PROPOSED `.hvsproj`** (inspectable JSON V1 ± SQLite asset index later): deterministic, versionable, migratable, AI-readable, UI-editable, non-destructive, provenance-aware. **Not** CapCut/Premiere/Resolve/FCP project files as SoR.

### Q20 — Should OpenTimelineIO be part of the architecture?
**YES as interchange** (`VERIFIED` ASWF Apache-2.0 editorial cut graph, external media refs, not a renderer/media container). **NO as sole internal project DB.** Round-trip may drop HVS-only fields — disclose.

### Q21 — What should the internal edit command API look like?
Versioned JSON envelope `schemaVersion: hvs.edit.v1`, `transactionId`, `actor`, `mode: preview|commit`, ordered typed `ops[]` (insert/trim/split/trackSubject/setVirtualCamera/applyTheme/generate*/render/…), optional `explain`. **PROPOSED** — not a claimed vendor API.

### Q22 — How should undo/version/history work?
Append-only command/history log + snapshot deltas; undo = inverse or restore; AI FIRST CUT / DIRECTOR creates **new Version** leaving prior immutable; media files never deleted by undo; checkpoints for long Director runs; attribution on every commit.

### Q23 — How should AI-generated assets flow into the timeline?
Provider → Router → AssetRecord(+provenance: provider, model, prompt hash, params, license, consent) → Media Library → `insertClip`/`replaceClip` → timeline range refs. No orphan blobs; no silent overwrite of sources; download immediately (retention TTLs).

### Q24 — How do we avoid copying proprietary software while matching capability?
Match **capability classes** (ops families, theme encapsulation, reframe quality, caption speed) via HVS-owned schemas and OSS/legal APIs. Refuse: proprietary UI clones, CapCut template packs as SoR, invented Adobe/Apple/Blackmagic remote write APIs, scraped effect binaries, GPL core contamination. Study Descript/Premiere/FCP/Resolve/CapCut as **prior art**, not drop-in engines.

### Q25 — What is the smallest V1 that still deserves “AI media production studio”?
**SLICE-0 complete + STARRDOM acceptance path inside HVS:** own timeline + commands + proxy/render + theme stub + captions + Router-backed missing-shot gen + basic subject reframe + multi-aspect deliverable — **not** a pile of AI website links, and **not** “export to CapCut to finish.”

---

## 10. SOURCES

### Wave stamps (primary fold)
1. `waves/WAVE_1.md` — Domain 1 NLE foundation, hybrid timeline, OTIO/GES/MLT, API reality  
2. `waves/WAVE_2.md` — Domain 2 CapCut-style ThemeSpec (owned packs; CapCut = prior art only)  
3. `waves/WAVE_3.md` — Domains 3–5 TrackSubject, CameraSpec A/B/C, reframe (+ `WAVE_2_SEED.md` / camera research)  
4. `waves/WAVE_4.md` — Domains 6/7/28 Edit Command Layer, IDEA→RENDER, control modes  
5. `waves/WAVE_5.md` + terra `HVS_WAVE_5_GENERATIVE_CHARACTERS_STARRDOM.md` — Domains 8–10/20/21 gen/characters/STARRDOM (Sora DEAD)  
6. `waves/WAVE_6.md` — Domains 11–15/18/19/26 audio/color/VFX/captions/render  
7. `waves/WAVE_6_MISFILED_UNDERSTANDING_DISTRIBUTION_from_old_map.md` — Domains 16–17/22–24 Media Intelligence / social / gaming / film (folded into MASTER §§10/23/24)  
8. `waves/WAVE_7.md` — Domains 25/27/29–34 plugins, `.hvsproj`, hardware, Router, provenance, WR boundaries, **UI**  
9. `HVS_8_WAVES.md` — locks, V1 slim vs STARRDOM, wave map  
10. `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md` — 37 domains, 25 Qs, acceptance  
11. `HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md` — this fold’s architecture report

### Official / primary (selected; full lists in Waves 1–7)
12. OTIO — https://opentimelineio.readthedocs.io/ · https://github.com/AcademySoftwareFoundation/OpenTimelineIO  
13. FFmpeg legal — https://www.ffmpeg.org/legal.html  
14. NVIDIA FFmpeg GPU (SDK 13.1) — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html  
15. OpenAI Sora discontinuation / Deprecations — https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation · https://developers.openai.com/api/docs/deprecations  
16. Google Veo — https://ai.google.dev/gemini-api/docs/veo  
17. Luma Agents generation + reframing — https://docs.agents.lumalabs.ai/guides/videos/generation/ · https://docs.agents.lumalabs.ai/guides/videos/reframing/  
18. Kling Open Platform — https://kling.ai/document-api  
19. Runway Dev API — https://docs.dev.runwayml.com/  
20. Adobe Firefly usage notes — https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/  
21. Descript API — https://docs.descriptapi.com/  
22. SAM2 — https://github.com/facebookresearch/sam2  
23. ByteTrack — https://github.com/ifzhang/ByteTrack  
24. OpenFX — https://openeffects.org/ · https://github.com/AcademySoftwareFoundation/openfx  
25. OCIO 2.5 — https://opencolorio.readthedocs.io/en/latest/releases/ocio_2_5.html  
26. ElevenLabs TTS/SFX/music API refs — https://elevenlabs.io/docs/api-reference/text-to-speech/convert (and sibling SFX/music docs in Wave 5)  
27. YouTube upload encoding — https://support.google.com/youtube/answer/1722171  
28. C2PA Specification — https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html  
29. Apple Magnetic Timeline / Smart Conform; Adobe Premiere Auto Reframe / UXP; Blackmagic Resolve Editors Guide — URLs in Waves 1–2  

### Explicit unknowns (do not claim resolved)
- Nebula Genesis exact GPU/VRAM/NVMe inventory  
- Compose spike winner (custom vs MLT vs GES)  
- Live Seedance 2.5 caps per BytePlus vs Runway vs Pika  
- Redistributable NVENC FFmpeg without nonfree/GPL for shipping SKU  
- Post–Sep 24, 2026 OpenAI video successor (none verified)  
- Domain 2 ThemeSpec JSON Schema freeze (research-level only)

---

## WAVE 8 STAMP

**WAVE_8 DONE | MASTER REPORT READY**

- **Status:** RESEARCH SYNTHESIS COMPLETE — Domains **35–37** + **all 25 CRITICAL QUESTIONS**
- **Folds:** Waves 1–7 (canonical map) + misfiled Understanding/Distribution + camera seed + Legal/Blind Spot locks + MASTER REPORT upgrade
- **V1 honesty:** Slim path ≠ STARRDOM acceptance; reconciled in §4–§5–§8
- **Exact first slice:** `HVS-V1-SLICE-0 — Kernel + STARRDOM Path` (§8)
- **Builds:** HOLD — research ≠ shipped
- **Companion:** `HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md` (27-section complete structure)
- **Next:** Commander / PA critique; optional Nebula `docs/` mirror via PA

*Research only. No code / build / commit / deploy.*

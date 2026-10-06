# HIGHER VISION STUDIOS — WAVE 7
# Hardware / Rights / War Room Boundaries / UI
# Domains: 25, 27, 29–34 (Domain 26 render/proxy/cache = WAVE_6 ownership — pointers only here)
# Date: Sunday Sep 20, 2026 (America/New_York, EDT)
# Mode: RESEARCH ONLY — VERIFIED / PROPOSED / FUTURE
# Owners: Engineer + Legal locks + Historian boundaries + UI (Domain 34)
# Seeded from: MASTER REPORT architecture sections + HVS_8_WAVES.md Wave 7 scope
# Canonical map: HVS_8_WAVES.md — Domains 25, 27, 29–34

Label legend:
- **VERIFIED** — grounded in official docs/repos cited in Sources
- **PROPOSED** — HVS design recommendation (not an existing product API)
- **FUTURE** — deferred / experimental / not required for V1
Claim tags: VERIFIED FACT | VENDOR CLAIM | INFERENCE | RECOMMENDATION

Locks carried from HVS_8_WAVES.md:
- OTIO Apache-2.0; FFmpeg LGPL preferred; provenance per asset
- Prefer Nebula Linux CUDA workers; Windows Nebula often offline — not sole GPU path
- Never hardwire one vendor; paid commercial tiers for client work; client agreement before ingest
- HVS ≠ Media Player ≠ Terra; no merge-all with Council/Foundry/WRIM

---

## 1. FINDINGS

### 1.1 Domain 25 — Plugin / Extension System (OpenFX boundary)

**VERIFIED (OpenFX / ASWF):**
- OpenFX is an open image-processing plug-in standard (host ↔ plugin). Authoritative project: Academy Software Foundation `openfx` (BSD-3-Clause). Docs: openfx.readthedocs.io / openeffects.org.
- Host loads plugin binaries; bootstrap: optional `OfxSetHost` → `OfxGetNumberOfPlugins` → `OfxGetPlugin` → `setHost` / `mainEntry`; suites fetched via `OfxHost::fetchSuite` (no hard symbolic host dependency).
- Standard is **image effects**, not a full NLE project format, not Adobe/FCP proprietary effect packages.

**Other extension concepts (capability classes — do not copy proprietary formats):**
| Concept | Role | HVS stance |
|---|---|---|
| OpenFX | Pro VFX/color plugin ecosystem | **INTEGRATE V2+ host** (MASTER §14, §19) |
| FFmpeg filters | Built-in process graph | **INTEGRATE V1** as media plane |
| HVS Theme/Effect packs | Owned creative packs | **BUILD** (not CapCut templates) |
| Provider adapters | AI cloud/local generators | **BUILD** Router plugins (Domain 31) |
| WASM / sandboxed analyzers | FUTURE isolation | **FUTURE** |
| Adobe / FCP / Resolve plugin SDKs | Proprietary | **REFUSE as SoT**; do not clone binary formats |

**PROPOSED HVS extension boundary:**
```
HVS Extension Host (own ABI)
 ├── EffectGraph nodes (V1 thin looks/filters)
 ├── OpenFX bridge (V2) — load OFX plugs into graph leaves
 ├── Analyzer plugins (quality, embeddings) — sandboxed process
 ├── Exporter plugins (YouTube preset, ProRes later, etc.)
 └── Provider adapters (Router) — separate process/network trust zone
```
**Do not** make Adobe Premiere/After Effects plugin APIs, FCP effect bundles, or CapCut effect packs the HVS plugin SoT.

**GPL isolation (VERIFIED risk):** Natron is GPLv2 OpenFX host; Blender is GPL. Prefer **subprocess** integration later; do not link GPL hosts into proprietary HVS core without counsel (MASTER §14, §24).

---

### 1.2 Domain 26 — Render / Cache / Proxy (**DEFER TO WAVE_6**)

**Ownership lock:** Domain 26 is stamped in **`waves/WAVE_6.md`** (Audio / Color / VFX / Captions / Render — Domains 11–15, 18, 19, **26**). Wave 7 does **not** re-own encode/proxy/cache design.

**Pointers only (do not re-litigate here):**
| Topic | Wave 6 locus | Wave 7 infra touch |
|---|---|---|
| FFmpeg + NVENC primary; LGPL-prefer; refuse redistributable `--enable-nonfree` | WAVE_6 Domain 26 | License pins appendix below + Domain 29 Nebula GPU |
| Proxy / thumbs / render-cache / PreviewTickets / multi-aspect forks | WAVE_6 Domain 26 | Storage map Domain 29; Router delivery jobs Domain 31 |
| Compose spike (custom+FFmpeg vs MLT vs GES) | WAVE_6 + MASTER §25 | Restated infra spike §1.9 only |
| QSV / AMF / Vulkan Video | WAVE_6 | Hardware feasibility Domain 29 |

**Evidence license continuity** for FFmpeg/NVENC remains in the Evidence pin table at the end of this file (redistribution posture), not a second Domain 26 design.

### 1.3 Domain 27 — Project Format (INTERNAL `.hvsproj` + OTIO interchange)

**VERIFIED — OpenTimelineIO (ASWF, Apache-2.0):**
- OTIO is an **API + interchange format for editorial cut information** (modern EDL-class), **not** a media container.
- Canonical structure: `Timeline` → `tracks` (`Stack`) → `Track` → `Clip` / `Gap` / `Transition` / nested compositions.
- Media referenced externally (`ExternalReference` / `MissingReference`); native `.otio` via `otio_json` adapter; adapter + media-linker plugin systems.
- Blind metadata dict on objects — useful for non-SoT annotations, **not** a substitute for HVS undo/AI provenance stores.

**PROPOSED internal SoT: `.hvsproj`**
- Inspectable JSON (V1) ± SQLite sidecar for asset index if scale demands.
- Must be: deterministic, versionable, migratable, AI-readable, UI-editable, non-destructive, provenance-aware.
- Stores: sequences, tracks, clips, media refs, effect stacks, themes, markers, aspect variants, command-history pointers, rights/provenance IDs, optional film metadata keys (Wave 6 — ignored by V1 UI).
- **Must NOT** use CapCut / Premiere / Resolve / FCP project files as system of record.

**OTIO role (VERIFIED purpose match + RECOMMENDATION):**
- **YES** as interchange in/out (pipeline handoff, editorial cut exchange).
- **NO** as sole internal project DB / SoT.
- Round-trip may drop HVS-only fields (themes, EditCommand history, full provenance) — document lossiness.

**Other interchange (concepts only):** EDL, FCPXML, AAF — evaluate adapters later; do not invent proprietary XML writers that claim Adobe/Apple certification.

---

### 1.4 Domain 29 — Hardware (Linux + Nebula Genesis feasibility)

**VERIFIED:** Primary OSS stack targets Linux — FFmpeg+NVENC, GStreamer/GES, MLT, OTIO, OCIO, OpenFX, Blender, Natron. NVIDIA documents FFmpeg GPU accel on Linux (incl. WSL/Jetson notes in SDK 13.1).

**INFERENCE (War Room context):** Nebula Genesis is the intended CUDA workstation/training context (MASTER_OS_ROADMAP #23 WRIM Nebula runs). Exact GPU SKU/VRAM **not invented here** — size proxies and local models after `nvidia-smi`-class inventory.

**Storage map (PROPOSED):**
| Store | Medium | Notes |
|---|---|---|
| Originals | NVMe and/or NAS | Immutable |
| Proxies / thumbs / render cache | Local NVMe | Evictable |
| Embeddings / model weights | NVMe | V2+ Media Intelligence |
| Generated media | NVMe + provenance DB | Router outputs |
| Masters / delivers | NVMe → archive policy | Never auto-delete sources |

**Blockers to avoid:** Apple-only encode assumptions; CapCut dependency; AMF-only path; treating offline Windows Nebula as sole GPU; linking GPL DCC into core.

**Local models realistic on Nebula (INFERENCE — hardware-dependent):** ASR (Whisper-class), segmentation/tracking (SAM2-class), embeddings (CLIP/OpenCLIP), small image tools — **not** assumed frontier T2V parity. Measure before promising V4 sovereignty.

---

### 1.5 Domain 30 — LOCAL / CLOUD / HYBRID

| Capability | Class | Notes |
|---|---|---|
| Timeline, `.hvsproj`, undo/version | **LOCAL** | War Room owns state |
| Proxy/preview/final encode (NVENC) | **LOCAL** | Nebula GPU |
| Themes / looks / caption styling | **LOCAL** | Owned assets |
| Subject track / basic reframe | **LOCAL** (hybrid CV optional) | Start local |
| ASR / captions | **HYBRID** | Whisper-class or cloud |
| TTS / VO / music / SFX gen | **HYBRID / CLOUD-first** | Router |
| T2V / I2V / beauty B-roll | **CLOUD-first** | Router; local optional later |
| Upscale / interpolation | **HYBRID** | FFmpeg local + Router neural |
| OpenFX host | **LOCAL** (V2) | Plugin binaries on box |
| Research for ad concept | **War Room Research Engine** | Do not merge into HVS |

**Doctrine:** War Room owns orchestration + project state. Providers supply generation. Adapters replaceable. Sovereign-now vs frontier-cloud is a **per-capability** choice, not a slogan.

---

### 1.6 Domain 31 — Media Provider Router

**PROPOSED categories (assignment + MASTER Q18):**
`VIDEO_GENERATOR`, `IMAGE_GENERATOR`, `IMAGE_EDITOR`, `VOICE`, `TTS`, `MUSIC`, `SFX`, `LIP_SYNC`, `UPSCALE`, `INTERPOLATION`, `TRANSCRIPTION`, `TRANSLATION`, `MOTION_TRANSFER`

**Selection axes:** capability, quality, latency, cost, rights, privacy, resolution, duration, character consistency, camera control, reference support, local/cloud, availability.

**Contract sketch (PROPOSED):**
```
RouterRequest { category, capabilityHints, rightsPolicy, privacyClass, budget }
  → Adapter.select()
  → Adapter.execute() → AssetRef + ProvenanceRecord
  → Media Library ingest → EditCommand insert/replace
```
**Never** persist a single vendor id as the only way to open a project. `.hvsproj` stores `AssetRef` + provenance, not “only Runway timeline objects.”

**Pattern alignment (INFERENCE):** Research Engine’s adapter/router separation (registry, intent→providers, no hardwire) is a useful **organizational analogy** — HVS Media Provider Router is a distinct module, not a reuse of Research scrapers.

---

### 1.7 Domain 32 — Rights / Provenance

**PROPOSED AssetProvenance record (per asset):**
source class (`client_upload` | `recorded` | `generated` | `stock` | `derived`), client/project ids, provider, model, prompt, refs, params, parent asset ids, license, commercial-use flag, consent/release ids, timestamps, timeline usage refs.

**VERIFIED industry standard to evaluate:** **C2PA Content Credentials** (spec.c2pa.org — v2.3/v2.4 family as of 2026) — cryptographically signed manifests (actions, ingredients, bindings). **PROPOSED:** Internal provenance DB in V1; optional C2PA manifest attach on export in V2+ after Legal review. Do not claim C2PA compliance until implemented and verified.

**Locks:** Paid commercial tiers for client work; client agreement before ingest; no silent overwrite of sources; generative assets always land in Media Library with provenance before timeline insert (MASTER Q23).

---

### 1.8 Domain 33 — War Room boundaries (Council / Terra / Foundry / WRIM)

**Seeded from MASTER report War Room section + Research Engine / MASTER_OS_ROADMAP doctrine:**

| System | Role vs HVS | Interface rule |
|---|---|---|
| **Council** | Reasoning / synthesis | HVS may **opt-in send** edit plans/explanations; Council does **not** own timeline state. Keep Observed / Generated / Commander buckets separate. |
| **Terra** | World-state Oracle | **No merge.** Optional later deep-link of location refs for location-based ads; Terra is not an NLE. |
| **Foundry** | Build / forge tooling | HVS may consume artifacts; does not absorb Foundry. |
| **WRIM** | Native model lineage | Optional **future** local inference backend behind Router; HVS V1 must not require WRIM; **do not relabel** third-party models as WRIM. Production WRIM still NOT_IMPLEMENTED per roadmap — treat as FUTURE backend candidate only. |
| **Research Engine** | Evidence providers | HVS calls Research for concept/facts via existing contracts — **no duplicated scrapers** inside HVS. |
| **Memory** | Commander / operational memory | Production provenance stays in Media Library; Memory writes only via existing proposal gates — no silent merge. |

**Doctrine:** Do not create HVS2/Council2; do not merge sections; typed handoffs only. HVS is a **major native section**, not a pile of links and not a client portal.

---

### 1.9 Domain 34 — UI workspace (PROPOSED HVS)

**Assignment layout (Domain 34):** Left media · Center viewer · Right inspector · Bottom timeline · AI Director panel · Top mode tabs.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ WAR ROOM · HIGHER VISION STUDIOS                                             │
│ Top tabs: CREATE | EDIT | GENERATE | AUDIO | COLOR | EFFECTS | DELIVER         │
├──────────────┬──────────────────────────────────────────┬────────────────────┤
│ LEFT         │ CENTER VIEWER / CANVAS                   │ RIGHT INSPECTOR    │
│ Projects     │  Source | Program (dual-monitor V1+)     │ Clip / Effect      │
│ Media Lib    │  Multicam strip (V2)                     │ Theme / Look       │
│ Assets       │  AI PreviewTicket overlay                │ TrackSubject / Cam │
│ Effects      │                                          │ Provenance/Rights  │
│ Filters      ├──────────────────────────────────────────┤ Character Bible    │
│ Themes       │ BOTTOM: Timeline (tracks = SoR)          │                    │
│ Captions     │  V/A tracks · markers · versions · snap  │ AI DIRECTOR PANEL  │
│              │                                          │ Modes · ops · explain│
└──────────────┴──────────────────────────────────────────┴────────────────────┘
```

**Identity (PROPOSED):** Cinematic + professional + War Room chrome — **not** CapCut pastel clone, **not** Adobe/FCP chrome copy. HVS ≠ Media Player ≠ Terra chrome.

**Mandatory UI splits (Blind Spot — carry from Waves 3–4):**
| Control family | Must stay separate | Why |
|---|---|---|
| Multicam Intelligence (A) | Real angle switch / sync | Physical cameras ≠ synthesis |
| Generative CameraSpec (B) | Shot/movement intent → Router | Prompt/keyframe adapters only |
| Virtual Follow / Reframe (C) | TrackSubject → crop window | Local track on real footage |
| Tips vs Ops | `explain` ≠ committed `ops[]` | Tips-only AI refused |
| Draft vs Publish | FULL DRAFT never auto-publishes | Human authority |

**Control modes surface (Domain 28 — UI chrome only; schema owned Wave 4):**  
MANUAL EDIT → AI ASSIST → AI SUGGEST → AI FIRST CUT → AI DIRECTOR → AUTOMATIC DRAFT — every meaningful AI edit visible, undoable, versioned, attributable, inspectable.

#### Top tabs — CREATE | EDIT | GENERATE | AUDIO | COLOR | EFFECTS | DELIVER — keep or slim?

| Tab | Role | V1 recommendation | Slim option |
|---|---|---|---|
| **CREATE** | Projects, scripts, shot plans, storyboard cells, Character Bible entry | **KEEP** (thin) — script/shot stubs for STARRDOM path | Merge into left Projects if UI cramped |
| **EDIT** | Timeline, monitors, TrackSubject, Theme apply, captions assembly | **KEEP — primary** | Never slim away |
| **GENERATE** | Router-backed image/video/voice/music jobs + provenance | **KEEP** — makes gen a first-class lane without burying under EDIT | Could nest under AI Panel only — **not recommended** (hides Router) |
| **AUDIO** | Multitrack, duck, import VO/music, beat markers | **KEEP thin in V1**; Fairlight-class depth = V2 | Acceptable to nest under EDIT as Audio drawer if tab bar overcrowded |
| **COLOR** | Thin looks/exposure in V1; OCIO/ACES finishing V2 | **KEEP as tab label** even if V1 body is Look strength only — educates roadmap | Slim: fold Looks into EFFECTS for V1, promote COLOR tab at V2 |
| **EFFECTS** | EffectGraph, transitions, Theme packs, (V2 OpenFX) | **KEEP** | Do not merge Themes into Media only |
| **DELIVER** | Proxy status, aspect variants, render queue, YouTube/social presets, Publish gate | **KEEP — mandatory** (Draft ≠ Publish lives here) | Never slim away |

**Tab recommendation (RECOMMENDATION):**
1. **V1 ship with all seven tabs** but **thin bodies** for CREATE / AUDIO / COLOR (stubs that still route to real EditOps).
2. If forced to slim for early chrome: keep **EDIT · GENERATE · DELIVER** + left rail Themes/Effects; fold AUDIO+COLOR into EDIT drawers; keep CREATE as left-rail Projects+Scripts. **Do not** remove DELIVER or GENERATE.
3. Prefer **seven labeled tabs** over a CapCut-style single “Templates” mega-tab — reinforces HVS as professional + AI-native, not a tips site.

**Left rail contents (PROPOSED):** Projects · Media Library · Assets (incl. generated) · Effects · Filters/Looks · Themes · Captions templates.  
**Right inspector:** selection-driven (clip, effect, theme, TrackSubject, CameraSpec, provenance/rights, Character Bible).  
**AI Director panel:** mode picker, pending EditTransaction ops list, explain string, Accept/Reject PreviewTicket, version picker — **never** a chat that only gives tips.

**War Room chrome rules:** Section lives under War Room nav as **Higher Vision Studios**; no embed of Terra globe or Media Player densify into the HVS shell.

### 1.10 Compose-engine decision (infrastructure spike)

**RECOMMENDATION (MASTER §25):** Timeboxed spike — custom FFmpeg graph **vs** MLT **vs** GES — before V1 feature freeze. Default lean = **custom + FFmpeg** for control; MLT/GES remain evaluated alternatives (do not adopt automatically). Kdenlive/Shotcut prove Linux NLE stacks are feasible without copying their UX.

---

## 2. RECOMMENDATIONS

1. **Plugin boundary:** Own HVS EffectGraph in V1; add **OpenFX host in V2**; refuse proprietary Adobe/FCP/CapCut plugin formats as SoT. Isolate GPL DCC (Blender/Natron) as subprocess only. (**RECOMMENDATION**)
2. **Render plane (owned WAVE_6 Domain 26; infra affirmation):** FFmpeg + **NVENC primary** on Nebula Linux; LGPL redistribution posture; Legal review before nonfree/GPL configures. (**RECOMMENDATION** — details in WAVE_6)
3. **Proxy/cache (owned WAVE_6):** Ingest → probe → proxy + thumbs; content+graph hash caches; PreviewTickets; conform at final. Wave 7 only maps storage tiers (Domain 29). (**RECOMMENDATION**)
4. **Project SoT:** **`.hvsproj`** internal; **OTIO interchange only** (not SoT). Document round-trip field loss. (**RECOMMENDATION** / VERIFIED OTIO purpose)
5. **Nebula:** Default CUDA worker for proxy/render; inventory VRAM before locking local model set; do not depend on Windows Nebula availability. (**RECOMMENDATION**)
6. **LOCAL/CLOUD:** State+edit+encode local; frontier gen cloud via Router; hybrid ASR/interp. (**RECOMMENDATION**)
7. **Router:** Category adapters, swappable, rights/privacy-aware; no single-vendor hardwire in `.hvsproj`. (**RECOMMENDATION**)
8. **Provenance:** Mandatory AssetProvenance on every asset in V1; evaluate C2PA export later. Never silent delete/overwrite. (**RECOMMENDATION**)
9. **War Room:** Hard module boundaries; typed interfaces to Council/Terra/Foundry/WRIM/Research/Memory. (**RECOMMENDATION**)
10. **UI (Domain 34):** Left media / center dual-monitor viewer / right inspector / bottom tracks timeline / AI Director panel; **keep seven top tabs** with thin CREATE/AUDIO/COLOR bodies in V1; never drop DELIVER or GENERATE. (**RECOMMENDATION**)
11. **First build slice (reaffirm MASTER §26):** `.hvsproj` v0 + EditCommandLayer + FFmpeg proxy/render + Router stubs + STARRDOM path — **before** OpenFX host, OCIO full, Blender/Natron, full Media Intelligence. (**RECOMMENDATION**)

---

## 3. SOURCES

### Official / primary
1. FFmpeg License and Legal — https://www.ffmpeg.org/legal.html  
2. FFmpeg LICENSE.md — https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md  
3. NVIDIA Using FFmpeg with NVIDIA GPU HW Acceleration (Video Codec SDK 13.1) — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html  
4. NVIDIA Video Codec SDK 13.1 index / Read Me / License — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/  
5. FFmpeg nv-codec-headers — https://github.com/FFmpeg/nv-codec-headers  
6. OpenTimelineIO Architecture — https://opentimelineio.readthedocs.io/en/latest/tutorials/architecture.html  
7. OpenTimelineIO GitHub (ASWF, Apache-2.0) — https://github.com/AcademySoftwareFoundation/OpenTimelineIO  
8. OpenFX GitHub (BSD-3) — https://github.com/AcademySoftwareFoundation/openfx  
9. OpenFX Core API — https://openfx.readthedocs.io/en/main/Reference/ofxCoreAPI.html  
10. OpenColorIO (ASWF, BSD-3) — https://github.com/AcademySoftwareFoundation/OpenColorIO  
11. GStreamer Editing Services — https://gstreamer.freedesktop.org/documentation/gst-editing-services/  
12. GStreamer licensing FAQ — https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html  
13. MLT copyright policy — https://mltframework.org/docs/copyrightpolicy/  
14. Blender License — https://www.blender.org/about/license/  
15. Natron (GPLv2) — https://github.com/NatronGitHub/Natron  
16. AMD AMF + FFmpeg — https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/FFmpeg-and-AMF-HW-Acceleration  
17. Intel Linux FFmpeg VAAPI/QSV — https://www.intel.com/content/www/us/en/developer/articles/technical/linux-ffmpeg-vaapi-qsv-installation-environment.html  
18. Khronos Vulkan Video coding — https://docs.vulkan.org/spec/latest/chapters/videocoding.html  
19. C2PA Specification (Content Credentials) — https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html  

### Internal seeds
20. `/home/box/higher-vision-studios/HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md` — §§9, 14–19, 25–27, War Room boundaries, CRITICAL Qs  
21. `/home/box/higher-vision-studios/HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md` — Domains 25–27, 29–33  
22. `/home/box/higher-vision-studios/HVS_8_WAVES.md` — Wave 7 scope + legal/hardware locks  
23. `/workspace/war-room-os-audit/docs/RESEARCH_ENGINE_ARCHITECTURE.md` — adapter/router separation analogy  
24. `/workspace/war-room-os-audit/docs/MASTER_OS_ROADMAP.md` — Nebula/WRIM lineage; module separation; WRIM not production  

---

## 4. OPEN QUESTIONS

1. Compose engine spike winner: custom+FFmpeg vs MLT vs GES — schedule and acceptance metrics?
2. `.hvsproj` V1: pure JSON vs JSON+SQLite asset index — size threshold for sidecar?
3. Can HVS redistribute an NVENC-enabled FFmpeg without `--enable-nonfree` / GPL flags for the shipping SKU?
4. ProRes / DNx encode on Linux for mezzanine — codec licensing and FFmpeg configure implications?
5. OpenFX host minimal subset for V2 (which suites mandatory) vs full Resolve-class host ambition?
6. Nebula Genesis exact GPU/VRAM/NVMe map — still unmeasured for model concurrency planning.
7. C2PA: sign exports in V2, or only store internal provenance indefinitely?
8. WRIM-as-Router-backend: gate behind `CURRENT_PRODUCTION_WRIM` — what is the promotion criterion so HVS never pretends WRIM exists early?
9. AMF on Linux: if Nebula is NVIDIA-only, drop AMF from V1 docs to reduce noise?
10. How do Provider Router cost/rights policies get Commander-approved defaults without hardcoding vendors?
11. Preview ticket storage retention / eviction vs render-cache — ops policy?
12. Cross-agent typed handoff schema shared with Research Engine vs HVS-specific EditPlan DTO for Council?
13. Domain 34: ship all seven top tabs in chrome V1, or slim AUDIO+COLOR into EDIT drawers until V2?
14. Dual Source|Program monitors mandatory in SLICE-0, or Program-only with Source as fast-follow?
15. AI Director panel docked right-below-inspector vs floating / bottom-sheet on narrow War Room layouts?

---



---

## EVIDENCE — License pins (OpenFX / OTIO / FFmpeg) — 2026-09-20

**Lane:** Avenger Evidence · Research only · Primary sources fetched this turn  
**Canonical Wave 7 domains (HVS_8_WAVES):** 25, 27, 29–34 · Domain 26 design = WAVE_6 · FFmpeg license pins restated here for redistribution continuity only

### Pin table

| Component | SPDX / terms | Role for HVS | Redistribute in product? | Primary source |
|---|---|---|---|---|
| **OpenFX** (ASWF `openfx`) | **BSD-3-Clause** (`SPDX-License-Identifier: BSD-3-Clause` in Support/LICENSE; LICENSE.md © 2025) | V2+ OFX host / plugin ABI — not Adobe/FCP packs | YES (BSD-3 notices) | https://github.com/AcademySoftwareFoundation/openfx/blob/main/LICENSE.md · Support/LICENSE · openeffects.org |
| **OpenTimelineIO** | **Apache-2.0** (LICENSE.txt = Apache License Version 2.0) | Interchange only — **not** `.hvsproj` SoT; not a media container | YES (Apache notices + NOTICE) | https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/LICENSE.txt · docs: editorial cut interchange, external media refs |
| **FFmpeg core** | **LGPL v2.1+** default (most files); optional MIT/BSD-style parts still under LGPL umbrella for combination | Decode/encode/proxy/filter media plane | YES **if** configure omits GPL/nonfree and LGPL compliance checklist followed | https://www.ffmpeg.org/legal.html · https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md |
| **FFmpeg + `--enable-gpl`** | Entire build becomes **GPL v2+** | Needed for libx264 / libx265 / many GPL filters (LICENSE.md Compatible libraries list) | Only if HVS accepts GPL obligations for that binary SKU — counsel | LICENSE.md “Compatible libraries” |
| **FFmpeg + `--enable-nonfree`** | Resulting binary **unredistributable** (FFmpeg LICENSE.md) | FDK AAC, OpenSSL-as-nonfree path, libnpp/CUDA NPP-class, other incompatible libs | **REFUSE for shipping installer** | LICENSE.md “Incompatible libraries”; legal.html checklist item 1 |
| **libx264 / libx265** | GPL v2 (as linked into FFmpeg) | Software H.264/HEVC encode | Forces `--enable-gpl` → GPL FFmpeg | LICENSE.md Compatible libraries |
| **NVIDIA NVENC via FFmpeg** | Video Codec SDK 13.1 documents FFmpeg+NVENC; sample `./configure` lines often include **`--enable-nonfree`**; docs also note CUDA NPP deprecated / avoid `--enable-libnpp` for CUDA >12.8 | Nebula **operator** encode path | Product redistributable SKU must **not** ship nonfree build; operator-local NVENC toolchain OK; open: confirm NVENC-only build without `--enable-nonfree` | https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html |
| **OCIO** (adjacent) | ASWF OpenColorIO — commonly **BSD-3** (confirm NOTICE at integrate time) | Looks / ACES (Wave 6) | YES with notices | github.com/AcademySoftwareFoundation/OpenColorIO |
| **MLT** (compose eval) | Framework **LGPLv2.1**; melt tools GPL; modules vary | Optional compose spike only | Per-module audit | https://mltframework.org/docs/copyrightpolicy/ |
| **Natron / Blender** | GPLv2 / GPL | OFX host / DCC | **Subprocess only** — do not link into proprietary core | Natron GitHub · blender.org/about/license |

### FFmpeg LGPL ship checklist (VERIFIED — ffmpeg.org/legal.html)

1. Compile **without** `--enable-gpl` and **without** `--enable-nonfree`.
2. Prefer **dynamic linking** to FFmpeg libs.
3. Ship corresponding FFmpeg source (+ exact changes).
4. Website / About / EULA attribution for LGPLv2.1.

### Locks (Evidence → Blind Spot / Legal)

- Product installer FFmpeg = **LGPL posture** → failure `NONFREE_FFMPEG_SHIPPED` if `--enable-nonfree` redistributed.
- Software H.264/HEVC via **libx264/libx265** = GPL FFmpeg SKU or use alternative encoders / system libs — do not silently claim “LGPL FFmpeg + x264”.
- OpenFX = **BSD-3** OK for V2 host; third-party OFX plugs = **per-plugin SPDX** (never assume BSD).
- OTIO = **Apache-2.0** interchange; `.hvsproj` remains SoT.
- NVIDIA guide showing `--enable-nonfree` ≠ permission to redistribute that binary.

### Failures to stamp

`NONFREE_FFMPEG_SHIPPED` · `GPL_X264_CLAIMED_LGPL` · `OTIO_AS_SOT` · `OFX_PLUGIN_LICENSE_UNCHECKED` · `ADOBE_PLUGIN_AS_HVS_SOT`

*Evidence Wave 7 license pins. Research ≠ shipped. Counsel for commercial redistribution.*

## WAVE 7 STAMP

**WAVE_7 DONE | READY FOR WAVE 8**

- Status: RESEARCH COMPLETE — Domains **25, 27, 29–34** stamped (Domain **26** deferred to WAVE_6)
- Domain 34 UI: left media / center viewer / right inspector / bottom timeline / AI Director; **keep 7 tabs** (thin CREATE/AUDIO/COLOR in V1; never drop DELIVER/GENERATE)
- Evidence license pins: OpenFX BSD-3 · OTIO Apache-2.0 · FFmpeg LGPL / GPL / nonfree
- OTIO = interchange not SoT; `.hvsproj` = internal SoT
- OpenFX = V2+ boundary; FFmpeg+NVENC media plane owned by WAVE_6 (pointers only here)
- Classification: VERIFIED / PROPOSED / FUTURE separated
- Builds: HOLD — research ≠ shipped
- Next: Wave 8 inventory + roadmap + MASTER REPORT fold

---

## Historian densify — Domain 33 War Room module boundaries (2026-09-20)

**Owner:** Avenger Historian · RESEARCH ONLY  
**Supplements §1.8** — Media Player was under-specified in the seed table.

### Module map (HARD — no merge)

| Module | Owns | Must NOT absorb into HVS | Typed handoff only |
|---|---|---|---|
| **Higher Vision Studios** | NLE + ThemeSpec + EditOps + CameraSpec + Provider Router + Client Work + render | — | Outbound EditPlan / provenance to Council; optional location deep-link later |
| **Media Player** | Radio/news/podcasts/CAP duck/scanners LINK-OUT; howler→hls.js→mpv; VERIFIED+streamUrl; no autoplay; STREAM_ONLY\|LINK_OUT\|HOLD\|REFUSE | Radio densify pins; scanner scrape REFUSE; CAP duck policy | Shared *licenseClass concept* only — not shared player stack |
| **Terra / God’s Eye** | Globe, geocode, traffic cams, weather layers | Exact-address JUMP research; Cesium framing | Optional later place-id for location ads — Terra ≠ NLE |
| **Council** | Reasoning / synthesis | Timeline SoT / EditOp log | Opt-in receive HVS plans; Observed≠Generated≠Commander |
| **Foundry** | Build/forge tooling | HVS UI/timeline | May emit artifacts HVS consumes |
| **WRIM** | Native model lineage (FUTURE) | Third-party models relabeled as WRIM | Optional Router backend when production WRIM exists |
| **Research Engine** | Evidence adapters | Scrape paths inside HVS | HVS calls Research contracts — no duplicate scrapers |
| **Memory** | Commander/ops memory | Silent merge of production assets | Provenance stays in HVS Media Library; Memory via proposal gates |

### Densify inheritance (≠ merge)

From Media densify Waves 1–6 (DONE/held): provenance · research≠shipped · no scrape · no invent VERIFIED · REFUSE TuneIn/Broadcastify ingest. **Do not** reopen densify REFUSE lists or fold Ohio radio tables into HVS Media Library.

### Historian traps

1. Word **“media”** → wrong module.
2. Terra cameras / OHGO → sold as HVS multicam (Wave 3 A≠B≠C).
3. Media Player howler stack → reused as HVS preview (different job).
4. Creating HVS2/Council2 duplicates.
5. Treating stamped research or cancelled builds as shipped (exact-address lineage).

### Locks

HVS = **major native War Room section**. Boundaries hard. Typed interfaces only. Research ≠ shipped.

*Historian lane — Avenger Historian.*

---

## Blind Spot challenge — provider lock-in · scrape REFUSE · fake-local (Avenger Blind Spot)

**Lane:** Avenger Blind Spot · RESEARCH ONLY · 2026-09-20 · Domains 25, 27, 29–34

### Absorb
- Single-provider lock-in **REFUSE** — Router = swappable adapters; `.hvsproj` stores category + AssetRef + hash, **not** hard-wired vendor IDs as SoR
- CapCut/Adobe/CDN **scrape REFUSE**; no duplicate Research scrapers inside HVS
- FFmpeg: LGPL product ship · GPL x264 honesty · nonfree = operator-only (Evidence pins)
- OTIO = interchange ≠ SoT; `.hvsproj` = SoT
- HVS ≠ Media Player ≠ Terra (Historian hard map)
- Gen OFF for V1 slim; masters local; cloud gen = Router optional
- research≠shipped; cancelled builds ≠ product

### Challenges

| Trap | Severity | Challenge |
|---|---|---|
| **Provider hardwire in `.hvsproj`** | CRITICAL | Storing only `runway://…` without portable AssetRef + content hash = lock-in. Router must resolve category→adapter; swap vendor without rewrite SoT. |
| **Fake-local** | HIGH | UI “Local” while bytes only in vendor cloud = lie. Label `LOCAL` / `HYBRID` / `CLOUD` honestly; V1 masters must exist on disk with hash. |
| **Scrape / RE / CDN dumps** | CRITICAL | CapCut/Adobe materials, Media Player scanner paths, Research scrapers inside HVS = REFUSE. Call Research contracts; LINK-OUT where class requires. |
| **WRIM relabel** | HIGH | Third-party models branded as WRIM while production WRIM NOT_IMPLEMENTED = fake-fill. Gate behind real production WRIM. |
| **Media / Terra merge by word** | HIGH | “media” ≠ Media Player; Terra cams ≠ HVS multicam; howler ≠ HVS preview. |
| **GPL claimed LGPL** | CRITICAL | libx264/libx265 force `--enable-gpl` — never market as LGPL-only binary. |
| **Nonfree in installer** | CRITICAL | NVIDIA sample configure with `--enable-nonfree` ≠ redistribution license. |
| **OFX SPDX skip** | MEDIUM | Unknown plugin license = HOLD. |
| **Windows Nebula as sole GPU** | MEDIUM | Prefer Nebula Linux CUDA; Windows often offline — not architecture SoR. |
| **Invented Nebula VRAM** | MEDIUM | Exact SKU unmeasured — measure before promising local T2V/sovereignty. |
| **Kitchen-sink Wave 7** | HIGH | OpenFX host / full OCIO / Blender = V2+; V1 = `.hvsproj` + EditOps + LGPL proxy/render + Router stubs. |
| **Provenance theater** | HIGH | Missing consent_id / commercial_ok / training_opt_out / AI_GENERATED = incomplete Client Work path. |

### Failure classes

`SINGLE_PROVIDER_HARDWIRE` · `FAKE_LOCAL` · `CDN_SCRAPE` · `RESEARCH_SCRAPER_IN_HVS` · `WRIM_RELABEL` · `MODULE_MERGE_BY_WORD` · `GPL_X264_CLAIMED_LGPL` · `NONFREE_FFMPEG_SHIPPED` · `OFX_SPDX_UNKNOWN` · `OTIO_AS_SOT` · `INVENTED_VRAM` · `PROVENANCE_THEATER` · `RESEARCH_SOLD_AS_SHIPPED`

### RECOMMENDATION
1. Router registry by **category** + rights/privacy/budget — never CapCut/Sora/single cloud as SoR.  
2. Every cloud output → local AssetRef + hash before timeline commit.  
3. Boundaries: typed handoffs only; no Media Player/Terra absorb.  
4. Ship license matrix in installer docs (LGPL vs operator NVENC).  
5. Wave 8: honest V1 slim vs STARRDOM/full Router path.

**Lane Blind Spot Wave 7 done for fold.**


---

## Engineer stamp — `.hvsproj` · Provider Router · Nebula hardware map (Avenger Engineer)

**Lane:** Avenger Engineer · RESEARCH ONLY · 2026-09-20 · Domains 27, 29–32 (+ 25/34 pointers)  
**Absorb:** Evidence license pins · Historian WR hard map · Blind Spot lock-in/fake-local · Wave 6 encode dual-path · Legal Domain 32

### 1. `.hvsproj` v0 sketch (PROPOSED — SoT; OTIO ≠ SoT)

```text
HvsProject {
  schemaVersion: "hvs.proj.v0"
  projectId, name, createdAt, updatedAt
  settings: { timebase, workingColorSpace?, defaultAspects[] }
  bins: Bin[]                    # media organization
  assets: AssetRef[]             # contentHash, uri(local), class LOCAL|HYBRID|CLOUD_ORIGIN
  sequences: Sequence[]          # tracks = authoring truth (Wave 1 hybrid)
  themes: ThemeSpecId[]          # refs only — packs live in theme library
  versions: VersionNode[]        # AI FIRST CUT = new node; v1 untouched
  editLogUri: string             # hvs.edit.v1 transaction log (Wave 4)
  provenanceIndexUri?: string
  rights: { clientAgreementId?, trainingOptOutDefault: true }
}
AssetRef {
  assetId, contentHash, mime, duration?
  sourceClass: client_upload|recorded|generated|stock|derived
  storage: { kind: LOCAL|NAS, path }
  origin?: { category, providerId?, model?, jobId? }  # NEVER sole open key
  provenance: {
    licenseClass: OWNABLE|STREAM_ONLY|REQUIRE_AUTH|REFUSE
    commercialOk, consentId?, trainingOptOut, AI_GENERATED?,
    tool, toolVersion, tosArchiveRef?, parentAssetIds[]
  }
}
```

**Rules:** Open project by AssetRef + hash, not vendor URL alone. OTIO export = lossy interchange. CapCut/Premiere/FCP/Resolve project files ≠ SoT. JSON V1; SQLite asset index = FUTURE if scale needs.

### 2. Provider Router registry (PROPOSED — densify Wave 5/§1.6)

```text
RouterRegistry {
  adapters: AdapterDesc[]   # category + providerId + models + rightsAxes
  policy: { paidCommercialOnlyClient, archiveTosPdf, budgetCaps, privacyClass }
}
route(req: {
  category, hints, rightsPolicy, privacyClass, budget,
  previewTicketRequired: true
}) → Adapter.execute → local AssetRef(+hash) → EditOp insert|replace
```

| V1 | ON | OFF / FUTURE |
|---|---|---|
| STT captions (optional) | ElevenLabs / local Whisper-class | — |
| Encode | LGPL FFmpeg local; NVENC operator | nonfree in installer |
| VIDEO/IMAGE gen | — | OFF until past V1 slim |
| Sora | — | **UNAVAILABLE** — exclude |
| CapCut | — | **REFUSE** as adapter |
| Avatar/lip-sync | — | FUTURE; ≠ STARRDOM photo hero |

**Anti-lock-in:** category binding in SoT; adapter id only on provenance.origin. Aggregator catalogs ≠ hardwire. No Research scrapers inside HVS.

### 3. Nebula Linux hardware map (PROPOSED — no invented VRAM)

| Role | Target | Notes |
|---|---|---|
| Default CUDA worker | Nebula Linux (`153e10ec` preferred per Commander) | Proxy/scrub/track/ASR — **measure** `nvidia-smi` before model promises |
| Windows Nebula | Optional / often offline | **Not** sole GPU path |
| Product encode | LGPL FFmpeg (x264 honesty = GPL configure if used) | Document license matrix |
| Operator encode | NVENC toolchain local | Not redistributable nonfree ship |
| Storage | NVMe originals+proxies; NAS archive | Masters on disk before “done” |
| Local ML realistic | Whisper / SAM2-class / embeddings | **Not** frontier T2V — Blind Spot `INVENTED_VRAM` |

**LOCAL / HYBRID / CLOUD labels mandatory in UI** (no fake-local).

### 4. Domain 32 bake into first-build slice (Legal)

Client agreement before ingest · paid commercial tiers · provenance fields required on AssetRef · beauty OFF · AI_GENERATED never labeled photo · REFUSE celeb/politician clones + minors commercial likeness default · talent + AI-replica consent separate.

### 5. V1 first-build affirmation (research — not implement)

`.hvsproj` v0 + `hvs.edit.v1` + LGPL proxy/render + Router stubs (STT optional) + ThemeSpec thin + WR UI shell — **before** OpenFX host, full OCIO, Blender/Natron, gen Router spend, Media Player/Terra merge.

### Failure classes

`VENDOR_URL_AS_SOT` · `OTIO_AS_SOT` · `SINGLE_PROVIDER_HARDWIRE` · `FAKE_LOCAL` · `INVENTED_VRAM` · `NONFREE_FFMPEG_SHIPPED` · `MODULE_MERGE_BY_WORD` · `RESEARCH_SOLD_AS_SHIPPED`

**Lane Engineer Wave 7 done for fold.** Research ≠ shipped. Builds HOLD.

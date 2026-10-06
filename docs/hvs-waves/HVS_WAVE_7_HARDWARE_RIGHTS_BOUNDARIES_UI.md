# HIGHER VISION STUDIOS — WAVE 7
# Hardware / Rights / War Room Boundaries / UI
# Domains: 25, 27 (residual), 29–34 · Domain 26 = WAVE_6 (pointers only)
# Date: Sunday Sep 20, 2026 (America/New_York, EDT)
# Mode: RESEARCH ONLY — VERIFIED / PROPOSED / FUTURE / REFUSE
# Owners: Engineer + Legal locks + Historian boundaries + UI (Domain 34)
# Canonical map: HVS_8_WAVES_PLAN.md Wave 7
# PA2 stamp fold: /home/box/higher-vision-studios/waves/WAVE_7.md (prefer deepen; conflicts labeled)

Label legend:
- **VERIFIED** — grounded in official docs/repos cited in Sources
- **PROPOSED** — HVS design recommendation (not an existing product API)
- **FUTURE** — deferred / experimental / not required for V1
- **REFUSE** — hard no
Claim tags: VERIFIED FACT | VENDOR CLAIM | INFERENCE | RECOMMENDATION

Locks carried from HVS_8_WAVES_PLAN + Waves 1–6:
- OTIO Apache-2.0; FFmpeg LGPL preferred; provenance per asset
- Nebula Linux CUDA `machineId 153e10ec-c150-4a0e-b21e-d01ccfbe33d6` primary; Windows Nebula secondary/PARTIAL
- Never hardwire one vendor; paid commercial tiers for client work; client agreement before ingest
- HVS ≠ Media Player ≠ Terra ≠ Council; no CapCut/Adobe scrape; beauty OFF by default; madmom NC models REFUSE (Wave 6)
- research ≠ shipped; Builds HOLD

**Attribution:** Sections deepen PA2 WAVE_7 + Waves 1–6. Where PA executor densifies beyond PA2, tagged **[PA executor]**. Where PA2 already stamped a lock, tagged **[PA2]** — do not overwrite; keep both if conflict.

---

## 0. EXECUTIVE LOCKS (Wave 7)

1. **Hardware:** Author UI may run on any War Room client; **heavy CUDA/NVENC/ML workers = Nebula Linux `153e10ec…`**. Windows Nebula `37425d23…` = secondary/PARTIAL (often offline). Realtime 4K subject-follow = **HOLD** until byte-proven VRAM+fps. **[PA executor + Wave 1/3]**
2. **Local / cloud / hybrid:** Observed local-first (project state, masters, proxies). Provider Router for frontier gen. No single-cloud lock-in. **[PA2 + Wave 5]**
3. **Plugins:** Own EffectGraph + ThemePack packs V1; OpenFX host V2+; refuse Adobe/FCP/CapCut plugin formats as SoT. **[PA2]**
4. **Rights:** Asset content-hash + license tags + talent/replica consent + client footage contracts + provider ToS retention archive. Internal provenance V1; C2PA export evaluate V2+. **[PA2 + Wave 5]**
5. **Boundaries:** COMMANDER → WAR ROOM → HVS (section) · Council / Terra / Media Player / Foundry / WRIM / Research / Memory = typed handoffs only. HVS may send **opt-in packets** to Council — never give Council timeline SoT. **[PA executor + PA2 Historian densify]**
6. **UI:** Markdown wireframe — left rail / center viewer / right inspector / bottom timeline / AI Director; seven top tabs (thin CREATE/AUDIO/COLOR V1). Not CapCut pastel; not Adobe chrome clone. **[PA2 Domain 34]**
7. **Risks:** LGPL vs NVENC redistrib · madmom NC · deepfake liability · provider URL vanish (Wave 2/5) · fake-local · WRIM relabel.

---

## 1. Domain 25 — Plugin / Extension System

### 1.1 VERIFIED — OpenFX (ASWF)

- OpenFX = open **image-processing** plug-in standard (host ↔ plugin). Repo: Academy Software Foundation `openfx` — **BSD-3-Clause**.
- Host loads plugin binaries; suites via `OfxHost::fetchSuite` (no hard symbolic host dependency).
- Scope = image effects — **not** a full NLE project format, not Adobe/FCP proprietary effect packages.

Sources: https://github.com/AcademySoftwareFoundation/openfx · https://openfx.readthedocs.io/en/main/Reference/ofxCoreAPI.html · https://openeffects.org/

### 1.2 Extension capability classes (PROPOSED HVS)

| Concept | Role | HVS stance | Version |
|---|---|---|---|
| HVS EffectGraph nodes | Thin looks/filters/transitions | **BUILD** | V1 |
| **ThemePack** packs | First-class creative packs (Wave 2) | **BUILD** — not CapCut templates | V1 |
| FFmpeg filters | Media-plane process graph | **INTEGRATE** | V1 |
| Provider Router adapters | AI cloud/local generators | **BUILD** (Domain 31) | V1 stubs |
| OpenFX bridge | Load OFX plugs into graph leaves | **INTEGRATE host** | **V2+** |
| Analyzer plugins | Quality / embeddings (sandboxed) | **BUILD** | V2–V3 |
| Exporter plugins | YouTube/social/ProRes later | **BUILD** | V1 thin / V2 |
| WASM sandboxed analyzers | Isolation | **FUTURE** | — |
| Adobe / FCP / Resolve plugin SDKs | Proprietary | **REFUSE as SoT** | — |

### 1.3 PROPOSED HVS Extension Host sketch

```
HVS Extension Host (own ABI — not Adobe/FCP/CapCut)
 ├── EffectGraph nodes (V1 thin looks/filters/transitions)
 ├── ThemePack loader (versioned local packs + provenance)
 ├── OpenFX bridge (V2) — OFX → graph leaves
 ├── Analyzer plugins (quality, embeddings) — sandboxed process
 ├── Exporter plugins (platform presets)
 └── Provider adapters (Router) — separate process/network trust zone
```

**GPL isolation [PA2]:** Natron = GPLv2 OpenFX host; Blender = GPL. Prefer **subprocess** later; do not link GPL hosts into proprietary HVS core without counsel.

**ThemePack as first-class packs [PA executor]:** ThemePack is not a “filter list item” — it is a **pack** (typography, caption_style, look/ocio ref, transitions, music slots, logo, aspect presets) with version + license + hash. Lives under Extension Host as owned creative packs, parallel to EffectGraph — CapCut templates = prior art only (Wave 2).

---

## 2. Domain 26 — Render / Cache / Proxy (**DEFER TO WAVE_6**)

**Ownership lock [PA2]:** Domain 26 stamped in `HVS_WAVE_6_AUDIO_COLOR_VFX_RENDER.md`. Wave 7 does **not** re-own encode/proxy/cache design.

| Topic | Wave 6 locus | Wave 7 infra touch |
|---|---|---|
| FFmpeg + NVENC; LGPL-prefer; refuse redistributable `--enable-nonfree` | WAVE_6 Domain 26 | License pins §9 + Domain 29 GPU |
| Proxy / thumbs / render-cache / PreviewTickets | WAVE_6 | Storage map Domain 29; Router delivery Domain 31 |
| Compose spike (custom+FFmpeg vs MLT vs GES) | WAVE_6 + MASTER §25 | Infra affirmation only |

---

## 3. Domain 27 — Project Format (residual)

### 3.1 VERIFIED — OpenTimelineIO (ASWF, Apache-2.0)

- OTIO = API + interchange for **editorial cut information** — **not** a media container.
- Structure: `Timeline` → `tracks` (`Stack`) → `Track` → `Clip` / `Gap` / `Transition`.
- Media external (`ExternalReference` / `MissingReference`); `.otio` via `otio_json`; metadata dict ≠ HVS undo/AI provenance stores.

Sources: https://opentimelineio.readthedocs.io/en/latest/tutorials/architecture.html · https://github.com/AcademySoftwareFoundation/OpenTimelineIO

### 3.2 PROPOSED internal SoT: `.hvsproj`

- Inspectable JSON (V1) ± SQLite sidecar for asset index if scale demands.
- Must be: deterministic, versionable, migratable, AI-readable, UI-editable, non-destructive, provenance-aware.
- Stores: sequences, tracks, clips, media refs, effect stacks, **ThemePack binds**, markers, aspect variants, EditCommand history pointers, **rights/provenance IDs**, optional film metadata (ignored by V1 UI).
- **Must NOT** use CapCut / Premiere / Resolve / FCP project files as SoR.

| Role | Choice | Label |
|---|---|---|
| Internal SoT | `.hvsproj` | PROPOSED |
| Cut interchange | OTIO | VERIFIED purpose + RECOMMENDATION |
| EDL / FCPXML / AAF | Later adapters; expect loss | FUTURE / PARTIAL |
| CapCut / Adobe project as SoR | — | **REFUSE** |

**Round-trip loss:** OTIO export may drop ThemePack binds, full EditOp history, Character Bible links, consent IDs — document lossiness. Failure class: `OTIO_AS_SOT`.

---

## 4. Domain 29 — Hardware (Linux + Nebula)

### 4.1 Live hosts (VERIFIED CURRENT — War Room inventory, Wave 1)

| Host | machineId | Role | Status |
|---|---|---|---|
| **Nebula Linux** | `153e10ec-c150-4a0e-b21e-d01ccfbe33d6` | Primary CUDA/NVENC worker path | VERIFIED live host |
| **Nebula Windows** | `37425d23-1052-424f-b188-f060ca03150f` | Secondary; often offline; WSL2 CUDA PARTIAL | VERIFIED secondary |

Exact GPU SKU / VRAM / NVMe map = **UNMEASURED** this wave — do not invent. Size proxies and local models after `nvidia-smi`-class inventory. Failure: `INVENTED_VRAM`.

### 4.2 Author UI vs heavy workers (PROPOSED) **[PA executor densify of Wave 1 §6.3]**

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│ AUTHOR SURFACE (any client) │  jobs   │ HEAVY WORKERS (Nebula Linux)     │
│ · HVS UI / EditOps authoring│ ──────► │ · FFmpeg proxy / NVENC encode    │
│ · Inspector / AI Director   │ ◄────── │ · SAM2 TrackSubject / mattes     │
│ · Router request compose    │ results │ · PreviewTicket / render queue   │
│ · Rights / consent forms    │         │ · Optional local ASR / embeddings│
└─────────────────────────────┘         └──────────────────────────────────┘
         │                                           │
         └──── .hvsproj + AssetRef + hashes ─────────┘
```

- **Do not** require the authoring browser/desktop to hold the GPU.
- **Do not** treat offline Windows Nebula as architecture SoR.
- Wire format between UI and workers: EditOps + media refs (OTIO-compatible cuts + HVS provenance).

### 4.3 Storage map (PROPOSED)

| Store | Medium | Notes |
|---|---|---|
| Originals / Observed masters | NVMe and/or NAS | Immutable; content-hash |
| Proxies / thumbs / render cache | Local NVMe | Evictable |
| Embeddings / model weights | NVMe | V2+ Media Intelligence |
| Generated media | NVMe + provenance DB | Router outputs downloaded before timeline |
| Masters / delivers | NVMe → archive policy | Never auto-delete sources |
| ThemePack packs | Local versioned store | Cloud-asset vanish risk (Wave 2) |

### 4.4 Local models realistic on Nebula (INFERENCE — hardware-dependent)

| Class | Candidate class | V1–V4 note |
|---|---|---|
| ASR | Whisper-class | HYBRID OK |
| Segmentation / tracking | SAM2-class (Wave 3 Apache-2.0) | LOCAL preferred |
| Embeddings | CLIP / OpenCLIP-class | V2+ |
| Small image tools | Local or Router | HYBRID |
| Frontier T2V | — | **Not** assumed local parity — CLOUD Router |

**HOLD:** Realtime 4K interactive subject-follow until byte-proven on `153e10ec` GPU. Proxy-first follow = PROPOSED until then (Wave 3).

### 4.5 Linux component matrix (continuity Wave 1)

| Component | License | Linux | HVS role |
|---|---|---|---|
| OTIO | Apache-2.0 | Yes | Interchange (not SoT) |
| FFmpeg | LGPL 2.1+ discipline | Yes | Render/proxy |
| OpenFX | BSD-3-Clause | Host-dep. | V2+ plugins |
| OCIO | BSD-3 (confirm NOTICE) | Yes | Looks / ACES (Wave 6) |
| SAM2 | Apache-2.0 | Yes | TrackSubject |
| Resolve | Proprietary | Official | Optional interop |
| FCP / Premiere / AE / CapCut desktop | Proprietary | No | Prior art only |

**Blockers to avoid:** Apple-only encode; CapCut dependency; AMF-only path; Windows-Nebula-as-sole-GPU; linking GPL DCC into core; invented VRAM claims.

---

## 5. Domain 30 — LOCAL / CLOUD / HYBRID

**Doctrine:** War Room owns orchestration + project state. Providers supply generation. Adapters replaceable. Sovereign-now vs frontier-cloud is **per-capability**, not a slogan.

| Capability | Class | Notes |
|---|---|---|
| Timeline, `.hvsproj`, undo/version | **LOCAL** | War Room owns state |
| Proxy / preview / final encode (NVENC) | **LOCAL** | Nebula Linux GPU |
| Themes / looks / caption styling | **LOCAL** | Owned ThemePack assets |
| Subject track / basic reframe | **LOCAL** (hybrid CV optional) | SAM2 stack |
| ASR / captions | **HYBRID** | Whisper-class or cloud |
| TTS / VO / music / SFX gen | **HYBRID / CLOUD-first** | Router |
| T2V / I2V / beauty B-roll | **CLOUD-first** | Router; local optional later |
| Upscale / interpolation | **HYBRID** | FFmpeg local + Router neural |
| OpenFX host | **LOCAL** (V2) | Plugin binaries on box |
| Research for ad concept | **War Room Research Engine** | Do not merge into HVS |
| Gen OFF for V1 slim | **LOCAL masters** | Cloud gen = optional later path |

**Anti fake-local [PA2 Blind Spot]:** UI must not label “Local” when bytes exist only in vendor cloud. Every cloud output → download → local AssetRef + content-hash **before** timeline commit. Failure: `FAKE_LOCAL`.

---

## 6. Domain 31 — Media Provider Router (continuity Wave 5)

**PROPOSED categories:**  
`VIDEO_GENERATOR` · `IMAGE_GENERATOR` · `IMAGE_EDITOR` · `VOICE` · `TTS` · `MUSIC` · `SFX` · `LIP_SYNC` · `UPSCALE` · `INTERPOLATION` · `TRANSCRIPTION` · `TRANSLATION` · `MOTION_TRANSFER`

**Selection axes:** capability, quality, latency, cost, rights, privacy, resolution, duration, character consistency, camera control, reference support, local/cloud, availability.

```
RouterRequest { category, capabilityHints, rightsPolicy, privacyClass, budget }
  → Adapter.select()
  → Adapter.execute() → AssetRef + ProvenanceRecord
  → Media Library ingest (hash) → EditCommand insert/replace
```

**Never** persist a single vendor id as the only way to open a project. `.hvsproj` stores category + AssetRef + hash — not “only Runway timeline objects.” Failure: `SINGLE_PROVIDER_HARDWIRE`.

**Sora:** DEAD/UNAVAILABLE (shutdown 2026-09-24) — exclude from Router defaults (Wave 5).

Pattern analogy: Research Engine adapter/registry separation — organizational only; HVS Router ≠ Research scrapers. **REFUSE** CapCut/Adobe scrape paths inside HVS.

---

## 7. Domain 32 — Rights / Provenance

### 7.1 PROPOSED AssetProvenance record (per asset)

| Field | Purpose |
|---|---|
| `content_hash` | SHA-class integrity; Observed lock |
| `source_class` | `client_upload` \| `recorded` \| `generated` \| `stock` \| `derived` |
| `client_id` / `project_id` | Client Work binding |
| `provider` / `model_id` | Router adapter identity (swappable) |
| `prompt` / `params` / `refs` | Generation audit |
| `parent_asset_ids` | Derivation chain |
| `license_tag` | SPDX or contract class |
| `commercial_ok` | Paid commercial tier gate |
| `consent_id` / `release_id` | Talent / replica / likeness |
| `training_opt_out` | Where provider ToS exposes |
| `ai_generated` flag | Disclosure |
| `provider_tos_archive_ref` | Snapshot of ToS at job time |
| `timestamps` / `timeline_usage_refs` | Audit |

### 7.2 Consent / contracts (PROPOSED — deepen Wave 5)

- **Client footage:** signed client agreement **before ingest** (lock from Waves plan).
- **Talent / replica:** Character Bible consent; refuse unauthorized deepfake of real people; beauty packs OFF by default.
- **Provider ToS:** archive retention policy per job (URL expiry: Veo ~2d, Luma ~1h — Wave 5) — download to Observed immediately.
- **ThemePack / stock:** license tags on pack + each embedded asset.

### 7.3 C2PA (VERIFIED standard to evaluate)

- **C2PA Content Credentials** v2.4 family (April 2026) — cryptographically signed manifests (actions, ingredients, bindings); includes AI-disclosure assertion class.
- **PROPOSED:** Internal provenance DB in **V1**; optional C2PA manifest attach on export in **V2+** after Legal review.
- **Do not** claim C2PA compliance until implemented and verified.

Source: https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html

Failure: `PROVENANCE_THEATER` — missing consent_id / commercial_ok / AI_GENERATED on Client Work path.

---

## 8. Domain 33 — War Room Boundaries

### 8.1 Chain of command (PROPOSED doctrine) **[PA executor]**

```
COMMANDER (Mark)
    → WAR ROOM (private AI OS)
        → HIGHER VISION STUDIOS   (major native SECTION — NLE + Router + Client Work)
        → Council                 (reasoning / synthesis)
        → Terra / God’s Eye       (world-state Oracle)
        → Media Player            (radio/news/stream densify — SEPARATE)
        → Foundry                 (build / forge)
        → WRIM                    (native model lineage — FUTURE)
        → Research Engine         (evidence adapters)
        → Memory                  (Commander / ops memory — gated)
```

**HVS ≠ Terra ≠ Media Player ≠ Council.** Word “media” must not collapse modules (Historian trap).

### 8.2 Module map (HARD — no merge) **[PA2 Historian densify + PA executor]**

| Module | Owns | Must NOT absorb into HVS | Handoff |
|---|---|---|---|
| **HVS** | NLE · ThemePack · EditOps · CameraSpec · Provider Router · Client Work · render | — | Outbound opt-in packets only |
| **Media Player** | Radio/news/podcasts/CAP duck/scanners LINK-OUT; howler→hls.js→mpv | Radio densify pins; scanner scrape REFUSE | Shared *licenseClass concept* only — not player stack |
| **Terra** | Globe, geocode, traffic cams, weather | Exact-address JUMP; Cesium framing | Optional later place-id for location ads — Terra ≠ NLE |
| **Council** | Reasoning / synthesis | Timeline SoT / EditOp log | **Opt-in receive** EditPlan / explain packets; Observed ≠ Generated ≠ Commander |
| **Foundry** | Build/forge tooling | HVS UI/timeline | May emit artifacts HVS consumes |
| **WRIM** | Native model lineage (FUTURE) | Third-party models relabeled WRIM | Optional Router backend when production WRIM exists |
| **Research Engine** | Evidence adapters | Scrape paths inside HVS | HVS calls Research contracts |
| **Memory** | Commander/ops memory | Silent merge of production assets | Provenance stays in HVS Media Library |

### 8.3 What HVS may send to Council (PROPOSED — opt-in only)

| Packet | Allowed? | Notes |
|---|---|---|
| EditPlan summary / explain strings | YES (opt-in) | Scenario-class; not SoT |
| Provenance rollup for a deliverable | YES (opt-in) | Redact secrets / PII per policy |
| Raw timeline SoT / EditOp log as Council-owned | **NO** | Council does not own timeline |
| Auto-push every AI draft | **NO** | Draft ≠ publish; human gate |
| CapCut/Adobe scraped materials | **NO** | REFUSE |
| Terra camera feeds as “HVS multicam” | **NO** | Wave 3 A≠B≠C |

### 8.4 Historian traps (carry forward)

1. Word “media” → wrong module.
2. Terra cameras / OHGO → sold as HVS multicam.
3. Media Player howler stack → reused as HVS preview.
4. Creating HVS2/Council2 duplicates.
5. Research or cancelled builds sold as shipped.
6. WRIM relabel of third-party models (`WRIM_RELABEL`).

---

## 9. Domain 34 — HVS UI Workspace (markdown wireframe)

**Identity (PROPOSED):** Cinematic + professional + War Room chrome — **not** CapCut pastel clone, **not** Adobe/FCP chrome copy. HVS ≠ Media Player ≠ Terra chrome.

### 9.1 Layout wireframe (PROPOSED — not a fake screenshot)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ WAR ROOM · HIGHER VISION STUDIOS                                             │
│ Top tabs: CREATE | EDIT | GENERATE | AUDIO | COLOR | EFFECTS | DELIVER       │
├──────────────┬──────────────────────────────────────────┬────────────────────┤
│ LEFT RAIL    │ CENTER VIEWER / CANVAS                   │ RIGHT INSPECTOR    │
│ Projects     │  Source | Program (dual-monitor V1+)     │ Clip / Effect      │
│ Media Lib    │  Multicam strip (V2)                     │ Theme / Look       │
│ Assets       │  AI PreviewTicket overlay                │ TrackSubject / Cam │
│ Effects      │                                          │ Provenance/Rights  │
│ Filters      ├──────────────────────────────────────────┤ Character Bible    │
│ Themes       │ BOTTOM: Timeline (tracks = SoR)          │                    │
│ Captions     │  V/A tracks · markers · versions · snap  │ AI DIRECTOR PANEL  │
│ Client Work  │                                          │ Modes · ops · explain│
└──────────────┴──────────────────────────────────────────┴────────────────────┘
```

### 9.2 Product-tree panel map (assignment Domain 34 ↔ UI)

| Product tree node | UI home | V1 body |
|---|---|---|
| Projects | Left rail + CREATE | Thin |
| Professional Editor | EDIT + timeline + monitors | **Primary** |
| Media Library | Left rail | Ingest + hashes |
| AI Director | Right panel | Typed ops — never tips-only |
| AI Video / Images | GENERATE tab | Router jobs + provenance |
| Storyboards / Scripts | CREATE | Stubs |
| Characters | Inspector + CREATE | Character Bible |
| Camera | Inspector (CameraSpec / Multicam separate) | Wave 3 locks |
| Effects / Filters / Themes | EFFECTS + left Themes | ThemePack first-class |
| Motion Graphics | EFFECTS (thin) | V2 deepen |
| Audio / Voice / Music | AUDIO tab | Thin V1 |
| Color | COLOR tab | Look strength V1; OCIO V2 |
| Client Work | Left + Rights inspector | Contracts / consent |
| Render / Delivery | DELIVER | Proxy status · aspects · Publish gate |

### 9.3 Top tabs — keep or slim? **[PA2]**

| Tab | V1 recommendation |
|---|---|
| CREATE | KEEP thin |
| EDIT | KEEP — primary; never slim |
| GENERATE | KEEP — first-class Router lane |
| AUDIO | KEEP thin (or EDIT drawer if cramped) |
| COLOR | KEEP label (Look strength V1) |
| EFFECTS | KEEP |
| DELIVER | KEEP — mandatory (Draft ≠ Publish) |

**RECOMMENDATION:** Ship seven tabs with thin CREATE/AUDIO/COLOR. If forced slim: keep EDIT · GENERATE · DELIVER. Never drop DELIVER or GENERATE.

### 9.4 Mandatory UI splits (Blind Spot — Waves 3–4)

| Control family | Must stay separate |
|---|---|
| Multicam Intelligence (A) | Real angle switch / sync |
| Generative CameraSpec (B) | Shot/movement intent → Router |
| Virtual Follow / Reframe (C) | TrackSubject → crop window |
| Tips vs Ops | `explain` ≠ committed `ops[]` |
| Draft vs Publish | FULL DRAFT never auto-publishes |

Control modes surface (schema owned Wave 4):  
MANUAL → AI ASSIST → AI SUGGEST → AI FIRST CUT → AI DIRECTOR → AUTOMATIC DRAFT — every meaningful AI edit visible, undoable, versioned, attributable, inspectable.

---

## 10. Risks / Licensing / Performance (Domain cross-cut)

### 10.1 License pin table (Evidence continuity) **[PA2 Evidence]**

| Component | SPDX / terms | Redistribute? | Source |
|---|---|---|---|
| OpenFX | BSD-3-Clause | YES (notices) | github.com/AcademySoftwareFoundation/openfx |
| OTIO | Apache-2.0 | YES (NOTICE) | github.com/AcademySoftwareFoundation/OpenTimelineIO |
| FFmpeg core | LGPL v2.1+ default | YES if no gpl/nonfree | ffmpeg.org/legal.html |
| FFmpeg `--enable-gpl` | GPL v2+ whole build | Only if counsel accepts SKU | FFmpeg LICENSE.md |
| FFmpeg `--enable-nonfree` | **Unredistributable** | **REFUSE installer** | LICENSE.md |
| NVENC via FFmpeg | SDK docs; sample configure often `--enable-nonfree` | Operator-local OK; ship SKU ≠ sample | docs.nvidia.com …/ffmpeg-with-nvidia-gpu/ |
| madmom pretrained models | **CC BY-NC-SA** | **REFUSE** commercial core (Wave 6) | github.com/CPJKU/madmom/blob/main/LICENSE |
| Natron / Blender | GPLv2 / GPL | Subprocess only | — |
| SAM2 | Apache-2.0 | YES (Wave 3) | — |

### 10.2 Risk register (Wave 7 densify + prior waves)

| Risk | Label | Action |
|---|---|---|
| Nonfree FFmpeg in redistributable installer | VERIFIED trap | LGPL ship checklist; failure `NONFREE_FFMPEG_SHIPPED` |
| libx264 claimed as LGPL-only | VERIFIED | Honesty or alternate encoder; `GPL_X264_CLAIMED_LGPL` |
| NVENC sample configure ≠ redistrib license | VERIFIED | Operator path vs product SKU |
| madmom NC models in commercial core | Wave 6 REFUSE | Prefer librosa ISC for V1 beat markers |
| CapCut/Adobe scrape | REFUSE | — |
| CapCut cloud asset vanish | Wave 2 VERIFIED | Local ThemePack versions |
| Provider URL expiry without download | Wave 5 VERIFIED | Mandatory Observed ingest |
| Single-provider lock-in | REFUSE | Router by category |
| Unauthorized deepfake / replica | REFUSE | Character Bible consent |
| Beauty default-ON | REFUSE | Opt-in |
| Fake-local cloud-only bytes | Blind Spot HIGH | Hash-on-disk before commit |
| Windows Nebula as sole GPU | MEDIUM | Prefer `153e10ec` Linux |
| Invented Nebula VRAM / 4K follow marketing | HOLD | Byte-prove first |
| WRIM relabel | HIGH | Gate on production WRIM |
| Module merge by word “media” | HIGH | Historian map |
| OTIO as SoT | REFUSE | `.hvsproj` SoT |
| Provider vanish / ToS change | VERIFIED class | ToS archive + swappable adapters |
| Deepfake liability / Client Work without contract | Legal HIGH | Agreement before ingest |
| OpenFX plugin unknown SPDX | MEDIUM | HOLD until audited |

### 10.3 FFmpeg LGPL ship checklist (VERIFIED — ffmpeg.org/legal.html)

1. Compile **without** `--enable-gpl` and **without** `--enable-nonfree`.
2. Prefer **dynamic linking** to FFmpeg libs.
3. Ship corresponding FFmpeg source (+ exact changes).
4. Website / About / EULA attribution for LGPLv2.1.

---

## 11. Recommendations (Wave 7)

1. **Plugin boundary:** EffectGraph + ThemePack V1; OpenFX host V2; refuse proprietary plugin SoT; GPL DCC = subprocess.  
2. **Hardware:** Nebula Linux `153e10ec…` = primary CUDA/NVENC workers; author UI split; Windows secondary; HOLD 4K follow.  
3. **LOCAL/CLOUD:** State+edit+encode local; frontier gen via Router; honest labels.  
4. **Router:** Category adapters; no vendor hardwire in `.hvsproj`.  
5. **Provenance:** Mandatory AssetProvenance + hashes V1; C2PA export evaluate V2+.  
6. **Boundaries:** COMMANDER→WAR ROOM→sections; opt-in Council packets only; HVS ≠ Terra ≠ Media Player ≠ Council.  
7. **UI:** Seven tabs; left/center/right/bottom/AI Director wireframe; never drop DELIVER/GENERATE.  
8. **Project:** `.hvsproj` SoT; OTIO interchange only.  
9. **Legal continuity:** LGPL FFmpeg ship · madmom NC refuse · beauty consent · provider ToS archive.  
10. **First build slice (reaffirm):** `.hvsproj` v0 + EditCommandLayer + FFmpeg proxy/render + Router stubs + STARRDOM path — **before** OpenFX host, full OCIO, Blender/Natron, full Media Intelligence. (**Wave 8 finalizes.**)

---

## 12. Open questions → Wave 8

1. Compose engine spike winner metrics (custom+FFmpeg vs MLT vs GES)?  
2. `.hvsproj` pure JSON vs JSON+SQLite size threshold?  
3. Can shipping SKU redistribute NVENC-enabled FFmpeg without `--enable-nonfree`?  
4. Nebula Genesis exact GPU/VRAM/NVMe map (measure)?  
5. C2PA export V2 vs internal-only indefinitely?  
6. WRIM-as-Router-backend promotion criterion?  
7. Domain 34: seven tabs chrome V1 vs slim AUDIO+COLOR?  
8. Dual Source|Program monitors in SLICE-0 vs Program-only fast-follow?  
9. Cross-agent EditPlan DTO for Council vs Research-shared schema?  
10. Honest V1 slim vs full STARRDOM acceptance scoring (Domain 37)?

---

## 13. Sources (URLs)

### Official / primary
1. FFmpeg License and Legal — https://www.ffmpeg.org/legal.html  
2. FFmpeg LICENSE.md — https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/LICENSE.md  
3. NVIDIA FFmpeg with NVIDIA GPU HW Acceleration (Video Codec SDK 13.1) — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html  
4. NVIDIA Video Codec SDK 13.1 — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/  
5. OpenTimelineIO Architecture — https://opentimelineio.readthedocs.io/en/latest/tutorials/architecture.html  
6. OpenTimelineIO GitHub (Apache-2.0) — https://github.com/AcademySoftwareFoundation/OpenTimelineIO  
7. OpenFX GitHub (BSD-3) — https://github.com/AcademySoftwareFoundation/openfx  
8. OpenFX Core API — https://openfx.readthedocs.io/en/main/Reference/ofxCoreAPI.html  
9. OpenColorIO — https://github.com/AcademySoftwareFoundation/OpenColorIO  
10. C2PA Specification 2.4 — https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html  
11. madmom LICENSE (NC models) — https://github.com/CPJKU/madmom/blob/main/LICENSE  
12. GStreamer Editing Services — https://gstreamer.freedesktop.org/documentation/gst-editing-services/  
13. MLT copyright policy — https://mltframework.org/docs/copyrightpolicy/  
14. Blender License — https://www.blender.org/about/license/  
15. Natron (GPLv2) — https://github.com/NatronGitHub/Natron  

### Internal folds
16. `/home/box/higher-vision-studios/waves/WAVE_7.md` — PA2 stamp (Domains 25, 27, 29–34)  
17. `hvs-waves/HVS_WAVE_1_NLE_FOUNDATION.md` — Nebula machineIds; author UI vs workers  
18. `hvs-waves/HVS_WAVE_2_CAPCUT_STYLE_CREATIVE.md` — ThemePack; cloud vanish  
19. `hvs-waves/HVS_WAVE_3_SUBJECT_CAMERA.md` — 4K follow HOLD  
20. `hvs-waves/HVS_WAVE_4_AI_DIRECTOR_EDITOPS.md` — control modes; tips≠ops  
21. `hvs-waves/HVS_WAVE_5_GENERATIVE_CHARACTERS_STARRDOM.md` — Router; consent; URL expiry  
22. `hvs-waves/HVS_WAVE_6_AUDIO_COLOR_VFX_RENDER.md` — LGPL/NVENC; madmom NC refuse  
23. `HVS_8_WAVES_PLAN.md` · `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`

---

## 14. Blind Spot / Failure classes (fold)

`SINGLE_PROVIDER_HARDWIRE` · `FAKE_LOCAL` · `CDN_SCRAPE` · `RESEARCH_SCRAPER_IN_HVS` · `WRIM_RELABEL` · `MODULE_MERGE_BY_WORD` · `GPL_X264_CLAIMED_LGPL` · `NONFREE_FFMPEG_SHIPPED` · `OFX_SPDX_UNKNOWN` · `OTIO_AS_SOT` · `INVENTED_VRAM` · `PROVENANCE_THEATER` · `RESEARCH_SOLD_AS_SHIPPED` · `MADMOM_NC_IN_CORE` · `COUNCIL_OWNS_TIMELINE` · `4K_FOLLOW_UNPROVEN_CLAIM`

---

## WAVE 7 STAMP (PA executor mirror)

**WAVE_7 RESEARCH COMPLETE | READY FOR WAVE 8 fold**

- Domains **25, 27 (residual), 29–34** stamped; Domain **26** deferred to WAVE_6  
- Hardware: Nebula Linux `153e10ec…` primary; Windows secondary/PARTIAL; author UI ≠ heavy workers; 4K follow HOLD  
- LOCAL/CLOUD/HYBRID + Provider Router no lock-in  
- ThemePack first-class packs; OpenFX V2+  
- Rights: hashes · license tags · consent · client contracts · ToS archive; C2PA evaluate V2+  
- Boundaries: COMMANDER→WAR ROOM→HVS; opt-in Council packets only; HVS≠Terra≠Media Player≠Council  
- UI markdown wireframe (Domain 34)  
- Legal: OTIO Apache-2.0 · FFmpeg LGPL · CapCut/Adobe scrape REFUSE · beauty consent · madmom NC REFUSE  
- Classification: VERIFIED / PROPOSED / FUTURE / REFUSE separated  
- Builds: HOLD — research ≠ shipped  
- Next: Wave 8 inventory + roadmap + MASTER REPORT fold  

**Conflict note:** No hard contradiction with PA2 WAVE_7 found. PA executor densifies: author-UI/worker split diagram, COMMANDER chain, ThemePack-as-pack emphasis, Council packet allowlist, madmom NC carry from Wave 6, product-tree panel map. If later PA2 edits conflict, keep both labeled **[PA2]** vs **[PA executor]**.

---

## DELTA — PA executor vs PA2 INFRA (2026-09-20 EDT)

**Scope:** Unique verified citation(s) in this file **not** present in `hvs-waves/HVS_WAVE_7_INFRA_RIGHTS_UI.md`. No MASTER rewrite (PA merges). Research only.

### Unique verified citation (INFRA gap)

| Item | Citation | Why it matters for Wave 7 |
|---|---|---|
| **madmom pretrained models = NC** | https://github.com/CPJKU/madmom/blob/main/LICENSE | Wave 6 REFUSE for commercial core (CC BY-NC-SA models). INFRA Wave 7 risk/license pins omit madmom; carry into Domain 30/24 risk register so Wave 8 does not re-admit NC beat models. Prefer `librosa` (ISC) for V1 beat markers. |

### Already covered by INFRA (not unique — do not re-litigate)

- OpenFX / `openeffects.org` / ASWF `openfx` BSD-3 — INFRA §§1.1 + Evidence license pins
- OTIO Apache-2.0 · FFmpeg LGPL/GPL/nonfree · NVENC operator vs ship SKU — INFRA Evidence
- C2PA 2.4 — INFRA Domain 32
- Nebula Linux `153e10ec…` primary / Windows secondary — INFRA + Wave 1

### Densify note (design, not a new external citation)

Author-UI vs heavy-worker split, COMMANDER→WAR ROOM→HVS chain, ThemePack-as-pack, Council opt-in packet allowlist remain in this file as **[PA executor]** densify. Prefer INFRA as PA2 stamp for fold; keep this DELTA for the madmom NC pin only.

**STOP:** No overwrite of INFRA, `/home/box/higher-vision-studios/*`, or terra-swarm MASTER.

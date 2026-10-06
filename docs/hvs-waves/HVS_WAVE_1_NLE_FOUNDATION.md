# HVS WAVE 1 — Professional NLE Foundation
# STATUS: COMPLETE (research deliverable) | 2026-09-20 ~14:20 ET | RESEARCH ONLY
# Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE | REFUSE
# Domains: 1, 27, 35(partial), 29(partial) → Report §§ 2, 3, 9, 15, 18(partial)
# Seed: do not contradict `../HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` (OTIO/FFmpeg/hybrid)

---

## 0. Executive recommendation (PROPOSED HVS)

1. **Hybrid timeline:** track-based **authoring truth** (Premiere/Resolve/OTIO-class) + magnetic behaviors as **typed EditOps** (ripple/gap-close), not as the sole mental model.
2. **OTIO = edit-graph / interchange SoT candidate;** FFmpeg = decode/encode/filter/proxy/render only — **ESTABLISHED split.** Do **not** claim Premiere/FCP/Resolve parity from FFmpeg alone.
3. **INTERNAL HVS project format** owns full graph (effects, themes, CameraSpec, provenance, EditOp history); OTIO export/import for cut structure; disclose FCPXML/xmeml/AAF loss.
4. **Linux primary:** live War Room host Nebula Linux `machineId 153e10ec…`; Windows Nebula secondary. Build HVS for Linux CUDA/NVENC workers; do not assume Apple-only APIs.
5. **No runtime dependency** on CapCut, FCP, Premiere, AE, or Resolve. Optional Resolve on Linux = reference/interop tool only.
6. **AI mutates timeline via typed EditOps + transactions only** — never raw model→ffmpeg strings (Wave 4 owns schema depth).

---

## 1. VERIFIED CURRENT — Feature depth of commercial NLEs (official docs)

### 1.1 Final Cut Pro (Apple) — Magnetic Timeline

| Capability | Status | Official basis |
|---|---|---|
| Magnetic / trackless primary storyline | VERIFIED CURRENT | Insert/trim/move ripples neighbors; avoids gaps/collisions |
| Connected clips (above = B-roll/titles; below = SFX/music) | VERIFIED CURRENT | Move with anchor on primary |
| Connected storylines | VERIFIED CURRENT | Group connected clips |
| Position tool + gap clips | VERIFIED CURRENT | Suspend magnetism; overwrite placement; preserve timing |
| Trim tool: ripple, roll, slip, slide | VERIFIED CURRENT | Editing tools + trim guide pages |
| Blade / Select / Range / Zoom / Hand | VERIFIED CURRENT | Seven timeline tools documented |
| Compound clips, multicam clips, auditions | VERIFIED CURRENT | Advanced editing sections in User Guide |
| Smart Conform, Magnetic Mask, object tracking | VERIFIED CURRENT | User Guide (color/effects/tracking chapters) |
| Libraries / Events / Projects | VERIFIED CURRENT | Library model |
| FCPXML import/export | VERIFIED CURRENT | “Use XML to transfer projects”; Apple FCPXML developer docs |
| Native Linux desktop | **REFUSE claim** | Mac-only product; no official Linux NLE |
| Public timeline-engine SDK | **Cannot verify from public docs** | No Apple-published engine SDK for embedding FCP |

**Sources (official):**
- https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac
- https://support.apple.com/guide/final-cut-pro/editing-tools-ver2bea7297/mac
- https://support.apple.com/guide/final-cut-pro/make-roll-edits-ver1632d9ae/mac
- https://support.apple.com/guide/final-cut-pro/make-slide-edits-ver1632caff/mac
- https://support.apple.com/guide/final-cut-pro/use-xml-to-transfer-projects-verdbd66ae/mac
- https://developer.apple.com/documentation/professional-video-applications/describing-final-cut-pro-items-in-fcpxml

**License:** proprietary commercial (Apple). **Integration realistic for HVS core:** No — concept prior art + optional FCPXML export target only.

---

### 1.2 Premiere Pro (Adobe) — Track-based Sequence

| Capability | Status | Official basis |
|---|---|---|
| Fixed video/audio/caption tracks in Sequence | VERIFIED CURRENT | Core product model + UXP Sequence APIs |
| Insert / Overwrite | VERIFIED CURRENT | Keyboard shortcuts `,` / `.`; UXP `createInsertProjectItemAction` / `createOverwriteItemAction` (since 25.6) |
| Lift / Extract | VERIFIED CURRENT | Shortcuts `;` / `'` |
| Ripple / Rolling / Slip / Slide trims | VERIFIED CURRENT | HelpX trim mode + keyboard shortcut tables |
| Add Edit (blade), Match Frame, Extend to Playhead | VERIFIED CURRENT | Shortcut docs |
| Multi-Camera Source Sequence | VERIFIED CURRENT | HelpX multicam create/sync pages |
| Auto Reframe Sequence | VERIFIED CURRENT | HelpX Auto Reframe (doc updated Apr 15, 2026 per Wave A citation) |
| Object/mask tracking, adjustment layers | VERIFIED CURRENT | Effect Controls / HelpX (depth beyond Wave 1 cut) |
| UXP typed Action + `executeTransaction` | VERIFIED CURRENT | Developer docs — validates command-layer pattern |
| Native Linux desktop NLE | **REFUSE claim** | No Adobe Premiere desktop on Linux |
| Full effect-graph / AAF lossless via public API | **Cannot verify** | Extensibility is plugin surface, not engine source |

**Sources (official):**
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/
- https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/
- https://helpx.adobe.com/premiere/desktop/edit-projects/trim-clips/about-trim-mode.html
- https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html
- https://helpx.adobe.com/premiere/desktop/edit-projects/set-up-multi-camera-sequences-for-editing/create-a-multi-camera-source-sequence.html
- https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/add-auto-reframe-effect-to-a-sequence.html

**License:** proprietary (Adobe Creative Cloud). **HVS fit:** Prior art for track authoring + transaction/EditOp pattern; not a runtime dependency.

---

### 1.3 After Effects (Adobe) — Comp / layer (not cut NLE)

| Capability | Status | Official basis |
|---|---|---|
| Composition = layered timeline (footage, audio, text, effects) | VERIFIED CURRENT | Composition basics HelpX |
| Keyframe animation, blend modes, masks, tracking, 3D layers | VERIFIED CURRENT | Product/HelpX (motion/compositing class) |
| Editorial multicam / magnetic storyline | **Not AE’s role** | Adobe positions Premiere for cut; AE for motion/VFX |
| Suitable as HVS **timeline SoT** | **REFUSE** | Layer/comp model ≠ NLE cut graph; proprietary project |

**Sources (official):**
- https://helpx.adobe.com/after-effects/desktop/work-with-compositions/composition-settings/composition-basics.html
- https://www.adobe.com/creativecloud/video/premiere-pro-vs-after-effects.html

**PROPOSED HVS:** Treat AE-class depth as **compositing/motion layer** (Wave 6 OpenFX/own effect graph), not as primary edit SoT.

---

### 1.4 DaVinci Resolve (+ Fusion / Fairlight) — Blackmagic

| Capability | Status | Official basis |
|---|---|---|
| Page architecture: Media, Cut, Edit, Fusion, Color, Fairlight, Deliver (+ Photo in Resolve 21 per product copy) | VERIFIED CURRENT | blackmagicdesign.com/products/davinciresolve |
| Edit page = traditional tracks | VERIFIED CURRENT | Product + manuals lineage |
| Fusion = node-based VFX/MGFX (MediaIn/MediaOut) | VERIFIED CURRENT | Fusion product page |
| Fairlight = DAW-class; vendor claims up to 2,000 tracks via Fairlight Audio Core | VERIFIED CURRENT (vendor claim) | Product page — treat track ceiling as **VENDOR CLAIM** until HVS byte-proves |
| Neural Engine AI tools (Magic Mask, Smart Reframe, etc.); many Studio-gated | VERIFIED CURRENT (product marketing + Studio distinction) | Product/Studio pages |
| Mac / Windows / **Linux** official builds | VERIFIED CURRENT | Product page states Linux support |
| Linux support baseline | PARTIAL / vendor-constrained | Public forums + installer README culture: Rocky Linux + discrete NVIDIA commonly cited; exact distro matrix is in installer PDF (not fully re-fetched here) — **flag: verify against downloaded Linux Install Instructions.pdf before Nebula install claims** |
| Free Resolve + paid Studio | VERIFIED CURRENT | Vendor pricing / product split |

**Sources (official):**
- https://www.blackmagicdesign.com/products/davinciresolve
- https://www.blackmagicdesign.com/products/davinciresolve/fusion
- Resolve manuals / Linux installer PDF (Blackmagic download portal — cite when installing)

**PROPOSED HVS:** Resolve Studio on Linux = optional **reference/interop** workstation, **not** HVS core runtime. Strongest commercial NLE Linux path for Nebula operators who need color/audio peer tools.

---

## 2. Timeline models — tracks vs magnetic vs hybrid

| Model | Mechanism | Products (pattern) | Tradeoff |
|---|---|---|---|
| Fixed tracks | Vertical lanes; gaps persist unless ripple ops | Premiere, Resolve Edit, Avid-class | Precise layering; more manual gap management |
| Magnetic | Gaps close; primary storyline + connected clips | Final Cut Pro | Fast assemble; weaker multi-layer mental model for some editors |
| **Hybrid (PROPOSED HVS)** | Tracks = **authoring truth**; magnetic = **EditOps** (RippleDelete, Insert-with-ripple, CloseGap) | Aligns OTIO Stack→Track→Clip/Gap | Matches interchange; export FCPXML/xmeml with known loss |

### Recommendation (PROPOSED HVS) — **C Hybrid**

**Evidence:**
- OTIO canonical structure is Timeline → Stack → **Tracks** → Clip/Gap/Transition/nested Stack|Track — track-native (official OTIO Timeline Structure).
- Premiere UXP proves insert/overwrite/remove as **typed actions inside transactions** — magnetic behavior can be an op, not the storage model.
- FCP proves magnetic UX value for speed — HVS can offer magnetic **modes/ops** without making the SoT trackless.
- CapCut-style speed remains a **creative layer** (Wave 2), never the SoR.

**Do not contradict Wave A Science:** hybrid + OTIO SoT + FFmpeg render remains ESTABLISHED for HVS research.

---

## 3. Professional edit-op inventory (PROPOSED HVS schema targets)

Industry-standard ops verified as **product features** in FCP and/or Premiere Help (names vary). HVS should expose them as **typed EditOps** (Wave 4 owns wire schema).

### 3.1 Assembly / structure
| EditOp (PROPOSED name) | Behavior | VERIFIED in |
|---|---|---|
| `InsertClip` | Insert at time; shift later media (ripple) | Premiere Insert; FCP Insert |
| `OverwriteClip` | Replace media at destination without shifting | Premiere Overwrite; FCP Position/Overwrite |
| `AppendClip` | Add at end of storyline/track | FCP Append |
| `ReplaceClip` | Swap clip keeping timing constraints | FCP Replace |
| `Lift` | Remove range; leave gap | Premiere Lift |
| `Extract` / `RippleDelete` | Remove range; close gap | Premiere Extract; FCP ripple remove |
| `Split` / `Blade` | Cut clip at playhead | Premiere Add Edit; FCP Blade |
| `Move` / `Rearrange` | Relocate clip(s); optional ripple | Both |
| `Duplicate` / `Clone` | Copy clip or track item | Premiere UXP clone action; FCP duplicate |
| `Nest` / `Compound` | Collapse selection to nested composition | FCP compound; Premiere nest |
| `Unnest` | Expand nest | Product-dependent |

### 3.2 Trim family
| EditOp | Behavior | VERIFIED in |
|---|---|---|
| `TrimIn` / `TrimOut` | Change one edge; gap or ripple policy selectable | Both |
| `RippleTrim` | Trim edge; shift downstream | Both |
| `Roll` | Move edit point; adjacent clips compensate; sequence duration constant | Both |
| `Slip` | Change source in/out; keep timeline position + duration | Both |
| `Slide` | Move clip in time; neighbors roll to fill | Both |
| `ExtendToPlayhead` | Grow/shrink edge to CTI | Premiere Extend |
| `SetInOut` / `MarkRange` | Timeline In/Out for lift/extract/render | Both |

### 3.3 Sync / multicam / versions
| EditOp | Behavior | VERIFIED pattern |
|---|---|---|
| `CreateMulticam` | Sync angles (TC / audio / in-out / marker) | Premiere Multi-Camera; FCP multicam |
| `MulticamSwitch` | Cut/switch active angle | Both |
| `MatchFrame` | Reveal source frame for clip under CTI | Premiere Match Frame |
| `Audition` / `CreateVersion` | Alternate takes under one slot | FCP Auditions (prior art) |

### 3.4 Speed / time
| EditOp | Notes |
|---|---|
| `SetSpeed` / `SpeedRamp` | Constant or variable; optical-flow quality = FUTURE/render |
| `Freeze` / `Hold` | Freeze frame segment |
| `Reverse` | Reverse playback |

### 3.5 Effects / audio / markers (stubs for later waves)
`AddTransition`, `ApplyEffect`, `ApplyFilter`, `ApplyTheme`, `SetOpacity`, `KeyframeTransform`, `AddMarker`, `AddCaption`, `SetAudioLevel`, `FadeAudio`, `DuckMusic`, `ApplyGrade`, `TrackSubject`, `SetCameraSpec`, `AutoReframe`, `Render`, `ExportProxy`.

**REFUSE:** Raw natural-language → shell ffmpeg without validation. **PROPOSED:** NL → EditOp validate → transaction → apply to OTIO/HVS graph → preview.

---

## 4. OTIO vs FFmpeg — ESTABLISHED split

### 4.1 OpenTimelineIO (VERIFIED CURRENT)

- **What it is:** Open source API + interchange for **editorial cut information** (order/length of cuts; external media refs). **Not** a media container; **not** a renderer.
- **Canonical structure:** `Timeline` → `tracks` (`Stack`) → `Track` → `Clip` | `Gap` | `Transition` | nested `Track`/`Stack`.
- **Time:** `RationalTime` / `TimeRange`; `source_range` trims; media via `ExternalReference` / `MissingReference`.
- **Rendering note from OTIO docs:** Painter-order stack composite; **effects on clips are application-specific** — OTIO does not define effect semantics.
- **License:** Apache-2.0 (ASWF). **Linux:** first-class.
- **Adapters:** EDL / FCP XML family / others via adapter plugins (feature matrix varies — disclose per adapter).

**Official links:**
- https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html
- https://opentimelineio.readthedocs.io/en/latest/
- https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- https://opentimeline.io/

### 4.2 FFmpeg (VERIFIED CURRENT)

- **What it is:** Decode / encode / filter / concat / hardware encode (e.g. NVENC when built) — **render/proxy pipeline**, not an NLE model.
- **License:** LGPL 2.1+ default; `--enable-gpl` → GPL; `--enable-nonfree` → unredistributable. No proprietary commercial license from FFmpeg project.
- **Official:** https://www.ffmpeg.org/legal.html

### 4.3 Fit for HVS (PROPOSED / ESTABLISHED)

```
[ HVS Internal Project ] ──authoring truth──► tracks + effects + CameraSpec + provenance + EditOp log
         │
         ├── export/import cut graph ──► OTIO (+ adapters)
         └── lower to pixels/audio ──► FFmpeg / GPU compositor / NVENC
```

**Blind-spot lock:** Gaps, multi-layer composites, proprietary effects, magnetic storylines, and color graphs are **PARTIAL or lost** if you only have FFmpeg concat. **Do not claim Premiere parity from FFmpeg alone.**

---

## 5. Project format (Domain 27)

### 5.1 PROPOSED HVS — Internal format requirements

| Requirement | Rationale |
|---|---|
| Deterministic, versionable, inspectable | AI + human audit |
| Migration-capable schema version | Long-lived War Room projects |
| AI-readable + UI-editable | Same graph |
| Non-destructive + undo/history | EditOp transactions |
| Provenance-aware | Domain 32 (Wave 7) |
| Media referenced by hash/URI, not baked | Relink / proxies |
| Separate **Observed** (media hashes, committed timeline) from **Scenario** (AI suggestions) | Wave A Science |

**Sketch (PROPOSED, not implemented):** JSON/MessagePack or SQLite project package:
`project.json` + `timeline.otio` (or OTIO-compatible subgraph) + `editops.jsonl` + `media/index.json` + `proxies/` + `renders/` + `provenance/`.

### 5.2 OTIO as interchange (VERIFIED CURRENT capability / PROPOSED HVS use)

- **Use:** Round-trip **cut structure** (clips, gaps, tracks, transitions, markers, nested stacks).
- **Do not expect:** Full HVS themes, OpenFX graphs, CameraSpec, generative provenance, or CapCut-style templates inside stock OTIO without `metadata` extensions (PROPOSED: put HVS extras in OTIO `metadata` dict + sidecar).

### 5.3 FCPXML / xmeml / AAF / EDL — loss notes

| Format | Role | Loss / confusion |
|---|---|---|
| **FCPXML** | Modern Final Cut XML / bundles | ≠ FCP7 **xmeml**; effects/Motion content often incomplete across hosts |
| **xmeml (FCP7 XML)** | Legacy Premiere↔Resolve bridge | Effects drop; track mapping imperfect |
| **AAF** | Richer binary; audio automation | Complex; media must travel; not sole SoT |
| **EDL** | Cut list + TC | Little multitrack/effects |
| **OTIO** | Editorial API + interchange | Not a renderer; effect semantics app-specific |

**Historian lock:** Never confuse FCPXML with xmeml. HVS internal format ≠ any proprietary project file.

**FUTURE:** Lossless multi-host round-trip of nested compounds + full effect graphs — not V1.

---

## 6. Linux / Nebula feasibility

### 6.1 Live hosts (VERIFIED CURRENT — War Room inventory, 2026-09-20)

| Host | machineId | Role |
|---|---|---|
| **Nebula Linux** | `153e10ec-c150-4a0e-b21e-d01ccfbe33d6` | Live War Room host; preferred CUDA/NVENC worker path **if NVIDIA present** |
| **Nebula Windows** | `37425d23-1052-424f-b188-f060ca03150f` | Secondary; often offline; WSL2 CUDA = PARTIAL until proven |

Path note (Wave A): `/home/chosenone/Codex/war-room-os` lives on Linux host — **research only; no code from this wave.**

### 6.2 Component Linux matrix (VERIFIED CURRENT licenses / platforms)

| Component | License | Linux | HVS role |
|---|---|---|---|
| OpenTimelineIO | Apache-2.0 | Yes | Edit graph / interchange |
| FFmpeg | LGPL 2.1+ (discipline) | Yes | Render/proxy |
| GStreamer | LGPL 2.1+ | Yes | Pipeline alt (assess Wave 6) |
| MLT | LGPL 2.1+ | Yes | Framework peer (Kdenlive/Shotcut lineage) |
| OpenColorIO | ASWF | Yes | Color (Wave 6) |
| OpenFX | BSD-3-Clause (ASWF) | Host-dependent | Effects plugins |
| DaVinci Resolve | Proprietary | Official | Optional interop |
| FCP / Premiere / AE / CapCut | Proprietary | No desktop NLE (Resolve exception) | Prior art only |

### 6.3 Feasibility flags

- **PROPOSED:** Author UI anywhere; **heavy track/render/ML on Linux CUDA** when available; OTIO as wire format between UI and workers.
- **HOLD:** Realtime 4K subject-follow until VRAM+fps byte-proven on target GPU (Wave 3).
- **REFUSE:** Apple-only Metal assumptions for core pipeline; embedding CapCut/Adobe as SoR.

---

## 7. Partial Domain 35 — Feature inventory (Wave 1 slice)

| FEATURE | FCP | Premiere | AE | Resolve | OSS option | HVS TARGET | BUILD/INTEGRATE |
|---|---|---|---|---|---|---|---|
| Track-based timeline | — (magnetic) | Yes | Comp layers | Yes | OTIO | **Yes (truth)** | BUILD |
| Magnetic ops | Yes | Ripple ops | — | Ripple-ish | EditOps | **Yes (ops)** | BUILD |
| Insert/Overwrite/Lift/Extract | Yes* | Yes | — | Yes | EditOps+OTIO | V1 | BUILD |
| Roll/Slip/Slide | Yes | Yes | — | Yes | EditOps | V1–V2 | BUILD |
| Nest/Compound | Yes | Yes | Precomp | Yes | OTIO nested | V1 | BUILD |
| Multicam | Yes | Yes | — | Yes | PROPOSED | V2 | BUILD |
| Node compositing | Motion | Dynamic Link/AE | Yes | Fusion | Natron/Blender | V2–V3 | HYBRID |
| DAW-class audio | Basic+ | Mixer | — | Fairlight | TBD | V2 | HYBRID |
| Color suite | Yes | Lumetri | — | Color page | OCIO | V2 | HYBRID |
| Linux native | No | No | No | Yes | OTIO/FFmpeg | **Required** | BUILD |
| FFmpeg as NLE | — | — | — | — | FFmpeg | **Render only** | INTEGRATE |

\*FCP naming differs (Position/ripple) but capability class verified.

---

## 8. Blind Spot / REFUSE lines (Wave 1)

1. **REFUSE:** CapCut/Adobe scrape; proprietary UI clone; CapCut as SoR.
2. **REFUSE:** “FFmpeg = Premiere.”
3. **REFUSE:** Invented vendor APIs; claiming Linux for FCP/Premiere desktop.
4. **REFUSE:** Silent delete of source media (inherit Media densify policy).
5. **REFUSE:** Merging HVS with Media Player or Terra (Historian boundary lock).
6. **Cannot verify from public docs alone:** Exact Resolve Linux codec matrix (AAC/ProRes nuances) without installer PDF; Fairlight 2,000-track ceiling under real Nebula hardware; Premiere UXP completeness for every trim op beyond insert/overwrite/remove/clone.

---

## 9. Answers to Critical Questions (Wave 1 scope)

| # | Question | Answer (this wave) |
|---|---|---|
| 1 | Build own professional NLE in War Room? | **Yes, realistically in slices** — hybrid OTIO-backed engine + FFmpeg/GPU render; not by embedding FCP/Premiere. |
| 2 | Build vs FFmpeg/OTIO? | **OTIO/edit graph + EditOps = build/own;** FFmpeg = integrate for media I/O/proxy/final; effects/color = later OpenFX/OCIO. |
| 3 | Timeline engine? | **Tracks = authoring truth; magnetic = EditOps.** |
| 4 | Linux support? | **Yes for intended architecture** (OTIO/FFmpeg/CUDA); commercial NLE peer = Resolve optional. |
| 5–6 | Preview / proxy? | **PROPOSED:** proxy ladder + render cache via FFmpeg/NVENC; details Wave 6. |
| 7 | AI manipulate timeline? | **Typed EditOps + transactions only** (Wave 4). |
| 19–20 | Project format / OTIO? | **Internal HVS format + OTIO interchange SoT for cuts.** |
| 21–22 | Edit command / undo? | **EditOp log + transactions;** full schema Wave 4. |
| 24 | Avoid copying proprietary? | Capability matrix + own UX; export adapters only. |

*(Questions 8–18, 23, 25 → later waves.)*

---

## 10. Sources (URLs)

### Apple
- https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac
- https://support.apple.com/guide/final-cut-pro/editing-tools-ver2bea7297/mac
- https://support.apple.com/guide/final-cut-pro/arrange-clips-in-the-timeline-verc147f195/mac
- https://support.apple.com/guide/final-cut-pro/make-roll-edits-ver1632d9ae/mac
- https://support.apple.com/guide/final-cut-pro/make-slide-edits-ver1632caff/mac
- https://support.apple.com/guide/final-cut-pro/use-xml-to-transfer-projects-verdbd66ae/mac
- https://developer.apple.com/documentation/professional-video-applications/describing-final-cut-pro-items-in-fcpxml

### Adobe
- https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/
- https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/
- https://helpx.adobe.com/premiere/desktop/edit-projects/trim-clips/about-trim-mode.html
- https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html
- https://helpx.adobe.com/premiere/desktop/edit-projects/set-up-multi-camera-sequences-for-editing/create-a-multi-camera-source-sequence.html
- https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/add-auto-reframe-effect-to-a-sequence.html
- https://helpx.adobe.com/after-effects/desktop/work-with-compositions/composition-settings/composition-basics.html
- https://www.adobe.com/creativecloud/video/premiere-pro-vs-after-effects.html

### Blackmagic
- https://www.blackmagicdesign.com/products/davinciresolve
- https://www.blackmagicdesign.com/products/davinciresolve/fusion

### OTIO / FFmpeg / ASWF
- https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html
- https://opentimelineio.readthedocs.io/en/latest/
- https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- https://opentimeline.io/
- https://www.ffmpeg.org/legal.html

### Internal seeds (do not contradict)
- `/workspace/terra-swarm/HVS_WAVE_A_NLE_CAPCUT_TRACKING.md`
- `/workspace/terra-swarm/historian-hvs-wave1-lineage.md`
- `/workspace/terra-swarm/HVS_8_WAVES_PLAN.md`
- `/home/box/higher-vision-studios/HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`

---

## 11. Wave 1 completion checklist

- [x] VERIFIED feature depth FCP / Premiere / AE / Resolve(+Fusion/Fairlight) with official URLs
- [x] Hybrid recommendation (tracks truth + magnetic EditOps)
- [x] Full professional edit-op inventory
- [x] OTIO SoT vs FFmpeg render — ESTABLISHED; no FFmpeg=Premiere claim
- [x] Internal HVS format proposal; OTIO interchange; FCPXML/xmeml loss
- [x] Linux / Nebula flags (`153e10ec` primary)
- [x] Labels on claims; Sources section
- [x] Research only — no War Room application code / commit / push / deploy

**STATUS: WAVE 1 RESEARCH DELIVERABLE COMPLETE**

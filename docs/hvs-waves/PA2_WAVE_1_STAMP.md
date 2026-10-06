# HVS WAVE 1 — NLE FOUNDATION (Domain 1)
## Status / Date

| Field | Value |
|---|---|
| **Status** | **WAVE_1 DONE** — Domain 1 stamped |
| **Date** | Sunday Sep 20, 2026 · 2:25 PM EDT (America/New_York) |
| **Commander** | Mark |
| **Mode** | RESEARCH ONLY — no code / build / commit |
| **Scope** | **Domain 1 only** — Professional timeline / NLE |
| **PA wave map** | CapCut creative → **Wave 2** · Subject follow + camera → **Wave 3** |
| **Locks** | HVS ≠ Media Player ≠ Terra · REFUSE invented NLE APIs · CapCut ≠ SoR · Linux-first (Nebula) · VERIFIED CURRENT / PROPOSED / FUTURE |

Research from concurrent Avenger drafts (ops inventory, API evidence addendum) folded here for Domain 1; CapCut/ThemeSpec and TrackSubject sections **re-filed** to `WAVE_2.md` / `WAVE_3.md` drafts (not deleted).

Claim tags: VERIFIED FACT | VENDOR CLAIM | INFERENCE | RECOMMENDATION

---

## Domain 1 findings

### 1.1 Boundary locks (Historian)

| Module | Owns | Does NOT own |
|---|---|---|
| **War Room Media Player** | Radio / news / podcasts / CAP duck / scanners LINK-OUT | Studio NLE |
| **Terra / God’s Eye** | Globe / geocode / cameras / weather | HVS timeline |
| **Higher Vision Studios** | Native studio NLE foundation (+ creative/AI in later waves) | Media Player densify; Terra Cesium |

Densify *policy* inheritance (provenance, no silent delete, licenseClass concepts) ≠ module merge.

### 1.2 Competitive timeline models (VERIFIED CURRENT)

#### Final Cut Pro — Magnetic Timeline
- Trackless design; **primary storyline** holds main picture/dialogue; insert/trim/move **ripples** neighbors (auto gap-close / collision avoidance).
- **Connected clips** attach above (B-roll/titles) or below (music/SFX) and ride with the connected primary clip.
- **Connected storylines** group connected clips for sequence edits + transitions.
- **Position tool** suspends magnetism: overwrite at destination, leave **gap clip** at origin.
- Documented edit families: append, insert, overwrite, connect, replace; ripple / roll / slip / slide; three-point; compound clips; multicam; roles; auditions.
- **macOS only.** No public timeline-engine SDK. Interchange: **FCPXML** (≠ FCP7 xmeml).
- Sources: Apple Support — Magnetic Timeline intro; Connect clips; Arrange; Insert.

#### Adobe Premiere Pro — Traditional tracks
- **Sequence** = explicit video + audio **tracks**; higher V-tracks composite over lower without overwriting lower material.
- Ops: insert vs overwrite (source patching / track targeting); Razor; Ripple / Rolling / Slip / Slide; Lift / Extract; Sync Lock / Track Lock; nested sequences; adjustment layers; markers.
- Non-destructive: edits do not alter source media.
- **Programmable surface (host plugin only):** UXP `SequenceEditor` actions (`createInsertProjectItemAction`, `createOverwriteItemAction`, `createRemoveItemsAction`, clone/move) via project transaction — **Windows/macOS Premiere host**, not a remote Linux NLE API. ExtendScript legacy supported through Sept 2026 (Adobe notice); migrate to UXP.
- Sources: Adobe HelpX Edit video; Adobe Premiere UXP / SequenceEditor reference.

#### Adobe After Effects — Layer / composition (NOT cut-NLE SoT)
- Composition + **layer stack** (render order); trim/slip/split/keyframe; compositing/motion-graphics timeline.
- Interchange limited; Dynamic Link / MOGRT patterns — **motion/comp layer**, not HVS timeline SoT.
- Sources: Adobe HelpX Composition basics; Selecting and arranging layers.

#### DaVinci Resolve (+ Fusion / Fairlight)
- **Edit / Cut:** traditional **track-based** NLE.
- **Fusion:** node comps (not magnetic).
- **Fairlight:** DAW-class audio (vendor claims up to ~2,000 tracks with Fairlight Audio Core); Resolve 21 collapsible folder tracks (VENDOR CLAIM / product What’s New).
- Neural Engine AI tools (Smart Reframe, Magic Mask, IntelliSearch, etc.) — many **Studio**-gated; reframe detail is Wave 3.
- **Official Linux desktop** (Mac/Win/Linux) — strongest commercial NLE path on Nebula for **reference/interop**, not HVS SoR.
- Scripting: Python/Lua `DaVinciResolveScript` while Resolve running (prefs) — **host-bound**, not War Room remote SoR.
- Sources: Blackmagic product / What’s New; Resolve 20 Editors Guide; product Scripting README (bundled).

#### CapCut / Descript (context only)
- CapCut: creator magnetic-ish UX — **Wave 2** prior art; **no verified deep NLE write API**.
- Descript: text-first — prior art for transcript edit; not V1 NLE dependency.

### 1.3 Ops inventory (capability classes — match, do not copy UI)

**Organization:** libraries / projects / bins or events · clips · subclips · sequences · markers · favorites/ratings · rejection · auditions/versions.

**Monitors:** Source + Program (or Event Viewer + Viewer) dual-monitor pattern — **PROPOSED** for HVS.

| Op class | Magnetic (FCP) | Traditional (Premiere/Resolve) | HVS |
|---|---|---|---|
| Insert | Ripples spine | Pushes downstream (targeted tracks) | **PROPOSED** EditOp |
| Overwrite / Position | Position tool + gaps | Overwrite at CTI/In-Out | **PROPOSED** |
| Append / Replace / Connect-overlay | Connect ≠ primary | Higher V / lower A tracks | **PROPOSED** |
| Lift / Extract / Ripple delete | Gaps / magnetic close | Lift hole vs ripple close | **PROPOSED** |
| Blade / Split | Cut in two | Razor / split | **PROPOSED** |
| Trim suite (ripple/roll/slip/slide/extend) | FCP trim | Premiere Trim mode | **PROPOSED** V1 subset → V2 full |
| Match frame / freeze / reverse / duplicate / move / paste attributes | Industry | Industry | **PROPOSED** |
| Snapping / markers / ranges | Industry | Industry | **PROPOSED** |
| Keyframes (transform, opacity, audio, effects, masks, speed, curves/easing/bezier) | Industry | Industry | **PROPOSED** V1 thin → V2 |
| Compound / nested / sync / multicam / adjustment layers | Industry | Industry | Nest V2; multicam Wave 3 |

### 1.4 Interchange (VERIFIED CURRENT)

| Format | Role | HVS fit |
|---|---|---|
| **EDL** | Cut list TC | Conform only |
| **AAF** | Richer binary / audio | Handoff prior art; not sole SoT |
| **xmeml (FCP7 XML)** | Premiere↔Resolve bridge | ≠ FCPXML |
| **FCPXML** | Modern FCP interchange | Optional export |
| **OTIO** (ASWF, Apache-2.0) | Timeline→Stack→Track→Clip/Gap/Transition; external media refs; **not a renderer** | **Interchange + edit-graph shape**; not full project store |
| **FFmpeg** | Decode/encode/filter/proxy/render (LGPL default) | Render/proxy only |

OTIO: https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html · https://github.com/AcademySoftwareFoundation/OpenTimelineIO

### 1.5 Magnetic vs traditional vs hybrid — decision

| Option | Evidence | Nebula Linux fit |
|---|---|---|
| **A Traditional tracks** | Premiere, Resolve, OTIO Track lists, GES | Strong layering + interchange |
| **B Pure magnetic** | FCP storyline | Apple-only product; weak OTIO SoR mapping |
| **C Hybrid (RECOMMENDED)** | Tracks = **authoring truth**; magnetic = **EditOps/UX** (ripple, gap, connect-as-overlay sync link) | Matches OTIO; AI emits typed ops; Linux OSS path |

**RECOMMENDATION:** **C — Hybrid**  
Internal SoR = track-based `.hvsproj` (PROPOSED; schema Wave 7) + typed EditCommandLayer. OTIO = import/export (lossy for HVS-only fields — disclose). Optional later “Story” UX mode (FCP-inspired attachments) **without** making magnetism the data model. Comp/node escape hatch (AE/Fusion-class) = V2+ effects lane — do not force magnetic semantics onto deep VFX.

### 1.6 NLE API reality — Evidence locks (VERIFIED CURRENT)

| Product | Official surface | Write timeline? | Host OS | HVS use |
|---|---|---|---|---|
| Premiere | UXP DOM / SequenceEditor | YES **inside Premiere plugin host** | Win/Mac — **not** Linux WR host | Pattern only; not embed |
| Premiere ExtendScript | Legacy | YES (legacy; →UXP) | Win/Mac | Do not build on |
| FCP | FCPXML + workflow extensions | Interchange / send-to; **no** Premiere-class live write API | macOS | Export target |
| Resolve | Python/Lua scripting | YES while Resolve running | Win/Mac/**Linux** | Optional interop; **not** SoR |
| OTIO | Library in **our** process | Editorial R/W | Linux-first | **YES — interchange** |
| CapCut | No verified deep NLE write API | — | — | Prior art Wave 2 only |

**REFUSE:** Invented “cloud Premiere/FCP/Resolve/CapCut write APIs” as War Room brain. Host scripting ≠ remote NLE SaaS.

### 1.7 Architecture sketch (PROPOSED)

```
HVS UI: Source | Program | Bins | Timeline | Inspector
        → typed EditCommands (preview|commit)
HVS Kernel: ProjectStore (.hvsproj) · TimelineEngine (tracks/clips/transitions/markers)
            EditCommandLayer (tx, undo, versions) · immutable media refs
        → OTIO adapters  |  FFmpeg proxy/preview/render (NVENC on Nebula when present)
```

**V1 slim (Blind Spot align):** ingest → bins → track timeline → insert/overwrite/split/trim/ripple-delete → markers → proxy playback → export. Not full FCP/Premiere parity.

### 1.8 Science — OTIO / GES / MLT timeline engines (VERIFIED CURRENT)

**OTIO (ASWF Apache-2.0)** — https://opentimelineio.readthedocs.io/ · https://github.com/AcademySoftwareFoundation/OpenTimelineIO
- Data model: Timeline → Stack → Track → Clip | Gap | Transition; MediaReference external; `opentime.RationalTime` / `TimeRange`.
- **Is:** editorial cut graph + interchange API (C++/Python). **Is not:** media container, preview compositor, or renderer.
- Linux OK. Adapters for EDL/AAF/FCPXML live under OpenTimelineIO org (separate repos) — expect **lossy** round-trip for HVS-only fields.
- **Fit:** interchange + AI-readable edit graph shape; **not** HVS project SoR.

**GES — GStreamer Editing Services** — https://gstreamer.freedesktop.org/documentation/gst-editing-services/
- Model: `GESTimeline` = set of `GESTrack` + `GESLayer`; layers hold `GESClip`s that spawn `GESTrackElement`s into tracks; `commit` builds pipeline.
- Linux-native; preview/render via GStreamer. License family = GStreamer LGPL stack (verify SPDX at pin).
- **Fit:** optional **compose/preview host** on Nebula — **not** OWNABLE project brain (same trap as Resolve scripting).

**MLT Framework** — https://www.mltframework.org/ · https://github.com/mltframework/mlt (LGPLv2.1 libraries)
- Model: Producer → Playlist/track → **Tractor** (multitrack + field of filters/transitions) → Consumer; XML project form documented.
- Powers Shotcut/Kdenlive-class tools; `melt` CLI = test/editor tool (note: melt binary licensing historically GPL — prefer **linking LGPL libs**, not shipping melt as product core without Legal check).
- **Fit:** optional render/compose engine candidate; **not** `.hvsproj` SoR.

**Mechanism RECOMMENDATION (Science):**
1. **SoR** = HVS track timeline + typed EditOps (hybrid C) — aligns OTIO Track lists.
2. **Export path** = OTIO (± FCPXML/EDL later) — disclose lossy fields.
3. **Media path** = FFmpeg proxies/render first (Legal: prefer LGPL build, no redistributable `--enable-nonfree`).
4. **Compose host** = evaluate GES *or* MLT in Wave 7 spike — pick one for preview graph; never dual SoR.
5. CapCut / TrackSubject remain Wave 2 / Wave 3 — out of Domain 1 SoR.

### 1.8 Linux / Nebula notes

- Prefer OTIO + FFmpeg (LGPL discipline) + optional GStreamer/GES or MLT on Nebula Linux CUDA workers.
- Resolve Studio on Linux = optional reference/interop.
- Avoid Apple-only required codecs/APIs.

---

## Domain 2 findings

**Deferred to Wave 2.** CapCut filters/effects/transitions/themes prior art + **HVS ThemeSpec** engine → `waves/WAVE_2.md` (draft). CapCut ≠ SoR; no CapCut scrape/SDK dependency.

---

## Domain 3 findings

**Deferred to Wave 3.** TrackSubject stack, commercial auto-reframe/object track, OSS SAM2/ByteTrack/MediaPipe → `waves/WAVE_3.md` (draft). Camera Domains 4–5 also Wave 3 per PA map.

---

## Recommendations for Higher Vision

1. **Hybrid timeline:** traditional tracks as SoR; magnetic-style behavior as EditOps/optional Story UX.  
2. **Own `.hvsproj` + EditCommandLayer;** OTIO in/out; FFmpeg media path.  
3. **Match capability classes** from FCP/Premiere/Resolve — never clone proprietary UI or CapCut packs.  
4. **Do not embed** CapCut/FCP/Premiere/Resolve as runtime SoR; Resolve Linux scripting = optional interop only.  
5. **HVS ≠ Media Player ≠ Terra** hard.  
6. **V1 slim editor** before full trim suite / multicam / OpenFX.  
7. After Effects/Fusion-class depth = **compositing lane later**, not Wave 1 cut SoT.

---

## Open questions / UNVERIFIED

| ID | Question | Status |
|---|---|---|
| Q-D1-1 | Custom TimelineEngine vs MLT vs GStreamer/GES? | **PARTIALLY ANSWERED (Science)** — SoR≠GES/MLT; FFmpeg first; GES *or* MLT compose spike Wave 7 |
| Q-D1-2 | `.hvsproj` JSON vs JSON+SQLite? | OPEN — Wave 7 |
| Q-D1-3 | Hybrid UI: mode toggle vs separate Story surface? | OPEN — UX |
| Q-D1-4 | FCPXML/AAF/xmeml lossless round-trip | FUTURE |
| Q-D1-5 | Resolve scripting README pin for exact Linux env vars on Nebula image | UNVERIFIED until install-side read |
| Q-D1-6 | Nebula GPU SKU/VRAM for proxy concurrency | HOLD until inventory |
| Q-D1-7 | AppleScript deep FCP write | UNVERIFIED — do not claim |

---

## Sources

1. Apple Magnetic Timeline: https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac  
2. Apple Connect clips: https://support.apple.com/guide/final-cut-pro/connect-clips-ver7a77ef9e/mac  
3. Apple Insert / Arrange (FCP User Guide siblings)  
4. Apple FCPXML Reference: https://developer.apple.com/documentation/professional-video-applications/fcpxml-reference  
5. Adobe Edit video in Premiere: https://helpx.adobe.com/premiere/desktop/edit-projects/intro-to-editing/edit-video-in-premiere.html  
6. Adobe Premiere UXP: https://developer.adobe.com/premiere-pro/uxp/ · SequenceEditor ppro-reference  
7. Adobe AE Composition basics / layers HelpX  
8. Blackmagic DaVinci Resolve: https://www.blackmagicdesign.com/products/davinciresolve  
9. Blackmagic Resolve 20 Editors Guide: https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Editors-Guide.pdf  
10. OTIO timeline structure: https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html  
11. OTIO GitHub Apache-2.0: https://github.com/AcademySoftwareFoundation/OpenTimelineIO  
12. FFmpeg legal: https://www.ffmpeg.org/legal.html  
13. Internal folds: `historian-wave1-lineage.md` · `/workspace/terra-swarm/HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` · Master Research Report (architecture lens) · concurrent Avenger WAVE_1 evidence addendum (API table)

---

## Stamp: WAVE_1 DONE | READY FOR WAVE 2

**WAVE_1 DONE** — Domain 1 (NLE foundation) stamped for Commander Mark.  
**READY FOR WAVE 2** — CapCut-style creative / ThemeSpec (`WAVE_2.md` draft seeded).  
**Wave 3 seeded** — Subject track + camera (`WAVE_3.md` draft).

*Research only. No code / build / commit.*

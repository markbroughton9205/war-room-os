# HVS WAVE A — NLE / OTIO / Subject-follow / CameraSpec / EditOps
# Source: Science Analyst → PA (2026-09-20) | MODE: RESEARCH ONLY
# Labels: ESTABLISHED | PARTIAL | PROPOSED | VAPOR

## 1) Timeline models
| Model | Mechanism | Tradeoff |
|---|---|---|
| Fixed tracks | Vertical lanes; clips don’t auto-ripple (Premiere/Avid-class) | Precise layering; more manual gaps |
| Magnetic | Gaps close; storylines (FCPX-class) | Fast assemble; weaker multi-layer mental model |
| **Hybrid (PROPOSED HVS)** | Track-based **authoring truth** + magnetic *ops* (ripple as EditOp) | Matches OTIO; export FCPXML/xmeml with known loss |

## 2) OTIO vs FFmpeg — ESTABLISHED split
- **OTIO** (ASWF): Timeline → Stack → Tracks → Clip/Gap/Transition; rational time; **interchange + edit graph**, not a renderer. Docs: https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html
- **FFmpeg**: decode/encode/filter/concat/NVENC — **render/proxy**, not the NLE model.
- Fit: OTIO = source of truth → adapters for round-trip; FFmpeg lowers OTIO to media. Do **not** claim Premiere parity from FFmpeg alone (gaps/layers/effects often PARTIAL).

## 3) Subject-follow pipeline
1. Prompt subject (click/box/mask) on keyframe
2. **SAM2** init_state → add_new_points_or_box → propagate_in_video → masklets ([Meta SAM2](https://ai.meta.com/research/sam2/), [github.com/facebookresearch/sam2](https://github.com/facebookresearch/sam2))
3. Optional ByteTrack/detector IDs for multi-object boxes (not pixel masks)
4. bbox/centroid → **CameraSpec** keyframes or matte
5. Human correct bad frames → re-propagate
- **ESTABLISHED:** SAM2 VOS
- **PARTIAL:** long occlusions, ID swaps, realtime 4K without GPU
- **VAPOR:** one-click Hollywood follow with zero correction

## 4) CameraSpec (PROPOSED canonical)
```
CameraSpec {
  time: RationalTime,
  framing: { cx, cy, width, height } | { fov, lookAt },
  transform: { pan, tilt, roll, zoom },
  easing: linear|easeInOut|hold,
  source: "manual"|"subject_follow"|"ai_edit",
  subjectId?: string,
  confidence?: 0..1,   // never invent high conf
  provenance: { model?, version?, promptedAt? }
}
```
Store as OTIO metadata or sidecar JSON; render via FFmpeg crop/zoompan or GPU compositor.

## 5) AI edit-command layer (PROPOSED)
NL → **typed EditOp** only (never raw ffmpeg from model):
`Trim | Split | RippleDelete | Insert | Overlay | AddTransition | SetCameraSpec | SubjectFollow | ExportProxy`
Validate → apply to OTIO → optional preview. Confirm destructive cuts. Separate **Observed** (media hashes, OTIO) from **Scenario** (AI suggestions).

## 6) Linux / Nebula GPU — HARDWARE CORRECTION vs Science note
Science note assumed Nebula-Genesis = Windows only. **Live War Room host (2026-09-20):**
- **Nebula Linux** `machineId 153e10ec-c150-4a0e-b21e-d01ccfbe33d6` — CONNECTED; `/home/chosenone/Codex/war-room-os` lives here (preferred CUDA/NVENC worker path if NVIDIA present).
- **Nebula Windows** `37425d23-1052-424f-b188-f060ca03150f` — often offline; WSL2 CUDA = PARTIAL until proven.
- **HOLD** realtime 4K follow until VRAM+fps byte-proven on target GPU.
- Recommend: author UI anywhere; **heavy track/render on Linux CUDA** when available; OTIO as wire format.

## Cursor delta sketch
HVS: hybrid timeline (tracks truth + magnetic ops) · OTIO SoT · FFmpeg render/proxy · SAM2 → CameraSpec · AI = typed EditOps only · GPU workers Linux CUDA preferred. Research only. STOP unless implement authorized.

## Legal locks (Legal Researcher FYI, fold Domain 32)
AI commercial ToS (Runway/ElevenLabs/Adobe); client footage contracts; CapCut/Adobe scrape REFUSE; OTIO Apache-2.0 / FFmpeg LGPL; beauty+AI replica consent; provenance tags.

---

# WAVE A EXTENSION — Domains 1–5 + Domain 6 sketch
# Appended 2026-09-20 ~14:20 ET | Evidence lane | RESEARCH ONLY
# Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE
# Does NOT replace Science sections 1–6 above — extends with official citations.

## Domain 1 — Professional timeline / NLE architectures

### VERIFIED CURRENT (official docs, Sept 2026)

**Final Cut Pro — Magnetic Timeline (trackless)**
- Primary storyline = main spine; insert/trim/move ripples neighbors to avoid gaps/collisions.
- Connected clips attach above (B-roll/titles) or below (SFX/music); move with anchor.
- Connected storylines group connected clips; Position tool + gap clips suspend magnetism for overwrite placement.
- Sources: Apple Support — [Intro to Magnetic Timeline](https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac); [storylines](https://support.apple.com/guide/final-cut-pro/storylines-ver2bea6bc6/mac).
- License: proprietary commercial (Apple). No public timeline-engine SDK. Linux: not native.

**Adobe Premiere Pro — Track-based Sequence + UXP edit actions**
- Sequence contains video/audio tracks; insert/overwrite/remove are first-class.
- Official UXP DOM (Premiere v25.6+): `SequenceEditor.getEditor(sequence)` → `createInsertProjectItemAction`, `createOverwriteItemAction`, `createRemoveItemsAction`, `createCloneTrackItemAction`; execute via `project.lockedAccess` + `executeTransaction`.
- Sources: [Premiere UXP APIs](https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/); [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/).
- License: proprietary (Adobe Creative Cloud). Extensibility = plugin surface, not engine source. Linux: no desktop NLE.

**DaVinci Resolve — Shared timeline + page architecture**
- Pages: Media, Cut, Edit, Fusion (node comps via MediaIn/MediaOut), Color, Fairlight (up to 2,000 tracks claimed with Fairlight Audio Core), Deliver; Photo page in Resolve 21.
- Edit = traditional tracks; Fusion = node graph; Fairlight = DAW-class audio; Neural Engine powers Magic Mask, Smart Reframe, IntelliSearch, etc. (many Studio-gated).
- Sources: [Blackmagic DaVinci Resolve product](https://www.blackmagicdesign.com/products/davinciresolve); Resolve 20 Fusion VFX guide PDF (Blackmagic manuals).
- License: free Resolve + paid Studio ($295 one-time, vendor pricing). Linux: **official** (Mac/Windows/Linux) — strongest commercial NLE Linux path for Nebula.

**OpenTimelineIO — Interchange / edit-graph (not renderer)**
- Timeline → Stack → Track → Clip/Gap/Transition/Marker; rational time; external media refs; adapters for EDL/FCPXML/etc.
- Source: [OTIO docs](https://opentimelineio.readthedocs.io/en/latest/); [GitHub ASWF](https://github.com/AcademySoftwareFoundation/OpenTimelineIO).
- License: **Apache-2.0** (ASWF). Linux: first-class.

**FFmpeg — Render/proxy/filter, not NLE model**
- Decode/encode/filter/concat; optional NVENC/VAAPI. Default **LGPL 2.1+**; `--enable-gpl` → GPL; `--enable-nonfree` → unredistributable.
- Source: [ffmpeg.org/legal.html](https://www.ffmpeg.org/legal.html).

### PROPOSED HVS
- **Hybrid timeline:** track-based **authoring truth** (Premiere/Resolve-class layering) + magnetic **EditOps** (ripple/gap as typed commands) — aligns Science §1 + OTIO SoT.
- Internal project format owns full graph; OTIO as interchange export/import (lossy for proprietary effects — disclose).
- Do **not** embed CapCut, FCP, Premiere, or Resolve as runtime dependency.

### FUTURE
- Full FCPXML/AAF/xmeml round-trip parity; nested compound with lossless effect graphs; multi-user OTIO CRDT collab.

### Linux / Nebula notes
- Prefer OTIO + FFmpeg (LGPL build discipline) + optional GStreamer/MLT (LGPL) on Nebula Linux GPU workers.
- Resolve Studio on Linux is optional **reference/interop** tool, not HVS core.

---

## Domain 2 — CapCut-style creative system (OUR engine)

### VERIFIED CURRENT (CapCut Help — concept inventory only)
- Templates: in-app Templates tab + Explore; search keywords; Use Template; availability varies by mobile/PC/web, region, account, version.
- Effects categories documented in Help: Cinematic, Retro, Glitch, AI Effects, Stylize, Blur, Color Grading, Transitions; intensity adjust where supported.
- Cloud library: effects/templates can be removed (licensing/campaigns); “Recently Used” may vanish; Save Template / export early advised.
- Sources: [new-templates](https://www.capcut.com/help/new-templates); [search templates](https://www.capcut.com/help/how-to-search-for-templates); [alternative effects](https://www.capcut.com/help/recommended-alternative-effects); [template-unavailable](https://www.capcut.com/help/template-unavailable); [ai-templates-and-effects](https://www.capcut.com/help/ai-templates-and-effects).
- License: proprietary (ByteDance/CapCut). **REFUSE:** scrape CapCut/Adobe assets or copy proprietary UI; no CapCut SDK assumed.

### PROPOSED HVS
- Own **Theme / Filter / Effect / Template** packages encapsulating: typography, captions, grade/LUT, transitions, music bed refs, pacing, logo slots, MGFX, overlays, aspect presets.
- Theme IDs examples (content, not CapCut clones): `luxury_salon`, `beauty_product`, `cinematic_teal`, `tiktok_fast`, `youtube_intro`, `gaming_neon`, `documentary_clean`.
- Apply via EditOp `ApplyTheme(themeId, scope)` — non-destructive stack on timeline clips.

### FUTURE
- Community theme marketplace with provenance + license gates; AI-suggested theme from brand kit.

---

## Domain 3 — AI person / subject following

### VERIFIED CURRENT
- **Resolve Magic Mask** (Studio / Neural Engine): brush → person/object matte → track; Resolve 21 “Render in Place” caches matte for playback (vendor + trade coverage). Product page groups AI tools incl. Smart Reframe, facial tools. Source: Blackmagic Resolve product + manuals.
- **Premiere Object Mask / mask tracking:** Effect Controls track masks; Auto Reframe for aspect (see Domain 5). Source: Adobe HelpX masking / Auto Reframe pages.
- **FCP object tracking / Magnetic Mask / Auto Mask:** Apple User Guide sections on tracking & masking (Mac).
- **CapCut motion tracking:** attach text/stickers/effects to moving subject (Help/tools pages) — creator-grade, not pro matte pipeline.
- **OSS — SAM 2 (Meta):** video object segmentation; `init_state` → points/box → `propagate_in_video` → masklets. Repo: [facebookresearch/sam2](https://github.com/facebookresearch/sam2). Research page: [ai.meta.com/research/sam2](https://ai.meta.com/research/sam2/). License: check repo LICENSE at integrate time (do not assume commercial without verify).
- Detectors/trackers (PARTIAL until pinned): ByteTrack-class ID boxes ≠ pixel masks.

### PROPOSED HVS
- Stack (Science §3): `TrackSubject(id) → masklets/bbox → CameraSpec keyframes → crop/composite`.
- Human correction loop mandatory; confidence fields; never silent delete source.

### FUTURE
- Realtime 4K follow on Nebula GPU (HOLD until VRAM+fps byte-proven).
- Hair-aware STARRDOM segmentation lane (Domain 10) as specialized model route.

---

## Domain 4 — AI camera system (TWO meanings — do not mix)

### VERIFIED CURRENT — A. Real multicam
- Premiere: Clip → Create Multi-Camera Source Sequence; sync Timecode / In-Out / Marker / Audio; Multi-Camera View switch. Sources: [create multi-camera source](https://helpx.adobe.com/premiere/desktop/edit-projects/set-up-multi-camera-sequences-for-editing/create-a-multi-camera-source-sequence.html); target sequence HelpX sibling.
- FCP: multicam clips, angle cut/switch (Apple Guide).
- Resolve Cut page: sync bin / source overwrite / Multi Source (vendor product copy).

### VERIFIED CURRENT — B. Generative / virtual camera language
- Provider camera control varies (prompt vs trajectory vs ref video) — Domain 8 matrix PENDING Wave B; do not invent APIs.
- Structural intent ≠ text-only prompt.

### PROPOSED HVS
- Keep **MulticamSession** (sync, angles, switch) separate from **CameraSpec** (Science §4 framing/transform/easing/provenance).
- AI Director emits CameraSpec or MulticamSwitch EditOps — never conflate.

### FUTURE
- Learned best-angle from speaker detection; generative CameraSpec from storyboard shot list.

---

## Domain 5 — AI camera follows a person / auto-reframe

### VERIFIED CURRENT
- **Premiere Auto Reframe:** Sequence → Auto Reframe Sequence; target aspect; Motion Tracking presets Slower / Default / Faster; duplicates sequence with Auto Reframe effect; optional clip nesting. Updated Apr 15, 2026. Source: [helpx.adobe.com Auto Reframe sequences](https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/add-auto-reframe-effect-to-a-sequence.html).
- **Resolve Smart Reframe** (Studio): Inspector subject track / ref point → reframe (manual + vendor docs).
- **FCP Smart Conform:** framing adjust for vertical/square projects (Apple Guide).

### PROPOSED HVS
- Modes: center lock, rule-of-thirds, lead room, face/upper/full-body/product lock; smooth vs aggressive; crop limits.
- Pipeline: subject track + saliency + CameraSpec smoothing → 16:9→9:16 without dumb center crop.
- EditOps: `AutoReframe(targetAspect, mode)`, `SetCameraSpec(...)`.

### FUTURE
- Multi-subject priority ranking; STARRDOM hair-priority lock during reveal.

---

## Domain 6 — AI Editor / AI Director edit-command layer (SKETCH)

### VERIFIED CURRENT (pattern evidence, not HVS API)
- Premiere UXP proves **typed Action + transaction** pattern for timeline mutation (insert/overwrite/remove/clone) — commercial host, but validates command-layer architecture.
- OTIO proves serializable edit graph independent of UI clicking.
- CapCut/Descript prove NL→edit UX commercially, but **no public schema for HVS to copy**.

### PROPOSED HVS (Science §5 expanded)
Typed EditOps only (NL → validate → transaction → OTIO apply → preview):
`InsertClip | OverwriteClip | Trim | Split | RippleDelete | Lift | Extract | Move | Replace | SetSpeed | Freeze | Reverse | AddTransition | ApplyEffect | ApplyFilter | ApplyTheme | TrackSubject | SetCameraSpec | AutoReframe | AddCaption | SetAudio | DuckMusic | ApplyGrade | GenerateMedia | CreateVersion | Render | ExportProxy`
- Requirements: undo/redo stack, version history, deterministic replay, AI explanation string, preview-before-commit, non-destructive defaults, checkpoints.
- Separate **Observed** (media hashes, OTIO) from **Scenario** (AI suggestions).
- Confirm destructive ops with Commander/user policy.

### FUTURE
- Full natural-language Director for STARRDOM 30s luxury ad end-to-end (V1 acceptance bar — see master report §23).

---

## Infra license quick-ref (Linux / Nebula)

| Component | License (official) | Role | Linux |
|---|---|---|---|
| OpenTimelineIO | Apache-2.0 | Edit graph / interchange | Yes |
| FFmpeg | LGPL 2.1+ default; GPL if `--enable-gpl` | Decode/encode/filter | Yes |
| GStreamer | LGPL 2.1+ | Pipeline alt | Yes |
| MLT | LGPL 2.1+ | Framework (Shotcut/Kdenlive lineage) | Yes |
| OpenColorIO | ASWF (BSD-style / check repo) | Color | Yes; Vulkan GPU path in v2.5 |
| OpenFX | BSD-3-Clause (ASWF) | Effect plugins | Host-dependent |
| Blender | GPLv2+ source; binaries GPLv3+; Cycles Apache-2.0 | 3D/compositor peer | Yes |
| Natron | GPLv2 | Node compositor peer | Yes |
| CapCut / Adobe / Apple NLE | Proprietary | Concept reference ONLY | CapCut/Adobe no Linux NLE; Resolve yes |

## Blind-spot locks
- No CapCut/Adobe scrape; no proprietary UI clone; no invented APIs; no “FFmpeg = Premiere”; no silent source delete; beauty/identity preservation for STARRDOM; commercial ToS per provider before ship.
- Research only — no war-room-os code from this wave.


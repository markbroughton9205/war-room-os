# HVS WAVE 3 — Subject Follow + CameraSpec + AI Camera
# STATUS: COMPLETE (research deliverable) | 2026-09-20 ~14:45 ET | RESEARCH ONLY
# Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE | PARTIAL | VAPOR | REFUSE
# Domains: 3, 4, 5 → Report §§ 6, 7 (+ 18/19/24/27 partial)
# Seed: do NOT contradict `../HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` ESTABLISHED SAM2 VOS + CameraSpec

---

## 0. Executive recommendation (PROPOSED HVS)

1. **Subject follow stack (ESTABLISHED pattern + PROPOSED HVS wiring):**  
   `prompt subject → SAM2 VOS masklets → optional detector/ByteTrack IDs → bbox/centroid → CameraSpec keyframes → crop/zoompan or GPU compositor`. Human correction loop is **mandatory**.
2. **Never conflate (A) real MulticamSession** (sync angles, switch cuts) **with (B) generative/virtual CameraSpec** (framing/transform on a single plate or generated shot). Separate EditOps and schemas.
3. **CameraSpec** = Wave A Science §4 canonical struct — store in OTIO namespaced metadata **and/or** sidecar JSON; render via FFmpeg crop/zoompan **or** Nebula GPU compositor. Do not invent high `confidence`.
4. **AI follow-person modes:** center lock, rule-of-thirds, lead room, face/upper/full-body/product lock; smooth vs aggressive; 16:9→9:16 without dumb center crop — patterns verified from Premiere Auto Reframe / Resolve Smart Reframe / FCP Smart Conform UX, **not** their engines.
5. **Linux / Nebula:** prefer Linux CUDA workers (`machineId 153e10ec…`). **HOLD** realtime 4K follow until VRAM+fps byte-proven on target GPU.
6. **REFUSE:** Google Street View as HVS camera source (N/A); claiming Hollywood one-click subject follow with zero correction (**VAPOR**); CapCut/Adobe scrape; invented NLE tracking APIs.

---

## 1. Domain 3 — AI person / subject following

### 1.1 Taxonomy (definitions for HVS — do not mix)

| Term | Meaning | Typical output |
|---|---|---|
| Object / person tracking | Follow instance across frames | bbox + ID |
| Face / body / hand / pose | Specialized landmarks | keypoints / skeleton |
| Semantic segmentation | Class labels per pixel | class map |
| Instance segmentation / VOS | Per-object pixel masks over time | masklets |
| Depth | Per-pixel or relative depth | depth map |
| Camera tracking (SfM/SLAM) | Recover camera path in 3D | extrinsics |
| Optical flow | Dense motion vectors | flow field |
| Re-ID | Match identity across shots/cuts | ID association |

**PROPOSED HVS primary lane for “follow Jasmine”:** instance VOS (SAM2) → CameraSpec. Pose/face/optical-flow are **optional enhancers**, not replacements.

### 1.2 VERIFIED CURRENT — Commercial NLE subject/mask patterns (official docs only)

#### Adobe Premiere Pro — Object Mask + mask tracking + Auto Reframe (Domain 5 overlap)

| Capability | Status | Official basis |
|---|---|---|
| Object Mask (AI) isolates people/objects; click or rectangle/lasso; tracks through shot | VERIFIED CURRENT | Adobe HelpX Object masking (doc dated May 27, 2026 in locale pages; feature in product Help tree) |
| First use downloads AI models; Progress panel; unusable until download completes | VERIFIED CURRENT | Same HelpX |
| Classic mask track forward/back/1-frame in Effect Controls | VERIFIED CURRENT | HelpX Track masks (updated Mar 9, 2026) |
| Auto Reframe Sequence duplicates sequence; applies Auto Reframe per clip; Motion Tracking Slower / Default / Faster | VERIFIED CURRENT | HelpX Auto Reframe sequences (updated Apr 15, 2026) |
| Complex multi-POI / rapid motion may need manual keyframe fine-tune after reframe | VERIFIED CURRENT | Same — Adobe explicitly notes fine-tuning |
| Public embeddable tracking SDK for HVS | **Cannot verify** | Extensibility = plugin/UXP surface, not engine source |
| Native Linux Premiere | **REFUSE claim** | No desktop Linux NLE |

**Sources:**
- https://helpx.adobe.com/premiere/desktop/add-video-effects/work-with-masks/object-masking.html
- https://helpx.adobe.com/premiere/desktop/add-video-effects/work-with-masks/track-masks.html
- https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/add-auto-reframe-effect-to-a-sequence.html

**License:** proprietary (Adobe Creative Cloud). **HVS fit:** Prior art for UX + proof that **correction after auto** is expected — not a runtime dependency.

#### DaVinci Resolve — Magic Mask + Smart Reframe (Studio / Neural Engine)

| Capability | Status | Official basis |
|---|---|---|
| DaVinci AI Neural Engine powers Magic Mask (object isolation/tracking), Smart Reframe, facial tools, etc. | VERIFIED CURRENT (vendor product) | Blackmagic Resolve Studio product page |
| Magic Mask / Smart Reframe listed Studio-gated in Studio feature matrix PDF | VERIFIED CURRENT | DaVinci Resolve Studio and iPad Features PDF (vendor SupportNotes) |
| Resolve 21 Magic Mask “Render in Place” caches tracked mask as traveling matte / external matte for lighter playback | VERIFIED CURRENT | What’s New + Apr 2026 release notes (Blackmagic) |
| Smart Reframe used with vertical/square timeline settings for social | VERIFIED CURRENT (product copy) | What’s New — Vertical Resolution + Smart Reframe |
| Linux official builds | VERIFIED CURRENT | Product page |
| Exact brush→track API for third-party host | **Cannot verify** | Proprietary Neural Engine |

**Sources:**
- https://www.blackmagicdesign.com/products/davinciresolve/studio/
- https://www.blackmagicdesign.com/products/davinciresolve/whatsnew
- https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_Studio_20_Features.pdf
- https://www.blackmagicdesign.com/media/release/20260414-01

**PROPOSED HVS:** Resolve Studio on Linux = optional **reference/interop** for Magic Mask-class grading mattes — **not** HVS core runtime.

#### Final Cut Pro — Magnetic Mask + object tracking + Smart Conform

| Capability | Status | Official basis |
|---|---|---|
| Magnetic Mask isolates people/objects/shapes via ML; applies across clip; refine with add/remove eyedropper, brushes, feather, reference frames | VERIFIED CURRENT | Apple Support — Add / Edit Magnetic Masks |
| Analyze Forward / Backward / Analyze entire clip | VERIFIED CURRENT | Add Magnetic Mask to effect |
| Object tracking: Point Cloud + Machine Learning methods; bbox around recognized people/animals/objects | VERIFIED CURRENT | How does object tracking work? |
| Smart Conform analyzes faces / visual interest; reframes for aspect mismatch; manual Transform Position after | VERIFIED CURRENT | Adjust framing with Smart Conform |
| Apple silicon recommended for Magnetic Mask performance | VERIFIED CURRENT (vendor note) | Add Magnetic Masks best practices |
| Native Linux | **REFUSE claim** | Mac-only |

**Sources:**
- https://support.apple.com/guide/final-cut-pro/add-magnetic-masks-ver1d67e3a53/mac
- https://support.apple.com/guide/final-cut-pro/edit-magnetic-masks-ver43e886e74/mac
- https://support.apple.com/guide/final-cut-pro/how-does-object-tracking-work-vere9b794f29/mac
- https://support.apple.com/guide/final-cut-pro/adjust-framing-with-smart-conform-ver26664d93f/mac
- https://support.apple.com/guide/final-cut-pro/create-square-or-vertical-versions-of-a-project-ver8bad7adc6/mac

#### CapCut — motion tracking (creator-grade)

| Capability | Status | Notes |
|---|---|---|
| Motion tracking attaches text/stickers/effects to moving subject | VERIFIED CURRENT as **product marketing / tools pages** | Creator-grade attach-to-motion — **not** pro matte pipeline |
| Public tracking API | **UNVERIFIED / REFUSE for dependency** | Wave 2 CapCut API lock |

**Source (marketing):** https://www.capcut.com/tools/motion-tracking — treat as vendor claim, not engine docs.

### 1.3 VERIFIED CURRENT — OSS SAM 2 VOS pipeline (ESTABLISHED — Wave A Science)

**Do not contradict Wave A:** SAM2 VOS is **ESTABLISHED** for HVS research stack.

| Field | Value | Label |
|---|---|---|
| What | Promptable image+video segmentation; session memory; multi-object masklets | VERIFIED CURRENT |
| Official research | https://ai.meta.com/research/sam2/ | VERIFIED CURRENT |
| Official repo | https://github.com/facebookresearch/sam2 | VERIFIED CURRENT |
| License | **Apache-2.0** (repo LICENSE fetched 2026-09-20) | VERIFIED CURRENT |
| Local run | Yes (PyTorch; CUDA preferred) | VERIFIED CURRENT |
| Commercial use | Apache-2.0 permits use/mod/distrib with attribution — **Legal still reviews ToS of any hosted weights CDN + model card at integrate time** | PARTIAL (legal gate) |
| API / SDK | Python `SAM2VideoPredictor` — research library, not NLE plugin | VERIFIED CURRENT |
| Linux | First-class | VERIFIED CURRENT |
| Integration realistic? | Yes as **offline/async worker** on Nebula CUDA | PROPOSED HVS |
| Build own equivalent? | No for V1 — integrate SAM2; own **CameraSpec + EditOps + correction UI** | PROPOSED HVS |

**Canonical pipeline (official README / video predictor pattern):**

```
build_sam2_video_predictor(cfg, checkpoint)
state = predictor.init_state(video_path_or_frames)
predictor.add_new_points_or_box(state, frame_idx, obj_id, points|box|…)
for frame_idx, obj_ids, mask_logits in predictor.propagate_in_video(state):
    masks = mask_logits > 0   # masklets
# Human corrects bad frames → additional prompts → re-propagate
```

Optional: `vos_optimized=True` / `torch.compile` for speed (repo RELEASE notes) — treat as **PARTIAL** until Nebula-proven.

**PARTIAL (honest limits):**
- Long occlusions, ID swaps, crowded scenes, extreme motion blur.
- Realtime 4K interactive follow without sufficient VRAM/fps — **HOLD**.
- Hair-strand STARRDOM beauty matte quality — specialized route (**FUTURE**, Domain 10).

**VAPOR:** One-click Hollywood follow with **zero** human correction on production footage.

### 1.4 Detector association — ByteTrack-class (PARTIAL until pinned in build)

| Field | Value | Label |
|---|---|---|
| Role | Associate **detection boxes** across frames (multi-object IDs) — **not** pixel masks | PROPOSED HVS optional |
| Official repo | https://github.com/FoundationVision/ByteTrack (also ifzhang/ByteTrack lineage) | VERIFIED CURRENT OSS |
| License | MIT (repo LICENSE) — review YOLOX / third-party deps separately | VERIFIED CURRENT (primary) |
| Fit with SAM2 | Detector/ByteTrack proposes boxes/IDs → SAM2 refines to masklets **or** CameraSpec uses bbox only for coarse follow | PROPOSED HVS |
| Pinning | Do not claim “ByteTrack in V1” until Engineer pins version + detector weights + Linux CUDA bench | PARTIAL |

**REFUSE:** Claiming ByteTrack alone equals Magic Mask / Magnetic Mask quality.

### 1.5 PROPOSED HVS — TrackSubject stack

```
TrackSubject(subjectId, prompt={click|box|mask}, clipRef)
  → worker: SAM2 init_state → add_new_points_or_box → propagate_in_video
  → optional: detector/ByteTrack ID association for multi-person
  → TrackResult { masklets? | bboxes, centroids, confidence[], provenance }
  → CameraSpec keyframes (source="subject_follow")
  → preview crop → human CorrectSubjectFrame → re-propagate
  → never silent-delete source media
```

**EditOps (names; Wave 4 owns wire schema):**  
`TrackSubject` · `CorrectSubjectPrompt` · `ClearSubjectTrack` · `AttachOverlayToSubject` · `SetCameraSpec` · `AutoReframe`

**Confidence / provenance rules (PROPOSED HVS — lock):**
- `confidence` only from model scores or explicit user override; **never invent high confidence**.
- Missing score → omit field or set `null` / low default with `provenance.note="unscored"`.
- Store `model`, `version`/`checkpoint`, `promptedAt`, `workerHost` (e.g. Nebula Linux).
- Separate **Observed** (masks/hashes) from **Scenario** (AI suggested framing).

---

## 2. Domain 4 — AI camera system (TWO meanings — DO NOT MIX)

### 2.A VERIFIED CURRENT — Real multicam sync / switch

#### Premiere Pro Multi-Camera Source Sequence

| Sync method | Status | Notes |
|---|---|---|
| In Points / Out Points | VERIFIED CURRENT | Manual align |
| Timecode | VERIFIED CURRENT | Ignore Hours; Linear / Sound / Aux options documented |
| Audio | VERIFIED CURRENT | Waveform/audio-track sync |
| Clip Marker | VERIFIED CURRENT | Event markers |
| Create Single Multicam Source Sequence | VERIFIED CURRENT | Preserve gaps |
| Audio modes: Camera 1 / All Cameras / Switch Audio | VERIFIED CURRENT | Switch Audio enables audio-follows-video |
| Target sequence / Multi-Camera View switch | VERIFIED CURRENT | Sibling HelpX pages |

**Source:** https://helpx.adobe.com/premiere/desktop/edit-projects/set-up-multi-camera-sequences-for-editing/create-a-multi-camera-source-sequence.html (updated Jan 7, 2026)

#### Final Cut Pro / Resolve (pattern evidence)

| Product | Pattern | Label |
|---|---|---|
| FCP | Multicam clips; angle cut/switch (Apple User Guide) | VERIFIED CURRENT (product) |
| Resolve | Cut page sync bin / Multi Source; Studio “Multicam SmartSwitch” in feature matrix | VERIFIED CURRENT (vendor matrix — Studio gate) |

### 2.B VERIFIED CURRENT — Generative / virtual camera language

| Claim | Label |
|---|---|
| Generative video providers expose **varying** camera control (prompt text vs trajectory vs ref video vs motion brush) | VERIFIED CURRENT as **industry pattern** — exact APIs → **PENDING WAVE 5** |
| Structural CameraSpec ≠ text-only prompt | PROPOSED HVS (Wave A lock) |
| Inventing a specific “Veo/Runway camera path API” without citation | **REFUSE** |

### 2.C PROPOSED HVS — Separate schemas

| Schema | Owns | EditOps (sketch) |
|---|---|---|
| **MulticamSession** | angle media refs, sync method, sync offset, activeAngle, switch timeline | `CreateMulticamSession`, `SyncAngles`, `MulticamSwitch`, `SetActiveAngle` |
| **CameraSpec** | framing/transform/easing on **one** image plane (real crop or generative intent) | `SetCameraSpec`, `AutoReframe`, `TrackSubject→CameraSpec` |

**AI Director rule:** Emit **either** MulticamSwitch **or** SetCameraSpec — never a single blob that means both.

### 2.D FUTURE
- Learned best-angle from speaker detection (Resolve Speaker Detection = vendor Studio feature — pattern only).
- Generative CameraSpec from storyboard shot list (Wave 5 providers).

---

## 3. Domain 5 — AI camera follows a person / auto-reframe

### 3.1 VERIFIED CURRENT — Commercial auto-reframe behavior

| Product | Behavior (official) | Label |
|---|---|---|
| Premiere Auto Reframe | Target aspect; Slower/Default/Faster motion presets; duplicate sequence; optional nest; may need fine-tune | VERIFIED CURRENT |
| FCP Smart Conform | Analyzes faces / visual interest vs dumb center crop; Modify > Smart Conform; adjust Transform after; Duplicate Project As Vertical/Square + Smart Conform checkbox | VERIFIED CURRENT |
| Resolve Smart Reframe | Studio Neural Engine; vertical/square project settings + Smart Reframe | VERIFIED CURRENT (vendor) |

**Industry teaching (for HVS design):** Auto-reframe is **assistive** — commercial vendors document **manual correction**. Claiming zero-touch perfection = **VAPOR**.

### 3.2 PROPOSED HVS — Follow modes

| Mode | Framing intent |
|---|---|
| `center_lock` | Subject centroid → frame center |
| `rule_of_thirds` | Eyes/face on thirds intersections |
| `lead_room` | Bias empty space in motion direction |
| `face_lock` | Face bbox priority |
| `upper_body` / `full_body` / `product_lock` | Crop priority regions |
| `smooth` vs `aggressive` | Low vs high keyframe density / follow gain (maps conceptually to Premiere Slower/Faster — **own params**, not Adobe clone) |

**Pipeline:** subject track + optional saliency + CameraSpec smoothing + crop limits + zoom + composition → deliver 16:9 and 9:16.

**16:9→9:16:** Prefer tracked subject window over center crop (FCP Smart Conform explicitly contrasts center crop vs content-aware — HVS copies the **intent**, not Apple’s model).

### 3.3 Render path (PROPOSED HVS)

1. CameraSpec keyframes → normalized crop rectangle in source pixels.
2. **Lower to FFmpeg:** `crop` + `scale` / `zoompan` (LGPL discipline) for offline exports.
3. **Or GPU compositor** on Nebula Linux CUDA for interactive preview.
4. Never model→raw ffmpeg string (Wave 1/4 lock): typed `SetCameraSpec` / `AutoReframe` → deterministic lowerer.

---

## 4. CameraSpec canonical struct (Wave A — PROPOSED HVS, unchanged)

```
CameraSpec {
  time: RationalTime,                 // OTIO-compatible
  framing: { cx, cy, width, height }  // normalized or pixels — declare unit
           | { fov, lookAt },         // generative / virtual lens language
  transform: { pan, tilt, roll, zoom },
  easing: linear | easeInOut | hold,
  source: "manual" | "subject_follow" | "ai_edit" | "auto_reframe",
  subjectId?: string,
  confidence?: 0..1,                  // NEVER invent high conf
  provenance: { model?, version?, checkpoint?, promptedAt?, workerHost? }
}
```

### 4.1 Storage — OTIO metadata + sidecar

**VERIFIED CURRENT (OTIO):** Schema objects carry a free-form `metadata` dictionary (JSON-compatible); values pass through interchange; **namespace** keys to avoid collisions.  
Source: https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-file-format-specification.html

**PROPOSED HVS storage:**

| Location | Content |
|---|---|
| Clip / Track `metadata["HVS"]["cameraSpecs"]` | Array of CameraSpec (or sparse keyframe list) |
| Clip `metadata["HVS"]["subjectTracks"]` | TrackResult refs (mask paths, bbox series) |
| Sidecar `clipId.cameraspec.json` | Authoritative dense series for large tracks; OTIO holds pointer + hash |
| Internal HVS project DB | Full history + EditOp log (Wave 1 SoT) |

**OTIO role reminder (ESTABLISHED):** edit-graph / interchange — **not** renderer. Effects/CameraSpec semantics are HVS-owned; disclose loss on FCPXML/xmeml export.

Example (illustrative — PROPOSED):

```json
{
  "HVS": {
    "schemaVersion": 1,
    "cameraSpecs": [
      {
        "time": {"value": 120, "rate": 24},
        "framing": {"cx": 0.52, "cy": 0.41, "width": 0.42, "height": 0.75, "unit": "normalized"},
        "transform": {"pan": 0, "tilt": 0, "roll": 0, "zoom": 1.15},
        "easing": "easeInOut",
        "source": "subject_follow",
        "subjectId": "jasmine_01",
        "confidence": 0.71,
        "provenance": {"model": "sam2.1_hiera_l", "version": "facebookresearch/sam2", "promptedAt": "2026-09-20T14:40:00-04:00", "workerHost": "nebula-linux-153e10ec"}
      }
    ],
    "subjectTracks": {
      "jasmine_01": {"sidecar": "media/proxies/clipA.jasmine_01.track.json", "sha256": "…"}
    }
  }
}
```

---

## 5. Linux / Nebula GPU (HARDWARE — align Wave A correction)

| Item | Status |
|---|---|
| Nebula Linux `machineId 153e10ec-c150-4a0e-b21e-d01ccfbe33d6` preferred CUDA/NVENC worker path | VERIFIED CURRENT (inventory) |
| Nebula Windows often offline; WSL2 CUDA = PARTIAL until proven | VERIFIED CURRENT (Wave A) |
| Author UI anywhere; heavy track/render on Linux CUDA | PROPOSED HVS |
| Realtime 4K subject follow | **HOLD / FUTURE** until VRAM+fps byte-proven |
| Proxy-first follow (e.g. 720p/1080p track → apply CameraSpec to full-res) | PROPOSED HVS interim |

---

## 6. Build vs integrate vs refuse (Domain 3–5 slice)

| Own (BUILD) | Integrate | Refuse |
|---|---|---|
| CameraSpec schema, MulticamSession schema, TrackSubject EditOps, correction UI, OTIO metadata namespace, FFmpeg/GPU lowerer | SAM2 (Apache-2.0), optional ByteTrack (MIT + deps review), FFmpeg LGPL, OTIO Apache-2.0 | CapCut/Adobe/Apple tracking engines as SoR; scrape; invented APIs; Street View; VAPOR zero-correction claims; silent source delete |

---

## 7. Blind-spot locks (Wave 3)

- **Conflation trap:** Multicam switch ≠ virtual CameraSpec ≠ generative camera prompt.
- **Confidence trap:** Never invent high conf; unscored ≠ 0.99.
- **Vendor parity trap:** “We have Auto Reframe” must mean **HVS-owned** behavior, not Adobe binary.
- **Realtime trap:** Do not ship “4K live follow” marketing before Nebula bench.
- **Street View:** **REFUSE** — out of scope / N/A for HVS production camera.
- **Hollywood one-click:** **VAPOR** — commercial docs themselves expect fine-tuning.

---

## 8. Critical questions touched (assignment list)

| # | Topic | Wave 3 answer |
|---|---|---|
| Subject follow feasible? | Yes via SAM2 + CameraSpec on Linux CUDA workers | PROPOSED + ESTABLISHED SAM2 |
| Multicam vs generative camera? | Separate schemas/EditOps | PROPOSED HVS lock |
| Auto 9:16? | Yes as AutoReframe Assist + human gate | PROPOSED; vendor patterns VERIFIED |
| Realtime 4K? | HOLD | FUTURE until proven |

Others remain PENDING later waves.

---

## 9. FUTURE (not Wave 3 commit)

- Realtime 4K interactive follow on proven Nebula GPU.
- Hair-aware STARRDOM segmentation lane (Domain 10).
- Multi-subject priority ranking / speaker-driven MulticamSwitch.
- Learned composition policies beyond fixed lead-room heuristics.
- Full generative CameraSpec from shot lists once Wave 5 providers verified.

---

## 10. Sources (official URLs)

### Meta / OSS tracking
- https://ai.meta.com/research/sam2/
- https://github.com/facebookresearch/sam2
- https://github.com/facebookresearch/sam2/blob/main/LICENSE (Apache-2.0)
- https://github.com/FoundationVision/ByteTrack
- https://arxiv.org/pdf/2110.06864 (ByteTrack paper — technical, not product claim)

### Adobe Premiere
- https://helpx.adobe.com/premiere/desktop/add-video-effects/work-with-masks/object-masking.html
- https://helpx.adobe.com/premiere/desktop/add-video-effects/work-with-masks/track-masks.html
- https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/add-auto-reframe-effect-to-a-sequence.html
- https://helpx.adobe.com/premiere/desktop/edit-projects/set-up-multi-camera-sequences-for-editing/create-a-multi-camera-source-sequence.html

### Apple Final Cut Pro
- https://support.apple.com/guide/final-cut-pro/add-magnetic-masks-ver1d67e3a53/mac
- https://support.apple.com/guide/final-cut-pro/edit-magnetic-masks-ver43e886e74/mac
- https://support.apple.com/guide/final-cut-pro/how-does-object-tracking-work-vere9b794f29/mac
- https://support.apple.com/guide/final-cut-pro/adjust-framing-with-smart-conform-ver26664d93f/mac
- https://support.apple.com/guide/final-cut-pro/create-square-or-vertical-versions-of-a-project-ver8bad7adc6/mac

### Blackmagic Resolve
- https://www.blackmagicdesign.com/products/davinciresolve/studio/
- https://www.blackmagicdesign.com/products/davinciresolve/whatsnew
- https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_Studio_20_Features.pdf
- https://www.blackmagicdesign.com/media/release/20260414-01

### OTIO / FFmpeg
- https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-file-format-specification.html
- https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html
- https://www.ffmpeg.org/legal.html

### CapCut (creator pattern only)
- https://www.capcut.com/tools/motion-tracking

### Internal seeds
- `../HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` §§3–5, Domains 3–5
- `HVS_WAVE_1_NLE_FOUNDATION.md`
- `HVS_WAVE_2_CAPCUT_STYLE_CREATIVE.md`
- `../HVS_8_WAVES_PLAN.md`
- `/home/box/higher-vision-studios/HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md` Domains 3–5

---

## Document control

| Field | Value |
|---|---|
| Wave | 3 Subject follow + CameraSpec + AI camera |
| Status | COMPLETE (research only) |
| Domains | 3, 4, 5 |
| Lines target | ≥250 substantive |
| Code / commit / push / deploy | **NONE** |
| Next | Wave 4 AI Director EditOps OR Blind Spot challenge on Wave 3 |

**STOP:** Research only. No War Room application code from this wave.

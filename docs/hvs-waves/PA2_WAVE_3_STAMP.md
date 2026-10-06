# HVS WAVE 3 — SUBJECT FOLLOW + CAMERASPEC + AI CAMERA (Domains 3, 4, 5)
## Status / Date

| Field | Value |
|---|---|
| **Status** | **WAVE_3 DONE** — Domains 3, 4, 5 stamped · **READY FOR WAVE 4** |
| **Date** | Sunday Sep 20, 2026 · ~2:26 PM EDT (America/New_York) |
| **Commander** | Mark |
| **Mode** | RESEARCH ONLY — no code / build / commit |
| **Scope** | **Domains 3, 4, 5** — AI person/subject following; AI camera A vs B (do not mix); follow-person + smart reframe |
| **PA wave map** | `HVS_8_WAVES.md` Wave 3 · Subject follow + CameraSpec + AI camera |
| **Locks** | HVS ≠ Media Player ≠ Terra · **Do NOT mix real multicam with generative AI camera** · REFUSE invented NLE APIs · CapCut ≠ SoR · Linux-first (Nebula CUDA) · VERIFIED CURRENT / PROPOSED / FUTURE |
| **Prior file notes** | Replaces prior WAVE_3 draft that mis-scoped Domains 6/7/28 (AI Director → **Wave 4**). Folds/upgrades: `HVS_AI_VIDEO_CAMERA_FOLLOW_RESEARCH_SEP2026.md`, `WAVE_2_SEED.md`, `WAVE_2_MISFILED_CAMERA_from_old_map.md`. Wave 1/2 locks inherited. |

Claim tags: **VERIFIED CURRENT FEATURE** | **PROPOSED HVS FEATURE** | **FUTURE/EXPERIMENTAL** | **UNVERIFIED** | **VENDOR CLAIM**

---

## 0. Boundary locks (from WAVE_1 + WAVE_2 + Domain 3–5)

| Rule | Meaning |
|---|---|
| **HVS ≠ Media Player ≠ Terra** | Subject track / CameraSpec / multicam live in HVS studio lane only — not Media Player densify, not Terra Cesium |
| **A ≠ B ≠ C (mandatory UI split)** | **(A)** Real multicam sync/switch · **(B)** Generative CameraSpec · **(C)** Virtual follow / smart reframe on uploaded footage — one control must never mean all three |
| **Never present gen shots as alternate physical takes** without disclosure | Generative “angles” ≠ discrete sensors |
| CapCut / FCP / Premiere / Resolve = **UX benchmarks** | **No** War Room-callable public APIs for Smart Conform / Auto Reframe / Smart Reframe / CapCut Auto Reframe — **do not invent** |
| CapCut ≠ SoR | Study Auto Reframe UX only; never runtime dependency |
| Linux-first (Nebula) | Local TrackSubject stack preferred on CUDA; gen providers cloud-only via Provider Router |
| Labels mandatory | VERIFIED · PROPOSED · FUTURE · flag UNVERIFIED |
| Research ≠ shipped | Builds HOLD |

---

## 1. Domain 3 — Subject / person / face / body / hand / pose tracking

### 1.1 Taxonomy (do not conflate) — concepts = industry practice (`VERIFIED` as capability classes)

| Layer | What it is | Typical HVS use | Label |
|---|---|---|---|
| **Object tracking** | Bounding box / point track over time | Product label lock | Concept `VERIFIED` |
| **Face tracking** | Face bbox / landmarks | Beauty CU; 9:16 face lock | Concept `VERIFIED` |
| **Body tracking** | Full-body bbox / skeleton | Follow stylist walking | Concept `VERIFIED` |
| **Hand tracking** | Hand landmarks | Hair/product hand detail | Concept `VERIFIED` |
| **Pose estimation** | Joint keypoints (2D/3D) | Cut-on-action; motion transfer later | Concept `VERIFIED` |
| **Semantic segmentation** | Class masks (person, hair, skin) | Grade subject only; hair isolate | Concept `VERIFIED` |
| **Instance segmentation** | Per-instance masks | Blur everyone except subject | Concept `VERIFIED` |
| **Optical flow** | Dense motion field | Stabilize, interpolate, warp | Concept `VERIFIED` |
| **Re-ID** | Identity across shots/cuts | Same model across STARRDOM takes | Harder; often embedding + tracklet — `PROPOSED` quality bar |
| **Depth / camera tracking** | Scene depth / ego-motion | FUTURE compositing; not V1 follow core | `FUTURE/EXPERIMENTAL` for HVS V1 |

**Example command intents (Domain 3):** keep Jasmine centered; follow stylist; track hair; keep product label; blur everyone except subject; attach text to head; grade subject only; 16:9→9:16 face-centered; zoom with subject; virtual camera follow.

### 1.2 Target stack (`PROPOSED HVS FEATURE`)

```text
Detect → TrackSubject(id) → TrackData → VirtualCamera → Transform/keyframes → Reframe render
```

| Stage | Output | Notes |
|---|---|---|
| Detect | Boxes / prompts | Permissive-license detector (not AGPL Ultralytics in core without Enterprise) |
| TrackSubject(id) | Persistent ID + bbox/mask/landmarks over time | Re-init on cut; re-ID optional across clips |
| TrackData | Time series in `.hvsproj` | Frame-rational times; confidence; lock target type |
| VirtualCamera | Crop window + scale + easing | Follow modes (Domain 5) |
| Transform keyframes | Editable Motion/Position/Scale | Human override after AI pass |
| Reframe render | Proxy then master | Multi-aspect export path |

### 1.3 Commercial NLE auto-reframe / follow — UX benchmarks (`VERIFIED CURRENT FEATURE` apps; **no** War Room API)

| Product | Feature | Official behavior (Sept 2026 research) | Programmatic API for War Room? | Label |
|---|---|---|---|---|
| **Final Cut Pro** | **Smart Conform** | Analyzes faces / visual interest; reframes clips whose AR ≠ project AR; then manual Transform polish. Apple docs contrast default center-crop vs Smart Conform. **macOS only.** | **No** public edit API | `VERIFIED CURRENT FEATURE` (app) |
| **Adobe Premiere** | **Auto Reframe** (clip or sequence) | Sequence → Auto Reframe Sequence → duplicate sequence; effect on clips; Motion Tracking presets **Slower / Default / Faster**; optional Clip Nesting; manual keyframe polish. Help last updated **Apr 15, 2026**. | **No** for War Room automation (desktop effect / host UXP only — not Linux remote SoR) | `VERIFIED CURRENT FEATURE` |
| **DaVinci Resolve Studio** | **AI Smart Reframe** | Neural Engine; Inspector Transform → Auto or Reference Point; generates position keyframes. **Studio-gated** (free Resolve lacks Smart Reframe). Official Linux desktop exists — **reference/interop**, not HVS SoR. | **No** general public REST for reframe | `VERIFIED CURRENT FEATURE` (Studio) |
| **CapCut** | **Auto Reframe** | Aspect change with subject keep-in-frame; product pages cite stabilization / speed options; Pro gating reported on Help (region/account vary) | CapCut **not** integration target — UX study only | `VERIFIED CURRENT FEATURE` (product); **do not depend** |

**Blind Spot:** Do not claim FCP/Premiere/Resolve/CapCut expose War Room-callable reframe REST. Do not scrape CapCut.

### 1.4 Open-source trackers / segmenters viable on Linux GPU (`VERIFIED` projects; HVS use = `PROPOSED`)

| Project | License | What | Linux GPU | HVS fit | Label |
|---|---|---|---|---|---|
| **SAM 2** (Meta `facebookresearch/sam2`) | **Apache-2.0** (code/checkpoints; fonts separate) | Promptable image/video segmentation + mask propagation | CUDA typical | **Primary segmenter** for person/hair masks | Project `VERIFIED`; HVS pipeline `PROPOSED` |
| **ByteTrack** | **MIT** (original) | Multi-object association (high recall) | Yes | Tracker association layer | `VERIFIED` / `PROPOSED` use |
| **BoT-SORT** | **MIT** (original) | Stronger association + camera-motion compensation | Yes | Prefer over plain SORT when available | `VERIFIED` / `PROPOSED` use |
| **Ultralytics YOLO track** | **AGPL-3.0** (or Enterprise) | Built-in ByteTrack/BoT-SORT | Excellent | **License trap** for proprietary War Room unless Enterprise | Caution |
| **MediaPipe** Pose / Hands / Face | Apache-2.0 typical (confirm package NOTICE) | Landmarks | CPU/GPU/Edge | Beauty/hand/face lock | `VERIFIED` / `PROPOSED` use |
| **OpenCV** tracking / optical flow | Apache-2.0 | Classical trackers + Farneback/DIS | CUDA optional | Fallback / hybrid | `VERIFIED` |
| **CoTracker / TAPIR-class** | Varies | Point tracking | CUDA | Hair tips — **license case-by-case** | `FUTURE` until license cleared |

**Recommendation (`PROPOSED`):** Detector (YOLO **permissive weights** or Detectron2/Apache stack) → **ByteTrack/BoT-SORT (MIT)** → **SAM2** masks → MediaPipe landmarks optional → VirtualCamera. Avoid AGPL Ultralytics in core without Enterprise.

---

## 2. Domain 4 — AI Camera System (TWO MEANINGS — DO NOT MIX)

### 2.A Real footage / multicam (`VERIFIED` NLE UX + `PROPOSED` HVS)

| Capability | Exists today (official NLE UX) | War Room-callable NLE API? | HVS proposal | Label |
|---|---|---|---|---|
| Sync by audio / timecode | FCP multicam, Premiere multi-cam, Resolve multicam | **No** public REST to drive those NLEs | Sync service: audio fingerprint + TC; sync groups in `.hvsproj` | Sync patterns `VERIFIED`; HVS service `PROPOSED` |
| Angle viewer / cut switch | Yes in major NLEs | No | Edit Commands: `switchAngle`, `cutOnSpeaker` (Wave 4 schema link) | UX `VERIFIED`; commands `PROPOSED` |
| AI speaker / best-angle | **Resolve 20 Multicam SmartSwitch** (Studio): vendor docs claim auto-cut by active speaker using **audio + visual cues** (lip movement, wide vs CU) — first-pass then human finesse | No REST SoR | Local face + voice-activity → best-angle score | SmartSwitch product = `VERIFIED` (Studio VENDOR docs); quality/hype = treat as **first pass**, not magic; HVS scoring = `PROPOSED` |
| Continuity / reaction cuts | Mostly manual | No | Scoring heuristics | `FUTURE/EXPERIMENTAL` |

**Hard distinction:** Angles are **real recorded cameras**. Switching is an **edit/cut**, not synthesis. This is **NOT** generative video.

**VERIFIED vs hype (speaker / best-angle):**
- **VERIFIED:** Multicam sync + angle viewer exist in FCP/Premiere/Resolve; Resolve Studio advertises **Multicam SmartSwitch** and Smart Reframe as Neural Engine features (Studio feature matrix / New Features Guide).
- **HYPE / UNVERIFIED for HVS:** Claiming “AI always picks the perfect angle with cinematic continuity” — vendor copy positions SmartSwitch as a **good first pass**; reaction/continuity intelligence remains largely manual industry practice.
- **Do not invent** a Resolve/FCP/Premiere remote API that does not exist.

### 2.B Generative CameraSpec (`PROPOSED HVS FEATURE` — HVS-owned schema, not a claimed universal provider object)

Structured intent owned by HVS — serialize to verified provider fields + prompt language only:

```text
CameraSpec {
  shotSize: ECU | CU | MS | WS | EWS | ...
  angle: eye | low | high | dutch
  movement: { type: dolly|pan|tilt|truck|orbit|crane|handheld|static, intensity, easing }
  lens: { mmHint?, dof? }
  framing: { subjectId?, mode: center|thirds|leadRoom, lock: face|upper|full|product|hair }
  path?: keyframes[] | refVideo | firstLast
}
```

**Adapter rule:** CameraSpec → (1) cinematography **prompt string**, and/or (2) **verified** provider fields only. **Never invent** undocumented fields (e.g. unofficial Runway `camera_motion` JSON from Reddit).

#### Provider camera-control evidence (Sept 2026)

| Control type | Providers with evidence | Label |
|---|---|---|
| Prompt-only cinematography | Google Veo, Runway Gen4.5, Firefly Video, most Seedance calls; OpenAI Sora while still live | `VERIFIED` (prompt path) |
| Start/end frame / interpolation | Veo, Luma, Kling (select), Runway wrappers | `VERIFIED` |
| Multi-keyframe at frame indexes | **Luma Ray 3.2** — `keyframes` + `keyframe_indexes` (1–64; 5s→0–120 / 10s→0–240 @24fps); official Agents docs | `VERIFIED CURRENT FEATURE` |
| Motion control / transfer API | **Kling** Motion Control (image + motion reference video; character orientation modes) — Open Platform docs | `VERIFIED CURRENT FEATURE` |
| Aspect reframe of **generated** video | **Luma `type: "video_reframe"`** | `VERIFIED` — for gen assets; **not** substitute for local track-reframe on real talent |
| Avatar layout only | HeyGen / Synthesia | Different product class — not film CameraSpec |
| True 6DOF path / lens metadata API | **Not verified** as public cross-vendor standard as of Sep 2026 | — |

**Structured-control rank (research recommendation):** Luma Ray 3.2 > Kling Motion Control > Veo/Seedance/Runway (prompt + frames/refs) > Firefly prompt > avatar tools.

**Sora lock (from `HVS_8_WAVES.md`):** Evidence flagged shutdown ~**2026-09-24** — do **NOT** claim Sora as live API for planning; exclude from Router defaults after sunset. Details fold to Wave 5 as historical/UNAVAILABLE if confirmed.

---

## 3. Domain 5 — AI camera follows a person + 16:9→9:16

### 3.1 Follow-person modes (`PROPOSED HVS FEATURE`)

| Mode | Behavior |
|---|---|
| **Center lock** | Keep subject centroid centered |
| **Rule of thirds** | Bias subject to left/right third |
| **Lead room** | Bias empty space in motion direction |
| **Face lock** | Track face landmarks / face bbox |
| **Upper-body / full-body lock** | Skeleton / body bbox targets |
| **Product / hair lock** | Instance mask or point track on label / hair |
| **Smooth / default / aggressive** | Analogous to Premiere Auto Reframe **Slower / Default / Faster** motion presets (`VERIFIED` Premiere UX naming) |
| **Crop limits + zoom envelope** | Prevent over-zoom; clamp scale; safe margins |

**Stack (`PROPOSED`):** TrackData + optional saliency + VirtualCamera controller + temporal smoother (1€ filter / Kalman) → timeline Transform keyframes → render.

### 3.2 Smart reframe evidence — without dumb center crop

| Source | Behavior | Callable from War Room? | Label |
|---|---|---|---|
| **Premiere Auto Reframe** | Duplicate sequence; keyframed Motion; Slower/Default/Faster; polish needed for multi-POI | No (desktop) | `VERIFIED CURRENT FEATURE` |
| **FCP Smart Conform** | Content-aware vs default center crop (Apple docs show both); Transform polish; third-party notes: often single Position X per clip unless user keyframes — **not** full continuous path-follow of every action | No | `VERIFIED CURRENT FEATURE` |
| **Resolve AI Smart Reframe** | Studio Neural Engine; Auto or Reference Point | No general REST | `VERIFIED CURRENT FEATURE` (Studio) |
| **Luma `video_reframe`** | API reframe of **generated** video to new AR | Yes (Luma Agents) | `VERIFIED` — gen path only |
| **CapCut Auto Reframe** | Creator UX for 16:9→9:16-class | Study only | `VERIFIED` product; do not depend |

**HVS recommendation:** **Own** reframe via TrackData + VirtualCamera on real footage (Linux OSS). Optionally route **already-generated** clips through Luma reframe when on that provider. **Never default to dumb center crop** for social deliverables; always offer human override keyframes.

---

## 4. Recommendations — HVS V1 vs V2+

### V1 (ship research acceptance for subject/camera lane — still research ≠ code)

1. **Local TrackSubject → TrackData → VirtualCamera → Transform keyframes** on Nebula Linux (SAM2 + ByteTrack/BoT-SORT + MediaPipe).  
2. Follow modes: **center, thirds, face lock, smooth/aggressive**; crop limits.  
3. **16:9→9:16 smart reframe** with editable keyframes — no CapCut/FCP/Premiere API dependency.  
4. **CameraSpec schema** in War Room types; adapters emit **prompt + verified fields only** (Luma keyframes / Kling Motion Control / Veo first-last+refs).  
5. **UI hard-split:** Multicam (A) vs Generative CameraSpec (B) vs Virtual Follow (C).  
6. Multicam V1: **audio/TC sync + angle viewer + manual switch** — AI best-angle as optional assist, not silent authority.

### V2+

1. Re-ID across cuts; hair-tip point trackers (license-cleared).  
2. Multicam **AI speaker / best-angle** scoring with production-tuned weights; continuity/reaction heuristics (`FUTURE`).  
3. Deeper CameraSpec path authoring (multi-beat keyframe boards) + more provider adapters as APIs mature.  
4. Depth / 3D scene camera — only when evidence + Linux path clear (`FUTURE`).  
5. STARRDOM hair-instance follow + beauty-safe masks (ethics: real talent authoritative; no identity destroy) — deep dive Wave 5.

### Explicit refusals

- Mix multicam angles with generative camera in one undifferentiated “AI Camera” control.  
- Invent CapCut/Adobe/Apple/Blackmagic remote reframe APIs.  
- Ultralytics AGPL in proprietary core without Enterprise.  
- Undocumented Runway `camera_motion` JSON.  
- Sora as long-term Router dependency.

---

## 5. Open / UNVERIFIED

| Item | Status |
|---|---|
| Exact Seedance 2.5 max seconds / pricing on **direct** BytePlus ModelArk vs Runway vs Pika | Confirm live before adapters |
| Resolve Smart Reframe mode names across 20.x builds (Auto / Pan Only / Tilt Only cited in prior Editors Guide notes) | Re-check target Studio version PDF before claiming mode enum |
| Whether Luma `video_reframe` is acceptable for **real-footage** STARRDOM social vs local track-reframe | Prefer **local** for real talent until QC proves otherwise |
| Best-angle multicam scoring weights (face visibility vs audio energy vs shake vs shot size) | Needs production spike — `PROPOSED` |
| Hair-tip CoTracker-class licenses + Linux GPU maturity | Case-by-case before V1 commitment |
| CapCut Auto Reframe Pro gating / regional availability | Product Help varies — UX only |
| Cross-shot re-ID quality for multi-take beauty shoots | `UNVERIFIED` until HVS eval set |
| True cross-vendor 6DOF CameraSpec | **Not verified** Sep 2026 |

---

## 6. Sources (official preferred · researched Sep 20, 2026)

1. Adobe Premiere — Auto Reframe Sequence — https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/add-auto-reframe-effect-to-a-sequence.html (Help updated Apr 15, 2026)  
2. Apple Support — FCP Smart Conform — https://support.apple.com/guide/final-cut-pro/adjust-framing-with-smart-conform-ver26664d93f/mac  
3. Blackmagic — DaVinci Resolve 20 New Features Guide (Multicam SmartSwitch) — https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_20_New_Features_Guide.pdf  
4. Blackmagic — Resolve Studio feature matrix (Smart Reframe Studio-gated) — https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_Studio_20_Features.pdf  
5. Blackmagic — Resolve 20 Editors Guide (Smart Reframe) — https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Editors-Guide.pdf  
6. CapCut Auto Reframe (UX only) — https://www.capcut.com/tools/auto-reframe  
7. Luma Agents — Ray 3.2 video generation (multi-keyframe) — https://docs.agents.lumalabs.ai/guides/videos/generation/  
8. Luma Agents — video reframing — https://docs.agents.lumalabs.ai/guides/videos/reframing/  
9. Luma Dream Machine — camera motion via prompt / list endpoint — https://docs.lumalabs.ai/docs/video-generation  
10. Kling Open Platform — Motion Control — https://kling.ai/document-api/api/video/motion-control  
11. Kling — Motion Control user guide — https://kling.ai/quickstart/motion-control-user-guide  
12. Google Veo — Gemini API — https://ai.google.dev/gemini-api/docs/veo  
13. Runway Dev API — https://docs.dev.runwayml.com/  
14. Adobe Firefly Generate Video usage notes — https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/  
15. SAM 2 — https://github.com/facebookresearch/sam2  
16. ByteTrack — https://github.com/ifzhang/ByteTrack  
17. MediaPipe Pose Landmarker — https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker  
18. OpenAI Sora discontinuation Help — https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation  
19. Seed / fold: `HVS_AI_VIDEO_CAMERA_FOLLOW_RESEARCH_SEP2026.md`, `WAVE_2_SEED.md`, `WAVE_2_MISFILED_CAMERA_from_old_map.md`  
20. Locks / map: `HVS_8_WAVES.md`, Domains 3–5 in `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`, WAVE_1.md, WAVE_2.md  

---


---

## 6b. Science — TrackSubject OSS + VirtualCamera math (Domains 3–5)

**Lane:** Avenger Science · RESEARCH ONLY · 2026-09-20

### OSS stack (Linux / Nebula CUDA viable) — VERIFIED CURRENT licenses

| Component | Role | License | Notes |
|---|---|---|---|
| **SAM 2** (`facebookresearch/sam2`) | Promptable image/video segmentation; masklets via `SAM2VideoPredictor` | **Apache-2.0** (code + checkpoints per project LICENSE/README) | Subject matte / instance follow; GPU VRAM matters at 4K |
| **ByteTrack** | Detection→association MOT | **MIT** | Pair with detector; commercially friendly |
| **BoT-SORT** | ByteTrack + camera-motion compensation | **MIT** | Better under handheld/pan |
| **Roboflow trackers** | Clean-room SORT/ByteTrack/BoT-SORT | **Apache-2.0** | Prefer over AGPL trackers in proprietary core |
| **MediaPipe** (Pose/Face/Hands) | Landmarks for face/upper/full lock | **Apache-2.0** | Lightweight; not full VOS |
| **RAFT** (`princeton-vl/RAFT`) | Dense optical flow | **BSD-3** | Stabilize / CMC / interp assist |
| **Google AutoFlip** (MediaPipe) | Intelligent reframe framework (salience → static/pan/track modes) | Open-source MediaPipe lineage — verify SPDX at pin | Prior-art math for mode selection |
| **CoTracker / CoTracker3** | Dense point tracking | **CC-BY-NC-4.0** (majority) | **REFUSE commercial ship** without separate license; research-only |

**Detector caution:** Ultralytics YOLO often **AGPL-3.0** — Blind Spot / Legal: not in proprietary core without Enterprise or alternate detector (RF-DETR / other Apache/MIT).

### TrackSubject pipeline (PROPOSED mechanism)

```
prompt/click/box OR detector
  → SAM2 masklet (instance)  ± MediaPipe landmarks (face/body)
  → ByteTrack/BoT-SORT ID continuity
  → TrackData { subjectId, t, bbox|maskCentroid, confidence, landmarks? }
  → VirtualCamera (below)
  → Transform keyframes on clip (non-destructive)
  → FFmpeg crop/scale bake at render
```

Class **C** (virtual reframe) only — never invents multicam angles (**A**) or generative takes (**B**).

### VirtualCamera math (PROPOSED; industry + AutoFlip-class prior art)

1. **Crop window:** largest rectangle of target aspect (e.g. 9:16) that fits source frame.
2. **Target point:** subject centroid + composition offset (center / thirds / lead-room / eye-level lift / face vs full-body).
3. **Temporal filter:** EMA or One-Euro or damped spring; **dead zone**; max speed + max accel clamps (Premiere Slower/Default/Faster = UX labels only).
4. **Shot modes (AutoFlip prior art):** **Static** (low motion variance) · **Pan** (steady drift) · **Track** (high variance follow) — pick per scene; **reset on hard cut**.
5. **Fallback:** last good position → slow Ken Burns / center — never silent empty crop.
6. **Output:** per-frame crop (x,y,w,h) → timeline Transform keyframes; optional FFmpeg `crop`/`sendcmd` at render.
7. **Zoom envelope:** min/max scale so hair/product lock does not punch in past safe margins.

**16:9→9:16:** always class **C** unless user chooses real multicam (**A**) or generative CameraSpec (**B**).

### Separation locks (Science)

| Signal | Feeds |
|---|---|
| TrackData from real footage | VirtualCamera / attach-to-track (**C/D**) |
| CameraSpec structured intent | Gen providers only (**B**) — Wave 5 adapters |
| Multicam angle IDs | Sync + switch EditOps (**A**) — no CV inventing cameras |

Beauty/face follow: landmarks OK; beauty grade still **opt-in** (Wave 2 Blind Spot).

*Science lane. Research ≠ shipped.*

## 7. Critical Q preview (Wave 8 will restate)

| Q | Short answer |
|---|---|
| **Q8** Subject follow? | Own stack: detect → MIT tracker → SAM2 → MediaPipe → TrackData → VirtualCamera → keyframes. NLEs = UX only. |
| **Q9** AI camera tracking? | Split **A** multicam · **B** generative CameraSpec · **C** virtual follow — do not mix. |
| **Q12** Camera-angle intelligence? | Real multicam: score speaker face + audio + composition + shake. Single-cam: score virtual window. Gen: CameraSpec is authoring intent, not angle intelligence. |
| **Q13** Gen angles vs multicam? | Multicam = discrete sensors / cuts. Gen = synthesized viewpoint / prompt/keyframe constraints. Disclose. |
| **Q14** Useful gen camera control? | Luma Ray 3.2 keyframes > Kling Motion Control > Veo/Seedance/Runway prompt+frames > Firefly; no Sora dependency. |
| **Q15** OSS viable? | SAM2 (Apache) + ByteTrack/BoT-SORT (MIT) + MediaPipe + OpenCV; caution Ultralytics AGPL. |

---

## 8. Stamp

```text
WAVE_3 DONE | READY FOR WAVE 4
Domains 3, 4, 5 — Subject follow + CameraSpec + AI camera (A≠B≠C)
RESEARCH ONLY — not shipped
As of: Sunday Sep 20, 2026 · ~2:26 PM EDT (America/New_York)
```

**Next (per `HVS_8_WAVES.md`):** Wave 4 — AI Director EditOps + control modes (Domains 6, 7, 28). Prior misfiled AI-Director content that briefly lived in WAVE_3 should be folded into WAVE_4, not left as Wave 3 SoR.

---

*End WAVE_3 stamp | Higher Vision Studios | Commander Mark | RESEARCH ONLY*

# HVS WAVE 4 — AI Director EditOps + Control Modes
# STATUS: COMPLETE (research deliverable) | 2026-09-20 ~14:30 ET | RESEARCH ONLY
# Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE | PARTIAL | REFUSE | UNVERIFIED
# Domains: 6 (AI Editor/Director), 7 (Automatic creation), 28 (AI + human control)
# Report §§: 10 (Media Intelligence sketch), 11 (AI Director), + control-mode notes
# Seed: Wave A Domain 6 sketch + Waves 1–3 EditOp inventories — do NOT contradict OTIO/FFmpeg split
# Fold-in: /home/box/higher-vision-studios/waves/WAVE_3_MISFILED_AI_DIRECTOR_from_old_map.md
# NOTE: /home/box/.../waves/WAVE_4.md is OLD-MAP generative content (= canonical Wave 5) — not SoR here

---

## 0. Executive recommendation (PROPOSED HVS)

1. **AI Director = structured EDIT COMMAND LAYER.** Natural language → **typed EditOps only** → validate against timeline schema → `EditTransaction` → apply to OTIO-compatible graph → optional preview → commit. **Never** raw `ffmpeg` / shell filter strings from the model.
2. **Pattern after Premiere UXP Actions + `executeTransaction`** (official Adobe docs, Premiere v25.6+) as **architectural prior art** — cite only; **do not claim Adobe SDK dependency** for HVS core.
3. **Separate Observed from Scenario.** Observed = source media hashes + committed OTIO/HVS timeline. Scenario = AI suggestions, ranked alternatives, draft versions — never silent overwrite of Observed.
4. **Human control modes (Domain 28):** `MANUAL` | `ASSIST` | `SUGGEST` | `FIRST_CUT` | `DIRECTOR` | `DRAFT`. Destructive cuts require **confirm** in `ASSIST` and above. Draft ≠ publish authority.
5. **Automatic pipeline:** IDEA → SCRIPT → BOARD → ASSETS → EDIT → MUSIC/VOICE → CAPTIONS → RENDER with **human gates** at each stage. **Not** a V1 promise of full auto film (Domain 22 FUTURE).
6. **Media intelligence hooks (Domain 16–17 sketch only):** search/tag/quality scoring feed Director candidate ranking — deep quality analysis deferred to **Wave 8**. **Never silently delete source media.**
7. **REFUSE:** tips-only AI; UI-clicking as primary AI path; CapCut/Adobe scrape; inventing vendor edit APIs; silent source delete.

---

## 1. Domain 6 — AI Editor / AI Director (Edit Command Layer)

### 1.1 VERIFIED CURRENT — Industry patterns (official docs; not HVS APIs)

| Pattern | What it proves | API for HVS? | Label |
|---|---|---|---|
| **Premiere UXP typed Action + transaction** | Timeline mutations are `create*Action` objects added to a `CompoundAction` inside `project.lockedAccess` + `project.executeTransaction(...)` | **No** — proprietary host plugin surface | VERIFIED CURRENT (pattern evidence) |
| **OTIO serializable edit graph** | Timeline→Stack→Track→Clip/Gap/Transition; rational time; metadata; **not** a renderer | Yes (Apache-2.0 integrate) | VERIFIED CURRENT |
| **Descript Underlord** | NL → agent edits **Descript’s** project; checkpoints before edits; Undo / Revert / Version History | Descript API exists for **their** model — not HVS graph | VERIFIED CURRENT (UX/product) |
| **CapCut Auto Cut** | Beat / speech / text-prompt auto assembly on Mobile+Desktop; **not** on Web (Help Feb 3, 2026) | No public edit-graph API for HVS | VERIFIED CURRENT (product Help) |
| **FCP / Resolve Neural AI tools** | Deep ops inside closed apps; no War Room-callable insert/trim REST | Do not invent | VERIFIED apps; REFUSE invented APIs |

**Official Premiere UXP sources (cite without SDK dependency claim):**
- SequenceEditor (since 25.6): `getEditor`, `createInsertProjectItemAction`, `createOverwriteItemAction`, `createRemoveItemsAction`, `createCloneTrackItemAction` — https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/
- UXP API fundamentals (Premiere DOM vs HTML DOM; v25.6 / UXP 8.1 pairing) — https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/
- Adobe sample panels show `lockedAccess` → `executeTransaction` → `compoundAction.addAction(...)` — https://github.com/AdobeDocs/uxp-premiere-pro-samples

**Official Descript sources:**
- Underlord (beta) co-editor Help — https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript
- Undo/rollback: checkpoints + Undo + Version History — https://help.descript.com/ai-assistant/revert
- Prompting / context attach — https://help.descript.com/ai-assistant/prompting
- API overview (import + Edit with Underlord) — https://help.descript.com/api-and-mcp/api

**Official CapCut Auto Cut:**
- https://www.capcut.com/help/how-to-use-auto-cut (dated Feb 3, 2026) — Mobile/Desktop; Web unsupported
- Availability caveats — https://www.capcut.com/help/auto-cut-not-working

**OTIO:**
- Timeline structure — https://opentimeline.io/ (docs: https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html)
- File format / metadata — https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-file-format-specification.html
- GitHub ASWF Apache-2.0 — https://github.com/AcademySoftwareFoundation/OpenTimelineIO

**Blind-spot lesson (PROPOSED HVS):** Descript/CapCut prove **NL→edit** is commercially real **inside their own document models**. Premiere UXP proves **typed Action + transaction** is the right mutation shape. HVS must **own** `.hvsproj` + `hvs.edit.v1` — never pretend CapCut/FCP/Premiere expose equivalent command APIs for War Room.

### 1.2 PROPOSED HVS — EditOp envelope (`hvs.edit.v1`)

```
EditTransaction {
  schemaVersion: "hvs.edit.v1",
  transactionId: uuid,
  projectId: uuid,
  baseRevision: string,          // Observed timeline revision this txn forks from
  actor: {
    type: "human" | "ai_assist" | "ai_suggest" | "ai_first_cut" | "ai_director" | "ai_draft",
    id: string,
    modelRoute?: string          // Provider Router id when AI; never invent
  },
  mode: "preview" | "commit",
  controlMode: ControlMode,      // see §3
  requireConfirm: boolean,       // true for destructive ops in ASSIST+
  ops: EditOp[],                 // ordered, typed, validated
  explain: string?,              // NL rationale for UI — NOT a substitute for ops
  previewPolicy: "none" | "diff_strip" | "proxy_render",
  createdAt: ISO8601
}
```

**Hard rules:**
- `explain` without matching `ops` = **advice only** → UI must label Tips ≠ Ops (REFUSE as Director default path).
- Model output that is a shell/`ffmpeg` string = **REJECT** at validate (Wave 1/A lock).
- UI automation / click-injection = **REFUSE** as primary AI path (may exist as accessibility fallthrough only — never Director SoR).

### 1.3 Expanded EditOp inventory (Waves 1 + 2 + 3 + Domain 6)

> Names are **PROPOSED HVS**. Industry “verified in” = product feature class in official Help, not identical wire names.

#### A. Assembly / structure (Wave 1)

| EditOp | Behavior | Destructive? | Confirm in ASSIST+ |
|---|---|---|---|
| `InsertClip` | Insert at time; ripple shift | No* | No |
| `OverwriteClip` | Replace destination range | Partial | Yes if covers existing |
| `AppendClip` | Add at end of track/storyline | No | No |
| `ReplaceClip` | Swap media keeping timing | Partial | Yes |
| `Lift` | Remove range; leave Gap | Yes (timeline) | Yes |
| `Extract` / `RippleDelete` | Remove range; close gap | Yes | Yes |
| `Split` / `Blade` | Cut at playhead | No | No |
| `Move` / `Rearrange` | Relocate; optional ripple | Partial | Policy |
| `Duplicate` / `Clone` | Copy track item | No | No |
| `Nest` / `Compound` | Collapse selection | No | No |
| `Unnest` | Expand nest | No | No |
| `CloseGap` | Magnetic-style gap close as op | Partial | Policy |

\*Insert can push media; not source-destructive.

#### B. Trim family (Wave 1)

| EditOp | Behavior | Confirm |
|---|---|---|
| `TrimIn` / `TrimOut` | Edge change; gap or ripple policy | Policy |
| `RippleTrim` | Trim + shift downstream | Yes if large |
| `Roll` | Edit point moves; duration constant | No |
| `Slip` | Source in/out change; timeline fixed | No |
| `Slide` | Clip slides; neighbors roll | No |
| `ExtendToPlayhead` | Grow/shrink to CTI | No |
| `SetInOut` / `MarkRange` | Mark for lift/extract/render | No |

#### C. Sync / multicam / versions (Wave 1 + 3)

| EditOp | Behavior |
|---|---|
| `CreateMulticam` | Sync angles (TC/audio/in-out/marker) → MulticamSession |
| `MulticamSwitch` | Cut/switch active angle (**≠** CameraSpec) |
| `MatchFrame` | Reveal source frame under CTI |
| `Audition` / `CreateVersion` | Alternate take under slot; immutable version node |
| `CreateCheckpoint` | Named restore point mid-Director run |

#### D. Speed / time (Wave 1; depth Wave 6)

| EditOp | Notes |
|---|---|
| `SetSpeed` / `SpeedRamp` | Constant or curve; optical-flow quality = FUTURE/render |
| `Freeze` / `Hold` | Freeze segment |
| `Reverse` | Reverse playback |

#### E. Creative / ThemePack (Wave 2)

| EditOp | Behavior |
|---|---|
| `ApplyTheme` | Expand ThemePack onto scope (sequence\|track\|range\|clip) |
| `ClearTheme` / `DisableTheme` | Mute/remove theme-derived stack |
| `ApplyLook` | OCIO look / LUT / grade params |
| `ApplyFilter` | Creator filter pack; intensity 0..1 |
| `AddTransition` | Between-clip transition |
| `AddOverlay` / `AddSticker` | Graphics-track overlay |
| `ApplyTitlePack` | Title/lower-third from pack |
| `ApplyCaptionStyle` | Style existing captions (does not invent words) |
| `GenerateCaptions` | ASR → caption items; human edit required |
| `SetSpeedRamp` | CapCut-velocity-class time remap |
| `ApplyBeautyLite` | **Default OFF**; consent + STARRDOM locks (Wave 5) |
| `SaveAsTheme` | Capture stack → ThemePack draft |

#### F. Subject / camera (Wave 3)

| EditOp | Behavior | Lock |
|---|---|---|
| `TrackSubject` | Prompt → SAM2 VOS / bbox → TrackData | Human correction mandatory |
| `SetCameraSpec` | Framing/transform/easing/provenance keyframes | Never invent high confidence |
| `AutoReframe` | Target aspect + mode (center/thirds/lead/face/…) | No dumb center crop default |
| `AttachOverlayToSubject` | Sticker/text follow TrackData | Optional |
| `MulticamSwitch` | Real angles only | **≠** generative CameraSpec |

#### G. Keyframes / attributes

| EditOp | Behavior |
|---|---|
| `KeyframeTransform` | Position/scale/rotation/opacity |
| `SetOpacity` | Clip/layer opacity |
| `SetKeyframes` / `ClearKeyframes` | Generic param curves |
| `CopyAttributes` / `PasteAttributes` | Effect/look attribute transfer |

#### H. Audio stubs (Wave 6 depth)

`SetAudioLevel` · `FadeAudio` · `DuckMusic` · `NormalizeAudio` · `AddMusic` · `GenerateVoice` (Router) · `RemoveSilence` (suggest-only until confirmed)

#### I. Color / VFX stubs (Wave 6)

`ApplyGrade` · `ApplyEffect` · `SetMask` · `RemoveBackground` (local vs gen policy)

#### J. Generative stubs (Wave 5)

`GenerateMedia` / `GenerateVideo` / `GenerateImage` · `ExtendShot` · `ReplaceBackground` — **always** via Provider Router → Media Library (Observed asset + provenance) → then `InsertClip` / `ReplaceClip`. Never gen straight into final without asset QA gate.

#### K. Meta / deliver

| EditOp | Behavior |
|---|---|
| `CreateVersion` | Immutable version node (FIRST_CUT always uses this) |
| `Render` | Final/proxy render job |
| `ExportProxy` | Proxy ladder |
| `TagMedia` / `IndexMedia` | Media intelligence hooks (§5) |
| `SuggestQualityRank` | Rank candidates — **never delete sources** |

### 1.4 Validate → apply → preview pipeline (PROPOSED HVS)

```
NL / UI intent
  → Planner (AI or human) emits EditTransaction { ops[], explain? }
  → VALIDATE
       • schema (typed fields, RationalTime, track ids)
       • authz / controlMode / requireConfirm
       • media refs exist in Observed index (hash/URI)
       • reject raw ffmpeg / opaque shell
       • refuse silent source-file delete ops (none exist)
  → (if preview mode) FORK Scenario timeline from Observed@baseRevision
  → APPLY ops to OTIO-compatible graph (Clip/Gap/Transition/metadata)
  → OPTIONAL PreviewTicket (diff strip | NVENC proxy | GPU compositor)
  → HUMAN Accept / Reject / Amend
  → COMMIT → append to editops.jsonl + bump Observed revision
  → Undo stack records inverse or snapshot delta
```

**Premiere analogy (VERIFIED pattern, not dependency):** create Action → add to CompoundAction → `executeTransaction` with human-readable name — HVS mirrors with `EditTransaction` + `explain` + version attribution.

**OTIO apply notes (VERIFIED CURRENT tech):**
- Structure: Timeline → tracks (Stack) → Track → Clip | Gap | Transition | nested.
- Effects/themes/CameraSpec are **application-specific** — store in HVS internal graph + OTIO `metadata` namespace `HVS` + sidecar; disclose loss on stock OTIO export.
- Time: `RationalTime` / `TimeRange`; media via `ExternalReference` keyed by content hash when possible.

### 1.5 Transactions, undo, version, history (PROPOSED HVS)

| Concept | Design | Prior art |
|---|---|---|
| **EditTransaction** | Atomic multi-op unit; all-or-nothing default; compensate policy = FUTURE open Q | Premiere `executeTransaction`; Descript agent job |
| **Preview-before-commit** | Default for DIRECTOR; optional for ASSIST | Descript checkpoints before Underlord edits |
| **Undo / redo** | Command-log or snapshot deltas on **timeline refs**; never mutate/delete source files | Descript Undo + Revert Help |
| **Version history** | Immutable Version nodes; FIRST_CUT creates `vN+1` leaving `vN` untouched | Descript Version History; Domain 28 invariant |
| **Checkpoints** | Named mid-run restore for long Director sessions | Descript Underlord checkpoints (session) |
| **Deterministic replay** | Same Observed seed + same op log → same timeline (gen ops require recorded provider/model/seed/params in provenance or marked non-deterministic) | PROPOSED |
| **Attribution** | Every commit stores actor, timestamp, modelRoute, explain | Domain 28 |
| **Non-destructive default** | Assets immutable; timeline holds ranges + stacks | Wave 1 project format |

**Destructive ops requiring confirm in ASSIST+ (PROPOSED policy):**
`Lift`, `Extract`/`RippleDelete`, `OverwriteClip` (when covering existing), `ReplaceClip`, large `RippleTrim`, any op that drops timeline content below recovery without Version, generative overwrite of hero plates without CreateVersion.

**Source media:** There is **no** EditOp that deletes original files. Quality tools may **rank / hide / reject-tag** only. **REFUSE** silent delete (Domain 17 + Media densify policy).

### 1.6 Observed vs Scenario (PROPOSED HVS — Wave A Science lock)

| Layer | Contents | Mutated by |
|---|---|---|
| **Observed** | Media index (sha256, URI, proxies), committed OTIO/HVS timeline, provenance, EditOp log, Version nodes | Human commits + accepted AI transactions |
| **Scenario** | AI suggestion trees, ranked alternate cuts, PreviewTickets, draft ThemePacks, FIRST_CUT / DRAFT versions not yet promoted | AI Director / Suggest; discarded on Reject |

UI must always show which layer the operator is viewing. Promoting Scenario → Observed requires explicit Accept (and Publish is a further gate).

---

## 2. Domain 7 — Automatic video creation (IDEA → RENDER)

### 2.1 VERIFIED CURRENT — Auto-creation UX prior art (not HVS engines)

| Product | Capability (official/Help) | Integration for HVS |
|---|---|---|
| CapCut Auto Cut | Beat / speech / text-prompt draft cuts; Mobile+Desktop; Web no | Prior art only — REFUSE CapCut SoR |
| Descript Underlord | Multi-step NL workflows (filler, captions, layouts, highlight reels) inside Descript | Pattern study; own schema |
| Canva Magic Video | Auto-sequence ~60s vertical (Help exists; fetch may be Cloudflare-gated) | Prior art; re-verify before hard claims |
| Premiere / FCP / Resolve | Professional depth; auto-reframe / Neural tools — not “idea→film” APIs | Prior art |

### 2.2 PROPOSED HVS — Pipeline with human gates

```
IDEA
  → [GATE G0: brief / brand / rights / client agreement]
SCRIPT
  → [GATE G1: script approve]
STORYBOARD / SHOT PLAN (+ CameraSpec stubs)
  → [GATE G2: board approve]
SHOTS / ASSET PLAN (real vs gen mix; Character Bible consent → Wave 5)
  → [GATE G3: plan approve]
ASSETS (ingest + optional GenerateMedia via Router → Media Library)
  → [GATE G4: asset QA / provenance / likeness]
EDIT (EditOps: FIRST_CUT or DIRECTOR transactions)
  → [GATE G5: cut approve]
MUSIC / VOICE
  → [GATE G6: audio approve]
CAPTIONS / GRAPHICS / THEME (ApplyTheme, GenerateCaptions, …)
  → [GATE G7: brand/legal]
RENDER (multi-aspect 16:9 + 9:16)
  → [GATE G8: delivery QC]
PUBLISH / DELIVER
  → [GATE G9: Commander/client authority]
```

**Locks:**
- **Draft ≠ publish.** AUTOMATIC/DRAFT mode may complete through G8 but **cannot** pass G9 without human.
- **Not a V1 promise of full auto film** (Domain 22 long-form FUTURE). V1 slim Blind Spot lock remains: ingest → cut/assembly → captions → export (Wave 8 reconciles vs STARRDOM acceptance).
- Generative steps may no-op if Provider Router offline — pipeline must degrade to real-footage edit path.

### 2.3 STARRDOM alignment (acceptance-class intent; Wave 5/8 depth)

Target NL (assignment): luxury hair-extension 30s spot with subject follow, hair CU, weak-section remove, beat cuts, luxury filter, captions, logo, optional AI beauty B-roll, 9:16+16:9 — expressed as **EditOps + gates**, not CapCut export. Beauty/identity ethics → Wave 5. Full acceptance matrix → Wave 8 §23.

---

## 3. Domain 28 — AI + human control modes

### 3.1 Mode definitions (PROPOSED HVS)

| Mode | Who drives timeline | AI role | Destructive cuts | Version behavior | Publish |
|---|---|---|---|---|---|
| **MANUAL** | Human only | Off / tips disabled by default | Human owns | Normal undo | Human |
| **ASSIST** | Human | May propose ops; human applies or confirms | **Confirm required** | Undo + optional checkpoint | Human |
| **SUGGEST** | Human | Ranked Scenario suggestions + explain; one-click apply = transaction | **Confirm required** | Suggestions stay Scenario until apply | Human |
| **FIRST_CUT** | AI batch | Creates **new Version** assembly from brief + assets | Confirm on promote | **Always** `CreateVersion`; leaves prior intact | Human must promote |
| **DIRECTOR** | AI multi-op | Orchestrates edit (+ optional gen via Router) with preview-before-commit + milestone gates | **Confirm required** | Checkpoints + Versions | Human gates G5–G9 |
| **DRAFT** (AUTOMATIC / FULL DRAFT) | AI end-to-end draft | Maximum automation through pipeline | Confirm on any Observed promote | Draft Version; never auto-Publish | **Draft ≠ publish** |

Assignment aliases: MANUAL EDIT · AI ASSIST · AI SUGGEST · AI FIRST CUT · AI DIRECTOR · AUTOMATIC DRAFT — same six modes.

### 3.2 Invariants (PROPOSED HVS — non-negotiable)

1. Every meaningful AI edit is **visible, undoable, versioned, attributable, inspectable**.
2. **AI FIRST CUT creates v2 leaving v1 untouched.**
3. Tips-only responses are labeled and are **not** the Director default path (**REFUSE** tips-as-product).
4. UI-clicking is **not** the primary AI execution path (**REFUSE**).
5. No EditOp silently deletes source media (**REFUSE**).
6. MulticamSession ops never silently rewrite CameraSpec (Wave 3 lock).

### 3.3 Control-mode × pipeline gates (sketch)

| Gate | MANUAL | ASSIST/SUGGEST | FIRST_CUT | DIRECTOR | DRAFT |
|---|---|---|---|---|---|
| G0–G4 pre-edit | Human | Human | Human | Human or assisted | AI may draft; human still owns rights G0/G3 |
| G5 cut | Human | Human confirm | Promote Version | Preview + confirm | Auto draft Version; confirm to Observed |
| G9 publish | Human | Human | Human | Human | **Blocked without human** |

---

## 4. Media intelligence hooks (Domain 16–17 — SKETCH only)

> Deep search/tag/quality analysis = **Wave 8** (Domains 16–17). Wave 4 only defines **hooks** the Director may call via EditOps / index jobs.

### 4.1 PROPOSED hooks

| Hook | Purpose | Feeds |
|---|---|---|
| `IndexMedia` | Embeddings + transcript + shot boundaries + basic metadata | Semantic search |
| `TagMedia` | Person/object/action/scene/OCR tags (model-routed) | “Find Jasmine smiling” |
| `SuggestQualityRank` | Blur/shake/exposure/audio/dupes scores | FIRST_CUT candidate ranking |
| `SearchMedia` | Query → ranked AssetRefs (Observed only) | Director planner |

### 4.2 Quality analysis (NOTE → Wave 8)

Detect: blur, shake, clipping, under/over exposure, low-res, bad audio, silence, duplicates, jump cuts, bad composition, faces OOF, occlusion, corrupt frames, compression artifacts.

**Policy:** Rank / soft-hide / reject-**tag** candidates. **Never silently delete source media.** Operator may archive with explicit confirm outside EditOp layer (ops policy).

### 4.3 Label

| Item | Label |
|---|---|
| Hook EditOps + index job shape | PROPOSED HVS |
| Production-grade Media Intelligence | FUTURE / Wave 8 |
| Silent source delete | REFUSE |

---

## 5. Schema sketch — single EditOp examples (PROPOSED)

```
TrimIn {
  op: "TrimIn",
  clipId: string,
  edge: "in",
  newTime: { rate: 24, value: 120 },   // RationalTime
  ripple: boolean
}

TrackSubject {
  op: "TrackSubject",
  clipId: string,
  subjectId: string,
  prompt: { frame: number, box?: [...], points?: [...] },
  modelRoute: "sam2.local",
  requireHumanReview: true
}

SetCameraSpec {
  op: "SetCameraSpec",
  clipId: string,
  keys: [{ time, framing, transform, easing, source, confidence?, provenance }],
  replace: boolean
}

ApplyTheme {
  op: "ApplyTheme",
  themePackId: "luxury_salon",
  version: "3.2.0",
  scope: { type: "sequence"|"track"|"range"|"clip", id?: string, range?: TimeRange },
  previewFirst: true
}

CreateVersion {
  op: "CreateVersion",
  name: "ai_first_cut_v2",
  fromRevision: string,
  leavePriorIntact: true
}
```

Wire JSON Schema / protobuf = Engineer spike (open Q) — research-level only here.

---

## 6. Linux / Nebula notes

| Item | Status |
|---|---|
| EditOp validate/apply on Linux workers | PROPOSED — OTIO Apache-2.0 + HVS graph |
| PreviewTicket proxy via FFmpeg/NVENC on Nebula Linux `153e10ec…` | PROPOSED; HOLD until hardware byte-proven (Wave 7) |
| Adobe UXP / CapCut / Descript as runtime | REFUSE for core |
| Heavy TrackSubject on CUDA | Wave 3 HOLD realtime 4K |

---

## 7. Blind Spot / REFUSE lines (Wave 4)

1. **REFUSE:** Tips-only AI as the product (explain without ops).
2. **REFUSE:** UI-clicking / RPA as primary AI edit path.
3. **REFUSE:** Model → raw ffmpeg / GLSL / shell strings.
4. **REFUSE:** Silent delete of source media (quality = rank/tag only).
5. **REFUSE:** Invented CapCut/Adobe/Apple/Blackmagic edit-command REST APIs.
6. **REFUSE:** CapCut/Adobe scrape; CapCut as SoR; Descript project model as HVS SoR.
7. **REFUSE:** FIRST_CUT overwriting human v1; DRAFT auto-Publish.
8. **REFUSE:** Conflating MulticamSwitch with SetCameraSpec.
9. **REFUSE:** Claiming Adobe UXP SDK is an HVS dependency (pattern cite only).
10. **REFUSE:** V1 promise of unattended feature film (Domain 22 FUTURE).

---

## 8. Critical questions touched (Wave 4)

| # (assignment themes) | Answer sketch | Label |
|---|---|---|
| How does AI manipulate the timeline? | Typed EditOps + transactions only | PROPOSED HVS |
| Tips vs ops? | Tips labeled; Director emits ops | REFUSE tips-only |
| Undo / version? | Command log + immutable Versions; FIRST_CUT = new Version | PROPOSED |
| Human control? | Six modes §3; confirm destructive in ASSIST+ | PROPOSED |
| Auto creation? | IDEA→RENDER with gates; draft ≠ publish | PROPOSED |
| Media intelligence? | Hooks only; deep Wave 8 | PARTIAL |
| Premiere transaction pattern? | Official UXP Actions + executeTransaction — cite, don’t depend | VERIFIED CURRENT pattern |

---

## 9. Open questions

- Exact JSON Schema / codegen for every EditOp (required fields, track addressing, nest paths).
- PreviewTicket cost policy: still-strip vs short NVENC proxy vs full GPU composite.
- Partial failure inside multi-op txn with generative children (all-or-nothing vs compensate).
- How much one-shot NL maps to DIRECTOR vs requiring structured shot lists first.
- Checkpoint frequency + cloud-gen spend caps during DRAFT/DIRECTOR.
- Whether Scenario trees need CRDT for multi-operator War Room (Wave 7 collab).

---

## 10. Sources (URLs)

### Official — Premiere UXP (pattern only)
1. https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/
2. https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/apis/
3. https://github.com/AdobeDocs/uxp-premiere-pro-samples

### Official — OTIO
4. https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html
5. https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-file-format-specification.html
6. https://github.com/AcademySoftwareFoundation/OpenTimelineIO

### Official — Descript Underlord / API
7. https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript
8. https://help.descript.com/ai-assistant/revert
9. https://help.descript.com/ai-assistant/prompting
10. https://help.descript.com/api-and-mcp/api
11. https://www.descript.com/api

### Official — CapCut Auto Cut
12. https://www.capcut.com/help/how-to-use-auto-cut
13. https://www.capcut.com/help/auto-cut-not-working

### Internal seeds (do not contradict)
14. `../HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` Domain 6 sketch
15. `HVS_WAVE_1_NLE_FOUNDATION.md` §3 EditOp inventory
16. `HVS_WAVE_2_CAPCUT_STYLE_CREATIVE.md` §4 creative EditOps
17. `HVS_WAVE_3_SUBJECT_CAMERA.md` TrackSubject / SetCameraSpec / AutoReframe
18. `/home/box/higher-vision-studios/waves/WAVE_3_MISFILED_AI_DIRECTOR_from_old_map.md` (folded)
19. `../HVS_8_WAVES_PLAN.md` Wave 4
20. `/home/box/higher-vision-studios/HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md` Domains 6, 7, 28

---

## 11. Stamp

```text
WAVE_4 DONE | READY FOR WAVE 5
Domains 6, 7, 28 — AI Director EditOps + control modes + auto pipeline gates
Media Intelligence = hooks only (deep → Wave 8 Domains 16–17)
RESEARCH ONLY — not shipped — no War Room app code / commit / push / deploy
As of: Sunday Sep 20, 2026 · ~2:30 PM ET (America/New_York)
```

**Next (per HVS_8_WAVES_PLAN.md):** Wave 5 — Generative + Characters + STARRDOM beauty (Domains 8, 9, 10, 20, 21). Note: old-map `/home/box/.../waves/WAVE_4.md` content belongs under canonical Wave 5 — do not treat as this wave’s SoR.

---

*End WAVE_4 stamp | Higher Vision Studios | Commander Mark | RESEARCH ONLY*

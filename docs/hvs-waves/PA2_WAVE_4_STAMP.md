# HVS WAVE 4 — AI DIRECTOR EDITOPS + CONTROL MODES (Domains 6, 7, 28)
## Status / Date

| Field | Value |
|---|---|
| **Status** | **WAVE_4 DONE** — Domains 6, 7, 28 stamped · **READY FOR WAVE 5** |
| **Date** | Sunday Sep 20, 2026 · ~2:27 PM EDT (America/New_York) |
| **Commander** | Mark |
| **Mode** | RESEARCH ONLY — no code / build / commit |
| **Scope** | **Domains 6, 7, 28** — Edit Command Layer; automatic creation pipeline; AI + human control modes |
| **PA wave map** | `HVS_8_WAVES.md` Wave 4 · AI Director EditOps + control modes |
| **Locks** | HVS ≠ Media Player ≠ Terra · **REFUSE tips-only AI** (every AI action → real EditOp + undo + asset hash) · Never silently delete source media · Preview-before-commit · Non-destructive · Versioned · Draft ≠ publish · VERIFIED / PROPOSED / FUTURE |
| **Prior file notes** | Replaces prior WAVE_4 draft that mis-scoped Domains 8–10/20–21 (generative/STARRDOM → **Wave 5**). Folds/upgrades: `WAVE_3_MISFILED_AI_DIRECTOR_from_old_map.md`, MASTER REPORT §11, Domain 6/7/28 assignment text. Misfiled generative draft preserved as `WAVE_4_MISFILED_GENERATIVE_STARRDOM_from_old_map.md`. Wave 1–3 locks inherited. |

Claim tags: **VERIFIED CURRENT FEATURE** | **PROPOSED HVS FEATURE** | **FUTURE/EXPERIMENTAL** | **UNVERIFIED** | **VENDOR CLAIM**

---

## 0. Boundary locks (from WAVE_1–3 + Domains 6/7/28)

| Rule | Meaning |
|---|---|
| **Tips-only AI = REFUSE** | Chat advice without structured ops is **not** an editor. Every meaningful AI edit must emit typed EditOps inside an EditTransaction with undo + asset hash / provenance |
| **Never silently delete source media** | Rank / reject / soft-hide only; originals immutable on disk |
| **Preview-before-commit** | Default AI path: fork → apply → PreviewTicket → Accept/Reject → commit |
| **Non-destructive + versioned** | Timeline refs ranges + stacks; Version nodes immutable; AI FIRST CUT creates new version |
| **Draft ≠ publish authority** | FULL DRAFT / AUTOMATIC may assemble end-to-end; only explicit human Publish / Deliver gate ships |
| **No CapCut/Adobe scrape; no invented NLE APIs** | Descript Agent = prior-art pattern **inside Descript’s model** — not HVS SoR; FCP/Premiere/Resolve = UX depth only |
| **HVS ≠ Media Player ≠ Terra** | EditOps live in HVS studio lane only |
| **Labels mandatory** | VERIFIED · PROPOSED · FUTURE · flag UNVERIFIED |
| **Research ≠ shipped** | Builds HOLD |

---

## 1. Domain 6 — AI Editor / AI Director (Edit Command Layer)

### 1.1 Industry evidence — structured edit agents vs tips (`VERIFIED` examples)

| System | What it actually does | War Room-callable edit graph? | Relevance to HVS | Label |
|---|---|---|---|---|
| **Descript Agent / Underlord** | NL prompt → background agent edits a Descript project (filler remove, Studio Sound, captions, highlight reels, etc.). Official API: `POST …/v1/jobs/agent` with `project_id` or `project_name` + `prompt`; poll `GET /jobs/{job_id}` or `callback_url`; result includes `agent_response`, `project_changed`. MCP path also documented (tips alone ≠ edit; MCP can drive edits). | **Yes** — but **Descript-owned** project model | Proof that **prompt → edit job** is commercially real; study job/poll/NL UX — **do not bind** HVS timeline to Descript | `VERIFIED CURRENT FEATURE` |
| **Major NLEs (FCP / Premiere / Resolve)** | Deep professional ops; Premiere UXP SequenceEditor = **host plugin** actions only; Resolve scripting = host-bound | **No** remote Linux NLE SoR API | UX depth + op vocabulary benchmark | `VERIFIED` apps; **do not invent APIs** |
| **CapCut** | Creator auto tools | Not an HVS integration target | UX study only | Product UX; **do not scrape** |
| **OpenTimelineIO** | Editorial interchange (Timeline → Stack → Track → Clip/Gap/Transition); Apache-2.0 | Interchange library, not AI command bus | Time/structure concepts; **not** HVS EditOp schema | `VERIFIED` (interchange); HVS commands = `PROPOSED` |

**Blind-spot lesson:** Descript proves agent-edit is viable **inside a vendor’s own document model**. HVS must own `.hvsproj` + `hvs.edit.v1` command schema. Tips without ops are advice; ops without preview/undo/attribution violate Domain 28.

### 1.2 Edit Command Layer — envelope (`PROPOSED HVS FEATURE`)

```json
{
  "schemaVersion": "hvs.edit.v1",
  "transactionId": "uuid",
  "projectId": "uuid",
  "sequenceId": "uuid",
  "baseVersionId": "uuid",
  "actor": {
    "type": "human|ai_assist|ai_suggest|ai_first_cut|ai_director|full_draft",
    "id": "string",
    "modelRouteId": "optional-router-route-id"
  },
  "mode": "preview|commit",
  "ops": [ /* ordered atomic ops */ ],
  "explain": "optional natural-language rationale for UI (NOT a substitute for ops)",
  "assetHashes": { "touchedAssetId": "sha256-or-content-hash" },
  "costBudget": { "maxCloudCredits": 0, "maxGenCalls": 0 }
}
```

**Invariant:** If `explain` is present without corresponding `ops[]`, UI must label the message as **Advice only** — never as an applied edit. AI Director **default path** = ops inside transactions.

### 1.3 Command families (`PROPOSED`)

Times use rational frames `{ "rate": N, "value": M }` (Wave 1 timebase lock). Clip/track IDs are HVS UUIDs in `.hvsproj`.

| Family | Ops (surface) | Notes | V1 vs V2+ |
|---|---|---|---|
| **Timeline structure** | `insertClip`, `overwriteClip`, `appendClip`, `removeClip`, `splitClip`, `trimClip`, `moveClip`, `replaceClip`, `lift`, `extract`, `rippleDelete` | Map Domain 1 NLE ops; removeClip = timeline unlink only — **never** delete source file | **V1 core** |
| **Speed / time** | `setSpeed`, `speedRamp`, `reverse`, `freeze` | Non-destructive; source ranges preserved | V1: constant speed · V2+: ramps / optical-flow |
| **Look / theme** | `addTransition`, `applyEffect`, `applyFilter`, `applyTheme`, `applyLook`, `removeEffect` | Themes owned by HVS (Wave 2 ThemeSpec) | V1: theme + basic filter · V2+: full OpenFX graph |
| **Camera / subject** | `trackSubject`, `setVirtualCamera`, `autoReframe`, `switchAngle`, `setCameraSpec` | Links Wave 3 TrackData / VirtualCamera / multicam A≠B≠C | V1: track + reframe · gen CameraSpec adapter = Wave 5 |
| **Keyframes** | `setKeyframes`, `clearKeyframes`, `easeKeyframes` | Transform, opacity, effect params | **V1 core** (basic) |
| **Text / captions** | `addCaptions`, `editCaption`, `addTitle`, `addLowerThird`, `applyCaptionStyle` | Prefer timed caption objects over baked burn-in until render | **V1** captions path |
| **Audio** | `setGain`, `setAudioDuck`, `normalizeAudio`, `addMusic`, `generateVoice`, `removeFiller` (soft-cut ranges) | TTS/music via Provider Router | V1: duck/gain/import · V2+: Fairlight-class |
| **Color / mask** | `applyGrade`, `applyLook`, `setMask`, `removeBackground`, `isolateSubject` | Looks non-destructive; beauty opt-in (Wave 2 Blind Spot) | V1 thin · V2+ OCIO |
| **Generative** | `generateVideo`, `generateImage`, `extendShot`, `replaceBackground`, `generateMusic`, `generateVoice` | **Router → Media Library AssetRef + provenance → then** `insertClip`/`replaceClip` | Stubs V1 · full Wave 5 |
| **Meta / delivery** | `createVersion`, `createCheckpoint`, `render`, `setPublishGate` | Version nodes immutable; render ≠ publish | **V1** version + render |

**Example STARRDOM-intent ops (illustrative `PROPOSED`):** `trackSubject(jamila, face_center)` → `setVirtualCamera(9:16, smooth)` → `applyTheme(luxury_beauty_v1)` → `addCaptions` → `addMusic` → `render(aspects:[16:9,9:16])`.

### 1.4 EditTransaction, undo/redo, version history, deterministic replay, AI explanations (`PROPOSED`)

| Concept | Design |
|---|---|
| **EditTransaction** | Fork project snapshot at `baseVersionId` → validate ops → apply to fork → produce **PreviewTicket** (proxy/GPU preview of diff, or cheap still-strip for structural ops) → human **Accept / Reject / Amend** → on commit append to **append-only** command history |
| **Undo / redo** | Command-log based (inverse ops or snapshot deltas). Undo never mutates/deletes source media files |
| **Version history** | Immutable **Version** nodes: e.g. `v1` human assembly remains when `v2` AI First Cut is created. Soft pointers for “current working”; history never rewritten |
| **Checkpoints** | Named restore points for long AI DIRECTOR / FULL DRAFT runs; cost-budget pause points |
| **Deterministic replay** | Same project seed + same committed command log → same timeline state. Generative ops are deterministic **only if** provider IDs, model IDs, seeds, prompt hashes, and returned `assetId`s are recorded in provenance; otherwise replay reuses stored AssetRefs (no silent re-gen) |
| **AI explanations** | `explain` string + optional per-op `rationale` for Inspector. Explanations are UI metadata — **not** authority. Diff view must show actual ops |
| **Attribution** | Every committed transaction stores `actor`, timestamp, optional `modelRouteId`, touched `assetHashes` |
| **Non-destructive** | Assets immutable; timeline references source ranges + effect stacks; “delete clip” = unlink |
| **Partial failure policy** | Default **all-or-nothing** for structural timeline ops; generative sub-ops may **compensate** (leave AssetRef in library, omit insert) with explicit transaction status — open Engineer spike |

### 1.5 PreviewTicket (`PROPOSED`)

| Field | Purpose |
|---|---|
| `ticketId` | UUID |
| `transactionId` | Parent tx |
| `previewKind` | `proxy_render` \| `gpu_composite` \| `still_strip` \| `waveform_diff` |
| `proxyUri` / frames | Short NVENC proxy of affected range when video change is material |
| `opsDigest` | Hash of ops for cache key |
| `expiresAt` | TTL for ephemeral previews |

**Policy:** Cheap structural ops may use still-strip; theme/grade/gen inserts prefer proxy render before commit when cost budget allows.

---

## 2. Domain 28 — AI + human control modes

### 2.1 Mode table (`PROPOSED HVS FEATURE`)

| Mode | Who drives | AI role | Ops path | Version / publish rules |
|---|---|---|---|---|
| **MANUAL EDIT** | Human | Off / none | Human emits EditOps via UI (same schema) | Human publishes |
| **AI ASSIST** | Human | Inline help; may propose a single op or small batch | AI proposes → human must apply (or one-click = explicit apply) | Human |
| **AI SUGGEST** | Human | Ranked suggestion cards + `explain` + full `ops[]` | One-click Accept → PreviewTicket → commit | Human |
| **AI FIRST CUT** | AI batch | Assembles a **new Version** from brief + assets | Multi-op transaction(s); leaves prior versions intact | Human must **promote** version; never overwrite `v1` silently |
| **AI DIRECTOR** | AI orchestrates | Multi-stage EditTransactions across edit/theme/captions/optional gen with **preview-before-commit** at each gate | Checkpointed; cost budgets | Human gates at milestones; Publish still human |
| **FULL DRAFT** (aka AUTOMATIC DRAFT) | AI end-to-end draft | Maximum automation IDEA→RENDER draft | Same EditOp kernel; full pipeline | **Draft ≠ publish** — explicit human **Publish / Deliver** required |

**Domain 7 shorthand** lists MANUAL | AI ASSIST | AI FIRST CUT | AI DIRECTOR | FULL DRAFT; Domain 28 adds **AI SUGGEST**. HVS product surface uses the **six-mode** table above (AI SUGGEST kept — ranked cards differ from inline ASSIST).

### 2.2 Invariants (all modes)

1. Every meaningful AI edit is **visible, undoable, versioned, attributable, inspectable**.
2. Every AI action → real **EditOp** + undo entry + **asset hash** / provenance touch list.
3. Tips without ops = Advice label only.
4. AI FIRST CUT / DIRECTOR / FULL DRAFT **never** silently replace the human’s prior Version.
5. Quality analysis may **rank** candidates; never auto-purge originals (Domain 17 lock).

---

## 3. Domain 7 — Automatic video creation (IDEA → RENDER)

### 3.1 Pipeline with human gates (`PROPOSED`)

```text
IDEA
  → [GATE: brief / brand / rights OK?]
SCRIPT
  → [GATE: script approve]
STORYBOARD / SHOT PLAN
  → [GATE: board approve]
SHOTS / ASSET PLAN
  → [GATE: real vs gen mix; Character Bible / likeness consent — Wave 5 detail]
ASSETS (ingest + optional generate via Provider Router)
  → [GATE: asset QA / provenance / hashes]
EDIT (Edit Commands / AI First Cut or Director)
  → [GATE: cut approve]
MUSIC / VOICE
  → [GATE: audio approve]
CAPTIONS / GRAPHICS / THEME
  → [GATE: brand / legal captions]
RENDER (multi-aspect proxy then master)
  → [GATE: delivery QC]
PUBLISH / DELIVER
  → [GATE: client / Mark authority — draft ≠ publish]
```

**Mode mapping:** MANUAL walks gates by hand; AI ASSIST/SUGGEST help inside a stage; AI FIRST CUT typically jumps ASSETS→EDIT as a new version; AI DIRECTOR may drive multiple stages with checkpoint gates; FULL DRAFT may fill SCRIPT→RENDER as draft artifacts still waiting PUBLISH gate.

### 3.2 STARRDOM acceptance alignment (product vision — not V1 ship claim)

Gates must eventually allow: follow model / hair CU / beat cuts / luxury look / captions / logo / missing beauty B-roll / 9:16+16:9 **without** exporting to CapCut/FCP/Premiere/Resolve to finish. **V1 slim lock** (from `HVS_8_WAVES.md`): ingest → cut/assembly → captions → export. Wave 8 reconciles slim V1 vs full STARRDOM.

---

## 4. How AI-generated assets attach to timeline (provenance)

### 4.1 Attachment path (`PROPOSED`; folds MASTER REPORT §12)

```text
generate* EditOp
  → MediaProviderRouter (category + policy)
  → Provider job (cloud/local)
  → AssetRef in Media Library {
        assetId, contentHash, provider, modelId, promptHash,
        refs[], params, parentAssetIds, licenseClass,
        commercialOk, consentIds, createdAt, projectId
     }
  → QA gate (hash present; rights flags; optional human review)
  → insertClip / replaceClip / storyboard slot EditOp
  → Timeline / sequence (references assetId + sourceRange)
```

**Rules:**
- Never drop orphan blobs onto the timeline without Media Library + provenance.
- Replay uses stored AssetRefs — does not silently re-call providers unless user requests **Regenerate** (new asset + new hash).
- Real talent footage remains authoritative over gen faces for beauty/identity work (Wave 5 ethics detail).
- `assetHashes` on the parent EditTransaction must include newly created assets before commit.

### 4.2 Soft-reject vs delete

Quality / AI ranking may mark assets `rejected` or `lowScore` in the library index. **Physical delete of source media is forbidden** as an automatic AI action. Human archive/purge is a separate, audited Admin action outside AI DIRECTOR default path.

---

## 5. V1 vs V2+ command surface

| Surface | V1 (research acceptance / first build slice) | V2+ |
|---|---|---|
| Edit kernel | `hvs.edit.v1` envelope + EditTransaction + PreviewTicket + Version + undo log | Schema migrations `hvs.edit.v2+`; richer compensate policies |
| Timeline ops | insert/overwrite/append/remove/split/trim/move/replace/lift/extract/ripple | Multicam advanced continuity scoring; magnetic-assist UX polish |
| Captions | ASR + styled captions + titles | Karaoke / translation / speaker diarization depth |
| Theme / look | ThemeSpec apply + thin filter/look stack | OCIO/ACES, OpenFX host, full grade |
| Subject / camera | `trackSubject` + `autoReframe` + `setVirtualCamera` (Wave 3 local stack) | Cross-shot re-ID quality; deeper CameraSpec→provider adapters |
| Generative ops | **Stubs + Router contract** (AssetRef path enforced) | Full Wave 5 provider matrix; Character Bible gates |
| Audio | Gain, duck, normalize, import music/VO; optional TTS stub | Stem separation, Fairlight-class, beat-cut intelligence |
| Modes | All six modes **UI-present**; implement MANUAL + AI ASSIST + AI FIRST CUT first | AI DIRECTOR + FULL DRAFT with cost caps + long-run checkpoints |
| Publish | Explicit human Publish gate | Client/Mark multi-party approval workflows |
| First build slice (MASTER REPORT) | `.hvsproj` + EditTransaction/Command API + FFmpeg proxy/preview/render + Router stubs + STARRDOM sample path | OpenFX / Natron / Blender / frontier gen deep integrations **after** kernel |

**Blind Spot V1 lock:** ingest → cut/assembly → captions → export. Kitchen-sink V1 refused (`HVS_8_WAVES.md`).

---

## 6. Recommendations (Science + Engineer + Blind Spot)

1. **Ship Edit Command Layer before “AI chat that tips.”** Kernel: `hvs.edit.v1` + EditTransaction + PreviewTicket + Version nodes + asset hashes.
2. **Default AI DIRECTOR to preview-before-commit**; hard gates at RENDER and PUBLISH.
3. **Study Descript’s agent-job pattern** (async job + poll/callback + NL prompt + review URL) as UX/API shape inspiration — **do not** bind HVS timeline to Descript’s project model or MCP as SoR.
4. **Separate `explain` from `ops` in UI** so operators always see real mutations.
5. **AI FIRST CUT always creates a new Version** — never overwrite human `v1` silently.
6. **Record provenance** on every `generate*` op before insert; replay from AssetRefs.
7. **Cost budgets** on DIRECTOR / FULL DRAFT transactions to prevent runaway cloud spend.
8. Exact per-op JSON Schema = Engineer spike next (research sketch here is not a frozen API).

---

## 7. Open / UNVERIFIED

| Item | Status |
|---|---|
| Exact JSON Schema for every op (required fields, track IDs, timebase edge cases) | **OPEN** — Engineer spike; sketch above is research-level only |
| PreviewTicket always NVENC proxy vs GPU still-strip heuristics | **OPEN** |
| Partial failure / compensate policy for multi-op tx with gen sub-ops | **OPEN** |
| How much Descript-style one-shot NL maps to HVS AI DIRECTOR vs requiring structured shot lists first | **OPEN** (recommend structured shot list for STARRDOM; NL for assist) |
| Checkpoint frequency + cloud cost caps for long Director sessions | **OPEN** — product policy |
| Whether any major NLE will expose a remote edit-command API suitable as SoR | **UNVERIFIED / unlikely** — plan as if **no**; HVS owns schema |
| Descript internal op graph / export of atomic edit list to third parties | **UNVERIFIED** — treat agent as black-box job; HVS still needs own ops |
| FULL DRAFT legal disclosure templates for AI-assisted client ads | **OPEN** — Legal / Wave 7 provenance |

---

## 8. Sources

1. Descript API — Agent Underlord edit jobs — https://docs.descriptapi.com/
2. Descript Help — API overview — https://help.descript.com/api-and-mcp/api
3. Descript Help — MCP overview (tips vs drive-edits) — https://help.descript.com/hc/en-us/articles/46056322186509-Descript-MCP-overview
4. Descript product API page — https://www.descript.com/api
5. OpenTimelineIO (ASWF) — architecture / timeline structure — https://github.com/AcademySoftwareFoundation/OpenTimelineIO · https://opentimelineio.readthedocs.io/
6. HVS master assignment Domains 6, 7, 28 — `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`
7. Master report §11 AI Director / Edit-Command + §12 generative attach — `HIGHER_VISION_STUDIOS_MASTER_MEDIA_PRODUCTION_RESEARCH_REPORT.md`
8. HVS_8_WAVES locks + Wave 4 map — `HVS_8_WAVES.md`
9. Folded prior draft — `waves/WAVE_3_MISFILED_AI_DIRECTOR_from_old_map.md`
10. Wave 1 NLE ops / timebase — `waves/WAVE_1.md`
11. Wave 2 ThemeSpec ownership — `waves/WAVE_2.md`
12. Wave 3 TrackSubject / CameraSpec / A≠B≠C — `waves/WAVE_3.md`
13. Adobe Premiere UXP SequenceEditor (host-bound prior art for “programmatic edit actions,” not remote SoR) — Adobe Premiere UXP docs (cited Wave 1)
14. Misfiled generative content retained for Wave 5 fold — `waves/WAVE_4_MISFILED_GENERATIVE_STARRDOM_from_old_map.md`

---

## 9. Critical Q preview (Wave 8 will restate)

| Q | Short answer |
|---|---|
| **Q21** Edit command API? | `hvs.edit.v1` JSON ops in EditTransaction `preview\|commit` — **PROPOSED** (not a public vendor API) |
| How does AI edit? | Structured EditOps only — refuse tips-only; preview-before-commit; undo; version; attribute |
| Draft authority? | Draft ≠ publish; FULL DRAFT still needs human Publish gate |
| Gen assets on timeline? | Router → Library AssetRef + provenance → insert/replace EditOp |
| V1 command surface? | Core timeline + captions + theme apply + track/reframe + version/render; gen stubs; MANUAL/ASSIST/FIRST CUT first |

---

## 10. Stamp

```text
WAVE_4 DONE | READY FOR WAVE 5
Domains 6, 7, 28 — AI Director EditOps + control modes
RESEARCH ONLY — not shipped
As of: Sunday Sep 20, 2026 · ~2:27 PM EDT (America/New_York)
```

**Next (per `HVS_8_WAVES.md`):** Wave 5 — Generative + Characters + STARRDOM beauty (Domains 8, 9, 10, 20, 21). Fold `WAVE_4_MISFILED_GENERATIVE_STARRDOM_from_old_map.md` into WAVE_5; confirm Sora sunset / provider matrix with fresh citations.

---

*End WAVE_4 stamp | Higher Vision Studios | Commander Mark | RESEARCH ONLY*

---

## 6. Science — deterministic replay · preview-before-commit (Domains 6 / 28)

**Lane:** Avenger Science · RESEARCH ONLY · 2026-09-20

### 6.1 Mechanism (VERIFIED pattern literature — not vendor NLE claims)

**Event sourcing / command log** (Fowler *Event Sourcing*; Command pattern): application state is derived by folding an ordered log of immutable events/commands. Undo/redo = move history cursor or append compensating events, then **replay** — not mutate media bytes. Side effects (render, publish, cloud agent) must be **gated out of replay** (disabled gateways during rebuild).

**Deterministic replay requires:**
1. **Pure reducer:** `state' = apply(state, EditOp)` with no wall-clock / RNG / network inside `apply`.
2. **Ordered log:** each committed tx has `{ tx_id, ops[], timestamp?, actor, parent_hash }`.
3. **Asset identity:** every media ref by **content hash** (and optional path) — replay fails closed if hash missing/changed.
4. **Same schema version:** ops carry `schema_version`; unknown op → reject, never silent skip.
5. **No tips in the log:** prose Assist text is UI-only; only typed EditOps enter the log (Blind Spot tips≠ops).

### 6.2 Preview-before-commit (PROPOSED HVS)

```
NL / UI intent
  → Director proposes EditOp[]  (draft, not applied)
  → VALIDATE (schema, track bounds, asset hashes exist, licenseClass ok)
  → PREVIEW: ephemeral fork of timeline state OR soft overlay (ghost cuts)
       · no write to committed .hvsproj head
       · no FFmpeg master bake
       · no Provider Router spend without explicit confirm
  → HUMAN: accept | edit | reject
  → COMMIT: append tx to log → head advances → undo stack push
  → optional CHECKPOINT snapshot for long projects
```

**Rules:**
- **Preview ≠ authority** — same as draft≠publish (Domain 7/28).
- AI FIRST CUT creates **new version** (v2) leaving v1 untouched — prior art: NLE duplicate sequence / version stack.
- Batch ThemeSpec / Auto-Cut-class proposals = **one transaction** (single undo) via shared `tx_id` (transaction grouping prior art).
- Provider gen calls (Wave 5) are **side effects**: record intent op + result asset hash on success; on replay of historical log, **do not re-bill** — reattach cached asset by hash or mark `NEEDS_REACQUIRE`.

### 6.3 Failure classes (Science)

| Class | Meaning |
|---|---|
| `NONDETERMINISTIC_APPLY` | apply() used time/RNG/network |
| `TIP_IN_LOG` | prose stored as if it were an op |
| `HASH_MISS` | media moved/altered; replay cannot prove same cut |
| `PREVIEW_WROTE_HEAD` | preview mutated committed project |
| `SILENT_DELETE` | remove without tombstone op + undo (REFUSE) |
| `REPLAY_REBILL` | re-running gen provider on historical replay |

### 6.4 Fit vs Descript (Evidence)

Descript agent = cloud job + **prose summary** — cannot satisfy deterministic local replay. HVS may import downloaded media as new assets (new hashes) then apply **local** EditOps; never treat `agent_response` as the log.

*Science lane. Research ≠ shipped. Engineer owns concrete EditCommand JSON schema.*

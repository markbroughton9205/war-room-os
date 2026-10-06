# HVS WAVE 5 — Generative Characters + STARRDOM Beauty
# STATUS: COMPLETE (research deliverable) | 2026-09-20 ~14:45 ET | RESEARCH ONLY
# Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE | PARTIAL | REFUSE | UNVERIFIED | DEAD/UNAVAILABLE
# Domains: 8 (AI video gen), 9 (Characters), 10 (Beauty/STARRDOM), 20 (Image production), 31 (Provider Router)
# Light Domain 21 (storyboard) sketch only — deep previs stays FUTURE/Wave 8
# Report §§: 5 (AI video landscape), 12 (Generative media architecture) + STARRDOM beauty notes
# Seeds: WAVE_2_SEED.md · WAVE_4_MISFILED_GENERATIVE_STARRDOM · Wave 3 camera adapters · Wave 4 gen EditOp stubs
# Locks: No War Room app code/commit/push/deploy · No CapCut scrape · No single-provider hardwire · Beauty opt-in + consent

---

## 0. Executive recommendation (PROPOSED HVS)

1. **Never hardwire one vendor.** Own a **Media Provider Router** (`hvs.provider.v1`) with typed ops: `GenerateVideo` | `GenerateImage` | `EditImage` | `GenerateVoice` | `Dub` | `LipSync` | `Upscale` | `Interpolate`. Outputs land in **Observed Media Library** (hash + provenance) then EditOps (`InsertClip` / `ReplaceClip`) — never gen straight into final.
2. **Sora / OpenAI Videos API = DEAD/UNAVAILABLE for planning.** Official OpenAI Deprecations: Videos API + all `sora-2*` aliases/snapshots **shutdown 2026-09-24**; Help confirms app sunset 2026-04-26; **no recommended replacement**. Research date 2026-09-20 = four days before cutoff — treat as sunset / exclude from Router defaults. Do **not** claim Sora as a live long-term API.
3. **Default cloud gen routes (STARRDOM missing plates):** Google Veo 3.1 (refs + native audio + first/last) · Kling (Motion Control / Elements / Lip Sync) · Luma Ray 3.2 (multi-keyframe + `video_reframe`) · Runway Dev (gen4.5 + hosted catalog) · Firefly Video when Adobe commercial-safety narrative required · Seedance via BytePlus ModelArk and/or Runway/Pika aggregators. **Avatar tools (HeyGen/Synthesia) ≠ cinematic beauty B-roll.**
4. **Local-first for identity-bearing work:** TrackSubject (SAM2) · CameraSpec reframe · hair masks · beauty looks (opt-in) · logo/titles on Nebula. Cloud gen for empty salon plates / product motion / consented character refs only.
5. **Character Bible is first-class HVS object** (not a vendor API): identity locks, approved ref packs, consent/usage flags. **REFUSE** deepfake of real people without explicit likeness consent; beauty packs **OFF by default**.
6. **CapCut:** consumer full NLE/gen API for War Room = **NO / REFUSE as SoR**. ChatGPT-plugin OpenAPI (limited text→video link + template search) is **not** a production edit graph. **REFUSE** CapCut scrape / unofficial wrappers as core.
7. **Pika + Firefly Video public APIs:** previously gated UNVERIFIED — now **VERIFIED CURRENT** against official developer docs (this wave). Still require paid commercial tier + archived ToS before client jobs.
8. **Gen-video deferred past V1 slim** (ingest→cut→captions→export). STARRDOM full acceptance = Wave 8 honesty (V1 vs V2+).

---

## 1. Critical flags (do not contradict)

| Flag | Status (2026-09-20 ET) | Evidence | HVS rule |
|---|---|---|---|
| **OpenAI Sora / Videos API** | **DEAD/UNAVAILABLE** (shutdown **2026-09-24**; app sunset 2026-04-26; replacement column empty) | https://developers.openai.com/api/docs/deprecations · https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation | Exclude from Router defaults; historical only |
| **CapCut public full NLE / theme / gen API** | **NO** for HVS core; ChatGPT-plugin OpenAPI ≠ edit graph | Wave 2 `openapi.yaml` full-NLE miss; plugin paths only text→video link + template search | Prior art + optional human export only; **REFUSE** scrape / SoR |
| **Pika public API** | **VERIFIED CURRENT** | https://dev.pika.art/llms.txt · `https://api.dev.pika.art` · OpenAPI https://dev.pika.art/openapi.json | Aggregator + native Pika 2.5; quote-before-spend; not local tracking |
| **Adobe Firefly Video API** | **VERIFIED CURRENT** | https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/ (Generate Video section) · Firefly Services API ref · FireflyClient `generateVideoV3` | Short clips; low default RPM (4); commercial-safety narrative — read current Terms |
| **Invented provider camera JSON** (e.g. undocumented Runway `camera_motion`) | **REFUSE** | Wave 3 Blind Spot | CameraSpec → prompt + **verified** fields only |
| **Beauty / AI replica without consent** | **REFUSE** | Wave A Legal locks · Domain 10/32 | Consent flag + disclosure mandatory |
| **Single-provider lock-in** | **REFUSE** | Domain 31 | Router + swappable adapters |

---

## 2. Domain 8 — Provider matrix (Sept 2026 official docs)

> Columns required by assignment: what it does | API? | SDK? | commercial use? | local? | open source? | license | camera control? | identity-preserving? | integration realism | build-own instead?

### 2.1 Master comparison table

| Provider | What it does | API? | SDK? | Commercial use? | Local? | OSS? | License | Camera control? | Identity-preserving? | Integration realism | Build-own instead? | Label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **OpenAI Sora / Videos** | T2V (+ image ref / characters historically) | Was yes — Videos API | Official SDKs (deprecated ops) | N/A post-shutdown | No | No | Proprietary | Prompt-only (historical) | Non-human characters API; human likeness blocked by default (historical) | **Do not integrate** | N/A — use other routers | **DEAD/UNAVAILABLE** (shutdown 2026-09-24; no replacement listed) |
| **Google Veo 3.1** | T2V / I2V / first+last / ≤3 reference images / extend prior Veo; **native audio**; SynthID | **Yes** — Gemini `generate_videos` / `predictLongRunning`; Vertex/Agent Platform GA models `veo-3.1-generate-001` (+ Fast; Lite preview) | Official Google GenAI clients | Paid Google Cloud / Gemini paid tiers — archive ToS | No | No | Proprietary Google | Prompt cinematography; aspect/duration/resolution params; **no** free-form CameraSpec JSON | Ref images for person/character/product; `personGeneration` regional limits (EU/UK/CH/MENA: `allow_adult` only for some modes) | **High** — async LRO + download (Gemini retention **~2 days**) | Do not build SOTA T2V; own CameraSpec adapter + library ingest | **VERIFIED CURRENT** |
| **Runway Dev** | Own gen4.5 / gen4_turbo / aleph2 / avatars; also hosts Veo/Seedance/Wan/… | **Yes** — `https://api.dev.runwayml.com`; header `X-Runway-Version` | `@runwayml/sdk` / `runwayml` | Credits / enterprise; moderation (`publicFigureThreshold`) | No | No | Proprietary | Gen4.5 = prompt + image + ratio + duration — **no verified CameraSpec object**; Aleph keyframes for V2V | Image refs / tags; public-figure thresholds | **High** — production formats (MP4/ProRes/HDR model-dep.) | Own router category; ignore unofficial Reddit schemas | **VERIFIED CURRENT** |
| **Kling (Kuaishou)** | T2V/I2V/Omni; Motion Control; Elements; Avatar; Lip Sync; native audio on many 3.x | **Yes** — Open Platform `https://api-singapore.klingai.com` Bearer | Official Open Platform docs / client patterns | Paid resource packages; API ToS | No | No | Proprietary | Prompt + **Motion Control** (image + motion ref video) — structured motion ≠ multicam | Elements / Omni refs; lip-sync avatar path | **High** for motion/elements; region/version diligence | Own TrackSubject for real footage; use Kling for gen motion transfer | **VERIFIED CURRENT** |
| **Seedance / ByteDance** | T2V/I2V; multimodal refs; extend/edit modes; long clips claimed on some routes | **Yes** — BytePlus ModelArk / Volcengine Ark; also via Runway (`seedance2` / `seedance2_5`) and Pika catalog | Vendor SDKs / REST; aggregator SDKs | Cloud commercial; China vs intl model ID namespaces differ | No | No | Proprietary | Prompt + refs; modes reference/extend/edit | Large ref budgets on 2.5 (product claims) — confirm live caps | **Medium–High** via aggregators; **confirm live ModelArk caps/pricing** before hardcode | Prefer adapter over native fork | **VERIFIED CURRENT** (via official aggregator + ModelArk paths); direct second/pricing **PARTIAL** until pinned |
| **Adobe Firefly Video** | Short T2V (+ optional image keyframe); Generate Video API | **Yes** — Firefly Services Generate Video (`generateVideoV3` / `POST …/v3/videos/generate`, `x-model-version: video1_standard`) | FireflyClient JS SDK | Adobe Firefly Services commercial positioning; partner models may differ — read Terms | No | No | Proprietary Adobe | Prompt / optional `videoSettings` in OpenAPI ecosystem; usage notes list AR sizes — **not** free-form 6DOF path | Brand-safe training narrative (Adobe marketing) | **Medium** — ~5s common; default **4 RPM** / 9k RPD | Use when commercial-safety narrative required; not hero long-form | **VERIFIED CURRENT** |
| **Luma (Agents / Ray 3.2)** | T2V/I2V; start/end; **multi-keyframe 1–64**; extend; HDR/EXR; `video_reframe` | **Yes** — `https://agents.lumalabs.ai` (`POST /v1/generations`) | Official `luma-agents` clients | Prepaid / Agents platform | No | No | Proprietary | **Strongest structured motion among researched:** `keyframes` + `keyframe_indexes` (5s→0–120 / 10s→0–240 @24fps); prompt camera language; reframe type | Keyframes guide appearance; not guaranteed face-lock of real talent | **High** for gen CameraSpec adapters; URL TTL **1h** — download immediately | Own local reframe for **real** talent; Luma reframe optional for gen assets | **VERIFIED CURRENT** |
| **Pika** | Native Pika 2.5 T2V/I2V/keyframe ops + **multi-vendor catalog aggregator** | **Yes** — `https://api.dev.pika.art`; catalog-driven; OpenAPI https://dev.pika.art/openapi.json | REST + catalog; agent-oriented llms specs | Prepaid micro-USD; ToS/AUP; no free gen tier | No | No | Proprietary (routes many upstream licenses) | Native prompt/keyframe; catalog ops model-specific; **no CapCut-style subject follow** | Model-dependent; upstream safety applies | **High as aggregator**; treat as **gateway** — still avoid single-gateway lock-in | Prefer own Router that can call Pika **or** direct vendors | **VERIFIED CURRENT** |
| **HeyGen** | Avatar / Video Agent / translation / talking-head | **Yes** — `https://api.heygen.com` v3; MCP/CLI | Official developer docs | SaaS commercial plans | No | No | Proprietary | Avatar framing — **not** film CameraSpec | Avatar / voice-clone identity — **consent critical** | **Medium** for presenter ads; **wrong default** for STARRDOM cinematic B-roll | Build own NLE; optional avatar route | **VERIFIED CURRENT** (product class = avatar) |
| **Synthesia** | Studio avatar script videos | **Yes** — `POST https://api.synthesia.io/v2/videos` | Official API docs | Enterprise SaaS; test watermark | No | No | Proprietary | Avatar layout (align/scale) only | Stock/custom avatars | **Medium** for training/explainers; not beauty hero | Same as HeyGen | **VERIFIED CURRENT** (avatar class) |
| **ElevenLabs** | TTS / STS / SFX / **Dubbing v2** (preserves picture) | **Yes** — Eleven API (`xi-api-key`) | Official SDKs/docs | Paid tiers; Free Dubbing watermarked | No | No | Proprietary | N/A (audio) | Voice clone strength 0–10 — **consent required** | **High** for VO/dub delivery layer | Optional local TTS later (Wave 6/7) | **VERIFIED CURRENT** (voice — not T2V) |
| **CapCut consumer** | Creator NLE UX (templates/effects/auto-cut) | **No** full edit/gen API for HVS; ChatGPT plugin OpenAPI only (narrow) | N/A | Consumer/Pro tiers — not an HVS dependency | Desktop/mobile apps (no Linux desktop) | No | Proprietary ByteDance | Product Auto Reframe UX only | N/A | **REFUSE** as runtime SoR | **BUILD** ThemePack + EditOps (Wave 2) | **REFUSE / UNVERIFIED as full API** |
| **xAI Grok Imagine Video** (via Pika catalog) | T2V/I2V/ref/V2V listed in Pika catalog | Via Pika aggregator (catalog) | Via Pika | Via Pika prepaid + upstream ToS | No | No | Proprietary | Catalog-defined | Model-dependent | **PARTIAL** — verify direct xAI docs before Router default | Optional catalog route | **PARTIAL / via aggregator** |
| **MiniMax / Wan / Flux video** (catalog) | Alternate T2V/I2V | Via Pika/Runway catalogs | Aggregator | Upstream ToS | No | No | Proprietary | Catalog | Model-dependent | Optional diversification | Do not hardwire | **PARTIAL** until direct docs pinned per route |

### 2.2 Camera-control rank (generative only — Wave 3 aligned)

| Rank | System | Structured control | Label |
|---|---|---|---|
| 1 | **Luma Ray 3.2** | Multi-keyframe indexes + start/end + `video_reframe` | VERIFIED CURRENT |
| 2 | **Kling** | Motion Control APIs | VERIFIED CURRENT |
| 3 | **Veo / Seedance / Runway** | Prompt + first/last/refs; weak CameraSpec objects | VERIFIED CURRENT |
| 4 | **Firefly Video** | Prompt / short; optional videoSettings in ecosystem OpenAPI | VERIFIED CURRENT |
| 5 | **HeyGen / Synthesia** | Avatar layout only | VERIFIED CURRENT (different class) |
| — | **Sora** | Historical prompt-only | **DEAD/UNAVAILABLE** |

**True 6DOF path / lens-metadata API across vendors:** **NOT VERIFIED** as public standard as of Sept 2026 → HVS owns CameraSpec; adapters emit prompt + verified fields only.

### 2.3 Local / OSS generative video (reality check)

| Capability | Sept 2026 research posture | Label |
|---|---|---|
| SOTA cinematic T2V local on Nebula | Not realistic as default quality bar | FUTURE / EXPERIMENTAL eval only |
| Subject follow / hair mask / reframe | **Local OSS preferred** (SAM2 Apache-2.0 + ByteTrack MIT — Wave 3) | VERIFIED tech + PROPOSED use |
| Image gen local (SD/Flux-class) | Possible with license diligence — Wave 7 hardware | PARTIAL / FUTURE |
| Build own foundation video model | **REFUSE** as V1–V3 plan | Build-own = Router + Bible + local CV, not train SOTA T2V |

---

## 3. Domain 31 — Media Provider Router (PROPOSED HVS)

### 3.1 Categories (never hardwire)

```
VIDEO_GENERATOR | IMAGE_GENERATOR | IMAGE_EDITOR | VOICE | TTS | MUSIC | SFX
LIP_SYNC | UPSCALE | INTERPOLATION | TRANSCRIPTION | TRANSLATION | MOTION_TRANSFER | DUBBING
```

### 3.2 Typed ops → Observed library → EditOps

```
GenerateVideo / GenerateImage / EditImage / GenerateVoice / Dub / …
  → Router.select(capability, constraints)
  → Adapter.submit(verified vendor fields only)
  → poll / webhook
  → DOWNLOAD to NAS/local immediately (Veo ~2d; Luma URL ~1h; many TTLs short)
  → AssetRef { sha256, uri, mime, width, height, duration, provider, model, prompt, refs[], params, seed?, license, commercialOk, consentId?, createdAt }
  → Observed Media Library
  → EditTransaction: InsertClip | ReplaceClip | ExtendShot | …
  → optional PreviewTicket → human Accept
```

**Hard rules (PROPOSED):**
- Model must **not** emit raw vendor URLs as timeline SoR — only AssetRefs after ingest.
- Gen ops are non-deterministic unless seed+params recorded; mark provenance accordingly (Wave 4 replay note).
- Router may call **Pika as one gateway** or **direct** Veo/Kling/Luma/Runway/Firefly — either way, HVS types stay vendor-agnostic.
- **Exclude** Sora route after 2026-09-24 (and prefer exclude now).
- Failed paid job: never silently switch models without human approval (Pika docs pattern — adopt for all).

### 3.3 Selection constraints (sketch)

| Constraint | Examples |
|---|---|
| capability | T2V vs I2V vs motion-control vs avatar |
| duration / resolution / AR | 5s 1080p 9:16 vs 8s 4k 16:9 |
| character consistency | needs ref images / elements |
| camera control | needs Luma keyframes or Kling motion |
| rights / commercial | Firefly narrative vs general cloud |
| privacy / residency | Vertex region; EU personGeneration limits |
| cost / latency | quote-before-spend (Pika); Runway credits |
| local vs cloud | identity work → prefer local CV |

### 3.4 EditOp stubs (align Wave 4 §J)

| EditOp | Router? | Notes |
|---|---|---|
| `GenerateVideo` | Yes | Always → library → Insert/Replace |
| `GenerateImage` | Yes | Storyboard cells / thumbs / key art |
| `EditImage` | Yes | Product cleanup; **not** unauthorized face swap |
| `ExtendShot` | Yes | Veo extend / Luma generation_id / Seedance extend |
| `ReplaceBackground` | Hybrid | Local matte preferred for talent; gen for plates |
| `GenerateVoice` / `Dub` | Yes | ElevenLabs path; consent on clone |

---

## 4. Domain 9 — Character Bible (PROPOSED HVS)

First-class War Room / HVS object — **not** a vendor “persistent character” claim beyond what docs support.

### 4.1 Schema sketch

```
CharacterBible {
  id, name, aliases[]
  appearance: { description, ageBand, sensitivityFlags[] }
  approvedRefs: [{ assetId, role: face|wardrobe|product|performance, hash, approvedAt, approvedBy }]
  wardrobeLooks: [{ lookId, campaignId, refs[] }]  // e.g. STARRDOM salon
  voice: { talentId | elevenLabsVoiceId?, consentId, cloneAllowed: bool }
  mannerisms / performanceRefs: [{ assetId, notes }]
  relationships / canon: string?
  embeddings?: { model, vectorRef }   // FUTURE — lawful only
  usageRights: {
    contractId, likenessPermission, territory[], expiresAt,
    aiGenAllowed: bool, trainingOptOut: bool, disclosureRequired: bool
  }
  identityLock: {
    realTalentAuthoritative: true,   // default for beauty
    allowSyntheticDouble: bool,      // requires aiGenAllowed + consent
    refuseCelebrityLikeness: true,
    refuseMinorCommercialLikeness: true  // Legal default REFUSE
  }
}
```

### 4.2 Mapping to providers

| Bible field | Veo | Kling | Luma | Runway | Firefly | HeyGen/Synthesia |
|---|---|---|---|---|---|---|
| approvedRefs | ≤3 reference images | Elements / Omni | keyframes / start-end | Gen4 image refs | optional image | avatar assets |
| CameraSpec | prompt string | Motion Control + prompt | keyframe indexes | prompt | prompt | avatar layout |
| voice | N/A (native audio ambience) | Lip Sync path | N/A | avatars | N/A | avatar VO |

**Never invent** vendor fields for “persistent human digital double” that docs don’t expose. Prefer **real talent footage + refs** over synthetic identity for beauty ads.

### 4.3 Consent gates (PROPOSED — Domain 32 seed)

Before any likeness-adjacent gen:
1. `usageRights.aiGenAllowed == true` and unexpired `consentId`
2. Human gate in ASSIST+ (Wave 4 control modes)
3. Provenance: `consentId` + disclosure flag on AssetRef
4. Else → **REFUSE** route (deepfake / replica blocked)

---

## 5. Domain 10 — STARRDOM proving scenario (luxury hair-extension ad)

### 5.1 Acceptance-class NL (from assignment — intent only)

> Take these STARRDOM clips and create a 30-second luxury hair-extension commercial. Follow the model during the reveal, use close-ups of the hair, remove weak sections, match the cuts to the beat, use a luxury filter, add captions, use the STARRDOM logo, create an AI beauty shot if we're missing one, then make 9:16 and 16:9 versions.

Expressed as **EditOps + gates**, not CapCut export. Full acceptance matrix → **Wave 8 §23**.

### 5.2 Local vs provider split

| Shot / need | Prefer LOCAL (Nebula) | Prefer PROVIDER (Router) | Ethics |
|---|---|---|---|
| Model follow / reveal | TrackSubject → CameraSpec → crop | — | Real footage authoritative |
| Hair CU / hair segmentation | SAM2 masks ± hair-class fine-tune | — | Mask texture/motion; **do not replace face identity** |
| Face-aware grade / beauty look | Landmarks → region masks; ThemePack `luxury_salon` / Clean Beauty (**opt-in**) | — | Honest skin tone; beauty **OFF by default** |
| Weak section remove | Lift / Extract / quality rank (never delete source) | — | Human confirm ASSIST+ |
| Beat-matched cuts | Beat markers + EditOps (Wave 6 depth) | — | Licensed music |
| Luxury filter / grade | ThemePack + OCIO later | — | Wave 2/6 |
| Captions / CTA / logo | ASR + ThemePack graphics | — | Brand kit local |
| Missing beauty B-roll | — | Veo refs / Kling elements / Luma keyframes / Firefly short | **Consent + disclose AI**; prefer empty/product plates |
| Salon cinematic empty plates | — | T2V/I2V + CameraSpec→prompt | Avoid fake talent faces |
| Product / label lock | Object track | Optional gen product turntable | — |
| VO | Recorded VO ingest | ElevenLabs TTS (consent if clone) | No unauthorized voice clone |
| Avatar talking head | — | HeyGen/Synthesia **optional** | Wrong default for luxury hair hero |
| 9:16 + 16:9 | Local smart reframe | Optional Luma `video_reframe` for **gen** assets only | QC both; never dumb center crop |

### 5.3 REFUSE list (STARRDOM)

- Deepfake / AI replica of real people **without** Character Bible consent  
- Default beauty ON / identity-destroying “enhance”  
- CapCut/Adobe scrape for looks or templates  
- Claiming gen face = photographed talent without disclosure  
- Sora as production dependency  
- Silent source delete when “removing weak sections” (rank/hide only; Lift on timeline)

### 5.4 Beauty notes for master report (fold)

**STARRDOM beauty policy (PROPOSED HVS):** Real talent footage is authoritative. Generative beauty B-roll is **opt-in**, consent-gated, provenance-tagged, and disclosed. Hair/face work prefers local segmentation + grade over identity replacement. Avatar vendors are a separate product class. Full end-to-end acceptance scoring waits Wave 8.

---

## 6. Domain 20 — Image production pipeline → timeline ingest

### 6.1 Flow (PROPOSED)

```
Brief / Character Bible / product refs
  → Router: IMAGE_GENERATOR | IMAGE_EDITOR
       (Firefly image APIs · Seedream via Pika · GPT Image via Pika/OpenAI · etc.)
  → AssetRef + provenance → Media Library (Observed)
  → optional still → I2V (Veo/Kling/Luma/Runway/Pika native)
  → storyboard cell OR InsertClip still OR key art / thumbnail / poster
  → EditOps attach to timeline / ThemePack logo slot
```

### 6.2 Image roles

| Role | Destination |
|---|---|
| Character approved refs | Character Bible packs |
| Storyboard frames | Domain 21 board (draft under gates) |
| Product hero stills | Timeline + I2V |
| Thumbnails / posters / ad graphics | Deliverables bin |
| Logo / end card | ThemePack / graphics track |

### 6.3 VERIFIED image API notes (light)

| Source | Status | Notes |
|---|---|---|
| Adobe Firefly image endpoints | VERIFIED CURRENT (Firefly Services) | Async generate; rate limits in usage notes |
| OpenAI GPT Image | VERIFIED CURRENT (Images API) — separate from **dead** Videos/Sora | Use for stills; not video |
| Pika catalog T2I / edit | VERIFIED CURRENT (catalog) | Quote-before-spend |
| CapCut template images | REFUSE scrape | Prior art only |

---

## 7. Domain 21 — Storyboard / previs (sketch only)

| Stage | HVS concept | Label |
|---|---|---|
| Script breakdown | Shots with CameraSpec + duration + dialogue | PROPOSED |
| Auto storyboard | Image gen per cell from Bible + brief; **spend gate** | PROPOSED |
| Animatic | Stills or short I2V under timed audio | PROPOSED |
| Continuity | Character Bible wardrobe variants | PROPOSED |
| True 3D light-field previs | — | FUTURE |

Manual boards remain first-class; AI boards = Scenario drafts (Wave 4 Observed vs Scenario).

---

## 8. Build vs integrate vs refuse (Wave 5 slice)

| Subsystem | Decision | Label |
|---|---|---|
| Provider Router + typed gen ops | **BUILD** | PROPOSED HVS |
| Character Bible + consent flags | **BUILD** | PROPOSED HVS |
| Asset ingest + provenance | **BUILD** | PROPOSED HVS |
| Veo / Kling / Luma / Runway / Firefly / Pika / ElevenLabs adapters | **INTEGRATE** (commercial API) | VERIFIED CURRENT surfaces |
| HeyGen / Synthesia | **OPTIONAL INTEGRATE** (avatar class) | VERIFIED CURRENT |
| Sora / OpenAI Videos | **REFUSE / DEAD** | DEAD/UNAVAILABLE |
| CapCut gen/edit API | **REFUSE** | NO full API |
| Local SOTA T2V foundation model | **REFUSE** for V1–V3 | FUTURE research only |
| Local TrackSubject / hair / reframe | **BUILD** on OSS (Wave 3) | VERIFIED + PROPOSED |
| ThemePack luxury beauty looks | **BUILD** (Wave 2); beauty off default | PROPOSED |

---

## 9. Risks / legal (Wave 5 additions)

| Risk | Label |
|---|---|
| Provider ToS change / commercial tier gating | VERIFIED pattern — archive ToS PDF+date before client jobs |
| Beauty + AI replica without consent | **REFUSE** |
| Veo 2-day / Luma 1h URL loss | VERIFIED CURRENT retention/TTL — download-to-Observed mandatory |
| Aggregator lock-in (Pika-only or Runway-only) | REFUSE — Router must allow direct vendors |
| Claiming Firefly/Pika APIs without docs | Was UNVERIFIED; **now verified** — keep citations |
| CapCut unofficial wrappers as core | REFUSE |
| Post–2026-09-24 Sora calls in production | **DEAD** — break builds if still wired |
| Regional `personGeneration` blocks (Veo) | VERIFIED CURRENT limits |
| FTC / ad disclosure for AI beauty | PROPOSED policy: disclose when gen used |
| Minor / celebrity likeness | REFUSE defaults |

---

## 10. Sources (official preferred — Sept 2026)

### OpenAI / Sora
1. Deprecations (Videos API + sora-2* shutdown 2026-09-24, no replacement) — https://developers.openai.com/api/docs/deprecations  
2. Sora discontinuation Help — https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation  
3. Video generation guide (historical until shutdown) — https://developers.openai.com/api/docs/guides/video-generation  

### Google Veo
4. Gemini API Veo 3.1 — https://ai.google.dev/gemini-api/docs/veo  
5. Cloud Veo 3.1 model card — https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate  
6. Vertex/Agent Platform Veo generate-from-text — https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-text  

### Runway / Kling / Seedance / Luma / Pika / Firefly
7. Runway Dev API — https://docs.dev.runwayml.com/  
8. Kling Open Platform — https://kling.ai/document-api  
9. Kling Motion Control — https://kling.ai/document-api/api/video/motion-control  
10. BytePlus ModelArk Seedance — https://docs.byteplus.com/en/docs/modelark/2291680  
11. Luma Agents Ray 3.2 generation — https://docs.agents.lumalabs.ai/guides/videos/generation/  
12. Luma Agents reframing — https://docs.agents.lumalabs.ai/guides/videos/reframing/  
13. Pika API llms.txt — https://dev.pika.art/llms.txt  
14. Pika OpenAPI — https://dev.pika.art/openapi.json  
15. Adobe Firefly usage notes (Generate Video sizes / RPM) — https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/  
16. Adobe Firefly API reference — https://developer.adobe.com/firefly-services/docs/firefly-api/api/  
17. Firefly Services JS SDK FireflyClient — https://github.com/Firefly-Services/firefly-services-sdk-js  

### Avatar / voice
18. HeyGen Quick Start — https://developers.heygen.com/docs/quick-start  
19. Synthesia Create Video — https://docs.synthesia.io/reference/create-video  
20. ElevenLabs Dubbing — https://elevenlabs.io/docs/overview/capabilities/dubbing.mdx  

### CapCut / prior art (boundaries)
21. CapCut ChatGPT plugin OpenAPI (narrow — not full NLE) — https://www.capcut.com/openapi.yaml  
22. CapCut Help (templates/effects — Wave 2) — https://www.capcut.com/help/  

### Local identity stack (cross-wave)
23. SAM 2 — https://github.com/facebookresearch/sam2  
24. ByteTrack — https://github.com/FoundationVision/ByteTrack  

### Internal seeds
25. `/home/box/higher-vision-studios/waves/WAVE_2_SEED.md`  
26. `/home/box/higher-vision-studios/waves/WAVE_4_MISFILED_GENERATIVE_STARRDOM_from_old_map.md`  
27. `hvs-waves/HVS_WAVE_3_SUBJECT_CAMERA.md` · `HVS_WAVE_4_AI_DIRECTOR_EDITOPS.md`  
28. `HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` (Legal locks)  
29. `HVS_8_WAVES_PLAN.md` · `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md`  

---

## 11. Open questions (do not invent answers)

- Live Seedance 2.5 exact max seconds / pricing on **direct** BytePlus ModelArk vs Runway vs Pika — pin before production adapters.  
- Firefly Video production org RPM / contract duration beyond usage-notes defaults.  
- Whether any provider offers **documented** lawful persistent human digital-double APIs suitable for beauty ads — treat as open + Legal review.  
- Post–2026-09-24 OpenAI video successor — **none verified**; revisit only if OpenAI publishes official replacement.  
- Storyboard auto-gen spend caps (max cells / max I2V) before Director runaway.  
- Lip-sync for real talent: cutaways + VO vs Kling/HeyGen avatar — pick per spot.

---

## 12. VERIFIED vs UNVERIFIED / DEAD — rollup

### VERIFIED CURRENT (official docs cited this wave)
Google Veo 3.1 · Runway Dev · Kling Open Platform · Luma Agents Ray 3.2 · **Pika API** · **Adobe Firefly Generate Video** · HeyGen API · Synthesia API · ElevenLabs API · Seedance via ModelArk/aggregators (existence) · SAM2/ByteTrack local stack (Wave 3)

### DEAD / UNAVAILABLE
**OpenAI Sora / Videos API** (shutdown 2026-09-24; app sunset 2026-04-26; no replacement)

### UNVERIFIED / NO / REFUSE
CapCut **full** NLE/theme/gen API for War Room · CapCut/Adobe scrape · undocumented camera JSON · Sora-as-live long-term · beauty-on-by-default · unauthorized real-person deepfake

### PARTIAL
Exact Seedance direct caps/pricing · xAI/MiniMax/Wan as Router defaults (catalog-visible; pin direct docs) · lawful persistent human digital-double APIs

---

*Wave 5 stamp — Generative + Characters + STARRDOM | RESEARCH ONLY | not shipped | 2026-09-20 ET*

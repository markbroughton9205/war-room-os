# HVS WAVE 2 — CAPCUT-STYLE CREATIVE / THEMESPEC ENGINE (Domain 2)
## Status / Date

| Field | Value |
|---|---|
| **Status** | **WAVE_2 DONE** — Domain 2 stamped |
| **Date** | Sunday Sep 20, 2026 · ~2:25 PM EDT (America/New_York) |
| **Commander** | Mark |
| **Mode** | RESEARCH ONLY — no code / build / commit |
| **Scope** | **Domain 2 only** — CapCut-style creative system; **HVS-owned ThemeSpec** |
| **PA wave map** | `HVS_8_WAVES.md` Wave 2 · CapCut = prior art + optional export only |
| **Locks** | HVS ≠ Media Player ≠ Terra · CapCut ≠ SoR · REFUSE CapCut scrape / reverse engineer / library asset theft · REFUSE CapCut SDK/material dependency · VERIFIED CURRENT / PROPOSED / FUTURE · do not invent theme API |
| **Prior file note** | Earlier misfiled camera draft at this path + `WAVE_2_SEED.md` remain on disk as camera/Domain 3–5 evidence; **canonical Wave 3** owns subject follow + CameraSpec. This stamp **replaces** WAVE_2 content with Domain 2 only (fold ThemeSpec notes from Wave A / Master Report — do not trash). |

Claim tags: **VERIFIED FACT** | **VENDOR CLAIM** | **INFERENCE** | **RECOMMENDATION**

---

## 0. Boundary locks (from WAVE_1 + Domain 2)

| Rule | Meaning |
|---|---|
| CapCut = **prior art + optional human export path** | Never system of record; never runtime dependency for HVS SoR |
| **REFUSE** CapCut scrape / RE / asset theft | Legal lock — no ripping filters, fonts, music beds, stickers, template packs |
| **REFUSE** CapCut as SoR | `.hvsproj` + ThemeSpec owned by HVS |
| HVS ≠ Media Player ≠ Terra | Creative themes live in HVS Effects/Themes lane only |
| Linux-first (Nebula) | Theme render path must not require CapCut Desktop/Mobile |
| Labels mandatory | VERIFIED CURRENT FEATURE · PROPOSED HVS FEATURE · FUTURE/EXPERIMENTAL |

**Critical Q10/Q11 (preview answers — Wave 8 will restate):** CapCut-like themes/filters/effects = **own ThemeSpec + Look/Effect packages** applied as non-destructive EditOps on the Wave 1 hybrid timeline — **not** CapCut embed.

---

## 1. CapCut feature surface — VERIFIED vs UI-only (Sept 2026)

Research base: **official CapCut Help** pages dated Jan–Mar 2026 + product marketing pages. No invented developer theme API. Live fetch of `https://www.capcut.com/openapi.yaml` on 2026-09-20 returned **502 / unavailable** — plugin OpenAPI treated as **historically reported**, not verified live today.

### 1.1 Templates — VERIFIED CURRENT FEATURE (product UX)

| Fact | Evidence | Label |
|---|---|---|
| Templates package **pre-designed effects, transitions, stickers, and music**; user replaces media / edits text | CapCut Help — *How to Use Templates* (Jan 12, 2026); *How to Search for Templates* (Jan 13, 2026) | **VERIFIED CURRENT FEATURE** |
| Platforms: **Web, Desktop (PC), Mobile**; methods differ; availability varies by platform / version / region | Same Help pages; *Template unavailable* / geo / A-B / account gates (Feb 3, 2026) | **VERIFIED CURRENT FEATURE** |
| Flow: browse/search → **Use Template** → customize in editor → export | Official Help | **VERIFIED CURRENT FEATURE** |
| Mobile: TikTok / social **"Use this template"** deep links; creator media may be **protected** | Help — Use Template (mobile) | **VERIFIED CURRENT FEATURE** |
| Cloud library churn: AI effects/templates can be **removed** (licensing, campaigns, optimization); Save Template / export early advised | Help — *AI templates and effects* (Feb 3, 2026) | **VERIFIED CURRENT FEATURE** |
| Web catalog more restricted than Mobile; Desktop often a curated subset; Mobile-first for trending | Help — *Why other users see templates I can't* (Feb 3, 2026) | **VERIFIED CURRENT FEATURE** |
| Discover newest via in-app Templates, Explore pages, TikTok CapCut tags, creator program | Help — *Newest CapCut Templates for 2026* (Mar 30, 2026) | **VERIFIED CURRENT FEATURE** (discovery UX) |

**NOT verified as War Room-callable SoR:** CapCut template binary formats, internal draft schema, or a general “apply any CapCut template ID from Linux server” SDK.

### 1.2 Filters / Effects / Transitions — VERIFIED CURRENT FEATURE (UI libraries)

| Surface | What official Help documents | Programmatic API for HVS? | Label |
|---|---|---|---|
| **Effects** | Browse/apply on clip; categories include All / Trending / Cinematic / Retro / Glitch / AI Effects (Web); Desktop adds Stylize, Distort, Blur, Color Grading, Transitions, AI Effects; Mobile: Trending, Cinematic, Anime, Glitch, VHS, Dreamy, AI Effects | **No** verified public NLE write API | **VERIFIED CURRENT FEATURE** (UI) |
| **Intensity / duration** | Sliders after apply; Desktop Inspector: blend, opacity, speed, color tone; Save as Preset (Desktop) | No | **VERIFIED CURRENT FEATURE** (UI) |
| **AI-named tools in Help** | AI Portrait, AI Color Match, AI Sky Replacement, AI Style Transfer (oil/watercolor/cyberpunk-class — product names in Help) | No HVS-callable CapCut API | **VERIFIED CURRENT FEATURE** (product names); depth = UI |
| **Filters** | Product/marketing: themed preset filters; adjust strength; AI color correction claims on tools page | Marketing + UI — treat parameter math as **VENDOR CLAIM** until measured | **VERIFIED** product exists; internals **UNVERIFIED** |
| **Transitions** | Documented as part of template packages + effects categories; 2026 trends cite glitch / high-energy transitions | No API | **VERIFIED** as UX category |

**Blind Spot:** Named effect strings in Help are **catalog labels**, not an open effect-graph schema HVS can legally import.

### 1.3 Captions / text (creative-adjacent, Domain 13 deep-dive later)

| Fact | Label |
|---|---|
| Auto Captions / Recognise Subtitles on Web, Desktop, Mobile (as of Jan 2026 Help); edit timing/style after generate | **VERIFIED CURRENT FEATURE** (UX) — full caption engine = Wave 6 |

### 1.4 CapCut “API” reality — do not invent Theme API

| Claim | Status | HVS stance |
|---|---|---|
| General CapCut Desktop/Mobile **effects/filters/transitions write API** for third-party SoR | **Not found** in official developer docs reviewed | **Do not invent** |
| CapCut ChatGPT / plugin OpenAPI historically describing `searchTemplates` + text-to-video draft link endpoints | Reported in third-party plugin mirrors; **live `openapi.yaml` fetch failed (502) on 2026-09-20** | Mark **UNVERIFIED CURRENT** for availability; even if restored, it is **template search / draft assist → CapCut**, not HVS ThemeSpec SoR |
| CapCut × Codex (official product page) | Positions AI-assisted draft → refine **in CapCut**; region/account gated | Optional **export/handoff** path only — never SoR |
| Unofficial GitHub “CapCutAPI” / MCP draft manipulators | **Not official** | **REFUSE** reverse-engineer / draft-file hacking |
| **BytePlus Video Editor SDK / Magic Template SDK** | Official commercial SDK (BytePlus docs); annual license; **iOS+Android** packaging in pricing docs; Magic Template **separate purchase**; asset library CapCut/TikTok-class (VENDOR) | **Commercial integrate candidate** for *mobile white-label* only — **not** CapCut consumer app dependency; **does not** replace HVS Linux ThemeSpec SoR; REFUSE treating as free CapCut materials |

---

## 2. How templates conceptually package creative intent (INFERENCE from official wording)

Official CapCut Help repeatedly states templates apply **effects + transitions + stickers + music**, then user swaps footage/text. Combined with industry template practice (INFERENCE — not CapCut source-code):

| Package slot | CapCut prior-art role (concept) | HVS ThemeSpec role |
|---|---|---|
| Typography / fonts | Text styles in templates | Owned font refs + style tokens |
| Captions | Auto captions + template text motion | CaptionStyle + ASR hook (Wave 6) |
| Grade / filter look | Filter / color grading effects | LookSpec (LUT/OCIO params) — non-destructive |
| Transitions | Between slots / clips | TransitionSpec IDs on edit graph |
| Music / SFX | Bundled beds (licensing gated) | Licensed bed refs + beat markers (Wave 6) |
| Animation / MGFX | Stickers, text anim, overlays | MotionGraphic slots — HVS-authored |
| Logo / brand | Stickers / end cards | LogoPlacement + brand kit |
| Aspect presets | Template AR; search enums historically include 16:9, 9:16, 1:1, … | AspectPreset set (16:9, 9:16, 1:1, 4:5, …) |
| Pacing | Beat-sync / velocity trends (2026 Help trends) | PaceProfile (cut density, speed-ramp policy) |
| Slot map | Replaceable media slots; creator media protected | MediaSlot[] with role tags (hero, product, B-roll) |

**2026 CapCut Help trends (VENDOR product copy, Mar 30, 2026):** AI one-click templates, cinematic/aesthetic, velocity/slow-mo, beat sync, glitch transitions, short-form storytelling, remix culture, niche aesthetic filters (Y2K / cozy / “clean girl”). Use as **UX competitive language only** — do not clone packs.

---

## 3. HVS ThemeSpec — PROPOSED schema (owned engine)

**PROPOSED HVS FEATURE** — first-class War Room type; stored in `.hvsproj` / theme library; applied via EditCommandLayer (Wave 4). CapCut has **no** verified equivalent object for us to call.

### 3.1 Design principles

1. **Non-destructive:** Theme apply = stack of Look + CaptionStyle + Transition defaults + overlay tracks + audio beds — source media untouched.  
2. **Adjustable looks:** Every Look has intensity 0–1 + exposed params (lift/gamma/gain hints, sat, warmth, grain, vignette) — examples: Luxury Gold, Clean Beauty, Cinematic Teal, Warm Lifestyle, Dark Luxury, Commercial Clean, Film 35, Dream, Vintage, Street, Gaming Neon (Domain 11 names — **examples**, not CapCut clones).  
3. **Composable:** Theme references Look IDs, Effect IDs, Transition IDs, CaptionStyle IDs, MusicBed IDs — swap one slot without rewriting whole theme.  
4. **Provenance:** Each asset carries `licenseClass`, `source`, `commercialOk`, `consent`.  
5. **Aspect-aware:** Theme declares preferred Aspects + reframe policy hook (Wave 3 TrackSubject — out of scope here).  
6. **AI-applicable:** `ApplyTheme(themeId, scope, intensity, overrides)` is a typed EditOp — not tip text.

### 3.2 Schema fields (PROPOSED — research sketch, not shipped JSON Schema)

```text
ThemeSpec {
  id: string                    # e.g. "hvs.theme.luxury_salon.v1"
  name: string
  version: semver
  category: ThemeCategory       # see §4
  description?: string
  tags: string[]

  aspects: AspectPreset[]       # ["16:9","9:16","1:1",...]
  durationHintSec?: { min, max, ideal }

  slots: MediaSlot[]            # role, aspect, durationHint, required
  typography: {
    titleStyle, subtitleStyle, bodyStyle, ctaStyle  # fontRef, size, weight, color, tracking, case
  }
  captionStyleId?: string       # karaoke / word-highlight prefs
  lookId: string                # → LookSpec
  lookIntensityDefault: 0..1
  transitions: {
    defaultIn?, defaultOut?, defaultBetween?, allowedIds[]
  }
  effects: { defaultIds[], optionalIds[] }   # HVS EffectSpec refs only
  motion: {
    titleAnim?, lowerThirdAnim?, logoAnim?, overlayIds[]
  }
  audio: {
    musicBedId?, musicLicenseRef?, duckPolicy?, loudnessTargetLUFS?
    sfxIds[]?
  }
  pacing: {
    cutDensity?: low|medium|high
    beatSyncPreferred?: bool
    speedRampPolicy?: none|subtle|aggressive
  }
  brand: {
    logoAssetId?, logoPlacement: { x,y,scale,safeMargin }
    colorTokens?: { primary, secondary, accent, bg }
  }
  endCard?: { layoutId, ctaTextDefault?, durationSec }
  applyPolicy: {
    nonDestructive: true
    previewBeforeCommit: true
    undoable: true
  }
  provenance: { author, createdAt, licenseClass, commercialOk }
}

LookSpec {
  id, name, category
  engine: "ocio_lut" | "param_grade" | "hybrid"
  lutRef?: assetId              # HVS-owned / licensed LUT only
  params: { exposure, contrast, sat, warmth, tint, highlights, shadows, grain, vignette, ... }
  skinToneProtect?: bool        # STARRDOM beauty default ON
  adjustable: true
  intensity: 0..1
}
```

### 3.3 Example looks (PROPOSED content — not CapCut assets)

| Look ID | Intent | Notes |
|---|---|---|
| `look.luxury_gold` | Warm gold lift, soft highlight roll-off, gentle grain | STARRDOM hair ads |
| `look.clean_beauty` | Neutral WB, skin-protect, low grain | Salon / beauty |
| `look.cinematic_teal` | Teal-orange bias, crushed blacks (subtle) | Trailer / cinematic |
| `look.commercial_clean` | Bright, high key, low vignette | Product / retail |
| `look.gaming_neon` | Sat boost, bloom-friendly, cool shadows | Gaming / neon |
| `look.documentary_clean` | Flat-ish, natural sat, minimal stylize | Docs / real-estate walkthrough |

### 3.4 Apply model (PROPOSED)

```text
ApplyTheme(themeId, scope: sequence|range|selection, intensity?, overrides?)
  → preview transaction
  → commit: attach Look adjustment layer / clip attributes + caption style + default transitions
             + optional music bed track + logo overlay track
  → never mutate source files; never pull CapCut CDN assets
```

---

## 4. Theme categories Mark wants (PROPOSED catalog)

All IDs are **HVS-authored** content seeds — capability coverage, not CapCut clones.

| Category | Example Theme IDs | Primary aspects | Look bias | Captions | Pacing |
|---|---|---|---|---|---|
| **Ad / commercial** | `theme.ad_product_30s`, `theme.ad_ugc_hook` | 9:16 + 16:9 | commercial_clean / luxury_gold | Bold CTA + karaoke optional | High hook density |
| **Luxury** | `theme.luxury_salon`, `theme.dark_luxury` | 16:9, 9:16 | luxury_gold / dark_luxury | Elegant thin titles | Medium, slow push-ins |
| **Cinematic** | `theme.cinematic_trailer` | 16:9 (2.39 letterbox optional FUTURE) | cinematic_teal / film_35 | Minimal lower-thirds | Slow → impact cuts |
| **TikTok** | `theme.tiktok_fast` | 9:16 | street / neon / aesthetic | Large word-highlight | High + beat sync |
| **Reels** | `theme.reels_lifestyle` | 9:16 | warm_lifestyle / clean_beauty | Soft aesthetic captions | Medium-high |
| **YouTube intro** | `theme.yt_intro_10s` | 16:9 | commercial_clean | Channel title + end card | Fast brand sting |
| **Gaming** | `theme.gaming_highlight` | 16:9 + 9:16 | gaming_neon | Memey / impact fonts | Velocity + SFX |
| **Documentary** | `theme.doc_interview` | 16:9 | documentary_clean | Subtitle-safe | Low–medium |
| **Beauty / salon** | `theme.beauty_salon`, `theme.starrdom_reveal` | 9:16 + 16:9 | clean_beauty / luxury_gold | Soft luxury titles | Reveal-paced |
| **Product commercial** | `theme.product_hero` | 1:1, 4:5, 9:16, 16:9 | commercial_clean | Price/CTA cards | Product CU beats |
| **Sports** | `theme.sports_hype` | 16:9, 9:16 | contrasty / teal | Bold scores/lower-thirds | Aggressive + beat |
| **Music video** | `theme.mv_montage` | 16:9, 9:16 | film_35 / vintage / neon | Sparse / lyric karaoke | Strict beat sync |
| **Wedding** | `theme.wedding_romantic` | 16:9, 9:16 | warm_lifestyle / dream | Script titles | Soft dissolves |
| **Real estate** | `theme.realty_tour` | 16:9, 9:16 | commercial_clean | Address/agent end card | Steady walk pace |
| **Automotive** | `theme.auto_drive` | 16:9, 9:16 | cinematic_teal / dark_luxury | Spec titles | Speed-ramp friendly |

**STARRDOM proving path:** `theme.starrdom_reveal` + `look.luxury_gold` + logo slot + 16:9/9:16 aspects — V1 thin theme ship target (Wave 8).

---

## 5. Build vs integrate (Domain 2)

| Option | Fit | Verdict |
|---|---|---|
| **A. Own ThemeSpec + Look/Effect packages** on Wave 1 timeline + FFmpeg/OCIO/OpenFX-class render | Linux Nebula; no CapCut lock-in; provenance | **RECOMMENDED — BUILD** |
| **B. License CapCut consumer materials / scrape CDN** | Legal refusal | **REFUSE** |
| **C. Depend on CapCut Desktop/Mobile as SoR** | Breaks Linux SoR; cloud churn; no deep write API | **REFUSE** |
| **D. Optional CapCut × Codex / plugin handoff** | Human opens CapCut to finish/export | **OPTIONAL EXPORT ONLY** — never required for V1 acceptance |
| **E. BytePlus VE / Magic Template SDK** | Official commercial; mobile iOS/Android license model in docs; separate Magic Template SKU; CapCut-class assets under **paid** license | **HYBRID later / RESEARCH** — evaluate only if Mark wants white-label mobile editor; **does not** replace HVS ThemeSpec; **not** free CapCut; Linux desktop SoR still ours |
| **F. Unofficial CapCutAPI / draft RE** | ToS + Legal risk | **REFUSE** |
| **G. OSS building blocks** | Fonts (OF L / SIL), OCIO configs, FFmpeg filters, OpenFX hosts, licensed music beds, HVS-authored LUTs | **INTEGRATE** under Legal review |

**RECOMMENDATION:** Build **ThemeSpec engine** ourselves. Treat CapCut strictly as **prior art UX**. Refuse CapCut material dependency. BytePlus SDK = optional paid path for *other* products, not Wave 2 SoR.

---

## 6. Open questions / UNVERIFIED

| ID | Question | Status |
|---|---|---|
| Q-D2-1 | Live CapCut `openapi.yaml` availability + exact plugin endpoints (2026-09-20 fetch 502) | **UNVERIFIED CURRENT** |
| Q-D2-2 | Whether CapCut × Codex exposes any durable machine API beyond ChatGPT desktop skill flow | **UNVERIFIED** — product page is workflow/marketing |
| Q-D2-3 | Exact CapCut Desktop vs Mobile vs Web catalog parity for a given template ID | **UNVERIFIED** (Help asserts intentional gating) |
| Q-D2-4 | BytePlus Magic Template: Linux desktop SDK? Current public pricing quotes? Asset license for War Room SaaS redistribution? | **UNVERIFIED** — contact sales; mobile-focused docs dominate |
| Q-D2-5 | LUT/OCIO stack choice for LookSpec on Nebula (OCIO config pin) | OPEN — Wave 6/7 |
| Q-D2-6 | Theme marketplace legal model (creator upload + commercial relicensing) | FUTURE |
| Q-D2-7 | AI “suggest theme from brand kit” quality bar | FUTURE / EXPERIMENTAL |
| Q-D2-8 | Mapping ThemeSpec → OTIO (lossy — effects/looks) | OPEN — disclose lossy on export |

---

## 7. Sources

### Official CapCut Help / product (preferred)

1. Use Templates — https://www.capcut.com/help/use-template (Jan 12, 2026)  
2. Search Templates — https://www.capcut.com/help/how-to-search-for-templates (Jan 13, 2026)  
3. Alternative / recommended effects — https://www.capcut.com/help/recommended-alternative-effects (Feb 3, 2026)  
4. AI templates & effects removal — https://www.capcut.com/help/ai-templates-and-effects (Feb 3, 2026)  
5. Template/effect availability gaps — https://www.capcut.com/help/template-unavailable (Feb 3, 2026)  
6. Newest templates 2026 — https://www.capcut.com/help/new-templates (Mar 30, 2026)  
7. Editing trends 2026 — https://www.capcut.com/help/latest-capcut-editing-trends (Mar 30, 2026)  
8. Auto captions / Recognise Subtitles — https://www.capcut.com/help/how-to-recognise-subtitles (Jan 2026 Help)  
9. Filters/effects marketing tool page — https://www.capcut.com/tools/video-effect-and-filter  
10. CapCut × Codex — https://www.capcut.com/tools/capcut-x-codex  
11. CapCut Help Center hub — https://www.capcut.com/help  
12. CapCut OpenAPI URL (historically cited; **live fetch 502 on 2026-09-20**) — https://www.capcut.com/openapi.yaml  

### BytePlus (commercial SDK — not CapCut consumer)

13. Magic Template product overview — https://docs.byteplus.com/en/docs/byteplus-video-editor-sdk/docs-product-overview-2-v.4.0.2  
14. One-pager / Magic Template separate purchase — https://docs.byteplus.com/en/docs/byteplus-video-editor-sdk/docs-one-pager-overview_1  
15. VE SDK pricing (sales-quoted annual iOS+Android) — https://docs.byteplus.com/en/docs/video-editor-sdk/120-pricing  
16. Licensing guide — https://docs.byteplus.com/en/docs/byteplus-video-editor-sdk/docs-licensing-guide  

### Internal folds

17. `HVS_8_WAVES.md` — Wave 2 Domain 2 definition  
18. `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md` — Domain 2 + Domain 11 look names  
19. `/workspace/terra-swarm/HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` — Domain 2 seed inventory  
20. `waves/WAVE_1.md` — CapCut ≠ SoR / no deep NLE write API locks  
21. Master Report ThemeSpec one-liners (architecture lens)

### Explicit non-sources (REFUSE)

- Unofficial CapCutAPI / VectCutAPI MCP repos for draft RE  
- CapCut/Adobe asset CDN scraping  
- Invented CapCut Theme REST fields  

---

## 7b. Blind Spot challenge — CapCut lock-in / scrape / fake-API / tips≠ops (Avenger Blind Spot)

**Status:** Domain 2 Blind Spot stamped · RESEARCH ONLY · 2026-09-20

### Absorb (PA2 Blind Spot + Legal locks)

| Lock | Wave 2 application |
|---|---|
| CapCut ≠ SoR | ThemeSpec in `.hvsproj` only; CapCut = optional human export |
| REFUSE CapCut/Adobe scrape / RE / CDN dumps | No filter/font/music/sticker/template theft; no draft-file hacking |
| Tips-only AI REFUSE | `ApplyTheme` must be typed EditOp → real look/caption/transition/audio stamps + undo + asset hash |
| Default beauty REFUSE | Beauty/face packs **off by default**; explicit opt-in; never auto on Commander/news/intel |
| Single-provider lock-in REFUSE | Theme render = local OCIO/LUT/FFmpeg/OpenFX path; BytePlus optional paid later — never required SoR |
| V1 kitchen-sink | V1: thin ThemeSpec (1–2 looks + caption style + export) — defer gen-video, CapCut handoff-required flows, marketplace |
| Legal | Client commercial tiers; provenance on every Look/Effect/music bed; CapCut stock often platform-limited |

### Challenges to Wave 2 draft (do not soft-pedal)

| Trap | Severity | Challenge |
|---|---|---|
| **Fake CapCut Theme API** | HIGH | Help catalogs ≠ open effect-graph. Live `openapi.yaml` 502 → treat plugin OpenAPI as **UNVERIFIED CURRENT**. Invented Theme REST = REFUSE. |
| **Unofficial CapCutAPI / VectCut / MCP draft RE** | HIGH | Third-party ≠ CapCut Inc. **REFUSE** as official or as SoR. |
| **CapCut-as-SoR via “export then re-import”** | HIGH | Human CapCut finish path OK; requiring CapCut Desktop/Mobile for HVS acceptance = **Linux blocker** + lock-in. V1 must accept without CapCut installed. |
| **CDN / library asset theft** | HIGH | Template churn Help (effects removed) proves **vendor cloud is not archive**. Scraping to “own” packs = Legal REFUSE. |
| **BytePlus VE / Magic Template = “free CapCut”** | MEDIUM–HIGH | Official commercial SDK ≠ CapCut consumer materials. Mobile iOS/Android license model ≠ Nebula Linux SoR. Treat as **VENDOR CLAIM / sales-gated** until SPDX + redistribution + Linux desktop clarified. Do not bake into V1. |
| **LookSpec `skinToneProtect` default ON** | MEDIUM | Conflicts with Blind Spot **beauty off by default**. **RECOMMENDATION:** `beautyEnabled: false` default; skin-protect grade params ≠ beauty morph; STARRDOM beauty packs opt-in + consent_id. |
| **Theme catalog as CapCut clone names** | MEDIUM | Category table = capability coverage only. Trap: shipping CapCut-named packs or cloned LUTs. HVS IDs + HVS-authored/licensed assets only. |
| **tips≠ops on Auto Cut / “AI one-click”** | HIGH | CapCut Auto Cut = in-app prior art only (Evidence: no public API). HVS AI must emit EditOps (cut/speed/lut/captions), never tip text. Defer Auto Cut–class to Wave 4 EditOps. |
| **OTIO ThemeSpec export** | LOW–MEDIUM | Looks/effects lossy on OTIO — disclose; do not claim round-trip “exact CapCut template.” |
| **research≠shipped** | ALWAYS | ThemeSpec schema in this stamp = **PROPOSED**, not product. Master Report architecture draft ≠ Wave 8 complete. |

### Failure classes (Domain 2)

`CAPCUT_SOR` · `FAKE_THEME_API` · `UNOFFICIAL_API_AS_OFFICIAL` · `CDN_SCRAPE` · `BYTEPLUS_AS_FREE_CAPCUT` · `BEAUTY_DEFAULT_ON` · `TIPS_NOT_OPS` · `CAPCUT_REQUIRED_FOR_V1` · `THEME_SOLD_AS_SHIPPED`

### Blind Spot RECOMMENDATION (Domain 2)

1. **BUILD** owned ThemeSpec + Look/Effect packages (Evidence/Science aligned).  
2. **REFUSE** CapCut SoR, scrape, unofficial APIs, invented Theme REST.  
3. CapCut × Codex / Desktop = **optional export only** — never V1 gate.  
4. Beauty/STARRDOM face tools = **opt-in**; fix LookSpec default language before Engineer schema freeze.  
5. BytePlus = **FUTURE/eval**, not Wave 2 SoR.  
6. Stamp ThemeSpec apply path as EditOps before any “AI theme” UI copy.

**Lane Blind Spot Domain 2 done for fold.**

---

## 8. Stamp line

**WAVE_2 DONE (Blind Spot §7b folded) | READY FOR WAVE 3 pending Engineer ThemeSpec stamp**

Domain 2 (CapCut-style creative / **HVS ThemeSpec**) stamped for Commander Mark.  
Next per `HVS_8_WAVES.md`: **Wave 3** — Subject follow + CameraSpec + AI camera (Domains 3–5).  

*Research only. No code / build / commit. CapCut = prior art + optional export — never SoR.*

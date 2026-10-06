# HVS WAVE 2 — CapCut-Style Creative Speed (HVS OWN Engine)
# STATUS: COMPLETE (research deliverable) | 2026-09-20 ~14:35 ET | RESEARCH ONLY
# Labels: VERIFIED CURRENT | PROPOSED HVS | FUTURE | REFUSE | UNVERIFIED
# Domains: 2, 11 (captions basic), 12 partial (themes/filters/effects), 13 partial (creative graphics)
# Report §§: 4, 8, 14 (partial color/look), 27 (sources)
# Seed: Wave A Domain 2 + Wave 1 hybrid timeline / EditOps — do not contradict OTIO/FFmpeg split

---

## 0. Executive recommendation (PROPOSED HVS)

1. **CapCut = prior-art surface only.** HVS ships an **owned Theme / Look / Effect / Template engine**. No CapCut runtime, no CapCut scrape, no CapCut UI clone, no fake "CapCut API."
2. **Creative speed = package application**, not a second SoT. Hybrid track timeline (Wave 1) remains authoring truth; themes attach as **typed EditOps** that stack non-destructively on clips / track ranges / sequence.
3. **Own the contract; integrate the math.** HVS owns ThemePack schema, EditOps, asset provenance, and default creator looks. Integrate **OCIO** for color/LUT discipline and optionally **OpenFX** for pro plugin I/O; use **GLSL/shaders** or GPU kernels for HVS-authored motion looks; use **FFmpeg filters** only as a *lowered* render path from typed ops (never model→ffmpeg).
4. **Caption/text/graphics** are first-class creative layers (basic in Wave 2; depth in Wave 6). Patterns verified from CapCut / Descript / VEED / Resolve titles — without claiming product internals.
5. **Evidence Scout — CapCut APIs:** No verified public CapCut developer API sufficient to drive an NLE. Treat third-party "CapCut API" repos and ChatGPT-plugin rumors as **UNVERIFIED**. BytePlus Video Editor SDK is a **separate commercial product** (mobile SDK), not a free CapCut REST API — do not conflate.

---

## 1. VERIFIED CURRENT — CapCut creative capability concepts (official Help only)

> Scope: **concepts** HVS must match or exceed with **own** assets. Not a feature-parity checklist to clone CapCut. Platform / region / version gating is first-class risk.

### 1.1 Templates + Remake

| Capability concept | Status | Official basis |
|---|---|---|
| Templates package effects, transitions, stickers, music into reusable starters | VERIFIED CURRENT | CapCut Help — Use Templates (Jan 12, 2026): templates apply pre-designed effects, transitions, stickers, and music; Web / PC / Mobile flows differ |
| "Use Template" opens template in editor for customize + export | VERIFIED CURRENT | Same |
| Remake = replace placeholders with own media while keeping template timing, effects, filters, text animations, soundtrack | VERIFIED CURRENT | CapCut Help — What Is A Remake (Jan 27, 2026) |
| Mobile = fullest remake / discovery / purchase; Desktop lacks public Templates gallery Remake button; Web remake limited to free + already-unlocked paid | VERIFIED CURRENT | Remake Help — platform matrix |
| Creator original media in templates may be protected | VERIFIED CURRENT | Use Templates Help note |
| Template may require N clips/photos | VERIFIED CURRENT | Remake Help — Media Requirements |

**Sources:**
- https://www.capcut.com/help/use-template
- https://www.capcut.com/help/what-is-a-remake

**License:** proprietary (ByteDance / CapCut). **HVS fit:** Concept prior art for ThemePack + Remake-class `ApplyTemplate` — **build own**; never depend on CapCut catalog.

### 1.2 Effects library (categories + application)

| Capability concept | Status | Official basis |
|---|---|---|
| Effects browsable by curated categories | VERIFIED CURRENT | Alternative Effects Help (Feb 3, 2026) |
| Web tabs include All, Trending, Cinematic, Retro, Glitch, AI Effects; labels Just Added / Staff Pick | VERIFIED CURRENT | Same — CapCut Online section |
| Desktop categories include Stylize, Distort, Blur, Color Grading, Transitions, AI Effects; tags Popular / New / Trending | VERIFIED CURRENT | Same — Desktop section |
| Mobile sections include Trending, Cinematic, Anime, Glitch, VHS, Dreamy, AI Effects; Editor's Picks / New Releases | VERIFIED CURRENT | Same — Mobile section |
| Apply to selected clip; intensity / duration / inspector params (opacity, blend, speed, color tone) where supported | VERIFIED CURRENT | Alternative Effects + Effects Not Applying Help |
| Effects may be separate timeline layers vs clip-attached | VERIFIED CURRENT | Effects Not Applying Help — layer selection / duration / playhead |
| Desktop can Save as Preset (Help claims) | VERIFIED CURRENT (vendor Help) | Alternative Effects — Desktop |
| Named AI alternatives cited in Help: AI Portrait, AI Color Match, AI Sky Replacement, AI Style Transfer | VERIFIED CURRENT as **product feature names in Help** — do not invent APIs | Alternative Effects Help |
| Exact effect internals / shader graphs | **Cannot verify** | No public engine docs |

**Sources:**
- https://www.capcut.com/help/recommended-alternative-effects
- https://www.capcut.com/help/effectss-not-applying-in-capcut

### 1.3 Transitions (incl. speed / beat / AI-marketed styles)

| Capability concept | Status | Official basis |
|---|---|---|
| Transitions as first-class creative between clips | VERIFIED CURRENT | CapCut Transitions Help (Mar 30, 2026) |
| Documented trending style families: Velocity (speed ramp), Beat Sync, Glitch/RGB, Cinematic fade/zoom, AI-powered smart, Swipe/motion, Before/After transform, Slow-mo + blur | VERIFIED CURRENT (Help marketing taxonomy) | Same |
| Sync with music / beat emphasized | VERIFIED CURRENT (product guidance) | Same |
| "AI automatically generate transitions based on clip content" | VERIFIED CURRENT as **Help claim** — treat implementation as opaque | Same |

**Source:** https://www.capcut.com/help/capcut-transitions

**PROPOSED HVS mapping:** `AddTransition`, `SetSpeedRamp`, optional later `SuggestTransitions` (Wave 4 Director) — never opaque CapCut call.

### 1.4 Filters / looks / themes (product language)

| Capability concept | Status | Official basis |
|---|---|---|
| Preset filters / themed looks; adjust strength | VERIFIED CURRENT (product / tools pages + Help ecosystem) | CapCut video effect & filter product page; Alternative Effects Color Grading category |
| Filters/effects/stickers/templates subject to **region, device, version, A/B, account eligibility, commercial-use filters** | VERIFIED CURRENT | Template Unavailable Help (Feb 3, 2026); Text Material Help (Jan 30, 2026) |
| Cloud assets can vanish (licensing, campaigns, deprecation) even for paid members; Recently Used may disappear; Save Template / export early advised | VERIFIED CURRENT | AI Templates/Effects Removed Help (Feb 3, 2026); Effects No Longer Available for Members (Feb 3, 2026) |
| Web most restricted; Mobile primary for new rollouts; Desktop curated subset | VERIFIED CURRENT | Template Unavailable Help |

**Sources:**
- https://www.capcut.com/help/template-unavailable
- https://www.capcut.com/help/ai-templates-and-effects
- https://www.capcut.com/help/effects-not-available-for-members
- https://www.capcut.com/help/material-of-text
- https://www.capcut.com/tools/video-effect-and-filter (product marketing — treat feature lists as vendor claims)

**HVS implication (PROPOSED):** ThemePacks are **versioned, local-or-controlled**, with provenance — never a live CapCut CDN.

### 1.5 Stickers / overlays / text templates

| Capability concept | Status | Official basis |
|---|---|---|
| Stickers part of template package | VERIFIED CURRENT | Use Templates Help |
| Text fonts + text templates gallery; Commercial/Licensed filters hide assets; region + online load | VERIFIED CURRENT | Material of Text Help |
| Stickers/effects/templates gated like other cloud materials | VERIFIED CURRENT | Template Unavailable Help lists stickers among gated assets |

**Cannot verify from public Help alone:** Full sticker taxonomy, AR sticker pipeline internals, commercial license matrix per asset.

### 1.6 Auto captions / recognise subtitles

| Capability concept | Status | Official basis |
|---|---|---|
| Auto Caption / Recognise Subtitles via ASR on Web, Desktop, Mobile (as of Jan 2026 Help) | VERIFIED CURRENT | How to Recognise Subtitles (Jan 30, 2026) |
| Choose language → Generate → edit timing/text/style | VERIFIED CURRENT | Same + Auto Captions Fix Help |
| Advanced features (speaker differentiation, punctuation refinement, batch .srt) may be Desktop/Web and **region/version gated** | VERIFIED CURRENT (Help caveat) | Recognise Subtitles Help note |
| Manual correction required for accuracy | VERIFIED CURRENT | Auto Captions Fix Help |

**Sources:**
- https://www.capcut.com/help/how-to-recognise-subtitles
- https://www.capcut.com/help/auto-captions-in-capcut

### 1.7 CapCut platform / Linux / API — Evidence Scout

| Claim | Label | Notes |
|---|---|---|
| CapCut Web / Desktop (Win/macOS) / Mobile (iOS/Android) | VERIFIED CURRENT | Official Help platform sections |
| CapCut native Linux desktop NLE | **REFUSE claim** | No official Linux CapCut NLE in Help matrix |
| Public CapCut REST/SDK to drive full NLE programmatically | **UNVERIFIED** | `https://www.capcut.com/openapi.yaml` fetch → **404** (2026-09-20). No official CapCut developer portal verified for full edit graph |
| Unofficial GitHub "CapCutAPI" / MCP wrappers | **REFUSE for HVS dependency** | Not CapCut official; ToS/scrape risk |
| BytePlus Video Editor SDK | VERIFIED CURRENT as **separate commercial mobile SDK** (Android/iOS), CapCut-related tech lineage per BytePlus docs — **not** "free CapCut API" | https://docs.byteplus.com/en/docs/byteplus-video-editor-sdk/docs-product-overview |
| CapCut as HVS SoR / embed | **REFUSE** | Wave locks |

---

## 2. VERIFIED CURRENT — Peer creator patterns (official only)

### 2.1 Descript — layouts + captions-from-script

| Concept | Status | Official |
|---|---|---|
| Layout packs = cohesive visual system (Camera, Media, Chapter, Intro, …); fonts/colors/media/audio | VERIFIED CURRENT | https://help.descript.com/templates-and-presets/overview |
| Visual roles (Talking Head, Screen Recording, Graphics, Others) map media into layout placeholders | VERIFIED CURRENT | Same |
| Captions built from script; style presets; active/future word styling; per-speaker caption layers | VERIFIED CURRENT | https://help.descript.com/visuals/captions |
| Effects add/adjust/disable/remove from Properties; scene or all-scenes scope | VERIFIED CURRENT | https://help.descript.com/effects-animations-transitions/apply-adjust |
| Animate visual layers / text & captions | VERIFIED CURRENT | https://help.descript.com/effects-animations-transitions/animate-visual-layers |
| Custom layout packs paid-gated | VERIFIED CURRENT | Layout packs overview |

**HVS takeaway (PROPOSED):** Descript validates **role-based ThemePack slots** + **caption style packs** better than CapCut's opaque remake for professional brand systems.

### 2.2 VEED — templates + auto subtitles + transitions

| Concept | Status | Official |
|---|---|---|
| Custom templates save logos, fonts, brand colours, captions, timing (Studio/Enterprise) | VERIFIED CURRENT | https://support.veed.io/en/articles/11550463-how-to-create-and-use-templates (dated Aug 21, 2026 in Help) |
| Auto-subtitle + Detect Speakers (Pro+); style presets; burn-in export option | VERIFIED CURRENT | https://support.veed.io/en/articles/11172739-how-to-add-subtitles-to-your-video-automatically |
| Dynamic subtitle presets (Glide, Pulse, …) | VERIFIED CURRENT | https://support.veed.io/en/articles/12000003-how-to-use-dynamic-subtitles |
| In/Out/Loop animations + transitions between video clips | VERIFIED CURRENT | https://support.veed.io/en/articles/11484777-how-to-use-transitions-and-animations |

### 2.3 Canva Video / Magic Video

| Concept | Status | Official |
|---|---|---|
| Magic Video: auto-sequence clips/photos into ~60s vertical with templates, transitions, music; prompt/style/type guides | VERIFIED CURRENT (Help Center page exists) | https://www.canva.com/help/magic-video/ — **note:** direct fetch hit Cloudflare challenge 2026-09-20; claim retained from official Help URL + search snippets; re-verify in-browser before hard product claims |
| Template availability / pop music **location-licensed** | VERIFIED CURRENT (Help caveats per search) | Same URL |
| Auto-framing limitations acknowledged by vendor | VERIFIED CURRENT (Help caveats) | Same |

### 2.4 Resolve / Fusion titles (pattern only — no internals)

| Concept | Status | Official / vendor |
|---|---|---|
| Resolve Edit + Fusion Text / Text+ titles as professional title path | VERIFIED CURRENT (product architecture) | Blackmagic Resolve / Fusion product pages + manuals lineage (Wave 1) |
| Titles as timeline layers / Fusion nodes — separate from "viral caption pack" UX | VERIFIED CURRENT (product role) | Same |

**PROPOSED HVS:** Support both **social caption packs** (CapCut/VEED/Descript-class) and **pro title comps** (Resolve/AE-class) under one graphics layer with different pack types.

---

## 3. Effect / Theme taxonomy for HVS (PROPOSED HVS)

### 3.1 Categories

| Category id | Purpose | Typical assets | Wave depth |
|---|---|---|---|
| `look` / LUT | Color grade / filmic look | OCIO look, CLF/CTF, cube LUT, grade params | Wave 2 schema + Wave 6 color |
| `filter` | Creator-style one-click look (often look + grain + vignette) | Param stack referencing looks + fx | Wave 2 |
| `transition` | Between-clip or in/out | Duration, easing, shader/OFX id, audio duck opt | Wave 2 |
| `title_pack` | Lower-thirds, intros, end cards | Fonts, layouts, anim presets | Wave 2 basic |
| `caption_style` | Burned or soft-sub social captions | Font, active word, karaoke, emoji policy | Wave 2 basic / Wave 6 ASR |
| `motion_graphic` | Logo stings, shapes, kinetic type | Vector/comp refs, keyframes | Wave 2 basic / Wave 6 |
| `sticker_overlay` | PNG/WebP/Lottie/alpha video overlays | Asset + blend + track attach | Wave 2 |
| `speed_ramp` | Velocity / time remap curves | Curve keypoints | Wave 2 (ops) / Wave 6 audio pitch |
| `beauty_lite` | Soft skin/eyes **opt-in only** | Model route + strength + consent flag | Wave 2 schema stub → Wave 5 STARRDOM locks |
| `audio_bed` | Music/SFX bed refs inside theme | Licensed asset ids + duck rules | Wave 2 refs / Wave 6 audio |
| `pacing` | Cut density / min clip / beat grid hints | Policy params (not media) | Wave 2 / Wave 4 Director |

### 3.2 ThemePack schema sketch (PROPOSED HVS)

```
ThemePack {
  id: string,                    // e.g. "luxury_salon.v3"
  version: semver,               // immutable once published
  displayName: string,
  categoryHints: string[],       // ad | luxury | cinematic | tiktok | ...
  aspectPresets: ["9:16","16:9","1:1", ...],
  slots: [                       // Descript-like roles
    { role: "hero_a_roll"|"product"|"logo"|"caption"|"music"|"broll", required: bool }
  ],
  looks: [ LookRef ],            // OCIO look id or LUT asset hash
  filters: [ FilterRef ],
  transitions: [ TransitionRef ],
  titlePacks: [ TitlePackRef ],
  captionStyles: [ CaptionStyleRef ],
  motionGraphics: [ MgfxRef ],
  stickers: [ OverlayRef ],
  speedDefaults: SpeedRampRef?,
  beautyLite: BeautyLiteRef?,    // default OFF; consent required
  audio: { beds: AssetRef[], duckDb?: number, beatGrid?: bool },
  pacing: { targetCutMs?, maxClipMs?, silenceTrim? },
  logoPlacement: { anchor, safeMargin, opacity },
  license: {
    spdx?: string,
    commercialOk: bool,
    territory?: string[],
    expiresAt?: ISO8601,
    attribution?: string
  },
  provenance: {
    author, createdAt, source: "hvs_first_party"|"licensed_partner"|"user",
    assetHashes: [{ path, sha256 }],
    parentThemeId?: string
  },
  editOpDefaults: [              // what ApplyTheme expands to
    { op: "ApplyLook", ... },
    { op: "AddTransition", ... },
    ...
  ]
}
```

**Rules (PROPOSED):**
- ThemePack is **data + licensed assets**, not CapCut IDs.
- Applying a theme = **transaction of typed EditOps** (expand + preview + commit).
- Unapplying = inverse ops or stack disable — non-destructive default.
- Missing assets fail closed with operator-visible provenance error (CapCut cloud vanish lesson).

### 3.3 Example ThemePack ids (content names — not CapCut clones)

`luxury_salon` · `beauty_product` · `cinematic_teal` · `tiktok_fast` · `youtube_intro` · `gaming_neon` · `documentary_clean` · `real_estate_bright` · `wedding_soft` · `automotive_chrome` · `sports_punch` · `music_video_glitch`

---

## 4. Attach to hybrid timeline + typed EditOps (PROPOSED HVS)

### 4.1 Attachment model

| Layer | Role |
|---|---|
| Track timeline (Wave 1 SoT) | Clips / gaps / transitions live here (OTIO-compatible) |
| Effect stack (per clip / adjustment range / track) | Ordered, keyed, disableable nodes |
| Theme instance | Soft reference `themePackId@version` + resolved op list + overrides |
| Graphics / caption tracks | Title + sticker + caption items as clips or overlays |
| Render lowerer | Stack → GPU/OFX/OCIO/FFmpeg — **deterministic from graph** |

### 4.2 Creative EditOps (Wave 2 set; Wave 4 owns full wire schema)

| EditOp | Behavior | Notes |
|---|---|---|
| `ApplyTheme` | Expand ThemePack defaults onto scope (sequence \| track \| range \| clip) | Preview-before-commit; record pack version |
| `ClearTheme` / `DisableTheme` | Remove or mute theme-derived stack | Keep user overrides policy |
| `ApplyLook` | Attach OCIO look / LUT / grade params | Prefer OCIO over ad-hoc ffmpeg curves |
| `ApplyFilter` | Creator filter pack (may wrap look + fx) | Intensity 0..1 |
| `AddTransition` | Insert/replace transition between clips | Duration, type id, easing |
| `AddOverlay` / `AddSticker` | Place overlay on graphics track | Blend, track-to-subject opt → Wave 3 |
| `ApplyTitlePack` | Spawn title/lower-third from pack | Slot fill (string vars) |
| `ApplyCaptionStyle` | Style existing caption layer | Does not invent words |
| `GenerateCaptions` | ASR → caption items | Human edit required; Wave 6 depth |
| `SetSpeedRamp` | Time remap curve on clip | Aligns CapCut velocity concept |
| `ApplyBeautyLite` | Opt-in retouch | **Default OFF**; consent + STARRDOM locks Wave 5 |
| `SaveAsTheme` | Capture current stack → new ThemePack draft | Provenance = user |

**Hard rule (ESTABLISHED from Wave 1/A):** NL / AI Director emits **only** these ops inside transactions — **never** raw ffmpeg filter strings from the model.

### 4.3 OTIO note (VERIFIED CURRENT tech)

OTIO models Transition objects on tracks but **does not define effect/theme semantics** (OTIO docs). HVS stores Theme/Effect graph in **internal project format**; OTIO export carries cut + transition stubs with **disclosed loss** for proprietary looks.

---

## 5. Build vs OpenFX vs GLSL/shaders vs OCIO LUTs — what HVS should own

| Approach | What it is | License / Linux | HVS recommendation |
|---|---|---|---|
| **OWN ThemePack + EditOp contract** | Schema, packs, UX, provenance, AI ops | N/A (HVS IP) | **OWN — non-negotiable** |
| **OCIO looks / LUTs** | Industry color config, looks, bake LUTs, optional OFX OCIO plugins | ASWF; BSD-3-Clause lineage; Linux first-class | **INTEGRATE** for color truth; ThemePack `look` refs OCIO |
| **OpenFX plugins** | Standard image-effect plugin API (describe/render/params) | https://openfx.readthedocs.io/ ; ASWF openfx repo; BSD-3-Clause | **INTEGRATE host later** for pro VFX I/O; not required for V1 creator looks |
| **GLSL / compute shaders / Vulkan** | HVS-authored motion looks, glitch, blur, transitions | Own code | **OWN** creator-speed effects that must feel CapCut-fast on Nebula GPU |
| **FFmpeg filters** | libavfilter graph as render backend | LGPL discipline (Wave 1) | **LOWER only** from typed graph; never SoT |
| **CapCut / Adobe effect binaries** | Proprietary | Proprietary | **REFUSE** scrape / rip / embed |
| **BytePlus Video Editor SDK** | Commercial mobile editor SDK | Commercial BytePlus license; mobile-centric | **OPTIONAL evaluate** only if Commander wants CapCut-class mobile embed — **not** default Linux War Room path; still not CapCut scrape |

**PROPOSED ownership split:**
1. **HVS owns:** ThemePack format, EditOps, default STARRDOM/luxury packs, caption style packs, transition ids, beauty-lite policy.
2. **Integrate OCIO:** look management, ACES-ish pipelines when needed, LUT bake for export.
3. **Integrate OpenFX (Wave 6/7):** host so Studio-grade plugins can attach; map OFX params ↔ EditOp params.
4. **Own GLSL/kernel library:** viral transitions / glitch / speed-ramp visuals tuned for Linux CUDA/Vulkan workers.
5. **FFmpeg:** decode/encode/proxy + fallback filter lowerer.

### 5.1 Partial color / VFX note (feeds Report §14)

| Item | Label |
|---|---|
| Creator "filter" ≈ look + mild FX stack | PROPOSED HVS |
| Pro grade = OCIO + primary/secondary wheels (Wave 6) | FUTURE / Wave 6 |
| OpenFX host | FUTURE / Wave 6–7 |
| Default beauty ON | **REFUSE** |

---

## 6. Caption / text / graphics creative layer (basic) — VERIFIED patterns

| Pattern | Seen in (official) | HVS proposal |
|---|---|---|
| ASR → editable captions → style pack | CapCut Auto Captions; VEED Auto-subtitle; Descript script captions | `GenerateCaptions` + `ApplyCaptionStyle` |
| Active word / karaoke emphasis | Descript active/future words; VEED dynamic presets / Auto Highlight | CaptionStylePack fields |
| Per-speaker caption layers | Descript; VEED Detect Speakers (paid) | Multi-layer captions |
| Burn-in vs soft export (SRT/VTT) | VEED burn toggle; Descript SRT/VTT (product pages) | Export policy flags |
| Text templates / fonts with commercial filter | CapCut Text Material Help | License-aware font registry |
| Layout roles for titles/graphics | Descript layout packs | ThemePack slots |
| Pro titles (Text+) | Resolve/Fusion product path | TitlePack type `pro_comp` vs `social_caption` |

**REFUSE:** Claiming CapCut/Descript/Resolve caption engine source or training on their assets.

---

## 7. REFUSE lines (Blind Spot locks — Wave 2)

1. **REFUSE** CapCut / TikTok asset scrape, template rip, or CDN mirror.
2. **REFUSE** Adobe Stock / Premiere / AE asset rip or proprietary effect binary reuse.
3. **REFUSE** Fake "CapCut API" as HVS dependency (openapi.yaml 404; unofficial wrappers).
4. **REFUSE** CapCut / Descript / VEED / Canva as runtime SoR inside War Room.
5. **REFUSE** Pixel-perfect CapCut UI clone (concept parity ≠ skin copy).
6. **REFUSE** Default-on beauty / identity-altering filters (STARRDOM consent later).
7. **REFUSE** Model emitting raw ffmpeg / GLSL strings as the edit path.
8. **REFUSE** TuneIn-style illegal stream ingest (**N/A** to this wave's creative scope, but keep global illegal-media lock).
9. **REFUSE** Claiming Linux CapCut desktop or undocumented CapCut internals.

---

## 8. Critical questions touched (Wave 2)

| # (assignment) | Answer sketch | Label |
|---|---|---|
| CapCut-style themes without CapCut? | Yes — ThemePack + EditOps owned by HVS | PROPOSED HVS |
| Filters/effects architecture? | Taxonomy §3 + attach §4 + build matrix §5 | PROPOSED HVS |
| Captions creative layer? | Basic patterns §6; ASR depth Wave 6 | PARTIAL |
| CapCut API? | Unproven public full API — UNVERIFIED; BytePlus SDK ≠ CapCut REST | Evidence Scout |
| Cloud asset vanish risk? | Design for versioned local packs | VERIFIED CURRENT lesson from CapCut Help |

---

## 9. FUTURE (not Wave 2 commit)

- Community ThemePack marketplace with signed provenance + license escrow.
- AI-suggested theme from brand kit / STARRDOM look bible.
- Full OpenFX host + marketplace plugins on Nebula Linux.
- Beat-aware `SuggestTransitions` Director op (Wave 4).
- Lottie/Rive motion packs with commercial font subsetting pipeline.

---

## 10. Sources (official URLs)

### CapCut Help / product
- https://www.capcut.com/help/use-template
- https://www.capcut.com/help/what-is-a-remake
- https://www.capcut.com/help/recommended-alternative-effects
- https://www.capcut.com/help/effectss-not-applying-in-capcut
- https://www.capcut.com/help/capcut-transitions
- https://www.capcut.com/help/template-unavailable
- https://www.capcut.com/help/ai-templates-and-effects
- https://www.capcut.com/help/effects-not-available-for-members
- https://www.capcut.com/help/how-to-recognise-subtitles
- https://www.capcut.com/help/auto-captions-in-capcut
- https://www.capcut.com/help/material-of-text
- https://www.capcut.com/tools/video-effect-and-filter

### Peers
- https://help.descript.com/templates-and-presets/overview
- https://help.descript.com/visuals/captions
- https://help.descript.com/effects-animations-transitions/apply-adjust
- https://help.descript.com/effects-animations-transitions/animate-visual-layers
- https://support.veed.io/en/articles/11550463-how-to-create-and-use-templates
- https://support.veed.io/en/articles/11172739-how-to-add-subtitles-to-your-video-automatically
- https://support.veed.io/en/articles/12000003-how-to-use-dynamic-subtitles
- https://support.veed.io/en/articles/11484777-how-to-use-transitions-and-animations
- https://www.canva.com/help/magic-video/ (fetch blocked by Cloudflare challenge 2026-09-20 — re-verify)

### Infra / color / plugins
- https://openfx.readthedocs.io/en/latest/Reference/ofxImageEffectAPI.html
- https://github.com/AcademySoftwareFoundation/openfx
- https://opencolorio.readthedocs.io/en/latest/quick_start/installation.html
- https://github.com/AcademySoftwareFoundation/OpenColorIO
- https://docs.byteplus.com/en/docs/byteplus-video-editor-sdk/docs-product-overview
- OTIO / FFmpeg: see Wave 1 §10

### Internal seeds
- `../HVS_WAVE_A_NLE_CAPCUT_TRACKING.md` Domain 2
- `HVS_WAVE_1_NLE_FOUNDATION.md`
- `../HVS_8_WAVES_PLAN.md`

---

## Document control

| Field | Value |
|---|---|
| Wave | 2 CapCut-style creative (OWN engine) |
| Status | COMPLETE (research only) |
| Lines target | ≥200 substantive |
| Code / commit / push / deploy | **NONE** |
| Next | Wave 3 subject/camera OR Blind Spot challenge on Wave 2 |

**STOP:** Research only. No War Room application code from this wave.

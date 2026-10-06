# HVS WAVE 6 — AUDIO / COLOR / VFX / CAPTIONS / RENDER (Domains 11–15, 18, 19, 26)
## Status / Date

| Field | Value |
|---|---|
| **Status** | **WAVE_6 DONE** — Domains 11–15, 18, 19, 26 stamped · **READY FOR WAVE 7** |
| **Date** | Sunday Sep 20, 2026 · ~2:35 PM EDT (America/New_York) |
| **Commander** | Mark |
| **Mode** | RESEARCH ONLY — no code / build / commit |
| **Scope** | **Domains 11–15, 18, 19, 26** — color/looks; VFX/OpenFX; captions/graphics; audio + AI; beat editing; speed/motion; bg/object; render/proxy/cache |
| **PA wave map** | `HVS_8_WAVES.md` Wave 6 · Audio / Color / VFX / Captions / Render |
| **Locks** | HVS ≠ Media Player ≠ Terra · **FFmpeg LGPL preferred** · **no redistributable `--enable-nonfree`** · OpenFX **SPDX `BSD-3-Clause`** · beauty **off-by-default** · CapCut ≠ SoR · never silent-delete source · V1 slim = ingest → cut/assembly → captions → export · VERIFIED / PROPOSED / FUTURE / UNVERIFIED |
| **Prior file notes** | Replaces thin concurrent Evidence sketch and prior Understanding/Distribution mis-scope. **Misfiled Understanding/Distribution** preserved as `WAVE_6_MISFILED_UNDERSTANDING_DISTRIBUTION_from_old_map.md` (Domains 16–17, 22–24 → Wave 7/8 inventory). Folds/upgrades: `WAVE_5_MISFILED_LOOK_SOUND_from_old_map.md` (Domains 11–15), speed/BG sections from that misfile + old Wave 6 §§1.3–1.4, Domain 26 notes overlapping Wave 7 draft. Wave 1–5 locks inherited. |

Claim tags: **VERIFIED CURRENT FEATURE** | **PROPOSED HVS FEATURE** | **FUTURE/EXPERIMENTAL** | **UNVERIFIED** | **VENDOR CLAIM**

---

## 0. Boundary locks (WAVE_1–5 + Domains 11–15 / 18–19 / 26)

| Rule | Meaning |
|---|---|
| **FFmpeg LGPL preferred** | Ship/redistribute FFmpeg built **without** `--enable-gpl` and **without** `--enable-nonfree` when possible (ffmpeg.org/legal.html checklist). Dynamic link; ship corresponding source. |
| **No redistributable `--enable-nonfree`** | `--enable-nonfree` makes the resulting binary **unredistributable** (FFmpeg LICENSE.md). Do not put nonfree FFmpeg in product installers. Nebula operator-only toolchains that are never redistributed = Legal checkpoint, not default ship path. |
| **OpenFX SPDX** | Host/SDK headers: Academy Software Foundation OpenFX — **`BSD-3-Clause`** (SPDX). Plugin binaries may have **separate** commercial licenses — inventory per plugin. |
| **Beauty off-by-default** | Face morph / beauty packs / identity-adjacent enhance = **explicit opt-in** + `consent_id`. Looks/grade/skinToneProtect ≠ beauty morph (Wave 5). |
| **ThemeSpec owns looks** | CapCut filters = UX prior art only. HVS ThemeSpec / LookSpec are SoR (Wave 2). Non-destructive stacks; never bake into source files. |
| **Tips ≠ ops** | Beat cut / caption style / look apply / duck / speed = typed EditOps (Wave 4). |
| **Never silent-delete source** | Rank/exclude from versions only; masters immutable. |
| **No CapCut/Adobe scrape** | Capability-class citations only; no invented NLE APIs. |
| **V1 slim** | ingest → cut/assembly → captions → export. Full Fairlight-class / OpenFX host / neural interp / gen BG = V2+. |
| Labels mandatory | VERIFIED · PROPOSED · FUTURE · UNVERIFIED |
| Research ≠ shipped | Builds HOLD |

---

## 1. Domain 11 — Color / looks / filter engine

### 1.1 Industry anchors (`VERIFIED CURRENT FEATURE`)

| Host | What is documented | HVS takeaway |
|---|---|---|
| **OCIO 2.5** | ASWF OpenColorIO 2.5 (Sept 2025) in VFX Reference Platform **CY2026**. Built-in ACES 2.0 configs: `ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5`, `ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5`; aliases `ocio://default`, `ocio://cg-config-latest`, `ocio://studio-config-latest`. | **Color engine candidate** for HVS finishing path |
| **After Effects 26.5+** | Project Color Engine: Adobe ICC **or** OCIO; OCIO library **2.5.1** with native ACES 2.0 CG/Studio configs (HelpX updated Sep 18, 2026). Layer effects: OCIO File/CDL/Look/Display/Color Space transforms. | Best Adobe reference for **OCIO host UX** |
| **DaVinci Resolve** | Color page = industry grading reference; project Color Management supports ACES (ACEScc/ACEScct per manuals); nodes, windows, stills/looks. | External finishing reference; not HVS SoR |
| **Premiere Pro** | Lumetri Color / Looks / LUT import-export; sequence Color Management. **Not** documented as full OCIO host equivalent to AE 26.5. | Editorial looks / Adobe interchange only |
| **CapCut** | Themed filters + strength sliders (product Help). **Not** OCIO/ACES finishing. | Creative-look UX benchmark only |

Sources: opencolorio.readthedocs.io/en/latest/releases/ocio_2_5.html · Adobe HelpX OCIO/ACES · Blackmagic Resolve Color / manuals · CapCut Help (Wave 2).

### 1.2 Pro color surface vs fast creative looks (`PROPOSED`)

| Layer | Capabilities | V-target |
|---|---|---|
| **Pro grade** | Exposure, contrast, sat, WB, curves, HSL, wheels, qualifiers, power windows/masks, scopes (waveform/vectorscope/histogram), LUT/CDL, HDR/log, shot match, auto color assist, **skin-tone protect** | V1: basic + LUT/Look intensity · V2+: windows/scopes/shot-match depth |
| **Creative Looks** (ThemeSpec) | Named looks with intensity 0–1: Luxury Gold, Clean Beauty, Cinematic Teal, Warm Lifestyle, Dark Luxury, Commercial Clean, Film 35, Dream, Vintage, Street, Gaming Neon (examples — **not** CapCut clones) | **V1** via ThemeSpec.lookId |
| **Beauty pack** | Face-region enhance / morph | **OFF by default**; opt-in + consent (Wave 5) — **not** auto-on with looks |

### 1.3 Non-destructive ThemeSpec integration (`PROPOSED HVS FEATURE`)

```text
LookSpec {
  id, name, version
  engine: "ocio_look" | "lut_file" | "param_grade" | "hybrid"
  ocioConfigUri?: "ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5" | custom
  ocioLookName? / lutPath? / cdl?
  params: { lift,gamma,gain, sat, warmth, contrast, grain, vignette, ... }
  intensityDefault: 0..1
  skinToneProtect: bool          # grade safeguard — NOT beauty morph
  beautyMorph: false             # HARD DEFAULT false; requires consent_id if ever true
  displayTransformSeparate: true # AE pattern: working ≠ display
}
ThemeSpec.lookId → LookSpec
EditOp: applyLook / applyTheme (Wave 4) — stack on clip/sequence; source untouched
```

**Rule:** Preview on proxies; conform grade from **originals** at final render. Never bake Look into master media files.

---

## 2. Domain 12 — Effects / compositing / VFX + OpenFX

### 2.1 OpenFX (`VERIFIED CURRENT FEATURE`)

- OpenFX = open C API between VFX plug-ins and hosts; under **Academy Software Foundation**.
- License: **BSD 3-Clause** — SPDX identifier **`BSD-3-Clause`** (ASWF `openfx` LICENSE.md / CONTRIBUTING.md).
- Hosts cited by openeffects.org include Resolve/Fusion, Nuke, Natron, Vegas, Flame, etc.
- Premiere / After Effects primarily use Adobe plugin / MOGRT models — **not** primary OFX editor hosts the way Resolve/Fusion are.
- Commercial OFX suites (Boris FX Sapphire, RE:Vision, …) are typically **separate ports** per host family — do **not** assume “drop OFX into Premiere.”

### 2.2 V1 vs V2+ effect graph (`PROPOSED`)

| Tier | What ships | Notes |
|---|---|---|
| **V1** | HVS EffectGraph thin: Theme transitions/filters, blend/opacity, basic blur/glow/grain, masks from TrackSubject/SAM2-class, FFmpeg filter leaves for export | Kitchen-sink OpenFX host = **refuse** for V1 |
| **V2** | OpenFX **host bridge** — load OFX plugs into graph leaves; chroma/luma key, planar track, stabilize plugin path | License inventory per plugin binary |
| **V3+** | Camera solve, particles, deep compositing, procedural generators | Film/show scale — must not block V1 |
| **Graphics** | HVS Theme graphics + Lottie (Resolve 21 documents OGraf HTML/Lottie on edit side) + optional MOGRT-like packs for Adobe interchange | Own templates — no CapCut pack theft |

**GPL isolation:** Natron (GPLv2 OFX host) / Blender (GPL) → prefer **subprocess** later; do not link GPL hosts into proprietary HVS core without counsel (Wave 7 overlap).

---

## 3. Domain 13 — Captions / text / graphics

### 3.1 Industry evidence (`VERIFIED` / capability class)

| Product | Documented behavior | Nebula-callable? |
|---|---|---|
| **Premiere Speech to Text** | Transcribe → Create captions; styles; single-word captions; translate; import/export caption files; language packs (HelpX) | In-host only |
| **Premiere MOGRT / Essential Graphics** | Titles, lower thirds, responsive graphics templates | In-host / interchange concept |
| **FCP** | Closed captions create/import/export; Generate subtitles automatically; Titles / Motion | In-host (Mac) |
| **Resolve** | Subtitle tools on Edit; Fusion Text+ / MultiText; Resolve 21 OGraf HTML/Lottie | In-host; Linux Resolve exists |
| **CapCut** | Auto captions / styled social packs — speed/style benchmark | **No** CapCut caption API for HVS |
| **Descript** | Transcript-linked captions stay synced as you edit (Help) | Cloud product / Agent (Wave 4) — not HVS SoR |
| **Whisper (OSS)** | MIT; `word_timestamps=True` → per-word start/end/probability (cross-attention + DTW); `--highlight_words` for karaoke-ish SRT/VTT | **LOCAL** preferred |
| **ElevenLabs STT** | Official `POST /v1/speech-to-text` — `timestamps_granularity`, `diarize`, models e.g. `scribe_v2` | **CLOUD** Router optional |

### 3.2 HVS caption pipeline (`PROPOSED`)

```text
ASR (local Whisper-class | cloud ElevenLabs STT | other Router ASR)
  → Transcript { words[], speakers?, lang }
  → human proofread gate (V1 required)
  → CaptionTrack + CaptionStyle (ThemeSpec.captionStyleId)
  → karaoke / word-highlight / emoji / social packs (V1 basic · V2 animated)
  → export: SRT + WebVTT (+ TTML later); optional burn-in via FFmpeg
  → lower thirds / titles / end cards / logo / CTA = Theme graphics slots
```

| Feature | V1 | V2+ |
|---|---|---|
| ASR → editable captions | Yes | — |
| Word-level timing | Yes (Whisper word_timestamps / cloud word gran.) | Refined alignment |
| Karaoke / highlighted words | Basic style pack | Full CapCut-class motion |
| Speaker labels | Optional if diarize available | First-class |
| Translation | Manual / cloud later | Auto + review |
| Lower thirds / end cards / CTA | Theme slots | Motion graph depth |
| Broadcast MCC/CEA-608 | **FUTURE** until format matrix verified | — |

**Blind Spot:** ASR error on beauty/ad VO can create legal/brand risk — **human proofread before deliver**. CapCut ease is UX north star; pro control + file standards are HVS.

---

## 4. Domain 14 — Audio pro + AI

### 4.1 Fairlight / Premiere / CapCut / Descript / ElevenLabs (`VERIFIED` facts only)

| System | Documented capability class | Label |
|---|---|---|
| **Resolve Fairlight** | Built-in DAW page: high track counts, realtime FX/EQ/dynamics, ADR/Foley, Fairlight FX (reverb, de-esser, hum remover, …). Immersive: stereo / 5.1 / 7.1 / ambisonics (product materials). **Studio-associated AI:** Voice Isolation; Music Remixer (voice/drums/bass/guitar/other — as described in Studio materials); IntelliTrack AI can drive Fairlight **audio panner**. Resolve 21: folder tracks; Fairlight Animator → Fusion from audio levels. | `VERIFIED` product docs — confirm Free vs Studio SKU before claiming AI |
| **Premiere Pro** | Essential Sound; **Enhance Speech**; dialogue repair/clarity; **Automatically duck audio** (tag Music → Duck Against Dialogue → Generate Keyframes on Amplify effect — HelpX, updated Jan 7, 2026); loudness meter; Remix music duration tool (does **not** analyze lyrics — Adobe documents limitation); Speech to Text / text-based edit. Generate Music marked **(beta)** in Help tree — do not design core around beta. | `VERIFIED` HelpX |
| **CapCut** | Music library; Auto Cut beat/speech modes; TTS/voiceover UX. **Not** Fairlight-class DAW. Auto Cut: Mobile + Desktop; **not** Web (CapCut Help, Feb 3, 2026). | UX prior art only |
| **Descript** | **Studio Sound** — enhance speech / reduce noise & echo (Help). Captions from script stay synced. **Lower audio of other layers** (ducking-class; Help documents layer dynamics — responds to clip presence, not always speech detection). Agent can apply Studio Sound / captions (Wave 4). | `VERIFIED` Help — study UX; do not bind HVS to Descript |
| **ElevenLabs** | Documented APIs: TTS `POST /v1/text-to-speech/{voice_id}`; SFX `POST /v1/sound-generation`; Music `POST /v1/music`; STT `POST /v1/speech-to-text`; Instant Voice Cloning flows; Dubbing v2. | `VERIFIED` API refs — optional cloud; **clone consent required** |

### 4.2 HVS audio architecture (`PROPOSED`)

| Layer | Approach | Build / integrate | V |
|---|---|---|---|
| Multitrack / waveform / fades / automation | TimelineEngine audio tracks | **BUILD** | V1 |
| EQ / compressor / limiter / gate / de-esser / reverb / delay / pan | EffectGraph audio nodes | **BUILD** thin · OFX/audio plugs later | V1 thin · V2 deep |
| Loudness / normalize | FFmpeg `loudnorm`-class / EBU R128 meters | **INTEGRATE** filters | V1 |
| Denoise / voice isolate / dialogue enhance / dereverb | Local models and/or Studio-like SKU; Premiere Enhance Speech / Fairlight Voice Isolation / Descript Studio Sound = **UX targets** | **HYBRID** | V1 basic denoise · V2 isolate |
| Music / stem separation | Fairlight Music Remixer-class | **INTEGRATE**/partner or Router | V2 |
| Ducking | Auto keyframes music vs dialogue (Premiere Essential Sound pattern) | **BUILD** | V1 |
| Silence / filler removal | Suggestions → EditOps; never silent-delete source | **BUILD** | V1 suggest |
| TTS / SFX / music gen / dubbing | ElevenLabs (documented endpoints only) via Provider Router | **ROUTER** optional | V1 stub · V2 spend |
| Subject-track → audio pan | Fairlight IntelliTrack pattern + Wave 3 TrackSubject | **BUILD** | V2 |
| Lip sync | Avatar vendors (Wave 5) — not silent rewrite of real talent CU | **ROUTER** | Optional |

**Never** CapCut-as-audio-engine dependency. Voice clone / AI replica = Character Bible consent (Wave 5).

---

## 5. Domain 15 — Music / beat editing

### 5.1 Evidence (`VERIFIED` / mixed)

| Tool | Behavior | Label |
|---|---|---|
| **CapCut Auto Cut** | Analyzes A/V; modes: Beat Sync, Speech Pause, AI Script; Mobile + Desktop; **not** Web (Help Feb 3, 2026) | `VERIFIED` UX prior art |
| **Premiere Remix** | Retimes **music duration** to target (~1s); not full cut-picture-to-every-beat | `VERIFIED` |
| **FCP** | Edit-to-the-beat / marker workflows in User Guide family | `VERIFIED` feature family |
| **librosa** | `librosa.beat.beat_track` → tempo + beat frames/times (OSS docs) | `VERIFIED` BPM/beats — **not** downbeats |
| **madmom** | RNN + DBN downbeat processors (docs) | `VERIFIED` downbeat candidate — license/maintenance review |

### 5.2 HVS beat → EditOps (`PROPOSED`)

```text
Audio analysis → BeatGrid { bpm, beats[], downbeats?, phrases? }
  → markers on timeline (always)
  → optional: cutOnBeat / snapClipsToBeats / beatSyncedTransition EditOps
Command UX: "Cut this on the beat." → typed ops inside EditTransaction (Wave 4)
```

| Stage | Ship | Label |
|---|---|---|
| Beat markers + manual snap | First | `PROPOSED` V1 |
| Ducking vs dialogue | With Domain 14 | `PROPOSED` V1 |
| Auto Cut–class montage generator | After quality bar | `FUTURE/EXPERIMENTAL` until false-cut rate acceptable |
| Music replace / phrase-aware | Later | `FUTURE` |

CapCut Auto Cut = **UX north star**, implemented first-party (no CapCut dependency). Premiere Remix = **music length** north star. Fairlight IntelliTrack = **audio follow picture** north star.

---

## 6. Domain 18 — Speed / motion / optical flow / interp

### 6.1 FFmpeg + OSS (`VERIFIED`)

| Capability | Mechanism | Notes |
|---|---|---|
| Constant speed | `setpts` + `atempo` (audio) | Core LGPL filter path |
| Reverse | `reverse` / `areverse` | Buffer whole stream — trim first on long clips |
| Frame rate / dup / blend / MCI | `minterpolate` (`mi_mode=dup\|blend\|mci`) | Official ffmpeg-filters; MCI CPU-heavy |
| Stabilize | `vidstabdetect` → `vidstabtransform` | Needs libvidstab — **GPL-adjacent packaging risk**; optional/plugin path preferred under LGPL ship policy |
| Freeze / hold | Timeline hold + still range | Build in TimelineEngine |

### 6.2 HVS speed model (`PROPOSED`)

- Clip attribute `speedCurve` (constant or keyframed ramps) — **non-destructive**; never bake into source.
- Preview on proxies; final conform with interp policy: `nearest | blend | mci | provider:INTERPOLATION`.
- Neural interp (RIFE-class): **HYBRID/FUTURE** until license + Nebula VRAM measured; route via Media Provider Router `INTERPOLATION`.
- Motion blur as effect: `PROPOSED` V2. Rolling shutter: `FUTURE`.
- V1: constant `setSpeed` + freeze/reverse. V2+: ramps + optical-flow quality modes.

---

## 7. Domain 19 — Background / object editing (local vs generative)

| Lane | Technique | Local vs cloud | V-target |
|---|---|---|---|
| Cutout / mattes | Instance/semantic segmentation | **LOCAL** first | V1 person/product · V2 hair-quality |
| BG remove / blur / solid replace | Matte + composite | **LOCAL** | V1 |
| BG generative replace / fill | Gen edit | **CLOUD** Router `IMAGE_EDITOR` / video edit | V2+ |
| Object remove / insert | Inpaint / gen | **CLOUD**-first | V2+ |
| People remove | Multi-instance seg + inpaint | **HYBRID** | V2+ |
| Sky replace / relight | Gen or graded composite | CLOUD / FUTURE local | V2–V3 |
| Hair-quality masking (STARRDOM) | Fine edge matting + hair-aware | LOCAL research + optional cloud | V2 (acceptance may stub) |
| Depth | Monocular depth for layered edits | LOCAL optional | V2+ |

**VERIFIED OSS:** Meta **SAM 2** (`facebookresearch/sam2`) — image + video segmentation; code/checkpoints Apache-2.0 (confirm dataset/demo asset licenses separately). Realistic on Nebula CUDA once VRAM inventoried — not assumed realtime scrub for every session.

**Blind Spot:** Generative BG/object edit can destroy identity or invent product details. Prefer **track + grade + selective enhance** over face-rewriting. Client consent before ingest (Wave 7 Legal). Do not depend on CapCut BG-remove as SoT.

---

## 8. Domain 26 — Render / proxy / cache (FFmpeg + GPU on Linux Nebula)

### 8.1 Encode paths (`VERIFIED`)

| Path | Official basis | Linux Nebula | HVS use |
|---|---|---|---|
| **NVIDIA NVENC/NVDEC** | Video Codec SDK **13.1** FFmpeg guide: `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`; `-hwaccel cuda -hwaccel_output_format cuda`; `scale_cuda` | First-class (Turing+) | **Primary** on Nebula NVIDIA |
| **ffnvcodec / nv-codec-headers** | MIT headers; runtime loads driver encode libs | Yes | Prefer LGPL builds **without** `--enable-nonfree` when headers-only path works |
| **Intel QSV / oneVPL** | FFmpeg `*_qsv` | Yes if Intel present | Optional fallback |
| **AMD AMF** | GPUOpen AMF+FFmpeg wiki; `h264_amf` / `hevc_amf` / `av1_amf` | Partial | Only if AMD present |
| **VAAPI / Vulkan Video** | Growing FFmpeg paths | Growing | **FUTURE** portability after NVENC solid |
| **Software** (libx264 etc.) | FFmpeg | Yes | Fallback; **`--enable-gpl` risk** if linking GPL encoders into redistributed build |

**License practice (`VERIFIED` + `PROPOSED`):**
1. Prefer **LGPLv2.1+** FFmpeg per ffmpeg.org/legal.html — no `--enable-gpl`, no `--enable-nonfree` for **redistributable** ship.
2. NVIDIA’s own compile snippets often show `--enable-nonfree` — treat as **vendor example**, not HVS ship policy. Modern NVENC via ffnvcodec can be enabled without nonfree in many builds — **verify configure summary** before packaging.
3. `--enable-nonfree` ⇒ binary **unredistributable** — never in customer/product installer.
4. Patent/MPEG-LA risk called out by FFmpeg for commercial products — counsel for productization.
5. ProRes / DNx = later if codec licensing OK.

### 8.2 Proxy / cache / queue (`PROPOSED`)

| Tier | Purpose | Typical form |
|---|---|---|
| Originals | Immutable sources | Masters on NVMe/NAS |
| Proxies | Edit responsiveness | 720p/1080p H.264/HEVC via NVENC on ingest |
| Thumbs / scrub | UI | JPEG/WebP strip or sprite |
| Render cache | Effect/comp segments | Keyed by **content hash + graph hash** |
| Preview tickets | AI preview-before-commit (Wave 4) | Short proxy renders of transaction diff |
| Delivery | Final | NVENC H.264/H.265 (+ software fallback); platform forks 16:9 / 9:16 |

**Queue / resumability (`PROPOSED`):**
- Job queue: proxy ingest, preview, final, batch platform variants.
- Each job: idempotent inputs → content-addressed outputs; checkpoint progress; resume failed segments without redoing whole timeline.
- Background render; cancel/priority; Nebula CUDA workers preferred (Windows Nebula often offline — not sole path).
- Edit on proxies; **conform to originals** at final.

**Preview performance:** Proxy-first UI; keep frames on GPU when possible (`hwaccel_output_format cuda` per NVIDIA guidance); no full-res 4K software scrub as V1 requirement.

---

## 9. Build vs integrate recommendations

| Capability | Recommendation | Rationale |
|---|---|---|
| ThemeSpec / LookSpec / CaptionStyle | **BUILD** | HVS creative SoR (Wave 2) |
| OCIO 2.5 + ACES 2.0 CG default | **INTEGRATE** OCIO | Industry standard; AE/Resolve-proven |
| Pro scopes / power windows | **BUILD** V2 | Depth after V1 looks |
| OpenFX host | **INTEGRATE V2+** | BSD-3-Clause ABI; plugin ecosystem |
| V1 effects (blur/glow/grain/opacity) | **BUILD** thin graph | Avoid V1 kitchen-sink |
| ASR captions | **INTEGRATE** Whisper local + optional ElevenLabs STT | Word-level verified |
| Caption/karaoke styles | **BUILD** in Theme | CapCut ease, pro export |
| Multitrack / duck / loudnorm | **BUILD** + FFmpeg filters | V1 mix basics |
| Voice isolate / stems | **HYBRID** V2 | Fairlight/Premiere/Descript are UX targets |
| TTS / SFX / music gen | **ROUTER** ElevenLabs et al. | Documented APIs only; consent |
| Beat grid | **INTEGRATE** librosa (± madmom downbeats) | BPM → markers → EditOps |
| Auto Cut montage | **BUILD** later | CapCut UX; quality gate |
| Speed constant | **BUILD** + FFmpeg setpts/atempo | V1 |
| Optical flow / neural interp | **INTEGRATE** optional + Router | V2+ |
| SAM2 mattes / BG blur | **INTEGRATE** local | Identity-bearing |
| Gen BG/object fill | **ROUTER** | Cloud; consent |
| FFmpeg encode + NVENC | **INTEGRATE** LGPL build | Nebula primary |
| Render queue / cache | **BUILD** | HVS owns jobs + hashes |
| CapCut / Premiere / Resolve as engines | **REFUSE as SoR** | Prior art / finishing only |

---

## 10. Open / UNVERIFIED + blockers

| Item | Status |
|---|---|
| Exact Nebula Genesis VRAM/SKU for concurrent Whisper + SAM2 + NVENC proxy + OCIO | **Unmeasured** — do not invent |
| Ship FFmpeg configure line that keeps **NVENC + LGPL** without `--enable-nonfree` on target distro | Engineer spike + Legal sign-off |
| libvidstab stabilize under LGPL-prefer policy | Optional/nonbundled vs accept GPL build for operator-only |
| OCIO host depth in V1 (full config UI vs pick config + working/display) | Open product call |
| ACES pin: lock `cg-config-v4.0.0_aces-v2.0_ocio-v2.5` vs allow facility custom day one | Open |
| OFX priority categories first (keying, blur, film looks, retime) | Open for V2 |
| Caption export minimum: SRT+WebVTT vs broadcast MCC | Open — verify before claiming |
| Fairlight-class Voice Isolation / Music Remixer: build vs partner vs “export to Resolve Studio” | Open |
| ElevenLabs SKUs / rate limits / retention / IVC consent UX for commercial plans | Legal + contract time |
| Beat Auto Cut false-cut threshold (speech vs music) | Science gate before ship |
| madmom license/maintenance vs librosa-only V1 | Review |
| Premiere Generate Music (beta) | Monitor only — not HVS core |
| CapCut Web Auto Cut gap | Confirms first-party beat-auto if HVS ships web |
| AMF reliability on Linux Nebula if AMD ever present | Hardware-dependent |
| ProRes/DNx licensing for delivery presets | Legal later |
| Domains 16–17 / 22–24 (misfiled old WAVE_6) | Deferred to Wave 7/8 inventory — not stamped here |

---

## 11. Sources (official / primary — Sept 2026)

### Color / OCIO / ACES
1. OCIO 2.5 Release — https://opencolorio.readthedocs.io/en/latest/releases/ocio_2_5.html  
2. OCIO-Config-ACES v4.0.0 — https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases/tag/v4.0.0  
3. Adobe AE OCIO / ACES — https://helpx.adobe.com/after-effects/desktop/adjust-colors/opencolorio-and-aces-color-management/opencolorio-aces-color-management.html  
4. Blackmagic Resolve Color — https://www.blackmagicdesign.com/products/davinciresolve/color  

### OpenFX
5. OpenFX home — https://openeffects.org/  
6. ASWF openfx LICENSE (BSD-3-Clause) — https://github.com/AcademySoftwareFoundation/openfx/blob/main/LICENSE.md  
7. SPDX BSD-3-Clause — https://spdx.org/licenses/BSD-3-Clause  

### Captions / ASR
8. Premiere Speech to Text — https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/auto-transcribe-video-using-speech-to-text.html  
9. Premiere Create captions — https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/create-captions.html  
10. Premiere MOGRT overview — https://helpx.adobe.com/premiere/desktop/add-text-images/use-motion-graphics-templates/overview-of-motion-graphics-templates.html  
11. OpenAI Whisper (word_timestamps) — https://github.com/openai/whisper  
12. ElevenLabs STT — https://elevenlabs.io/docs/api-reference/speech-to-text/convert  

### Audio
13. Blackmagic DaVinci Resolve (Fairlight) — https://www.blackmagicdesign.com/products/davinciresolve  
14. Resolve What’s New — https://www.blackmagicdesign.com/products/davinciresolve/whatsnew  
15. Premiere Automatically duck audio — https://helpx.adobe.com/premiere/desktop/add-audio-effects/adjust-volume-and-levels/automatically-duck-audio.html  
16. Premiere Enhance Speech — https://helpx.adobe.com/premiere/desktop/add-audio-effects/adjust-volume-and-levels/enhance-speech.html  
17. Premiere Remix — https://helpx.adobe.com/premiere/desktop/add-audio-effects/apply-audio-effects/remix-audio-in-premiere.html  
18. Descript Studio Sound — https://help.descript.com/hc/en-us/articles/10327603613837-Studio-Sound  
19. Descript Lower audio of other layers — https://help.descript.com/hc/en-us/articles/10327507829773-Lower-audio-of-other-layers  
20. ElevenLabs TTS / SFX / Music / IVC — https://elevenlabs.io/docs  

### Beat / CapCut (benchmark only)
21. CapCut How to Use Auto Cut — https://www.capcut.com/help/how-to-use-auto-cut  
22. librosa beat_track — https://librosa.org/doc/latest/api/generated/librosa.beat.beat_track.html  
23. madmom downbeats — https://madmom.readthedocs.io/  

### Speed / BG
24. FFmpeg filters (`minterpolate`, etc.) — https://www.ffmpeg.org/ffmpeg-filters.html  
25. Meta SAM 2 — https://github.com/facebookresearch/sam2  

### Render / FFmpeg legal / GPU
26. FFmpeg Legal (LGPL checklist; no `--enable-nonfree` for redistribute) — https://www.ffmpeg.org/legal.html  
27. FFmpeg LICENSE.md (`--enable-nonfree` → unredistributable) — https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md  
28. NVIDIA FFmpeg with GPU (SDK 13.1) — https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html  
29. AMD AMF Encoder Settings in FFmpeg — https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/AMF-Encoder-Settings-and-Tuning-in-FFmpeg  

### Internal folds
30. `WAVE_5_MISFILED_LOOK_SOUND_from_old_map.md` — Domains 11–15 seed  
31. `WAVE_6_MISFILED_UNDERSTANDING_DISTRIBUTION_from_old_map.md` — Domains 16–17/22–24 + speed/BG overlap  
32. `HVS_8_WAVES.md` · `HVS_MASTER_RESEARCH_ASSIGNMENT_PROMPT.md` Domains 11–15, 18, 19, 26 · Wave 2 ThemeSpec · Wave 4 EditOps · Wave 5 beauty/Router locks  

### Claim hygiene
- CapCut / Premiere / Resolve / Descript / Fairlight cited as **capability classes** or documented Help only — no invented APIs; no CapCut scrape; no CapCut-as-SoR.

---

## 12. Stamp

| Field | Value |
|---|---|
| **Stamp** | **WAVE_6 DONE** \| **READY FOR WAVE 7** |
| **Domains covered** | 11 (color/looks), 12 (VFX/OpenFX), 13 (captions/graphics), 14 (audio pro+AI), 15 (beat), 18 (speed/motion), 19 (bg/object), 26 (render/proxy/cache) |
| **Legal locks stamped** | FFmpeg LGPL preferred · no redistributable `--enable-nonfree` · OpenFX SPDX `BSD-3-Clause` · beauty off-by-default |
| **Next wave** | Wave 7 — Hardware / Rights / War Room boundaries / UI (Domains 25, 27, 29–34 per `HVS_8_WAVES.md`) — reconcile Domain 26 overlap with this stamp; fold Understanding/Distribution misfile into inventory as needed |
| **Builds** | HOLD — research ≠ shipped |

*Wave 6 stamp — Audio / Color / VFX / Captions / Render | RESEARCH ONLY | Sunday Sep 20, 2026 ~2:35 PM EDT | not shipped.*

---

## Engineer — ThemeSpec.grade vs effect graph · NVENC proxy/render (Avenger Engineer)

**Lane:** Avenger Engineer · RESEARCH ONLY · 2026-09-20 · Domains 11–12, 18, 26  
**Also late-fold Wave 5:** Provider Router category stubs (PA2 tagged; Wave 5 stamped without Engineer post)

### A. Three layers — never merge (PROPOSED)

| Layer | Owns | Apply path | SoR |
|---|---|---|---|
| **ThemeSpec.grade / LookSpec** | Global or sequence look: `ocio_look_id` \| LUT + strength 0–1 | Non-destructive stamp on timeline; preview filtergraph; master bake once from originals | `.hvsproj` ThemeSpec |
| **Timed Effect graph** | Clip/range OFX / HVS EffectSpec IDs with keyframes | EditOps `applyEffect` / `removeEffect`; stack order explicit | Effect stack on clip/layer |
| **Color page (W6 depth / FUTURE)** | Per-shot wheels, secondaries, node graph | Operator Color UI — not CapCut filter bin | Separate from Theme apply |

**Locks baked:** CapCut filter names = prior-art labels → HVS `look_id` only. Beauty/face reshape strength default **0** + consent (Blind Spot). Grade ≠ beauty morph. OpenFX = sandboxed plugin IDs + SPDX per plugin (Legal) — not CapCut CDN.

**V1 thin:** 1–2 LookSpecs + caption style + optional transition defaults; defer full OFX host / Color page.

### B. Proxy / render encode matrix (PROPOSED)

```
Source (immutable, content-hash)
  → Proxy job: scrub media (LGPL FFmpeg libx264/libx265 or system encoder)
  → Timeline edit on proxies
  → Master bake: originals + ThemeSpec.grade + effect graph + captions
       ├─ Product path: LGPL FFmpeg only (redistributable)
       └─ Nebula operator path: NVENC/NVDEC optional local toolchain
            (NVIDIA Video Codec SDK + FFmpeg nonfree build) — NOT in War Room installer
```

| Rule | Label |
|---|---|
| Proxies ≠ masters; never sell proxy as delivery | PROPOSED lock |
| Product ship FFmpeg = **LGPL-clean** | VERIFIED Legal/Blind Spot |
| NVENC = machine `153e10ec` operator path only; document separately | PROPOSED |
| Bad interp / reject render → keep source hash; no silent delete | Blind Spot lock |
| Gen assets via Provider Router only with PreviewTicket (Wave 4) — no silent spend | Wave 4/5 |

### C. Provider Router stubs (Wave 5 late-fold — PROPOSED)

Categories (swap vendor without rewriting timeline):

| Category | V1 | Default adapters (Evidence) | Exclude |
|---|---|---|---|
| `VIDEO_GENERATOR` | **OFF** (past V1 slim) | Runway gen4.5 · Veo · Kling · Luma Ray3.2 · Firefly Video · Seedance/ModelArk | **Sora UNAVAILABLE** · CapCut |
| `IMAGE_GENERATOR` / `IMAGE_EDITOR` | OFF V1 | Firefly / vendor image APIs when contracted | CapCut scrape |
| `VOICE_TTS` / `STT` / `DUBBING` | STT optional V1 captions | ElevenLabs (consent for clone) | Clone without `consent_id` |
| `LIP_SYNC` / `AVATAR` | OFF V1 / FUTURE | HeyGen/Synthesia/Kling avatar — **≠** STARRDOM photo hero | Silent hero swap |
| `UPSCALE` / `INTERPOLATION` | OFF V1 | Nebula GPU optional (RIFE MIT) + FFmpeg minterpolate | Interp as source truth |
| Aggregator (`PIKA_GATEWAY`) | Optional later | Catalog ≠ lock-in; archive first-party ToS per spend | Treat catalog-only as UNVERIFIED until ToS |

**Contract per call:** `category` · `provider_id` · `model` · `asset_hashes_in` · `tos_archive_ref` · `commercial_ok` · `consent_id?` · `AI_GENERATED` label · PreviewTicket before spend · result → Media Library AssetRef → EditOp insert (tips≠ops).

### D. Failure classes (Engineer)

`THEME_GRADE_AS_EFFECT` · `OFX_AS_CAPCUT` · `PROXY_AS_MASTER` · `NONFREE_FFMPEG_IN_INSTALLER` · `NVENC_SOLD_AS_PRODUCT_SHIP` · `SORA_IN_ROUTER` · `GEN_ON_BY_DEFAULT_V1` · `BEAUTY_IN_GRADE_DEFAULT`

### E. Stamp

Engineer Wave 6 Domain 11/12/26 (+ Wave 5 Router stubs) stamped for fold. Research ≠ shipped. Builds HOLD.

*Next: Wave 7 hardware/Provider Router deep + Domain 32 rights bake; Wave 8 first-build slice — do not treat MASTER REPORT draft as complete.*

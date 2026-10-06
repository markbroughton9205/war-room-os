# HVS WAVE 6 — Audio / Color / VFX / Captions / Speed / BG / Render

**Studio:** Higher Vision Studios (War Room major section)  
**Mode:** RESEARCH ONLY — 2026-09-20 (ET) — no War Room app code, commit, push, or deploy  
**Domains:** 11 (color/looks), 12 (VFX/compositing), 13 (captions/text/graphics), 14 (audio), 15 (music/beat), 18 (speed/motion), 19 (bg/object), 26 (render/proxy/cache)  
**Canonical map:** `HVS_8_WAVES_PLAN.md` Wave 6  
**Labels:** `VERIFIED CURRENT` | `PROPOSED HVS` | `FUTURE` | `REFUSE` | `UNVERIFIED`  
**Fold (non-SoR until verified):** `/home/box/higher-vision-studios/waves/WAVE_6.md`, `WAVE_5_MISFILED_LOOK_SOUND_from_old_map.md`  
**Locks:** CapCut ≠ SoR · beauty OFF by default · FFmpeg prefer LGPL ship · never silent-delete source · OTIO ≠ renderer · Linux/Nebula CUDA preferred · research ≠ shipped

---

## 0. Executive findings (Wave 6)

1. **Audio:** Fairlight (Resolve) is the DAW-class prior-art target for multitrack mix/EQ/dynamics/ADR; Descript validates transcript-first dialogue cleanup; ElevenLabs documents TTS/SFX/music/STT APIs for optional cloud voice/music — never hard-require.  
2. **Beat sync:** CapCut Auto Cut / Premiere Remix are UX prior art only. Public beat/onset stacks exist (`librosa` ISC; `aubio` GPL; `madmom` models **CC BY-NC-SA** → commercial gate). Auto montage = FUTURE until quality bar.  
3. **Color:** OCIO 2.5 + built-in ACES 2.0 CG/Studio configs are VERIFIED CURRENT (ASWF). ThemePack.look (Wave 2) must reference `ocio_look_id` / LUT — CapCut filters are not color pipeline SoR. Resolve Color page = finishing capability class.  
4. **VFX:** OpenFX (BSD-3-Clause, ASWF) is the plugin host path for later; Fusion/AE = node/layer prior-art classes, not copy targets.  
5. **Captions:** ASR → editable word-timed caption track → SRT/WebVTT (+ burn-in via FFmpeg) is V1 path; ThemePack caption_style deepens Wave 2 basics toward pro titles/lower-thirds.  
6. **Speed/BG:** Optical-flow retiming and generative inpaint = FUTURE/provider; local SAM2 masks (Wave 3) for cutout/mattes; stabilize/denoise = local-first OSS/FFmpeg class.  
7. **Render:** FFmpeg decode/encode + Nebula NVENC for proxy/preview; PreviewTicket cost ladder from Wave 4 (diff strip ≪ NVENC proxy ≪ full composite). Masters re-render from originals + typed graph.  
8. **REFUSE:** CapCut/Adobe scrape · invented NLE APIs · shipping `--enable-nonfree` FFmpeg in redistributable installer without Legal · madmom pretrained models in commercial core without license · beauty default-on · silent source delete.

---

## 1. Domain 14 — Pro audio + AI voice / music / SFX

### 1.1 Fairlight-class concepts (VERIFIED CURRENT — Blackmagic docs)

| Capability | Documented behavior | SKU note | Source |
|---|---|---|---|
| Fairlight page | Built-in DAW: tracks, mixer, EQ/dynamics, recording, ADR/Foley sampler | Resolve Free + Studio (feature depth varies) | https://www.blackmagicdesign.com/products/davinciresolve/fairlight |
| Voice Isolation | Neural dialogue isolation / noise reduction | **Studio** (Studio Features PDF) | DaVinci Resolve Studio 20 Features PDF |
| Music Remixer | Stem-like control: vocals / drums / bass / guitar / other | **Studio** | Fairlight Audio Guide Resolve 20 § Music Remixer |
| Dialogue Separator / Leveler | Dialogue processing family | Mix Free/Studio | Studio Features PDF |
| IntelliTrack → audio pan | Video subject track drives Fairlight panner | **Studio** | Resolve 19 New Features + Fairlight Guide (pan tracking) |
| Folder tracks / immersive | Track groups; ambisonics / Atmos workflows cited on Studio | Studio for immersive | Product + Studio Features |

**Label:** VERIFIED CURRENT as **capability class / prior art**. HVS does **not** embed Resolve; Linux Resolve may exist as optional operator peer tool (Wave 7 hardware).

**PROPOSED HVS audio bus:**
- Multitrack lanes: Dialogue / VO / Music / SFX / Atmos beds  
- Clip + track automation (gain, pan, mute, solo)  
- Insert chain stubs: EQ, compressor, limiter, gate, de-esser, reverb/delay (implement via OSS DSP or licensed plugins later)  
- Loudness target presets (e.g. −14 LUFS social / −24 LKFS broadcast — exact numbers = delivery policy Wave 7/8)  
- Picture↔pan link: consume Wave 3 `TrackData` → pan automation (IntelliTrack pattern)

### 1.2 Descript patterns (VERIFIED CURRENT — official Help)

| Pattern | What it does | HVS takeaway |
|---|---|---|
| Transcript-first edit | Cut picture by editing text | Domain 13/14 bridge; own caption/transcript EditOps |
| Filler-word removal | Detect um/uh/you-know class | `RemoveFillers` EditOp → ripple gaps; human confirm in ASSIST+ |
| Studio Sound / AI cleanup | File-level denoise/dereverb class | Optional local or cloud “dialogue enhance”; never silent |
| Underlord agent | Multi-step NL (captions + cleanup) | Wave 4 Director pattern study — own schema |

Sources:  
- https://help.descript.com/hc/en-us/articles/10327603613837-Studio-Sound  
- https://help.descript.com/hc/en-us/articles/21908864772493-Sound-Good-with-AI-Tools  
- https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript  

### 1.3 ElevenLabs — documented API only (VERIFIED CURRENT)

| Capability | Endpoint (high level) | Notes |
|---|---|---|
| TTS | `POST /v1/text-to-speech/{voice_id}` | `text` required; `model_id` default lineage includes `eleven_multilingual_v2`; `output_format` enum |
| Streaming TTS | Streaming helpers on same family | Chunked audio |
| Sound effects | `POST /v1/sound-generation` | `text`; optional `duration_seconds` (0.5–30), `loop`, `prompt_influence`, `model_id` |
| Music | `POST /v1/music` | `prompt` **or** `composition_plan`; `music_length_ms` 3000–600000 with prompt; `force_instrumental`; paid-tier noted in cookbooks |
| STT / Scribe | `POST /v1/speech-to-text` | word/character timestamps; `diarize`; `additional_formats`; multi-channel options |
| Voice cloning (IVC) | Voices / Instant Voice Cloning guides | **Consent + rights gate mandatory** |

Sources:  
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert  
- https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert  
- https://elevenlabs.io/docs/api-reference/music/compose  
- https://elevenlabs.io/docs/api-reference/speech-to-text/convert  
- https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/instant-voice-cloning  

**PROPOSED HVS:** Provider Router categories `VOICE` / `TTS` / `MUSIC` / `SFX` / `TRANSCRIPTION` (Wave 5 Domain 31). ElevenLabs = optional cloud adapter. **Never invent undocumented params.** Provenance: provider, model_id, prompt, voice_id, consent flag.

**REFUSE:** Hard-require ElevenLabs · clone without consent · treat vendor marketing as API.

### 1.4 Premiere Essential Sound / Remix (VERIFIED CURRENT — HelpX prior art)

- Essential Sound / Enhance Speech / ducking / loudness — in-host only.  
- **Remix:** musically aware retiming of music to target duration; does **not** analyze lyrics (Adobe documents limitation).  
Sources:  
- https://helpx.adobe.com/premiere/desktop/add-audio-effects/apply-audio-effects/remix-audio-in-premiere.html  
- https://helpx.adobe.com/premiere/desktop/add-audio-effects/apply-audio-effects/remix-tool-considerations-in-premiere.html  

**PROPOSED HVS:** `FitMusicDuration` EditOp mirrors Remix **behavior class** (own DSP), not Adobe plugin.

### 1.5 OSS audio helpers (Linux)

| Component | Role | License caution | Label |
|---|---|---|---|
| FFmpeg `loudnorm`, `afftdn`, `highpass`/`lowpass`, fades | Normalize / light denoise / filters | Prefer LGPL build; filter deps may pull GPL | VERIFIED CURRENT tech |
| RNNoise / DeepFilterNet class | Neural denoise | Verify SPDX + redistribution | PROPOSED eval |
| SoX / Rubber Band | Pitch/time (music fit) | GPL/Rubber Band dual — Legal gate | FUTURE / gated |

---

## 2. Domain 15 — Music / beat-synced editing

### 2.1 Product prior art (VERIFIED CURRENT UX — not APIs)

| Product | Behavior | HVS use |
|---|---|---|
| CapCut Auto Cut Beat Sync | Analyze audio; cut/montage modes; Mobile+Desktop; **not Web** (CapCut Help lineage) | Prior art only — **REFUSE** CapCut SoR/API myth |
| Premiere Remix | Duration fit, not full picture-to-every-beat | Music-length north star |
| FCP | Edit-to-the-beat / markers family in User Guide TOC | Marker workflow prior art |
| Resolve Fairlight | Strong mix + audio-driven Fusion animation (21 notes); one-button CapCut-class Auto Cut **not** clearly first-party → treat auto beat-montage as FUTURE unless pinned to a specific manual section at build | Mixed / FUTURE for auto montage |

CapCut Help (benchmark): https://www.capcut.com/help/how-to-use-auto-cut  

### 2.2 Public beat / onset stacks

| Library | What exists publicly | License | Commercial HVS? |
|---|---|---|---|
| **librosa** | `onset_detect`, `beat_track`, tempo | ISC (permissive) | **Preferred default** for markers |
| **aubio** | onset + tempo (C/Python) | GPLv3 | Use only if GPL-compatible ship or process-isolate |
| **madmom** | Strong RNN/DBN beat tracking | Code BSD-ish; **pretrained models CC BY-NC-SA 4.0** | **REFUSE** default commercial bundle of models without Widmer/commercial license — label UNVERIFIED for ship until Legal clears |

Sources:  
- https://librosa.org/doc/latest/generated/librosa.onset.onset_detect.html  
- https://librosa.org/doc/latest/auto_tutorials/01-intro/06-rhythm.html  
- https://github.com/CPJKU/madmom/blob/main/LICENSE  
- https://pypi.org/project/madmom/  

### 2.3 PROPOSED HVS beat architecture

```
AudioAsset → BeatAnalysisJob (librosa-first)
  → BeatGrid { bpm, beats[], downbeats?, confidence, algorithm, version }
  → Timeline markers (Observed after Accept)
  → EditOps:
       SnapCutToBeat | AlignTransitionToBeat | CutOnBeats (montage)
       DuckMusic | FitMusicDuration
```

| Stage | Label |
|---|---|
| Beat markers + snap | PROPOSED HVS (V1–V2) |
| Auto Cut–class montage | FUTURE until false-cut rate acceptable |
| CapCut Auto Cut dependency | REFUSE |
| madmom models in redistributed core | REFUSE without commercial license |

Command example (Director): `"Cut this on the beat"` → Scenario `CutOnBeats` + PreviewTicket → human Accept.

---

## 3. Domain 11 — Color / looks / filter engine

### 3.1 OCIO / ACES (VERIFIED CURRENT)

| Fact | Detail | Source |
|---|---|---|
| OCIO 2.5 | ASWF; VFX Reference Platform CY2026 lineage | https://opencolorio.readthedocs.io/en/latest/releases/ocio_2_5.html |
| Built-in ACES 2.0 configs | `ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5` · `ocio://studio-config-v4.0.0_aces-v2.0_ocio-v2.5` · `ocio://default` → latest CG | Same + aces_cg / aces_studio pages |
| Bake rule | Use **DisplayViewTransform** (not ColorSpaceTransform) to bake ACES Output Transform | https://opencolorio.readthedocs.io/en/latest/configurations/aces_cg.html |
| AE 26.5+ | OCIO 2.5.1 + native ACES 2.0 CG/Studio | https://helpx.adobe.com/after-effects/desktop/adjust-colors/opencolorio-and-aces-color-management/opencolorio-aces-color-management.html |

### 3.2 Resolve / Premiere / CapCut (capability class)

| Host | Role | Label |
|---|---|---|
| Resolve Color page | Industry grading reference; ACES project color science; windows/qualifiers/scopes | VERIFIED CURRENT prior art — https://www.blackmagicdesign.com/products/davinciresolve/color |
| Premiere Lumetri | Editorial looks / LUT; sequence color management — **not** full OCIO host like AE 26.5 | VERIFIED CURRENT |
| CapCut filters | Strength UX creative looks only | Prior art; **REFUSE** as finishing SoR |

### 3.3 ThemePack.look tie-in (PROPOSED HVS — Wave 2 continuity)

Wave 2 ThemePack already sketches `look` / LUT + `ocio` integrate. Wave 6 hardens:

```
ThemePack.look {
  ocio_config_uri: "ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5",  // or facility config
  working_space: "ACES2065-1" | "ACEScg" | ...,
  display: "...",
  view: "...",
  look_id?: string,          // OCIO Look
  lut_asset?: AssetRef,      // optional File Transform
  strength: 0..1,            // creative mix vs identity
  skin_protect?: bool,       // policy flag — not a magic beauty filter
  beauty_lite: false         // DEFAULT OFF (Wave 2/5 lock)
}
```

Named creative looks (content names, not CapCut clones): Luxury Gold · Clean Beauty · Cinematic Teal · Warm Lifestyle · Dark Luxury · Commercial Clean · Film 35 · Dream · Vintage · Street · Gaming Neon — each = OCIO Look and/or authored LUT + strength, non-destructive, re-renderable from originals.

**Scopes (PROPOSED):** waveform / vectorscope / histogram for Color tab — V2 depth; V1 may ship viewer exposure/contrast/sat/WB + look apply only.

**Shot match / auto color:** FUTURE / optional Neural-class; never silent grade overwrite without Version.

---

## 4. Domain 12 — Effects / compositing / VFX

### 4.1 OpenFX (VERIFIED CURRENT standard)

- Open C API between VFX plugins and hosts; **BSD 3-Clause**; under **Academy Software Foundation**.  
- Documented host ecosystem examples: Resolve/Fusion, Nuke, Natron, Vegas, Flame, etc.  
- Sources: https://openeffects.org/ · https://openfx.readthedocs.io/en/latest/Reference/ofxImageEffectAPI.html  

**PROPOSED HVS:** Plan **OpenFX host** (Wave 7 plugin boundary) so Studio-grade OFX plugins can attach; map OFX params ↔ typed EditOp params; SPDX audit **per plugin**.  

**REFUSE:** Assume Premiere/AE drop-in OFX (Adobe primarily uses own effect/MOGRT models). Do not copy proprietary ResolveFX binaries.

### 4.2 Prior-art classes (not copy targets)

| Class | Meaning for HVS | Label |
|---|---|---|
| Fusion / Nuke nodes | Node graph compositing depth target | Prior art / FUTURE host depth |
| After Effects layers | Layer + keyframe + MOGRT graphics class | Prior art for titles/mgfx |
| CapCut effects | Fast social FX | ThemePack timed effects — own kernels |

### 4.3 Built-in effect graph (PROPOSED HVS)

Own lightweight effect stack first (before full OFX host):

| Family | Ops | Local vs provider |
|---|---|---|
| Transform / opacity / blend / crop | Core | Local |
| Blur / glow / grain / vignette / lens | Creative | Local GPU kernels |
| Chroma/luma key | Green-screen class | Local |
| Mask / matte from TrackSubject | Wave 3 SAM2 | Local |
| Stabilize | FFmpeg vidstab / OpenCV | Local |
| Denoise | FFmpeg / neural eval | Local preferred; cloud optional |
| Particles / 3D titles | | FUTURE |

---

## 5. Domain 13 — Captions / text / graphics (deepen Wave 2)

### 5.1 VERIFIED CURRENT caption pipelines

| Product | Capability | API for Nebula? |
|---|---|---|
| Premiere Speech to Text → Create Captions | Transcript + caption styles; speaker labeling | In-host only |
| CapCut Auto Captions | Recognise Subtitles Web/Desktop/Mobile | **No** CapCut caption API |
| ElevenLabs STT | Word/character timestamps; diarize; additional formats | **Yes** cloud |
| Descript | Agent captions + SRT export | Cloud product |
| Resolve | Transcription / Create Subtitles from Audio (confirm Free vs Studio AI at implement) | In-host; Linux Resolve possible |
| FCP | Generate subtitles / import-export captions | Apple ecosystem |

Sources:  
- https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/auto-transcribe-video-using-speech-to-text.html  
- https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/create-captions.html  
- ElevenLabs STT (above)

### 5.2 PROPOSED HVS caption / title stack

```
ASR (local Whisper-class OR cloud STT via Router)
  → Transcript { words[{text, start, end, speaker?}] }
  → CaptionTrack (editable)
  → StylePack from ThemePack.caption_style
  → Export: SRT + WebVTT (+ TTML later)
  → Optional burn-in: FFmpeg subtitles/ass filter (lowerer only)
```

| Feature | Phase | Label |
|---|---|---|
| Word-level karaoke / highlight | V1–V2 | PROPOSED |
| Speaker labels | V1 if diarize available | PROPOSED |
| Lower thirds / end cards / CTA / logo | ThemePack slots | PROPOSED (Wave 2 deepen) |
| Motion titles / Lottie | Resolve 21 OGraf/Lottie direction as prior art | FUTURE host |
| MOGRT interchange | Adobe-only | FUTURE / optional export — not core ABI |
| Broadcast MCC/CEA-608 | | FUTURE — verify before claim |
| Human proofread gate | Always for client deliverables | PROPOSED policy |

**V1 slim lock remains:** ingest → cut → **captions** → export (Blind Spot).

---

## 6. Domain 18 — Speed / motion / optical flow

### 6.1 NLE prior art (VERIFIED CURRENT capability class)

Major NLEs document variable speed, freeze, reverse, speed ramps, and optical-flow / frame-blended retiming as **in-host** features (Premiere, FCP, Resolve). Treat as behavior targets — no invented APIs.

### 6.2 PROPOSED HVS + OSS

| Mode | Mechanism | Label |
|---|---|---|
| Constant speed / reverse / freeze | Timeline rate + media time mapping | PROPOSED V1 |
| Speed ramp (keyframes) | Curve on clip | PROPOSED V2 |
| Frame blend | Cheap | PROPOSED |
| Optical flow / AI interp (RIFE-class, FFmpeg `minterpolate`) | Quality slo-mo | FUTURE — GPU cost on Nebula; license per model |
| Motion blur synthesis | | FUTURE |
| Rolling-shutter correction | | FUTURE / camera metadata when present |
| Stabilize | `vidstab` / OpenCV | PROPOSED local |

EditOps (align Wave 4): `SetSpeed` · `SpeedRamp` · `FreezeFrame` · `Reverse` · `Stabilize`.

**REFUSE:** Model→raw ffmpeg filter strings (Wave 4 lock). Typed ops lower to FFmpeg/GPU compositor only after validate.

---

## 7. Domain 19 — Background / object editing

### 7.1 Local vs provider split (PROPOSED HVS)

| Task | Local (preferred) | Provider / generative | Notes |
|---|---|---|---|
| Person/hair matte | **SAM2** (+ Wave 3 TrackSubject) | — | Apache-2.0 SAM2 — Wave 3 VERIFIED stack |
| BG remove / cutout | SAM2 mask → composite | Optional cloud cutout | Prefer local for privacy |
| BG blur / replace (plate) | Mask + blur / still plate | Gen plate via Router | Provenance required |
| Object remove (simple) | Mask + local inpaint lite | Gen inpaint (Firefly/etc.) | Hero plates need Version |
| People remove / sky replace | | Generative | FUTURE / gated |
| Relight | | Gen or FUTURE local | |
| Product isolation | SAM2 / detector | | STARRDOM product CU |

**Policy:** Beauty/identity-affecting mattes **opt-in**; never default skin smooth. **REFUSE** silent generative overwrite of Observed hero media.

### 7.2 EditOps (PROPOSED)

`CreateMaskFromTrack` · `RemoveBackground` · `ReplaceBackground` · `BlurBackground` · `IsolateSubject` · `RemoveObject` (confirm) · `InpaintRegion` (Router).

---

## 8. Domain 26 — Render / cache / proxy architecture

### 8.1 FFmpeg + NVENC (VERIFIED CURRENT)

| Fact | Label | Source |
|---|---|---|
| FFmpeg default license LGPL 2.1+; `--enable-gpl` / `--enable-nonfree` change obligations | VERIFIED | https://www.ffmpeg.org/legal.html |
| Prefer compile **without** `--enable-gpl` and `--enable-nonfree` for redistributable LGPL compliance checklist | VERIFIED | Same |
| NVIDIA documents FFmpeg + NVENC/NVDEC (`h264_nvenc`, `hevc_nvenc`, `-hwaccel cuda`) on Linux | VERIFIED | https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html |
| Codec patent/third-party licenses remain operator responsibility | VERIFIED | NVIDIA Video Codec SDK License |

**PROPOSED ship policy:**  
- **Product installer:** LGPL FFmpeg (software encoders libx264 only if GPL accepted separately — else system/encoder policy via Legal).  
- **Nebula operator machine:** CUDA NVENC toolchain may be **local non-redistributed** operator path for proxy/preview speed.

### 8.2 Proxy / cache ladder (PROPOSED HVS)

```
Originals (immutable Observed bytes, content-hash)
  → Proxy ladder (e.g. 1/4 · 1/2 · scrub mezzanine) via FFmpeg/NVENC on Linux workers
  → Thumb / waveform / peak caches
  → Effect / grade render cache (keyed by graph hash + params)
  → PreviewTicket outputs (Scenario; discardable)
  → Final masters (H.264 / H.265 / ProRes-class / DNx / image sequence / alpha when needed)
```

| Job type | Purpose | Encoder preference |
|---|---|---|
| Scrub proxy | Timeline interactivity | NVENC H.264 on Nebula |
| PreviewTicket | Accept/Reject AI ops | See cost notes §8.3 |
| Background cache | Dirty ranges | NVENC or libx264 |
| Final deliverable | Client masters | Quality-first; platform variants batch |
| Resume / batch | Queue with idempotent job ids | PROPOSED |

Masters **always** re-render from originals + committed edit graph — proxies never become SoT.

### 8.3 PreviewTicket cost notes (from Wave 4 — PROPOSED)

Wave 4 pipeline: validate → apply Scenario → optional **PreviewTicket** → human Accept.

| PreviewPolicy | Cost / latency (relative) | When |
|---|---|---|
| `none` | ≈0 | Trusted MANUAL micro-ops |
| `diff_strip` | Low (stills / contact sheet) | Theme/look/caption checks |
| `proxy_render` (NVENC short) | Medium — Nebula GPU preferred | Cut/speed/track follow |
| Full GPU composite / optical-flow / gen | High — quote-before-spend if cloud | Director multi-op / VFX |

**Cost policy (PROPOSED):**  
1. Prefer local Nebula CUDA for proxy/preview.  
2. Cloud gen/previews require Router quote + provenance.  
3. Scenario PreviewTickets are discardable; do not fill client NAS without retention policy (Wave 7).  
4. FIRST_CUT / DIRECTOR default to preview-before-commit.

### 8.4 EditOps

`ExportProxy` · `Render` · `PurgeCache` (cache only — **never** originals) · `BatchDeliver` (aspect variants 16:9 / 9:16).

---

## 9. Cross-cutting EditOp inventory (Wave 6 set)

| Family | EditOps (PROPOSED) |
|---|---|
| Audio | `SetGain` `FadeAudio` `EQ` `Dynamics` `DuckMusic` `NormalizeLoudness` `IsolateVoice` `FitMusicDuration` `GenerateVoice` `GenerateSFX` `GenerateMusic` `LinkPanToTrack` |
| Beat | `AnalyzeBeats` `SnapCutToBeat` `CutOnBeats` `AlignToDownbeat` |
| Color | `ApplyLook` `SetOCIOConfig` `SetLUT` `GradeBasic` `ShotMatch` |
| VFX | `AddEffect` `SetBlend` `KeyChroma` `Stabilize` `Denoise` |
| Captions/GFX | `Transcribe` `CreateCaptions` `StyleCaptions` `AddTitle` `AddLowerThird` `AddEndCard` `BurnInCaptions` |
| Speed | `SetSpeed` `SpeedRamp` `FreezeFrame` `Reverse` `InterpolateFrames` |
| BG/Object | `CreateMaskFromTrack` `RemoveBackground` `ReplaceBackground` `BlurBackground` `RemoveObject` `InpaintRegion` |
| Render | `ExportProxy` `Render` `PurgeCache` `BatchDeliver` |

All ops: typed · validated · undoable · attributable · no raw ffmpeg from model.

---

## 10. Local / cloud / hybrid matrix (Wave 6 slice)

| Capability | LOCAL | CLOUD | HYBRID |
|---|---|---|---|
| Multitrack mix / EQ / loudnorm | ✓ primary | | |
| Dialogue denoise | ✓ preferred | optional | ✓ |
| TTS / clone / music gen / SFX gen | optional local TTS later | ✓ ElevenLabs-class | Router |
| Beat analysis | ✓ librosa | | |
| OCIO grade / LUT | ✓ | | |
| OFX plugins | ✓ host later | | |
| Captions ASR | Whisper-class | ElevenLabs STT | ✓ |
| Optical flow slo-mo | ✓ Nebula GPU | | |
| BG matte SAM2 | ✓ | | |
| Generative inpaint / sky | | ✓ | |
| Proxy / NVENC | ✓ Nebula | | |
| Final master encode | ✓ | optional farm | ✓ |

---

## 11. Build vs integrate (Wave 6)

| Subsystem | Decision | Reasoning |
|---|---|---|
| Audio bus + EditOps | **BUILD** | Own timeline truth |
| Fairlight/Descript/Premiere | Prior art only | No embed |
| ElevenLabs adapter | **API integrate** (optional) | Documented endpoints |
| Beat markers | **BUILD** on librosa | Permissive; madmom models gated |
| OCIO looks | **INTEGRATE** OCIO 2.5 | Industry SoT |
| ThemePack look refs | **BUILD** | Wave 2 continuity |
| OpenFX host | **LATER** (Wave 7) | Ecosystem leverage |
| Caption track + SRT | **BUILD** | V1 acceptance |
| STT | **HYBRID** Router | Local + cloud |
| SAM2 mattes | **INTEGRATE** (Wave 3) | Apache-2.0 |
| Gen inpaint | **API** | Provider Router |
| FFmpeg render/proxy | **INTEGRATE** LGPL | Legal lock |
| NVENC | **OPERATOR** Nebula | Nonfree redistributable caution |
| Resolve/AE/Fusion | **REFUSE** as runtime SoR | Peer tools only |

---

## 12. Blind Spot / REFUSE register

1. CapCut as audio/color/caption engine or API SoR.  
2. Invented Blackmagic/Adobe/ElevenLabs fields beyond docs.  
3. Shipping nonfree FFmpeg in War Room installer without Legal.  
4. madmom NC models in commercial core.  
5. Beauty / skin filters default ON.  
6. Silent delete of source or proxy-as-master.  
7. OFX plugin without SPDX/license scan.  
8. Voice clone without consent/provenance.  
9. Auto Cut montage shipped before quality gate.  
10. Claiming Resolve Color / Fairlight parity from FFmpeg alone.

---

## 13. Open questions → Wave 7 / 8

1. OCIO UI depth in V1 (config picker vs full facility UI)?  
2. Minimum caption export set: SRT+WebVTT only?  
3. Voice Isolation: build vs partner vs “export to Resolve Studio”?  
4. ElevenLabs SKU / retention / zero-retention for client PII audio?  
5. Proxy resolution ladder exact widths for Nebula VRAM map?  
6. First OFX categories (key / blur / film look / retime)?  
7. GPL aubio / GPL FFmpeg filters — process isolation vs avoid?  
8. PreviewTicket retention & NAS quotas?

---

## 14. Sources (URLs)

### Fairlight / Resolve
- https://www.blackmagicdesign.com/products/davinciresolve/fairlight  
- https://www.blackmagicdesign.com/products/davinciresolve/color  
- https://www.blackmagicdesign.com/products/davinciresolve/whatsnew  
- https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Fairlight-Audio-Post.pdf  
- https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_Studio_20_Features.pdf  

### OCIO / ACES / AE
- https://opencolorio.readthedocs.io/en/latest/releases/ocio_2_5.html  
- https://opencolorio.readthedocs.io/en/latest/configurations/aces_cg.html  
- https://opencolorio.readthedocs.io/en/latest/configurations/aces_studio.html  
- https://helpx.adobe.com/after-effects/desktop/adjust-colors/opencolorio-and-aces-color-management/opencolorio-aces-color-management.html  

### OpenFX
- https://openeffects.org/  
- https://openfx.readthedocs.io/en/latest/Reference/ofxImageEffectAPI.html  

### Premiere / captions / Remix
- https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/auto-transcribe-video-using-speech-to-text.html  
- https://helpx.adobe.com/premiere/desktop/add-text-images/insert-captions/create-captions.html  
- https://helpx.adobe.com/premiere/desktop/add-audio-effects/apply-audio-effects/remix-audio-in-premiere.html  
- https://helpx.adobe.com/premiere/desktop/add-audio-effects/apply-audio-effects/remix-tool-considerations-in-premiere.html  
- https://helpx.adobe.com/premiere/desktop/add-text-images/use-motion-graphics-templates/overview-of-motion-graphics-templates.html  

### Descript
- https://help.descript.com/hc/en-us/articles/10327603613837-Studio-Sound  
- https://help.descript.com/hc/en-us/articles/21908864772493-Sound-Good-with-AI-Tools  
- https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript  

### ElevenLabs
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert  
- https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert  
- https://elevenlabs.io/docs/api-reference/music/compose  
- https://elevenlabs.io/docs/api-reference/speech-to-text/convert  
- https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/instant-voice-cloning  

### Beat / DSP
- https://librosa.org/doc/latest/generated/librosa.onset.onset_detect.html  
- https://librosa.org/doc/latest/auto_tutorials/01-intro/06-rhythm.html  
- https://github.com/CPJKU/madmom/blob/main/LICENSE  

### CapCut (prior art only)
- https://www.capcut.com/help/how-to-use-auto-cut  

### FFmpeg / NVIDIA
- https://www.ffmpeg.org/legal.html  
- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html  
- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/license/index.html  

### Internal continuity
- Waves 1–5 under `/workspace/terra-swarm/hvs-waves/`  
- `/home/box/higher-vision-studios/waves/WAVE_6.md` (seed; folded)  
- `/home/box/higher-vision-studios/waves/WAVE_5_MISFILED_LOOK_SOUND_from_old_map.md` (folded; verified against official URLs above)

---

## 15. Document control

| Field | Value |
|---|---|
| Wave | 6 |
| Written | 2026-09-20 ET |
| Lines target | ≥280 cited |
| Master report sections filled | §§13, 14, 16 |
| Next | Wave 7 hardware / rights / UI |
| Status | RESEARCH ONLY — not shipped |

*End Wave 6. Research ≠ shipped. Builds HOLD.*

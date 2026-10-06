# HVS PHASE 1 ACCEPTANCE CONTRACT
# Professional Editor Foundation

**Slice:** `HVS-P1-SLICE-G`  
**Authority:** `lib/media-command/phase1-contract.ts` + Master Matrix `phase` column  
**Do not inflate SHIPPED. Later-phase rows keep their global state.**

## What Phase 1 means

Phase 1 is a **professional editor foundation** inside Higher Vision Studios. A Commander can ingest media, cut, caption, title, follow a person to 9:16, preview/commit/reject AI EditOps, undo/redo, snapshot versions, and render 16:9 + 9:16 **inside HVS** without CapCut / FCP / Premiere / Resolve.

It is **not** a VFX compositor, not a color suite, not a DAW, not a generation product, and not prompt-to-film.

## Includes

- `.hvsproj` SoT, tracks as authoring truth, rational media time, typed EditCommands
- Immutable originals + ingest (proxy, thumbs, waveforms)
- Source Monitor
- Program Viewer HTML5 + proxy + overlays + 9:16 framing preview
- Timeline editing + **Blade tool** + **manual markers**
- EditTransaction **preview** (no `.hvsproj` write) / **commit** / **reject**
- Undo / redo
- Dissolve (parameterized) + default cut
- Basic audio: volume, fade, duck, pan
- Captions, titles, logos, **static** lower thirds
- TrackSubject V1 person + VirtualCamera + auto reframe
- Version Browser
- FFmpeg queue (libx264). NVENC is optional later, never required
- Thin grade / named looks that are RENDER-LOWERED
- ffprobe success gate
- `productionMode` enum
- Beauty identity morphing OFF
- AI Director regex → typed commands → preview → commit/reject

## Does not include (later phase, not a Phase-1 blocker)

| Capability | Phase |
|---|---|
| GPU compositor / filmstrip | 5 / 9 |
| Preview-only ThemeSpec (glow, grain, film, gold-veil, letterSpacing, caption animation) | 5 |
| Node color / ACES / OCIO / HDR / scopes | 5 |
| VFX graph / roto / keying | 5 / 9 |
| DAW processors / buses / stems | 5–9 |
| Generate Video / Image / Voice / Music / SFX | 2 |
| Video Intelligence | 3 |
| Animated lower thirds | 5 |
| Beat detection | 5 |
| Review A/B, comments, QC, approval | 6 |
| Bins / collections | 6 |
| Transcription / ASR | 2 |
| CameraSpec generative language | 2 |
| NVENC / CUDA workers | 9 |
| Prompt-to-film | 10 |
| Sora / Ultralytics AGPL / realtime 4K track | BLOCKED |

## Program Viewer Phase-1 contract

HTML5 `<video>` + proxy URLs + CSS look lowering + caption/title overlays + dissolve dual-video + Web Audio pan + Track Subject viewer overlays + VirtualCamera framing preview.

**Phase 1 does not require a GPU compositor.** Broader compositor fidelity remains PARTIAL globally and is owned by Phase 5/9.

## FACE LOCK boundary

FACE LOCK means shot-local follow of one selected real person within one continuous clip. It does **not** mean biometric identification, cross-scene identity, cross-video identity, multi-person re-identification, or general face recognition.

## Closure rule

A Phase-1 row is a matrix row whose `phase` is exactly `'1'`. Mixed phases (`1/5`, `1-7`, `1-2`) are split-ownership and **do not block** Phase 1 when the Phase-1 half is already shipped on another row.

Do not promote later-phase rows to SHIPPED to make Phase 1 green.

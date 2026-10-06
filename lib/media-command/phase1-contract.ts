/**
 * HVS Phase 1 acceptance contract — Professional Editor Foundation.
 * Source of truth for which matrix rows block Phase 1 closure.
 * Later-phase capabilities keep their global state; they are not Phase-1 blockers.
 *
 * FACE LOCK remains shot-local follow of one selected real person in one continuous clip.
 * Not biometric identification, not cross-scene identity, not re-ID.
 */
import { HVS_MATRIX_ROWS, type HvsMatrixRow, type HvsMatrixState } from './production-matrix'

export const HVS_PHASE_1_NAME = 'Professional Editor Foundation'

export const HVS_PHASE_1_ACCEPTANCE_CONTRACT = `
HVS PHASE 1 = Professional Editor Foundation.

INCLUDES:
- project truth (.hvsproj, tracks, rational time, typed EditCommands)
- media ingest (immutable originals, proxy, thumbs, waveforms)
- Source Monitor
- Program Viewer HTML5 + proxy + overlays + 9:16 object-position (not a GPU compositor)
- timeline editing (insert/overwrite/append/split/trim/ripple/move/lift/extract/roll/slip/slide/extend/duplicate/snap)
- Blade tool (Select vs Blade → typed splitClip)
- manual markers (add/edit/move/remove; not beat detection)
- typed EditOps + EditTransaction preview vs commit vs reject
- undo/redo
- dissolve transitions (parameterized model; cut is default)
- basic audio (volume, fade, duck, pan)
- captions/titles/logos + static lower thirds
- TrackSubject V1 person + VirtualCamera follow + 9:16 auto reframe
- Version Browser (snapshot/restore/branch/compare)
- FFmpeg render queue (libx264; NVENC optional later)
- persistence + reload
- AI Director bounded regex → typed EditCommands → preview → commit/reject
- thin grade / basic looks that are RENDER-LOWERED (exposure, contrast, saturation, temperature, named FilterSpecs)
- ffprobe success gate on render
- productionMode enum on the project
- beauty identity morphing OFF

DOES NOT INCLUDE (later phase, not a Phase-1 blocker):
- GPU compositor / WebGPU / CUDA Program Viewer (Phase 5/9)
- preview-only ThemeSpec: letterSpacing, caption animation, glow, grain, film, gold-veil (Phase 5)
- professional node color / ACES / OCIO / HDR / scopes (Phase 5)
- VFX node graph / rotoscope / keying (Phase 5/9)
- DAW: EQ, compressor, buses, stems (Phase 5-9)
- Provider Router generation: Video/Image/Voice/Music/SFX (Phase 2)
- Video Intelligence (Phase 3)
- animated motion-graphics lower thirds (Phase 5)
- beat detection / beat-sync cut (Phase 5)
- advanced Review/QC: A/B sync, comments, approval, auto QC (Phase 6)
- bins/folders/collections (Phase 6)
- transcription / ASR captions (Phase 2)
- CameraSpec generative language (Phase 2)
- prompt-to-film (Phase 10)
- NVENC / Nebula CUDA workers (Phase 9; vendor-neutral project truth stays CPU/libx264)
- Sora, Ultralytics AGPL tracker, realtime 4K track (BLOCKED, not Phase 1)

PHASE-1 PROGRAM VIEWER CONTRACT:
HTML5 <video> + proxy URLs + CSS look lowering + caption/title overlays + dissolve dual-video +
Web Audio pan + Track Subject viewer overlays + VirtualCamera framing preview.
Scrub matches shipped ops. GPU compositor is Phase 5/9 and is not required to close Phase 1.
`.trim()

export const PROGRAM_VIEWER_PHASE1_CONTRACT = `
PROGRAM VIEWER PHASE-1 CONTRACT
Proven: cuts, gaps, transforms, crop, opacity, captions, titles, logos, speed, reverse, freeze,
pan, dissolve, basic supported looks, tracking overlays, VirtualCamera framing preview.
Not required for Phase 1: GPU compositor, filmstrip, pixel-identical advanced ThemeSpec.
Remaining global PARTIAL is the advanced compositor / preview-only properties (Phase 5/9),
not a missing Phase-1 editor surface.
`.trim()

/** Rows whose \`phase\` is exactly '1' form the Phase-1 closure set. Mixed phases (1/5, 1-7, 1-2) are split-ownership. */
export function isPhase1ClosureRow(row: HvsMatrixRow): boolean {
  return row.phase === '1'
}

export function phase1ClosureRows(): HvsMatrixRow[] {
  return HVS_MATRIX_ROWS.filter(isPhase1ClosureRow)
}

export function phase1ClosureCounts(): Record<HvsMatrixState, number> {
  const counts: Record<HvsMatrixState, number> = { SHIPPED: 0, PARTIAL: 0, SHELL: 0, RESEARCHED: 0, 'NOT STARTED': 0, BLOCKED: 0 }
  for (const row of phase1ClosureRows()) counts[row.state] += 1
  return counts
}

export type Phase1DeferredRow = {
  id: string
  laterPhase: string
  reason: string
}

/**
 * Rows that previously looked like Phase-1 leftovers but belong later.
 * Global state is preserved; they are removed from the Phase-1 closure set via phase reassignment.
 */
export const PHASE1_DEFERRED_ROWS: Phase1DeferredRow[] = [
  { id: 'G9-02', laterPhase: '5', reason: 'Person kind is G9-01 SHIPPED. face/body/hands/product/object/custom tracking kinds are Phase 5.' },
  { id: 'G11-03', laterPhase: '6', reason: 'Bins/folders/collections are library maturity, not editor foundation.' },
  { id: 'G13-12', laterPhase: '1/5', reason: 'Phase-1 HTML5 Program Viewer is accepted. GPU compositor is Phase 5/9.' },
  { id: 'G17-02', laterPhase: '1/5', reason: 'Basic looks RENDER-LOWERED. Remaining preview-only ThemeSpec is Phase 5.' },
  { id: 'G17-03', laterPhase: '5', reason: 'Named FilterSpec ids persist (G17-01). Look-version history is Phase 5.' },
  { id: 'G30-02', laterPhase: '1-7', reason: 'Phase-1 regex Director is G30-01/G30-04. LLM-backed utterance mapping is Phase 7.' },
  { id: 'G36-02', laterPhase: '2', reason: 'ASR / word-level transcription is Provider Router Phase 2.' },
  { id: 'G37-02', laterPhase: '5', reason: 'Static lower thirds are G37-01. Animated motion-graphics lower thirds are Phase 5.' },
  { id: 'G40-02', laterPhase: '1/5', reason: 'Shipped ops render. Remaining preview-only/VFX fidelity is Phase 5.' },
  { id: 'G40-04', laterPhase: '9', reason: 'Render queue is G40-01. Background cache / optimized media ladder is Phase 9.' },
  { id: 'G46-01', laterPhase: '2', reason: 'Ingest SHA-256 + immutable originals are Phase 1. Generated-media provenance is Phase 2.' },
  { id: 'GX-01', laterPhase: '2', reason: 'STARRDOM editor path is proven. Missing generated plates are Phase 2 Router.' },
  { id: 'GX-03', laterPhase: '9', reason: 'NVENC/CUDA workers are optional acceleration. Project truth is vendor-neutral CPU/libx264.' },
]

export const PHASE1_BLOCKED_ROWS: Array<{ id: string; phase: string; reason: string }> = [
  { id: 'G22-03', phase: '—', reason: 'Sora / OpenAI Videos API excluded. Not a Phase-1 editor row.' },
  { id: 'GX-07', phase: '8', reason: 'WRIM as Router backend only if production WRIM exists.' },
  { id: 'GX-08', phase: '—', reason: 'Ultralytics AGPL tracker forbidden. SAD TrackSubject is the Phase-1 engine.' },
  { id: 'GX-09', phase: '—', reason: 'Realtime 4K tracking HOLD. Not a Phase-1 acceptance item.' },
]

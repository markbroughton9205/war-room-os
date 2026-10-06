/**
 * Wave 7 — Program preview vs unified Deliver fidelity.
 * PreviewEngine is not replaced. CSS/SVG/Web Audio are derived from the same
 * EffectGraph / ColorPipeline / AudioGraph parameters that RenderEngine lowers.
 * Physical FFmpeg render remains canonical.
 */
import {
  readMaskParams,
  readTransformParams,
  maskPreviewCss,
  type HvsEffectGraph,
  type MaskParams,
  type TransformParams,
} from './effect-graph'
import {
  colorPipelineToPreviewCss,
  identityColorPipelineOr,
  readLumaQualifier,
  type ColorCurve,
  type ColorPipeline,
  type LumaQualifierParams,
} from './color-pipeline'
import { interpolateSubject } from './tracking'
import { composeProgramLookCss } from './look-lowering'
import { toSeconds } from './time'
import type { Clip, HvsProject, Track } from './types'
import type { AudioGraph } from './audio-graph'

export const GEOMETRY_TOLERANCE_FRACTION = 0.03
export const MASK_CENTER_TOLERANCE_FRACTION = 0.03
export const TRACKING_CENTER_TOLERANCE_FRACTION = 0.03
export const COLOR_DIRECTION_MIN_DELTA = 4

export type FidelityClass =
  | 'EXACT'
  | 'DIRECTIONALLY_EQUIVALENT'
  | 'PREVIEW_APPROXIMATION'
  | 'RENDER_ONLY'
  | 'UNSUPPORTED'

export type FidelityRow = {
  capability: string
  classification: FidelityClass
  preview: string
  deliver: string
  note: string
}

export const PROGRAM_PREVIEW_TRACE = `
Program Viewer (HTML5 + PreviewEngine mapPlayheadToSource)
→ clip trim/reverse/speed/freeze (HTML5 currentTime / playbackRate / rAF)
→ clip.crop + clip.transform (CSS %)
→ Phase-1 ColorGrade + FilterSpec (CSS filter)
→ [WAVE7 EffectGraph] Transform/Mask/Blur/TrackerRef from SAME node params
   Mask clip-path; invert+blur uses dual-layer (blurred plate + sharp keep region)
   TrackerRef interpolates persisted TrackSubject at playhead — no browser re-track
→ [WAVE7 ColorPipeline] CSS for lift/gamma/gain/offset/temp/tint/contrast/sat
   RGB/luma curves via SVG feComponentTransfer (not CSS hue)
   LUT labeled RENDER-ACCURATE / PREVIEW APPROXIMATE (no fake cube)
   luma qualifier SHOW MASK from actual low/high/softness/invert coverage
   BEFORE = ungraded; AFTER = current pipeline preview
→ captions/titles overlays (Slice C, unchanged)
→ dissolve dual-video (unchanged)
clip volume/pan + track volume/pan/mute/solo via Web Audio Gain+StereoPanner
pan automation: linear interpolateAutomation on StereoPanner when playing
EQ / compressor / limiter / buses: RENDER-CANONICAL (not a browser DAW)
`.trim()

export const UNIFIED_RENDER_TRACE = `
timeline traversal → clip trim/reverse/speed/freeze → geometry/crop/transform
→ Phase-1 ColorGrade look → [WAVE6 EffectGraph FFmpeg] → opacity/dissolve
→ track xfade/overlay → [WAVE6 ColorPipeline FFmpeg + qualifier maskedmerge + LUT]
→ titles/logos → ASS captions → [vout]
clip audio volume/pan/fade/duck → [WAVE6 AudioGraph channel/submix/master] → [aout]
`.trim()

export const HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT: FidelityRow[] = [
  { capability: 'clip.transform x/y/scale/opacity', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS % translate/scale', deliver: 'FFmpeg scale/overlay pixels', note: 'Same authored numbers. Letterbox vs canvas may differ within GEOMETRY_TOLERANCE_FRACTION.' },
  { capability: 'clip.crop', classification: 'PREVIEW_APPROXIMATION', preview: 'object-position / follow crop', deliver: 'FFmpeg crop', note: 'Virtual camera 9:16 is CSS cover, not pixel crop.' },
  { capability: 'clip.opacity', classification: 'EXACT', preview: 'CSS opacity', deliver: 'colorchannelmixer/alpha', note: 'Same 0..1 value.' },
  { capability: 'EffectGraph MediaIn', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'Program video of bound clip asset', deliver: 'FFmpeg -i original', note: 'Same AssetRecord. Proxy in Program, original in Deliver.' },
  { capability: 'EffectGraph Transform', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS from nx/ny/scale/opacity', deliver: 'scale+overlay from same params', note: 'Normalized coordinates. Pixel bounds within 3% of frame.' },
  { capability: 'EffectGraph Mask rectangle', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS clip-path inset', deliver: 'geq alpha', note: 'x/y/width/height/feather/invert. Feather is PREVIEW_APPROXIMATION (CSS cannot geq-feather).' },
  { capability: 'EffectGraph Mask ellipse', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS clip-path ellipse', deliver: 'geq ellipse', note: 'center/radius. Not roto. Feather PREVIEW_APPROXIMATION.' },
  { capability: 'Mask invert (no blur)', classification: 'PREVIEW_APPROXIMATION', preview: 'keep-region clip on sharp plate', deliver: 'geq invert', note: 'CSS cannot punch a hole; invert+blur uses dual-layer analog.' },
  { capability: 'EffectGraph Merge', classification: 'PREVIEW_APPROXIMATION', preview: 'FG overlay layer when two MediaIns', deliver: 'FFmpeg overlay', note: 'Not a compositor runtime.' },
  { capability: 'EffectGraph Blur', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS filter:blur(radius px) if enabled', deliver: 'gblur=sigma', note: 'Disabled/bypass must not fake blur. Radius units differ (px vs sigma) — directional.' },
  { capability: 'EffectGraph TrackerRef', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'interpolateSubject at playhead', deliver: 'piecewise overlay/geq from same keyframes', note: 'Persisted TrackSubject only. No browser re-track.' },
  { capability: 'ColorPipeline node order', classification: 'EXACT', preview: 'nodes[] authoring order', deliver: 'nodes[] authoring order', note: 'No hidden reorder.' },
  { capability: 'lift / gamma / gain', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS + SVG gamma/offset', deliver: 'colorbalance + eq=gamma', note: 'Same params. Not pixel identity.' },
  { capability: 'offset / temp / tint / contrast / pivot / sat', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'CSS filter from ColorPipeline', deliver: 'eq/colorbalance', note: 'Direction (cooler/darker/more sat) must agree.' },
  { capability: 'RGB curves', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'SVG feComponentTransfer table', deliver: 'curves=r/g/b', note: 'CSS cannot represent RGB curves; SVG table is the preview path. Not CSS-only.' },
  { capability: 'luma curve', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'SVG feFuncR/G/B same table', deliver: 'curves=all', note: 'Same points.' },
  { capability: 'LUT .cube', classification: 'RENDER_ONLY', preview: 'label RENDER-ACCURATE / PREVIEW APPROXIMATE', deliver: 'lut3d', note: 'Do not fake cube fidelity in CSS. Node still-path may sample cube in validators only.' },
  { capability: 'luma qualifier', classification: 'PREVIEW_APPROXIMATION', preview: 'canvas/SVG coverage from same low/high/softness/invert', deliver: 'maskedmerge + geq', note: 'Not real-time maskedmerge. Frame-based or labeled APPROX.' },
  { capability: 'SHOW MASK', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'grayscale overlay from actual qualifier coverage', deliver: 'FFmpeg mask still', note: 'Not decorative. Derived from thresholds.' },
  { capability: 'Color BEFORE/AFTER', classification: 'EXACT', preview: 'BEFORE=ungraded AFTER=pipeline preview', deliver: 'source vs graded stills', note: 'AFTER uses Program ColorPipeline preview.' },
  { capability: 'clip volume', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'Web Audio GainNode', deliver: 'volume filter', note: 'Same authored gain. Classified PREVIEW in AUDIO_PREVIEW_CLASSIFICATION.' },
  { capability: 'clip pan', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'StereoPannerNode', deliver: 'pan filter', note: 'Same -1..1. PREVIEW in audio honesty table.' },
  { capability: 'track volume / pan / mute / solo', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'GainNode + StereoPanner + mute/solo law', deliver: 'AudioGraph channel', note: 'Not full bus routing. PREVIEW in audio honesty table.' },
  { capability: 'EQ', classification: 'RENDER_ONLY', preview: 'not executed', deliver: 'equalizer/highpass', note: 'HTMLMediaElement is not a DAW. RENDER-CANONICAL.' },
  { capability: 'compressor', classification: 'RENDER_ONLY', preview: 'not executed', deliver: 'acompressor', note: 'RENDER-CANONICAL.' },
  { capability: 'limiter', classification: 'RENDER_ONLY', preview: 'not executed', deliver: 'alimiter level=0', note: 'RENDER-CANONICAL.' },
  { capability: 'buses', classification: 'RENDER_ONLY', preview: 'not executed', deliver: 'channel→submix→master', note: 'RENDER-CANONICAL.' },
  { capability: 'pan automation', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'linear interpolate on StereoPanner', deliver: 'volume expression pan', note: 'Same keyframes. PREVIEW in audio honesty table.' },
  { capability: 'volume automation', classification: 'RENDER_ONLY', preview: 'not in Web Audio this wave', deliver: 'volume expr', note: 'Honest PARTIAL / RENDER-CANONICAL.' },
  { capability: 'captions / titles', classification: 'EXACT', preview: 'DOM overlays', deliver: 'ASS / raster overlay', note: 'Slice C preserved. Not re-graded in preview.' },
  { capability: 'dissolve', classification: 'DIRECTIONALLY_EQUIVALENT', preview: 'dual-video opacity', deliver: 'xfade CFR', note: 'Timing preserved. Dual-video Program dissolve must not regress.' },
  { capability: 'speed / reverse / freeze', classification: 'EXACT', preview: 'Phase-1 playback-clock', deliver: 'setpts/areverse/loop', note: 'No Wave-7 regression.' },
  { capability: 'Glow / Placeholder / ColorCorrect nodes', classification: 'UNSUPPORTED', preview: 'ignored', deliver: 'ignored', note: 'Not executable this wave.' },
  { capability: 'EffectGraph Keyer chroma key', classification: 'RENDER_ONLY', preview: 'label only', deliver: 'FFmpeg chromakey', note: 'CSS cannot chromakey. Program shows source. Deliver is canonical.' },
  { capability: 'EffectGraph blend modes', classification: 'RENDER_ONLY', preview: 'opacity overlay approx', deliver: 'FFmpeg blend=all_mode', note: 'normal/multiply/screen/overlay/addition only.' },
  { capability: 'HSL qualifier', classification: 'RENDER_ONLY', preview: 'SHOW MASK still from FFmpeg geq', deliver: 'maskedmerge + HSL geq', note: 'Not CSS. Hue-vs-Hue curves not claimed.' },
  { capability: 'Audio gate / delay / reverb', classification: 'RENDER_ONLY', preview: 'not executed', deliver: 'agate / aecho', note: 'De-esser not installed.' },
  { capability: 'Loudness LUFS', classification: 'RENDER_ONLY', preview: 'not a fake meter', deliver: 'ebur128', note: 'Never auto-normalize.' },
]

/** Audio honesty uses the contract vocabulary the Wave-7 brief asked for. */
export const AUDIO_PREVIEW_CLASSIFICATION = [
  { capability: 'clip.volume', class: 'PREVIEW' as const, note: 'GainNode from clip.volume' },
  { capability: 'clip.pan', class: 'PREVIEW' as const, note: 'StereoPannerNode from clip.pan' },
  { capability: 'track.volume', class: 'PREVIEW' as const, note: 'AudioGraph channel.volume into GainNode' },
  { capability: 'track.pan', class: 'PREVIEW' as const, note: 'channel.pan added into StereoPanner' },
  { capability: 'mute', class: 'PREVIEW' as const, note: 'gain 0' },
  { capability: 'solo', class: 'PREVIEW' as const, note: 'non-soloed tracks gain 0 when any solo is on' },
  { capability: 'eq', class: 'RENDER-CANONICAL' as const, note: 'not in Web Audio' },
  { capability: 'compressor', class: 'RENDER-CANONICAL' as const, note: 'not in Web Audio' },
  { capability: 'limiter', class: 'RENDER-CANONICAL' as const, note: 'not in Web Audio' },
  { capability: 'buses', class: 'RENDER-CANONICAL' as const, note: 'not in Web Audio' },
  { capability: 'pan automation', class: 'PREVIEW' as const, note: 'linear keyframes on StereoPanner' },
  { capability: 'volume automation', class: 'PARTIAL' as const, note: 'not previewed this wave' },
]

export const LUT_PREVIEW_HONESTY = 'RENDER-ACCURATE / PREVIEW APPROXIMATE'

export type PreviewQuality = 'fast' | 'accurate'

export type ProgramLook = {
  ok: boolean
  error: string | null
  quality: PreviewQuality
  clipFilterCss: string
  colorCss: string
  svgFilterId: string
  svgFilterMarkup: string
  blurPx: number
  invertBlur: boolean
  clipPath: string | null
  transformCss: string
  opacity: number
  mask: MaskParams | null
  maskCenter: { x: number; y: number } | null
  trackerFollows: boolean
  showQualifierMask: boolean
  qualifier: LumaQualifierParams | null
  lutHonesty: string | null
  labels: Array<'PREVIEW' | 'APPROX' | 'RENDER-CANONICAL'>
  nodeOrder: string[]
  effectTransform: TransformParams | null
}

export type ProgramAudioPreview = {
  gain: number
  pan: number
  muted: boolean
  soloSilenced: boolean
  panAutomation: boolean
  labels: Array<'PREVIEW' | 'APPROX' | 'RENDER-CANONICAL'>
}

function isPassthroughGraph(graph: HvsEffectGraph): boolean {
  const enabled = graph.nodes.filter(n => n.enabled !== false)
  return enabled.every(n => n.kind === 'MediaIn' || n.kind === 'MediaOut') && enabled.some(n => n.kind === 'MediaIn')
}

function graphBindsToAsset(graph: HvsEffectGraph, assetId: string): boolean {
  const ins = graph.nodes.filter(n => n.kind === 'MediaIn' && n.enabled !== false)
  const bg = ins.find(n => n.parameters.role === 'background') ?? ins[0]
  return Boolean(bg && bg.parameters.assetId === assetId)
}

export function readBlurParams(node: { enabled?: boolean; parameters: Record<string, unknown> } | undefined): { enabled: boolean; radius: number; bypass: boolean } {
  if (!node || node.enabled === false) return { enabled: false, radius: 0, bypass: true }
  const r = node.parameters.radius
  const radius = typeof r === 'number' && Number.isFinite(r) ? Math.max(0, r) : 0
  const enabledFlag = node.parameters.enabled === false
  return { enabled: radius > 0 && !enabledFlag, radius, bypass: false }
}

export function maskKeepPreviewCss(params: MaskParams): string {
  return maskPreviewCss({ ...params, invert: false })
}

export function effectTransformToNormalizedCss(params: TransformParams): string {
  return `translate(${params.nx * 100}%, ${params.ny * 100}%) scale(${params.scaleX}, ${params.scaleY}) rotate(${params.rotationDeg}deg)`
}

export function evalCurve(pts: ColorCurve, x: number): number {
  if (!Array.isArray(pts) || pts.length < 1) return x
  const s = [...pts].filter(p => Number.isFinite(p.input) && Number.isFinite(p.output)).sort((a, b) => a.input - b.input)
  if (!s.length) return x
  if (x <= s[0].input) return s[0].output
  const last = s[s.length - 1]
  if (x >= last.input) return last.output
  for (let i = 0; i < s.length - 1; i++) {
    if (x <= s[i + 1].input) {
      const span = Math.max(1e-6, s[i + 1].input - s[i].input)
      const u = (x - s[i].input) / span
      return s[i].output + (s[i + 1].output - s[i].output) * u
    }
  }
  return last.output
}

export function lumaQualifierCoverage01(luma01: number, q: LumaQualifierParams): number {
  const L = Math.max(0, Math.min(1, luma01))
  let cover: number
  if (q.softness < 0.001) {
    cover = L >= q.low && L <= q.high ? 1 : 0
  } else {
    const s = Math.max(0.0001, q.softness)
    const a = Math.min(1, Math.max(0, (L - (q.low - s)) / s))
    const b = Math.min(1, Math.max(0, ((q.high + s) - L) / s))
    cover = a * b
  }
  return q.invert ? 1 - cover : cover
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function luma01(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function applyGradeNode(r: number, g: number, b: number, type: string, params: Record<string, unknown>): [number, number, number] {
  if (type === 'offset') {
    const off = typeof params.offset === 'number' ? params.offset : 0
    return [clamp01(r + off), clamp01(g + off), clamp01(b + off)]
  }
  if (type === 'contrast-pivot') {
    const contrast = typeof params.contrast === 'number' ? params.contrast : 0
    const pivot = typeof params.pivot === 'number' ? params.pivot : 0.5
    const c = 1 + contrast
    return [
      clamp01((r - pivot) * c + pivot),
      clamp01((g - pivot) * c + pivot),
      clamp01((b - pivot) * c + pivot),
    ]
  }
  if (type === 'saturation') {
    const sat = 1 + (typeof params.saturation === 'number' ? params.saturation : 0)
    const y = luma01(r, g, b)
    return [
      clamp01(y + (r - y) * sat),
      clamp01(y + (g - y) * sat),
      clamp01(y + (b - y) * sat),
    ]
  }
  if (type === 'temp-tint') {
    const temp = typeof params.temperature === 'number' ? params.temperature : 0
    const tint = typeof params.tint === 'number' ? params.tint : 0
    return [
      clamp01(r + temp * 0.28),
      clamp01(g + tint * 0.18),
      clamp01(b - temp * 0.22),
    ]
  }
  if (type === 'lift-gamma-gain') {
    const lift = Array.isArray(params.lift) ? params.lift as number[] : [0, 0, 0]
    const gamma = Array.isArray(params.gamma) ? params.gamma as number[] : [1, 1, 1]
    const gain = Array.isArray(params.gain) ? params.gain as number[] : [1, 1, 1]
    const gx = Math.max(0.05, Number(gamma[0] ?? 1) || 1)
    const gy = Math.max(0.05, Number(gamma[1] ?? 1) || 1)
    const gz = Math.max(0.05, Number(gamma[2] ?? 1) || 1)
    const rr = clamp01((r * Number(gain[0] ?? 1) + Number(lift[0] ?? 0)) ** (1 / gx))
    const gg = clamp01((g * Number(gain[1] ?? 1) + Number(lift[1] ?? 0)) ** (1 / gy))
    const bb = clamp01((b * Number(gain[2] ?? 1) + Number(lift[2] ?? 0)) ** (1 / gz))
    return [rr, gg, bb]
  }
  if (type === 'rgb-curve') {
    const rC = Array.isArray(params.r) ? params.r as ColorCurve : Array.isArray(params.curve) ? params.curve as ColorCurve : []
    const gC = Array.isArray(params.g) ? params.g as ColorCurve : rC
    const bC = Array.isArray(params.b) ? params.b as ColorCurve : rC
    return [
      rC.length >= 2 ? evalCurve(rC, r) : r,
      gC.length >= 2 ? evalCurve(gC, g) : g,
      bC.length >= 2 ? evalCurve(bC, b) : b,
    ]
  }
  if (type === 'luma-curve') {
    const curve = Array.isArray(params.curve) ? params.curve as ColorCurve : []
    if (curve.length < 2) return [r, g, b]
    const y = luma01(r, g, b)
    const y2 = evalCurve(curve, y)
    const scale = y > 1e-6 ? y2 / y : 1
    return [clamp01(r * scale), clamp01(g * scale), clamp01(b * scale)]
  }
  return [r, g, b]
}

export function applyColorPipelineToRgb(r01: number, g01: number, b01: number, pipeline: ColorPipeline): { r: number; g: number; b: number; coverage: number } {
  const srcR = clamp01(r01)
  const srcG = clamp01(g01)
  const srcB = clamp01(b01)
  let r = srcR
  let g = srcG
  let b = srcB
  const qualifierNode = pipeline.nodes.find(n => n.type === 'luma-qualifier' && n.enabled)
  for (const node of pipeline.nodes) {
    if (!node.enabled || node.type === 'luma-qualifier' || node.type === 'lut') continue
    try {
      const next = applyGradeNode(r, g, b, node.type, node.params ?? {})
      r = next[0]
      g = next[1]
      b = next[2]
    } catch {
      /* skip corrupt node — failure isolation */
    }
  }
  let coverage = 1
  if (qualifierNode) {
    const q = readLumaQualifier(qualifierNode)
    coverage = lumaQualifierCoverage01(luma01(srcR, srcG, srcB), q)
    r = srcR + (r - srcR) * coverage
    g = srcG + (g - srcG) * coverage
    b = srcB + (b - srcB) * coverage
  }
  return { r, g, b, coverage }
}

export function applyColorPipelineToPixels(rgb: Uint8Array | Buffer, pipeline: ColorPipeline): { meanR: number; meanG: number; meanB: number; meanCoverage: number } {
  let r = 0
  let g = 0
  let b = 0
  let cover = 0
  const n = Math.floor(rgb.length / 3)
  for (let i = 0; i < n; i++) {
    const o = i * 3
    const out = applyColorPipelineToRgb(rgb[o] / 255, rgb[o + 1] / 255, rgb[o + 2] / 255, pipeline)
    r += out.r
    g += out.g
    b += out.b
    cover += out.coverage
  }
  if (!n) return { meanR: 0, meanG: 0, meanB: 0, meanCoverage: 0 }
  return { meanR: (r / n) * 255, meanG: (g / n) * 255, meanB: (b / n) * 255, meanCoverage: cover / n }
}

function curveTableValues(pts: ColorCurve, steps = 8): string {
  const values: string[] = []
  for (let i = 0; i <= steps; i++) values.push(evalCurve(pts, i / steps).toFixed(4))
  return values.join(' ')
}

export function colorPipelineSvgFilter(pipeline: ColorPipeline, id = 'hvs-color-pipe'): { id: string; markup: string; css: string } {
  const funcs: string[] = []
  let rTable: string | null = null
  let gTable: string | null = null
  let bTable: string | null = null
  let amp = [1, 1, 1]
  let exp = [1, 1, 1]
  let off = [0, 0, 0]
  for (const node of pipeline.nodes) {
    if (!node.enabled) continue
    if (node.type === 'rgb-curve') {
      const rC = Array.isArray(node.params.r) ? node.params.r as ColorCurve : []
      const gC = Array.isArray(node.params.g) ? node.params.g as ColorCurve : []
      const bC = Array.isArray(node.params.b) ? node.params.b as ColorCurve : []
      const all = Array.isArray(node.params.curve) ? node.params.curve as ColorCurve : []
      if (rC.length >= 2) rTable = curveTableValues(rC)
      if (gC.length >= 2) gTable = curveTableValues(gC)
      if (bC.length >= 2) bTable = curveTableValues(bC)
      if (!rTable && !gTable && !bTable && all.length >= 2) {
        const t = curveTableValues(all)
        rTable = t
        gTable = t
        bTable = t
      }
    }
    if (node.type === 'luma-curve') {
      const curve = Array.isArray(node.params.curve) ? node.params.curve as ColorCurve : []
      if (curve.length >= 2) {
        const t = curveTableValues(curve)
        rTable = t
        gTable = t
        bTable = t
      }
    }
    if (node.type === 'lift-gamma-gain') {
      const lift = Array.isArray(node.params.lift) ? node.params.lift as number[] : [0, 0, 0]
      const gamma = Array.isArray(node.params.gamma) ? node.params.gamma as number[] : [1, 1, 1]
      const gain = Array.isArray(node.params.gain) ? node.params.gain as number[] : [1, 1, 1]
      amp = [Number(gain[0] ?? 1), Number(gain[1] ?? 1), Number(gain[2] ?? 1)]
      exp = [1 / Math.max(0.05, Number(gamma[0] ?? 1)), 1 / Math.max(0.05, Number(gamma[1] ?? 1)), 1 / Math.max(0.05, Number(gamma[2] ?? 1))]
      off = [Number(lift[0] ?? 0), Number(lift[1] ?? 0), Number(lift[2] ?? 0)]
    }
  }
  if (rTable || gTable || bTable) {
    funcs.push(`<feFuncR type="table" tableValues="${rTable ?? '0 1'}"/>`)
    funcs.push(`<feFuncG type="table" tableValues="${gTable ?? '0 1'}"/>`)
    funcs.push(`<feFuncB type="table" tableValues="${bTable ?? '0 1'}"/>`)
  } else if (amp.some(v => Math.abs(v - 1) > 0.001) || exp.some(v => Math.abs(v - 1) > 0.001) || off.some(v => Math.abs(v) > 0.001)) {
    funcs.push(`<feFuncR type="gamma" amplitude="${amp[0]}" exponent="${exp[0]}" offset="${off[0]}"/>`)
    funcs.push(`<feFuncG type="gamma" amplitude="${amp[1]}" exponent="${exp[1]}" offset="${off[1]}"/>`)
    funcs.push(`<feFuncB type="gamma" amplitude="${amp[2]}" exponent="${exp[2]}" offset="${off[2]}"/>`)
  }
  if (!funcs.length) return { id, markup: '', css: '' }
  const markup = `<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${funcs.join('')}</feComponentTransfer></filter>`
  return { id, markup, css: `url(#${id})` }
}

export function resolvedMaskAt(graph: HvsEffectGraph, project: HvsProject, atSec: number): MaskParams | null {
  const maskNode = graph.nodes.find(n => n.kind === 'Mask' && n.enabled !== false)
  if (!maskNode) return null
  const trackerNode = graph.nodes.find(n => n.kind === 'TrackerRef' && n.enabled !== false)
  const subjectId = (typeof maskNode.parameters.subjectId === 'string' ? maskNode.parameters.subjectId : null)
    ?? (typeof trackerNode?.parameters.subjectId === 'string' ? trackerNode.parameters.subjectId : null)
  const subject = subjectId ? project.timeline.subjects.find(s => s.id === subjectId) : undefined
  let box: { x: number; y: number; width: number; height: number } | null = null
  if (subject) {
    const ts = project.timeline.timescale || 24000
    box = interpolateSubject(subject, Math.round(atSec * ts), ts)
  }
  return readMaskParams(maskNode, box)
}

function identityLook(quality: PreviewQuality, error: string | null): ProgramLook {
  return {
    ok: !error,
    error,
    quality,
    clipFilterCss: 'none',
    colorCss: '',
    svgFilterId: 'hvs-color-pipe',
    svgFilterMarkup: '',
    blurPx: 0,
    invertBlur: false,
    clipPath: null,
    transformCss: '',
    opacity: 1,
    mask: null,
    maskCenter: null,
    trackerFollows: false,
    showQualifierMask: false,
    qualifier: null,
    lutHonesty: null,
    labels: ['PREVIEW'],
    nodeOrder: [],
    effectTransform: null,
  }
}

export function programLookAt(project: HvsProject, atSec: number, opts?: { quality?: PreviewQuality; clip?: Clip | null }): ProgramLook {
  const quality = opts?.quality ?? 'accurate'
  try {
    const clip = opts?.clip ?? null
    const labels: ProgramLook['labels'] = ['PREVIEW']
    const pipeline = identityColorPipelineOr(project.colorPipeline)
    const nodeOrder = pipeline.nodes.filter(n => n.enabled).map(n => n.type)
    const colorCss = colorPipelineToPreviewCss(pipeline)
    const svg = quality === 'accurate' ? colorPipelineSvgFilter(pipeline) : { id: 'hvs-color-pipe', markup: '', css: '' }
    const lutNode = pipeline.nodes.find(n => n.type === 'lut' && n.enabled)
    const qualifierNode = pipeline.nodes.find(n => n.type === 'luma-qualifier' && n.enabled)
    const qualifier = qualifierNode ? readLumaQualifier(qualifierNode) : null
    const showQualifierMask = Boolean(qualifier && qualifierNode?.params.showMask === true)
    if (lutNode) labels.push('RENDER-CANONICAL')
    if (qualifier) labels.push('APPROX')
    if (pipeline.nodes.some(n => n.enabled && (n.type === 'rgb-curve' || n.type === 'luma-curve'))) labels.push('APPROX')

    let blurPx = 0
    let invertBlur = false
    let clipPath: string | null = null
    let mask: MaskParams | null = null
    let maskCenter: { x: number; y: number } | null = null
    let trackerFollows = false
    let effectTransform: TransformParams | null = null
    let extraTransform = ''
    let extraOpacity = 1

    const assetId = clip?.assetId
    const graph = (project.effectGraphs ?? []).find(g => !isPassthroughGraph(g) && (!assetId || graphBindsToAsset(g, assetId)))
      ?? (project.effectGraphs ?? []).find(g => !isPassthroughGraph(g))
    if (graph) {
      const xf = graph.nodes.find(n => n.kind === 'Transform' && n.enabled !== false)
      if (xf) {
        effectTransform = readTransformParams(xf)
        extraTransform = effectTransformToNormalizedCss(effectTransform)
        extraOpacity = effectTransform.opacity
      }
      const blur = readBlurParams(graph.nodes.find(n => n.kind === 'Blur'))
      if (blur.enabled) blurPx = blur.radius
      mask = resolvedMaskAt(graph, project, atSec)
      const trackerNode = graph.nodes.find(n => n.kind === 'TrackerRef' && n.enabled !== false)
      trackerFollows = Boolean(trackerNode && mask?.subjectId)
      if (mask) {
        maskCenter = { x: mask.centerX, y: mask.centerY }
        invertBlur = Boolean(blur.enabled && mask.invert)
        clipPath = invertBlur || !mask.invert ? maskKeepPreviewCss(mask) : maskKeepPreviewCss(mask)
        labels.push('APPROX')
      }
    }

    const clipFilterCss = clip ? composeProgramLookCss(clip.color, clip.filters) : 'none'
    let transformCss = extraTransform
    let opacity = extraOpacity
    if (clip) {
      const clipXf = `translate(${clip.transform.x * 100}%, ${clip.transform.y * 100}%) scale(${clip.transform.scaleX}) rotate(${clip.transform.rotation}deg)`
      transformCss = extraTransform ? `${clipXf} ${extraTransform}` : clipXf
      opacity = (clip.opacity ?? 1) * extraOpacity
    }

    return {
      ok: true,
      error: null,
      quality,
      clipFilterCss,
      colorCss,
      svgFilterId: svg.id,
      svgFilterMarkup: svg.markup,
      blurPx,
      invertBlur,
      clipPath,
      transformCss,
      opacity,
      mask,
      maskCenter,
      trackerFollows,
      showQualifierMask,
      qualifier,
      lutHonesty: lutNode ? LUT_PREVIEW_HONESTY : null,
      labels: [...new Set(labels)],
      nodeOrder,
      effectTransform,
    }
  } catch (error) {
    return identityLook(quality, error instanceof Error ? error.message : 'preview mapping failed')
  }
}

export function composeProgramFilterCss(look: ProgramLook, compare: 'AFTER' | 'BEFORE' = 'AFTER'): string {
  if (compare === 'BEFORE') return look.clipFilterCss
  const parts = [look.clipFilterCss, look.colorCss]
  if (!look.invertBlur && look.blurPx > 0) parts.push(`blur(${look.blurPx}px)`)
  if (look.svgFilterMarkup) parts.push(`url(#${look.svgFilterId})`)
  return parts.filter(p => p && p !== 'none').join(' ') || 'none'
}

function lerpAutomation(lane: { keyframes: Array<{ time: { ticks: number; timescale: number }; value: number }> } | undefined, tSec: number): number | null {
  if (!lane || !lane.keyframes.length) return null
  const kfs = [...lane.keyframes].sort((a, b) => (a.time.ticks / a.time.timescale) - (b.time.ticks / b.time.timescale))
  if (tSec <= kfs[0].time.ticks / kfs[0].time.timescale) return kfs[0].value
  const last = kfs[kfs.length - 1]
  if (tSec >= last.time.ticks / last.time.timescale) return last.value
  for (let i = 0; i < kfs.length - 1; i++) {
    const t0 = kfs[i].time.ticks / Math.max(1, kfs[i].time.timescale)
    const t1 = kfs[i + 1].time.ticks / Math.max(1, kfs[i + 1].time.timescale)
    if (tSec <= t1) {
      const u = (tSec - t0) / Math.max(0.001, t1 - t0)
      return kfs[i].value + (kfs[i + 1].value - kfs[i].value) * u
    }
  }
  return last.value
}

export function programAudioPreviewAt(project: HvsProject, clip: Clip | null, track: Track | null, atSec: number): ProgramAudioPreview {
  try {
    const graph: AudioGraph | undefined = project.audioGraph
    const channel = track && graph ? graph.channels.find(c => c.trackId === track.id) : undefined
    const anySolo = Boolean(graph?.channels.some(c => c.solo) || track?.solo)
    const thisSolo = Boolean(channel?.solo || track?.solo)
    const muted = Boolean(channel?.mute || track?.muted || clip?.reversed || clip?.freeze)
    const soloSilenced = anySolo && !thisSolo
    const clipVol = clip && Number.isFinite(clip.volume) ? Math.max(0, clip.volume) : 1
    const trackVol = channel && Number.isFinite(channel.volume) ? Math.max(0, channel.volume) : 1
    const gain = muted || soloSilenced ? 0 : clipVol * trackVol
    const clipPan = clip && Number.isFinite(clip.pan) ? clip.pan : 0
    const trackPan = channel && Number.isFinite(channel.pan) ? channel.pan : 0
    const panLane = channel && graph ? graph.automation.find(a => a.target === channel.id && a.param === 'pan') : undefined
    const autoPan = lerpAutomation(panLane, atSec)
    const pan = Math.max(-1, Math.min(1, clipPan + trackPan + (autoPan ?? 0)))
    return {
      gain,
      pan,
      muted,
      soloSilenced,
      panAutomation: autoPan != null,
      labels: ['PREVIEW', 'RENDER-CANONICAL'],
    }
  } catch {
    return { gain: 1, pan: 0, muted: false, soloSilenced: false, panAutomation: false, labels: ['PREVIEW'] }
  }
}

export function geometryAgreement(previewNx: number, previewNy: number, renderNx: number, renderNy: number): { dx: number; dy: number; ok: boolean } {
  const dx = Math.abs(previewNx - renderNx)
  const dy = Math.abs(previewNy - renderNy)
  return { dx, dy, ok: dx <= GEOMETRY_TOLERANCE_FRACTION && dy <= GEOMETRY_TOLERANCE_FRACTION }
}

export function colorDirectionAgree(before: { meanR: number; meanG: number; meanB: number }, afterPreview: { meanR: number; meanG: number; meanB: number }, afterRender: { meanR: number; meanG: number; meanB: number }): { ok: boolean; notes: string[] } {
  const notes: string[] = []
  const sign = (a: number, b: number) => (b - a >= COLOR_DIRECTION_MIN_DELTA ? 1 : b - a <= -COLOR_DIRECTION_MIN_DELTA ? -1 : 0)
  for (const ch of ['meanR', 'meanG', 'meanB'] as const) {
    const p = sign(before[ch], afterPreview[ch])
    const r = sign(before[ch], afterRender[ch])
    if (p !== 0 && r !== 0 && p !== r) notes.push(`${ch} preview ${p} vs render ${r}`)
  }
  return { ok: notes.length === 0, notes }
}

export function programPreviewMismatches(): string[] {
  return HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT
    .filter(row => row.classification === 'RENDER_ONLY' || row.classification === 'PREVIEW_APPROXIMATION' || row.classification === 'UNSUPPORTED')
    .map(row => `${row.capability}: ${row.classification} — ${row.note}`)
}

export function contractClassification(capability: string): FidelityClass | null {
  return HVS_PROGRAM_DELIVER_FIDELITY_CONTRACT.find(r => r.capability === capability)?.classification ?? null
}

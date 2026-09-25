/**
 * Phase-5 ColorPipeline. Extends — does not replace — clip ColorGrade.
 * OCIO / ACES / HDR are not claimed WORKING.
 */
import { colorGradeToCss, colorGradeToFfmpeg } from './look-lowering'

type ThinGrade = {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  lookId: string | null
}

export const COLOR_PIPELINE_SCHEMA = 1 as const

export const COLOR_NODE_TYPES = [
  'lift-gamma-gain',
  'offset',
  'temp-tint',
  'contrast-pivot',
  'saturation',
  'rgb-curve',
  'luma-curve',
  'lut',
  'luma-qualifier',
  'hsl-qualifier',
] as const

export type ColorNodeType = (typeof COLOR_NODE_TYPES)[number]

export type ColorCurve = { input: number; output: number }[]

export type ColorNode = {
  id: string
  type: ColorNodeType
  enabled: boolean
  params: Record<string, unknown>
}

export type ColorPipeline = {
  schemaVersion: typeof COLOR_PIPELINE_SCHEMA
  nodes: ColorNode[]
  outputColorSpace: 'display-referred' | 'unspecified'
}

export function emptyColorPipeline(): ColorPipeline {
  return { schemaVersion: COLOR_PIPELINE_SCHEMA, nodes: [], outputColorSpace: 'unspecified' }
}

export type ColorPipelineValidation = { ok: boolean; errors: string[] }

function finiteNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function validateColorPipeline(pipeline: ColorPipeline, lutAssetIds?: Set<string>): ColorPipelineValidation {
  const errors: string[] = []
  try {
    if (!pipeline || pipeline.schemaVersion !== COLOR_PIPELINE_SCHEMA) errors.push('Unknown color pipeline schema.')
    const ids = new Set<string>()
    for (const [index, node] of (pipeline.nodes ?? []).entries()) {
      if (!node?.id) errors.push(`Node ${index} missing id.`)
      else if (ids.has(node.id)) errors.push(`Duplicate color node id ${node.id}.`)
      else ids.add(node.id)
      if (!COLOR_NODE_TYPES.includes(node.type)) errors.push(`Unknown color node type ${String(node.type)}.`)
      if (node.type === 'lift-gamma-gain') {
        for (const key of ['lift', 'gamma', 'gain'] as const) {
          const triple = node.params[key]
          if (triple != null && (!Array.isArray(triple) || triple.length !== 3 || triple.some(n => typeof n !== 'number' || !Number.isFinite(n)))) {
            errors.push(`${node.id}.${key} must be three finite numbers.`)
          }
        }
      }
      if (node.type === 'offset' && node.params.offset != null && !finiteNumber(node.params.offset, -2, 2)) errors.push(`${node.id}.offset out of range.`)
      if (node.type === 'temp-tint') {
        if (node.params.temperature != null && !finiteNumber(node.params.temperature, -1, 1)) errors.push(`${node.id}.temperature out of range.`)
        if (node.params.tint != null && !finiteNumber(node.params.tint, -1, 1)) errors.push(`${node.id}.tint out of range.`)
      }
      if (node.type === 'contrast-pivot') {
        if (node.params.contrast != null && !finiteNumber(node.params.contrast, -1, 3)) errors.push(`${node.id}.contrast out of range.`)
        if (node.params.pivot != null && !finiteNumber(node.params.pivot, 0, 1)) errors.push(`${node.id}.pivot out of range.`)
      }
      if (node.type === 'saturation' && node.params.saturation != null && !finiteNumber(node.params.saturation, -1, 3)) {
        errors.push(`${node.id}.saturation out of range.`)
      }
      if (node.type === 'rgb-curve' || node.type === 'luma-curve') {
        const curves = [node.params.curve, node.params.r, node.params.g, node.params.b]
        for (const curve of curves) {
          if (curve && (!Array.isArray(curve) || (curve as ColorCurve).some(p => !finiteNumber(p.input, 0, 1) || !finiteNumber(p.output, 0, 1)))) {
            errors.push(`${node.id} curve points must be 0..1.`)
          }
        }
      }
      if (node.type === 'lut') {
        const assetId = node.params.assetId
        if (typeof assetId === 'string' && lutAssetIds && !lutAssetIds.has(assetId)) {
          errors.push(`${node.id} LUT asset ${assetId} is not in the project.`)
        }
      }
      if (node.type === 'luma-qualifier' || node.type === 'hsl-qualifier') {
        if (node.params.low != null && !finiteNumber(node.params.low, 0, 1)) errors.push(`${node.id}.low out of range.`)
        if (node.params.high != null && !finiteNumber(node.params.high, 0, 1)) errors.push(`${node.id}.high out of range.`)
        if (node.params.softness != null && !finiteNumber(node.params.softness, 0, 1)) errors.push(`${node.id}.softness out of range.`)
        if (node.params.invert != null && typeof node.params.invert !== 'boolean') errors.push(`${node.id}.invert must be boolean.`)
        if (node.type === 'hsl-qualifier') {
          if (node.params.hueLow != null && !finiteNumber(node.params.hueLow, 0, 360)) errors.push(`${node.id}.hueLow out of range.`)
          if (node.params.hueHigh != null && !finiteNumber(node.params.hueHigh, 0, 360)) errors.push(`${node.id}.hueHigh out of range.`)
          if (node.params.satLow != null && !finiteNumber(node.params.satLow, 0, 1)) errors.push(`${node.id}.satLow out of range.`)
          if (node.params.satHigh != null && !finiteNumber(node.params.satHigh, 0, 1)) errors.push(`${node.id}.satHigh out of range.`)
          if (node.params.lumaLow != null && !finiteNumber(node.params.lumaLow, 0, 1)) errors.push(`${node.id}.lumaLow out of range.`)
          if (node.params.lumaHigh != null && !finiteNumber(node.params.lumaHigh, 0, 1)) errors.push(`${node.id}.lumaHigh out of range.`)
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Color pipeline validation failed.')
  }
  return { ok: errors.length === 0, errors }
}

export const WAVE2_EXECUTABLE_COLOR_NODES: ColorNodeType[] = [
  'lift-gamma-gain',
  'offset',
  'temp-tint',
  'contrast-pivot',
  'saturation',
]

export const WAVE3_EXECUTABLE_COLOR_NODES: ColorNodeType[] = [
  ...WAVE2_EXECUTABLE_COLOR_NODES,
  'luma-curve',
  'rgb-curve',
]

export const WAVE4_EXECUTABLE_COLOR_NODES: ColorNodeType[] = [
  ...WAVE3_EXECUTABLE_COLOR_NODES,
  'luma-qualifier',
  'lut',
]

export const WAVE5_EXECUTABLE_COLOR_NODES = WAVE4_EXECUTABLE_COLOR_NODES

export const WAVE9_EXECUTABLE_COLOR_NODES: ColorNodeType[] = [
  ...WAVE5_EXECUTABLE_COLOR_NODES,
  'hsl-qualifier',
]

/** Nodes execute in ColorPipeline.nodes[] authoring order. No hidden canonical reorder. */
export const COLOR_PIPELINE_EXECUTION_ORDER = 'authoring-order' as const

export const QUALIFIER_PREVIEW_NOTE =
  'HSL qualifier executes in FFmpeg geq. Program preview uses the same coverage when SHOW MASK is on. Hue-vs-Hue curves are not claimed this wave.'

export type LumaQualifierParams = {
  low: number
  high: number
  softness: number
  invert: boolean
  enabled: boolean
}

export function readLumaQualifier(node: ColorNode | undefined): LumaQualifierParams {
  const p = node?.params ?? {}
  const num = (key: string, fallback: number) => {
    const v = p[key]
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback
  }
  return {
    low: num('low', 0.15),
    high: num('high', 0.7),
    softness: num('softness', 0.08),
    invert: p.invert === true,
    enabled: node?.enabled !== false,
  }
}

function curvePointsExpr(curve: ColorCurve): string | null {
  const pts = [...curve].filter(p => Number.isFinite(p.input) && Number.isFinite(p.output)).sort((a, b) => a.input - b.input)
  if (pts.length < 2) return null
  return pts.map(p => `${p.input.toFixed(4)}/${p.output.toFixed(4)}`).join(' ')
}

export function colorPipelineToFfmpeg(pipeline: ColorPipeline): string[] {
  const parts: string[] = []
  for (const node of pipeline.nodes) {
    if (!node.enabled) continue
    if (node.type === 'contrast-pivot') {
      const contrast = typeof node.params.contrast === 'number' ? node.params.contrast : 0
      const pivot = typeof node.params.pivot === 'number' ? node.params.pivot : 0.5
      parts.push(`eq=contrast=${(1 + contrast).toFixed(4)}:brightness=${((0.5 - pivot) * contrast * 0.25).toFixed(4)}`)
    }
    if (node.type === 'saturation') {
      const sat = typeof node.params.saturation === 'number' ? node.params.saturation : 0
      parts.push(`eq=saturation=${(1 + sat).toFixed(4)}`)
    }
    if (node.type === 'offset') {
      const off = typeof node.params.offset === 'number' ? node.params.offset : 0
      parts.push(`eq=brightness=${off.toFixed(4)}`)
    }
    if (node.type === 'temp-tint') {
      const temp = typeof node.params.temperature === 'number' ? node.params.temperature : 0
      const tint = typeof node.params.tint === 'number' ? node.params.tint : 0
      const rs = (temp * 0.28).toFixed(4)
      const bs = (-temp * 0.22).toFixed(4)
      const gs = (tint * 0.18).toFixed(4)
      parts.push(`colorbalance=rs=${rs}:gs=${gs}:bs=${bs}:rm=${rs}:bm=${bs}`)
    }
    if (node.type === 'lift-gamma-gain') {
      const lift = Array.isArray(node.params.lift) ? node.params.lift as number[] : [0, 0, 0]
      const gamma = Array.isArray(node.params.gamma) ? node.params.gamma as number[] : [1, 1, 1]
      const gain = Array.isArray(node.params.gain) ? node.params.gain as number[] : [1, 1, 1]
      const rs = Number(lift[0] ?? 0)
      const gs = Number(lift[1] ?? 0)
      const bs = Number(lift[2] ?? 0)
      const rh = Number(gain[0] ?? 1) - 1
      const gh = Number(gain[1] ?? 1) - 1
      const bh = Number(gain[2] ?? 1) - 1
      parts.push(`colorbalance=rs=${rs.toFixed(4)}:gs=${gs.toFixed(4)}:bs=${bs.toFixed(4)}:rh=${rh.toFixed(4)}:gh=${gh.toFixed(4)}:bh=${bh.toFixed(4)}`)
      const g = Number(gamma[0] ?? 1)
      if (Math.abs(g - 1) > 0.001) parts.push(`eq=gamma=${g.toFixed(4)}`)
    }
    if (node.type === 'luma-curve') {
      const curve = Array.isArray(node.params.curve) ? node.params.curve as ColorCurve : []
      const expr = curvePointsExpr(curve)
      if (expr) parts.push(`curves=all='${expr}'`)
    }
    if (node.type === 'rgb-curve') {
      const r = curvePointsExpr(Array.isArray(node.params.r) ? node.params.r as ColorCurve : [])
      const g = curvePointsExpr(Array.isArray(node.params.g) ? node.params.g as ColorCurve : [])
      const b = curvePointsExpr(Array.isArray(node.params.b) ? node.params.b as ColorCurve : [])
      const all = curvePointsExpr(Array.isArray(node.params.curve) ? node.params.curve as ColorCurve : [])
      const segs: string[] = []
      if (r) segs.push(`r='${r}'`)
      if (g) segs.push(`g='${g}'`)
      if (b) segs.push(`b='${b}'`)
      if (!r && !g && !b && all) segs.push(`all='${all}'`)
      if (segs.length) parts.push(`curves=${segs.join(':')}`)
    }
    if (node.type === 'lut') {
      const file = typeof node.params.file === 'string' ? node.params.file : null
      if (file) parts.push(`lut3d=file='${file.replace(/'/g, '')}'`)
    }
  }
  return parts
}

export function lumaQualifierMaskExpr(node: ColorNode): string | null {
  if (node.type !== 'luma-qualifier' || !node.enabled) return null
  return lumaQualifierCoverageExpr(readLumaQualifier(node), 'script')
}

/**
 * Luma coverage 0..1. Wave-4 filter_complex_script stored `X\,Y` which FFmpeg
 * treated as Invalid argument. Script files must use unescaped `X,Y` inside
 * quoted geq expressions. Command-line -filter_complex still needs `X\\,Y`.
 */
export function lumaQualifierCoverageExpr(q: LumaQualifierParams, mode: 'script' | 'cli'): string {
  const comma = mode === 'script' ? ',' : '\\,'
  const L = `p(X${comma}Y)/255`
  const low = q.low.toFixed(4)
  const high = q.high.toFixed(4)
  const soft = Math.max(0.0001, q.softness)
  let cover: string
  if (q.softness < 0.001) {
    cover = `between(${L}${comma}${low}${comma}${high})`
  } else {
    const s = soft.toFixed(4)
    cover = `min(max((${L}-(${low}-${s}))/${s}${comma}0)${comma}1)*min(max(((${high}+${s})-${L})/${s}${comma}0)${comma}1)`
  }
  return q.invert ? `(1-(${cover}))` : `(${cover})`
}

export type HslQualifierParams = {
  hueLow: number
  hueHigh: number
  satLow: number
  satHigh: number
  lumaLow: number
  lumaHigh: number
  softness: number
  invert: boolean
  enabled: boolean
}

export function readHslQualifier(node: ColorNode | undefined): HslQualifierParams {
  const p = node?.params ?? {}
  const num = (key: string, fallback: number, min: number, max: number) => {
    const v = p[key]
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback
  }
  return {
    hueLow: num('hueLow', 350, 0, 360),
    hueHigh: num('hueHigh', 20, 0, 360),
    satLow: num('satLow', 0.25, 0, 1),
    satHigh: num('satHigh', 1, 0, 1),
    lumaLow: num('lumaLow', 0.08, 0, 1),
    lumaHigh: num('lumaHigh', 0.95, 0, 1),
    softness: num('softness', 0.08, 0, 1),
    invert: p.invert === true,
    enabled: node?.enabled !== false,
  }
}

function bandCover(value: string, low: number, high: number, soft: number, comma: string, wrap360 = false): string {
  const s = Math.max(0.0001, soft)
  if (wrap360 && low > high) {
    const a = bandCover(value, low, 360, soft, comma, false)
    const b = bandCover(value, 0, high, soft, comma, false)
    return `max(${a}${comma}${b})`
  }
  if (soft < 0.001) return `between(${value}${comma}${low}${comma}${high})`
  return `min(max((${value}-(${low}-${s.toFixed(4)}))/${s.toFixed(4)}${comma}0)${comma}1)*min(max(((${high}+${s.toFixed(4)})-${value})/${s.toFixed(4)}${comma}0)${comma}1)`
}

export function hslQualifierCoverageExpr(q: HslQualifierParams, mode: 'script' | 'cli'): string {
  const comma = mode === 'script' ? ',' : '\\,'
  const r = `r(X${comma}Y)`
  const g = `g(X${comma}Y)`
  const b = `b(X${comma}Y)`
  const mx = `max(${r}${comma}max(${g}${comma}${b}))`
  const mn = `min(${r}${comma}min(${g}${comma}${b}))`
  const sat = `if(gt(${mx}${comma}1)${comma}(${mx}-${mn})/${mx}${comma}0)`
  const luma = `(${r}+${g}+${b})/765`
  const hueMid = q.hueLow > q.hueHigh ? ((q.hueLow + q.hueHigh + 360) / 2) % 360 : (q.hueLow + q.hueHigh) / 2
  const hueSel = hueMid < 60 || hueMid >= 300
    ? `gt(${r}${comma}${g})*gt(${r}${comma}${b})`
    : hueMid < 180
      ? `gt(${g}${comma}${r})*gt(${g}${comma}${b})`
      : `gt(${b}${comma}${r})*gt(${b}${comma}${g})`
  const cover = `(${hueSel}*${bandCover(sat, q.satLow, q.satHigh, q.softness, comma)}*${bandCover(luma, q.lumaLow, q.lumaHigh, q.softness, comma)})`
  return q.invert ? `(1-(${cover}))` : cover
}

export function buildHslQualifierFilterGraph(gradeFilters: string, q: HslQualifierParams, geometricMask?: string | null): string {
  const grade = gradeFilters.trim() || 'null'
  const cover = hslQualifierCoverageExpr(q, 'script')
  const maskEq = geometricMask
    ? `[msk]format=rgba,geq=r='255*${cover}':g='255*${cover}':b='255*${cover}'[hsl];[hsl]${geometricMask}[mask]`
    : `[msk]format=rgba,geq=r='255*${cover}':g='255*${cover}':b='255*${cover}',format=gray[mask]`
  return [
    '[0:v]split=3[src][grd][msk]',
    `[grd]${grade}[graded]`,
    maskEq,
    '[src][graded][mask]maskedmerge,format=yuv420p[out]',
  ].join(';')
}

export function buildHslQualifierMaskGraph(q: HslQualifierParams): string {
  const cover = hslQualifierCoverageExpr(q, 'script')
  return `[0:v]format=rgba,geq=r='255*${cover}':g='255*${cover}':b='255*${cover}',format=yuv420p[out]`
}

export function buildLumaQualifierFilterGraph(gradeFilters: string, q: LumaQualifierParams): string {
  const grade = gradeFilters.trim() || 'null'
  const cover = lumaQualifierCoverageExpr(q, 'script')
  return [
    '[0:v]split=3[src][grd][msk]',
    `[grd]${grade}[graded]`,
    `[msk]format=gray,geq=lum='255*${cover}'[mask]`,
    '[src][graded][mask]maskedmerge,format=yuv420p[out]',
  ].join(';')
}

export function buildLumaQualifierMaskGraph(q: LumaQualifierParams): string {
  const cover = lumaQualifierCoverageExpr(q, 'script')
  return `[0:v]format=gray,geq=lum='255*${cover}',format=yuv420p[out]`
}

export type RgbChannel = 'r' | 'g' | 'b'

function identityCurve(): ColorCurve {
  return [{ input: 0, output: 0 }, { input: 1, output: 1 }]
}

export function rgbCurvePoints(pipeline: ColorPipeline, channel: RgbChannel): ColorCurve {
  const node = pipeline.nodes.find(n => n.type === 'rgb-curve')
  const raw = node?.params[channel]
  if (!Array.isArray(raw) || raw.length < 2) return identityCurve()
  return [...(raw as ColorCurve)].sort((a, b) => a.input - b.input)
}

function withRgbCurve(pipeline: ColorPipeline, channel: RgbChannel, points: ColorCurve): ColorPipeline {
  const sorted = [...points].filter(p => Number.isFinite(p.input) && Number.isFinite(p.output)).sort((a, b) => a.input - b.input)
  const existing = pipeline.nodes.find(n => n.type === 'rgb-curve')
  const params = { ...(existing?.params ?? {}), [channel]: sorted }
  const node: ColorNode = existing
    ? { ...existing, enabled: true, params }
    : { id: 'rgb', type: 'rgb-curve', enabled: true, params }
  return {
    ...pipeline,
    nodes: existing
      ? pipeline.nodes.map(n => n.id === existing.id ? node : n)
      : [...pipeline.nodes, node],
  }
}

export function addRgbCurvePoint(pipeline: ColorPipeline, channel: RgbChannel, input: number, output: number): ColorPipeline {
  const pts = rgbCurvePoints(pipeline, channel)
  const x = Math.max(0.02, Math.min(0.98, input))
  const y = Math.max(0, Math.min(1, output))
  return withRgbCurve(pipeline, channel, [...pts.filter(p => Math.abs(p.input - x) > 0.03), { input: x, output: y }])
}

export function moveRgbCurvePoint(pipeline: ColorPipeline, channel: RgbChannel, index: number, input: number, output: number): ColorPipeline {
  const pts = rgbCurvePoints(pipeline, channel)
  if (!pts[index]) return pipeline
  const next = pts.map((p, i) => i === index
    ? { input: index === 0 ? 0 : index === pts.length - 1 ? 1 : Math.max(0, Math.min(1, input)), output: Math.max(0, Math.min(1, output)) }
    : p)
  return withRgbCurve(pipeline, channel, next)
}

export function deleteRgbCurvePoint(pipeline: ColorPipeline, channel: RgbChannel, index: number): ColorPipeline {
  const pts = rgbCurvePoints(pipeline, channel)
  if (pts.length <= 2 || index <= 0 || index >= pts.length - 1) return pipeline
  return withRgbCurve(pipeline, channel, pts.filter((_, i) => i !== index))
}

export function colorPipelineToPreviewCss(pipeline: ColorPipeline): string {
  let contrast = 1
  let saturate = 1
  let brightness = 1
  let hue = 0
  let sepia = 0
  for (const node of pipeline.nodes) {
    if (!node.enabled) continue
    if (node.type === 'contrast-pivot' && typeof node.params.contrast === 'number') contrast *= 1 + node.params.contrast
    if (node.type === 'saturation' && typeof node.params.saturation === 'number') saturate *= 1 + node.params.saturation
    if (node.type === 'offset' && typeof node.params.offset === 'number') brightness *= 1 + node.params.offset
    if (node.type === 'temp-tint') {
      const temp = typeof node.params.temperature === 'number' ? node.params.temperature : 0
      const tint = typeof node.params.tint === 'number' ? node.params.tint : 0
      hue += temp * 18 + tint * 6
      sepia += Math.max(0, -temp) * 0.12
    }
    if (node.type === 'lift-gamma-gain') {
      const lift = Array.isArray(node.params.lift) ? node.params.lift as number[] : [0, 0, 0]
      const gamma = Array.isArray(node.params.gamma) ? node.params.gamma as number[] : [1, 1, 1]
      const gain = Array.isArray(node.params.gain) ? node.params.gain as number[] : [1, 1, 1]
      brightness *= 1 + Number(lift[0] ?? 0) * 0.35 + (Number(gain[0] ?? 1) - 1) * 0.4
      contrast *= 1 + (1 - Number(gamma[0] ?? 1)) * 0.25
    }
    if (node.type === 'luma-curve') {
      const curve = Array.isArray(node.params.curve) ? node.params.curve as ColorCurve : []
      const mid = curve.find(p => Math.abs(p.input - 0.5) < 0.08)?.output
      if (typeof mid === 'number') contrast *= 1 + (mid - 0.5)
    }
  }
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia}) hue-rotate(${hue}deg)`
}

export type ColorLoweringPlan = {
  previewCss: string
  renderFilters: string[]
  pipelineFilters: string[]
  executablePhase1Grade: boolean
  executablePipeline: boolean
  ocio: false
  aces: false
  hdr: false
  notes: string[]
}

export function planColorPipelineLowering(color: ThinGrade, pipeline: ColorPipeline): ColorLoweringPlan {
  const phase1 = colorGradeToFfmpeg(color)
  const pipelineFilters = colorPipelineToFfmpeg(pipeline)
  const hasQualifier = pipeline.nodes.some(n => (n.type === 'luma-qualifier' || n.type === 'hsl-qualifier') && n.enabled)
  const executablePipeline = (pipelineFilters.length > 0 || hasQualifier) && pipeline.nodes.some(n => n.enabled && WAVE9_EXECUTABLE_COLOR_NODES.includes(n.type))
  const notes = [
    'Phase-1 ColorGrade still lowers via look-lowering.ts.',
    'Program preview CSS is derived from the same ColorPipeline values. Render uses FFmpeg, not CSS.',
    'OCIO / ACES / HDR are not claimed WORKING.',
    `ColorPipeline execution order: ${COLOR_PIPELINE_EXECUTION_ORDER}.`,
  ]
  if (hasQualifier) notes.push(QUALIFIER_PREVIEW_NOTE)
  if (!executablePipeline) notes.push('No executable ColorPipeline nodes enabled.')
  return {
    previewCss: `${colorGradeToCss(color)} ${colorPipelineToPreviewCss(pipeline)}`.trim(),
    renderFilters: [...phase1, ...pipelineFilters],
    pipelineFilters,
    executablePhase1Grade: true,
    executablePipeline,
    ocio: false,
    aces: false,
    hdr: false,
    notes,
  }
}

export function identityColorPipelineOr(pipeline: ColorPipeline | null | undefined): ColorPipeline {
  if (!pipeline || !Array.isArray(pipeline.nodes)) return emptyColorPipeline()
  return {
    schemaVersion: COLOR_PIPELINE_SCHEMA,
    nodes: pipeline.nodes,
    outputColorSpace: pipeline.outputColorSpace === 'display-referred' ? 'display-referred' : 'unspecified',
  }
}

/**
 * ThemeSpec / FilterSpec fidelity registry.
 * Browser CSS is preview. Final output is FFmpeg. Properties that cannot be lowered stay labeled.
 */
import type { ColorGrade, ThemeSpec } from './types'
import { FILTER_SPECS, composeFilterCss, getFilterSpec } from './filters'

export type LookFidelity = 'RENDER-LOWERED' | 'PREVIEW-ONLY' | 'UNSUPPORTED'

export type LookPropertyAudit = {
  id: string
  group: 'ThemeSpec' | 'FilterSpec' | 'ColorGrade'
  fidelity: LookFidelity
  program: string
  render: string
  phase: '1' | '5' | '2' | '9'
  phase1Required: boolean
}

export const THEME_LOOK_AUDIT: LookPropertyAudit[] = [
  { id: 'color.exposure', group: 'ColorGrade', fidelity: 'RENDER-LOWERED', program: 'CSS brightness', render: 'eq=brightness', phase: '1', phase1Required: true },
  { id: 'color.contrast', group: 'ColorGrade', fidelity: 'RENDER-LOWERED', program: 'CSS contrast', render: 'eq=contrast', phase: '1', phase1Required: true },
  { id: 'color.saturation', group: 'ColorGrade', fidelity: 'RENDER-LOWERED', program: 'CSS saturate', render: 'eq=saturation', phase: '1', phase1Required: true },
  { id: 'color.temperature', group: 'ColorGrade', fidelity: 'RENDER-LOWERED', program: 'CSS sepia+hue approx', render: 'colorbalance rs/bs', phase: '1', phase1Required: true },
  { id: 'color.lookId', group: 'ColorGrade', fidelity: 'RENDER-LOWERED', program: 'FILTER_SPECS CSS', render: 'eq/colorchannelmixer/hue from the same spec', phase: '1', phase1Required: true },
  { id: 'typography.letterSpacing', group: 'ThemeSpec', fidelity: 'PREVIEW-ONLY', program: 'CSS letter-spacing', render: 'ASS has no equivalent tracking; fonts only', phase: '5', phase1Required: false },
  { id: 'captionStyle.animation', group: 'ThemeSpec', fidelity: 'PREVIEW-ONLY', program: 'string / unused engine', render: 'not burned', phase: '5', phase1Required: false },
  { id: 'captionStyle.fill/stroke/background/position', group: 'ThemeSpec', fidelity: 'RENDER-LOWERED', program: 'Program overlay CSS', render: 'ASS styles', phase: '1', phase1Required: true },
  { id: 'typography.title/caption family+size+color', group: 'ThemeSpec', fidelity: 'RENDER-LOWERED', program: 'CSS font', render: 'ASS Fontname with DejaVu fallback', phase: '1', phase1Required: true },
  { id: 'effects.glow', group: 'ThemeSpec', fidelity: 'PREVIEW-ONLY', program: 'applyEffect stores glow', render: 'no glow filter in graph', phase: '5', phase1Required: false },
  { id: 'effects.grain', group: 'ThemeSpec', fidelity: 'PREVIEW-ONLY', program: 'named string', render: 'not lowered (noise would be invented fidelity)', phase: '5', phase1Required: false },
  { id: 'effects.film', group: 'ThemeSpec', fidelity: 'PREVIEW-ONLY', program: 'named string', render: 'not lowered as a stock LUT', phase: '5', phase1Required: false },
  { id: 'overlays.gold-veil', group: 'ThemeSpec', fidelity: 'PREVIEW-ONLY', program: 'theme overlay name', render: 'not a burned veil', phase: '5', phase1Required: false },
  { id: 'overlays.end-card', group: 'ThemeSpec', fidelity: 'UNSUPPORTED', program: 'flag only', render: 'no end-card compositor', phase: '5', phase1Required: false },
  { id: 'motionGraphics', group: 'ThemeSpec', fidelity: 'UNSUPPORTED', program: 'string ids', render: 'Phase 5', phase: '5', phase1Required: false },
  { id: 'pacingHints', group: 'ThemeSpec', fidelity: 'UNSUPPORTED', program: 'hints', render: 'not executed', phase: '5', phase1Required: false },
  { id: 'cameraBehavior', group: 'ThemeSpec', fidelity: 'UNSUPPORTED', program: 'preferred follow name', render: 'VirtualCamera is separate', phase: '5', phase1Required: false },
  { id: 'color.palette', group: 'ThemeSpec', fidelity: 'UNSUPPORTED', program: 'metadata', render: 'not a LUT', phase: '5', phase1Required: false },
  { id: 'filter.brightness/contrast/saturate', group: 'FilterSpec', fidelity: 'RENDER-LOWERED', program: 'CSS filter', render: 'eq', phase: '1', phase1Required: true },
  { id: 'filter.sepia', group: 'FilterSpec', fidelity: 'RENDER-LOWERED', program: 'CSS sepia', render: 'colorchannelmixer sepia matrix', phase: '1', phase1Required: true },
  { id: 'filter.hue-rotate', group: 'FilterSpec', fidelity: 'RENDER-LOWERED', program: 'CSS hue-rotate', render: 'hue=h', phase: '1', phase1Required: true },
]

export function previewOnlyIds(): string[] {
  return THEME_LOOK_AUDIT.filter(a => a.fidelity === 'PREVIEW-ONLY').map(a => a.id)
}

export function renderLoweredIds(): string[] {
  return THEME_LOOK_AUDIT.filter(a => a.fidelity === 'RENDER-LOWERED').map(a => a.id)
}

export function colorGradeToCss(color: ColorGrade): string {
  const brightness = 1 + (color.exposure || 0)
  const contrast = 1 + (color.contrast || 0)
  const saturate = 1 + (color.saturation || 0)
  const temp = color.temperature || 0
  const sepia = Math.max(0, temp) * 0.35
  const hue = temp * 12
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) sepia(${sepia}) hue-rotate(${hue}deg)`
}

export function colorGradeToFfmpeg(color: ColorGrade): string[] {
  const parts: string[] = []
  const brightness = color.exposure || 0
  const contrast = 1 + (color.contrast || 0)
  const saturation = 1 + (color.saturation || 0)
  if (brightness || color.contrast || color.saturation) {
    parts.push(`eq=brightness=${brightness.toFixed(4)}:contrast=${contrast.toFixed(4)}:saturation=${saturation.toFixed(4)}`)
  }
  const temp = color.temperature || 0
  if (Math.abs(temp) > 0.001) {
    const rs = (temp * 0.22).toFixed(4)
    const bs = (-temp * 0.18).toFixed(4)
    parts.push(`colorbalance=rs=${rs}:bs=${bs}`)
  }
  return parts
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** Parse a CSS filter string into FFmpeg pieces. Amount 0 = identity, 1 = full spec. */
export function cssLookToFfmpeg(css: string, amount: number): string[] {
  const t = Math.max(0, Math.min(1, amount))
  if (t <= 0) return []
  const parts: string[] = []
  let brightness = 1
  let contrast = 1
  let saturation = 1
  const eq = (re: RegExp, def = 1) => {
    const m = css.match(re)
    return m ? Number(m[1]) : def
  }
  brightness = mix(1, eq(/brightness\(([\d.]+)\)/), t)
  contrast = mix(1, eq(/contrast\(([\d.]+)\)/), t)
  saturation = mix(1, eq(/saturate\(([\d.]+)\)/), t)
  if (brightness !== 1 || contrast !== 1 || saturation !== 1) {
    parts.push(`eq=brightness=${(brightness - 1).toFixed(4)}:contrast=${contrast.toFixed(4)}:saturation=${saturation.toFixed(4)}`)
  }
  const sepiaM = css.match(/sepia\(([\d.]+)\)/)
  if (sepiaM) {
    const s = mix(0, Number(sepiaM[1]), t)
    if (s > 0.001) {
      const rr = (0.393 + 0.607 * (1 - s)).toFixed(4)
      const rg = (0.769 * s).toFixed(4)
      const rb = (0.189 * s).toFixed(4)
      const gr = (0.349 * s).toFixed(4)
      const gg = (0.686 + 0.314 * (1 - s)).toFixed(4)
      const gb = (0.168 * s).toFixed(4)
      const br = (0.272 * s).toFixed(4)
      const bg = (0.534 * s).toFixed(4)
      const bb = (0.131 + 0.869 * (1 - s)).toFixed(4)
      parts.push(`colorchannelmixer=${rr}:${rg}:${rb}:${gr}:${gg}:${gb}:${br}:${bg}:${bb}`)
    }
  }
  const hueM = css.match(/hue-rotate\((-?[\d.]+)deg\)/)
  if (hueM) {
    const h = mix(0, Number(hueM[1]), t)
    if (Math.abs(h) > 0.01) parts.push(`hue=h=${h.toFixed(2)}`)
  }
  return parts
}

export function appliedLooksToFfmpeg(filters: Array<{ filterId: string; amount: number; enabled: boolean }>): string[] {
  const out: string[] = []
  for (const applied of filters) {
    if (!applied.enabled || applied.amount <= 0) continue
    const spec = getFilterSpec(applied.filterId)
    if (!spec) continue
    out.push(...cssLookToFfmpeg(spec.css, applied.amount))
  }
  return out
}

export function themeLooksToFfmpeg(theme: ThemeSpec | null | undefined): string[] {
  if (!theme) return []
  const grade = colorGradeToFfmpeg(theme.color)
  const look = theme.color.lookId ? appliedLooksToFfmpeg([{ filterId: theme.color.lookId, amount: 0.72, enabled: true }]) : []
  return [...grade, ...look]
}

export function clipLooksToFfmpeg(color: ColorGrade, filters: Array<{ filterId: string; amount: number; enabled: boolean }>): string[] {
  return [...colorGradeToFfmpeg(color), ...appliedLooksToFfmpeg(filters)]
}

export function composeProgramLookCss(
  color: ColorGrade,
  filters: Array<{ filterId: string; amount: number; enabled: boolean }>,
): string {
  const filterCss = composeFilterCss(filters)
  const grade = colorGradeToCss(color)
  if (filterCss === 'none') return grade
  return `${grade} ${filterCss}`
}

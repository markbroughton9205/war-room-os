/**
 * Shared caption/title geometry for Program Viewer and Render Engine.
 * Normalized x/y (0–1). Never copy 16:9 pixels into 9:16.
 */
import type { CaptionCue, CaptionPositionPreset, CaptionTrack, OverlaySpec, OutputAspect, TextAlignment, ThemeSpec } from './types'
import { cssFontFamily, findHvsFont } from './fonts'
import { boxInside, centerOf, clampBoxToRegion, safeRegion, type SafeBox, type SafeWarning } from './safe-area'

export type { CaptionPositionPreset, TextAlignment }

export const POSITION_PRESETS: Record<Exclude<CaptionPositionPreset, 'custom'>, { x: number; y: number; alignment: TextAlignment; assAlign: number }> = {
  'bottom-center': { x: 0.5, y: 0.88, alignment: 'center', assAlign: 2 },
  'bottom-left': { x: 0.18, y: 0.88, alignment: 'left', assAlign: 1 },
  'bottom-right': { x: 0.82, y: 0.88, alignment: 'right', assAlign: 3 },
  center: { x: 0.5, y: 0.5, alignment: 'center', assAlign: 5 },
  'top-center': { x: 0.5, y: 0.12, alignment: 'center', assAlign: 8 },
}

export function trackPositionToPreset(position: CaptionTrack['position'] | undefined): CaptionPositionPreset {
  if (position === 'top') return 'top-center'
  if (position === 'center') return 'center'
  return 'bottom-center'
}

export type ResolvedTextStyle = {
  text: string
  secondaryText: string | null
  x: number
  y: number
  positionPreset: CaptionPositionPreset
  alignment: TextAlignment
  fontFamily: string
  cssFontFamily: string
  assFontName: string
  fontSize: number
  fontWeight: number
  italic: boolean
  color: string
  background: string | null
  backgroundOpacity: number
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  lineSpacing: number
  maxWidth: number
  scale: number
  rotation: number
  opacity: number
  safeAreaLock: boolean
}

function clamp01(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

export function maxCharsForWidth(maxWidth: number, fontSize: number, frameWidth: number): number {
  const px = Math.max(32, maxWidth * frameWidth)
  const em = Math.max(8, fontSize * 0.55)
  return Math.max(8, Math.floor(px / em))
}

export function textBox(style: ResolvedTextStyle, frameWidth: number, frameHeight: number): SafeBox {
  const lines = wrapText(style.text, maxCharsForWidth(style.maxWidth, style.fontSize, frameWidth))
  const extra = style.secondaryText ? wrapText(style.secondaryText, maxCharsForWidth(style.maxWidth, style.fontSize * 0.62, frameWidth)) : []
  const all = [...lines, ...extra]
  const width = Math.min(style.maxWidth, 0.92)
  const lineH = (style.fontSize * style.lineSpacing) / frameHeight
  const height = Math.max(lineH, all.length * lineH)
  const align = style.alignment
  const x = align === 'left' ? style.x : align === 'right' ? style.x - width : style.x - width / 2
  const y = style.y - height / 2
  return {
    x: clamp01(x, 0.1),
    y: clamp01(y, 0.1),
    width,
    height,
  }
}

export function resolveCaptionStyle(cue: CaptionCue, track: CaptionTrack | undefined, theme: ThemeSpec | null | undefined): ResolvedTextStyle {
  const preset = cue.positionPreset ?? trackPositionToPreset(track?.position ?? theme?.captionStyle.position)
  const baked = preset === 'custom'
    ? { x: cue.x ?? 0.5, y: cue.y ?? 0.88, alignment: cue.alignment ?? 'center', assAlign: 5 }
    : POSITION_PRESETS[preset]
  const fontFamily = cue.fontFamily ?? track?.fontFamily ?? theme?.typography.captionFamily ?? 'DejaVu Sans'
  const font = findHvsFont(fontFamily)
  return {
    text: cue.text,
    secondaryText: null,
    x: cue.x ?? baked.x,
    y: cue.y ?? baked.y,
    positionPreset: preset,
    alignment: cue.alignment ?? baked.alignment,
    fontFamily,
    cssFontFamily: cssFontFamily(fontFamily),
    assFontName: font.assName,
    fontSize: cue.fontSize ?? track?.fontSize ?? theme?.typography.captionSize ?? 38,
    fontWeight: cue.fontWeight ?? track?.fontWeight ?? 400,
    italic: (cue.fontStyle ?? 'normal') === 'italic',
    color: cue.color ?? track?.color ?? theme?.captionStyle.fill ?? '#F6E7C1',
    background: cue.background ?? track?.background ?? theme?.captionStyle.background ?? null,
    backgroundOpacity: cue.backgroundOpacity ?? track?.backgroundOpacity ?? 0.35,
    outlineColor: cue.outlineColor ?? track?.outlineColor ?? '#140C04',
    outlineWidth: cue.outlineWidth ?? track?.outlineWidth ?? 2,
    shadow: cue.shadow ?? track?.shadow ?? true,
    lineSpacing: cue.lineSpacing ?? track?.lineSpacing ?? 1.15,
    maxWidth: cue.maxWidth ?? track?.maxWidth ?? 0.8,
    scale: 1,
    rotation: 0,
    opacity: 1,
    safeAreaLock: cue.safeAreaLock ?? track?.safeAreaLock ?? false,
  }
}

export function resolveOverlayStyle(overlay: OverlaySpec, theme: ThemeSpec | null | undefined): ResolvedTextStyle {
  const preset = overlay.positionPreset ?? (overlay.titleKind === 'lower-third' ? 'bottom-left' : overlay.y < 0.35 ? 'top-center' : overlay.y > 0.7 ? 'bottom-center' : 'center')
  const baked = preset === 'custom' ? null : POSITION_PRESETS[preset]
  const fontFamily = overlay.fontFamily ?? theme?.typography.titleFamily ?? 'DejaVu Serif'
  const font = findHvsFont(fontFamily)
  return {
    text: overlay.text ?? '',
    secondaryText: overlay.secondaryText ?? null,
    x: overlay.x ?? baked?.x ?? 0.5,
    y: overlay.y ?? baked?.y ?? 0.18,
    positionPreset: overlay.positionPreset ?? (baked ? preset : 'custom'),
    alignment: overlay.alignment ?? baked?.alignment ?? 'center',
    fontFamily,
    cssFontFamily: cssFontFamily(fontFamily),
    assFontName: font.assName,
    fontSize: overlay.fontSize ?? theme?.typography.titleSize ?? 64,
    fontWeight: overlay.fontWeight ?? 700,
    italic: false,
    color: overlay.color ?? theme?.typography.color ?? '#F6E7C1',
    background: overlay.background ?? (overlay.titleKind === 'lower-third' ? 'rgba(8,4,0,0.72)' : null),
    backgroundOpacity: overlay.backgroundOpacity ?? (overlay.titleKind === 'lower-third' ? 0.72 : 0),
    outlineColor: overlay.outlineColor ?? '#140C04',
    outlineWidth: overlay.outlineWidth ?? 2,
    shadow: overlay.shadow ?? true,
    lineSpacing: overlay.lineSpacing ?? 1.1,
    maxWidth: overlay.maxWidth ?? (overlay.titleKind === 'lower-third' ? 0.62 : 0.78),
    scale: overlay.scale ?? 1,
    rotation: overlay.rotation ?? 0,
    opacity: overlay.opacity ?? 1,
    safeAreaLock: overlay.safeAreaLock ?? false,
  }
}

export function logoBox(overlay: OverlaySpec): SafeBox {
  const width = Math.max(0.04, overlay.scale ?? 0.18)
  const height = width * 0.32
  return {
    x: overlay.x - width / 2,
    y: overlay.y - height / 2,
    width,
    height,
  }
}

export function evaluateTextSafe(id: string, kind: SafeWarning['kind'], style: ResolvedTextStyle, aspect: OutputAspect, frameWidth: number, frameHeight: number): SafeWarning {
  const box = textBox(style, frameWidth, frameHeight)
  const title = safeRegion('title')
  const inside = boxInside(box, title)
  if (inside) return { id, kind, status: 'SAFE', message: 'Inside title-safe.', box }
  const overflow = box.x < 0 || box.y < 0 || box.x + box.width > 1 || box.y + box.height > 1
  return {
    id,
    kind,
    status: 'WARNING',
    message: overflow
      ? `${kind} would render off-canvas on ${aspect}. Text was not auto-moved.`
      : `${kind} sits outside title-safe on ${aspect}. Text was not auto-moved.`,
    box,
  }
}

export function evaluateLogoSafe(overlay: OverlaySpec, aspect: OutputAspect): SafeWarning {
  const box = logoBox(overlay)
  const inside = boxInside(box, safeRegion('title'))
  return {
    id: overlay.id,
    kind: 'logo',
    status: inside ? 'SAFE' : 'WARNING',
    message: inside ? 'Logo inside title-safe.' : `Logo exceeds title-safe on ${aspect}. Original graphic was not mutated.`,
    box,
  }
}

export function clampStyleToTitleSafe(style: ResolvedTextStyle, frameWidth: number, frameHeight: number): { x: number; y: number } {
  const box = textBox(style, frameWidth, frameHeight)
  const clamped = clampBoxToRegion(box, safeRegion('title'))
  return centerOf(clamped)
}

export function cssTransform(alignment: TextAlignment): string {
  if (alignment === 'left') return 'translate(0, -50%)'
  if (alignment === 'right') return 'translate(-100%, -50%)'
  return 'translate(-50%, -50%)'
}

export function collectSafeWarnings(project: {
  timeline: {
    aspect: OutputAspect
    width: number
    height: number
    captionTracks: CaptionTrack[]
    overlays: OverlaySpec[]
    themeId: string | null
  }
}, theme: ThemeSpec | null | undefined, aspect: OutputAspect = project.timeline.aspect): SafeWarning[] {
  const W = project.timeline.width || 1920
  const H = project.timeline.height || 1080
  const track = project.timeline.captionTracks[0]
  const warnings: SafeWarning[] = []
  for (const cue of track?.cues ?? []) {
    warnings.push(evaluateTextSafe(cue.id, 'caption', resolveCaptionStyle(cue, track, theme), aspect, W, H))
  }
  for (const overlay of project.timeline.overlays) {
    if (overlay.kind === 'logo') warnings.push(evaluateLogoSafe(overlay, aspect))
    else if (overlay.kind === 'title') {
      const kind = overlay.titleKind === 'lower-third' ? 'lower-third' : 'title'
      warnings.push(evaluateTextSafe(overlay.id, kind, resolveOverlayStyle(overlay, theme), aspect, W, H))
    }
  }
  return warnings
}

export function overflowLines(style: ResolvedTextStyle, frameWidth: number): { lines: string[]; overflow: boolean } {
  const lines = wrapText(style.text, maxCharsForWidth(style.maxWidth, style.fontSize, frameWidth))
  const overflow = lines.some(line => line.length > maxCharsForWidth(style.maxWidth, style.fontSize, frameWidth) + 4) || style.text.length > 240
  return { lines, overflow }
}

export function assAlignment(style: ResolvedTextStyle): number {
  if (style.positionPreset === 'custom') return 5
  return POSITION_PRESETS[style.positionPreset]?.assAlign ?? 5
}

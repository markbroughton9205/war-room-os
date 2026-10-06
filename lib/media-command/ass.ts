/**
 * ASS document for captions + titles + lower thirds.
 * Same normalized geometry as Program Viewer. Guides never appear here.
 */
import { writeFile } from 'node:fs/promises'
import { uniqueCaptionCues } from './captions'
import { assFontName } from './fonts'
import { getThemeSpec } from './themes'
import { toSeconds } from './time'
import type { HvsProject, OverlaySpec } from './types'
import { aspectDimensions } from './safe-area'
import {
  assAlignment,
  overflowLines,
  resolveCaptionStyle,
  resolveOverlayStyle,
  wrapText,
  maxCharsForWidth,
  type ResolvedTextStyle,
} from './text-layout'

export function hexToAss(hex: string, alpha = '00'): string {
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `&H${alpha}C1E7F6`
  return `&H${alpha}${clean.slice(4, 6)}${clean.slice(2, 4)}${clean.slice(0, 2)}`
}

export function assTime(sec: number): string {
  const clamped = Math.max(0, sec)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const cs = Math.min(99, Math.round((clamped % 1) * 100))
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function escapeAssPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function rgbaAlphaHex(opacity: number): string {
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
  return a.toString(16).padStart(2, '0').toUpperCase()
}

function styleLine(name: string, style: ResolvedTextStyle, W: number, H: number, availableFonts: string[]): string {
  const font = assFontName(style.fontFamily, availableFonts)
  const fill = hexToAss(style.color)
  const outline = hexToAss(style.outlineColor)
  const backAlpha = style.background ? rgbaAlphaHex(style.backgroundOpacity) : '64'
  const back = hexToAss('#000000', backAlpha)
  const align = assAlignment(style)
  const marginV = Math.round((style.positionPreset === 'top-center' ? style.y : 1 - style.y) * H)
  const marginLR = Math.round(((1 - style.maxWidth) / 2) * W)
  const borderStyle = style.background ? 3 : 1
  return `Style: ${name},${font},${Math.round(style.fontSize)},${fill},&H000000FF,${outline},${back},${style.fontWeight >= 600 ? -1 : 0},${style.italic ? -1 : 0},0,0,100,100,0,${style.rotation}, ${borderStyle},${style.outlineWidth},${style.shadow ? 1 : 0},${align},${marginLR},${marginLR},${Math.max(24, marginV)},1`
}

function dialogueText(style: ResolvedTextStyle, W: number): string {
  const primary = wrapText(style.text, maxCharsForWidth(style.maxWidth, style.fontSize, W)).join('\\N')
  const secondary = style.secondaryText
    ? wrapText(style.secondaryText, maxCharsForWidth(style.maxWidth, style.fontSize * 0.7, W)).join('\\N')
    : ''
  const body = secondary ? `${primary}\\N${secondary}` : primary
  return body.replace(/\{/g, '\\{')
}

function posOverride(style: ResolvedTextStyle, W: number, H: number): string {
  if (style.positionPreset !== 'custom' && style.positionPreset !== 'bottom-left' && style.positionPreset !== 'bottom-right') {
    return ''
  }
  const x = Math.round(style.x * W)
  const y = Math.round(style.y * H)
  return `{\\an${assAlignment(style)}\\pos(${x},${y})}`
}

export function buildAssDocument(project: HvsProject, availableFonts: string[] = []): { ass: string; eventCount: number; fontsUsed: string[] } {
  const W = project.timeline.width || aspectDimensions(project.timeline.aspect).width
  const H = project.timeline.height || aspectDimensions(project.timeline.aspect).height
  const theme = project.timeline.themeId ? getThemeSpec(project.timeline.themeId) : null
  const capTrack = project.timeline.captionTracks[0]
  const cues = uniqueCaptionCues(capTrack?.cues ?? [])
  const titles = project.timeline.overlays.filter(o => o.kind === 'title' && o.text)
  const styles: string[] = []
  const events: string[] = []
  const fontsUsed: string[] = []

  cues.forEach((cue, i) => {
    const style = resolveCaptionStyle(cue, capTrack, theme)
    const name = `CAP${i}`
    styles.push(styleLine(name, style, W, H, availableFonts).replace(/\s+/g, ' '))
    fontsUsed.push(assFontName(style.fontFamily, availableFonts))
    const start = assTime(toSeconds(cue.start))
    const end = assTime(toSeconds(cue.end))
    events.push(`Dialogue: 0,${start},${end},${name},,0,0,0,,${posOverride(style, W, H)}${dialogueText(style, W)}`)
  })

  titles.forEach((overlay, i) => {
    const style = resolveOverlayStyle(overlay, theme)
    const name = overlay.titleKind === 'lower-third' ? `LT${i}` : `TTL${i}`
    styles.push(styleLine(name, style, W, H, availableFonts).replace(/\s+/g, ' '))
    fontsUsed.push(assFontName(style.fontFamily, availableFonts))
    const start = assTime(toSeconds(overlay.start))
    const end = assTime(toSeconds(overlay.start) + toSeconds(overlay.duration))
    events.push(`Dialogue: 1,${start},${end},${name},,0,0,0,,${posOverride(style, W, H)}${dialogueText(style, W)}`)
  })

  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n') || 'Style: HVS,DejaVu Sans,36,&H00C1E7F6,&H000000FF,&H00040C14,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,64,64,80,1'}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
  return { ass, eventCount: events.length, fontsUsed: [...new Set(fontsUsed)] }
}

export async function writeAssFile(filePath: string, project: HvsProject, availableFonts: string[] = []): Promise<{ eventCount: number; fontsUsed: string[] }> {
  const built = buildAssDocument(project, availableFonts)
  await writeFile(filePath, built.ass, 'utf8')
  return { eventCount: built.eventCount, fontsUsed: built.fontsUsed }
}

export function overlayNeedsAss(overlay: OverlaySpec): boolean {
  return overlay.kind === 'title' && Boolean(overlay.text)
}

export function captionOverflowWarning(project: HvsProject): string | null {
  const theme = project.timeline.themeId ? getThemeSpec(project.timeline.themeId) : null
  const track = project.timeline.captionTracks[0]
  const W = project.timeline.width || 1920
  for (const cue of uniqueCaptionCues(track?.cues ?? [])) {
    const style = resolveCaptionStyle(cue, track, theme)
    const { overflow } = overflowLines(style, W)
    if (overflow) return `Caption "${cue.text.slice(0, 40)}" exceeds max width. Wrapping applied; text was not auto-moved.`
  }
  return null
}

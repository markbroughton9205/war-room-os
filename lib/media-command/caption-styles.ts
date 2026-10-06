/**
 * Commander-facing caption styles. Technical subtitle details stay internal.
 */
import type { OutputAspect } from './types'
import type { HvsCaptionStyleId } from './production-ai-types'

export type CaptionStyleSpec = {
  id: HvsCaptionStyleId
  label: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  position: 'bottom' | 'top' | 'center'
  positionPreset: 'bottom-center' | 'top-center' | 'center'
  color: string
  background: string | null
  backgroundOpacity: number
  outlineColor: string
  outlineWidth: string | number
  y: number
}

export type CaptionSafeMargins = {
  aspect: OutputAspect
  top: number
  bottom: number
  side: number
  note: string
}

/** Configurable, not platform-locked. Vertical avoids typical lower UI. */
export const CAPTION_SAFE_MARGINS: Record<OutputAspect, CaptionSafeMargins> = {
  '16:9': { aspect: '16:9', top: 0.08, bottom: 0.10, side: 0.08, note: 'Widescreen title-safe bottom band.' },
  '9:16': { aspect: '9:16', top: 0.10, bottom: 0.18, side: 0.08, note: 'Vertical captions sit above typical lower-screen UI.' },
  '1:1': { aspect: '1:1', top: 0.10, bottom: 0.14, side: 0.08, note: 'Square captions keep a modest lower margin.' },
}

export const HVS_CAPTION_STYLE_SPECS: Record<HvsCaptionStyleId, CaptionStyleSpec> = {
  CLEAN: {
    id: 'CLEAN',
    label: 'Clean',
    fontFamily: 'Inter',
    fontSize: 38,
    fontWeight: 500,
    position: 'bottom',
    positionPreset: 'bottom-center',
    color: '#F8F4EA',
    background: null,
    backgroundOpacity: 0,
    outlineColor: '#111111',
    outlineWidth: 2,
    y: 0.88,
  },
  BOLD: {
    id: 'BOLD',
    label: 'Bold',
    fontFamily: 'Inter',
    fontSize: 46,
    fontWeight: 800,
    position: 'bottom',
    positionPreset: 'bottom-center',
    color: '#FFF8E8',
    background: '#000000',
    backgroundOpacity: 0.45,
    outlineColor: '#000000',
    outlineWidth: 3,
    y: 0.88,
  },
  MINIMAL: {
    id: 'MINIMAL',
    label: 'Minimal',
    fontFamily: 'Inter',
    fontSize: 32,
    fontWeight: 400,
    position: 'bottom',
    positionPreset: 'bottom-center',
    color: '#F4EFE4',
    background: null,
    backgroundOpacity: 0,
    outlineColor: '#1A120A',
    outlineWidth: 1,
    y: 0.86,
  },
  SOCIAL: {
    id: 'SOCIAL',
    label: 'Social',
    fontFamily: 'Inter',
    fontSize: 44,
    fontWeight: 700,
    position: 'center',
    positionPreset: 'center',
    color: '#FFFFFF',
    background: '#000000',
    backgroundOpacity: 0.35,
    outlineColor: '#111111',
    outlineWidth: 3,
    y: 0.50,
  },
}

export function parseCaptionStyle(prompt: string): HvsCaptionStyleId {
  const lower = prompt.toLowerCase()
  if (/\bbold\b/.test(lower)) return 'BOLD'
  if (/\bminimal\b/.test(lower)) return 'MINIMAL'
  if (/\bsocial\b/.test(lower)) return 'SOCIAL'
  return 'CLEAN'
}

export function captionStyleSpec(id: HvsCaptionStyleId | null | undefined): CaptionStyleSpec {
  return HVS_CAPTION_STYLE_SPECS[id ?? 'CLEAN']
}

export function captionYForAspect(style: CaptionStyleSpec, aspect: OutputAspect): number {
  const margins = CAPTION_SAFE_MARGINS[aspect] ?? CAPTION_SAFE_MARGINS['16:9']
  if (style.position === 'center') return 0.50
  if (style.position === 'top') return Math.max(style.y, margins.top + 0.06)
  return Math.min(style.y, 1 - margins.bottom - 0.06)
}

export function captionBoxForAspect(style: CaptionStyleSpec, aspect: OutputAspect): { x: number; y: number; width: number; height: number } {
  const margins = CAPTION_SAFE_MARGINS[aspect] ?? CAPTION_SAFE_MARGINS['16:9']
  const width = 1 - margins.side * 2
  const height = 0.12
  const y = Math.min(captionYForAspect(style, aspect) - height / 2, 1 - margins.bottom - height)
  return {
    x: margins.side,
    y: Math.max(margins.top, y),
    width,
    height,
  }
}

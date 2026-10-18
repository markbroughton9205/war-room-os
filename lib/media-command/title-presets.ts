/**
 * HVS-owned title presets. Structured OverlaySpec values, still editable after apply.
 * No CapCut runtime or templates.
 */
import type { CaptionPositionPreset, OverlaySpec, TextAlignment } from './types'

export type TitlePresetId = 'cinematic' | 'lower-third' | 'clean-commercial' | 'social-bold' | 'documentary' | 'minimal'

export type TitlePreset = {
  id: TitlePresetId
  label: string
  titleKind: 'title' | 'lower-third'
  positionPreset: CaptionPositionPreset
  x: number
  y: number
  alignment: TextAlignment
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  background: string | null
  backgroundOpacity: number
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  maxWidth: number
  scale: number
}

export const TITLE_PRESETS: TitlePreset[] = [
  {
    id: 'cinematic',
    label: 'CINEMATIC TITLE',
    titleKind: 'title',
    positionPreset: 'top-center',
    x: 0.5,
    y: 0.16,
    alignment: 'center',
    fontFamily: 'Cinzel, "Times New Roman", serif',
    fontSize: 72,
    fontWeight: 700,
    color: '#F6E7C1',
    background: null,
    backgroundOpacity: 0,
    outlineColor: '#140C04',
    outlineWidth: 3,
    shadow: true,
    maxWidth: 0.78,
    scale: 1,
  },
  {
    id: 'lower-third',
    label: 'LOWER THIRD',
    titleKind: 'lower-third',
    positionPreset: 'bottom-left',
    x: 0.18,
    y: 0.82,
    alignment: 'left',
    fontFamily: '"DejaVu Sans", Arial, sans-serif',
    fontSize: 36,
    fontWeight: 700,
    color: '#F6E7C1',
    background: 'rgba(8,4,0,0.78)',
    backgroundOpacity: 0.78,
    outlineColor: '#C9A227',
    outlineWidth: 1,
    shadow: false,
    maxWidth: 0.58,
    scale: 1,
  },
  {
    id: 'clean-commercial',
    label: 'CLEAN COMMERCIAL',
    titleKind: 'title',
    positionPreset: 'center',
    x: 0.5,
    y: 0.5,
    alignment: 'center',
    fontFamily: '"DejaVu Sans", Arial, sans-serif',
    fontSize: 56,
    fontWeight: 400,
    color: '#FFFFFF',
    background: null,
    backgroundOpacity: 0,
    outlineColor: '#111111',
    outlineWidth: 1,
    shadow: false,
    maxWidth: 0.72,
    scale: 1,
  },
  {
    id: 'social-bold',
    label: 'SOCIAL BOLD',
    titleKind: 'title',
    positionPreset: 'center',
    x: 0.5,
    y: 0.5,
    alignment: 'center',
    fontFamily: '"DejaVu Sans", Arial, sans-serif',
    fontSize: 64,
    fontWeight: 700,
    color: '#FFFFFF',
    background: 'rgba(0,0,0,0.45)',
    backgroundOpacity: 0.45,
    outlineColor: '#000000',
    outlineWidth: 4,
    shadow: true,
    maxWidth: 0.82,
    scale: 1,
  },
  {
    id: 'documentary',
    label: 'DOCUMENTARY',
    titleKind: 'title',
    positionPreset: 'bottom-left',
    x: 0.18,
    y: 0.86,
    alignment: 'left',
    fontFamily: '"DejaVu Serif", "Times New Roman", serif',
    fontSize: 32,
    fontWeight: 400,
    color: '#F4F1EA',
    background: 'rgba(12,10,8,0.55)',
    backgroundOpacity: 0.55,
    outlineColor: '#1A120A',
    outlineWidth: 1,
    shadow: false,
    maxWidth: 0.7,
    scale: 1,
  },
  {
    id: 'minimal',
    label: 'MINIMAL',
    titleKind: 'title',
    positionPreset: 'top-center',
    x: 0.5,
    y: 0.14,
    alignment: 'center',
    fontFamily: '"DejaVu Sans", Arial, sans-serif',
    fontSize: 28,
    fontWeight: 400,
    color: '#F6E7C1',
    background: null,
    backgroundOpacity: 0,
    outlineColor: '#140C04',
    outlineWidth: 0,
    shadow: false,
    maxWidth: 0.6,
    scale: 1,
  },
]

export function getTitlePreset(id: string | null | undefined): TitlePreset | null {
  return TITLE_PRESETS.find(p => p.id === id) ?? null
}

export function applyTitlePreset(overlay: OverlaySpec, preset: TitlePreset): OverlaySpec {
  return {
    ...overlay,
    kind: 'title',
    titleKind: preset.titleKind,
    positionPreset: preset.positionPreset,
    x: preset.x,
    y: preset.y,
    alignment: preset.alignment,
    fontFamily: preset.fontFamily,
    fontSize: preset.fontSize,
    fontWeight: preset.fontWeight,
    color: preset.color,
    background: preset.background,
    backgroundOpacity: preset.backgroundOpacity,
    outlineColor: preset.outlineColor,
    outlineWidth: preset.outlineWidth,
    shadow: preset.shadow,
    maxWidth: preset.maxWidth,
    scale: preset.scale,
    stylePreset: preset.id,
  }
}

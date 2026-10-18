/**
 * ThemeSpec engine. Higher Vision owns themes. No CapCut runtime.
 * Specs are versioned. luxury_beauty_v1 is the Higher Vision luxury-beauty proving theme.
 */
import { fromSeconds } from './time'
import type { ThemeSpec } from './types'

export const LUXURY_BEAUTY_V1_ID = 'luxury_beauty_v1'

export const LUXURY_BEAUTY_V1: ThemeSpec = {
  id: LUXURY_BEAUTY_V1_ID,
  version: '1.0.0',
  name: 'Luxury Beauty V1',
  typography: {
    titleFamily: 'Cinzel, "Didot", "Times New Roman", serif',
    bodyFamily: 'Cormorant Garamond, Georgia, serif',
    captionFamily: 'Cinzel, "Times New Roman", serif',
    titleSize: 72,
    captionSize: 38,
    letterSpacing: '0.28em',
    color: '#F6E7C1',
  },
  captionStyle: {
    fill: '#F6E7C1',
    stroke: 'rgba(20,12,4,0.85)',
    background: 'rgba(8,4,0,0.35)',
    position: 'bottom',
    animation: 'fade-up',
  },
  color: {
    exposure: 0.06,
    contrast: 0.12,
    saturation: 0.08,
    temperature: 0.18,
    lookId: 'luxury-gold',
    palette: ['#0B0704', '#1A120A', '#C9A227', '#F6E7C1', '#7A1D2C'],
  },
  transitions: { defaultKind: 'dissolve', defaultDuration: fromSeconds(0.6) },
  effects: ['glow', 'grain', 'film'],
  pacingHints: { cutDensity: 'medium', holdMin: fromSeconds(1.2) },
  musicBehavior: { duckDb: -8, introPad: fromSeconds(0.4), outroPad: fromSeconds(1.6) },
  logoPlacement: { x: 0.84, y: 0.08, scale: 0.16, endCard: true },
  overlays: ['gold-veil', 'end-card'],
  motionGraphics: ['luxury-type-reveal'],
  cameraBehavior: { preferredFollow: 'CINEMATIC_FOLLOW' },
}

const REGISTRY: Record<string, ThemeSpec> = {
  [LUXURY_BEAUTY_V1_ID]: LUXURY_BEAUTY_V1,
}

export function listThemeSpecs(): ThemeSpec[] {
  return Object.values(REGISTRY)
}

export function getThemeSpec(id: string | null | undefined): ThemeSpec | null {
  if (!id) return null
  return REGISTRY[id] ?? null
}

export function registerThemeSpec(spec: ThemeSpec): void {
  REGISTRY[spec.id] = spec
}

/**
 * Extensible effect / transition model. Slice-0 registers kinds; does not host OpenFX.
 */
export type EffectKindSpec = {
  id: string
  name: string
  category: 'transition' | 'effect' | 'overlay'
  params: Array<{ key: string; min: number; max: number; def: number }>
}

export const EFFECT_KIND_SPECS: EffectKindSpec[] = [
  { id: 'dissolve', name: 'Dissolve', category: 'transition', params: [{ key: 'amount', min: 0, max: 1, def: 1 }] },
  { id: 'wipe', name: 'Wipe', category: 'transition', params: [{ key: 'angle', min: 0, max: 360, def: 0 }] },
  { id: 'slide', name: 'Slide', category: 'transition', params: [{ key: 'direction', min: 0, max: 3, def: 0 }] },
  { id: 'push', name: 'Push', category: 'transition', params: [{ key: 'direction', min: 0, max: 3, def: 0 }] },
  { id: 'zoom', name: 'Zoom', category: 'transition', params: [{ key: 'amount', min: 0, max: 2, def: 1.15 }] },
  { id: 'blur', name: 'Blur', category: 'effect', params: [{ key: 'radius', min: 0, max: 24, def: 6 }] },
  { id: 'glitch', name: 'Glitch', category: 'effect', params: [{ key: 'amount', min: 0, max: 1, def: 0.4 }] },
  { id: 'camera-transition', name: 'Camera Transition', category: 'transition', params: [{ key: 'amount', min: 0, max: 1, def: 1 }] },
  { id: 'mask-transition', name: 'Mask Transition', category: 'transition', params: [{ key: 'feather', min: 0, max: 1, def: 0.2 }] },
  { id: 'light-transition', name: 'Light Transition', category: 'transition', params: [{ key: 'intensity', min: 0, max: 2, def: 1 }] },
  { id: 'film', name: 'Film', category: 'effect', params: [{ key: 'grain', min: 0, max: 1, def: 0.25 }] },
  { id: 'glow', name: 'Glow', category: 'effect', params: [{ key: 'intensity', min: 0, max: 2, def: 0.4 }] },
  { id: 'motion-blur', name: 'Motion Blur', category: 'effect', params: [{ key: 'shutter', min: 0, max: 1, def: 0.5 }] },
  { id: 'shake', name: 'Shake', category: 'effect', params: [{ key: 'amount', min: 0, max: 1, def: 0.2 }] },
  { id: 'grain', name: 'Grain', category: 'effect', params: [{ key: 'amount', min: 0, max: 1, def: 0.18 }] },
  { id: 'distortion', name: 'Distortion', category: 'effect', params: [{ key: 'amount', min: 0, max: 1, def: 0.1 }] },
  { id: 'overlay', name: 'Overlay', category: 'overlay', params: [{ key: 'opacity', min: 0, max: 1, def: 0.35 }] },
]

export function getEffectKind(id: string): EffectKindSpec | null {
  return EFFECT_KIND_SPECS.find(e => e.id === id) ?? null
}

/**
 * High-level production looks. Commander sees names like Cinematic / Warm.
 * Internals map onto ColorPipeline, FilterSpec, AudioGraph, and pacing hints.
 * Do not expose dozens of technical parameters in the default UI.
 */
import type { ColorPipeline } from './color-pipeline'
import type { AudioGraph } from './audio-graph'
import type { HvsProductionStyleId } from './production-ai-types'

export type HvsStyleProfile = {
  id: HvsProductionStyleId
  label: string
  pacing: 'slow' | 'medium' | 'fast'
  transitionKind: 'dissolve' | 'cut'
  filterId: string | null
  filterAmount: number
  color: ColorPipeline
  audio: { highpassHz: number | null; duckDialogue: boolean }
  titles: 'minimal' | 'bold'
}

function colorNodes(
  nodes: ColorPipeline['nodes'],
): ColorPipeline {
  return { schemaVersion: 1, outputColorSpace: 'display-referred', nodes }
}

export const HVS_STYLE_PROFILES: Record<HvsProductionStyleId, HvsStyleProfile> = {
  CINEMATIC: {
    id: 'CINEMATIC',
    label: 'Cinematic',
    pacing: 'slow',
    transitionKind: 'dissolve',
    filterId: 'cinematic',
    filterAmount: 0.72,
    color: colorNodes([
      { id: 'ai-look-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.18, pivot: 0.46 } },
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 0.9 } },
      { id: 'ai-look-temp', type: 'temp-tint', enabled: true, params: { temperature: -0.06, tint: 0 } },
    ]),
    audio: { highpassHz: 80, duckDialogue: true },
    titles: 'minimal',
  },
  ENERGETIC: {
    id: 'ENERGETIC',
    label: 'Energetic',
    pacing: 'fast',
    transitionKind: 'cut',
    filterId: 'street',
    filterAmount: 0.55,
    color: colorNodes([
      { id: 'ai-look-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.22, pivot: 0.5 } },
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 1.12 } },
    ]),
    audio: { highpassHz: 100, duckDialogue: true },
    titles: 'bold',
  },
  CLEAN: {
    id: 'CLEAN',
    label: 'Clean',
    pacing: 'medium',
    transitionKind: 'dissolve',
    filterId: 'commercial-clean',
    filterAmount: 0.5,
    color: colorNodes([
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 1.02 } },
      { id: 'ai-look-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.06, pivot: 0.5 } },
    ]),
    audio: { highpassHz: 90, duckDialogue: true },
    titles: 'minimal',
  },
  DOCUMENTARY: {
    id: 'DOCUMENTARY',
    label: 'Documentary',
    pacing: 'medium',
    transitionKind: 'cut',
    filterId: 'film',
    filterAmount: 0.4,
    color: colorNodes([
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 0.94 } },
    ]),
    audio: { highpassHz: 100, duckDialogue: true },
    titles: 'minimal',
  },
  SOCIAL: {
    id: 'SOCIAL',
    label: 'Social',
    pacing: 'fast',
    transitionKind: 'cut',
    filterId: 'warm-lifestyle',
    filterAmount: 0.45,
    color: colorNodes([
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 1.08 } },
      { id: 'ai-look-temp', type: 'temp-tint', enabled: true, params: { temperature: 0.08, tint: 0 } },
    ]),
    audio: { highpassHz: 80, duckDialogue: true },
    titles: 'bold',
  },
  DRAMATIC: {
    id: 'DRAMATIC',
    label: 'Dramatic',
    pacing: 'slow',
    transitionKind: 'dissolve',
    filterId: 'dark-luxury',
    filterAmount: 0.7,
    color: colorNodes([
      { id: 'ai-look-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.28, pivot: 0.42 } },
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 0.88 } },
    ]),
    audio: { highpassHz: 70, duckDialogue: true },
    titles: 'bold',
  },
  WARM: {
    id: 'WARM',
    label: 'Warm',
    pacing: 'medium',
    transitionKind: 'dissolve',
    filterId: 'warm-lifestyle',
    filterAmount: 0.7,
    color: colorNodes([
      { id: 'ai-look-temp', type: 'temp-tint', enabled: true, params: { temperature: 0.22, tint: 0.04 } },
    ]),
    audio: { highpassHz: 80, duckDialogue: true },
    titles: 'minimal',
  },
  DARK: {
    id: 'DARK',
    label: 'Dark',
    pacing: 'slow',
    transitionKind: 'dissolve',
    filterId: 'dark-luxury',
    filterAmount: 0.75,
    color: colorNodes([
      { id: 'ai-look-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: 0.2, pivot: 0.4 } },
      { id: 'ai-look-offset', type: 'offset', enabled: true, params: { offset: -0.06 } },
    ]),
    audio: { highpassHz: 70, duckDialogue: true },
    titles: 'minimal',
  },
  LUXURY: {
    id: 'LUXURY',
    label: 'Luxury',
    pacing: 'slow',
    transitionKind: 'dissolve',
    filterId: 'luxury-gold',
    filterAmount: 0.65,
    color: colorNodes([
      { id: 'ai-look-temp', type: 'temp-tint', enabled: true, params: { temperature: 0.16, tint: 0.02 } },
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 1.05 } },
    ]),
    audio: { highpassHz: 90, duckDialogue: true },
    titles: 'minimal',
  },
  COOL: {
    id: 'COOL',
    label: 'Cool',
    pacing: 'medium',
    transitionKind: 'cut',
    filterId: 'commercial-clean',
    filterAmount: 0.45,
    color: colorNodes([
      { id: 'ai-look-temp', type: 'temp-tint', enabled: true, params: { temperature: -0.22, tint: 0.04 } },
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 0.96 } },
    ]),
    audio: { highpassHz: 90, duckDialogue: true },
    titles: 'minimal',
  },
  BRIGHT: {
    id: 'BRIGHT',
    label: 'Bright',
    pacing: 'medium',
    transitionKind: 'cut',
    filterId: 'commercial-clean',
    filterAmount: 0.4,
    color: colorNodes([
      { id: 'ai-look-contrast', type: 'contrast-pivot', enabled: true, params: { contrast: -0.04, pivot: 0.52 } },
      { id: 'ai-look-sat', type: 'saturation', enabled: true, params: { saturation: 1.06 } },
      { id: 'ai-look-offset', type: 'offset', enabled: true, params: { offset: 0.04 } },
    ]),
    audio: { highpassHz: 80, duckDialogue: false },
    titles: 'minimal',
  },
}

export function getStyleProfile(id: HvsProductionStyleId | null | undefined): HvsStyleProfile {
  return HVS_STYLE_PROFILES[id ?? 'CLEAN'] ?? HVS_STYLE_PROFILES.CLEAN
}

export function mergeStyleAudioGraph(graph: AudioGraph, style: HvsStyleProfile): AudioGraph {
  const hz = style.audio.highpassHz
  if (!hz) return graph
  return {
    ...graph,
    channels: graph.channels.map((ch, index) => index === 0
      ? {
          ...ch,
          inserts: [
            ...ch.inserts.filter(ins => ins.kind !== 'eq'),
            { kind: 'eq', enabled: true, highpassHz: hz, lowpassHz: null, bands: [] },
          ],
        }
      : ch),
  }
}

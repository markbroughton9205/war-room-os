/**
 * Bounded statistical shot match. No ML.
 * Produces a proposed ColorPipeline. Never silently applies.
 */
import type { ColorNode, ColorPipeline } from './color-pipeline'
import type { ChannelStats } from './frame-scopes'

export type ShotStats = {
  lumaMean: number
  rMean: number
  gMean: number
  bMean: number
  contrast: number
  temperatureApprox: number
}

export type ShotMatchProposal = {
  kind: 'SHOT_MATCH'
  status: 'proposal'
  silentApply: false
  reference: ShotStats
  target: ShotStats
  pipeline: ColorPipeline
  notes: string[]
}

export function statsFromChannels(ch: ChannelStats): ShotStats {
  const luma = ch.luma
  const temp = (ch.meanR - ch.meanB) / Math.max(1, ch.meanR + ch.meanB)
  const spread = Math.abs(ch.meanR - ch.meanB) + Math.abs(ch.meanG - luma)
  const contrast = Math.max(0, Math.min(1, spread / 255))
  return {
    lumaMean: luma,
    rMean: ch.meanR,
    gMean: ch.meanG,
    bMean: ch.meanB,
    contrast,
    temperatureApprox: temp,
  }
}

export function proposeShotMatch(reference: ShotStats, target: ShotStats): ShotMatchProposal {
  const lumaDelta = (reference.lumaMean - target.lumaMean) / 255
  const tempDelta = reference.temperatureApprox - target.temperatureApprox
  const contrastDelta = reference.contrast - target.contrast
  const offset = Math.max(-0.35, Math.min(0.35, lumaDelta * 0.85))
  const temperature = Math.max(-1, Math.min(1, tempDelta * 1.4))
  const contrast = Math.max(-0.4, Math.min(0.6, contrastDelta * 0.8))
  const rGain = 1 + Math.max(-0.25, Math.min(0.25, (reference.rMean - target.rMean) / 255))
  const gGain = 1 + Math.max(-0.25, Math.min(0.25, (reference.gMean - target.gMean) / 255))
  const bGain = 1 + Math.max(-0.25, Math.min(0.25, (reference.bMean - target.bMean) / 255))
  const nodes: ColorNode[] = [
    { id: 'match-offset', type: 'offset', enabled: true, params: { offset } },
    { id: 'match-temp', type: 'temp-tint', enabled: true, params: { temperature, tint: 0 } },
    { id: 'match-contrast', type: 'contrast-pivot', enabled: true, params: { contrast, pivot: 0.5 } },
    { id: 'match-lg', type: 'lift-gamma-gain', enabled: true, params: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [rGain, gGain, bGain] } },
  ]
  return {
    kind: 'SHOT_MATCH',
    status: 'proposal',
    silentApply: false,
    reference,
    target,
    pipeline: { schemaVersion: 1, outputColorSpace: 'display-referred', nodes },
    notes: [
      'Statistical match only. Not a cinematic color-science match.',
      `Luma Δ=${lumaDelta.toFixed(3)} → offset ${offset.toFixed(3)}`,
      `Temp approx Δ=${tempDelta.toFixed(3)} → temperature ${temperature.toFixed(3)}`,
      `Contrast Δ=${contrastDelta.toFixed(3)}`,
      'Commit/reject required. Original media is not mutated.',
    ],
  }
}

/**
 * HVS-owned deliver presets. No third-party branding.
 * Project truth remains independent of export preset.
 */
import type { OutputAspect, RenderTarget } from './types'

export type DeliverCaptionMode = 'none' | 'burn-in' | 'sidecar'

export type HvsDeliverPresetId = 'MASTER' | 'WEB_1080P' | 'VERTICAL_1080x1920' | 'SOCIAL_SQUARE'

export type HvsDeliverPreset = {
  id: HvsDeliverPresetId
  label: string
  aspect: OutputAspect
  width: number
  height: number
  fps: number
  codec: 'h264'
  quality: { crf: number; preset: string }
  audioCodec: 'aac'
  sampleRate: number
  loudnessTargetLufs: number | null
  captionMode: DeliverCaptionMode
  bitrateHint: string
}

export const HVS_DELIVER_PRESETS: HvsDeliverPreset[] = [
  {
    id: 'MASTER',
    label: 'HVS MASTER',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 24,
    codec: 'h264',
    quality: { crf: 18, preset: 'medium' },
    audioCodec: 'aac',
    sampleRate: 48000,
    loudnessTargetLufs: -23,
    captionMode: 'sidecar',
    bitrateHint: 'crf 18 master',
  },
  {
    id: 'WEB_1080P',
    label: 'HVS WEB 1080P',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 24,
    codec: 'h264',
    quality: { crf: 20, preset: 'medium' },
    audioCodec: 'aac',
    sampleRate: 48000,
    loudnessTargetLufs: -14,
    captionMode: 'none',
    bitrateHint: 'crf 20 web',
  },
  {
    id: 'VERTICAL_1080x1920',
    label: 'HVS VERTICAL 1080×1920',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 24,
    codec: 'h264',
    quality: { crf: 20, preset: 'medium' },
    audioCodec: 'aac',
    sampleRate: 48000,
    loudnessTargetLufs: -14,
    captionMode: 'burn-in',
    bitrateHint: 'crf 20 vertical',
  },
  {
    id: 'SOCIAL_SQUARE',
    label: 'HVS SOCIAL SQUARE',
    aspect: '1:1',
    width: 1080,
    height: 1080,
    fps: 24,
    codec: 'h264',
    quality: { crf: 20, preset: 'medium' },
    audioCodec: 'aac',
    sampleRate: 48000,
    loudnessTargetLufs: -14,
    captionMode: 'none',
    bitrateHint: 'crf 20 square',
  },
]

export function deliverPreset(id: HvsDeliverPresetId): HvsDeliverPreset {
  const found = HVS_DELIVER_PRESETS.find(p => p.id === id)
  if (!found) throw new Error(`Unknown HVS deliver preset ${id}`)
  return found
}

export function presetToRenderTarget(id: HvsDeliverPresetId): RenderTarget {
  const p = deliverPreset(id)
  return {
    aspect: p.aspect,
    width: p.width,
    height: p.height,
    format: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
  }
}

export const LOUDNESS_NEVER_AUTO_NORMALIZE = true

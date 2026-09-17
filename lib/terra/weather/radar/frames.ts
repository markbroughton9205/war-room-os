import type { RadarFrame } from './types'
import { IEM_TMS_CACHED, RADAR_PRODUCT, RADAR_SITE } from './types'

export function iemStampFromIso(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

export function isoFromIemScan(ts: string): string | null {
  const trimmed = ts.trim()
  if (!trimmed) return null
  const normalized = /Z$/i.test(trimmed)
    ? (trimmed.includes('T') && trimmed.length <= 18 ? trimmed.replace(/Z$/i, ':00Z') : trimmed)
    : trimmed
  const ms = Date.parse(normalized)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

export function ridgeTileUrlTemplate(iemStamp: string): string {
  return `${IEM_TMS_CACHED}/ridge::${RADAR_SITE}-${RADAR_PRODUCT.split('-')[1] ?? 'N0Q'}-${iemStamp}/{z}/{x}/{y}.png`
}

export function radarFrameFromIso(iso: string, source: RadarFrame['source']): RadarFrame | null {
  const timestampIso = isoFromIemScan(iso) ?? (Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null)
  if (!timestampIso) return null
  const iemStamp = iemStampFromIso(timestampIso)
  if (!iemStamp) return null
  return {
    timestampIso,
    iemStamp,
    tileUrlTemplate: ridgeTileUrlTemplate(iemStamp),
    source,
  }
}

export function mergeRadarFrames(input: {
  metaValid: string | null
  scans: string[]
}): RadarFrame[] {
  const byStamp = new Map<string, RadarFrame>()
  for (const ts of input.scans) {
    const frame = radarFrameFromIso(ts, 'radar_list')
    if (frame) byStamp.set(frame.iemStamp, frame)
  }
  if (input.metaValid) {
    const latest = radarFrameFromIso(input.metaValid, 'n0q_meta')
    if (latest) byStamp.set(latest.iemStamp, latest)
  }
  return [...byStamp.values()].sort((a, b) => a.timestampIso.localeCompare(b.timestampIso))
}

export function pickLatestRadarFrame(frames: RadarFrame[]): RadarFrame | null {
  return frames[frames.length - 1] ?? null
}

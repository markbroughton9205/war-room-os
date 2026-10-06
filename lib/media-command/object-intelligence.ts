/**
 * Semantic object observations. Object recognition ≠ identity.
 * Do not name people. Track ids are visual continuity inside one analysis, not biometrics.
 */
import { fromSeconds, toSeconds, type MediaTime } from './time'
import type { VideoObservation } from './video-intelligence'
import { WAVE9_OBJECT_RECOMMENDATION } from './wave9-runtime-audit'

export const OBJECT_RECOGNITION_IDENTITY_LOCK = {
  objectRecognitionIsNotIdentity: true,
  doNotNamePeople: true,
  trackIdIsNotBiometric: true,
} as const

export type ObjectBBox = { x: number; y: number; width: number; height: number }

export type ObjectDetection = {
  id: string
  objectClass: string
  confidence: number
  bbox: ObjectBBox
  timeRange: { start: MediaTime; end: MediaTime }
  evidence: Array<{ kind: string; note: string; path?: string | null }>
  backend: string
  model: string | null
  trackId?: string | null
}

export type ObjectTrack = {
  trackId: string
  objectClass: string
  detections: ObjectDetection[]
  start: MediaTime
  end: MediaTime
  note: 'same tracked visual object within analysis — not biometric identity'
}

export type ObjectSearchHit = {
  timestamp: MediaTime
  objectClass: string
  confidence: number
  bbox: ObjectBBox | null
  trackId: string | null
  evidence: string
  source: 'object-observation'
}

const CLASS_ALIASES: Record<string, string[]> = {
  car: ['car', 'vehicle', 'automobile', 'truck'],
  dog: ['dog', 'canine'],
  person: ['person', 'people', 'human'],
  chair: ['chair'],
  phone: ['phone', 'cellphone', 'mobile'],
}

export function observationObjects(row: VideoObservation): ObjectDetection[] {
  const start = row.timeRange?.start ?? row.timestamp
  const end = row.timeRange?.end ?? row.timestamp
  return (row.objects ?? []).map((o, i) => {
    const extra = o as { objectClass?: string; bbox?: ObjectBBox; trackId?: string; backend?: string; model?: string; evidence?: ObjectDetection['evidence'] }
    return {
      id: o.id || `obj-${i}`,
      objectClass: extra.objectClass ?? o.label,
      confidence: o.confidence,
      bbox: extra.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
      timeRange: { start, end },
      evidence: extra.evidence ?? [{ kind: 'observation', note: o.label }],
      backend: extra.backend ?? 'none',
      model: extra.model ?? null,
      trackId: extra.trackId ?? null,
    }
  })
}

export function associateObjectTracks(dets: ObjectDetection[], iouMin = 0.4): ObjectTrack[] {
  const tracks: ObjectTrack[] = []
  const sorted = [...dets].sort((a, b) => toSeconds(a.timeRange.start) - toSeconds(b.timeRange.start))
  for (const det of sorted) {
    const last = [...tracks].reverse().find(t => t.objectClass === det.objectClass && iou(t.detections[t.detections.length - 1]?.bbox, det.bbox) >= iouMin)
    if (last) {
      last.detections.push({ ...det, trackId: last.trackId })
      last.end = det.timeRange.end
    } else {
      const trackId = `track-${tracks.length + 1}`
      tracks.push({
        trackId,
        objectClass: det.objectClass,
        detections: [{ ...det, trackId }],
        start: det.timeRange.start,
        end: det.timeRange.end,
        note: 'same tracked visual object within analysis — not biometric identity',
      })
    }
  }
  return tracks
}

function iou(a?: ObjectBBox, b?: ObjectBBox): number {
  if (!a || !b || a.width <= 0 || b.width <= 0) return 0
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

export function searchObjectObservations(rows: VideoObservation[], query: string): ObjectSearchHit[] {
  const q = query.trim().toLowerCase()
  const countMatch = q.match(/(\d+)\s+(people|person|persons|cars?|dogs?)/)
  const wantedCount = countMatch ? Number(countMatch[1]) : null
  const classKey = Object.keys(CLASS_ALIASES).find(k => q.includes(k) || CLASS_ALIASES[k].some(a => q.includes(a))) ?? q
  const aliases = CLASS_ALIASES[classKey] ?? [classKey]
  const hits: ObjectSearchHit[] = []
  for (const row of rows) {
    const dets = observationObjects(row).filter(d => aliases.some(a => d.objectClass.toLowerCase().includes(a)))
    if (wantedCount != null && dets.length < wantedCount) continue
    if (!dets.length && !wantedCount) continue
    if (!dets.length) continue
    const det = dets[0]
    hits.push({
      timestamp: det.timeRange.start,
      objectClass: det.objectClass,
      confidence: det.confidence,
      bbox: det.bbox.width > 0 ? det.bbox : null,
      trackId: det.trackId ?? null,
      evidence: `${dets.length} ${det.objectClass} @ ${toSeconds(det.timeRange.start).toFixed(3)}s backend=${det.backend}`,
      source: 'object-observation',
    })
  }
  return hits
}

export function objectBackendReady(): false {
  void WAVE9_OBJECT_RECOMMENDATION
  return false
}

export function placeholderObjectObservation(assetId: string): VideoObservation {
  return {
    assetId,
    timestamp: fromSeconds(0),
    scene: null,
    people: [],
    objects: [],
    actions: [],
    transcript: null,
    camera: null,
    effects: [],
    transition: null,
    color: null,
    audio_event: null,
    confidence: 0,
    evidence: [{ kind: 'install', note: 'OBJECT detector not installed. INSTALL_APPROVAL_REQUIRED. No invented cars/dogs.' }],
  }
}

/**
 * Video Intelligence foundation.
 * Analyzes authorized/local video only. No automatic internet scraping.
 * Process memory is not source of truth — jobs and observations persist per project/asset.
 *
 * IDENTITY BOUNDARY (locked):
 * person observation != identity
 * Allowed: person, person wearing red, person at timestamp, TrackSubject inside one clip
 * Not allowed: biometric identification, cross-video identity, cross-scene re-id, named-person recognition
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MediaTime } from './time'
import { mediaCommandDataHierarchy } from './paths'
import { createHvsJob, listJobs, saveJob, type HvsJob } from './jobs'
import { safeFsId } from './jobs'
import { stripSecrets } from './secrets'

export const VIDEO_OBSERVATION_SCHEMA = 1 as const

export const VI_IDENTITY_POLICY = {
  personObservationIsNotIdentity: true,
  allowed: [
    'person',
    'person wearing red',
    'person at timestamp',
    'tracked subject inside one clip',
  ],
  forbidden: [
    'biometric identification',
    'cross-video identity',
    'cross-scene re-identification',
    'named-person recognition',
  ],
} as const

export type VideoObservation = {
  id?: string
  assetId?: string
  timestamp: MediaTime
  timeRange?: { start: MediaTime; end: MediaTime } | null
  scene: string | null
  people: Array<{ id: string; label: string; confidence: number; box?: { x: number; y: number; width: number; height: number } }>
  objects: Array<{ id: string; label: string; confidence: number }>
  actions: Array<{ id: string; label: string; confidence: number }>
  transcript: string | null
  camera: { shotSize?: string; movement?: string; angle?: string } | null
  shotType?: string | null
  effects: string[]
  transition: string | null
  color: { temperature?: number; saturation?: number } | null
  audio_event: string | null
  audioEvents?: string[]
  confidence: number
  evidence?: Array<{ kind: string; note: string; path?: string | null; metric?: string | null }>
}

export type TechniqueRecord = {
  id: string
  name: string
  source: { assetId: string; projectId: string | null }
  time_range: { start: MediaTime; end: MediaTime }
  category: string
  edit_steps: string[]
  effects: string[]
  transitions: string[]
  camera_pattern: string[]
  timing_pattern: string[]
  audio_pattern: string[]
  color_pattern: string[]
  prerequisites: string[]
  confidence: number
  verifiedByHuman: boolean
}

export type VideoAnalysisJob = {
  id: string
  projectId: string
  assetId: string
  analysisKind?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stub' | 'cancelled' | 'blocked'
  backend?: string
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  completedAt?: string | null
  observationCount: number
  observationsPath?: string | null
  error: string | null
  metrics?: Record<string, unknown>
  provenance?: Record<string, unknown>
}

export type MediaSearchQuery = {
  text?: string
  person?: string
  shotSize?: string
  transcriptContains?: string
  object?: string
  action?: string
  timestampSec?: number
  motion?: string
  audioState?: string
  sceneBoundary?: boolean
}

export type MediaSearchHit = {
  assetId: string
  start: MediaTime
  end: MediaTime
  reason: string
  confidence: number
  evidence?: string
  metric?: string | number
}

export interface MediaSearchIndex {
  indexObservations(assetId: string, observations: VideoObservation[]): void
  search(query: MediaSearchQuery): MediaSearchHit[]
}

export class InMemoryMediaSearchIndex implements MediaSearchIndex {
  private observations = new Map<string, VideoObservation[]>()

  indexObservations(assetId: string, observations: VideoObservation[]): void {
    this.observations.set(assetId, observations)
  }

  search(query: MediaSearchQuery): MediaSearchHit[] {
    const hits: MediaSearchHit[] = []
    for (const [assetId, rows] of this.observations.entries()) {
      for (const row of rows) {
        const start = row.timeRange?.start ?? row.timestamp
        const end = row.timeRange?.end ?? row.timestamp
        if (query.timestampSec != null) {
          const t = query.timestampSec
          const a = start.timescale ? start.ticks / start.timescale : 0
          const b = end.timescale ? end.ticks / end.timescale : a
          if (t < a - 0.05 || t > b + 0.05) continue
        }
        if (query.sceneBoundary && row.scene !== 'SCENE_BOUNDARY' && row.transition !== 'cut') continue
        const hay = [
          row.scene ?? '',
          row.transcript ?? '',
          ...row.people.map(p => p.label),
          ...row.objects.map(o => o.label),
          ...row.actions.map(a => a.label),
          row.camera?.shotSize ?? '',
          row.camera?.movement ?? '',
          row.shotType ?? '',
          ...(row.audioEvents ?? []),
          row.audio_event ?? '',
        ].join(' ').toLowerCase()
        if (query.motion && !hay.includes(query.motion.toLowerCase())) continue
        if (query.audioState && !hay.includes(query.audioState.toLowerCase())) continue
        const needles = [query.text, query.person, query.shotSize, query.transcriptContains, query.object, query.action]
          .filter((v): v is string => Boolean(v))
          .map(v => v.toLowerCase())
        const hasFilter = needles.length > 0 || query.timestampSec != null || Boolean(query.motion) || Boolean(query.audioState) || Boolean(query.sceneBoundary)
        if (!hasFilter) continue
        if (needles.length && !needles.every(n => hay.includes(n))) continue
        hits.push({
          assetId,
          start,
          end,
          reason: row.actions[0]?.label ?? row.scene ?? row.transcript ?? 'observation',
          confidence: row.confidence,
        })
      }
    }
    return hits
  }
}

export type ObservationDocument = {
  schemaVersion: typeof VIDEO_OBSERVATION_SCHEMA
  projectId: string
  assetId: string
  assetChecksumSha256: string | null
  backend: string
  analysisConfig?: string
  createdAt: string
  observationCount: number
  observations: VideoObservation[]
}

export function analysisDir(projectId: string, assetId?: string): string {
  const root = path.join(mediaCommandDataHierarchy().analysis, safeFsId(projectId, 'project'))
  mkdirSync(root, { recursive: true })
  if (!assetId) return root
  const dir = path.join(root, safeFsId(assetId, 'asset'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function observationsPath(projectId: string, assetId: string): string {
  return path.join(analysisDir(projectId, assetId), 'observations.json')
}

export function validateObservationDocument(doc: ObservationDocument): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (doc.schemaVersion !== VIDEO_OBSERVATION_SCHEMA) errors.push('Unknown observation schema.')
  if (!doc.projectId || !doc.assetId) errors.push('Observation document missing project/asset.')
  if (!Array.isArray(doc.observations)) errors.push('observations must be an array.')
  if (doc.observationCount !== (doc.observations?.length ?? -1)) errors.push('observationCount mismatch.')
  for (const row of doc.observations ?? []) {
    if (!row.timestamp) errors.push('Observation missing timestamp.')
    if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1) errors.push('Observation confidence must be 0..1.')
    for (const person of row.people ?? []) {
      const label = person.label.toLowerCase()
      if (VI_IDENTITY_POLICY.forbidden.some(f => label.includes('biometric') || label.includes('identity-id'))) {
        errors.push('Identity-forbidden person label.')
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

export function writeObservations(doc: ObservationDocument): string {
  const file = observationsPath(doc.projectId, doc.assetId)
  const clean = stripSecrets(doc)
  const check = validateObservationDocument(clean)
  if (!check.ok) throw new Error(check.errors.join('; '))
  writeFileSync(file, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return file
}

export async function readObservations(projectId: string, assetId: string): Promise<ObservationDocument | null> {
  const file = observationsPath(projectId, assetId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ObservationDocument
  } catch {
    return null
  }
}

export class PersistentMediaSearchIndex implements MediaSearchIndex {
  private memory = new InMemoryMediaSearchIndex()

  indexObservations(assetId: string, observations: VideoObservation[]): void {
    this.memory.indexObservations(assetId, observations)
  }

  async loadFromDisk(projectId: string, assetId: string): Promise<void> {
    const doc = await readObservations(projectId, assetId)
    if (doc) this.memory.indexObservations(assetId, doc.observations)
  }

  search(query: MediaSearchQuery): MediaSearchHit[] {
    return this.memory.search(query)
  }
}

export const defaultMediaSearchIndex = new PersistentMediaSearchIndex()

export function observationIsNotIdentity(row: VideoObservation): boolean {
  const labels = row.people.map(p => p.label.toLowerCase())
  return labels.every(label => !label.includes('biometric') && !label.includes('re-id') && !label.includes('recognized as'))
}

export class VideoIntelligenceService {
  listJobs(projectId?: string): VideoAnalysisJob[] {
    if (!projectId) return []
    try {
      return listJobs(projectId)
        .filter(j => j.kind === 'analysis')
        .map(hvsJobToAnalysis)
    } catch {
      return []
    }
  }

  async getObservationsFor(projectId: string, assetId: string): Promise<VideoObservation[]> {
    const doc = await readObservations(projectId, assetId)
    return doc?.observations ?? []
  }

  getObservations(assetId: string): VideoObservation[] {
    void assetId
    return []
  }

  getTechniques(_projectId?: string): TechniqueRecord[] {
    return []
  }

  startWatch(input: { projectId: string; assetId: string; checksumSha256?: string | null }): VideoAnalysisJob {
    const job = saveJob(createHvsJob({
      kind: 'analysis',
      projectId: input.projectId,
      backend: 'local-ffmpeg-vision',
      status: 'QUEUED',
      inputs: { assetId: input.assetId, checksumSha256: input.checksumSha256 ?? null },
      provenance: { createdBy: 'system', capability: 'VISION_ANALYSIS', notes: 'Wave 1 persists AnalysisJob without executing analysis. Not COMPLETED.' },
    }))
    return hvsJobToAnalysis(job)
  }
}

function hvsJobToAnalysis(job: HvsJob): VideoAnalysisJob {
  const assetId = typeof job.inputs.assetId === 'string' ? job.inputs.assetId : ''
  const statusMap: Record<string, VideoAnalysisJob['status']> = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    BLOCKED: 'blocked',
    BLOCKED_PENDING_APPROVAL: 'blocked',
  }
  return {
    id: job.id,
    projectId: job.projectId,
    assetId,
    analysisKind: 'video-observation',
    status: statusMap[job.status] ?? 'queued',
    backend: job.backend,
    createdAt: job.createdAt,
    updatedAt: job.completedAt ?? job.startedAt ?? job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    observationCount: typeof job.outputs.observationCount === 'number' ? job.outputs.observationCount : 0,
    observationsPath: typeof job.outputs.observationsPath === 'string' ? job.outputs.observationsPath : null,
    error: job.error,
    metrics: job.metrics,
    provenance: job.provenance,
  }
}

export const videoIntelligence = new VideoIntelligenceService()

/** Deletes derived analysis only. Never deletes source media / originals. */
export function deleteDerivedAnalysis(projectId: string, assetId?: string): { deleted: string[]; originalsUntouched: true } {
  const deleted: string[] = []
  const root = analysisDir(projectId, assetId)
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        unlinkSync(full)
        deleted.push(full)
      }
    }
  }
  walk(root)
  return { deleted, originalsUntouched: true }
}

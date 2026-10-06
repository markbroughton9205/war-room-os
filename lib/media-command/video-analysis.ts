/**
 * Wave 2 real Video Intelligence execution.
 * Local FFmpeg only. No Whisper / CLIP / SAM2. Transcript stays null.
 * Person observation is not identity.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { probeMediaFile } from './probe'
import { fromSeconds, toSeconds } from './time'
import type { HvsProject, TrackSubject } from './types'
import { findAsset } from './types'
import type { MediaSearchQuery } from './video-intelligence'
import {
  createHvsJob,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  saveJob,
  type HvsJob,
} from './jobs'
import {
  VIDEO_OBSERVATION_SCHEMA,
  defaultMediaSearchIndex,
  observationsPath,
  validateObservationDocument,
  writeObservations,
  type ObservationDocument,
  type VideoObservation,
  type MediaSearchHit,
} from './video-intelligence'
import { mediaCommandDataHierarchy } from './paths'
import { HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED } from './policy'
import { writeCacheMeta } from './cache'

export type MotionClass = 'LOW MOTION' | 'MEDIUM MOTION' | 'HIGH MOTION'

export const VI_ANALYSIS_CONFIG = 'vi-ffmpeg-v1'

export type AnalysisExecutionResult = {
  job: HvsJob
  document: ObservationDocument | null
  durationMs: number
  error: string | null
  cacheHit: boolean
}

function num(re: RegExp, text: string): number | null {
  const m = text.match(re)
  return m ? Number(m[1]) : null
}

function motionClass(yavg: number): MotionClass {
  if (yavg >= 6) return 'HIGH MOTION'
  if (yavg >= 2) return 'MEDIUM MOTION'
  return 'LOW MOTION'
}

function cameraHeuristic(yavg: number): { movement: string; confidence: number } {
  if (yavg < 2) return { movement: 'STATIC', confidence: 0.4 }
  return { movement: 'MOTION', confidence: 0.45 }
}

function shotTypeFromBox(box: { width: number; height: number } | null): { shotType: string; confidence: number } | null {
  if (!box) return null
  if (box.height >= 0.5) return { shotType: 'CLOSE-UP', confidence: 0.42 }
  if (box.height >= 0.25) return { shotType: 'MEDIUM', confidence: 0.4 }
  return { shotType: 'WIDE', confidence: 0.35 }
}

function subjectBoxAt(subject: TrackSubject | undefined, sec: number): { width: number; height: number; x: number; y: number } | null {
  if (!subject?.keyframes?.length) return null
  const ticks = Math.round(sec * (subject.keyframes[0].time.timescale || 24000))
  let prev = subject.keyframes[0]
  for (const kf of subject.keyframes) {
    if (kf.time.ticks >= ticks) {
      return { x: kf.x, y: kf.y, width: kf.width, height: kf.height }
    }
    prev = kf
  }
  void prev
  const last = subject.keyframes[subject.keyframes.length - 1]
  return { x: last.x, y: last.y, width: last.width, height: last.height }
}

function parseMotionLog(text: string): Array<{ t: number; yavg: number }> {
  const rows: Array<{ t: number; yavg: number }> = []
  let t: number | null = null
  for (const line of text.split(/\n/)) {
    const pts = num(/pts_time:([0-9.]+)/, line)
    if (pts != null) t = pts
    const yavg = num(/lavfi\.signalstats\.YAVG=([0-9.]+)/, line)
    if (yavg != null && t != null) {
      rows.push({ t, yavg })
      t = null
    }
  }
  return rows
}

function parseSceneLog(text: string): Array<{ t: number; score: number | null }> {
  const rows: Array<{ t: number; score: number | null }> = []
  let t: number | null = null
  for (const line of text.split(/\n/)) {
    const pts = num(/pts_time:([0-9.]+)/, line)
    if (pts != null) t = pts
    const score = num(/lavfi\.scene_score=([0-9.]+)/, line)
    if (t != null && (score != null || /frame:/.test(line) === false)) {
      if (score != null) {
        rows.push({ t, score })
        t = null
      }
    }
  }
  return rows
}

function parseSilenceLog(stderr: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start: number | null = null
  for (const line of stderr.split(/\n/)) {
    const s = num(/silence_start:\s*([0-9.]+)/, line)
    if (s != null) start = s
    const e = num(/silence_end:\s*([0-9.]+)/, line)
    if (e != null && start != null) {
      ranges.push({ start, end: e })
      start = null
    }
  }
  return ranges
}

function inSilence(t: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some(r => t >= r.start && t <= r.end)
}

function audioLabel(rms: number, silent: boolean): string {
  if (silent || rms < 0.02) return 'SILENCE'
  if (rms < 0.08) return 'LOW ENERGY'
  return 'AUDIO ACTIVE'
}

async function windowedAudioRms(ffmpeg: string, source: string, durationSec: number): Promise<Array<{ t: number; rms: number }>> {
  const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-vi')
  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `pcm-${process.pid}.s16`)
  const run = await runProcess(ffmpeg, [
    '-hide_banner', '-y', '-i', source, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', raw,
  ], 60_000)
  if (!run.ok || !existsSync(raw)) return []
  const buf = readFileSync(raw)
  try { unlinkSync(raw) } catch { /* tmp */ }
  const sr = 8000
  const window = 0.5
  const samplesPer = Math.floor(sr * window)
  const out: Array<{ t: number; rms: number }> = []
  const count = Math.max(1, Math.floor(buf.length / 2 / samplesPer))
  for (let w = 0; w < count; w++) {
    let sum = 0
    const start = w * samplesPer
    for (let i = 0; i < samplesPer; i++) {
      const idx = (start + i) * 2
      if (idx + 1 >= buf.length) break
      const s = buf.readInt16LE(idx) / 32768
      sum += s * s
    }
    out.push({ t: w * window, rms: Math.sqrt(sum / samplesPer) })
  }
  void durationSec
  return out
}

export async function executeVideoAnalysis(input: {
  project: HvsProject
  assetId: string
  force?: boolean
  analysisConfig?: string
}): Promise<AnalysisExecutionResult> {
  const started = Date.now()
  const fail = (job: HvsJob): AnalysisExecutionResult => ({ job, document: null, durationMs: Date.now() - started, error: job.error, cacheHit: false })
  const asset = findAsset(input.project, input.assetId)
  const analysisConfig = input.analysisConfig ?? VI_ANALYSIS_CONFIG
  const cacheKey = `${input.project.id}:${input.assetId}:${asset?.checksumSha256 ?? 'none'}:${analysisConfig}`
  const existing = loadObservationsSync(input.project.id, input.assetId)
  const storedConfig = existing?.analysisConfig ?? VI_ANALYSIS_CONFIG
  const fingerprintMatch = Boolean(
    existing
    && existing.assetChecksumSha256
    && asset?.checksumSha256
    && existing.assetChecksumSha256 === asset.checksumSha256
    && existing.backend === 'local-ffmpeg-vision'
    && storedConfig === analysisConfig,
  )
  if (!input.force && fingerprintMatch && existing) {
    let job = saveJob(createHvsJob({
      kind: 'analysis',
      projectId: input.project.id,
      backend: 'local-ffmpeg-vision',
      status: 'QUEUED',
      inputs: { assetId: input.assetId, checksumSha256: asset?.checksumSha256 ?? null, analysisConfig },
      provenance: { createdBy: 'system', capability: 'VISION_ANALYSIS', notes: 'Wave 3 analysis cache hit. Same fingerprint + config.' },
    }))
    job = markJobCompleted(job, {
      observationsPath: observationsPath(input.project.id, input.assetId),
      observationCount: existing.observationCount,
      cacheHit: true,
    })
    job.metrics = { ...job.metrics, cacheHit: true, cacheMiss: false, executionDurationMs: Date.now() - started }
    job = saveJob(job)
    writeCacheMeta({
      key: cacheKey,
      category: 'analysis',
      createdAt: new Date().toISOString(),
      size: existing.observationCount,
      sourceFingerprint: asset?.checksumSha256 ?? null,
      backend: 'local-ffmpeg-vision',
      hit: true,
      miss: false,
      path: observationsPath(input.project.id, input.assetId),
    })
    return { job, document: existing, durationMs: Date.now() - started, error: null, cacheHit: true }
  }
  let job = saveJob(createHvsJob({
    kind: 'analysis',
    projectId: input.project.id,
    backend: 'local-ffmpeg-vision',
    status: 'QUEUED',
      inputs: { assetId: input.assetId, checksumSha256: asset?.checksumSha256 ?? null, analysisConfig, force: Boolean(input.force) },
    provenance: { createdBy: 'system', capability: 'VISION_ANALYSIS', notes: 'Wave 3 local FFmpeg analysis cache miss.' },
  }))
  job.metrics = { ...job.metrics, cacheHit: false, cacheMiss: true }
  if (!HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED) {
    job = markJobFailed(job, 'Local analysis execution is not authorized.')
    return fail(job)
  }
  if (!asset?.originalPath || !existsSync(asset.originalPath)) {
    job = markJobFailed(job, 'Asset original missing. Analysis cannot run.')
    return fail(job)
  }
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg || !tools.ffprobe) {
    job = markJobFailed(job, 'Bundled ffmpeg/ffprobe missing.')
    return fail(job)
  }
  job = markJobRunning(job)
  try {
    const probed = await probeMediaFile(asset.originalPath)
    const duration = probed.durationSec || toSeconds(asset.duration)
    const dir = path.join(mediaCommandDataHierarchy().tmp, 'hvs-wave2-vi')
    mkdirSync(dir, { recursive: true })
    const motionFile = path.join(dir, `${job.id}-motion.txt`)
    const sceneFile = path.join(dir, `${job.id}-scene.txt`)
    const motion = await runProcess(tools.ffmpeg, [
      '-hide_banner', '-y', '-i', asset.originalPath,
      '-vf', `fps=2,tblend=all_mode=difference,format=gray,signalstats,metadata=print:file=${motionFile}`,
      '-an', '-f', 'null', '-',
    ], 120_000)
    if (!motion.ok) throw new Error(motion.stderr.slice(-300) || 'Motion analysis failed.')
    const scene = await runProcess(tools.ffmpeg, [
      '-hide_banner', '-y', '-i', asset.originalPath,
      '-vf', `select='gt(scene,0.2)',metadata=print:file=${sceneFile}`,
      '-an', '-vsync', 'vfr', '-f', 'null', '-',
    ], 120_000)
    void scene
    const silence = await runProcess(tools.ffmpeg, [
      '-hide_banner', '-i', asset.originalPath,
      '-af', 'silencedetect=noise=-35dB:d=0.25',
      '-f', 'null', '-',
    ], 60_000)
    const motionRows = existsSync(motionFile) ? parseMotionLog(readFileSync(motionFile, 'utf8')) : []
    const sceneRows = existsSync(sceneFile) ? parseSceneLog(readFileSync(sceneFile, 'utf8')) : []
    const silenceRanges = parseSilenceLog(silence.stderr)
    const rmsRows = probed.hasAudio ? await windowedAudioRms(tools.ffmpeg, asset.originalPath, duration) : []
    const subject = input.project.timeline.subjects.find(s => s.assetId === asset.id || s.clipId)

    const observations: VideoObservation[] = []
    // One honest shot covering the whole clip when FFmpeg reports no scene cuts.
    observations.push({
      id: `${job.id}-shot-0`,
      assetId: asset.id,
      timestamp: fromSeconds(0),
      timeRange: { start: fromSeconds(0), end: fromSeconds(duration) },
      scene: sceneRows.length ? 'SCENE_BOUNDARY' : 'SHOT',
      people: [],
      objects: [],
      actions: [],
      transcript: null,
      camera: { movement: 'unspecified', shotSize: undefined },
      shotType: null,
      effects: [],
      transition: null,
      color: null,
      audio_event: probed.hasAudio ? 'AUDIO ACTIVE' : null,
      audioEvents: probed.hasAudio ? ['AUDIO ACTIVE'] : [],
      confidence: 0.9,
      evidence: [
        {
          kind: 'ffprobe',
          note: `${probed.width}x${probed.height} ${probed.codec ?? 'unknown'} duration=${duration.toFixed(3)}s audio=${probed.hasAudio ? 'yes' : 'no'}`,
        },
        {
          kind: 'ffmpeg-scene',
          note: sceneRows.length === 0
            ? 'No hard cut exceeded scene_score 0.2. Single-take shot spanning the asset.'
            : `${sceneRows.length} scene-score events.`,
        },
      ],
    })

    for (const cut of sceneRows) {
      observations.push({
        id: `${job.id}-cut-${cut.t.toFixed(3)}`,
        assetId: asset.id,
        timestamp: fromSeconds(cut.t),
        timeRange: { start: fromSeconds(cut.t), end: fromSeconds(Math.min(duration, cut.t + 0.04)) },
        scene: 'SCENE_BOUNDARY',
        people: [],
        objects: [],
        actions: [],
        transcript: null,
        camera: null,
        shotType: null,
        effects: [],
        transition: 'cut',
        color: null,
        audio_event: null,
        audioEvents: [],
        confidence: 0.55,
        evidence: [{ kind: 'ffmpeg-scene', note: `scene_score=${cut.score ?? 'unspecified'}`, metric: cut.score != null ? String(cut.score) : null }],
      })
    }

    for (const row of motionRows) {
      const cls = motionClass(row.yavg)
      const cam = cameraHeuristic(row.yavg)
      const box = subjectBoxAt(subject, row.t)
      const shot = shotTypeFromBox(box)
      const rms = rmsRows.find(a => Math.abs(a.t - row.t) < 0.26)?.rms ?? rmsRows.find(a => a.t <= row.t)?.rms ?? 0
      const silent = inSilence(row.t, silenceRanges)
      const audio = probed.hasAudio ? audioLabel(rms, silent) : null
      const people: VideoObservation['people'] = box
        ? [{ id: `${asset.id}-person`, label: 'person', confidence: 0.5, box: { x: box.x, y: box.y, width: box.width, height: box.height } }]
        : []
      observations.push({
        id: `${job.id}-mot-${row.t.toFixed(2)}`,
        assetId: asset.id,
        timestamp: fromSeconds(row.t),
        timeRange: { start: fromSeconds(row.t), end: fromSeconds(Math.min(duration, row.t + 0.5)) },
        scene: null,
        people,
        objects: [],
        actions: [{ id: `${job.id}-act-${row.t.toFixed(2)}`, label: cls, confidence: 0.7 }],
        transcript: null,
        camera: { movement: cam.movement, shotSize: shot?.shotType },
        shotType: shot?.shotType ?? null,
        effects: [],
        transition: null,
        color: null,
        audio_event: audio,
        audioEvents: audio ? [audio] : [],
        confidence: 0.7,
        evidence: [
          { kind: 'ffmpeg-motion', note: `tblend difference YAVG=${row.yavg.toFixed(3)} → ${cls}` },
          ...(audio ? [{ kind: 'ffmpeg-audio', note: `window RMS=${rms.toFixed(4)} → ${audio}` }] : []),
          ...(shot ? [{ kind: 'track-subject-heuristic', note: `${shot.shotType} is a box-height heuristic, not certainty. Person observation is not identity.` }] : []),
        ],
      })
    }

    const doc: ObservationDocument = {
      schemaVersion: VIDEO_OBSERVATION_SCHEMA,
      projectId: input.project.id,
      assetId: asset.id,
      assetChecksumSha256: asset.checksumSha256 ?? null,
      backend: 'local-ffmpeg-vision',
      analysisConfig,
      createdAt: new Date().toISOString(),
      observationCount: observations.length,
      observations,
    }
    const check = validateObservationDocument(doc)
    if (!check.ok) throw new Error(check.errors.join('; '))
    const file = writeObservations(doc)
    defaultMediaSearchIndex.indexObservations(asset.id, observations)
    job = markJobCompleted(job, {
      observationsPath: file,
      observationCount: observations.length,
      probe: {
        duration,
        width: probed.width,
        height: probed.height,
        codec: probed.codec,
        hasAudio: probed.hasAudio,
      },
    })
    job.metrics = { ...job.metrics, executionDurationMs: Date.now() - started, cacheHit: false, cacheMiss: true }
    job = saveJob(job)
    writeCacheMeta({
      key: cacheKey,
      category: 'analysis',
      createdAt: new Date().toISOString(),
      size: doc.observationCount,
      sourceFingerprint: asset.checksumSha256 ?? null,
      backend: 'local-ffmpeg-vision',
      hit: false,
      miss: true,
      path: observationsPath(input.project.id, input.assetId),
    })
    return { job, document: doc, durationMs: Date.now() - started, error: null, cacheHit: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed.'
    job = markJobFailed(job, message)
    return { job, document: null, durationMs: Date.now() - started, error: message, cacheHit: false }
  }
}

export const WAVE2_MOTION_QUERY_VALUES = ['LOW MOTION', 'MEDIUM MOTION', 'HIGH MOTION', 'HIGH', 'MEDIUM', 'LOW'] as const
export const WAVE2_AUDIO_QUERY_VALUES = ['SILENCE', 'AUDIO ACTIVE', 'LOW ENERGY'] as const

export type Wave2SearchQuery = MediaSearchQuery & {
  timestampSec?: number
  motion?: (typeof WAVE2_MOTION_QUERY_VALUES)[number]
  audioState?: (typeof WAVE2_AUDIO_QUERY_VALUES)[number]
  sceneBoundary?: boolean
}

/** A raw request value as one of the values the search understands, or null when it is not one of them. Case does not matter. */
export function parseWave2QueryValue<T extends string>(raw: string | null | undefined, allowed: readonly T[]): T | null {
  const wanted = (raw ?? '').trim().toUpperCase()
  return allowed.find(value => value === wanted) ?? null
}

function motionNeedle(value: Wave2SearchQuery['motion']): string | null {
  if (!value) return null
  if (value === 'HIGH' || value === 'HIGH MOTION') return 'high motion'
  if (value === 'MEDIUM' || value === 'MEDIUM MOTION') return 'medium motion'
  if (value === 'LOW' || value === 'LOW MOTION') return 'low motion'
  return String(value).toLowerCase()
}

export function searchPersistedObservations(doc: ObservationDocument, query: Wave2SearchQuery): MediaSearchHit[] {
  const hits: MediaSearchHit[] = []
  for (const row of doc.observations) {
    const start = row.timeRange?.start ?? row.timestamp
    const end = row.timeRange?.end ?? row.timestamp
    if (query.timestampSec != null) {
      const t = query.timestampSec
      if (t < toSeconds(start) - 0.05 || t > toSeconds(end) + 0.05) continue
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
    const motion = motionNeedle(query.motion)
    if (motion && !hay.includes(motion)) continue
    if (query.audioState && !hay.includes(query.audioState.toLowerCase())) continue
    const lexical = [query.text, query.person, query.shotSize, query.transcriptContains, query.object, query.action]
      .filter((v): v is string => Boolean(v))
      .map(v => v.toLowerCase())
    if (lexical.length && !lexical.every(n => hay.includes(n))) continue
    if (
      query.timestampSec == null
      && !motion
      && !query.audioState
      && !query.sceneBoundary
      && lexical.length === 0
    ) continue
    hits.push({
      assetId: doc.assetId,
      start,
      end,
      reason: row.actions[0]?.label ?? row.scene ?? row.audio_event ?? 'observation',
      confidence: row.confidence,
      evidence: row.evidence?.map(e => e.note).join(' | ') ?? row.scene ?? row.audio_event ?? 'observation',
      metric: row.evidence?.find(e => e.kind === 'ffmpeg-motion')?.note ?? row.confidence,
    })
  }
  return hits.sort((a, b) => b.confidence - a.confidence)
}

export function highestMotionHit(doc: ObservationDocument): MediaSearchHit | null {
  let best: { hit: MediaSearchHit; y: number } | null = null
  for (const row of doc.observations) {
    const action = row.actions.find(a => /motion/i.test(a.label))
    if (!action) continue
    const rank = action.label.includes('HIGH') ? 3 : action.label.includes('MEDIUM') ? 2 : 1
    const ev = row.evidence?.find(e => e.kind === 'ffmpeg-motion')
    const y = Number(ev?.note.match(/YAVG=([0-9.]+)/)?.[1] ?? rank)
    const start = row.timeRange?.start ?? row.timestamp
    const end = row.timeRange?.end ?? row.timestamp
    if (!best || y > best.y) {
      best = {
        y,
        hit: { assetId: doc.assetId, start, end, reason: action.label, confidence: row.confidence },
      }
    }
  }
  return best?.hit ?? null
}

export function loadObservationsSync(projectId: string, assetId: string): ObservationDocument | null {
  const file = observationsPath(projectId, assetId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ObservationDocument
  } catch {
    return null
  }
}

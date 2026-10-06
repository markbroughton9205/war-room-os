/**
 * HVS QC job. Analyzes a final render. Findings have type/severity/range/evidence/detector.
 * Does not claim editorial quality judgment.
 */
import { existsSync } from 'node:fs'
import { createHvsJob, markJobCompleted, markJobFailed, markJobRunning, saveJob, type HvsJob } from './jobs'
import { runDeterministicQc } from './tool-kernel/qc'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { probeMediaFile } from './probe'
import { fromSeconds, type MediaTime } from './time'
import { HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED } from './policy'

export type QcSeverity = 'info' | 'warn' | 'fail'

export type QcFinding = {
  type: string
  severity: QcSeverity
  start: MediaTime | null
  end: MediaTime | null
  evidence: string
  detector: string
  confidence: number | null
}

export type QcJobResult = {
  job: HvsJob
  findings: QcFinding[]
  probe: {
    width: number | null
    height: number | null
    fps: number | null
    durationSec: number
    codec: string | null
    pixelFormat: string | null
    audioSampleRate: number | null
    hasSubtitles: boolean
  } | null
  error: string | null
}

function parseRanges(stderr: string, startKey: string, endKey: string): Array<{ start: number; end: number }> {
  const starts = [...stderr.matchAll(new RegExp(`${startKey}\\s*:\\s*([0-9.]+)`, 'g'))].map(m => Number(m[1]))
  const ends = [...stderr.matchAll(new RegExp(`${endKey}\\s*:\\s*([0-9.]+)`, 'g'))].map(m => Number(m[1]))
  return starts.map((s, i) => ({ start: s, end: ends[i] ?? s }))
}

function parseAstatsPeak(stderr: string): number | null {
  const m = stderr.match(/Peak level dB:\s*(-?[0-9.]+)/)
  return m ? Number(m[1]) : null
}

export async function executeQcJob(input: {
  projectId: string
  filePath: string
  expected?: { width?: number; height?: number; fps?: number; durationSec?: number }
}): Promise<QcJobResult> {
  let job = saveJob(createHvsJob({
    kind: 'qc',
    projectId: input.projectId,
    backend: 'ffmpeg-qc',
    status: 'QUEUED',
    inputs: { file: input.filePath },
    provenance: { createdBy: 'system', capability: 'QC', notes: 'Wave 9 technical QC. Not editorial judgment.' },
  }))
  const fail = (error: string): QcJobResult => ({ job, findings: [], probe: null, error })
  if (!HVS_WAVE2_LOCAL_ENGINE_EXECUTION_AUTHORIZED) {
    job = markJobFailed(job, 'Local QC execution is not authorized.')
    return fail(job.error ?? 'unauthorized')
  }
  if (!existsSync(input.filePath)) {
    job = markJobFailed(job, 'QC target missing. Missing media.')
    return {
      job,
      findings: [{ type: 'missing_media', severity: 'fail', start: null, end: null, evidence: input.filePath, detector: 'exists', confidence: 1 }],
      probe: null,
      error: job.error,
    }
  }
  job = markJobRunning(job)
  const tools = await resolveFfmpegTools()
  const probed = await probeMediaFile(input.filePath)
  const kernel = await runDeterministicQc(input.filePath)
  const findings: QcFinding[] = []
  const fps = probed.frameRateN && probed.frameRateD ? probed.frameRateN / probed.frameRateD : null
  let hasSubtitles = false
  if (tools.ffprobe) {
    const sub = await runProcess(tools.ffprobe, ['-v', 'error', '-show_streams', '-select_streams', 's', '-print_format', 'json', input.filePath], 30_000)
    try {
      const parsed = JSON.parse(sub.stdout || '{}') as { streams?: unknown[] }
      hasSubtitles = (parsed.streams?.length ?? 0) > 0
    } catch { hasSubtitles = false }
  }
  if (!probed.hasVideo) findings.push({ type: 'missing_video', severity: 'fail', start: null, end: null, evidence: 'no video stream', detector: 'ffprobe', confidence: 1 })
  findings.push({
    type: 'resolution',
    severity: input.expected?.width && probed.width !== input.expected.width ? 'fail' : 'info',
    start: null, end: null,
    evidence: `${probed.width}x${probed.height}`,
    detector: 'ffprobe',
    confidence: 1,
  })
  findings.push({
    type: 'codec',
    severity: 'info',
    start: null, end: null,
    evidence: String(probed.codec ?? 'unknown'),
    detector: 'ffprobe',
    confidence: 1,
  })
  findings.push({
    type: 'duration',
    severity: 'info',
    start: fromSeconds(0),
    end: fromSeconds(probed.durationSec),
    evidence: `${probed.durationSec}s`,
    detector: 'ffprobe',
    confidence: 1,
  })
  findings.push({
    type: 'pixel_format',
    severity: 'info',
    start: null, end: null,
    evidence: String(probed.pixelFormat ?? 'unknown'),
    detector: 'ffprobe',
    confidence: 1,
  })
  findings.push({
    type: 'fps',
    severity: 'info',
    start: null, end: null,
    evidence: fps != null ? String(fps) : 'unknown',
    detector: 'ffprobe',
    confidence: 1,
  })
  findings.push({
    type: 'audio_sample_rate',
    severity: 'info',
    start: null, end: null,
    evidence: String(probed.sampleRate ?? 'none'),
    detector: 'ffprobe',
    confidence: 1,
  })
  findings.push({
    type: 'subtitle_presence',
    severity: 'info',
    start: null, end: null,
    evidence: hasSubtitles ? 'present' : 'absent',
    detector: 'ffprobe',
    confidence: 1,
  })

  if (tools.ffmpeg) {
    const detect = await runProcess(tools.ffmpeg, [
      '-hide_banner', '-i', input.filePath,
      '-af', 'silencedetect=n=-50dB:d=0.4,astats=metadata=1:reset=1',
      '-vf', 'blackdetect=d=0.4:pic_th=0.98,freezedetect=n=0.003:d=0.8',
      '-f', 'null', '-',
    ], 180_000)
    for (const r of parseRanges(detect.stderr, 'black_start', 'black_end')) {
      findings.push({ type: 'black_frames', severity: 'warn', start: fromSeconds(r.start), end: fromSeconds(r.end), evidence: `black ${r.start.toFixed(3)}–${r.end.toFixed(3)}s`, detector: 'blackdetect', confidence: 0.9 })
    }
    for (const r of parseRanges(detect.stderr, 'freeze_start', 'freeze_end')) {
      findings.push({ type: 'frozen_frames', severity: 'warn', start: fromSeconds(r.start), end: fromSeconds(r.end), evidence: `freeze ${r.start.toFixed(3)}–${r.end.toFixed(3)}s`, detector: 'freezedetect', confidence: 0.85 })
    }
    for (const r of parseRanges(detect.stderr, 'silence_start', 'silence_end')) {
      findings.push({ type: 'silence', severity: 'warn', start: fromSeconds(r.start), end: fromSeconds(r.end), evidence: `silence ${r.start.toFixed(3)}–${r.end.toFixed(3)}s`, detector: 'silencedetect', confidence: 0.9 })
    }
    const peakDb = parseAstatsPeak(detect.stderr)
    if (peakDb != null && peakDb >= -0.1) {
      findings.push({ type: 'audio_clipping', severity: 'fail', start: null, end: null, evidence: `peak ${peakDb} dBFS`, detector: 'astats', confidence: 0.95 })
    } else if (peakDb != null) {
      findings.push({ type: 'audio_clipping', severity: 'info', start: null, end: null, evidence: `peak ${peakDb} dBFS (not clipping)`, detector: 'astats', confidence: 0.95 })
    }
  }

  const implemented = new Set(findings.map(f => f.type))
  job = markJobCompleted(job, {
    findingsCount: findings.length,
    implementedDetectors: [...implemented],
    notClaimed: ['blur', 'focus', 'shake', 'editorial-quality', 'caption-overflow', 'logo-safe', 'continuity-story'],
    validState: true,
    outputPath: input.filePath,
    path: input.filePath,
    outcome: kernel.outcome,
    hash: kernel.hash,
    reportId: kernel.schema,
    ranAt: kernel.ranAt,
    kernelOutcome: kernel.outcome,
  })
  return {
    job,
    findings,
    probe: {
      width: probed.width,
      height: probed.height,
      fps,
      durationSec: probed.durationSec,
      codec: probed.codec ?? null,
      pixelFormat: probed.pixelFormat,
      audioSampleRate: probed.sampleRate,
      hasSubtitles,
    },
    error: null,
  }
}

export const QC_IMPLEMENTED_DETECTORS = [
  'missing_media',
  'black_frames',
  'frozen_frames',
  'audio_clipping',
  'silence',
  'resolution',
  'fps',
  'duration',
  'codec',
  'pixel_format',
  'audio_sample_rate',
  'subtitle_presence',
] as const

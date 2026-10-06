/**
 * ASR AnalysisJob. COMPLETED only after a valid transcript.json exists.
 * Without a local backend+model the job is BLOCKED_PENDING_APPROVAL.
 * No cloud upload. No silent model download.
 */
import { existsSync } from 'node:fs'
import {
  createHvsJob,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  saveJob,
  type HvsJob,
} from './jobs'
import { WAVE9_ASR_RECOMMENDATION } from './wave9-runtime-audit'
import {
  readTranscript,
  transcriptPath,
  validateTranscriptDocument,
  writeTranscript,
  type TranscriptDocument,
} from './transcript'
import { asrGateStatus } from './asr-gate'
import { buildAsrCacheKey } from './asr-runtime'
import { runHvsAsrAdapter } from './asr-adapter'
import { loadProject } from './store'
import { findAsset } from './types'

export type AsrRequest = {
  projectId: string
  assetId: string
  language?: string | null
}

export type AsrResult = {
  job: HvsJob
  transcript: TranscriptDocument | null
  transcriptPath: string | null
  status: HvsJob['status']
  install: typeof WAVE9_ASR_RECOMMENDATION
  error: string | null
  cacheHit?: boolean
  commanderError?: string | null
  advancedError?: string | null
}

export async function requestTranscription(input: AsrRequest): Promise<AsrResult> {
  const gate = asrGateStatus()
  let job = saveJob(createHvsJob({
    kind: 'analysis',
    projectId: input.projectId,
    backend: 'whisper.cpp',
    status: 'QUEUED',
    inputs: { assetId: input.assetId, language: input.language ?? 'en' },
    parameters: { capability: 'ASR_TRANSCRIPTION', model: 'ggml-tiny.en.bin' },
    provenance: { createdBy: 'human', capability: 'ASR_TRANSCRIPTION', notes: 'Local whisper.cpp ASR. No remote upload.' },
  }))
  if (!gate.usableNow) {
    job.status = 'BLOCKED_PENDING_APPROVAL'
    job.error = gate.status === 'ASR_MODEL_MISSING'
      ? 'ASR_MODEL_MISSING. Speech model is not installed. No invented transcript.'
      : 'ASR backend/model not installed. INSTALL_APPROVAL_REQUIRED. No silent download.'
    job.outputs = {
      install: WAVE9_ASR_RECOMMENDATION,
      usableNow: 'NO',
      asrStatus: gate.status,
    }
    job = saveJob(job)
    return {
      job,
      transcript: null,
      transcriptPath: null,
      status: job.status,
      install: WAVE9_ASR_RECOMMENDATION,
      error: job.error,
      cacheHit: false,
      commanderError: "I couldn't transcribe this clip.",
      advancedError: job.error,
    }
  }
  job = markJobRunning(job)
  if (job.status === 'CANCELLED') {
    return { job, transcript: null, transcriptPath: null, status: job.status, install: WAVE9_ASR_RECOMMENDATION, error: job.error, cacheHit: false }
  }
  const project = await loadProject(input.projectId)
  if (!project) {
    job = markJobFailed(job, 'Project not found. Refusing to invent speech.')
    return { job, transcript: null, transcriptPath: null, status: job.status, install: WAVE9_ASR_RECOMMENDATION, error: job.error, cacheHit: false, commanderError: "I couldn't transcribe this clip.", advancedError: job.error }
  }
  const asset = findAsset(project, input.assetId)
  const language = input.language ?? 'en'
  const cacheKey = asset?.checksumSha256 ? buildAsrCacheKey(asset.checksumSha256, language) : null
  const existing = await readTranscript(input.projectId, input.assetId)
  if (existing) {
    const file = transcriptPath(input.projectId, input.assetId)
    const check = validateTranscriptDocument(existing)
    const keyOk = !cacheKey || !existing.cacheKey || existing.cacheKey === cacheKey
    if (check.ok && existsSync(file) && existing.segments.some(seg => seg.text.trim()) && keyOk) {
      job = markJobCompleted(job, {
        transcriptPath: file,
        observationCount: existing.segments.length,
        validState: true,
        cacheHit: true,
        cacheKey: existing.cacheKey ?? cacheKey,
      })
      return { job, transcript: existing, transcriptPath: file, status: job.status, install: WAVE9_ASR_RECOMMENDATION, error: null, cacheHit: true }
    }
  }
  const ran = await runHvsAsrAdapter({ project, assetId: input.assetId, language })
  if (ran.transcript && ran.transcriptPath && ran.transcript.segments.some(seg => seg.text.trim())) {
    const durationSec = ran.transcript.duration ? (ran.transcript.duration.ticks / ran.transcript.duration.timescale) : 0
    const rtf = durationSec > 0 && ran.runtimeMs ? (ran.runtimeMs / 1000) / durationSec : null
    job = markJobCompleted(job, {
      transcriptPath: ran.transcriptPath,
      observationCount: ran.transcript.segments.length,
      wordCount: ran.transcript.segments.reduce((n, seg) => n + (seg.words?.length ?? 0), 0),
      validState: true,
      wordLevel: ran.wordLevel,
      cacheHit: ran.cacheHit,
      cacheKey: ran.transcript.cacheKey ?? cacheKey,
      runtimeMs: ran.runtimeMs,
      clipDurationSec: durationSec,
      realtimeFactor: rtf,
      remoteCalls: ran.remoteCalls,
    })
    return { job, transcript: ran.transcript, transcriptPath: ran.transcriptPath, status: job.status, install: WAVE9_ASR_RECOMMENDATION, error: null, cacheHit: ran.cacheHit }
  }
  job = markJobFailed(job, ran.commanderError ?? ran.error ?? "I couldn't transcribe this clip.")
  job.outputs = { ...job.outputs, advancedError: ran.advancedError ?? ran.error, remoteCalls: ran.remoteCalls }
  job = saveJob(job)
  return {
    job,
    transcript: null,
    transcriptPath: null,
    status: job.status,
    install: WAVE9_ASR_RECOMMENDATION,
    error: job.error,
    cacheHit: false,
    commanderError: ran.commanderError,
    advancedError: ran.advancedError ?? ran.error,
  }
}

export function asrCompletedOnlyWithFile(job: HvsJob, filePath: string | null): boolean {
  if (job.status !== 'COMPLETED') return true
  return Boolean(filePath && existsSync(filePath))
}

export function writeValidTranscriptOrThrow(doc: TranscriptDocument): string {
  const file = writeTranscript(doc)
  if (!existsSync(file)) throw new Error('Transcript write did not produce a file.')
  return file
}

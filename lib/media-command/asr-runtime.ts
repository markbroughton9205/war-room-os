/**
 * Local whisper.cpp inference. Never uploads audio. Never invents words.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { mediaCommandDataHierarchy } from './paths'
import { resolveFfmpegTools, runProcess } from './ffmpeg'
import { fromSeconds, toSeconds } from './time'
import {
  emptyTranscript,
  validateTranscriptDocument,
  writeTranscript,
  readTranscriptSync,
  transcriptPath,
  type TranscriptDocument,
  type TranscriptSegment,
  type TranscriptWord,
} from './transcript'
import { asrGateStatus, whisperBinaryPath, whisperModelPath } from './asr-gate'
import type { HvsProject } from './types'
import { findAsset } from './types'

export const SLICE4_COUNTS = {
  ASR_REMOTE_CALL_COUNT: 0,
  FAKE_TRANSCRIPT_COUNT: 0,
  EXISTING_CAPTION_OVERWRITE_COUNT: 0,
  WAR_ROOM_PRE_APPROVAL_MUTATION_COUNT: 0,
  ORIGINAL_MEDIA_MUTATION_COUNT: 0,
  UNAUTHORIZED_MODEL_DOWNLOAD_COUNT: 0,
  SECOND_HVS_PROJECT_TRUTH_COUNT: 0,
  SECOND_RENDER_ENGINE_COUNT: 0,
}

export const ASR_CACHE_CONFIG = 'whisper.cpp|ggml-tiny.en.bin|word-ts=1|no-gpu=1|ojf=1|sow=1'

export type AsrRunResult = {
  status: 'ASR_RUNTIME_READY' | 'ASR_MODEL_MISSING' | 'ASR_RUNTIME_MISSING' | 'ASR_FAILED'
  transcript: TranscriptDocument | null
  transcriptPath: string | null
  error: string | null
  advancedError?: string | null
  wordLevel: boolean
  remoteCalls: number
  cacheHit: boolean
  runtimeMs?: number
  clipDurationSec?: number
}

function parseClock(value: string): number {
  const clean = value.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1])
  return Number(clean) || 0
}

export function buildAsrCacheKey(fingerprint: string, language = 'en'): string {
  return createHash('sha256').update(`${fingerprint}|${ASR_CACHE_CONFIG}|${language}`).digest('hex')
}

function cacheFile(key: string): string {
  const dir = path.join(mediaCommandDataHierarchy().cache, 'asr')
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${key}.json`)
}

function isSpecialToken(text: string): boolean {
  return !text || text.startsWith('[_') || text === '[BLANK_AUDIO]'
}

function wordsFromTokens(tokens: Array<{
  text?: string
  offsets?: { from?: number; to?: number }
  p?: number
}>, fallbackStart: number, fallbackEnd: number): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const token of tokens) {
    const raw = String(token.text ?? '')
    if (isSpecialToken(raw.trim())) continue
    const start = typeof token.offsets?.from === 'number' ? token.offsets.from / 1000 : fallbackStart
    const end = typeof token.offsets?.to === 'number' ? token.offsets.to / 1000 : Math.max(fallbackEnd, start + 0.04)
    if (raw.startsWith(' ') || words.length === 0) {
      const text = raw.trim()
      if (!text) continue
      words.push({
        start: fromSeconds(start),
        end: fromSeconds(Math.max(end, start + 0.02)),
        text,
        confidence: typeof token.p === 'number' ? token.p : undefined,
      })
    } else {
      const last = words[words.length - 1]
      last.text += raw
      last.end = fromSeconds(Math.max(end, start + 0.02))
    }
  }
  return words.filter(word => word.text)
}

type WhisperRow = {
  start?: number
  end?: number
  timestamps?: { from?: string; to?: string }
  offsets?: { from?: number; to?: number }
  text?: string
  tokens?: Array<{ text?: string; offsets?: { from?: number; to?: number }; p?: number }>
  words?: Array<{ start?: number; end?: number; word?: string; text?: string; probability?: number }>
}

function segmentsFromWhisperJson(raw: string): { segments: TranscriptSegment[]; wordLevel: boolean } {
  try {
    const parsed = JSON.parse(raw) as {
      transcription?: Array<{
        timestamps?: { from?: string; to?: string }
        offsets?: { from?: number; to?: number }
        text?: string
        tokens?: Array<{ text?: string; offsets?: { from?: number; to?: number }; p?: number }>
        words?: Array<{ start?: number; end?: number; word?: string; text?: string; probability?: number }>
      }>
      segments?: Array<{
        start?: number
        end?: number
        text?: string
        words?: Array<{ start?: number; end?: number; word?: string; text?: string; probability?: number }>
      }>
    }
    const rows: WhisperRow[] = parsed.transcription ?? parsed.segments ?? []
    const segments: TranscriptSegment[] = []
    let wordLevel = false
    for (const row of rows) {
      const start = typeof row.start === 'number'
        ? row.start
        : typeof (row as { offsets?: { from?: number } }).offsets?.from === 'number'
          ? ((row as { offsets: { from: number } }).offsets.from / 1000)
          : parseClock((row as { timestamps?: { from?: string } }).timestamps?.from ?? '0')
      const end = typeof row.end === 'number'
        ? row.end
        : typeof (row as { offsets?: { to?: number } }).offsets?.to === 'number'
          ? ((row as { offsets: { to: number } }).offsets.to / 1000)
          : parseClock((row as { timestamps?: { to?: string } }).timestamps?.to ?? String(start))
      const text = String((row as { text?: string }).text ?? '').replace(/^\[.*?\]\s*/, '').trim()
      if (!text) continue
      const tokens = (row as { tokens?: Array<{ text?: string; offsets?: { from?: number; to?: number }; p?: number }> }).tokens
      const words = (row as { words?: Array<{ start?: number; end?: number; word?: string; text?: string; probability?: number }> }).words
      if (Array.isArray(tokens) && tokens.length) {
        const parsedWords = wordsFromTokens(tokens, start, end)
        wordLevel = wordLevel || parsedWords.length > 0
        segments.push({
          start: fromSeconds(start),
          end: fromSeconds(Math.max(end, start + 0.05)),
          text,
          words: parsedWords.length ? parsedWords : undefined,
        })
      } else if (Array.isArray(words) && words.length) {
        wordLevel = true
        segments.push({
          start: fromSeconds(start),
          end: fromSeconds(Math.max(end, start + 0.05)),
          text,
          words: words.map(word => ({
            start: fromSeconds(word.start ?? start),
            end: fromSeconds(word.end ?? end),
            text: String(word.word ?? word.text ?? '').trim(),
            confidence: typeof word.probability === 'number' ? word.probability : undefined,
          })).filter(word => word.text),
        })
      } else {
        segments.push({
          start: fromSeconds(start),
          end: fromSeconds(Math.max(end, start + 0.05)),
          text,
        })
      }
    }
    return { segments, wordLevel }
  } catch {
    return { segments: [], wordLevel: false }
  }
}

export async function extractSpeechWav(input: {
  sourcePath: string
  startSec?: number
  durationSec?: number
}): Promise<{ path: string | null; error: string | null }> {
  const tools = await resolveFfmpegTools()
  if (!tools.ffmpeg) return { path: null, error: 'FFmpeg is not available.' }
  if (!existsSync(input.sourcePath)) return { path: null, error: 'Source media is missing.' }
  const dirs = mediaCommandDataHierarchy()
  const dest = path.join(dirs.tmp, `asr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.wav`)
  mkdirSync(path.dirname(dest), { recursive: true })
  const args = ['-y', '-i', input.sourcePath]
  if (input.startSec && input.startSec > 0) args.push('-ss', input.startSec.toFixed(3))
  if (input.durationSec && input.durationSec > 0) args.push('-t', input.durationSec.toFixed(3))
  args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dest)
  const run = await runProcess(tools.ffmpeg, args, 60_000)
  if (!run.ok || !existsSync(dest)) return { path: null, error: run.stderr.slice(-400) || 'Audio extract failed.' }
  return { path: dest, error: null }
}

function adoptCached(doc: TranscriptDocument, projectId: string, assetId: string, cacheKey: string): TranscriptDocument {
  return {
    ...doc,
    projectId,
    assetId,
    cacheKey,
    createdAt: new Date().toISOString(),
  }
}

export async function transcribeWav(input: {
  wavPath: string
  projectId: string
  assetId: string
  durationSec?: number
  language?: string
  cacheKey?: string | null
}): Promise<AsrRunResult> {
  const started = Date.now()
  const gate = asrGateStatus()
  if (gate.status === 'ASR_RUNTIME_MISSING' || gate.status === 'ASR_RUNTIME_NOT_READY') {
    return { status: 'ASR_RUNTIME_MISSING', transcript: null, transcriptPath: null, error: 'Speech recognition is not installed.', wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  if (gate.status === 'ASR_MODEL_MISSING' || gate.status === 'ASR_MODEL_APPROVAL_REQUIRED') {
    return { status: 'ASR_MODEL_MISSING', transcript: null, transcriptPath: null, error: 'The speech model is not available.', wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  const binary = whisperBinaryPath()
  const model = whisperModelPath()
  if (!binary || !existsSync(model)) {
    return { status: 'ASR_FAILED', transcript: null, transcriptPath: null, error: 'Speech recognition could not start.', wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  const outBase = path.join(mediaCommandDataHierarchy().tmp, `whisper-${input.assetId}-${Date.now().toString(36)}`)
  const run = spawnSync(binary, [
    '-m', model,
    '-f', input.wavPath,
    '-l', input.language ?? 'en',
    '-ojf',
    '-sow',
    '-ng',
    '-np',
    '-of', outBase,
    '-t', '4',
  ], { encoding: 'utf8', timeout: 180_000, maxBuffer: 8_000_000 })
  if (run.status !== 0) {
    return {
      status: 'ASR_FAILED',
      transcript: null,
      transcriptPath: null,
      error: "I couldn't transcribe this clip.",
      advancedError: (run.stderr || run.stdout || 'whisper.cpp failed').slice(-800),
      wordLevel: false,
      remoteCalls: SLICE4_COUNTS.ASR_REMOTE_CALL_COUNT,
      cacheHit: false,
      runtimeMs: Date.now() - started,
    }
  }
  const jsonPath = existsSync(`${outBase}.json`) ? `${outBase}.json` : `${outBase}.wav.json`
  if (!existsSync(jsonPath)) {
    return { status: 'ASR_FAILED', transcript: null, transcriptPath: null, error: "I couldn't transcribe this clip.", advancedError: 'whisper.cpp did not write a transcript file.', wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  const parsed = segmentsFromWhisperJson(readFileSync(jsonPath, 'utf8'))
  try { unlinkSync(jsonPath) } catch { /* disposable */ }
  const doc = emptyTranscript(input.projectId, input.assetId)
  doc.backend = 'whisper.cpp'
  doc.model = 'ggml-tiny.en.bin'
  doc.language = input.language ?? 'en'
  doc.duration = fromSeconds(input.durationSec ?? (parsed.segments.at(-1) ? toSeconds(parsed.segments.at(-1)!.end) : 0))
  doc.segments = parsed.segments
  if (input.cacheKey) doc.cacheKey = input.cacheKey
  const check = validateTranscriptDocument(doc)
  if (!check.ok) {
    return { status: 'ASR_FAILED', transcript: null, transcriptPath: null, error: check.errors.join('; '), wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  if (!parsed.segments.length) {
    return {
      status: 'ASR_FAILED',
      transcript: null,
      transcriptPath: null,
      error: 'Speech was too unclear for reliable captions.',
      wordLevel: false,
      remoteCalls: 0,
      cacheHit: false,
      runtimeMs: Date.now() - started,
      clipDurationSec: input.durationSec,
    }
  }
  const file = writeTranscript(doc)
  if (input.cacheKey) {
    writeFileSync(cacheFile(input.cacheKey), `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  }
  return {
    status: 'ASR_RUNTIME_READY',
    transcript: doc,
    transcriptPath: file,
    error: null,
    wordLevel: parsed.wordLevel,
    remoteCalls: SLICE4_COUNTS.ASR_REMOTE_CALL_COUNT,
    cacheHit: false,
    runtimeMs: Date.now() - started,
    clipDurationSec: input.durationSec,
  }
}

export async function transcribeAsset(input: {
  project: HvsProject
  assetId: string
  startSec?: number
  durationSec?: number
  language?: string
}): Promise<AsrRunResult> {
  const started = Date.now()
  const asset = findAsset(input.project, input.assetId)
  if (!asset) {
    return { status: 'ASR_FAILED', transcript: null, transcriptPath: null, error: 'That clip is not in this project.', wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  const language = input.language ?? 'en'
  const fingerprint = asset.checksumSha256 || ''
  const cacheKey = fingerprint ? buildAsrCacheKey(fingerprint, language) : null
  if (cacheKey) {
    const existing = readTranscriptSync(input.project.id, asset.id)
    if (existing?.cacheKey === cacheKey && existing.segments.some(seg => seg.text.trim())) {
      return {
        status: 'ASR_RUNTIME_READY',
        transcript: existing,
        transcriptPath: transcriptPath(input.project.id, asset.id),
        error: null,
        wordLevel: existing.segments.some(seg => (seg.words?.length ?? 0) > 0),
        remoteCalls: 0,
        cacheHit: true,
        runtimeMs: Date.now() - started,
        clipDurationSec: toSeconds(asset.duration),
      }
    }
    const cachedFile = cacheFile(cacheKey)
    if (existsSync(cachedFile)) {
      try {
        const cached = JSON.parse(readFileSync(cachedFile, 'utf8')) as TranscriptDocument
        if (cached.segments?.some(seg => seg.text.trim())) {
          const adopted = adoptCached(cached, input.project.id, asset.id, cacheKey)
          const check = validateTranscriptDocument(adopted)
          if (check.ok) {
            const file = writeTranscript(adopted)
            return {
              status: 'ASR_RUNTIME_READY',
              transcript: adopted,
              transcriptPath: file,
              error: null,
              wordLevel: adopted.segments.some(seg => (seg.words?.length ?? 0) > 0),
              remoteCalls: 0,
              cacheHit: true,
              runtimeMs: Date.now() - started,
              clipDurationSec: toSeconds(asset.duration),
            }
          }
        }
      } catch { /* miss */ }
    }
  }
  const wav = await extractSpeechWav({
    sourcePath: asset.originalPath,
    startSec: input.startSec,
    durationSec: input.durationSec,
  })
  if (!wav.path) {
    return { status: 'ASR_FAILED', transcript: null, transcriptPath: null, error: wav.error, wordLevel: false, remoteCalls: 0, cacheHit: false, runtimeMs: Date.now() - started }
  }
  try {
    return await transcribeWav({
      wavPath: wav.path,
      projectId: input.project.id,
      assetId: asset.id,
      durationSec: input.durationSec ?? toSeconds(asset.duration),
      language,
      cacheKey,
    })
  } finally {
    try {
      if (wav.path.includes(`${path.sep}asr-`) && existsSync(wav.path)) unlinkSync(wav.path)
    } catch { /* disposable derived audio */ }
  }
}

export async function transcribeTimelineAssets(project: HvsProject): Promise<{
  documents: TranscriptDocument[]
  status: AsrRunResult['status']
  error: string | null
  wordLevel: boolean
  cacheHits: number
}> {
  const gate = asrGateStatus()
  if (gate.status !== 'ASR_RUNTIME_READY' && gate.status !== 'READY') {
    return { documents: [], status: gate.status === 'ASR_MODEL_MISSING' || gate.status === 'ASR_MODEL_APPROVAL_REQUIRED' ? 'ASR_MODEL_MISSING' : gate.status === 'ASR_FAILED' ? 'ASR_FAILED' : 'ASR_RUNTIME_MISSING', error: 'Speech recognition is not ready.', wordLevel: false, cacheHits: 0 }
  }
  const used = new Set<string>()
  for (const track of project.timeline.tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue
    for (const clip of track.clips) used.add(clip.assetId)
  }
  if (!used.size) {
    for (const asset of project.assets) {
      if (asset.kind === 'video' || asset.kind === 'audio') used.add(asset.id)
    }
  }
  const documents: TranscriptDocument[] = []
  let wordLevel = false
  let lastError: string | null = null
  let cacheHits = 0
  for (const assetId of used) {
    const asset = findAsset(project, assetId)
    if (!asset || asset.generated || asset.kind === 'generated') continue
    if (asset.provenance?.origin === 'render') continue
    const result = await transcribeAsset({ project, assetId })
    if (result.cacheHit) cacheHits += 1
    if (result.transcript?.segments.length) {
      documents.push(result.transcript)
      wordLevel = wordLevel || result.wordLevel
    } else {
      lastError = result.error
    }
  }
  if (!documents.length) {
    return { documents: [], status: 'ASR_FAILED', error: lastError ?? 'Speech was too unclear for reliable captions.', wordLevel: false, cacheHits }
  }
  return { documents, status: 'ASR_RUNTIME_READY', error: null, wordLevel, cacheHits }
}

export function writeAsrProvenanceNote(file: string, payload: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

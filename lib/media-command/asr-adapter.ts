/**
 * HVS AnalysisJob → local ASR adapter → whisper.cpp subprocess → TranscriptDocument.
 * whisper.cpp is a tool, not project truth.
 */
import { asrGateStatus } from './asr-gate'
import { transcribeAsset, type AsrRunResult } from './asr-runtime'
import { syncWhisperModelCatalog } from './asr-catalog'
import type { HvsProject } from './types'
import type { TranscriptDocument } from './transcript'

export const ASR_COMMANDER_ERRORS = {
  failed: "I couldn't transcribe this clip.",
  unclear: 'Speech was too unclear for reliable captions.',
} as const

export const ASR_COMMANDER_OPTIONS = ['TRY AGAIN', 'SKIP CAPTIONS', 'ADVANCED DETAILS'] as const

export type HvsAsrAdapterInput = {
  project: HvsProject
  assetId: string
  language?: string | null
  analysisConfig?: Record<string, unknown>
}

export type HvsAsrAdapterOutput = {
  transcript: TranscriptDocument | null
  transcriptPath: string | null
  cacheHit: boolean
  status: AsrRunResult['status']
  error: string | null
  commanderError: string | null
  advancedError: string | null
  runtimeMs: number
  wordLevel: boolean
  remoteCalls: number
  model: ReturnType<typeof syncWhisperModelCatalog>
}

export function commanderAsrError(raw: string | null | undefined, emptySpeech: boolean): string {
  if (emptySpeech) return ASR_COMMANDER_ERRORS.unclear
  const text = (raw ?? '').toLowerCase()
  if (/unclear|no_speech|could not hear|empty|no spoken/.test(text)) return ASR_COMMANDER_ERRORS.unclear
  return ASR_COMMANDER_ERRORS.failed
}

export async function runHvsAsrAdapter(input: HvsAsrAdapterInput): Promise<HvsAsrAdapterOutput> {
  const started = Date.now()
  const model = syncWhisperModelCatalog()
  const gate = asrGateStatus()
  if (!gate.usableNow) {
    return {
      transcript: null,
      transcriptPath: null,
      cacheHit: false,
      status: gate.status === 'ASR_MODEL_MISSING' || gate.status === 'ASR_MODEL_APPROVAL_REQUIRED'
        ? 'ASR_MODEL_MISSING'
        : gate.status === 'ASR_FAILED' ? 'ASR_FAILED' : 'ASR_RUNTIME_MISSING',
      error: gate.status === 'ASR_MODEL_MISSING' ? 'The speech model is not available.' : 'Speech recognition is not installed.',
      commanderError: ASR_COMMANDER_ERRORS.failed,
      advancedError: gate.status,
      runtimeMs: Date.now() - started,
      wordLevel: false,
      remoteCalls: 0,
      model,
    }
  }
  const ran = await transcribeAsset({
    project: input.project,
    assetId: input.assetId,
    language: input.language ?? 'en',
  })
  const empty = !ran.transcript?.segments.some(seg => seg.text.trim())
  return {
    transcript: ran.transcript,
    transcriptPath: ran.transcriptPath,
    cacheHit: ran.cacheHit,
    status: ran.status,
    error: ran.error,
    commanderError: ran.transcript && !empty ? null : commanderAsrError(ran.error, empty),
    advancedError: ran.advancedError ?? ran.error,
    runtimeMs: ran.runtimeMs ?? Date.now() - started,
    wordLevel: ran.wordLevel,
    remoteCalls: ran.remoteCalls,
    model,
  }
}

export class HvsAsrAdapter {
  async transcribe(input: HvsAsrAdapterInput): Promise<HvsAsrAdapterOutput> {
    return runHvsAsrAdapter(input)
  }
}

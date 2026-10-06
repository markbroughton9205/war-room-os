/**
 * Natural language → typed `hvs.generate.video` op. Pure (shared by AI Director and the Create panel).
 * Output is a proposal object only: it never executes, never reaches Python, and freeform LLM text
 * cannot launch anything. Execution requires the Commander to confirm in the UI (POST → validated contract).
 */
import { HVS_GENERATE_VIDEO_OP, WAN22_LIMITS, type HvsGenerateVideoOp } from './types'

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
const NON_VIDEO = /\b(voice|voiceover|narration|music|song|soundtrack|sfx|sound effects?|caption|subtitle|title card|logo|thumbnail|transcri\w+)\b/i
const STILL_ONLY = /\b(image|photo|picture|still|poster)\b/i
const FROM_SOURCE_IMAGE = /\b(from|using|animate)\s+(this|the|my|selected)\s+(image|photo|picture|still)\b|\bimage[- ]to[- ]video\b|\banimate (this|the) (image|photo|picture|still)\b/i
const VIDEO_NOUN = /\b(shot|video|clip|footage|b-?roll|scene|sequence)\b/i

export type ParseGenerateContext = { projectId?: string; selectedImageAssetId?: string | null }

export type ParsedGenerateVideo = { op: HvsGenerateVideoOp; notes: string[] } | null

export function looksLikeGenerateVideoUtterance(text: string): boolean {
  const lower = text.toLowerCase()
  if (!/\bgenerat(e|ing)\b/.test(lower) && !/\b(text|image)[- ]to[- ]video\b/.test(lower)) return false
  if (NON_VIDEO.test(lower)) return false
  if (!VIDEO_NOUN.test(lower) && !/\b(text|image)[- ]to[- ]video\b/.test(lower)) return false
  if (STILL_ONLY.test(lower) && !FROM_SOURCE_IMAGE.test(lower)) return false
  return true
}

export function parseGenerateVideoUtterance(utterance: string, context: ParseGenerateContext = {}): ParsedGenerateVideo {
  const text = utterance.trim().replace(/\s+/g, ' ')
  if (!text || text.length > 2000 || !looksLikeGenerateVideoUtterance(text)) return null
  const notes: string[] = []
  let duration: number = WAN22_LIMITS.maxDurationSeconds
  const numeric = text.match(/(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b/i)
  const worded = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)[- ](?:seconds?|secs?)\b/i)
  if (numeric) duration = Number(numeric[1])
  else if (worded) duration = WORD_NUMBERS[worded[1].toLowerCase()]
  else notes.push(`No duration given; using ${WAN22_LIMITS.maxDurationSeconds} s.`)
  if (duration > WAN22_LIMITS.maxDurationSeconds) {
    notes.push(`Requested ${duration} s; Wan 2.2 TI2V-5B generates at most ${WAN22_LIMITS.maxFrames} frames (~${WAN22_LIMITS.maxDurationSeconds} s) per clip. Proposed ${WAN22_LIMITS.maxDurationSeconds} s.`)
    duration = WAN22_LIMITS.maxDurationSeconds
  }
  if (duration < WAN22_LIMITS.minDurationSeconds) duration = WAN22_LIMITS.minDurationSeconds
  const vertical = /\b(vertical|portrait|9:16|tiktok|reels?|shorts)\b/i.test(text)
  const seedMatch = text.match(/\bseed\s*[:#]?\s*(\d{1,10})\b/i)
  const seed = seedMatch ? Number(seedMatch[1]) : undefined

  let prompt = text
    .replace(/^(please\s+)?(can you\s+)?(generate|create|make)\s+(me\s+)?(an?\s+)?/i, '')
    .replace(/(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b[- ]?(long)?/i, '')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)[- ](?:seconds?|secs?)\b[- ]?(long)?/i, '')
    .replace(/\bseed\s*[:#]?\s*\d{1,10}\b/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,-]+|[\s.]+$/g, '')
  if (prompt.length < WAN22_LIMITS.promptMinChars) prompt = text
  prompt = prompt.slice(0, WAN22_LIMITS.promptMaxChars)

  let sourceImageAssetId: string | undefined
  if (FROM_SOURCE_IMAGE.test(text)) {
    if (context.selectedImageAssetId) sourceImageAssetId = context.selectedImageAssetId
    else notes.push('Image-to-video requested but no image asset is selected; proposing text-to-video. Pick a source image from your assets.')
  }
  const op: HvsGenerateVideoOp = {
    op: HVS_GENERATE_VIDEO_OP,
    request: {
      ...(context.projectId ? { projectId: context.projectId } : {}),
      prompt,
      durationSeconds: duration,
      ...(vertical ? { width: 704, height: 1280 } : {}),
      ...(seed !== undefined && seed <= WAN22_LIMITS.seedMax ? { seed } : {}),
      ...(sourceImageAssetId ? { sourceImageAssetId } : {}),
    },
    execute: false,
    source: 'natural-language',
  }
  notes.push('Local Wan 2.2 generation proposal. Nothing runs until you confirm. Not inserted into the timeline.')
  return { op, notes }
}

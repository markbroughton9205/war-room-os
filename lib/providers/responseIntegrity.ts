import { toDisplayText } from '@/lib/council/toDisplayText'

/**
 * Provider response integrity validation — pure heuristics; no I/O.
 * HTTP 200 alone does not imply a complete, usable council/operator response.
 */

export type ResponseIntegrityStatus =
  | 'COMPLETE'
  | 'INCOMPLETE'
  | 'TRUNCATED'
  | 'MALFORMED'
  | 'EMPTY'
  | 'UNKNOWN'

export type ResponseIntegrityExpectation = {
  /** Minimum trimmed character count (default 80 for council prose). */
  minLength?: number
  /** When true, validate ``` fence parity. */
  markdown?: boolean
  /** When set, body must parse as JSON and optionally match keys. */
  jsonSchema?: { requiredKeys?: string[] }
  /** Section headers that should appear (case-insensitive substring match). */
  requiredSections?: string[]
}

export type ResponseIntegrityResult = {
  integrity_status: ResponseIntegrityStatus
  confidence: number
  reason: string
  retry_recommended: boolean
  fallback_recommended: boolean
}

const SENTENCE_END = /[.!?…]["')\]]*\s*$/u
const OPEN_TAIL = /(?:\b(?:and|or|but|because|that|which|when|where|while|the|a|an)\s+)$/i
const TRUNCATED_WORD = /\b\w{2,}\s*$/m
const BROKEN_BULLET = /(?:^|\n)\s*[-*•]\s*$/m
const CLIPPED_ELLIPSIS_END = /…\s*$/
const BROKEN_SYNC_TAIL = /\s*(?:sync|syncing|synchroni[sz]e?|synchroni[sz]ing)\w*$/i

/** Known Gemini / council truncation patterns observed in production. */
const PARTIAL_HEADING_TAIL =
  /(?:^|\n)\s*(?:decision\s+summary|executive\s+summary|summary)\s*:\s*(?:the\s+)?(?:war\s+room|incomplete|partial|can\s+improve)\b/i
const ABRUPT_SECTION_STUB = /:\s*(?:the\s+)?(?:incomplete|partial|war\s+room\s+can)\s*$/i
const REPEATED_PARTIAL_PHRASE = /^(?:decision\s+summary:\s*)?(?:the\s+)?(?:war\s+room|incomplete)\b/i

const REFUSAL_PATTERNS = [
  /\b(i\s+can(?:not|'t)|i'm\s+unable\s+to|as\s+an\s+ai)\b[^.!?]{0,80}\b(assist|help|comply|provide)\b/i,
  /\b(safety|content)\s+policy\b/i,
  /\brefus(?:e|al)\b/i,
]

const STREAM_INTERRUPT_MARKERS = [
  /\[\s*truncated\s*\]/i,
  /\[\s*stream\s+interrupted\s*\]/i,
  /<\/think>/i,
  /\[DONE\]\s*$/i,
]

const DEFAULT_MIN_LENGTH = 80

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function fenceOpenCount(text: string): number {
  return (text.match(/```/g) ?? []).length % 2
}

function hasRequiredSections(text: string, sections: string[]): string | null {
  const lower = text.toLowerCase()
  const missing = sections.filter(section => !lower.includes(section.toLowerCase()))
  return missing.length ? `missing sections: ${missing.join(', ')}` : null
}

function validateJson(text: string, requiredKeys?: string[]): string | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'JSON root must be an object'
    }
    if (requiredKeys?.length) {
      const obj = parsed as Record<string, unknown>
      const missing = requiredKeys.filter(key => !(key in obj))
      if (missing.length) return `JSON missing keys: ${missing.join(', ')}`
    }
    return null
  } catch {
    return 'invalid JSON'
  }
}

function detectRepeatedPartialPhrase(text: string): boolean {
  const t = text.trim()
  if (t.length > 200) return false
  if (REPEATED_PARTIAL_PHRASE.test(t)) return true
  if (PARTIAL_HEADING_TAIL.test(t) && t.length < 160) return true
  const firstLine = t.split('\n')[0]?.trim() ?? ''
  if (firstLine.length >= 12 && firstLine === t) {
    const words = firstLine.split(/\s+/)
    if (words.length <= 8 && !SENTENCE_END.test(firstLine)) return true
  }
  return false
}

function abruptEnding(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (SENTENCE_END.test(t)) return false
  if (ABRUPT_SECTION_STUB.test(t)) return true
  if (PARTIAL_HEADING_TAIL.test(t)) return true
  if (TRUNCATED_WORD.test(t) && t.length < 220) return true
  if (OPEN_TAIL.test(t) && t.length >= 40) return true
  if (BROKEN_BULLET.test(t)) return true
  if (CLIPPED_ELLIPSIS_END.test(t)) return true
  if (BROKEN_SYNC_TAIL.test(t)) return true
  if (t.length >= 200 && !SENTENCE_END.test(t)) return true
  return false
}

function refusalOrErrorText(text: string): string | null {
  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(text)) return 'provider refusal or policy block detected'
  }
  for (const pattern of STREAM_INTERRUPT_MARKERS) {
    if (pattern.test(text)) return 'stream interruption marker detected'
  }
  return null
}

/**
 * Validate provider text for completeness and structure.
 */
export function validateProviderResponseIntegrity(
  raw: unknown,
  expectation: ResponseIntegrityExpectation = {},
): ResponseIntegrityResult {
  const minLength = expectation.minLength ?? DEFAULT_MIN_LENGTH
  let text = toDisplayText(raw).replace(/\r\n/g, '\n').trim()

  if (BROKEN_SYNC_TAIL.test(text)) {
    text = text.replace(BROKEN_SYNC_TAIL, '').trim()
  }

  if (!text) {
    return {
      integrity_status: 'EMPTY',
      confidence: 95,
      reason: 'empty or whitespace-only response',
      retry_recommended: true,
      fallback_recommended: true,
    }
  }

  if (text.length < 12) {
    return {
      integrity_status: 'EMPTY',
      confidence: 90,
      reason: `near-empty response (${text.length} chars)`,
      retry_recommended: true,
      fallback_recommended: true,
    }
  }

  const refusal = refusalOrErrorText(text)
  if (refusal) {
    return {
      integrity_status: 'MALFORMED',
      confidence: 85,
      reason: refusal,
      retry_recommended: false,
      fallback_recommended: true,
    }
  }

  if (detectRepeatedPartialPhrase(text)) {
    return {
      integrity_status: 'TRUNCATED',
      confidence: 88,
      reason: 'repeated partial phrase or stub heading pattern',
      retry_recommended: true,
      fallback_recommended: true,
    }
  }

  if (expectation.jsonSchema || text.startsWith('{') || text.startsWith('[')) {
    const jsonErr = validateJson(text, expectation.jsonSchema?.requiredKeys)
    if (jsonErr) {
      return {
        integrity_status: 'MALFORMED',
        confidence: 82,
        reason: jsonErr,
        retry_recommended: true,
        fallback_recommended: true,
      }
    }
  }

  if (expectation.markdown !== false && fenceOpenCount(text) === 1) {
    return {
      integrity_status: 'TRUNCATED',
      confidence: 86,
      reason: 'unclosed markdown code fence',
      retry_recommended: true,
      fallback_recommended: true,
    }
  }

  if (expectation.requiredSections?.length) {
    const sectionErr = hasRequiredSections(text, expectation.requiredSections)
    if (sectionErr) {
      return {
        integrity_status: 'INCOMPLETE',
        confidence: 78,
        reason: sectionErr,
        retry_recommended: true,
        fallback_recommended: true,
      }
    }
  }

  if (text.length < minLength) {
    const truncatedLike = abruptEnding(text) || PARTIAL_HEADING_TAIL.test(text)
    return {
      integrity_status: truncatedLike ? 'TRUNCATED' : 'INCOMPLETE',
      confidence: truncatedLike ? 84 : 72,
      reason: `response under minimum length (${text.length}/${minLength})`,
      retry_recommended: true,
      fallback_recommended: true,
    }
  }

  if (abruptEnding(text)) {
    return {
      integrity_status: 'TRUNCATED',
      confidence: 80,
      reason: 'abrupt ending or incomplete sentence structure',
      retry_recommended: true,
      fallback_recommended: true,
    }
  }

  if (!SENTENCE_END.test(text) && text.length >= 120) {
    return {
      integrity_status: 'INCOMPLETE',
      confidence: 68,
      reason: 'no sentence terminator on substantial body',
      retry_recommended: true,
      fallback_recommended: false,
    }
  }

  return {
    integrity_status: 'COMPLETE',
    confidence: clampConfidence(92 - (text.length < minLength + 40 ? 8 : 0)),
    reason: 'response passed integrity heuristics',
    retry_recommended: false,
    fallback_recommended: false,
  }
}

/** Operator/council-safe placeholder when integrity fails. */
export function operatorSafeIncompleteMessage(kind: 'fallback' | 'unavailable'): string {
  if (kind === 'fallback') return 'Provider response incomplete; fallback summary used'
  return 'Provider response unavailable'
}

/** True when text must not appear in Operator View or council wall. */
export function isOperatorUnsafeProviderFragment(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  const integrity = validateProviderResponseIntegrity(t, { minLength: 60 })
  if (integrity.integrity_status !== 'COMPLETE') return true
  if (PARTIAL_HEADING_TAIL.test(t) && t.length < 200) return true
  if (REPEATED_PARTIAL_PHRASE.test(t)) return true
  return false
}

export function shortenPromptForRetry(prompt: string, maxChars = 1200): string {
  const trimmed = prompt.trim()
  if (trimmed.length <= maxChars) return trimmed
  const head = trimmed.slice(0, Math.floor(maxChars * 0.65)).trim()
  const tail = trimmed.slice(-Math.floor(maxChars * 0.25)).trim()
  return `${head}\n\n[… context trimmed for retry …]\n\n${tail}`
}

import { toDisplayText } from '@/lib/council/toDisplayText'

const TRUNCATED_WORD = /\b\w{2,}\s*$/m
const BROKEN_BULLET = /(?:^|\n)\s*[-*•]\s*$/m
const CLIPPED_ELLIPSIS_END = /…\s*$/
/** Truncated tool / sync boilerplate tails (mid-token cutoffs from caps or stream ends). */
const BROKEN_SYNC_TAIL = /\s*(?:sync|syncing|synchroni[sz]e?|synchroni[sz]ing)\w*$/i

export type ResponseIntegrityResult = {
  text: string
  integrityWarnings: string[]
}

function lastSentenceBoundaryIndex(s: string): number {
  let best = -1
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i]
    if (c === '.' || c === '?' || c === '!') {
      const next = s[i + 1]
      if (next === undefined || /\s/.test(next)) {
        best = i
        break
      }
    }
  }
  return best
}

/** Trim only at `.` `?` `!` followed by whitespace or EOS. */
function trimAtSentenceBoundary(text: string): string {
  const t = text.trim()
  const ix = lastSentenceBoundaryIndex(t)
  if (ix < 0) return t
  return t.slice(0, ix + 1).trim()
}

function detectIntegrityIssues(text: string): string[] {
  const w: string[] = []
  const t = text.trim()
  if (!t) return w
  if (TRUNCATED_WORD.test(t) && !/[.!?]\s*$/.test(t)) {
    w.push('integrity_truncated_terminal_word')
  }
  if (BROKEN_BULLET.test(t)) {
    w.push('integrity_broken_bullet')
  }
  if (CLIPPED_ELLIPSIS_END.test(t) && !/[.!?]\s*$/.test(t)) {
    w.push('integrity_clipped_ellipsis')
  }
  if (/^\s*[-*•]\s*$/m.test(t)) {
    w.push('integrity_empty_bullet_block')
  }
  return w
}

/**
 * Conservative repair: trim back to last sentence boundary only.
 * If still malformed, keep best-effort text and emit drift warnings (no LLM regen).
 */
export function repairOrFlagResponse(raw: unknown): ResponseIntegrityResult {
  const integrityWarnings: string[] = []
  let text = toDisplayText(raw).replace(/\r\n/g, '\n').trim()
  if (!text) return { text: '', integrityWarnings: [] }

  if (BROKEN_SYNC_TAIL.test(text)) {
    text = text.replace(BROKEN_SYNC_TAIL, '').trim()
    integrityWarnings.push('integrity_stripped_broken_sync_tail')
  }

  const initial = detectIntegrityIssues(text)
  if (initial.length) {
    const trimmed = trimAtSentenceBoundary(text)
    const after = detectIntegrityIssues(trimmed)
    text = trimmed
    if (after.length) {
      integrityWarnings.push('protocol_drift_response_shape', ...after)
    } else {
      integrityWarnings.push('integrity_trimmed_at_sentence_boundary')
    }
  }

  return { text, integrityWarnings }
}

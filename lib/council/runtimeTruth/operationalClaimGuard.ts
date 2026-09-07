/**
 * Runtime-truth enforcement: detect operational claims (restarted, back online, verified healthy,
 * repaired, deployed, ...) in Council text and rewrite any that have no matching evidence in the
 * current round's ledger to an honest UNKNOWN/NOT EXECUTED framing before the text is rendered,
 * persisted, or fed into AURORA synthesis.
 *
 * This is a practical, sentence-level regex classifier, not a full NLP model -- it is deliberately
 * biased toward catching real fabrication (the mission's authoritative rule: operational claims
 * require operational evidence) while trying not to mangle hedged/future/quoted language. It runs
 * from lib/council/runtimeTruth/enforceOperationalTruth, called once from validateProviderResults()
 * in app/api/chat/execute.ts -- the single boundary every seat result (stable-group turn, Nebula
 * seat, and AURORA's own synthesis) already passes through before it can be displayed or persisted.
 */

import { findMatchingEvidence, type RoundEvidenceLedger } from './evidenceLedger'

type ClaimCategory = 'restart' | 'health' | 'generic_action'

type ClaimPattern = {
  category: ClaimCategory
  regex: RegExp
}

/**
 * Each pattern matches a *completed-action* phrasing. Deliberately broader than the mission's
 * literal word list (e.g. "back online", "holding steady" alongside "restarted", "verified") --
 * the mission explicitly asks not to rely on the exact word list alone.
 */
const CLAIM_PATTERNS: ClaimPattern[] = [
  {
    category: 'restart',
    regex:
      /\bback\s+online\b|\bback\s+up\s+and\s+running\b|\bonline\s+again\b|\b(?:is|are|'s|'re)\s+(?:now\s+)?(?:online|up\s+and\s+running)\b|\b(?:has|have)\s+(?:been\s+|just\s+)?restarted\b|\bwas\s+restarted\b|\brestarted\s+successfully\b/i,
  },
  {
    category: 'health',
    regex:
      /\b(?:is|are|remains?|'s|'re)\s+(?:now\s+)?(?:healthy|stable|holding\s+steady|operational|good\s+to\s+go)\b|\bhealth\s+(?:confirmed|verified)\b|\bverification\s+(?:complete|successful)\b|\b(?:has\s+been|was)\s+verified\b|\bconfirmed\s+healthy\b|\bstatus:?\s*healthy\b/i,
  },
  {
    category: 'generic_action',
    regex:
      /\b(?:has\s+been|have\s+been|was|were)\s+(?:fixed|repaired|deployed|synchroni[sz]ed|connected|executed|completed|recovered|restored|activated|disabled|enabled|updated|changed|cleared|validated)\b|\btested\s+successfully\b/i,
  },
]

/** A sentence already framed with honest uncertainty is left alone -- never re-flag it. */
const ALREADY_HEDGED =
  /\b(not\s+executed|unknown|unverified|unavailable|was\s+not|wasn'?t|did\s+not|didn'?t|no\s+evidence|cannot\s+confirm|unable\s+to\s+confirm|not\s+performed|not\s+verified|no\s+runtime\s+(?:proof|evidence))\b/i

/** A suggestion/plan/question about a future action is not a completion claim. */
const FUTURE_OR_HEDGE_MARKER =
  /\b(should|will|let'?s|need\s+to|needs\s+to|must|going\s+to|plan\s+to|would|could|might|if\s+we|before\s+we|once\s+we|can\s+you|please)\b/i

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Single capitalized words that are almost always sentence-initial function/command words rather
 * than a genuine proper-noun resource name -- excluded so e.g. "Is Ollama reachable?" doesn't yield
 * "Is" as a spurious single-word candidate ahead of the real one.
 */
const CANDIDATE_STOPWORDS = new Set([
  'is', 'are', 'the', 'a', 'an', 'i', 'we', 'us', 'you', 'he', 'she', 'it', 'they', 'please',
  'council', 'restart', 'verify', 'confirm', 'check', 'research', 'give', 'tell', 'show', 'and',
  'or', 'take', 'your', 'time', 'use',
])

/** Capitalized (multi-word) phrases from the decree -- candidate named resources a claim refers to. */
export function extractCandidateResources(decreeText: string): string[] {
  const matches = decreeText.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    // A run of capitalized words often leads with the sentence-initial command verb
    // ("Restart Signal Radar" -> "Restart" isn't part of the resource name) -- strip leading
    // stopword tokens before treating what's left as a candidate.
    const tokens = m.trim().split(/\s+/)
    while (tokens.length > 1 && CANDIDATE_STOPWORDS.has(tokens[0].toLowerCase())) tokens.shift()
    const trimmed = tokens.join(' ')
    if (!trimmed || trimmed.split(/\s+/).length > 4) continue // empty, or unlikely to be a resource name
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    if (!trimmed.includes(' ') && CANDIDATE_STOPWORDS.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/**
 * Picks the candidate resource whose mention in `sentence` sits closest to `matchIndex` -- a
 * sentence can name more than one resource ("Signal Radar back online... Terra is holding
 * steady"), so proximity to the specific claim, not just "appears anywhere in the sentence",
 * decides which one a given claim is about.
 */
function guessResource(sentence: string, candidates: string[], matchIndex: number): string {
  const lower = sentence.toLowerCase()
  let best: { candidate: string; distance: number } | null = null
  for (const candidate of candidates) {
    const needle = candidate.toLowerCase()
    let from = 0
    while (true) {
      const at = lower.indexOf(needle, from)
      if (at === -1) break
      const distance = Math.abs(at - matchIndex)
      if (!best || distance < best.distance) best = { candidate, distance }
      from = at + needle.length
    }
  }
  return best?.candidate ?? 'The system'
}

function rewriteSentence(category: ClaimCategory, resource: string): string {
  if (category === 'health') {
    return `${resource} health was not verified in this round.`
  }
  if (category === 'restart') {
    return `${resource} restart was not executed in this round, so its current status is UNKNOWN.`
  }
  return `${resource} action was not executed in this round, so its current status is UNKNOWN.`
}

export type OperationalTruthResult = {
  text: string
  corrected: boolean
  flagged: { sentence: string; category: ClaimCategory; resource: string }[]
}

/**
 * Scans `text` sentence-by-sentence for unsupported operational claims and rewrites only the
 * offending sentences (never the whole message) when no matching succeeded evidence exists in
 * `ledger` for the claimed resource. `decreeText` supplies candidate resource names (capitalized
 * phrases from the Commander's own message) so a rewrite can name what wasn't verified instead of
 * a generic "the system".
 */
export function enforceOperationalTruth(
  text: string,
  ledger: RoundEvidenceLedger,
  decreeText: string,
): OperationalTruthResult {
  if (!text || !text.trim()) return { text, corrected: false, flagged: [] }
  const candidates = extractCandidateResources(decreeText)
  const sentences = splitIntoSentences(text)
  if (sentences.length === 0) return { text, corrected: false, flagged: [] }

  const flagged: OperationalTruthResult['flagged'] = []
  const rewritten = sentences.map(sentence => {
    if (ALREADY_HEDGED.test(sentence)) return sentence
    if (sentence.trim().endsWith('?')) return sentence
    if (FUTURE_OR_HEDGE_MARKER.test(sentence)) return sentence // whole-sentence plan/suggestion, not a completion claim

    // A single sentence can carry more than one operational claim ("X is back online and Y is
    // healthy") -- collect every distinct (category, resource) match rather than stopping at the
    // first, so a mixed sentence doesn't let a second, unsupported claim slip through unrewritten.
    const unsupported: { category: ClaimCategory; resource: string }[] = []
    const seen = new Set<string>()
    let anyMatch = false
    for (const pattern of CLAIM_PATTERNS) {
      const match = pattern.regex.exec(sentence)
      if (!match) continue
      anyMatch = true
      const resource = guessResource(sentence, candidates, match.index)
      const key = `${pattern.category}:${resource.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      if (findMatchingEvidence(ledger, resource)) continue // real evidence backs this one
      unsupported.push({ category: pattern.category, resource })
    }
    if (!anyMatch || unsupported.length === 0) return sentence

    for (const item of unsupported) flagged.push({ sentence, ...item })
    return unsupported.map(item => rewriteSentence(item.category, item.resource)).join(' ')
  })

  if (flagged.length === 0) return { text, corrected: false, flagged: [] }
  return { text: rewritten.join(' '), corrected: true, flagged }
}

/**
 * Runtime-truth enforcement: detect operational claims (restarted, back online, verified healthy,
 * repaired, deployed, "Terra's health gives us a solid foundation", ...) in Council text and
 * rewrite any that have no matching evidence in the current round's ledger to an honest
 * UNKNOWN/NOT EXECUTED (or, when the Commander's own decree asserted it, COMMANDER_REPORTED)
 * framing -- before the text is rendered, persisted, or fed into AURORA synthesis.
 *
 * This is a practical, sentence-level regex classifier, not a full NLP model -- it is deliberately
 * biased toward catching real fabrication (the mission's authoritative rule: operational claims
 * require operational evidence) while trying not to mangle hedged/future/quoted language. It runs
 * from enforceOperationalTruth(), called from validateProviderResults() and the family-deliberation
 * turn path in app/api/chat/execute.ts, AND from createStreamingTruthGuard() (same function, same
 * patterns) which buffers live deltas to sentence boundaries so an unsupported claim never reaches
 * the visible stream even momentarily -- see that function's own doc comment for the buffering
 * strategy.
 */

import { findMatchingEvidence, type RoundEvidenceLedger } from './evidenceLedger'

type ClaimCategory = 'restart' | 'health' | 'generic_action'

type ClaimPattern = {
  category: ClaimCategory
  regex: RegExp
}

/**
 * Shared vocabulary of "this thing is in a completed/good state" words and short phrases, reused
 * across the direct-copula, presuppositional-clause, and attributive-adjective pattern shapes
 * below so a single edit here improves detection everywhere.
 */
const STATE_PHRASES =
  '(?:back\\s+online|back\\s+up\\s+and\\s+running|online\\s+again|healthy|stable|holding\\s+steady|operational|good\\s+to\\s+go|functioning\\s+normally|running\\s+correctly|in\\s+good\\s+shape|restored|recovered|synchroni[sz]ed|reconnected|reactivated|activated|enabled|restarted|back)'

/** Adjective-only subset usable directly before a noun ("the ADJ radar") -- excludes multi-word
 * phrases like "holding steady" or "back online" that don't read as a bare attributive adjective. */
const STATE_ADJECTIVES =
  '(?:restored|healthy|operational|recovered|reconnected|synchroni[sz]ed|reactivated|stable|functioning|online|active)'

/**
 * Each pattern matches a *completed-action or presupposed-true* phrasing. Deliberately broader
 * than the mission's literal word list -- direct copula ("X is healthy"), presuppositional/
 * subordinate clauses ("with X back online", "now that X is stable", "since the radar is back"),
 * attributive noun phrases ("the restored radar", "the healthy runtime"), and possessive-noun
 * framing ("Terra's health gives us...", "Terra's healthy state") all count as claiming the state
 * is real, not merely discussed.
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
  {
    // Subordinate/presuppositional clauses: "with X back online", "given X is stable",
    // "since the radar is back", "now that the service is operational", "because X has recovered".
    // The copula ("is"/"are"/"has been") is optional -- reduced clauses ("with X back online")
    // never have one.
    category: 'generic_action',
    regex: new RegExp(
      `\\b(?:with|given|since|now\\s+that|because)\\s+(?:the\\s+|everything\\s+)?[A-Za-z][A-Za-z '-]{0,40}?(?:'s)?\\s+(?:(?:is|are|being|has\\s+been|have\\s+been)\\s+)?(?:now\\s+)?${STATE_PHRASES}\\b`,
      'i',
    ),
  },
  {
    // Attributive noun phrase treating the state as already-established fact: "the restored
    // radar", "the healthy runtime", "the operational service".
    category: 'generic_action',
    regex: new RegExp(`\\bthe\\s+${STATE_ADJECTIVES}\\s+[A-Za-z]+(?:\\s+[A-Za-z]+)?\\b`, 'i'),
  },
  {
    // Possessive-noun framing: "Terra's health gives us...", "Terra's status means...",
    // "Terra's healthy state".
    category: 'health',
    regex:
      /\b[A-Za-z]+'s\s+(?:health|status|state|condition)\s+(?:is|means|gives?\s+us|tells?\s+us|confirms?|shows?|looks?)\b|\b[A-Za-z]+'s\s+(?:healthy|stable|operational|restored|recovered)\s+(?:health|status|state|condition)?\b/i,
  },
]

/** A sentence already framed with honest uncertainty is left alone -- never re-flag it. */
const ALREADY_HEDGED =
  /\b(not\s+executed|unknown|unverified|unavailable|was\s+not|wasn'?t|did\s+not|didn'?t|no\s+evidence|cannot\s+confirm|unable\s+to\s+confirm|not\s+performed|not\s+verified|no\s+runtime\s+(?:proof|evidence)|commander[- ]reported|independently\s+verified)\b/i

/** A suggestion/plan/question about a future action is not a completion claim. Checked only
 * against the text *before* a given match (see below), not the whole sentence -- a presuppositional
 * clause ("Given Terra's healthy state, we should proceed...") still presupposes the state as fact
 * even though a later, independent clause in the same sentence hedges about something else. */
const FUTURE_OR_HEDGE_MARKER =
  /\b(should|will|let'?s|need\s+to|needs\s+to|must|going\s+to|plan\s+to|would|could|might|if\s+we|before\s+we|once\s+we|can\s+you|please)\b/i

/** An imperative request verb at the very start of a sentence marks it as an instruction
 * ("Restart Signal Radar", "Verify Terra is healthy") rather than an assertion that something is
 * already true -- used to keep decreeAssertsClaim() from treating the Commander's own request
 * phrasing as if it were a Commander-reported fact. */
const IMPERATIVE_REQUEST_START =
  /^(?:please\s+)?(?:restart|verify|check|confirm|research|investigate|analyze|analyse|repair|fix|deploy|enable|disable|ensure|make\s+sure|give|tell|show)\b/i

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
 * decides which one a given claim is about. Each resource's own evidence is then looked up
 * independently (evidenceLedger.findMatchingEvidence), so Ollama evidence can never validate a
 * Terra claim or vice versa.
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

/**
 * True when the Commander's OWN decree already asserted this same (category, resource) claim --
 * e.g. "I restarted Signal Radar and Terra is healthy." When the model's response merely echoes
 * that, it isn't the model fabricating a new claim; it's an unverified Commander report, which
 * gets a different, provenance-preserving rewrite (see rewriteSentence).
 */
function decreeAssertsClaim(decreeText: string, resource: string): boolean {
  if (!decreeText || resource === 'The system') return false
  for (const sentence of splitIntoSentences(decreeText)) {
    // "Restart Signal Radar and verify Terra is healthy" is a REQUEST, not an assertion that
    // either thing is already true -- an imperative-led sentence never counts as Commander-asserted
    // fact, no matter what claim-shaped language appears later in it.
    if (IMPERATIVE_REQUEST_START.test(sentence.trim())) continue
    if (!sentence.toLowerCase().includes(resource.toLowerCase())) continue
    for (const pattern of CLAIM_PATTERNS) {
      if (pattern.regex.test(sentence)) return true
    }
  }
  return false
}

function rewriteSentence(category: ClaimCategory, resource: string, commanderReported: boolean): string {
  if (commanderReported) {
    const subject = category === 'restart' ? `${resource} restart` : `${resource} health/status`
    return `${subject} is Commander-reported, not independently verified by War Room this round.`
  }
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
  flagged: { sentence: string; category: ClaimCategory; resource: string; commanderReported: boolean }[]
}

/**
 * Scans `text` sentence-by-sentence for unsupported operational claims and rewrites only the
 * offending sentences (never the whole message) when no matching succeeded evidence exists in
 * `ledger` for the claimed resource. `decreeText` supplies candidate resource names (capitalized
 * phrases from the Commander's own message) so a rewrite can name what wasn't verified instead of
 * a generic "the system", and is also checked to distinguish a model-invented claim from an
 * unverified Commander report.
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

    // A single sentence can carry more than one operational claim ("X is back online and Y is
    // healthy") -- collect every distinct (category, resource) match rather than stopping at the
    // first, so a mixed sentence doesn't let a second, unsupported claim slip through unrewritten.
    const unsupported: { category: ClaimCategory; resource: string; commanderReported: boolean }[] = []
    const seen = new Set<string>()
    let anyMatch = false
    for (const pattern of CLAIM_PATTERNS) {
      const match = pattern.regex.exec(sentence)
      if (!match) continue
      // A future/plan/hedge marker *before this specific match* means this claim is a suggestion,
      // not an assertion that it already happened -- checked positionally (not whole-sentence) so
      // a presuppositional clause earlier in the sentence isn't excused by an unrelated hedge word
      // appearing later in the same sentence ("Given Terra's healthy state, we should proceed...").
      if (FUTURE_OR_HEDGE_MARKER.test(sentence.slice(0, match.index))) continue
      anyMatch = true
      const resource = guessResource(sentence, candidates, match.index)
      // Dedupe by resource alone (not category+resource): different pattern shapes can match
      // overlapping text about the same resource ("with Signal Radar back online" trips both the
      // direct "back online" pattern and the presuppositional-clause pattern) -- one rewrite per
      // resource per sentence is enough; a second identical-meaning rewrite adds noise, not safety.
      const key = resource.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (findMatchingEvidence(ledger, resource)) continue // real evidence backs this one
      unsupported.push({ category: pattern.category, resource, commanderReported: decreeAssertsClaim(decreeText, resource) })
    }
    if (!anyMatch || unsupported.length === 0) return sentence

    for (const item of unsupported) flagged.push({ sentence, ...item })
    return unsupported.map(item => rewriteSentence(item.category, item.resource, item.commanderReported)).join(' ')
  })

  if (flagged.length === 0) return { text, corrected: false, flagged: [] }
  return { text: rewritten.join(' '), corrected: true, flagged }
}

/**
 * Streaming-safe wrapper: buffers incoming deltas until a sentence boundary (or a safety-valve
 * length, for long unpunctuated runs) is reached, runs enforceOperationalTruth() on exactly that
 * chunk, and returns only the validated/corrected text to release to the client. Nothing is ever
 * released to the caller before it has passed the same guard used for the final/persisted text --
 * an unsupported claim can therefore never reach the visible stream even momentarily. Ordinary
 * text with no claims in it is returned byte-for-byte unchanged (enforceOperationalTruth returns
 * the original string when nothing was flagged), so normal spacing/streaming feel is preserved;
 * only claim-bearing sentences pay the "wait for the sentence to finish" cost.
 *
 * One instance per seat/turn (each has its own buffer); all instances for a round should share the
 * same RoundEvidenceLedger so evidence one seat's real backend result produces is visible to every
 * other seat's claims later in the same round.
 */
export function createStreamingTruthGuard(
  decreeText: string,
  ledger: RoundEvidenceLedger,
): { push: (delta: string) => string; flush: () => string } {
  let buffer = ''
  const SAFETY_FLUSH_LENGTH = 500

  const releaseReady = (): string => {
    let lastBoundary = -1
    const re = /[.!?](?=\s|$)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(buffer))) lastBoundary = m.index + 1
    let toRelease = ''
    if (lastBoundary !== -1) {
      toRelease = buffer.slice(0, lastBoundary)
      buffer = buffer.slice(lastBoundary)
    } else if (buffer.length >= SAFETY_FLUSH_LENGTH) {
      // No sentence boundary yet but the buffer is getting long (a long clause with no
      // punctuation) -- release it rather than holding the stream indefinitely. This bounds
      // latency; a claim split exactly across this boundary is caught when its continuation
      // completes the sentence and goes through the guard again.
      toRelease = buffer
      buffer = ''
    }
    if (!toRelease) return ''
    return enforceOperationalTruth(toRelease, ledger, decreeText).text
  }

  return {
    push(delta: string): string {
      if (!delta) return ''
      buffer += delta
      return releaseReady()
    },
    flush(): string {
      if (!buffer) return ''
      const rest = buffer
      buffer = ''
      return enforceOperationalTruth(rest, ledger, decreeText).text
    },
  }
}

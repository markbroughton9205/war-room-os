/**
 * Evidence-bound review (pure: no filesystem, network or clock).
 *
 * A reviewer sentence is a claim, and a claim is only as good as the evidence behind it. `reviewClaimDecision` already sets aside a claim that maps to no
 * acceptance criterion; this layer weighs the claims that do map to one against the strongest direct evidence there is:
 *   - the files as they are on disk now,
 *   - the acceptance tests at the current generation,
 *   - the state that was last verified green,
 *   - the explicit acceptance criteria.
 * A claim that the evidence contradicts is retired without a repair. A claim the evidence supports (an explicit criterion the files do not meet, or a
 * failing test) still reopens the work.
 */
import { reviewClaimDecision, reviewClaimKey, type AcceptanceBasis, type ReviewClaimDecision, type ReviewClaimSupport } from './foundryAcceptanceBasis'

export type EvidenceSource = { file: string; text: string; role: 'source' | 'test' }

export type ReviewEvidence = {
  basis: AcceptanceBasis
  earlierClaims: readonly string[]
  /** The newest test run passed on exactly the files as they are now (the state that was last verified green is the state on disk). */
  testsGreenNow: boolean
  /** The contract-specific disk check: false when the files provably do not meet an explicit criterion; null when the campaign has no such check. */
  filesMeetCriteria: boolean | null
  /** The files as they are on disk now: implementation files and test files. */
  sources: readonly EvidenceSource[]
}

export type EvidenceDecision =
  | ReviewClaimDecision
  | 'RETIRED_CONTRADICTED_BY_DISK'
  | 'RETIRED_CONTRADICTED_BY_TESTS'

export type EvidenceVerdict = {
  decision: EvidenceDecision
  support: ReviewClaimSupport
  key: string
  /** The evidence the decision rests on, in one plain clause (for the record, not for the Commander). */
  because: string
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]{2,}/g
const DEFINITION = /^[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?(?:def|class|function|const|let|var)[ \t]+([A-Za-z_][A-Za-z0-9_]*)|^([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=[^=]/gm

/** Names a source file defines at the top level of a definition, class, function or assignment. */
export function definedNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const hit of text.matchAll(DEFINITION)) names.add(hit[1] ?? hit[2])
  return names
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text)
}

/** Names of code that the claim is about and the disk defines: the subject of the claim, in the code's own words. */
export function claimSubjects(claim: string, sources: readonly EvidenceSource[]): string[] {
  const defined = new Set<string>()
  for (const source of sources) if (source.role === 'source') for (const name of definedNames(source.text)) defined.add(name)
  const tokens = new Set(claim.match(IDENTIFIER) ?? [])
  return [...tokens].filter(token => defined.has(token))
}

const ABSENCE = [
  /[`'"]?([A-Za-z_][A-Za-z0-9_]{2,})[`'"]?\s*(?:\(\))?(?:\s+(?:function|method|class|field|name|import|helper|constant|variable))?\s+(?:is|are|was|were)?\s*(?:missing|undefined|not defined|not implemented|not present|not found|absent)\b/gi,
  /\b(?:does not|doesn't|do not|don't)\s+(?:define|contain|have|include|implement)\s+(?:a |an |the )?(?:function |method |class |field |name |import )?[`'"]?([A-Za-z_][A-Za-z0-9_]{2,})[`'"]?/gi,
  /\b(?:no|missing|without)\s+(?:function|method|class|field|import|definition|name)\s+[`'"]?([A-Za-z_][A-Za-z0-9_]{2,})[`'"]?/gi,
]

/** A word that reads as a name in code (quoted, called, snake_case, camelCase or PascalCase), not an ordinary English word like "filter". */
function looksLikeCode(name: string, claim: string): boolean {
  if (/_/.test(name) || /[a-z][A-Z]/.test(name)) return true
  if (new RegExp(`[\`'"]${name}[\`'"]|(?<![A-Za-z0-9_])${name}\\(\\)`).test(claim)) return true
  const at = claim.search(new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`))
  return /^[A-Z][a-z0-9]+[A-Za-z0-9]*$/.test(name) && at > 0 && /[a-z] $/.test(claim.slice(Math.max(0, at - 2), at))
}

/** Names the claim says are absent from the code. */
export function claimedAbsent(claim: string): string[] {
  const names = new Set<string>()
  for (const pattern of ABSENCE) for (const hit of claim.matchAll(pattern)) if (looksLikeCode(hit[1], claim)) names.add(hit[1])
  return [...names]
}

/** The claim names an acceptance criterion by its declared name or number (the reviewer was shown numbered ACCEPTANCE lines). */
export function citesCriterion(claim: string, basis: AcceptanceBasis): boolean {
  if (basis.explicit.some(item => new RegExp(`\\b${item.id}\\b`).test(claim))) return true
  const numbered = basis.criteria.length - 1
  for (const hit of claim.matchAll(/\bacceptance\s*(?:criterion|sentence|line)?\s*#?(\d+)\b/gi)) {
    const number = Number(hit[1])
    if (number >= 1 && number <= numbered) return true
  }
  return false
}

/** A test the claim says fails (`test_x`), that exists on disk. */
function claimedFailingTests(claim: string, sources: readonly EvidenceSource[]): string[] {
  const names = [...new Set(claim.match(/\btest_[A-Za-z0-9_]+\b/g) ?? [])]
  return names.filter(name => sources.some(source => source.role === 'test' && mentions(source.text, name)))
}

export function decideReviewClaim(claim: string, evidence: ReviewEvidence): EvidenceVerdict {
  const base = reviewClaimDecision({
    claim,
    basis: evidence.basis,
    earlierClaims: evidence.earlierClaims,
    testsGreenNow: evidence.testsGreenNow,
    filesMeetCriteria: evidence.filesMeetCriteria !== false,
  })
  const key = base.key || reviewClaimKey(claim)
  if (base.decision !== 'REOPEN') return { decision: base.decision, support: base.support, key, because: base.decision === 'SET_ASIDE_UNSUPPORTED' ? `it matches no acceptance criterion (${base.support.reason})` : 'the same concern was already handled and the tests pass' }
  const reopen = (because: string): EvidenceVerdict => ({ decision: 'REOPEN', support: base.support, key, because })
  const retire = (decision: 'RETIRED_CONTRADICTED_BY_DISK' | 'RETIRED_CONTRADICTED_BY_TESTS', because: string): EvidenceVerdict => ({ decision, support: base.support, key, because })

  // A criterion the files provably do not meet is a real, unmet requirement: nothing else outweighs it.
  if (evidence.filesMeetCriteria === false) return reopen('the files do not meet an explicit acceptance criterion')
  // A failing test is runtime evidence: the failure is handled by the repair chain, and a claim beside it is not retired.
  if (!evidence.testsGreenNow) return reopen('the tests do not pass on the current files')

  // From here the tests pass on exactly the files on disk, and the files meet the explicit criteria.
  // 1. Disk truth: the reviewer says something is missing that the code plainly contains.
  const absent = claimedAbsent(claim)
  const sourceText = evidence.sources.filter(source => source.role === 'source').map(source => source.text).join('\n')
  const present = absent.filter(name => mentions(sourceText, name))
  if (present.length && present.length === absent.length) return retire('RETIRED_CONTRADICTED_BY_DISK', `${present.join(', ')} ${present.length === 1 ? 'is' : 'are'} in the code on disk`)
  if (absent.length) return reopen(`${absent.filter(name => !present.includes(name)).join(', ')} is not in the code on disk`)

  // 2. A test the claim says fails, and the suite passes on these files.
  const failing = claimedFailingTests(claim, evidence.sources)
  if (failing.length) return retire('RETIRED_CONTRADICTED_BY_TESTS', `${failing.join(', ')} passes on the current files`)

  // 3. A claim that names no acceptance criterion is judged against the passing acceptance tests: if they exercise what it is about, they contradict it.
  if (citesCriterion(claim, evidence.basis)) return reopen('it names an explicit acceptance criterion')
  const subjects = claimSubjects(claim, evidence.sources)
  const testText = evidence.sources.filter(source => source.role === 'test').map(source => source.text).join('\n')
  const covered = subjects.filter(name => mentions(testText, name))
  if (covered.length) return retire('RETIRED_CONTRADICTED_BY_TESTS', `the passing tests exercise ${covered.join(', ')}`)
  // Nothing concrete to check it against, and everything that can be checked passes: a sentence that points at no code and no criterion is not evidence.
  if (!subjects.length) return retire('RETIRED_CONTRADICTED_BY_TESTS', 'it points at no code and names no criterion while the tests pass')
  return reopen(`it is about ${subjects.join(', ')}, which no test covers`)
}

/** Plain sentence for the Activity detail. */
export function evidenceNote(decision: EvidenceDecision): string {
  if (decision === 'RETIRED_CONTRADICTED_BY_DISK') return 'The reviewer said something was missing, but it is in the code, so I did not act on it.'
  if (decision === 'RETIRED_CONTRADICTED_BY_TESTS') return 'The reviewer raised a concern about code the passing tests already cover and it points at nothing you asked for, so I did not start another repair.'
  return decision === 'SET_ASIDE_UNSUPPORTED'
    ? "The reviewer's concern does not match anything you asked for, so I set it aside."
    : 'The reviewer raised the same concern again after it was already handled and the tests pass, so I did not start another repair.'
}

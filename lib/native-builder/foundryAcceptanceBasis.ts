/**
 * Acceptance basis (pure). What a reviewer may judge against, and whether a reviewer's claim counts.
 *
 * Completion truth comes from the Commander's request, the explicit acceptance criteria derived from it, the files as they are now
 * and the test evidence. A raw line of a contract file (a constant, a literal, metadata) is implementation context: it is never an
 * acceptance sentence just because it is in that file.
 */

export type AcceptanceBasis = {
  /** The Commander request, first, then every explicit acceptance sentence found in the contract files. */
  criteria: string[]
  /** Only the explicit acceptance sentences from contract files, with the name they were declared under. */
  explicit: { id: string; sentence: string }[]
  /** Names declared in contract files that are not acceptance sentences (constants, field names, labels). */
  contextNames: string[]
}

const STOP = new Set(['is', 'in', 'it', 'to', 'of', 'on', 'or', 'an', 'at', 'be', 'by', 'as', 'do', 'if', 'so', 'no', 'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'not', 'but', 'all', 'any', 'its', 'has', 'have', 'was', 'were', 'into', 'than', 'then', 'them', 'they', 'you', 'your', 'our', 'can', 'may', 'must', 'should', 'would', 'when', 'what', 'which', 'each', 'every', 'only', 'also', 'status', 'fail', 'pass', 'implemented', 'implement', 'sentence', 'acceptance', 'criterion', 'criteria', 'met', 'unmet'])

const ACCEPTANCE_DECLARATION = /^\s*(?:export\s+)?(?:const\s+|let\s+|var\s+)?(ACCEPT[A-Z0-9_]*|CRITERI[A-Z0-9_]*)\s*[:=]\s*(?:[A-Za-z_][A-Za-z0-9_<>\[\], ]*=\s*)?(["'`])(.+)\2\s*;?\s*$/
const ACCEPTANCE_COMMENT = /^\s*(?:#|\/\/)\s*acceptance\s*[:\-]\s*(.+?)\s*$/i
const NAME_DECLARATION = /^\s*(?:export\s+)?(?:const\s+|let\s+|var\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/

export function acceptanceBasis(input: { request: string; acceptance?: readonly string[]; contracts: readonly string[] }): AcceptanceBasis {
  const explicit: AcceptanceBasis['explicit'] = []
  const contextNames: string[] = []
  for (const source of input.contracts) {
    for (const line of source.split(/\r?\n/)) {
      const declared = ACCEPTANCE_DECLARATION.exec(line)
      if (declared) {
        explicit.push({ id: declared[1], sentence: declared[3].trim() })
        continue
      }
      const commented = ACCEPTANCE_COMMENT.exec(line)
      if (commented) {
        explicit.push({ id: `ACCEPTANCE_${explicit.length + 1}`, sentence: commented[1] })
        continue
      }
      const name = NAME_DECLARATION.exec(line)
      if (name && !/^(def|class|import|from|return|if|for|while|function|export|type|interface)$/.test(name[1])) contextNames.push(name[1])
    }
  }
  const criteria = [input.request, ...(input.acceptance ?? []).filter(item => item !== input.request), ...explicit.map(item => item.sentence)]
  return {
    criteria: [...new Set(criteria.map(item => item.trim()).filter(Boolean))],
    explicit,
    contextNames: [...new Set(contextNames)].filter(name => !explicit.some(item => item.id === name)),
  }
}

/** The text the reviewer is given as its contract: the request and the numbered acceptance criteria, nothing else. */
export function reviewerContract(basis: AcceptanceBasis): string {
  const [request, ...rest] = basis.criteria
  const lines = [`REQUEST ${request ?? ''}`, ...rest.map((item, index) => `ACCEPTANCE ${index + 1}. ${item}`)]
  return lines.join('\n').slice(0, 400)
}

function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word
}

export function significantWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{1,}/g) ?? []).filter(word => !STOP.has(word)).map(stem).filter(word => !STOP.has(word)))]
}

function overlapShare(claim: Set<string>, criterion: string): number {
  const words = significantWords(criterion)
  if (!words.length) return 0
  return words.filter(word => claim.has(word)).length / words.length
}

export type ReviewClaimSupport = { supported: boolean; reason: 'names_an_acceptance_criterion' | 'matches_a_criterion' | 'raw_contract_literal' | 'matches_no_criterion' }

/**
 * A reviewer sentence is a claim. It counts only when it maps to an actual acceptance criterion: it names one, or shares most of its
 * words. A claim anchored on a raw contract literal (a constant name, a `NAME = value` line) that is not part of any criterion does not count.
 */
export function reviewClaimSupport(claim: string, basis: AcceptanceBasis): ReviewClaimSupport {
  if (basis.explicit.some(item => new RegExp(`\\b${item.id}\\b`).test(claim))) return { supported: true, reason: 'names_an_acceptance_criterion' }
  // The reviewer is shown numbered ACCEPTANCE lines, so it may refer to one by number.
  const numbered = basis.criteria.length - 1
  for (const hit of claim.matchAll(/\bacceptance\s*(?:criterion|sentence|line)?\s*#?(\d+)\b/gi)) {
    const number = Number(hit[1])
    if (number >= 1 && number <= numbered) return { supported: true, reason: 'names_an_acceptance_criterion' }
  }
  const words = new Set(significantWords(claim))
  const namesRawLiteral = basis.contextNames.some(name => new RegExp(`\\b${name}\\b`).test(claim))
  const explicitMatch = basis.explicit.some(item => overlapShare(words, item.sentence) >= 0.6)
  if (explicitMatch) return { supported: true, reason: 'matches_a_criterion' }
  if (namesRawLiteral) return { supported: false, reason: 'raw_contract_literal' }
  const shared = (criterion: string) => significantWords(criterion).filter(word => words.has(word)).length
  if (basis.criteria.some(criterion => shared(criterion) >= 2)) return { supported: true, reason: 'matches_a_criterion' }
  return { supported: false, reason: 'matches_no_criterion' }
}

/** A stable identity for a claim, so the same complaint made twice is recognised as the same complaint. */
export function reviewClaimKey(claim: string): string {
  return significantWords(claim).sort().join(' ')
}

function similar(a: string, b: string): boolean {
  const left = new Set(a.split(' ').filter(Boolean))
  const right = new Set(b.split(' ').filter(Boolean))
  if (!left.size || !right.size) return false
  const both = [...left].filter(word => right.has(word)).length
  return both / (left.size + right.size - both) >= 0.6
}

export type ReviewClaimDecision = 'REOPEN' | 'SET_ASIDE_UNSUPPORTED' | 'SET_ASIDE_SETTLED'

/**
 * unsupported claim → set aside. The same supported claim again, after it already led to a rework, while the tests pass at the current
 * generation and the files still meet the criteria → set aside: without new contradictory evidence it cannot start another repair chase.
 * A new claim, or one the files really do not meet, still reopens the work.
 */
export function reviewClaimDecision(input: { claim: string; basis: AcceptanceBasis; earlierClaims: readonly string[]; testsGreenNow: boolean; filesMeetCriteria: boolean }): { decision: ReviewClaimDecision; support: ReviewClaimSupport; key: string } {
  const support = reviewClaimSupport(input.claim, input.basis)
  const key = reviewClaimKey(input.claim)
  if (!support.supported) return { decision: 'SET_ASIDE_UNSUPPORTED', support, key }
  const repeated = input.earlierClaims.some(earlier => similar(earlier, key))
  if (repeated && input.testsGreenNow && input.filesMeetCriteria) return { decision: 'SET_ASIDE_SETTLED', support, key }
  return { decision: 'REOPEN', support, key }
}

/** Plain sentence for the Activity detail. */
export function setAsideNote(decision: ReviewClaimDecision): string {
  return decision === 'SET_ASIDE_UNSUPPORTED'
    ? "The reviewer's concern does not match anything you asked for, so I set it aside."
    : 'The reviewer raised the same concern again after it was already handled and the tests pass, so I did not start another repair.'
}

/** True when the newest test run passed on exactly the files as they are now. */
export function testsGreenAtCurrentGeneration(campaign: { mutationGeneration: number; testReceipts?: readonly { command: string; result: string; testedMutationGeneration: number }[] }): boolean {
  const latest = [...(campaign.testReceipts ?? [])].reverse().find(item => item.command.includes('unittest'))
  return Boolean(latest) && (latest!.result === 'PASSED' || latest!.result === 'PASSED_SCOPED') && latest!.testedMutationGeneration === campaign.mutationGeneration
}

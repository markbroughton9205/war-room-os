/**
 * Structured revision / stand-firm decision parsing.
 * Observable stage output only — no hidden chain-of-thought.
 * Regex heuristics are never authoritative when a structured DECISION line is present.
 */

export type RevisionDecision = 'REVISE' | 'STAND_FIRM'

export type ChallengeAddressed = 'yes' | 'no' | 'partial'

export type RevisionDecisionSource = 'structured' | 'heuristic' | 'none'

export type ParsedRevisionDecision = {
  decision: RevisionDecision | null
  response: string
  challengeAddressed: ChallengeAddressed | null
  evidenceRefs: string[]
  unsupportedClaimWarnings: string[]
  decisionSource: RevisionDecisionSource
  structuredValid: boolean
}

const DECISION_RE = /^\s*DECISION\s*:\s*(REVISE|STAND_FIRM)\s*$/im
const CHALLENGE_RE = /^\s*CHALLENGE_ADDRESSED\s*:\s*(yes|no|partial)\s*$/im
const EVIDENCE_RE = /^\s*EVIDENCE_REFS\s*:\s*(.+?)\s*$/im
const WARNINGS_RE = /^\s*UNSUPPORTED_CLAIM_WARNINGS\s*:\s*(.+?)\s*$/im
const RESPONSE_RE = /^\s*RESPONSE\s*:\s*([\s\S]*)$/im

function parseListField(raw: string | undefined): string[] {
  if (!raw) return []
  const cleaned = raw.trim()
  if (!cleaned || /^(none|n\/a|na|-)$/i.test(cleaned)) return []
  return cleaned
    .split(/[,;]+/)
    .map(part => part.trim())
    .filter(Boolean)
}

/**
 * Soft fallback only when structured DECISION is absent.
 * Never overrides a structured DECISION line.
 */
function heuristicDecision(text: string): RevisionDecision {
  return /\b(?:stand[\s-]?firm|standing firm|hold my position|same position|do not revise|I stand by)\b/i.test(text)
    ? 'STAND_FIRM'
    : 'REVISE'
}

export function parseRevisionDecision(rawText: string): ParsedRevisionDecision {
  const text = rawText.replace(/\s+/g, ' ').trim() ? rawText.trim() : ''
  if (!text) {
    return {
      decision: null,
      response: '',
      challengeAddressed: null,
      evidenceRefs: [],
      unsupportedClaimWarnings: [],
      decisionSource: 'none',
      structuredValid: false,
    }
  }

  const decisionMatch = text.match(DECISION_RE)
  const challengeMatch = text.match(CHALLENGE_RE)
  const evidenceMatch = text.match(EVIDENCE_RE)
  const warningsMatch = text.match(WARNINGS_RE)
  const responseMatch = text.match(RESPONSE_RE)

  if (decisionMatch) {
    const decision = decisionMatch[1]!.toUpperCase() as RevisionDecision
    const response = (responseMatch?.[1] ?? text.replace(DECISION_RE, '').trim()).trim()
    return {
      decision,
      response: response || text,
      challengeAddressed: (challengeMatch?.[1]?.toLowerCase() as ChallengeAddressed | undefined) ?? null,
      evidenceRefs: parseListField(evidenceMatch?.[1]),
      unsupportedClaimWarnings: parseListField(warningsMatch?.[1]),
      decisionSource: 'structured',
      structuredValid: true,
    }
  }

  return {
    decision: heuristicDecision(text),
    response: text,
    challengeAddressed: null,
    evidenceRefs: [],
    unsupportedClaimWarnings: [],
    decisionSource: 'heuristic',
    structuredValid: false,
  }
}

export function revisionStatusFromDecision(
  decision: RevisionDecision | null,
  structuredValid: boolean,
  hasContent: boolean,
): 'revised' | 'stood_firm' | 'invalid_revision' {
  if (!hasContent || !decision) return 'invalid_revision'
  if (!structuredValid && decision === 'REVISE') {
    // Heuristic revise without structured DECISION is accepted as revised but flagged invalid
    // only when content is empty — keep revised/stood_firm for synthesis continuity.
  }
  return decision === 'STAND_FIRM' ? 'stood_firm' : 'revised'
}

export function formatRevisionStageInstruction(): string {
  return [
    'Turn role: revision or stand firm.',
    'Respond to the PHOENIX challenge with structured observable fields (no hidden reasoning):',
    'DECISION: REVISE | STAND_FIRM',
    'CHALLENGE_ADDRESSED: yes | no | partial',
    'EVIDENCE_REFS: comma-separated evidence reference ids, or none',
    'UNSUPPORTED_CLAIM_WARNINGS: comma-separated warnings, or none',
    'RESPONSE: your updated externally-visible contribution in plain language',
    'If you REVISE, RESPONSE becomes your authoritative contribution for synthesis.',
    'If you STAND_FIRM, preserve your prior position and explain why the challenge does not overturn it.',
    'No message-ID citations or labeled memo sections beyond the fields above.',
  ].join(' ')
}

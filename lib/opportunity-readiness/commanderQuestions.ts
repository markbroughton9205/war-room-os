import type { CommanderQuestion, RequirementResult } from './types'

function stateChangeFor(result: RequirementResult): string {
  switch (result.classification) {
    case 'UNKNOWN':
      return 'Resolving this may move the requirement to CONFIRMED_MET or CONFIRMED_NOT_MET.'
    case 'COMMANDER_CONFIRMATION_REQUIRED':
      return 'Resolving this may clear a blocker toward READY_NOW or reveal a QUALIFICATION_GAP.'
    default:
      return 'Resolving this may change the overall readiness state.'
  }
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Generates the minimal set of Commander questions needed to resolve
 * requirements that depend on unknown Commander facts. Requirements that
 * share the identical underlying fact — the same `factGroupKey` (an explicit
 * shared FactReference), or otherwise the exact same requirement text — are
 * grouped into a single question rather than asked twice, avoiding a giant
 * questionnaire of near-duplicates. Requirements are never collapsed just
 * because they are similar; only an exact factGroupKey or exact text match
 * groups them, so distinct eligibility facts are never blurred into one
 * ambiguous question.
 */
export function buildCommanderQuestions(requirementResults: RequirementResult[]): CommanderQuestion[] {
  const unresolved = requirementResults.filter(result => result.commanderInputNeeded)

  const groups = new Map<string, RequirementResult[]>()
  for (const result of unresolved) {
    // Only group by the shared fact identity when the matcher actually
    // trusted that sharing (i.e. it did NOT fall back to an ambiguous/
    // inconsistent classification for this specific requirement) — otherwise
    // fall back to exact-text grouping, which is always safe.
    const factGroupTrusted = result.factGroupKey !== null
      && result.evidenceSource !== 'ambiguous_fact_reuse'
      && result.evidenceSource !== 'factref_category_inconsistent'
    const key = factGroupTrusted ? result.factGroupKey! : `text::${normalizeText(result.requirementText)}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(result)
    else groups.set(key, [result])
  }

  return Array.from(groups.values()).map(bucket => {
    const primary = bucket[0]
    return {
      id: `cq-${primary.requirementId}`,
      requirementId: primary.requirementId,
      question: `${primary.requirementText} — do you currently satisfy this?`,
      whyItMatters: `This requirement is currently classified as ${primary.classification} and cannot be resolved without your input.`,
      resolvesRequirement: primary.requirementText,
      resolvesRequirementIds: bucket.map(result => result.requirementId),
      possibleReadinessStateChange: stateChangeFor(primary),
    }
  })
}

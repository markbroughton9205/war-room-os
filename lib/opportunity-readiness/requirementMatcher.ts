import type {
  CommanderFacts,
  RequirementCategory,
  RequirementInput,
  RequirementResult,
} from './types'
import { HARD_BLOCK_CATEGORIES } from './types'

const DOCUMENT_LIKE: readonly RequirementCategory[] = ['document', 'identity_document']
const TRAINING_LIKE: readonly RequirementCategory[] = ['training']
const CREDENTIAL_LIKE: readonly RequirementCategory[] = ['license', 'certification', 'education']
const LOCATION_LIKE: readonly RequirementCategory[] = ['location']
const EQUIPMENT_LIKE: readonly RequirementCategory[] = ['equipment', 'transportation']
const DEADLINE_LIKE: readonly RequirementCategory[] = ['deadline']

/** Folds case and separator variance (spaces/dashes vs underscores) so 'Age',
 * 'age', and 'AGE' — or 'Work Authorization' vs 'work_authorization' — are
 * treated as the same category. Does not guess semantic synonyms; unknown
 * categories remain unknown/generic rather than being mapped by inference. */
export function normalizeCategory(category: RequirementCategory): RequirementCategory {
  return String(category).trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * True when a CONFIRMED_NOT_MET on this requirement means the opportunity is
 * not eligible at all rather than a preparable gap.
 *
 * HARD_BLOCK_CATEGORIES are intrinsic: a caller can never downgrade one of
 * these to non-hard-blocking, regardless of what `hardBlocking` it supplies.
 * A category NOT on that list is non-hard by default, but a caller MAY
 * explicitly elevate it to hard-blocking via `hardBlocking: true`. This
 * matches the "callers may upgrade, never downgrade" rule.
 */
export function isHardBlocking(requirement: RequirementInput): boolean {
  const category = normalizeCategory(requirement.category)
  if (HARD_BLOCK_CATEGORIES.includes(category)) return true
  return requirement.hardBlocking === true
}

function classifyUnresolved(category: RequirementCategory): RequirementResult['classification'] {
  if (DOCUMENT_LIKE.includes(category)) return 'DOCUMENT_REQUIRED'
  if (TRAINING_LIKE.includes(category)) return 'TRAINING_REQUIRED'
  if (CREDENTIAL_LIKE.includes(category)) return 'CREDENTIAL_REQUIRED'
  if (LOCATION_LIKE.includes(category)) return 'LOCATION_REQUIRED'
  if (EQUIPMENT_LIKE.includes(category)) return 'EQUIPMENT_REQUIRED'
  if (DEADLINE_LIKE.includes(category)) return 'DEADLINE_CONSTRAINT'
  return 'COMMANDER_CONFIRMATION_REQUIRED'
}

function nextActionFor(classification: RequirementResult['classification'], requirement: RequirementInput): string {
  switch (classification) {
    case 'CONFIRMED_MET':
      return 'No action needed — already satisfied.'
    case 'CONFIRMED_NOT_MET':
      return isHardBlocking(requirement)
        ? 'This is a hard eligibility blocker. Confirm whether it can realistically change before pursuing this opportunity.'
        : 'Close this gap through preparation (training, document, credential, or equipment) before pursuing.'
    case 'UNKNOWN':
      return 'Commander indicated this is not currently known. Research or confirm before relying on this requirement.'
    case 'COMMANDER_CONFIRMATION_REQUIRED':
      return 'Ask the Commander directly whether this requirement is met.'
    case 'DOCUMENT_REQUIRED':
      return 'Identify and prepare the required document.'
    case 'TRAINING_REQUIRED':
      return 'Identify and complete the required training.'
    case 'CREDENTIAL_REQUIRED':
      return 'Confirm whether the Commander holds this credential, or plan how to obtain it.'
    case 'LOCATION_REQUIRED':
      return 'Confirm the Commander can meet this location/travel requirement.'
    case 'EQUIPMENT_REQUIRED':
      return 'Confirm the Commander owns or can obtain this equipment.'
    case 'DEADLINE_CONSTRAINT':
      return 'Confirm this deadline can realistically be met.'
    default:
      return 'Resolve this requirement before pursuing the opportunity.'
  }
}

function factGroupKeyFor(requirement: RequirementInput, category: RequirementCategory): string | null {
  if (!requirement.factRef) return null
  return `${category}::${requirement.factRef.factId}`
}

/**
 * Classifies one requirement against explicitly supplied Commander facts.
 * Never infers a fact that was not provided in `commanderFacts`.
 *
 * `priorUsage` tracks, within a single `matchRequirements` batch, which
 * requirement text first claimed a given factGroupKey. If a LATER requirement
 * reuses the identical factId+category but has materially different text
 * (and neither requirement explicitly marked `trustedShared`), the fact
 * cannot be trusted to answer it — that requirement's classification falls
 * back to the safe "not yet provided" path instead of CONFIRMED_MET/NOT_MET,
 * even though a fact technically exists under that key. This is what stops a
 * bare matchKey/factId collision from cross-satisfying unrelated
 * requirements.
 */
export function matchRequirement(
  requirement: RequirementInput,
  commanderFacts: CommanderFacts,
  priorUsage?: Map<string, { text: string }>,
): RequirementResult {
  const category = normalizeCategory(requirement.category)
  const factRefCategory = requirement.factRef ? normalizeCategory(requirement.factRef.category) : null
  const factRefCategoryInconsistent = factRefCategory !== null && factRefCategory !== category
  const factGroupKey = factGroupKeyFor(requirement, category)
  const normalizedThisText = normalizeText(requirement.text)

  // `trustedShared` is a per-requirement, SELF-asserted flag — it is
  // intentionally NOT inherited from, or granted by, any other requirement
  // that happens to share the same factId+category. Each requirement must
  // independently declare that it trusts a reused fact under this key. This
  // is what stops requirement A from unilaterally opting an unrelated,
  // non-consenting requirement B into sharing A's answer just because A set
  // `trustedShared: true` — B is only exempt from the ambiguity check when
  // B ITSELF sets `trustedShared: true`.
  let ambiguousReuse = false
  if (!factRefCategoryInconsistent && requirement.factRef && factGroupKey && priorUsage) {
    const prior = priorUsage.get(factGroupKey)
    const trustedShared = requirement.factRef.trustedShared === true
    if (prior && prior.text !== normalizedThisText && !trustedShared) {
      ambiguousReuse = true
    }
    if (!prior || (prior.text === normalizedThisText)) {
      priorUsage.set(factGroupKey, { text: normalizedThisText })
    }
  }

  const fact = !factRefCategoryInconsistent && !ambiguousReuse && requirement.factRef
    ? commanderFacts[requirement.factRef.factId]
    : undefined
  const factCategoryMatches = fact ? normalizeCategory(fact.category) === category : false

  let classification: RequirementResult['classification']
  let evidenceSource: string
  let confidence: number
  let explanation: string

  if (factRefCategoryInconsistent) {
    classification = classifyUnresolved(category)
    evidenceSource = 'factref_category_inconsistent'
    confidence = 0
    explanation = 'This requirement\'s factRef.category does not match its own category — War Room will not guess which is correct, so this requirement was not resolved from a fact lookup.'
  } else if (ambiguousReuse) {
    classification = classifyUnresolved(category)
    evidenceSource = 'ambiguous_fact_reuse'
    confidence = 0
    explanation = 'This factId/category was already used by a different-worded requirement in this assessment without an explicit trustedShared flag. War Room will not assume they are the same fact, so this requirement was not resolved from that answer.'
  } else if (fact && factCategoryMatches && fact.status === 'yes') {
    classification = 'CONFIRMED_MET'
    evidenceSource = 'commander_confirmed'
    confidence = 0.95
    explanation = `Commander confirmed this requirement is met${fact.detail ? `: ${fact.detail}` : '.'}`
  } else if (fact && factCategoryMatches && fact.status === 'no') {
    classification = 'CONFIRMED_NOT_MET'
    evidenceSource = 'commander_confirmed'
    confidence = 0.95
    explanation = `Commander confirmed this requirement is NOT met${fact.detail ? `: ${fact.detail}` : '.'}`
  } else if (fact && factCategoryMatches && fact.status === 'unknown') {
    classification = 'UNKNOWN'
    evidenceSource = 'commander_confirmed'
    confidence = 0.4
    explanation = `Commander explicitly does not currently know whether this requirement is met${fact.detail ? `: ${fact.detail}` : '.'}`
  } else if (fact && !factCategoryMatches) {
    classification = classifyUnresolved(category)
    evidenceSource = 'fact_category_mismatch'
    confidence = 0
    explanation = 'A Commander fact exists under this factId, but its declared category does not match this requirement\'s category. War Room will not apply it across categories.'
  } else {
    classification = classifyUnresolved(category)
    evidenceSource = 'not_yet_provided'
    confidence = 0
    explanation = 'No Commander fact was supplied for this requirement. War Room has not fabricated an answer.'
  }

  const commanderInputNeeded = classification === 'UNKNOWN' || classification === 'COMMANDER_CONFIRMATION_REQUIRED'

  return {
    requirementId: requirement.id,
    requirementText: requirement.text,
    category,
    classification,
    evidenceSource,
    confidence,
    commanderInputNeeded,
    explanation,
    nextAction: nextActionFor(classification, requirement),
    factGroupKey,
  }
}

export function matchRequirements(requirements: RequirementInput[], commanderFacts: CommanderFacts): RequirementResult[] {
  const priorUsage = new Map<string, { text: string }>()
  return requirements.map(requirement => matchRequirement(requirement, commanderFacts, priorUsage))
}

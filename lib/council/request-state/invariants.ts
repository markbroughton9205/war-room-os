import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  COUNCIL_REQUEST_STATE_SCHEMA_VERSION,
  type CouncilAuditMetadata,
  type CouncilFamilyExecutionRecord,
  type CouncilFamilyOutcome,
  type CouncilRequestCompletionSummary,
  type CouncilRequestStateRecord,
  type CouncilRequestStateValidationIssue,
  type CouncilRequestStateValidationResult,
} from './types'
import { isDispatchLifecycle, isTerminalLifecycle } from './transitions'

const SECRET_PHRASES = [
  'authorization',
  'authorization header',
  'bearer',
  'bearer token',
  'access token',
  'refresh token',
  'api key',
  'service role',
  'service role key',
  'supabase service key',
  'cookie',
  'set cookie',
  'password',
  'secret',
  'private key',
  'raw prompt',
  'chain of thought',
  'hidden reasoning',
  'provider request body',
  'provider response body',
] as const

// Phrases that legitimately contain a dangerous component word but are not
// themselves unsafe (e.g. "cookie policy" contains "cookie"). Stripped out
// before pattern matching so they never trigger a false positive, while a
// genuinely unsafe occurrence elsewhere in the same string is still caught.
const SECRET_SAFE_PHRASES = ['cookie policy', 'key result', 'reasoning category', 'prompt version'] as const

function normalizeForSecretScan(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const SECRET_PHRASE_PATTERN = new RegExp(
  `\\b(?:${[...SECRET_PHRASES]
    .sort((a, b) => b.length - a.length)
    .map(phrase => phrase.split(' ').join('\\s+'))
    .join('|')})\\b`,
)

/**
 * Case-insensitive, separator-insensitive secret/unsafe-vocabulary detector.
 * Normalizes whitespace/underscores/hyphens/punctuation before matching so
 * "access_token", "access-token", and "ACCESS TOKEN" are all caught the same
 * as "access token" -- while a small safe-phrase allowlist keeps benign
 * lookalikes like "cookie policy" from being falsely rejected. Shared by
 * lib/council/progress-events so both modules apply identical rules.
 */
export function containsUnsafeSecretText(value: string): boolean {
  const normalized = normalizeForSecretScan(value)
  let scanned = normalized
  for (const safePhrase of SECRET_SAFE_PHRASES) {
    scanned = scanned.split(safePhrase).join(' ')
  }
  return SECRET_PHRASE_PATTERN.test(scanned)
}

const READINESS_WORDS = new Set(['configured', 'connected', 'unavailable', 'paused', 'disabled', 'unknown'])

function issue(code: string, path: string, message: string): CouncilRequestStateValidationIssue {
  return { code, path, message }
}

function familyPath(index: number, suffix = ''): string {
  return `familyExecutions[${index}]${suffix ? `.${suffix}` : ''}`
}

function isDispatched(record: CouncilFamilyExecutionRecord): boolean {
  return Boolean(record.dispatchedAt) || (
    isDispatchLifecycle(record.lifecycle)
    && record.lifecycle !== 'not_reached'
    && record.outcome !== 'not_reached'
    && record.outcome !== 'skipped_by_policy'
  )
}

export function deriveCouncilRequestCompletionSummary(
  expectedFamilies: CouncilOrchestrationFamily[],
  selectedFamilies: CouncilOrchestrationFamily[],
  records: CouncilFamilyExecutionRecord[],
): CouncilRequestCompletionSummary {
  const terminal = records.filter(record => record.lifecycle === 'terminal')
  const count = (outcome: CouncilFamilyOutcome): number =>
    terminal.filter(record => record.outcome === outcome).length
  const dispatched = records.filter(isDispatched)
  const missingTerminalFamilies = selectedFamilies.filter(family =>
    !records.some(record => record.family === family && record.lifecycle === 'terminal'),
  )
  return {
    derivedFrom: 'family_outcomes',
    expectedCount: expectedFamilies.length,
    selectedCount: selectedFamilies.length,
    dispatchedCount: dispatched.length,
    terminalCount: terminal.length,
    completeCount: count('complete'),
    incompleteCount: count('incomplete'),
    timedOutCount: count('timed_out'),
    failedCount: count('failed'),
    fallbackUsedCount: count('fallback_used'),
    skippedByPolicyCount: count('skipped_by_policy'),
    stoppedCount: count('stopped'),
    notReachedCount: count('not_reached'),
    missingTerminalFamilies,
  }
}

function validateFamilyExecution(
  record: CouncilFamilyExecutionRecord,
  index: number,
  request: CouncilRequestStateRecord,
): CouncilRequestStateValidationIssue[] {
  const issues: CouncilRequestStateValidationIssue[] = []
  const path = (suffix = '') => familyPath(index, suffix)

  if (record.schemaVersion !== COUNCIL_REQUEST_STATE_SCHEMA_VERSION) {
    issues.push(issue('schema_version_missing', path('schemaVersion'), 'Family execution schema version is required.'))
  }
  if (record.requestId !== request.requestId) {
    issues.push(issue('request_id_mismatch', path('requestId'), 'Family execution must reference its request ID.'))
  }
  if (isTerminalLifecycle(record.lifecycle) && !record.outcome) {
    issues.push(issue('terminal_without_outcome', path('outcome'), 'Terminal lifecycle requires exactly one terminal outcome.'))
  }
  if (!isTerminalLifecycle(record.lifecycle) && record.outcome) {
    issues.push(issue('nonterminal_with_outcome', path('outcome'), 'Nonterminal lifecycle cannot carry a terminal outcome.'))
  }
  if ((record.outcome === 'not_reached' || record.lifecycle === 'not_reached') && record.dispatchedAt) {
    issues.push(issue('not_reached_dispatched', path('dispatchedAt'), 'not_reached cannot also be dispatched.'))
  }
  if (record.lifecycle === 'stopped_by_commander' && record.outcome === 'timed_out') {
    issues.push(issue('stopped_recorded_as_timeout', path('outcome'), 'Commander stop must remain distinct from timeout.'))
  }
  if (record.outcome === 'timed_out' && record.safeDiagnosticCode === 'stopped_by_commander') {
    issues.push(issue('stopped_timeout_ambiguous', path('safeDiagnosticCode'), 'Stopped-by-Commander and timeout require explicit final authority.'))
  }
  if (record.outcome === 'fallback_used' && !record.fallbackLineage) {
    issues.push(issue('fallback_missing_lineage', path('fallbackLineage'), 'Fallback output cannot exist without preserved primary outcome.'))
  }
  if (record.fallbackLineage) {
    if (record.fallbackLineage.primaryOutcome === 'complete') {
      issues.push(issue('fallback_erases_primary_failure', path('fallbackLineage.primaryOutcome'), 'Fallback cannot erase a successful primary into fallback_used.'))
    }
    if (record.fallbackLineage.fallbackReplacedVisiblePrimary && record.visibility.rendered && !record.visibility.substituted) {
      issues.push(issue('substituted_output_unmarked', path('visibility.substituted'), 'Rendered substituted output must be explicitly marked substituted.'))
    }
    if (containsUnsafeSecretText(record.fallbackLineage.safeDiagnosticReason)) {
      issues.push(issue('unsafe_fallback_diagnostic', path('fallbackLineage.safeDiagnosticReason'), 'Fallback diagnostic reason contains secret-bearing vocabulary.'))
    }
  }
  if (record.visibility.substituted && !record.fallbackLineage) {
    issues.push(issue('substitution_without_fallback', path('visibility.substituted'), 'Substituted visibility requires fallback lineage.'))
  }
  if (record.respondingToFamilyExecutionIds.length > 0) {
    for (const target of record.respondingToFamilyExecutionIds) {
      const delivered = record.priorResponseLineage.some(lineage =>
        lineage.priorExecutionId === target && lineage.delivered,
      )
      if (!delivered) {
        issues.push(issue('prior_claim_without_lineage', path('priorResponseLineage'), 'Prior-family response claim requires delivered lineage.'))
      }
    }
  }
  if (
    record.lifecycle === 'reviewing_previous_family'
    && !record.priorResponseLineage.some(lineage => lineage.delivered)
  ) {
    issues.push(issue('reviewing_without_delivered_lineage', path('priorResponseLineage'), 'reviewing_previous_family requires at least one delivered prior response.'))
  }
  if (record.safeDiagnosticMessage && containsUnsafeSecretText(record.safeDiagnosticMessage)) {
    issues.push(issue('unsafe_diagnostic_message', path('safeDiagnosticMessage'), 'Safe diagnostic message contains secret-bearing vocabulary.'))
  }
  if (record.safeDiagnosticCode && containsUnsafeSecretText(record.safeDiagnosticCode)) {
    issues.push(issue('unsafe_diagnostic_code', path('safeDiagnosticCode'), 'Safe diagnostic code contains secret-bearing vocabulary.'))
  }

  return issues
}

function validateAuditScope(audit: CouncilAuditMetadata): CouncilRequestStateValidationIssue[] {
  const issues: CouncilRequestStateValidationIssue[] = []
  const expected = new Set(audit.expectedFamilies)
  const received = new Set(audit.receivedFamilies)
  const missing = audit.expectedFamilies.filter(family => !received.has(family))

  if (audit.scope === 'complete_record' && missing.length > 0) {
    issues.push(issue('complete_audit_missing_family', 'redTeamAudit', 'complete_record audit scope requires all expected auditable families.'))
  }
  if (audit.scope === 'partial_record' && audit.missingFamilies.length === 0) {
    issues.push(issue('partial_audit_without_missing_metadata', 'redTeamAudit.missingFamilies', 'partial_record audit scope requires missing or excluded family metadata.'))
  }
  if (audit.scope === 'unknown_scope' && audit.notes?.toLowerCase().includes('full-record')) {
    issues.push(issue('unknown_scope_claims_full_verification', 'redTeamAudit.notes', 'unknown_scope cannot claim full-record verification.'))
  }
  if (audit.scope === 'complete_record') {
    for (const family of expected) {
      if (!received.has(family)) {
        issues.push(issue('audit_expected_not_received', 'redTeamAudit.receivedFamilies', `${family} expected but not received.`))
      }
    }
  }
  return issues
}

function validateCompletionSummary(
  request: CouncilRequestStateRecord,
): CouncilRequestStateValidationIssue[] {
  const issues: CouncilRequestStateValidationIssue[] = []
  const expected = deriveCouncilRequestCompletionSummary(
    request.expectedFamilies,
    request.selectedFamilies,
    request.familyExecutions,
  )
  const actual = request.completionSummary
  if (actual.derivedFrom !== 'family_outcomes') {
    issues.push(issue('completion_not_family_outcome_derived', 'completionSummary.derivedFrom', 'Completion counts must derive from family outcomes only.'))
  }
  const comparableKeys = Object.keys(expected) as (keyof CouncilRequestCompletionSummary)[]
  for (const key of comparableKeys) {
    const actualValue = actual[key]
    const expectedValue = expected[key]
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      issues.push(issue('completion_summary_mismatch', `completionSummary.${String(key)}`, `Expected ${JSON.stringify(expectedValue)} but observed ${JSON.stringify(actualValue)}.`))
    }
  }
  const serializedSummary = JSON.stringify(actual)
  for (const word of READINESS_WORDS) {
    if (serializedSummary.includes(`"${word}"`)) {
      issues.push(issue('readiness_used_as_completion', 'completionSummary', `Provider readiness state ${word} cannot be used as request completion.`))
    }
  }
  return issues
}

export function validateCouncilRequestState(
  request: CouncilRequestStateRecord,
): CouncilRequestStateValidationResult {
  const issues: CouncilRequestStateValidationIssue[] = []
  if (request.schemaVersion !== COUNCIL_REQUEST_STATE_SCHEMA_VERSION) {
    issues.push(issue('schema_version_missing', 'schemaVersion', 'Request schema version is required.'))
  }
  for (const family of request.selectedFamilies) {
    if (!request.familyExecutions.some(record => record.family === family)) {
      issues.push(issue('selected_family_disappeared', 'familyExecutions', `${family} is selected but has no execution record.`))
    }
  }
  for (const family of request.expectedFamilies) {
    if (!request.familyExecutions.some(record => record.family === family)) {
      issues.push(issue('expected_family_missing_structured_state', 'familyExecutions', `${family} is expected but missing structured state.`))
    }
  }
  request.familyExecutions.forEach((record, index) => {
    issues.push(...validateFamilyExecution(record, index, request))
  })
  // A request is only "closing" (and therefore entitled to flag a
  // still-dispatched family as a problem) when cancellation happened, or
  // when EVERY selected family has independently reached terminal. The
  // prior check ("any single family reached terminal") falsely treated a
  // request as closed the moment the first of several families finished,
  // rejecting the exact mixed terminal+in-flight snapshot a real
  // sequential Council exchange produces constantly.
  const allSelectedFamiliesTerminal = request.selectedFamilies.length > 0
    && request.selectedFamilies.every(family =>
      request.familyExecutions.some(record => record.family === family && record.lifecycle === 'terminal'),
    )
  const isClosed = request.cancellation.cancelled || allSelectedFamiliesTerminal
  if (isClosed) {
    // Closure -- whether via full natural completion or via confirmed
    // Commander cancellation -- requires EVERY selected family to be
    // terminal, not just the ones that happened to be dispatched. A
    // selected family still sitting in waiting/queued/retrieving/
    // responding/reviewing is just as much an open, unresolved commitment
    // as a dispatched one; checking only dispatched families silently let
    // request_cancelled close a request while a merely-waiting selected
    // family was still open. Expected-but-unselected families are
    // intentionally excluded -- this loop only walks selectedFamilies.
    for (const family of request.selectedFamilies) {
      const record = request.familyExecutions.find(candidate => candidate.family === family)
      if (!record || record.lifecycle !== 'terminal') {
        issues.push(issue('selected_family_not_terminal_at_closure', 'familyExecutions', `${family} was selected but is not terminal at request closure.`))
      }
    }
  }
  issues.push(...validateAuditScope(request.redTeamAudit))
  issues.push(...validateCompletionSummary(request))

  return { ok: issues.length === 0, issues }
}

export function assertSerializableCouncilRequestState(
  request: CouncilRequestStateRecord,
): CouncilRequestStateValidationResult {
  try {
    const roundTrip = JSON.parse(JSON.stringify(request)) as CouncilRequestStateRecord
    if (roundTrip.schemaVersion !== request.schemaVersion) {
      return {
        ok: false,
        issues: [issue('serialization_schema_version_lost', 'schemaVersion', 'Schema version was not retained after JSON round trip.')],
      }
    }
    return validateCouncilRequestState(roundTrip)
  } catch (error) {
    return {
      ok: false,
      issues: [issue('serialization_failed', 'request', error instanceof Error ? error.message : String(error))],
    }
  }
}

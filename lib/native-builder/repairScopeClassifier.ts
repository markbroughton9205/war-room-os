/**
 * Classifies whether a System Health check's degradation is something the Native Builder can
 * plausibly repair in code, or whether it's an account/config/human decision outside code's
 * reach. Deliberately a narrow, honest heuristic over the check's own evidence text (not a model
 * call) — Part 23 requires this distinction to be truthful, not guessed by an LLM that might
 * rationalize a fake "I can fix this" answer.
 */

export type RepairScopeClassification =
  | 'native_builder_repairable'
  | 'commander_action_required'
  | 'external_provider_account_action_required'
  | 'unclear'

const EXTERNAL_PROVIDER_PATTERNS = [
  /\bno live (tavily|firecrawl|.*) provider\b/i,
  /\bprovider (key|account|quota|billing)\b/i,
  /\bapi key\b.*\b(missing|invalid|expired)\b/i,
  /\brate.?limit(ed)?\b/i,
]

const COMMANDER_ACTION_PATTERNS = [
  /\bapproval gate\b/i,
  /\bmigration\b/i,
  /\bnot verified\b/i,
  /\bpersistence (is not|unavailable)\b/i,
  /\bconfiguration\b.*\bmissing\b/i,
]

/** Applied to a check's combined evidence + missingEvidence text. Pure, deterministic, no I/O. */
export function classifyRepairScope(evidenceText: string): RepairScopeClassification {
  if (EXTERNAL_PROVIDER_PATTERNS.some(p => p.test(evidenceText))) return 'external_provider_account_action_required'
  if (COMMANDER_ACTION_PATTERNS.some(p => p.test(evidenceText))) return 'commander_action_required'
  return 'unclear'
}

export const REPAIR_SCOPE_LABEL: Record<RepairScopeClassification, string> = {
  native_builder_repairable: 'War Room can attempt a code-level repair.',
  commander_action_required: 'COMMANDER ACTION REQUIRED',
  external_provider_account_action_required: 'EXTERNAL PROVIDER ACCOUNT ACTION REQUIRED',
  unclear: 'Scope unclear — attempt code-level diagnosis before escalating.',
}

/**
 * Commander approval gates.
 *
 * Opportunity agents may only perform internal, reversible work. Every
 * external or financially binding action is enumerated here and blocked at the
 * module level: gateAgentAction returns allowed:false for anything on the
 * forbidden list, and assertInternalAction throws. There is intentionally no
 * code path in lib/opportunity-agents that performs an external side effect.
 */

export const EXTERNAL_FORBIDDEN_ACTIONS = [
  'spend_money',
  'enter_payment_information',
  'purchase_product_or_service',
  'sign_contract',
  'accept_legal_terms',
  'submit_binding_bid',
  'submit_government_certification',
  'send_email_or_message',
  'publish_post',
  'call_customer',
  'contact_lead',
  'hire_worker',
  'promise_delivery',
  'set_binding_price',
  'create_debt',
  'transfer_money',
  'open_financial_account',
  'deploy_production_change',
] as const
export type ExternalForbiddenAction = (typeof EXTERNAL_FORBIDDEN_ACTIONS)[number]

export const INTERNAL_ALLOWED_ACTIONS = [
  'research',
  'classify',
  'calculate',
  'prepare',
  'draft',
  'organize',
  'create_work_packet',
  'create_internal_queue',
  'recommend',
  'identify_required_approvals',
  'verify_available_evidence',
  'create_approval_request',
  'rank',
  'flag_deadline',
  'flag_missing_documentation',
] as const
export type InternalAllowedAction = (typeof INTERNAL_ALLOWED_ACTIONS)[number]

export type AgentAction = ExternalForbiddenAction | InternalAllowedAction | (string & {})

export type GateResult =
  | { allowed: true; kind: 'internal' }
  | { allowed: false; kind: 'external'; reason: string }

export function isExternalForbiddenAction(action: string): action is ExternalForbiddenAction {
  return (EXTERNAL_FORBIDDEN_ACTIONS as readonly string[]).includes(action)
}

export function gateAgentAction(action: AgentAction): GateResult {
  if (isExternalForbiddenAction(action)) {
    return {
      allowed: false,
      kind: 'external',
      reason: `Action '${action}' is external or financially binding and requires explicit Commander approval. Agents cannot perform it.`,
    }
  }
  if ((INTERNAL_ALLOWED_ACTIONS as readonly string[]).includes(action)) {
    return { allowed: true, kind: 'internal' }
  }
  // Unknown actions are denied by default — allowlisting, not blocklisting.
  return {
    allowed: false,
    kind: 'external',
    reason: `Action '${action}' is not on the internal allowlist. Denied by default.`,
  }
}

export function assertInternalAction(action: AgentAction): void {
  const gate = gateAgentAction(action)
  if (!gate.allowed) throw new Error(gate.reason)
}

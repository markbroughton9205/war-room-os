/**
 * #22 Phase 14 — Bounded failure codes. No secrets in messages.
 */
import type { IntegrationFailureCode } from './types'

export type IntegrationFailure = {
  code: IntegrationFailureCode
  message: string
  agent_role?: string
}

export function integrationFailure(
  code: IntegrationFailureCode,
  message: string,
  agent_role?: string,
): IntegrationFailure {
  return { code, message: sanitizeFailureMessage(message), agent_role }
}

const SECRETISH = /password|api[_-]?key|bearer\s|sk-[a-z0-9]|session[_-]?token|service_role/i

export function sanitizeFailureMessage(message: string): string {
  if (SECRETISH.test(message)) return 'Failure recorded without secret material.'
  return message.slice(0, 400)
}

import { evaluateAuthority, capabilityDoesNotImplyAuthority } from '@/lib/council/gi/authorityMatrix'
import { isDangerousAction } from '@/lib/permissions/policy'

export function runWrGa08() {
  const decision = evaluateAuthority({
    tool_id: 'email.send',
    path: 'AGENT_PATH',
    capability_available: true,
  })
  return {
    decision,
    mapsToExistingPolicy: isDangerousAction('email_send'),
    pass:
      (decision.decision === 'ask' || decision.decision === 'deny')
      && decision.executed === false
      && capabilityDoesNotImplyAuthority(decision)
      && isDangerousAction('email_send'),
  }
}

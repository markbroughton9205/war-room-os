import { isDangerousAction } from '@/lib/permissions/policy'
import { isCanonicalDangerousKind } from '@/lib/permissions/dangerousActionRegistry'
import { AUTHORITY_MATRIX_STUB_ROWS } from './authorityMatrix.stub'
import type { AuthorityClass, AuthorityDecision, AuthorityMatrixRow, CouncilPath } from './types'

export function lookupAuthorityRow(toolId: string): AuthorityMatrixRow | undefined {
  return AUTHORITY_MATRIX_STUB_ROWS.find(row => row.tool_id === toolId)
}

export type EvaluateAuthorityInput = {
  tool_id: string
  path: CouncilPath
  capability_available?: boolean
  grant?: boolean
  grant_id?: string
  now?: string
}

/**
 * Single authority evaluation contract. Maps onto existing dangerous-action policy.
 * capability_available + denied does not equal execution.
 */
export function evaluateAuthority(input: EvaluateAuthorityInput): AuthorityDecision {
  const row = lookupAuthorityRow(input.tool_id)
  const ts = input.now ?? new Date().toISOString()
  const capability_available = input.capability_available !== false
  if (!row) {
    return {
      tool_id: input.tool_id,
      decision: 'deny',
      authority_class: 'REFUSE',
      actor: 'POLICY',
      reason: 'Unknown tool. Deny by default. No parallel registry created.',
      ts,
      executed: false,
      capability_available,
    }
  }

  const dangerous = Boolean(
    (row.dangerous_kind && (isDangerousAction(row.dangerous_kind) || isCanonicalDangerousKind(row.dangerous_kind)))
    || isDangerousAction(input.tool_id)
    || isCanonicalDangerousKind(input.tool_id),
  )

  let authority_class: AuthorityClass = row.authority_class
  if (dangerous && authority_class === 'OWNABLE') authority_class = 'REQUIRE_AUTH'

  if (!row.allowed_paths.includes(input.path) && authority_class !== 'REFUSE') {
    return {
      tool_id: row.tool_id,
      decision: 'deny',
      authority_class: 'REFUSE',
      actor: 'POLICY',
      reason: `${row.tool_id} is not permitted on ${input.path}. Capability does not grant authority.`,
      ts,
      executed: false,
      capability_available,
    }
  }

  if (authority_class === 'REFUSE') {
    return {
      tool_id: row.tool_id,
      decision: 'deny',
      authority_class: 'REFUSE',
      actor: 'POLICY',
      reason: row.notes,
      ts,
      executed: false,
      capability_available,
    }
  }

  if (authority_class === 'HOLD') {
    return {
      tool_id: row.tool_id,
      decision: 'deny',
      authority_class: 'HOLD',
      actor: 'POLICY',
      reason: `${row.notes} Held. No side effect.`,
      ts,
      executed: false,
      capability_available,
    }
  }

  if (authority_class === 'REQUIRE_AUTH') {
    if (input.grant === true) {
      return {
        tool_id: row.tool_id,
        decision: 'ask',
        authority_class: 'REQUIRE_AUTH',
        actor: 'COMMANDER',
        reason: 'Grant recorded for later owner module. GI-ENG-01 still does not execute the side effect.',
        ts,
        grant_id: input.grant_id,
        executed: false,
        capability_available,
      }
    }
    return {
      tool_id: row.tool_id,
      decision: 'ask',
      authority_class: 'REQUIRE_AUTH',
      actor: 'POLICY',
      reason: dangerous
        ? `Maps to existing dangerous kind ${row.dangerous_kind ?? 'email_send'}. Requires Commander approval. Not executed.`
        : 'REQUIRE_AUTH without grant. Ask Commander. Not executed.',
      ts,
      executed: false,
      capability_available,
    }
  }

  return {
    tool_id: row.tool_id,
    decision: 'auto',
    authority_class: 'OWNABLE',
    actor: 'POLICY',
    reason: row.notes,
    ts,
    executed: input.path === 'SHORT_PATH' && row.tool_id === 'council.calc.simple',
    capability_available,
  }
}

export function capabilityDoesNotImplyAuthority(decision: AuthorityDecision): boolean {
  return decision.capability_available === true && decision.executed === false && decision.decision !== 'auto'
}

/**
 * Intelligence roles are functions, not providers.
 * Future WRIM may fulfill a role; it does not replace Council orchestration.
 * This pass does not train, promote, or invoke WRIM.
 */

import type { IntelligenceRole, ProviderKind, RoleFulfillment } from './types'

export const DEFAULT_ROLE_FULFILLMENT: readonly RoleFulfillment[] = Object.freeze([
  role('CLASSIFIER', 'deterministic', 'evidence-board.classifier'),
  role('MISSION_UNDERSTANDING', 'deterministic', 'intelligence.missionContract'),
  role('ATLAS', 'deterministic', 'intelligence.atlas'),
  role('JANUS', 'deterministic', 'intelligence.janus'),
  role('SENTINEL', 'deterministic', 'intelligence.sentinel'),
  role('ORION', 'frontier', null),
  role('PULSAR', 'frontier', null),
  role('LUMEN', 'deterministic', 'evidence-board.verify'),
  role('PHOENIX', 'deterministic', 'evidence-board.phoenix'),
  role('AURORA', 'deterministic', 'evidence-board.aurora'),
  role('RETRIEVAL', 'local', 'browser-broker'),
  role('VERIFICATION', 'deterministic', 'evidence-board.lumen'),
  role('SYNTHESIS', 'deterministic', 'evidence-board.aurora'),
])

function role(roleName: IntelligenceRole, provider_kind: ProviderKind, provider_id: string | null): RoleFulfillment {
  return Object.freeze({
    role: roleName,
    provider_kind,
    provider_id,
    wrim_eligible: true,
    wrim_active: false as const,
  })
}

export function fulfillmentFor(roleName: IntelligenceRole, rows: readonly RoleFulfillment[] = DEFAULT_ROLE_FULFILLMENT): RoleFulfillment {
  return rows.find(row => row.role === roleName) ?? role(roleName, 'deterministic', null)
}

export type WrimRoleSlot =
  | 'classifier'
  | 'mission-understanding'
  | 'atlas-planning'
  | 'retrieval'
  | 'verification'
  | 'synthesis'

const WRIM_SLOTS: Record<WrimRoleSlot, IntelligenceRole> = {
  classifier: 'CLASSIFIER',
  'mission-understanding': 'MISSION_UNDERSTANDING',
  'atlas-planning': 'ATLAS',
  retrieval: 'RETRIEVAL',
  verification: 'VERIFICATION',
  synthesis: 'SYNTHESIS',
}

/**
 * Clean future hook. Does not load WRIM, train, or swap providers.
 * Returns how a role is fulfilled today and that WRIM is eligible but inactive.
 */
export function wrimRoleInterface(slot: WrimRoleSlot): RoleFulfillment & { slot: WrimRoleSlot; training_invoked: false } {
  const base = fulfillmentFor(WRIM_SLOTS[slot])
  return Object.freeze({
    ...base,
    slot,
    wrim_eligible: true,
    wrim_active: false as const,
    training_invoked: false as const,
  })
}

export function assertNoWrimTraining(fulfillment: RoleFulfillment): boolean {
  return fulfillment.wrim_active === false && fulfillment.provider_kind !== 'wrim'
}

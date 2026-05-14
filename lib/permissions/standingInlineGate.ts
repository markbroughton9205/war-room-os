import { getEffectivePolicy } from '@/lib/permissions/policy'
import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'

/** Session-tab acknowledgement for standing-gated POST bodies (replaces blocking confirm()). */
export const WARROOM_STANDING_ACK_KEY = 'warroom_standing_inline_ack_v1'

export function readWarRoomStandingAck(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(WARROOM_STANDING_ACK_KEY) === '1'
}

export function grantWarRoomStandingAck(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(WARROOM_STANDING_ACK_KEY, '1')
}

export function clearWarRoomStandingAck(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(WARROOM_STANDING_ACK_KEY)
}

export type StandingInlineGateResult = {
  proceed: boolean
  extra: Record<string, unknown>
  needsAck: boolean
  ackMessage?: string
}

/**
 * Non-blocking standing gate: if approval is required, returns needsAck until the user
 * taps the permission strip (grantWarRoomStandingAck), then proceeds with approval_granted.
 */
export function resolveStandingPostExtra(
  snap: { mode: StandingPermissionMode; safetyLock: boolean } | null,
  actionKind: string,
): StandingInlineGateResult {
  if (!snap) return { proceed: true, extra: {}, needsAck: false }
  const p = getEffectivePolicy(snap.mode, actionKind)
  const needsConfirm = !p.autoAllowed || snap.safetyLock
  if (!needsConfirm) return { proceed: true, extra: {}, needsAck: false }
  if (readWarRoomStandingAck()) {
    return { proceed: true, extra: { approval_granted: true }, needsAck: false }
  }
  const msg = !p.autoAllowed
    ? `Standing mode "${snap.mode}" requires explicit approval for ${actionKind}.`
    : `Safety lock is on — approve elevated actions for this tab (sends approval_granted: true).`
  return { proceed: false, extra: {}, needsAck: true, ackMessage: msg }
}

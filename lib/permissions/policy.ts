import { STANDING_AUTO_ALLOW_BY_MODE, type StandingPermissionMode } from '@/lib/permissions/standingPermissions'

export const DANGEROUS_ACTION_KINDS = [
  'file_modification',
  'shell_mutating',
  'commit',
  'deploy',
  'rollback',
  'delete_data',
  'email_send',
  'financial',
  'payment',
  'subscription',
  'secrets_change',
  'external_account',
] as const

const DANGEROUS = new Set<string>(DANGEROUS_ACTION_KINDS)

export type EffectiveStandingPolicy = {
  autoAllowed: boolean
  requiresApproval: boolean
  reason: string
}

export function isDangerousAction(actionKind: string): boolean {
  return DANGEROUS.has(actionKind)
}

/**
 * Pure policy: mode from caller only (no env). `safetyLock` is applied in `evaluateAutoOrApproval`.
 */
export function getEffectivePolicy(mode: StandingPermissionMode, actionKind: string): EffectiveStandingPolicy {
  if (isDangerousAction(actionKind)) {
    return {
      autoAllowed: false,
      requiresApproval: true,
      reason: 'Dangerous actions are never auto-allowed and always require explicit human approval.',
    }
  }

  const catalog = STANDING_AUTO_ALLOW_BY_MODE[mode]
  const autoAllowed = catalog.includes(actionKind)

  if (autoAllowed) {
    return {
      autoAllowed: true,
      requiresApproval: false,
      reason: `Action "${actionKind}" is in the standing auto-allow catalog for "${mode}" mode.`,
    }
  }

  return {
    autoAllowed: false,
    requiresApproval: true,
    reason: `Action "${actionKind}" is not auto-allowed in "${mode}" mode — explicit approval is required per request.`,
  }
}

export type StandingBody = Record<string, unknown>

export type AutoOrApprovalResult =
  | { ok: true; viaAutoPolicy: boolean }
  | { ok: false; status: number; error: string }

/** Union of standing catalogs and dangerous kinds (for GET /api/permissions/status). */
export function allRegisteredActionKinds(): readonly string[] {
  const s = new Set<string>()
  for (const list of Object.values(STANDING_AUTO_ALLOW_BY_MODE)) {
    for (const k of list) s.add(k)
  }
  for (const k of DANGEROUS_ACTION_KINDS) s.add(k)
  return Array.from(s).sort()
}

/**
 * Server / route gate: standing mode + safety lock + optional body flags.
 * - `approval_granted: true` always satisfies human confirmation (non-dangerous still blocked only by missing dangerous approval).
 * - Dangerous kinds never use standing auto; they require `approval_granted: true`.
 */
export function assertAutoOrApproval(input: {
  mode: StandingPermissionMode
  safetyLock: boolean
  actionKind: string
  body: StandingBody
}): AutoOrApprovalResult {
  const approvalGranted = input.body.approval_granted === true
  const standingOverride = input.body.standing_override === true

  if (isDangerousAction(input.actionKind)) {
    if (!approvalGranted) {
      return {
        ok: false,
        status: 403,
        error: 'This action is classified as dangerous and requires approval_granted: true in the JSON body.',
      }
    }
    return { ok: true, viaAutoPolicy: false }
  }

  if (approvalGranted) {
    return { ok: true, viaAutoPolicy: false }
  }

  const policy = getEffectivePolicy(input.mode, input.actionKind)

  if (!policy.autoAllowed) {
    return {
      ok: false,
      status: 403,
      error: 'Standing permissions require explicit confirmation: set approval_granted: true, or switch mode / lift safety lock.',
    }
  }

  if (input.safetyLock && !standingOverride) {
    return {
      ok: false,
      status: 403,
      error: 'Safety lock is on: auto-allowed actions need standing_override: true or approval_granted: true for this request.',
    }
  }

  return { ok: true, viaAutoPolicy: true }
}

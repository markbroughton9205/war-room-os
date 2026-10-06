/**
 * Execution receipts for meaningful Council tool actions.
 * Never store secrets. Support later audit/evaluation. Not "learning".
 */

import { RECEIPT_SCHEMA, type ExecutionReceipt, type GovernorVerdict, type SideEffectClass } from './types'

const SECRETISH = /(api[_-]?key|secret|token|password|service.role|private[_-]?key|authorization:\s*\S+)/i

export function redactReceiptText(text: string): string {
  return text
    .replace(/\b(api[_-]?key|secret|token|password|service[_-]?role|private[_-]?key)\b\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(SECRETISH, '[REDACTED]')
}

export function sideEffectForTool(toolName: string): SideEffectClass {
  if (/commit|push|deploy|delete|write|mutate/.test(toolName)) return 'IRREVERSIBLE'
  if (/spend|trade|wager|settlement|payment/.test(toolName)) return 'FINANCIAL'
  if (/broker\.fetch|browser\./.test(toolName)) return 'EXTERNAL_READ'
  if (/health|ports|git\.branch|status/.test(toolName)) return 'READ'
  return 'NONE'
}

export function createReceipt(input: {
  missionId: string
  stepId?: string | null
  capability: string
  requestedAction: string
  authorityResult: GovernorVerdict
  startedAt: string
  completedAt: string
  success: boolean
  resultSummary: string
  evidenceIds?: readonly string[]
  reversible?: boolean
  error?: string | null
  runtimeIdentity?: string | null
}): ExecutionReceipt {
  const side = sideEffectForTool(input.capability)
  return Object.freeze({
    schema: RECEIPT_SCHEMA,
    receipt_id: `rcpt-${input.missionId}-${Math.abs(hash(input.capability + input.startedAt)).toString(36)}`,
    mission_id: input.missionId,
    step_id: input.stepId ?? null,
    capability: input.capability,
    requested_action: redactReceiptText(input.requestedAction),
    authority_result: input.authorityResult,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    success: input.success,
    result_summary: redactReceiptText(input.resultSummary).slice(0, 400),
    evidence_ids: [...(input.evidenceIds ?? [])],
    side_effect_class: side,
    reversible: input.reversible ?? (side === 'READ' || side === 'NONE' || side === 'EXTERNAL_READ'),
    error: input.error ? redactReceiptText(input.error) : null,
    runtime_identity: input.runtimeIdentity ?? null,
  })
}

function hash(value: string): number {
  let h = 2166136261
  for (const ch of value) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h
}

export function receiptContainsSecret(receipt: ExecutionReceipt): boolean {
  const blob = `${receipt.result_summary}\n${receipt.error ?? ''}\n${receipt.requested_action}`
  return SECRETISH.test(blob)
}

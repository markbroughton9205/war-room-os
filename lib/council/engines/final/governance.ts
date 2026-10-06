/**
 * ENGINE-11 Explainability, approval broker, capability manifest, governance.
 * Explanations from receipts. No hidden CoT. No fictional capabilities.
 */
import { lookupCapability, listIndexedCapabilities } from '@/lib/council/intelligence/capabilityRegistry'
import { ENGINE_11_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { fingerprintAction } from '../checkpoint/fingerprint'
import { pauseMission, cancelMission } from '../long-horizon/engine'
import { saveFinalJson, loadFinalJson, listFinalJson } from './store'
import type { ApprovalRequest, ApprovalStatus, CapabilityManifestRow } from './types'

export function explainFromReceipts(input: {
  why_model?: string
  why_tool?: string
  why_source?: string
  why_stop?: string
  why_permission?: string
  uncertain?: string[]
}): string {
  return [
    input.why_model ? `model: ${input.why_model}` : null,
    input.why_tool ? `tool: ${input.why_tool}` : null,
    input.why_source ? `source: ${input.why_source}` : null,
    input.why_stop ? `stop: ${input.why_stop}` : null,
    input.why_permission ? `permission: ${input.why_permission}` : null,
    input.uncertain?.length ? `uncertain: ${input.uncertain.join('; ')}` : null,
  ].filter(Boolean).join('\n') || 'no structured receipt for this question'
}

export function createApprovalRequest(input: {
  mission_id: string
  task_id: string
  action: string
  payload?: string
  risk_class?: string
  requested_authority?: string
  scope?: ApprovalRequest['scope']
  ttl_ms?: number
}): ApprovalRequest {
  const fp = fingerprintAction(input.action, input.task_id, input.payload ?? '')
  return {
    request_id: `apr-${fp}`,
    mission_id: input.mission_id,
    task_id: input.task_id,
    action: input.action,
    action_fingerprint: fp,
    risk_class: input.risk_class ?? 'authority',
    requested_authority: input.requested_authority ?? 'COMMANDER',
    expiration: new Date(Date.now() + (input.ttl_ms ?? 3_600_000)).toISOString(),
    status: 'PENDING',
    scope: input.scope ?? 'ONE_ACTION',
    text_claiming_approval: false,
  }
}

export function decideApproval(req: ApprovalRequest, input: {
  fingerprint: string
  decision: 'APPROVED' | 'DECLINED'
  now?: string
  payload?: string
}): ApprovalRequest {
  const now = input.now ?? new Date().toISOString()
  if (Date.parse(req.expiration) < Date.parse(now)) return { ...req, status: 'EXPIRED' }
  const expected = fingerprintAction(req.action, req.task_id, input.payload ?? '')
  if (input.fingerprint !== req.action_fingerprint || (input.payload !== undefined && expected !== req.action_fingerprint)) {
    return { ...req, status: 'SUPERSEDED' }
  }
  return { ...req, status: input.decision }
}

export function actionChangeInvalidates(req: ApprovalRequest, newPayload: string): boolean {
  return fingerprintAction(req.action, req.task_id, newPayload) !== req.action_fingerprint
}

export function capabilityManifest(): CapabilityManifestRow[] {
  return listIndexedCapabilities().map(row => ({
    capability_id: row.capability_id,
    health: row.health,
    approval_required: row.approval_required,
    unavailable: row.health === 'UNKNOWN',
    read_only: row.read_or_write === 'read',
    experimental: false,
    claimed: true,
    present_in_registry: true,
  }))
}

export function cannotClaimMissing(id: string): boolean {
  return !lookupCapability(id)
}

export async function persistApproval(req: ApprovalRequest): Promise<void> {
  await saveFinalJson('approvals', req.request_id, req)
}

export async function listApprovals(): Promise<ApprovalRequest[]> {
  return listFinalJson<ApprovalRequest>('approvals')
}

export function governanceReceipt(mission_id: string, decision: string) {
  return createEngineReceipt({
    engine: 'approval-broker',
    mission_id,
    started_at: Date.now(),
    decision_count: 1,
    decision: `${decision}:${ENGINE_11_VERSION}`,
  })
}

export { pauseMission, cancelMission, loadFinalJson }
export type { ApprovalStatus }

import type { WarRoomEvent } from '@/lib/events/types'

export type NotificationSeverity = 'urgent' | 'error' | 'info'

export type ClassifiedNotification = {
  severity: NotificationSeverity
  title: string
  detail: string
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Classifies a WarRoomEvent into a notification severity + human-readable text. Pure, no I/O. */
export function classifyWarRoomEvent(event: WarRoomEvent): ClassifiedNotification {
  const payload = event.payload ?? {}

  switch (event.type) {
    case 'action.approval_required':
      return {
        severity: 'urgent',
        title: 'Approval required',
        detail: str(payload.summary, 'A pending action needs Commander approval.'),
      }
    case 'action.failed':
      return {
        severity: 'error',
        title: 'Action failed',
        detail: str(payload.error, 'An action failed to complete.'),
      }
    case 'action.approved': {
      const actionId = str(payload.actionId)
      return {
        severity: 'info',
        title: 'Action Approved',
        detail: actionId ? `Action ${actionId} was approved.` : 'An action was approved.',
      }
    }
    case 'action.rejected': {
      const actionId = str(payload.actionId)
      const reason = str(payload.reason)
      const base = actionId ? `Action ${actionId} was rejected.` : 'An action was rejected.'
      return {
        severity: 'info',
        title: 'Action Rejected',
        detail: reason ? `${base} Reason: ${reason}` : base,
      }
    }
    case 'action.deferred': {
      const actionId = str(payload.actionId)
      const reason = str(payload.reason)
      const base = actionId ? `Action ${actionId} was deferred.` : 'An action was deferred.'
      return {
        severity: 'info',
        title: 'Action Deferred',
        detail: reason ? `${base} Reason: ${reason}` : base,
      }
    }
    case 'action.archived': {
      const actionId = str(payload.actionId)
      return {
        severity: 'info',
        title: 'Action Archived',
        detail: actionId ? `Action ${actionId} was archived.` : 'An action was archived.',
      }
    }
    case 'red_sentinel.scan.completed': {
      const findings = num(payload.findings)
      return {
        severity: findings > 0 ? 'urgent' : 'info',
        title: findings > 0 ? `Red Sentinel: ${findings} finding(s)` : 'Red Sentinel scan completed',
        detail: findings > 0
          ? 'Red Sentinel scan surfaced new findings — review in the Red Team workspace.'
          : 'Red Sentinel scan completed with no findings.',
      }
    }
    case 'council.repair_packet.created': {
      const severity = str(payload.severity)
      const classification = str(payload.classification)
      const urgent = severity === 'critical' || severity === 'high' || classification === 'security_truth_boundary_issue'
      return {
        severity: urgent ? 'urgent' : 'info',
        title: str(payload.title, 'Repair packet created'),
        detail: str(payload.concreteIssue, 'A repair packet was prepared and is awaiting Commander review.'),
      }
    }
    default:
      return {
        severity: 'info',
        title: event.type,
        detail: `${event.type} event recorded.`,
      }
  }
}

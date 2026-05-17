import 'server-only'

import { getLearningSupabase, type LearningStoreResult } from './learningPersistence'

export type NotificationQueueSeverity = 'info' | 'watch' | 'warning' | 'critical'
export type NotificationQueueStatus = 'queued' | 'ready_for_commander' | 'acknowledged' | 'dismissed' | 'archived'

export type NotificationPreferenceRow = {
  id: string
  commander_id: string
  escalation_settings: Record<string, unknown>
  alert_severity_preferences: Record<string, unknown>
  delivery_modes: string[]
  quiet_hours: Record<string, unknown>
  disabled_alert_categories: string[]
  external_dispatch_enabled: false
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type NotificationQueueRow = {
  id: string
  alert_payload: Record<string, unknown>
  severity: NotificationQueueSeverity
  source: string
  status: NotificationQueueStatus
  delivery_readiness: 'dashboard_ready' | 'waiting_commander' | 'disabled_by_preference'
  acknowledged: boolean
  acknowledged_at: string | null
  dismissed: boolean
  dismissed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

const PREFERENCE_COLUMNS = 'id,commander_id,escalation_settings,alert_severity_preferences,delivery_modes,quiet_hours,disabled_alert_categories,external_dispatch_enabled,metadata,created_at,updated_at'
const QUEUE_COLUMNS = 'id,alert_payload,severity,source,status,delivery_readiness,acknowledged,acknowledged_at,dismissed,dismissed_at,metadata,created_at,updated_at'

export async function listNotificationPreferences(): Promise<LearningStoreResult<NotificationPreferenceRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_notification_preferences')
    .select(PREFERENCE_COLUMNS)
    .order('updated_at', { ascending: false })

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as NotificationPreferenceRow[] }
}

export async function listNotificationQueue(limit = 25): Promise<LearningStoreResult<NotificationQueueRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_notification_queue')
    .select(QUEUE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as NotificationQueueRow[] }
}

export async function enqueueCommanderNotification(input: {
  alertPayload: Record<string, unknown>
  severity?: NotificationQueueSeverity
  source: string
  metadata?: Record<string, unknown>
}): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_notification_queue')
    .insert({
      alert_payload: input.alertPayload,
      severity: input.severity ?? 'info',
      source: input.source,
      status: 'queued',
      delivery_readiness: 'dashboard_ready',
      acknowledged: false,
      dismissed: false,
      metadata: {
        ...(input.metadata ?? {}),
        externalDispatchAttempted: false,
      },
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Notification queue insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}

export async function acknowledgeNotification(id: string): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup
  const acknowledgedAt = new Date().toISOString()
  const { data, error } = await sup.value
    .from('war_room_notification_queue')
    .update({ acknowledged: true, acknowledged_at: acknowledgedAt, status: 'acknowledged' })
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Notification acknowledgement failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}

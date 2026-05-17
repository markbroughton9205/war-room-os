import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { BridgeNodeRegistryEntry, BridgeStatusTimelineEntry } from './types'

type BridgeAuditInput = {
  nodeId?: string | null
  eventType: BridgeStatusTimelineEntry['eventType']
  severity?: BridgeStatusTimelineEntry['severity']
  summary: string
  action?: string | null
  payload?: Record<string, unknown>
  rejected?: boolean
}

function getAdminOrNull() {
  try {
    return createSupabaseAdminClient()
  } catch {
    return null
  }
}

function relationMissing(error: { code?: string; message?: string } | null) {
  return error?.code === '42P01' || /does not exist|schema cache/i.test(error?.message ?? '')
}

export async function persistBridgeNode(node: BridgeNodeRegistryEntry) {
  const supabase = getAdminOrNull()
  if (!supabase) return { ok: false as const, configured: false as const }

  const { error } = await supabase.from('war_room_bridge_nodes').upsert({
    node_id: node.node_id,
    node_name: node.node_name,
    node_type: node.node_type,
    status: node.status,
    provider: node.provider,
    active_model: node.active_model,
    last_heartbeat: node.last_heartbeat,
    latency_ms: node.latency,
    capabilities: node.capabilities,
    trust_level: node.trust_level,
    reconnect_status: node.reconnect_status,
    degraded_reason: node.degraded_reason,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'node_id' })

  return { ok: !error, configured: true as const, tableMissing: relationMissing(error) }
}

export async function persistBridgeHeartbeat(input: {
  node: BridgeNodeRegistryEntry
  providers: unknown[]
  eventType: 'heartbeat' | 'failure' | 'reconnect'
}) {
  const supabase = getAdminOrNull()
  if (!supabase) return { ok: false as const, configured: false as const }

  const { error } = await supabase.from('war_room_bridge_heartbeat_history').insert({
    node_id: input.node.node_id,
    node_name: input.node.node_name,
    node_type: input.node.node_type,
    status: input.node.status,
    provider: input.node.provider,
    active_model: input.node.active_model,
    latency_ms: input.node.latency,
    capabilities: input.node.capabilities,
    trust_level: input.node.trust_level,
    reconnect_status: input.node.reconnect_status,
    providers: input.providers,
    event_type: input.eventType,
  })

  return { ok: !error, configured: true as const, tableMissing: relationMissing(error) }
}

export async function persistBridgeProviderEvent(input: {
  nodeId: string
  eventType: 'provider_change' | 'model_swap' | 'failure' | 'reconnect'
  previousProvider?: string | null
  nextProvider?: string | null
  previousModel?: string | null
  nextModel?: string | null
  summary: string
}) {
  const supabase = getAdminOrNull()
  if (!supabase) return { ok: false as const, configured: false as const }

  const { error } = await supabase.from('war_room_bridge_provider_events').insert({
    node_id: input.nodeId,
    event_type: input.eventType,
    previous_provider: input.previousProvider ?? null,
    next_provider: input.nextProvider ?? null,
    previous_model: input.previousModel ?? null,
    next_model: input.nextModel ?? null,
    summary: input.summary,
  })

  return { ok: !error, configured: true as const, tableMissing: relationMissing(error) }
}

export async function persistBridgeAuditLog(input: BridgeAuditInput) {
  const supabase = getAdminOrNull()
  if (!supabase) return { ok: false as const, configured: false as const }

  const { error } = await supabase.from('war_room_bridge_audit_logs').insert({
    node_id: input.nodeId ?? null,
    event_type: input.eventType,
    severity: input.severity ?? 'info',
    summary: input.summary,
    action: input.action ?? null,
    payload: input.payload ?? {},
    rejected: input.rejected ?? false,
    shell_execution_allowed: false,
    filesystem_write_allowed: false,
    deployment_control_allowed: false,
    os_automation_allowed: false,
  })

  return { ok: !error, configured: true as const, tableMissing: relationMissing(error) }
}

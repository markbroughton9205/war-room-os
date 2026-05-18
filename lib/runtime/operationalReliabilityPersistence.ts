import type { RuntimeReliabilitySnapshot } from '@/lib/runtime/operationalReliabilityTypes'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

type PersistenceResult = {
  configured: boolean
  snapshotsPersisted: boolean
  error: string | null
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown persistence error')
}

export async function persistRuntimeReliabilitySnapshot(
  snapshot: RuntimeReliabilitySnapshot,
): Promise<PersistenceResult> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return { configured: false, snapshotsPersisted: false, error: supabase.configError }
  }

  try {
    const providerRows = snapshot.providers.map(provider => ({
      provider_id: provider.providerId,
      provider_name: provider.provider,
      health: provider.health,
      truth_boundary: provider.truthBoundary,
      latency_ms: provider.latencyMs,
      checked_at: provider.checkedAt,
      last_success_at: provider.lastSuccessAt,
      failure_count: provider.failureCount,
      degraded_reason: provider.degradedReason,
      timeout_count: provider.timeoutCount,
      rate_limit_state: provider.rateLimitState,
      rate_limit_reset_at: provider.rateLimitResetAt,
      active_models: provider.activeModels,
      signal_availability: provider.signalAvailability,
      fallback_mode: provider.fallbackMode,
      raw_snapshot: provider,
    }))

    if (providerRows.length) {
      const { error } = await supabase.client.from('war_room_provider_snapshots').insert(providerRows)
      if (error) throw error
    }

    const { error: eventError } = await supabase.client.from('war_room_runtime_events').insert({
      event_type: 'runtime_reliability_snapshot',
      severity: snapshot.degraded.length ? 'degraded' : 'informational',
      mode: snapshot.mode,
      truth_boundary: snapshot.degraded.length ? 'DEGRADED' : 'SOURCE_BACKED',
      summary: snapshot.degraded.length
        ? `${snapshot.degraded.length} degraded runtime systems observed.`
        : 'Runtime reliability snapshot collected without current degraded records.',
      payload: {
        generatedAt: snapshot.generatedAt,
        recommendations: snapshot.recommendations,
        observability: snapshot.observability,
        rollbackAwareness: snapshot.rollbackAwareness,
      },
    })
    if (eventError) throw eventError

    const dependencyRows = snapshot.graph.nodes.map(node => ({
      system_id: node.id,
      label: node.label,
      truth_boundary: node.truthBoundary,
      mode: node.mode,
      health: node.health,
      upstream: node.upstream,
      downstream: node.downstream,
      degraded_reason: node.degradedReason,
      fallback_mode: node.fallbackMode,
      isolated_failure: node.isolatedFailure,
      blocked_by: node.blockedBy,
      evidence: node.evidence,
      continuity: node.continuity,
      recovery: node.recovery,
      edges: snapshot.graph.edges.filter(edge => edge.from === node.id || edge.to === node.id),
      observed_at: snapshot.generatedAt,
    }))

    if (dependencyRows.length) {
      const { error } = await supabase.client.from('war_room_runtime_dependencies').insert(dependencyRows)
      if (error) throw error
    }

    if (snapshot.degraded.length) {
      const { error } = await supabase.client.from('war_room_runtime_failures').insert(
        snapshot.degraded.map(record => ({
          system_id: record.systemId,
          label: record.label,
          truth_boundary: record.truthBoundary,
          reason: record.why,
          impact: record.impact,
          recovery: record.recovery,
          downstream_consequences: record.downstreamConsequences,
          continuity: record.continuity,
          observed_at: snapshot.generatedAt,
        })),
      )
      if (error) throw error
    }

    return { configured: true, snapshotsPersisted: true, error: null }
  } catch (error) {
    return { configured: true, snapshotsPersisted: false, error: stringifyError(error) }
  }
}

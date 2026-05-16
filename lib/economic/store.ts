import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { ECONOMIC_DOMAIN_REGISTRY } from '@/lib/economic/domains'
import type {
  ActiveEconomicMission,
  EconomicOpportunity,
  EconomicProposal,
  EconomicTelemetryEvent,
  EconomicWorkflowQueueItem,
  ProviderEffectivenessSnapshot,
  UnresolvedEconomicOperation,
} from '@/lib/economic/types'

type StoreResult<T> = Promise<{ ok: true; value: T } | { ok: false; error: string }>

function metadataOf(value: { metadata?: Record<string, unknown> }): Record<string, unknown> {
  return value.metadata && typeof value.metadata === 'object' ? value.metadata : {}
}

export async function seedEconomicOperationalDomains(client: WarRoomSupabase): StoreResult<number> {
  const { error } = await client
    .from('war_room_economic_operational_domains')
    .upsert(
      ECONOMIC_DOMAIN_REGISTRY.map(domain => ({
        id: domain.id,
        label: domain.label,
        provider_priority: domain.providerPriority,
        workflow_type: domain.workflowType,
        allowed_tools: domain.allowedTools,
        approval_requirements: domain.approvalRequirements,
        telemetry_category: domain.telemetryCategory,
        output_structure: domain.outputStructure,
      })),
      { onConflict: 'id' },
    )

  if (error) return { ok: false, error: error.message }
  return { ok: true, value: ECONOMIC_DOMAIN_REGISTRY.length }
}

export async function insertEconomicOpportunity(
  client: WarRoomSupabase,
  opportunity: EconomicOpportunity,
): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_opportunities')
    .insert({
      id: opportunity.id,
      title: opportunity.title,
      category: opportunity.category,
      source: opportunity.source,
      confidence: opportunity.confidence,
      estimated_value: opportunity.estimated_value,
      assigned_family: opportunity.assigned_family,
      required_actions: opportunity.required_actions,
      risk_level: opportunity.risk_level,
      status: opportunity.status,
      discovered_at: opportunity.discovered_at,
      expires_at: opportunity.expires_at,
      metadata: metadataOf(opportunity),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message || 'Opportunity insert failed.' }
  return { ok: true, value: data.id as string }
}

export async function insertEconomicWorkflow(
  client: WarRoomSupabase,
  workflow: EconomicWorkflowQueueItem,
): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_workflow_queue')
    .insert({
      id: workflow.id,
      workflow_type: workflow.workflow_type,
      status: workflow.status,
      assigned_family: workflow.assigned_family,
      priority: workflow.priority,
      created_at: workflow.created_at,
      updated_at: workflow.updated_at,
      summary: workflow.summary,
      domain_id: workflow.domain_id,
      approval_required: workflow.approval_required,
      metadata: metadataOf(workflow),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message || 'Workflow insert failed.' }
  return { ok: true, value: data.id as string }
}

export async function insertEconomicProposal(client: WarRoomSupabase, proposal: EconomicProposal): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_proposals')
    .insert({
      id: proposal.id,
      output_type: proposal.output_type,
      status: proposal.status,
      assigned_family: proposal.assigned_family,
      workflow_id: proposal.workflow_id,
      opportunity_id: proposal.opportunity_id,
      title: proposal.title,
      body: proposal.body,
      approval_required: proposal.approval_required,
      external_use_approved_at: proposal.external_use_approved_at,
      created_at: proposal.created_at,
      updated_at: proposal.updated_at,
      metadata: metadataOf(proposal),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message || 'Proposal insert failed.' }
  return { ok: true, value: data.id as string }
}

export async function insertEconomicTelemetryEvent(
  client: WarRoomSupabase,
  event: EconomicTelemetryEvent,
): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_telemetry')
    .insert({
      id: event.id,
      category: event.category,
      provider_family: event.provider_family,
      domain_id: event.domain_id,
      metric_name: event.metric_name,
      metric_value: event.metric_value,
      recorded_at: event.recorded_at,
      metadata: metadataOf(event),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message || 'Telemetry insert failed.' }
  return { ok: true, value: data.id as string }
}

export async function upsertProviderEffectiveness(
  client: WarRoomSupabase,
  snapshot: ProviderEffectivenessSnapshot,
): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_provider_effectiveness')
    .upsert(
      {
        provider_family: snapshot.provider_family,
        success_count: snapshot.success_count,
        failure_count: snapshot.failure_count,
        average_latency_ms: snapshot.average_latency_ms,
        routing_violation_count: snapshot.routing_violation_count,
        updated_at: snapshot.updated_at,
      },
      { onConflict: 'provider_family' },
    )
    .select('provider_family')
    .single()

  if (error || !data?.provider_family) {
    return { ok: false, error: error?.message || 'Provider effectiveness upsert failed.' }
  }
  return { ok: true, value: data.provider_family as string }
}

export async function insertActiveEconomicMission(
  client: WarRoomSupabase,
  mission: ActiveEconomicMission,
): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_active_missions')
    .insert({
      id: mission.id,
      title: mission.title,
      domain_id: mission.domain_id,
      assigned_family: mission.assigned_family,
      status: mission.status,
      approval_required: mission.approval_required,
      created_at: mission.created_at,
      updated_at: mission.updated_at,
      metadata: metadataOf(mission),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message || 'Mission insert failed.' }
  return { ok: true, value: data.id as string }
}

export async function insertUnresolvedEconomicOperation(
  client: WarRoomSupabase,
  operation: UnresolvedEconomicOperation,
): StoreResult<string> {
  const { data, error } = await client
    .from('war_room_economic_unresolved_operations')
    .insert({
      id: operation.id,
      domain_id: operation.domain_id,
      workflow_id: operation.workflow_id,
      opportunity_id: operation.opportunity_id,
      reason: operation.reason,
      severity: operation.severity,
      status: operation.status,
      created_at: operation.created_at,
      updated_at: operation.updated_at,
      metadata: metadataOf(operation),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message || 'Unresolved operation insert failed.' }
  return { ok: true, value: data.id as string }
}

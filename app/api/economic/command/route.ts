import { jsonWithPersistence, tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import { extractEconomicOpportunities } from '@/lib/economic/extraction'
import { compressEconomicOpsResponse } from '@/lib/economic/responseCompression'
import {
  insertEconomicAssignmentHistory,
  insertEconomicTelemetryEvent,
  upsertEconomicOpportunity,
  upsertEconomicWorkflow,
} from '@/lib/economic/store'
import { createTelemetryEvent } from '@/lib/economic/telemetry'
import { parseEconomicOperationalCommand } from '@/lib/economic/commands'
import type { EconomicFamily, EconomicOperationalDomainId } from '@/lib/economic/types'

export const dynamic = 'force-dynamic'

type ProviderBody = {
  provider_family?: string
  content?: string
  latency_ms?: number
  success?: boolean
}

function isEconomicFamily(value: string): value is EconomicFamily {
  return value === 'chatgpt' || value === 'claude' || value === 'grok' || value === 'gemini' || value === 'red_team'
}

function isWorkflowQueueDedupeSchemaMissing(error: string): boolean {
  return /dedupe_key/i.test(error)
    && /war_room_economic_workflow_queue/i.test(error)
    && /(schema cache|column|could not find)/i.test(error)
}

function isWorkflowQueueConflictConstraintMissing(error: string): boolean {
  return /no unique or exclusion constraint matching the on conflict specification/i.test(error)
}

function isWorkflowQueuePermissionDenied(error: string): boolean {
  return /permission denied/i.test(error)
    && /war_room_economic_workflow_queue/i.test(error)
}

function looksLikeProviderFailureOnly(content: string): boolean {
  return /\b(provider analysis unavailable|family is currently unavailable|timed out|api[_ ]?key|not configured|unauthorized|provider_http_|returned empty|configuration_error)\b/i
    .test(content)
}

function normalizeProviderSuccess(content: string, success: boolean | undefined): boolean | undefined {
  if (success !== false) return success
  if (content.trim().length >= 80 && !looksLikeProviderFailureOnly(content)) return true
  return false
}

async function recordExtractionTelemetry(args: {
  client: WarRoomSupabase
  domainId: EconomicOperationalDomainId
  providerFamily: EconomicFamily | null
  command: string
  sessionId?: string | null
  metricName: string
  metricValue: number
  metadata?: Record<string, unknown>
}) {
  await insertEconomicTelemetryEvent(args.client, createTelemetryEvent({
    category: args.metricName === 'extraction_success' ? 'opportunity_count' : 'operational_throughput',
    domain_id: args.domainId,
    provider_family: args.providerFamily,
    metric_name: args.metricName,
    metric_value: args.metricValue,
    metadata: {
      command: args.command,
      session_id: args.sessionId ?? null,
      ...(args.metadata ?? {}),
    },
  }))
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const payload = body as {
    decree?: string
    sessionId?: string | null
    providerAnalyses?: ProviderBody[]
  }
  const decree = typeof payload.decree === 'string' ? payload.decree.trim() : ''
  if (!decree) return jsonWithPersistence({ error: 'decree is required.' }, true, { status: 400 })

  const providerAnalyses = (Array.isArray(payload.providerAnalyses) ? payload.providerAnalyses : [])
    .map(row => {
      const content = typeof row.content === 'string' ? row.content : ''
      return {
        provider_family: typeof row.provider_family === 'string' && isEconomicFamily(row.provider_family)
          ? row.provider_family
          : 'chatgpt',
        content,
        latency_ms: row.latency_ms,
        success: normalizeProviderSuccess(content, row.success),
      }
    })
  const successfulProviderAnalyses = providerAnalyses.filter(row => row.success !== false && row.content.trim())
  const failedProviderAnalyses = providerAnalyses.filter(row => row.success === false)

  const parsed = parseEconomicOperationalCommand(decree)
  if (!parsed.matched) {
    return jsonWithPersistence({ matched: false, summary: 'No Economic Ops command detected.' }, true)
  }

  for (const [index, analysis] of providerAnalyses.entries()) {
    await recordExtractionTelemetry({
      client: sup.client,
      domainId: parsed.domain.id,
      providerFamily: analysis.provider_family,
      command: parsed.command,
      sessionId: payload.sessionId,
      metricName: 'provider_invocation_completed',
      metricValue: analysis.success === false ? 0 : 1,
      metadata: {
        provider_selected: index === 0,
        provider_response_length: analysis.content.length,
        provider_success_boolean: analysis.success !== false,
        provider_latency_ms: typeof analysis.latency_ms === 'number' ? analysis.latency_ms : null,
        normalized_provider_payload: {
          provider_family: analysis.provider_family,
          content_length: analysis.content.length,
          success: analysis.success !== false,
          preserved_raw_content_for_extraction: analysis.success !== false && analysis.content.trim().length > 0,
        },
      },
    })
  }

  let extraction: ReturnType<typeof extractEconomicOpportunities>
  try {
    extraction = extractEconomicOpportunities({
      decree,
      sessionId: payload.sessionId,
      providerAnalyses: successfulProviderAnalyses,
    })
  } catch (error) {
    await recordExtractionTelemetry({
      client: sup.client,
      domainId: parsed.domain.id,
      providerFamily: parsed.domain.providerPriority[0],
      command: parsed.command,
      sessionId: payload.sessionId,
      metricName: 'extraction_failure',
      metricValue: 1,
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return jsonWithPersistence({ error: 'Economic opportunity extraction failed.' }, true, { status: 500 })
  }
  const workflowDedupeKey = `workflow:${payload.sessionId ?? 'global'}:${parsed.command}:${parsed.domain.id}:${decree.toLowerCase().replace(/\s+/g, ' ').trim()}`
  parsed.workflow.metadata = { ...(parsed.workflow.metadata ?? {}), dedupe_key: workflowDedupeKey }
  const workflow = await upsertEconomicWorkflow(sup.client, parsed.workflow)
  if (!workflow.ok) {
    if (isWorkflowQueueDedupeSchemaMissing(workflow.error)) {
      return jsonWithPersistence({
        error: 'schema_migration_required',
        message: 'Economic workflow queue is missing dedupe_key in Supabase schema cache. Run supabase/war_room_phase7b_queue_schema_patch.sql, then retry.',
        migration: 'supabase/war_room_phase7b_queue_schema_patch.sql',
        detail: workflow.error,
      }, true, { status: 503 })
    }
    if (isWorkflowQueueConflictConstraintMissing(workflow.error)) {
      return jsonWithPersistence({
        error: 'schema_migration_required',
        message: 'Economic workflow queue dedupe_key does not have a matching unique constraint for upsert. Run supabase/war_room_phase7b_workflow_queue_conflict_patch.sql, then retry.',
        migration: 'supabase/war_room_phase7b_workflow_queue_conflict_patch.sql',
        onConflict: 'dedupe_key',
        detail: workflow.error,
      }, true, { status: 503 })
    }
    if (isWorkflowQueuePermissionDenied(workflow.error)) {
      return jsonWithPersistence({
        error: 'schema_migration_required',
        message: 'Economic workflow queue denies service_role writes. Run supabase/war_room_phase7b_workflow_queue_rls_patch.sql, then retry.',
        migration: 'supabase/war_room_phase7b_workflow_queue_rls_patch.sql',
        role: 'service_role',
        detail: workflow.error,
      }, true, { status: 503 })
    }
    return jsonWithPersistence({ error: workflow.error }, true, { status: 500 })
  }

  await recordExtractionTelemetry({
    client: sup.client,
    domainId: parsed.domain.id,
    providerFamily: extraction.assignedFamily,
    command: parsed.command,
    sessionId: payload.sessionId,
    metricName: 'extraction_attempted',
    metricValue: extraction.telemetry.attempted,
    metadata: {
      ...extraction.telemetry,
      extraction_input_count: successfulProviderAnalyses.length,
      failed_provider_input_count: failedProviderAnalyses.length,
    },
  })

  let inserted = 0
  for (const opportunity of extraction.opportunities) {
    const saved = await upsertEconomicOpportunity(sup.client, opportunity)
    if (saved.ok) {
      inserted += 1
      await insertEconomicAssignmentHistory(sup.client, {
        id: crypto.randomUUID(),
        subject_type: 'opportunity',
        subject_id: opportunity.id,
        assigned_family: opportunity.assigned_family,
        provider_runtime_state: 'recommended',
        confidence: opportunity.confidence,
        last_activity_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        metadata: {
          source_provider: opportunity.source_provider,
          workflow_id: workflow.value,
          approval_required: true,
        },
      })
    }
  }

  await recordExtractionTelemetry({
    client: sup.client,
    domainId: parsed.domain.id,
    providerFamily: extraction.assignedFamily,
    command: parsed.command,
    sessionId: payload.sessionId,
    metricName: inserted > 0 ? 'extraction_success' : 'extraction_empty',
    metricValue: inserted > 0 ? inserted : 1,
    metadata: {
      ...extraction.telemetry,
      extraction_input_count: successfulProviderAnalyses.length,
      extraction_output_count: extraction.opportunities.length,
      inserted_opportunities: inserted,
    },
  })

  if (extraction.telemetry.fallbackStatus === 'created') {
    await recordExtractionTelemetry({
      client: sup.client,
      domainId: parsed.domain.id,
      providerFamily: extraction.assignedFamily,
      command: parsed.command,
      sessionId: payload.sessionId,
      metricName: 'extraction_empty_fallback',
      metricValue: 1,
      metadata: extraction.telemetry,
    })
  }

  if (extraction.telemetry.fallbackStatus === 'skipped_low_quality') {
    await recordExtractionTelemetry({
      client: sup.client,
      domainId: parsed.domain.id,
      providerFamily: extraction.assignedFamily,
      command: parsed.command,
      sessionId: payload.sessionId,
      metricName: 'extraction_fallback_skipped_low_quality',
      metricValue: 1,
      metadata: extraction.telemetry,
    })
  }

  await insertEconomicTelemetryEvent(sup.client, createTelemetryEvent({
    category: 'opportunity_count',
    domain_id: parsed.domain.id,
    provider_family: extraction.assignedFamily,
    metric_name: 'opportunities_extracted',
    metric_value: inserted,
    metadata: { command: parsed.command, session_id: payload.sessionId ?? null },
  }))

  for (const failure of failedProviderAnalyses) {
    await insertEconomicTelemetryEvent(sup.client, createTelemetryEvent({
      category: 'provider_success_failure_rate',
      domain_id: parsed.domain.id,
      provider_family: failure.provider_family,
      metric_name: 'provider_failure',
      metric_value: 1,
      metadata: {
        command: parsed.command,
        session_id: payload.sessionId ?? null,
        failure_detail: failure.content.slice(0, 1000),
        broadcast_to_council: false,
      },
    }))
  }

  const compression = compressEconomicOpsResponse({
    assignedFamily: parsed.domain.providerPriority[0],
    opportunityCount: inserted,
    workflowCount: 1,
    fullProviderAnalysis: successfulProviderAnalyses.map(row => `[${row.provider_family}]\n${row.content}`).join('\n\n'),
  })

  return jsonWithPersistence({
    matched: true,
    summary: failedProviderAnalyses.length && successfulProviderAnalyses.length === 0 && inserted === 0
      ? 'Economic Ops routed to Opportunity Scout, but provider analysis failed. Failure telemetry was stored without broadcasting family availability spam.'
      : `${inserted} opportunities discovered and added to Opportunity Scout.`,
    workflowId: workflow.value,
    opportunityCount: inserted,
    providerFailures: failedProviderAnalyses.length,
    compression,
    approvalRequired: true,
  }, true, { status: 201 })
}

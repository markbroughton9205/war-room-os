import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
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
import type { EconomicFamily } from '@/lib/economic/types'

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
    .map(row => ({
      provider_family: typeof row.provider_family === 'string' && isEconomicFamily(row.provider_family)
        ? row.provider_family
        : 'chatgpt',
      content: typeof row.content === 'string' ? row.content : '',
      latency_ms: row.latency_ms,
      success: row.success,
    }))
    .filter(row => row.content.trim())

  const parsed = parseEconomicOperationalCommand(decree)
  if (!parsed.matched) {
    return jsonWithPersistence({ matched: false, summary: 'No Economic Ops command detected.' }, true)
  }

  const extraction = extractEconomicOpportunities({ decree, sessionId: payload.sessionId, providerAnalyses })
  const workflowDedupeKey = `workflow:${payload.sessionId ?? 'global'}:${parsed.command}:${parsed.domain.id}:${decree.toLowerCase().replace(/\s+/g, ' ').trim()}`
  parsed.workflow.metadata = { ...(parsed.workflow.metadata ?? {}), dedupe_key: workflowDedupeKey }
  const workflow = await upsertEconomicWorkflow(sup.client, parsed.workflow)
  if (!workflow.ok) return jsonWithPersistence({ error: workflow.error }, true, { status: 500 })

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

  await insertEconomicTelemetryEvent(sup.client, createTelemetryEvent({
    category: 'opportunity_count',
    domain_id: parsed.domain.id,
    provider_family: extraction.assignedFamily,
    metric_name: 'opportunities_extracted',
    metric_value: inserted,
    metadata: { command: parsed.command, session_id: payload.sessionId ?? null },
  }))

  const compression = compressEconomicOpsResponse({
    assignedFamily: parsed.domain.providerPriority[0],
    opportunityCount: inserted,
    workflowCount: 1,
    fullProviderAnalysis: providerAnalyses.map(row => `[${row.provider_family}]\n${row.content}`).join('\n\n'),
  })

  return jsonWithPersistence({
    matched: true,
    summary: `${inserted} opportunities discovered and added to Opportunity Scout.`,
    workflowId: workflow.value,
    opportunityCount: inserted,
    compression,
    approvalRequired: true,
  }, true, { status: 201 })
}

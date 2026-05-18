import 'server-only'

import { buildFeatureBuildPacket, buildFeatureReviews } from './pipeline'
import type {
  FeatureBuildPacket,
  FeatureBuilderOutcome,
  FeatureBuilderRequest,
  FeatureBuilderRequestInput,
  FeatureBuilderReview,
  FeatureBuilderSnapshot,
  FeatureBuilderStatus,
  FeatureBuilderApprovalStatus,
} from './model'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'

type Row = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function objectArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function status(value: unknown, fallback: FeatureBuilderStatus): FeatureBuilderStatus {
  const raw = text(value)
  if (['idea', 'reviewed', 'approved', 'sent_to_cursor', 'building', 'validated', 'shipped'].includes(raw)) {
    return raw as FeatureBuilderStatus
  }
  return fallback
}

function approval(value: unknown): FeatureBuilderApprovalStatus {
  const raw = text(value)
  if (['proposal_only', 'awaiting_commander_approval', 'approved', 'rejected'].includes(raw)) {
    return raw as FeatureBuilderApprovalStatus
  }
  return 'awaiting_commander_approval'
}

function mapRequest(row: Row): FeatureBuilderRequest {
  return {
    id: text(row.id),
    requestId: text(row.request_id),
    idea: text(row.idea),
    targetAppModule: text(row.target_app_module, 'War Room app module'),
    commanderContext: row.commander_context == null ? null : text(row.commander_context),
    status: status(row.status, 'idea'),
    approvalStatus: approval(row.approval_status),
    createdAt: text(row.created_at, new Date().toISOString()),
    updatedAt: row.updated_at == null ? null : text(row.updated_at),
  }
}

function mapPacket(row: Row): FeatureBuildPacket {
  const packet = jsonObject(row.packet_json)
  return {
    id: text(row.id),
    requestId: text(row.request_id),
    title: text(row.title),
    objective: text(row.objective),
    userStory: text(row.user_story),
    targetAppModule: text(row.target_app_module),
    requiredFilesToInspect: stringArray(row.required_files_to_inspect),
    technicalApproach: stringArray(row.technical_approach),
    databaseChanges: stringArray(row.database_changes),
    apiRoutes: stringArray(row.api_routes),
    uiComponents: stringArray(row.ui_components),
    validationCommands: stringArray(row.validation_commands) as FeatureBuildPacket['validationCommands'],
    risks: stringArray(row.risks),
    rollbackNotes: stringArray(row.rollback_notes),
    approvalStatus: approval(row.approval_status),
    status: status(row.status, 'reviewed'),
    monetizationAngle: text(row.monetization_angle),
    cursorReadyImplementationPrompt: text(row.cursor_ready_prompt),
    familyContributions: objectArray<FeatureBuildPacket['familyContributions'][number]>(packet.familyContributions),
    liveCouncil: {
      babyContributionsEnabled: true,
      executionAllowed: false,
      cursorHandoffAllowed: 'manual_copy_only',
      providerDependency: 'cloud_only',
    },
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapReview(row: Row): FeatureBuilderReview {
  return {
    id: text(row.id),
    packetId: text(row.packet_id),
    agentKey: text(row.agent_key) as FeatureBuilderReview['agentKey'],
    agentName: text(row.agent_name),
    reviewType: text(row.review_type, 'synthesis') as FeatureBuilderReview['reviewType'],
    summary: text(row.summary),
    confidence: Number(row.confidence ?? 0),
    approvalRequired: true,
    canExecute: false,
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

function mapOutcome(row: Row): FeatureBuilderOutcome {
  return {
    id: text(row.id),
    packetId: text(row.packet_id),
    status: status(row.status, 'idea'),
    summary: text(row.summary),
    validated: Boolean(row.validated),
    createdAt: text(row.created_at, new Date().toISOString()),
  }
}

async function insertFeatureRequest(client: WarRoomSupabase, input: FeatureBuilderRequestInput, packet: FeatureBuildPacket) {
  const { data, error } = await client
    .from('war_room_feature_requests')
    .insert({
      request_id: packet.requestId,
      idea: input.idea.trim(),
      target_app_module: packet.targetAppModule,
      commander_context: input.commanderContext?.trim() || null,
      status: 'reviewed',
      approval_status: 'awaiting_commander_approval',
      source: 'war_room_feature_builder',
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Feature request insert failed.')
  return mapRequest(data as Row)
}

async function insertFeaturePacket(client: WarRoomSupabase, request: FeatureBuilderRequest, packet: FeatureBuildPacket) {
  const { data, error } = await client
    .from('war_room_feature_build_packets')
    .insert({
      request_id: request.id,
      packet_key: packet.id,
      title: packet.title,
      objective: packet.objective,
      user_story: packet.userStory,
      target_app_module: packet.targetAppModule,
      required_files_to_inspect: packet.requiredFilesToInspect,
      technical_approach: packet.technicalApproach,
      database_changes: packet.databaseChanges,
      api_routes: packet.apiRoutes,
      ui_components: packet.uiComponents,
      validation_commands: packet.validationCommands,
      risks: packet.risks,
      rollback_notes: packet.rollbackNotes,
      approval_status: packet.approvalStatus,
      status: packet.status,
      monetization_angle: packet.monetizationAngle,
      cursor_ready_prompt: packet.cursorReadyImplementationPrompt,
      packet_json: packet,
      execution_allowed: false,
      cursor_invoked: false,
      file_mutation_performed: false,
      deployment_performed: false,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'Feature packet insert failed.')
  return mapPacket(data as Row)
}

async function insertFeatureReviews(client: WarRoomSupabase, persistedPacketId: string, reviews: FeatureBuilderReview[]) {
  const rows = reviews.map(review => ({
    packet_id: persistedPacketId,
    agent_key: review.agentKey,
    agent_name: review.agentName,
    review_type: review.reviewType,
    summary: review.summary,
    confidence: review.confidence,
    approval_required: true,
    can_execute: false,
  }))
  const { data, error } = await client.from('war_room_feature_reviews').insert(rows).select('*')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map(mapReview)
}

export async function createFeatureBuilderPacket(input: FeatureBuilderRequestInput): Promise<{
  persistenceAvailable: boolean
  persistenceNote: string
  request: FeatureBuilderRequest
  packet: FeatureBuildPacket
  reviews: FeatureBuilderReview[]
}> {
  const idea = input.idea.trim()
  if (!idea) throw new Error('Feature idea is required.')

  const generatedPacket = buildFeatureBuildPacket({ ...input, idea })
  const generatedReviews = buildFeatureReviews(generatedPacket)
  const supabase = tryWarRoomSupabase()

  if (!supabase.ok) {
    return {
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable; packet generated but not persisted: ${supabase.configError}`,
      request: {
        id: generatedPacket.requestId,
        requestId: generatedPacket.requestId,
        idea,
        targetAppModule: generatedPacket.targetAppModule,
        commanderContext: input.commanderContext?.trim() || null,
        status: 'reviewed',
        approvalStatus: 'awaiting_commander_approval',
        createdAt: generatedPacket.createdAt,
        updatedAt: null,
      },
      packet: generatedPacket,
      reviews: generatedReviews,
    }
  }

  const request = await insertFeatureRequest(supabase.client, input, generatedPacket)
  const packet = await insertFeaturePacket(supabase.client, request, { ...generatedPacket, requestId: request.id })
  const reviews = await insertFeatureReviews(supabase.client, packet.id, generatedReviews)
  return {
    persistenceAvailable: true,
    persistenceNote: 'Feature request, build packet, and Baby AI family reviews persisted with service-role access.',
    request,
    packet,
    reviews,
  }
}

export async function listFeatureBuilderSnapshot(limit = 12): Promise<FeatureBuilderSnapshot> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()

  if (!supabase.ok) {
    return {
      generatedAt,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}`,
      requests: [],
      packets: [],
      reviews: [],
      outcomes: [],
      guardrails: {
        hiddenCodeExecution: false,
        autoDeployment: false,
        warRoomFileMutation: false,
        cursorExecution: 'manual_approved_only',
        localConnectors: false,
        cloudOnly: true,
      },
    }
  }

  const [requests, packets, reviews, outcomes] = await Promise.all([
    supabase.client.from('war_room_feature_requests').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_feature_build_packets').select('*').order('created_at', { ascending: false }).limit(limit),
    supabase.client.from('war_room_feature_reviews').select('*').order('created_at', { ascending: false }).limit(limit * 8),
    supabase.client.from('war_room_feature_outcomes').select('*').order('created_at', { ascending: false }).limit(limit),
  ])

  const firstError = [requests.error, packets.error, reviews.error, outcomes.error].find(Boolean)
  if (firstError) {
    return {
      generatedAt,
      persistenceAvailable: true,
      persistenceNote: `Feature Builder tables unavailable or not migrated: ${firstError.message}`,
      requests: [],
      packets: [],
      reviews: [],
      outcomes: [],
      guardrails: {
        hiddenCodeExecution: false,
        autoDeployment: false,
        warRoomFileMutation: false,
        cursorExecution: 'manual_approved_only',
        localConnectors: false,
        cloudOnly: true,
      },
    }
  }

  return {
    generatedAt,
    persistenceAvailable: true,
    persistenceNote: 'Feature Builder persistence is available.',
    requests: ((requests.data ?? []) as Row[]).map(mapRequest),
    packets: ((packets.data ?? []) as Row[]).map(mapPacket),
    reviews: ((reviews.data ?? []) as Row[]).map(mapReview),
    outcomes: ((outcomes.data ?? []) as Row[]).map(mapOutcome),
    guardrails: {
      hiddenCodeExecution: false,
      autoDeployment: false,
      warRoomFileMutation: false,
      cursorExecution: 'manual_approved_only',
      localConnectors: false,
      cloudOnly: true,
    },
  }
}


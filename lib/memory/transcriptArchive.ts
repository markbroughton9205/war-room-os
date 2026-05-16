import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type {
  ParsedRecallCommand,
  RecallSummaryPreview,
  RecallTranscriptPreview,
} from '@/lib/memory/recallCommands'
import {
  classifyMemoryImportance,
  memoryCompressionKey,
  type MemoryImportanceClassification,
  type MemoryImportanceTier,
} from '@/lib/memory/importance'

export type ArchiveVisibility = 'private' | 'shared' | 'household'

export type ArchiveTranscriptInput = {
  id: string
  sessionId: string | null
  decreeId: string | null
  timestamp: string
  role: string
  family: string | null
  provider: string | null
  content: string
  messageType: string
  tags: string[]
  topic: string | null
  sourceMode: string
  operatorId?: string | null
  operatorName?: string | null
  visibility?: ArchiveVisibility
}

type CuratedArchiveMessage = ArchiveTranscriptInput & {
  compressedCount: number
  compressionKey: string
  classification: MemoryImportanceClassification
}

export type ArchiveBatchSummary = {
  keyDecrees: string[]
  decisions: string[]
  opportunitiesCreated: string[]
  failuresErrors: string[]
  providerPerformanceNotes: string[]
  unfinishedTasks: string[]
  nextRecommendedAction: string | null
}

const TABLE_ARCHIVE = 'war_room_archived_transcripts'
const TABLE_SUMMARIES = 'war_room_session_summaries'
const TABLE_STRATEGIC = 'war_room_strategic_memories'

function cleanPreview(content: string, max = 220): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact
}

function archiveDate(timestamp: string): string {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function inferTopic(message: ArchiveTranscriptInput): string | null {
  if (message.topic) return message.topic
  const text = `${message.family ?? ''} ${message.content}`.toLowerCase()
  if (/\bgrok\b|\bxai\b/.test(text)) return 'grok'
  if (/\beconomic ops\b|\bopportunity scout\b|\bincome radar\b/.test(text)) return 'economic_ops'
  if (/\bincome\b|\brevenue\b|\bopportunit(y|ies)\b|\bclient\b|\bleads?\b/.test(text)) return 'income_ideas'
  return null
}

function compressArchiveMessages(messages: ArchiveTranscriptInput[]): (ArchiveTranscriptInput & { compressedCount: number; compressionKey: string })[] {
  const out: (ArchiveTranscriptInput & { compressedCount: number; compressionKey: string })[] = []
  const indexByKey = new Map<string, number>()

  for (const message of messages) {
    const key = memoryCompressionKey(message)
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, out.length)
      out.push({ ...message, compressedCount: 1, compressionKey: key })
      continue
    }

    const existing = out[existingIndex]!
    const nextCount = existing.compressedCount + 1
    out[existingIndex] = {
      ...existing,
      compressedCount: nextCount,
      id: existing.id,
      content: nextCount === 2
        ? `Repeated ${existing.messageType}: "${existing.content}" (${nextCount} times in archived window).`
        : existing.content.replace(/\(\d+ times in archived window\)\.?$/i, `(${nextCount} times in archived window).`),
      tags: [...new Set([...existing.tags, ...message.tags, 'duplicate_compressed'])],
    }
  }

  return out
}

function curateArchiveMessages(messages: ArchiveTranscriptInput[]): {
  curated: CuratedArchiveMessage[]
  skipped: number
  compressed: number
  trivial: number
} {
  const compressed = compressArchiveMessages(messages.filter(message => message.content.trim()))
  const curated: CuratedArchiveMessage[] = []
  let skipped = 0
  let trivial = 0

  for (const message of compressed) {
    const classification = classifyMemoryImportance(message)
    if (!classification.preserve) {
      skipped += message.compressedCount
      trivial += message.compressedCount
      continue
    }
    curated.push({ ...message, classification })
  }

  const compressedSavings = compressed.reduce((sum, message) => sum + Math.max(0, message.compressedCount - 1), 0)
  return { curated, skipped, compressed: compressedSavings, trivial }
}

function summaryToText(summary: ArchiveBatchSummary): string {
  const lines: string[] = []
  if (summary.keyDecrees.length) lines.push(`Key decrees: ${summary.keyDecrees.join(' | ')}`)
  if (summary.decisions.length) lines.push(`Decisions: ${summary.decisions.join(' | ')}`)
  if (summary.opportunitiesCreated.length) lines.push(`Opportunities: ${summary.opportunitiesCreated.join(' | ')}`)
  if (summary.failuresErrors.length) lines.push(`Failures/errors: ${summary.failuresErrors.join(' | ')}`)
  if (summary.providerPerformanceNotes.length) lines.push(`Provider notes: ${summary.providerPerformanceNotes.join(' | ')}`)
  if (summary.unfinishedTasks.length) lines.push(`Unfinished tasks: ${summary.unfinishedTasks.join(' | ')}`)
  if (summary.nextRecommendedAction) lines.push(`Next recommended action: ${summary.nextRecommendedAction}`)
  return lines.join('\n') || 'No material summary generated for this archive batch.'
}

export function summarizeArchiveBatch(messages: ArchiveTranscriptInput[]): ArchiveBatchSummary {
  const keyDecrees = messages
    .filter(message => message.messageType === 'decree' || message.role === 'user')
    .map(message => cleanPreview(message.content))
    .slice(-5)

  const decisions = messages
    .filter(message => /\b(decided|decision|approved|rejected|will|ship|use|keep|stop)\b/i.test(message.content))
    .map(message => cleanPreview(message.content))
    .slice(-5)

  const opportunitiesCreated = messages
    .filter(message => /\b(opportunity|income|revenue|lead|client|scout)\b/i.test(message.content))
    .map(message => cleanPreview(message.content))
    .slice(-5)

  const failuresErrors = messages
    .filter(message => /\b(error|failed|failure|timeout|timed out|blocked|unavailable)\b/i.test(message.content))
    .map(message => cleanPreview(message.content))
    .slice(-5)

  const providerPerformanceNotes = messages
    .filter(message => (
      /\b(provider|grok|claude|chatgpt|gemini|kimi)\b/i.test(`${message.family ?? ''} ${message.content}`)
      && /\b(timeout|failed|unavailable|responded|partial|complete)\b/i.test(message.content)
    ))
    .map(message => cleanPreview(`${message.family ?? message.role}: ${message.content}`))
    .slice(-5)

  const unfinishedTasks = messages
    .filter(message => /\b(todo|next|unfinished|follow up|pending|waiting|needs?)\b/i.test(message.content))
    .map(message => cleanPreview(message.content))
    .slice(-5)

  return {
    keyDecrees,
    decisions,
    opportunitiesCreated,
    failuresErrors,
    providerPerformanceNotes,
    unfinishedTasks,
    nextRecommendedAction: unfinishedTasks.at(-1) ?? keyDecrees.at(-1) ?? null,
  }
}

export async function archiveTranscriptBatch(
  client: WarRoomSupabase,
  input: {
    sessionId: string | null
    messages: ArchiveTranscriptInput[]
    createSummary?: boolean
  },
): Promise<{
  ok: true
  archived: number
  skipped: number
  compressed: number
  trivial: number
  strategicPromoted: number
  summary?: ArchiveBatchSummary
} | { ok: false; error: string }> {
  const now = new Date().toISOString()
  const curation = curateArchiveMessages(input.messages)
  const rows = curation.curated
    .map(message => ({
      source_message_id: message.id,
      session_id: message.sessionId ?? input.sessionId,
      decree_id: message.decreeId,
      message_timestamp: message.timestamp,
      message_date: archiveDate(message.timestamp),
      role: message.role,
      family: message.family,
      provider: message.provider,
      content: message.content,
      message_type: message.messageType,
      tags: [...new Set([...message.tags, ...message.classification.tags])],
      topic: inferTopic(message),
      source_mode: message.sourceMode,
      archived_at: now,
      archive_date: archiveDate(now),
      operator_id: message.operatorId ?? null,
      operator_name: message.operatorName ?? null,
      visibility: message.visibility ?? 'private',
      importance_tier: message.classification.tier,
      importance_score: message.classification.score,
      decay_weight: message.classification.decayWeight,
      memory_tags: message.classification.tags,
      strategic_pinned: false,
      mission_critical: message.classification.tier === 'critical',
      compressed_count: message.compressedCount,
      compression_key: message.compressionKey,
      metadata: {
        classificationReasons: message.classification.reasons,
        repeated_decree_count: message.messageType === 'decree' && message.compressedCount > 1 ? message.compressedCount : undefined,
      },
    }))

  if (!rows.length) {
    return {
      ok: true,
      archived: 0,
      skipped: curation.skipped,
      compressed: curation.compressed,
      trivial: curation.trivial,
      strategicPromoted: 0,
    }
  }

  const { data: archivedRows, error } = await client
    .from(TABLE_ARCHIVE)
    .upsert(rows, { onConflict: 'session_id,source_message_id' })
    .select('id,session_id,content,topic,importance_tier,importance_score,memory_tags,operator_id,operator_name,visibility,mission_critical,strategic_pinned,metadata')

  if (error) return { ok: false, error: error.message }

  const strategicRows = (archivedRows ?? [])
    .filter(row => {
      const tier = (row as { importance_tier?: string }).importance_tier
      return tier === 'strategic' || tier === 'critical'
    })
    .map(row => {
      const r = row as {
        id: string
        session_id: string | null
        content: string
        topic: string | null
        importance_tier: MemoryImportanceTier
        importance_score: number
        memory_tags: string[] | null
        operator_id: string | null
        operator_name: string | null
        visibility: ArchiveVisibility
        mission_critical: boolean
        strategic_pinned: boolean
        metadata: Record<string, unknown> | null
      }
      return {
        source_archive_id: r.id,
        session_id: r.session_id,
        title: cleanPreview(r.content, 96),
        content: r.content,
        memory_kind: r.topic ?? 'platform_evolution',
        importance_tier: r.importance_tier,
        importance_score: r.importance_score,
        topic: r.topic,
        tags: Array.isArray(r.memory_tags) ? r.memory_tags : [],
        evidence: r.metadata ?? {},
        pinned: r.strategic_pinned,
        mission_critical: r.mission_critical,
        operator_id: r.operator_id,
        operator_name: r.operator_name,
        visibility: r.visibility,
      }
    })

  if (strategicRows.length) {
    const { error: strategicError } = await client
      .from(TABLE_STRATEGIC)
      .upsert(strategicRows, { onConflict: 'source_archive_id' })
    if (strategicError) return { ok: false, error: strategicError.message }
  }

  let summary: ArchiveBatchSummary | undefined
  if (input.createSummary) {
    summary = summarizeArchiveBatch(curation.curated)
    const { error: summaryError } = await client
      .from(TABLE_SUMMARIES)
      .insert({
        session_id: input.sessionId,
        summary_date: archiveDate(now),
        summary_kind: 'archive_batch',
        summary: summaryToText(summary),
        key_decrees: summary.keyDecrees,
        decisions: summary.decisions,
        opportunities_created: summary.opportunitiesCreated,
        failures_errors: summary.failuresErrors,
        provider_performance_notes: summary.providerPerformanceNotes,
        unfinished_tasks: summary.unfinishedTasks,
        next_recommended_action: summary.nextRecommendedAction,
        importance_tier: strategicRows.length ? 'strategic' : 'operational',
        importance_score: strategicRows.length ? 0.7 : 0.5,
        decay_weight: strategicRows.length ? 0.85 : 0.55,
        strategic_pinned: false,
        mission_critical: strategicRows.some(row => row.mission_critical),
        operator_id: null,
        operator_name: null,
        visibility: 'private',
      })
    if (summaryError) return { ok: false, error: summaryError.message }
  }

  return {
    ok: true,
    archived: rows.length,
    skipped: curation.skipped,
    compressed: curation.compressed,
    trivial: curation.trivial,
    strategicPromoted: strategicRows.length,
    summary,
  }
}

export async function recallArchivedTranscripts(
  client: WarRoomSupabase,
  command: ParsedRecallCommand,
  opts?: { sessionId?: string | null; limit?: number; fullContent?: boolean },
): Promise<{ ok: true; records: RecallTranscriptPreview[]; summaries: RecallSummaryPreview[] } | { ok: false; error: string }> {
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20))
  let query = client
    .from(TABLE_ARCHIVE)
    .select('id,message_timestamp,role,family,provider,content,message_type,tags,topic,importance_tier,importance_score,compressed_count')
    .neq('importance_tier', 'trivial')
    .order('importance_score', { ascending: false })
    .order('message_timestamp', { ascending: false })
    .limit(limit)

  if (command.scope === 'today') {
    query = query.eq('message_date', new Date().toISOString().slice(0, 10))
  } else if (command.scope === 'last_session' && opts?.sessionId) {
    query = query.eq('session_id', opts.sessionId)
  }

  if (command.topic) {
    query = query.eq('topic', command.topic)
  }

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }

  let summaryQuery = client
    .from(TABLE_SUMMARIES)
    .select('id,created_at,summary_kind,summary')
    .order('created_at', { ascending: false })
    .limit(command.summarize ? 10 : 3)

  if (command.scope === 'today') {
    summaryQuery = summaryQuery.eq('summary_date', new Date().toISOString().slice(0, 10))
  } else if (command.scope === 'last_session' && opts?.sessionId) {
    summaryQuery = summaryQuery.eq('session_id', opts.sessionId)
  }

  const { data: summariesRaw, error: summaryError } = await summaryQuery
  if (summaryError) return { ok: false, error: summaryError.message }

  const records = (data ?? []).map(row => {
    const r = row as {
      id: string
      message_timestamp: string
      role: string
      family: string | null
      provider: string | null
      content: string
      message_type: string | null
      tags: string[] | null
      topic: string | null
      importance_tier: MemoryImportanceTier | null
      importance_score: number | null
      compressed_count: number | null
    }
    return {
      id: r.id,
      timestamp: r.message_timestamp,
      role: r.role,
      family: r.family,
      provider: r.provider,
      messageType: r.message_type,
      content: opts?.fullContent ? r.content : cleanPreview(r.content, 500),
      tags: Array.isArray(r.tags) ? r.tags : [],
      topic: r.topic,
      importanceTier: r.importance_tier,
      importanceScore: r.importance_score,
      compressedCount: r.compressed_count ?? 1,
    }
  })

  const summaries = (summariesRaw ?? []).map(row => {
    const r = row as {
      id: string
      created_at: string
      summary_kind: string
      summary: string
    }
    return {
      id: r.id,
      createdAt: r.created_at,
      summaryKind: r.summary_kind,
      summary: cleanPreview(r.summary, 900),
    }
  })

  return { ok: true, records, summaries }
}

import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'
import { parseRecallCommand } from '@/lib/memory/recallCommands'
import { archiveTranscriptBatch, recallArchivedTranscripts, type ArchiveTranscriptInput } from '@/lib/memory/transcriptArchive'

export const dynamic = 'force-dynamic'

const TABLE_ARCHIVE = 'war_room_archived_transcripts'

function isVisibility(value: unknown): value is ArchiveTranscriptInput['visibility'] {
  return value === 'private' || value === 'shared' || value === 'household'
}

function coerceTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
    .map(tag => tag.trim().slice(0, 80))
    .slice(0, 12)
}

function coerceArchiveMessage(value: unknown, sessionId: string | null): ArchiveTranscriptInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : ''
  const content = typeof row.content === 'string' ? row.content : ''
  if (!id || !content.trim()) return null

  const rawTimestamp =
    typeof row.timestamp === 'string' && row.timestamp.trim()
      ? row.timestamp.trim()
      : new Date().toISOString()
  const timestampMs = Date.parse(rawTimestamp)
  const timestamp = Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : new Date().toISOString()

  return {
    id,
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : sessionId,
    decreeId: typeof row.decreeId === 'string' ? row.decreeId : null,
    timestamp,
    role: typeof row.role === 'string' ? row.role : 'assistant',
    family: typeof row.family === 'string' ? row.family : null,
    provider: typeof row.provider === 'string' ? row.provider : null,
    content,
    messageType: typeof row.messageType === 'string' ? row.messageType : 'response',
    tags: coerceTags(row.tags),
    topic: typeof row.topic === 'string' ? row.topic : null,
    sourceMode: typeof row.sourceMode === 'string' ? row.sourceMode : 'live_chat_window',
    operatorId: typeof row.operatorId === 'string' ? row.operatorId : null,
    operatorName: typeof row.operatorName === 'string' ? row.operatorName : null,
    visibility: isVisibility(row.visibility) ? row.visibility : 'private',
  }
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ archived: 0, error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: { sessionId?: unknown; messages?: unknown; createSummary?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null
  const messages = Array.isArray(body.messages)
    ? body.messages
        .map(message => coerceArchiveMessage(message, sessionId))
        .filter((message): message is ArchiveTranscriptInput => Boolean(message))
    : []

  if (!messages.length) {
    return jsonWithPersistence({ archived: 0 }, true)
  }

  const result = await archiveTranscriptBatch(sup.client, {
    sessionId,
    messages,
    createSummary: body.createSummary !== false,
  })

  if (!result.ok) {
    const payload = warRoomSupabaseFailurePayload(TABLE_ARCHIVE, { message: result.error }, { operation: 'upsert' })
    return jsonWithPersistence(
      { error: payload.message, supabase: payload },
      true,
      { status: httpStatusForSupabaseFailure(payload, 500) },
    )
  }

  return jsonWithPersistence(result, true)
}

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  const url = new URL(req.url)
  const commandText = url.searchParams.get('command') ?? 'show archive'
  const command = parseRecallCommand(commandText) ?? parseRecallCommand('show archive')!
  const sessionId = url.searchParams.get('sessionId')
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10)

  if (!sup.ok) {
    return jsonWithPersistence({ command, records: [], summaries: [] }, false)
  }

  const result = await recallArchivedTranscripts(sup.client, command, {
    sessionId,
    limit: Number.isFinite(limit) ? limit : 20,
  })

  if (!result.ok) {
    const payload = warRoomSupabaseFailurePayload(TABLE_ARCHIVE, { message: result.error }, { operation: 'select' })
    return jsonWithPersistence(
      { error: payload.message, command, records: [], summaries: [], supabase: payload },
      true,
      { status: httpStatusForSupabaseFailure(payload, 500) },
    )
  }

  return jsonWithPersistence({ command, ...result }, true)
}

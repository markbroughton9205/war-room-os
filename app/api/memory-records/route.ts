import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { writeDirectiveWithSupersession } from '@/lib/memory-records/persist'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

const COLUMNS =
  'id,content,memory_type,scope,project_id,conversation_id,status,effective_from,effective_until,superseded_by,importance_tier,source_type,source_ref,created_by,created_at'

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return NextResponse.json({ memoryRecords: [] })

  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'global_war_room'
  const projectId = url.searchParams.get('projectId')
  const includeSuperseded = url.searchParams.get('includeSuperseded') === '1'

  let query = sup.client.from('war_room_memory_records').select(COLUMNS).eq('scope', scope).order('effective_from', { ascending: false })
  query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null)
  if (!includeSuperseded) query = query.eq('status', 'active')

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message, memoryRecords: [] }, { status: 500 })
  return NextResponse.json({ memoryRecords: data ?? [] })
}

export async function POST(req: Request) {
  const commander = await requireCommanderSession('Memory record write')
  if (!commander.ok) return commander.response

  let body: { content?: string; memoryType?: string; scope?: string; projectId?: string; conversationId?: string; importanceTier?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const result = await writeDirectiveWithSupersession({
    content,
    memoryType: typeof body.memoryType === 'string' ? body.memoryType : 'architecture_decision',
    scope: typeof body.scope === 'string' ? body.scope : 'global_war_room',
    projectId: typeof body.projectId === 'string' ? body.projectId : null,
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
    importanceTier: typeof body.importanceTier === 'string' ? body.importanceTier : undefined,
    sourceType: 'manual_entry',
  })

  if (!result) return NextResponse.json({ error: 'Supabase is not configured or write failed.' }, { status: 503 })
  return NextResponse.json({ memoryRecord: result.created, superseded: result.superseded }, { status: 201 })
}

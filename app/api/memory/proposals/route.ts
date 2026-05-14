import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { redactProposalContent, validateProposal } from '@/lib/memory/proposals'
import { insertMemoryProposal, listPendingMemoryProposals } from '@/lib/memory/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ proposals: [] }, false)
  }
  const r = await listPendingMemoryProposals(sup.client, 200)
  if (!r.ok) {
    return jsonWithPersistence({ error: r.error, proposals: [] }, true, { status: 500 })
  }
  return jsonWithPersistence({ proposals: r.rows }, true)
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

  const v = validateProposal(body)
  if (!v.ok) {
    return jsonWithPersistence({ error: v.error }, true, { status: 400 })
  }

  const content_redacted = redactProposalContent(v.value.content)
  const ins = await insertMemoryProposal(sup.client, {
    family_partition: v.value.family_partition,
    proposed_by: v.value.proposed_by,
    title: v.value.title,
    content_redacted,
    conversation_id: v.value.conversation_id,
    metadata: v.value.metadata,
  })

  if (!ins.ok) {
    return jsonWithPersistence({ error: ins.error }, true, { status: 500 })
  }

  return jsonWithPersistence({ ok: true, id: ins.id }, true, { status: 201 })
}

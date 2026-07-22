import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { emitEvent } from '@/lib/events/bus'
import { validateCouncilRepairPacket } from '@/lib/council-repair'

export const dynamic = 'force-dynamic'

const ACTION_TYPE = 'council_repair_packet'

/**
 * Creates decision context for a repair packet in the Approvals workspace only.
 * Inserts directly at `waiting_approval` (not `requested`) because clicking this action IS the
 * Commander's decision to open Commander review — no automated `requested` → `waiting_approval`
 * promotion exists anywhere in the system, so inserting at `requested` would create an item the
 * Approvals UI can never surface. `approval_granted` stays false; nothing is approved or executed.
 */
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

  const input = body as { packet?: unknown; source?: unknown }
  const validation = validateCouncilRepairPacket(input.packet)
  if (!validation.valid) {
    return jsonWithPersistence(
      { error: 'Packet failed CouncilRepairPacket validation.', validationErrors: validation.errors },
      true,
      { status: 400 },
    )
  }
  const packet = validation.packet
  const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim() : 'unspecified'

  const { data: recent } = await sup.client
    .from('war_room_actions')
    .select('id,status,payload,created_at')
    .eq('type', ACTION_TYPE)
    .order('created_at', { ascending: false })
    .limit(20)

  const duplicate = (recent ?? []).find(row => {
    const payload = row.payload as { packetId?: string } | null
    return payload?.packetId === packet.id && (row.status === 'waiting_approval' || row.status === 'approved')
  })

  if (duplicate) {
    return jsonWithPersistence({
      action: duplicate,
      reused: true,
      message: 'This packet already has an open or approved decision in Approvals.',
    }, true)
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await sup.client
    .from('war_room_actions')
    .insert({
      type: ACTION_TYPE,
      payload: { packetId: packet.id, packet, source, sentAt: nowIso },
      conversation_id: null,
      status: 'waiting_approval',
      approval_granted: false,
    })
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .single()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  await appendWarRoomActionLog(sup.client, data.id, 'Repair packet sent to Approvals.', 'info', {
    packetId: packet.id,
    source,
  })

  await emitEvent({
    supabase: sup.client,
    type: 'action.approval_required',
    source: 'user',
    correlationId: data.id,
    payload: {
      actionId: data.id,
      packetId: packet.id,
      summary: `Repair packet "${packet.title}" is awaiting Commander approval.`,
      severity: packet.severity,
    },
  })

  return jsonWithPersistence({ action: data, reused: false }, true, { status: 201 })
}

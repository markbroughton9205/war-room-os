import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import {
  httpStatusForSupabaseFailure,
  warRoomSupabaseFailurePayload,
} from '@/lib/war-room/warRoomSupabaseError'

export const dynamic = 'force-dynamic'

const TABLE_CONTEXT_SNAPSHOTS = 'war_room_context_snapshots'
const COLUMNS =
  'id,conversation_id,project_id,assembled_at,model_target,token_estimate,content_hash,ranking_version,included_source_ids,excluded_source_ids,budget_breakdown'

/** Read-only inspection endpoint — no mutation. Lets the Commander (or a validation script) see
 * exactly what a given turn's Context Assembler pass included/excluded and why. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return jsonWithPersistence({ contextSnapshot: null }, false)

  const { id } = await context.params
  const { data, error } = await sup.client.from(TABLE_CONTEXT_SNAPSHOTS).select(COLUMNS).eq('id', id).maybeSingle()
  if (error) {
    const supabase = warRoomSupabaseFailurePayload(TABLE_CONTEXT_SNAPSHOTS, error, { operation: 'select' })
    return jsonWithPersistence({ error: supabase.message, supabase }, true, { status: httpStatusForSupabaseFailure(supabase, 500) })
  }
  if (!data) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ contextSnapshot: data }, true)
}

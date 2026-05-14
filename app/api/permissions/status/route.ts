import { allRegisteredActionKinds, getEffectivePolicy } from '@/lib/permissions/policy'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { fetchWarRoomPermissionsState } from '@/lib/war-room/permissionsState'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sup = tryWarRoomSupabase()
  const state = await fetchWarRoomPermissionsState(sup.ok ? sup.client : null)

  const kinds = allRegisteredActionKinds()
  const autoAllowedCatalog = kinds.filter(k => getEffectivePolicy(state.mode, k).autoAllowed)
  const requiresApprovalCatalog = kinds.filter(k => getEffectivePolicy(state.mode, k).requiresApproval)

  return jsonWithPersistence(
    {
      mode: state.mode,
      safetyLock: state.safetyLock,
      autoAllowedCatalog,
      requiresApprovalCatalog,
      lastAutoAction: state.lastAutoAction,
    },
    sup.ok,
  )
}

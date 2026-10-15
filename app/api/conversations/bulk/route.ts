import { jsonWithPersistence } from '@/lib/war-room/persistence'
import { localCommanderOwnerId, localConversationsBulk } from '@/lib/war-room/localConversationGateway'

export const dynamic = 'force-dynamic'

/** Bulk session operations (trash / restore / archive / rename / purge / cleanup-empty) for the local Commander. */
export async function POST(req: Request) {
  const ownerId = await localCommanderOwnerId(req)
  if (!ownerId) return jsonWithPersistence({ error: 'Local Commander session required.' }, true, { status: 401 })
  return localConversationsBulk(req, ownerId)
}

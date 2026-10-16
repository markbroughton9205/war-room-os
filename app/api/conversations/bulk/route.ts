import { jsonWithPersistence } from '@/lib/war-room/persistence'
import { localCommanderOwnerId, localConversationsBulk } from '@/lib/war-room/localConversationGateway'

export const dynamic = 'force-dynamic'

/** Bulk session operations (trash / restore / archive / rename / purge / cleanup-empty) for the local Commander. */
export async function POST(req: Request) {
  // A custom header cannot be sent cross-site without a CORS preflight (which this app never grants), so a foreign page cannot drive bulk operations.
  if (req.headers.get('x-wr-conversations-bulk') !== '1') return jsonWithPersistence({ error: 'Missing control header.' }, true, { status: 403 })
  const ownerId = await localCommanderOwnerId(req)
  if (!ownerId) return jsonWithPersistence({ error: 'Local Commander session required.' }, true, { status: 401 })
  return localConversationsBulk(req, ownerId)
}

/**
 * Home Council conversations on the existing local-ownership store.
 * Used when the request is a local Commander and Supabase is not the caller.
 * Does not create a second conversation database.
 */
import { jsonWithPersistence } from '@/lib/war-room/persistence'
import { assertLocalOnlyRequest } from '@/lib/sovereign-runtime/local-ownership/gate'
import { extractBearerOrCookieToken, LOCAL_SESSION_COOKIE } from '@/lib/sovereign-runtime/local-ownership/edgeSession'
import { DESKTOP_TRUST_HEADER } from '@/lib/sovereign-runtime/local-ownership/desktopTrustShared'
import { verifyDesktopTrustProof } from '@/lib/sovereign-runtime/local-ownership/desktopTrust'
import { getLocalOwnershipStore } from '@/lib/sovereign-runtime/local-ownership/store'
import { persistenceAllowsDurableCouncil, collectPersistenceHealth } from '@/lib/war-room/persistenceHealth'

function dataDir(): string | null {
  return process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null
}

export async function localCommanderOwnerId(req: Request): Promise<string | null> {
  const host = req.headers.get('host')
  const gate = assertLocalOnlyRequest({ host, origin: req.headers.get('origin') })
  if (!gate.ok) return null
  const store = getLocalOwnershipStore(dataDir())
  const token = extractBearerOrCookieToken({
    authorization: req.headers.get('authorization'),
    cookieHeader: req.headers.get('cookie'),
    cookieName: LOCAL_SESSION_COOKIE,
  })
  const auth = store.verifySessionToken(token)
  if (auth?.identity.id) return auth.identity.id
  const proof = verifyDesktopTrustProof({
    presentedHeader: req.headers.get(DESKTOP_TRUST_HEADER),
    dataDirOverride: dataDir(),
  })
  if (!proof.ok) return null
  return store.getCommanderPublic()?.id ?? null
}

function toPublicConversation(row: {
  id: string
  title: string
  metadata: Record<string, unknown>
  state: string
  created_at: string
  updated_at: string
  last_message_at: string | null
}) {
  return {
    id: row.id,
    title: row.title,
    metadata: row.metadata,
    state: row.state,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_at: row.last_message_at,
    deleted_at: null,
  }
}

export async function localConversationsGet(req: Request, ownerId: string) {
  const health = await collectPersistenceHealth()
  const available = persistenceAllowsDurableCouncil(health)
  if (!available) return jsonWithPersistence({ conversations: [], persistence: health }, false, { status: 503 })
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
  const includeArchived = url.searchParams.get('includeArchived') === '1' || url.searchParams.get('archived') === '1'
  const store = getLocalOwnershipStore(dataDir())
  let rows = store.listCouncilConversations(ownerId)
  if (!includeArchived) rows = rows.filter(row => row.state !== 'archived')
  if (q) rows = rows.filter(row => row.title.toLowerCase().includes(q))
  return jsonWithPersistence({ conversations: rows.map(toPublicConversation), backend: 'local_ownership' }, true)
}

export async function localConversationsPost(req: Request, ownerId: string) {
  const health = await collectPersistenceHealth()
  if (!persistenceAllowsDurableCouncil(health)) {
    return jsonWithPersistence({ error: 'Local persistence is not writable.', persistence: health }, false, { status: 503 })
  }
  let body: { title?: string; metadata?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Council Session'
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : { council: { source: 'live_council' } }
  const store = getLocalOwnershipStore(dataDir())
  const created = store.createCouncilConversation(ownerId, title, metadata)
  return jsonWithPersistence({ conversation: toPublicConversation(created), backend: 'local_ownership' }, true, { status: 201 })
}

export async function localConversationGet(ownerId: string, id: string) {
  const health = await collectPersistenceHealth()
  if (!persistenceAllowsDurableCouncil(health)) {
    return jsonWithPersistence({ conversation: null, messages: [], persistence: health }, false, { status: 503 })
  }
  const store = getLocalOwnershipStore(dataDir())
  const conversation = store.getCouncilConversation(ownerId, id)
  if (!conversation) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  const messages = store.listCouncilMessages(ownerId, id) ?? []
  return jsonWithPersistence({
    conversation: toPublicConversation(conversation),
    messages,
    backend: 'local_ownership',
  }, true)
}

export async function localConversationPatch(req: Request, ownerId: string, id: string) {
  const health = await collectPersistenceHealth()
  if (!persistenceAllowsDurableCouncil(health)) {
    return jsonWithPersistence({ error: 'Local persistence is not writable.', persistence: health }, false, { status: 503 })
  }
  let body: { title?: string; state?: string; metadata?: Record<string, unknown>; mergeMetadata?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }
  const store = getLocalOwnershipStore(dataDir())
  const existing = store.getCouncilConversation(ownerId, id)
  if (!existing) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  let metadata = existing.metadata
  if (body.metadata && typeof body.metadata === 'object') {
    if (body.mergeMetadata) {
      const prevCouncil = metadata.council && typeof metadata.council === 'object' && !Array.isArray(metadata.council)
        ? metadata.council as Record<string, unknown>
        : {}
      const incomingCouncil = body.metadata.council
      const { council: _drop, ...rest } = body.metadata
      void _drop
      metadata = { ...metadata, ...rest }
      if (incomingCouncil && typeof incomingCouncil === 'object' && !Array.isArray(incomingCouncil)) {
        metadata = { ...metadata, council: { ...prevCouncil, ...incomingCouncil as Record<string, unknown> } }
      }
    } else {
      metadata = body.metadata
    }
  }
  const updated = store.patchCouncilConversation(ownerId, id, {
    title: body.title,
    state: body.state,
    metadata,
  })
  if (!updated) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  return jsonWithPersistence({ conversation: toPublicConversation(updated), backend: 'local_ownership' }, true)
}

export async function localConversationDelete(ownerId: string, id: string) {
  const store = getLocalOwnershipStore(dataDir())
  const existing = store.getCouncilConversation(ownerId, id)
  if (!existing) return jsonWithPersistence({ error: 'Not found' }, true, { status: 404 })
  store.patchCouncilConversation(ownerId, id, { state: 'archived' })
  return jsonWithPersistence({ ok: true, id, deleted_at: new Date().toISOString(), backend: 'local_ownership' }, true)
}

export async function localConversationMessagePost(req: Request, ownerId: string, conversationId: string) {
  const health = await collectPersistenceHealth()
  if (!persistenceAllowsDurableCouncil(health)) {
    return jsonWithPersistence({ error: 'Local persistence is not writable.', persistence: health }, false, { status: 503 })
  }
  let body: { role?: string; content?: string; family?: string | null; metadata?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }
  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) return jsonWithPersistence({ error: 'content is required' }, true, { status: 400 })
  const role = typeof body.role === 'string' ? body.role : 'user'
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
  const store = getLocalOwnershipStore(dataDir())
  const idempotencyKey = typeof metadata.idempotencyKey === 'string' ? metadata.idempotencyKey : null
  if (idempotencyKey) {
    const existing = store.findCouncilMessageByIdempotency(ownerId, conversationId, idempotencyKey)
    if (existing) return jsonWithPersistence({ message: existing, backend: 'local_ownership' }, true, { status: 200 })
  }
  const message = store.addCouncilMessage(ownerId, conversationId, {
    role,
    content,
    family: typeof body.family === 'string' ? body.family : null,
    metadata,
  })
  if (!message) return jsonWithPersistence({ error: 'Conversation not found' }, true, { status: 404 })
  return jsonWithPersistence({ message, backend: 'local_ownership' }, true, { status: 201 })
}

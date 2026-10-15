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
  const view = url.searchParams.get('view') ?? 'active'
  const includeArchived = url.searchParams.get('includeArchived') === '1' || url.searchParams.get('archived') === '1'
  const store = getLocalOwnershipStore(dataDir())
  let rows: ReturnType<typeof store.listCouncilConversations>
  if (view === 'trash') rows = store.listCouncilConversationsByState(ownerId, ['trashed'])
  else if (view === 'archived') rows = store.listCouncilConversationsByState(ownerId, ['archived'])
  else {
    rows = store.listCouncilConversations(ownerId).filter(row => row.state !== 'trashed')
    if (!includeArchived) rows = rows.filter(row => row.state !== 'archived')
  }
  if (q) {
    rows = rows.filter(row => {
      const council = row.metadata.council && typeof row.metadata.council === 'object' ? row.metadata.council as Record<string, unknown> : {}
      const preview = typeof council.lastPreview === 'string' ? council.lastPreview.toLowerCase() : ''
      return row.title.toLowerCase().includes(q) || preview.includes(q)
    })
  }
  const counts = {
    active: store.listCouncilConversations(ownerId).filter(row => row.state !== 'trashed' && row.state !== 'archived').length,
    trashed: store.listCouncilConversationsByState(ownerId, ['trashed']).length,
    archived: store.listCouncilConversationsByState(ownerId, ['archived']).length,
    emptyUnused: store.findUnusedEmptyCouncilConversations(ownerId).length,
  }
  return jsonWithPersistence({ conversations: rows.map(toPublicConversation), counts, view, backend: 'local_ownership' }, true)
}

export async function localConversationsPost(req: Request, ownerId: string) {
  const health = await collectPersistenceHealth()
  if (!persistenceAllowsDurableCouncil(health)) {
    return jsonWithPersistence({ error: 'Local persistence is not writable.', persistence: health }, false, { status: 503 })
  }
  let body: { title?: string; metadata?: Record<string, unknown>; forceNew?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Council Session'
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : { council: { source: 'live_council' } }
  const store = getLocalOwnershipStore(dataDir())
  // Never accumulate unused empty sessions: if one already exists, hand that one back instead of creating another.
  if (!body.forceNew && title === 'New Council Session') {
    const existingEmpty = store.findUnusedEmptyCouncilConversations(ownerId)
    if (existingEmpty.length > 0) {
      const reuse = store.getCouncilConversation(ownerId, existingEmpty[0])
      if (reuse) {
        return jsonWithPersistence({ conversation: toPublicConversation(reuse), reused: true, backend: 'local_ownership' }, true, { status: 200 })
      }
    }
  }
  const created = store.createCouncilConversation(ownerId, title, metadata)
  return jsonWithPersistence({ conversation: toPublicConversation(created), backend: 'local_ownership' }, true, { status: 201 })
}

export type BulkConversationAction = 'trash' | 'restore' | 'archive' | 'unarchive' | 'rename' | 'purge' | 'cleanup-empty'

/**
 * Bulk Council session operations for the sidebar. Owner scoped; nothing here is ever applied to ids the owner does not hold.
 * Permanent deletion only touches conversations that are already in Trash and requires an explicit confirmation token.
 */
export async function localConversationsBulk(req: Request, ownerId: string) {
  const health = await collectPersistenceHealth()
  if (!persistenceAllowsDurableCouncil(health)) {
    return jsonWithPersistence({ error: 'Local persistence is not writable.', persistence: health }, false, { status: 503 })
  }
  let body: { action?: string; ids?: unknown; mode?: string; text?: string; confirm?: string; dryRun?: boolean; excludeIds?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }
  const action = body.action as BulkConversationAction
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, 500) : []
  const store = getLocalOwnershipStore(dataDir())
  const exclude = Array.isArray(body.excludeIds) ? (body.excludeIds as unknown[]).filter((x): x is string => typeof x === 'string') : []

  if (action === 'cleanup-empty') {
    const candidates = store.findUnusedEmptyCouncilConversations(ownerId, { excludeIds: exclude })
    if (body.dryRun) return jsonWithPersistence({ action, dryRun: true, candidates, count: candidates.length }, true)
    const res = store.trashCouncilConversations(ownerId, candidates)
    return jsonWithPersistence({ action, ...res, count: res.trashed.length, note: 'moved to Trash; recoverable' }, true)
  }
  if (!ids.length) return jsonWithPersistence({ error: 'ids is required' }, true, { status: 400 })

  if (action === 'trash') {
    const res = store.trashCouncilConversations(ownerId, ids)
    return jsonWithPersistence({ action, ...res }, true)
  }
  if (action === 'restore' || action === 'unarchive') {
    const res = store.restoreCouncilConversations(ownerId, ids)
    return jsonWithPersistence({ action, ...res }, true)
  }
  if (action === 'archive') {
    const done: string[] = []
    const skipped: string[] = []
    for (const id of ids) {
      const existing = store.getCouncilConversation(ownerId, id)
      if (!existing || existing.state === 'trashed') { skipped.push(id); continue }
      store.patchCouncilConversation(ownerId, id, { state: 'archived' })
      done.push(id)
    }
    return jsonWithPersistence({ action, archived: done, skipped }, true)
  }
  if (action === 'rename') {
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 120) : ''
    if (!text) return jsonWithPersistence({ error: 'text is required' }, true, { status: 400 })
    const mode = body.mode === 'prefix' || body.mode === 'suffix' ? body.mode : 'set'
    const renamed: Array<{ id: string; title: string }> = []
    const skipped: string[] = []
    let n = 0
    for (const id of ids) {
      const existing = store.getCouncilConversation(ownerId, id)
      if (!existing || existing.state === 'trashed') { skipped.push(id); continue }
      n += 1
      const next = mode === 'prefix' ? `${text} ${existing.title}`
        : mode === 'suffix' ? `${existing.title} ${text}`
        : ids.length > 1 ? `${text} (${n})` : text
      const updated = store.patchCouncilConversation(ownerId, id, { title: next.slice(0, 200) })
      renamed.push({ id, title: updated?.title ?? next.slice(0, 200) })
    }
    return jsonWithPersistence({ action, renamed, skipped }, true)
  }
  if (action === 'purge') {
    if (body.confirm !== 'DELETE_PERMANENTLY') {
      return jsonWithPersistence({ error: 'Permanent deletion requires confirm: "DELETE_PERMANENTLY".', code: 'CONFIRMATION_REQUIRED' }, true, { status: 400 })
    }
    const res = store.purgeCouncilConversations(ownerId, ids)
    return jsonWithPersistence({ action, ...res }, true)
  }
  return jsonWithPersistence({ error: `Unknown action ${String(body.action)}` }, true, { status: 400 })
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
      const { council: _drop, councilStage1: _s1, ...rest } = body.metadata
      void _drop
      void _s1
      metadata = { ...metadata, ...rest }
      if (incomingCouncil && typeof incomingCouncil === 'object' && !Array.isArray(incomingCouncil)) {
        metadata = { ...metadata, council: { ...prevCouncil, ...incomingCouncil as Record<string, unknown> } }
      }
    } else {
      // councilStage1 is server-owned provenance: never accept it from a client, always carry over.
      const { councilStage1: _s1, ...incoming } = body.metadata
      void _s1
      const keep = existing.metadata.councilStage1
      metadata = keep !== undefined ? { ...incoming, councilStage1: keep } : incoming
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
  // "Delete" from the sidebar moves the session to Trash; it stays recoverable until the Commander empties Trash.
  store.trashCouncilConversations(ownerId, [id])
  return jsonWithPersistence({ ok: true, id, trashed: true, deleted_at: new Date().toISOString(), backend: 'local_ownership' }, true)
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

/**
 * #22 Phase 11C — Local Core HTTP handlers for offline Commander identity + ownership.
 */
import type http from 'node:http'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
  getLocalOwnershipRuntimeTruth,
  runLocalOwnedChat,
  type LocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'

function json(res: http.ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string | string[]>) {
  const payload = JSON.stringify(body)
  const headers: Record<string, string | string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(extraHeaders || {}),
  }
  // Preserve any Set-Cookie already queued via setHeader before writeHead
  const existing = res.getHeader('set-cookie')
  if (existing && !headers['set-cookie']) {
    headers['set-cookie'] = existing as string | string[]
  }
  res.writeHead(status, headers)
  res.end(payload)
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new Error('Invalid JSON body.')
  }
}

function hostOf(req: http.IncomingMessage): string | null {
  return typeof req.headers.host === 'string' ? req.headers.host : null
}

function requireLocalGate(req: http.IncomingMessage, res: http.ServerResponse, mutating: boolean): boolean {
  const host = hostOf(req)
  const only = assertLocalOnlyRequest({ host, origin: typeof req.headers.origin === 'string' ? req.headers.origin : null })
  if (!only.ok) {
    json(res, 403, { ok: false, error: only.reason, code: only.code })
    return false
  }
  if (mutating) {
    const origin = assertLocalMutationOrigin({
      method: req.method || 'GET',
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
      referer: typeof req.headers.referer === 'string' ? req.headers.referer : null,
      host,
    })
    if (!origin.ok) {
      json(res, 403, { ok: false, error: origin.reason, code: origin.code })
      return false
    }
  }
  return true
}

function authFromRequest(req: http.IncomingMessage, store: LocalOwnershipStore) {
  const token = extractBearerOrCookieToken({
    authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
    cookieHeader: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
    cookieName: LOCAL_SESSION_COOKIE,
  })
  return store.verifySessionToken(token)
}

function setSessionCookie(res: http.ServerResponse, token: string) {
  // HttpOnly cookie for loopback; Secure omitted (http://127.0.0.1)
  res.setHeader(
    'set-cookie',
    `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}`,
  )
}

function clearSessionCookie(res: http.ServerResponse) {
  res.setHeader('set-cookie', `${LOCAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export function tryHandleLocalOwnershipHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (!url.pathname.startsWith('/api/local/ownership') && !url.pathname.startsWith('/api/local/auth')) {
    return false
  }

  const mutating = !['GET', 'HEAD'].includes((req.method || 'GET').toUpperCase())
  if (!requireLocalGate(req, res, mutating)) return true

  const store = getLocalOwnershipStore(opts?.dataDirOverride)

  void (async () => {
    try {
      // --- Auth / identity ---
      if (url.pathname === '/api/local/auth/status' && req.method === 'GET') {
        const auth = authFromRequest(req, store)
        return json(res, 200, {
          ok: true,
          bootstrapped: store.hasLocalCommander(),
          authenticated: Boolean(auth),
          identity: auth?.identity ?? store.getCommanderPublic(),
          session: auth
            ? {
                session_id: auth.session.session_id,
                expires_at: auth.session.expires_at,
                owner_local_identity_id: auth.session.owner_local_identity_id,
              }
            : null,
          ownership_truth: getLocalOwnershipRuntimeTruth(),
          data_mode: store.getDataMode(false),
          recovery: 'NOT_IMPLEMENTED',
          remote: 'REMOTE_UNAVAILABLE',
        })
      }

      if (url.pathname === '/api/local/auth/bootstrap' && req.method === 'POST') {
        if (store.hasLocalCommander()) {
          return json(res, 409, { ok: false, error: 'Already bootstrapped.', code: 'ALREADY_EXISTS' })
        }
        const body = await readJson(req)
        const result = store.bootstrapCommander({
          password: typeof body.password === 'string' ? body.password : '',
          displayName: typeof body.display_name === 'string' ? body.display_name : undefined,
        })
        if (!result.ok) return json(res, 400, result)
        const auth = store.login(typeof body.password === 'string' ? body.password : '')
        if (!auth.ok) return json(res, 500, { ok: false, error: 'Bootstrap succeeded but login failed.' })
        setSessionCookie(res, auth.auth.token)
        return json(res, 200, {
          ok: true,
          identity: auth.auth.identity,
          session_id: auth.auth.session.session_id,
          // token also in cookie; returned once for native clients
          session_token: auth.auth.token,
        })
      }

      if (url.pathname === '/api/local/auth/login' && req.method === 'POST') {
        const body = await readJson(req)
        const result = store.login(typeof body.password === 'string' ? body.password : '')
        if (!result.ok) return json(res, result.code === 'THROTTLED' ? 429 : 401, result)
        setSessionCookie(res, result.auth.token)
        return json(res, 200, {
          ok: true,
          identity: result.auth.identity,
          session_id: result.auth.session.session_id,
          session_token: result.auth.token,
        })
      }

      if (url.pathname === '/api/local/auth/logout' && req.method === 'POST') {
        const token = extractBearerOrCookieToken({
          authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
          cookieHeader: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
          cookieName: LOCAL_SESSION_COOKIE,
        })
        store.logout(token)
        clearSessionCookie(res)
        return json(res, 200, { ok: true })
      }

      if (url.pathname === '/api/local/auth/link' && req.method === 'POST') {
        const auth = authFromRequest(req, store)
        if (!auth) return json(res, 401, { ok: false, error: 'Local Commander session required.' })
        const body = await readJson(req)
        const result = store.linkRemoteIdentity({
          localOwnerId: auth.identity.id,
          remoteSupabaseUserId: typeof body.remote_supabase_user_id === 'string' ? body.remote_supabase_user_id : '',
          remoteSessionAuthenticated: body.remote_session_authenticated === true,
          localSessionAuthenticated: true,
        })
        if (!result.ok) return json(res, 400, result)
        return json(res, 200, result)
      }

      if (url.pathname === '/api/local/auth/auto-link-email' && req.method === 'POST') {
        const body = await readJson(req)
        const result = store.attemptAutoLinkByEmail(typeof body.email === 'string' ? body.email : '')
        return json(res, 403, result)
      }

      // --- Ownership data (session required) ---
      const auth = authFromRequest(req, store)
      if (!auth && url.pathname.startsWith('/api/local/ownership')) {
        return json(res, 401, { ok: false, error: 'Local Commander session required.' })
      }

      if (url.pathname === '/api/local/ownership/conversations' && req.method === 'GET') {
        return json(res, 200, { ok: true, conversations: store.listConversations(auth!.identity.id) })
      }

      if (url.pathname === '/api/local/ownership/conversations' && req.method === 'POST') {
        const body = await readJson(req)
        // Ignore client-supplied owner fields
        const conv = store.createConversation(
          auth!.identity.id,
          typeof body.title === 'string' ? body.title : undefined,
        )
        return json(res, 200, { ok: true, conversation: conv })
      }

      const convMatch = url.pathname.match(/^\/api\/local\/ownership\/conversations\/([^/]+)$/)
      if (convMatch && req.method === 'GET') {
        const conv = store.getConversation(auth!.identity.id, decodeURIComponent(convMatch[1]!))
        if (!conv) return json(res, 404, { ok: false, error: 'Not found.' })
        const messages = store.listMessages(auth!.identity.id, conv.id)
        return json(res, 200, { ok: true, conversation: conv, messages })
      }

      if (convMatch && req.method === 'PATCH') {
        const body = await readJson(req)
        const conv = store.renameConversation(
          auth!.identity.id,
          decodeURIComponent(convMatch[1]!),
          typeof body.title === 'string' ? body.title : '',
        )
        if (!conv) return json(res, 404, { ok: false, error: 'Not found.' })
        return json(res, 200, { ok: true, conversation: conv })
      }

      const chatMatch = url.pathname.match(/^\/api\/local\/ownership\/conversations\/([^/]+)\/chat$/)
      if (chatMatch && req.method === 'POST') {
        const body = await readJson(req)
        const result = await runLocalOwnedChat({
          store,
          ownerLocalIdentityId: auth!.identity.id,
          conversationId: decodeURIComponent(chatMatch[1]!),
          prompt: typeof body.prompt === 'string' ? body.prompt : '',
        })
        if (!result.ok) return json(res, 422, result)
        return json(res, 200, result)
      }

      if (url.pathname === '/api/local/ownership/export' && req.method === 'POST') {
        const exported = store.exportOwnedData(auth!.identity.id)
        if (!exported.ok) return json(res, 403, exported)
        return json(res, 200, exported)
      }

      return json(res, 404, { ok: false, error: 'Unknown local ownership route.' })
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })()

  return true
}

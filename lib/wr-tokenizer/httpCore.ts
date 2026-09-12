/**
 * Local Core loopback WR-TOKENIZER status. No Train button. No training routes.
 */
import type http from 'node:http'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import { wrTokenizerStatusPayload } from './status'
import { tryForbiddenWrTokenizerAction, type ForbiddenWrTokenizerAction } from './redTeam'

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-war-room-local-core': '1',
  })
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

export function tryHandleWrTokenizerHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (!url.pathname.startsWith('/api/local/wr-tokenizer')) return false
  void (async () => {
    const host = typeof req.headers.host === 'string' ? req.headers.host : null
    const only = assertLocalOnlyRequest({
      host,
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
    })
    if (!only.ok) {
      json(res, 403, { ok: false, error: only.reason, code: only.code })
      return
    }
    const dataDir = opts?.dataDirOverride ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null
    const store = getLocalOwnershipStore(dataDir)
    const token = extractBearerOrCookieToken({
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
      cookieHeader: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
      cookieName: LOCAL_SESSION_COOKIE,
    })
    void token
    void store
    try {
      if (url.pathname === '/api/local/wr-tokenizer/status' && (req.method || 'GET') === 'GET') {
        json(res, 200, wrTokenizerStatusPayload(dataDir))
        return
      }
      if (url.pathname === '/api/local/wr-tokenizer/train') {
        json(res, 403, tryForbiddenWrTokenizerAction('RETRAIN_TOKENIZER_NOW'))
        return
      }
      if ((req.method || 'GET') !== 'POST') {
        json(res, 405, { ok: false, error: 'POST required.' })
        return
      }
      const originOk = assertLocalMutationOrigin({
        method: req.method || 'POST',
        origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
        referer: typeof req.headers.referer === 'string' ? req.headers.referer : null,
        host,
      })
      if (!originOk.ok) {
        json(res, 403, { ok: false, error: originOk.reason, code: originOk.code })
        return
      }
      const body = await readJson(req)
      if (url.pathname === '/api/local/wr-tokenizer/red-team') {
        json(res, 200, tryForbiddenWrTokenizerAction(String(body.action ?? 'RETRAIN_TOKENIZER_NOW') as ForbiddenWrTokenizerAction))
        return
      }
      json(res, 404, { ok: false, error: 'Unknown WR-TOKENIZER route. No training endpoint exists.' })
    } catch (error) {
      const err = error as WrCorpusPolicyError
      json(res, 400, { ok: false, error: err.message, code: err.code ?? 'WR_TOKENIZER_ERROR' })
    }
  })()
  return true
}

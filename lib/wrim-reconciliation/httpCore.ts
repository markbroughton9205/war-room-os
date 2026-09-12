/**
 * Local Core loopback WRIM reconciliation status. No Train button. No training routes.
 */
import type http from 'node:http'
import { WrCorpusPolicyError } from '@/lib/wr-corpus/hashes'
import {
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
} from '@/lib/sovereign-runtime/local-ownership'
import { wrimReconciliationStatusPayload } from './status'
import { tryForbiddenWrimAction, type ForbiddenWrimAction } from './redTeam'

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

export function tryHandleWrimReconciliationHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (!url.pathname.startsWith('/api/local/wrim-reconciliation')) return false
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
    try {
      if (url.pathname === '/api/local/wrim-reconciliation/status' && (req.method || 'GET') === 'GET') {
        json(res, 200, wrimReconciliationStatusPayload(dataDir))
        return
      }
      if (url.pathname === '/api/local/wrim-reconciliation/train') {
        json(res, 403, tryForbiddenWrimAction('RESUME_TRAINING_IMMEDIATELY'))
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
      if (url.pathname === '/api/local/wrim-reconciliation/red-team') {
        json(res, 200, tryForbiddenWrimAction(String(body.action ?? 'RESUME_TRAINING_IMMEDIATELY') as ForbiddenWrimAction))
        return
      }
      json(res, 404, { ok: false, error: 'Unknown WRIM reconciliation route. No training endpoint exists.' })
    } catch (error) {
      const err = error as WrCorpusPolicyError
      json(res, 400, { ok: false, error: err.message, code: err.code ?? 'WRIM_RECONCILIATION_ERROR' })
    }
  })()
  return true
}

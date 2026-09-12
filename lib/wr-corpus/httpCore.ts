/**
 * Local Core loopback WR-CORPUS API. Renderer gets no extra privilege.
 */
import type http from 'node:http'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { migrateExistingWrCorpus } from './migrate'
import { listWrCorpusVersions, queryWrCorpus, listCandidateReviewQueue } from './query'
import { ragFromWrCorpus } from './rag'
import { promoteApprovedCandidate } from './promote'
import { deleteActiveWrCorpusRecord } from './delete'
import { exportWrCorpusMetadata } from './export'
import { tryForbiddenWrCorpusAction, type ForbiddenWrCorpusAction } from './redTeam'
import { WR_CORPUS_STATUS, ROADMAP_23_STATUS, wrCorpusTruthNotes } from './identity'
import { WrCorpusPolicyError } from './hashes'

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

export function tryHandleWrCorpusHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (!url.pathname.startsWith('/api/local/wr-corpus')) return false
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
    const auth = token ? store.verifySessionToken(token) : null
    const ownerUserId = auth?.identity?.id ?? 'local-commander'

    try {
      if (url.pathname === '/api/local/wr-corpus/status' && (req.method || 'GET') === 'GET') {
    const listed = listWrCorpusVersions(dataDir)
    json(res, 200, {
      ok: true,
      wr_corpus: WR_CORPUS_STATUS,
      roadmap_23: ROADMAP_23_STATUS,
      notes: wrCorpusTruthNotes(),
      candidate_review_queue: listCandidateReviewQueue(ownerUserId, dataDir),
      ...listed,
    })
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
      if (url.pathname === '/api/local/wr-corpus/migrate') {
        json(res, 200, { ok: true, result: await migrateExistingWrCorpus({ dataDirOverride: dataDir }) })
        return
      }
      if (url.pathname === '/api/local/wr-corpus/query') {
        json(
          res,
          200,
          queryWrCorpus({
            query: String(body.query ?? ''),
            ownerUserId,
            corpusVersion: typeof body.corpusVersion === 'string' ? body.corpusVersion : undefined,
            dataDirOverride: dataDir,
          }),
        )
        return
      }
      if (url.pathname === '/api/local/wr-corpus/rag') {
        json(res, 200, await ragFromWrCorpus({ query: String(body.query ?? ''), ownerUserId, dataDirOverride: dataDir }))
        return
      }
      if (url.pathname === '/api/local/wr-corpus/promote') {
        json(
          res,
          200,
          await promoteApprovedCandidate({
            candidateId: String(body.candidateId ?? ''),
            ownerUserId,
            commanderApproval: true,
            dataDirOverride: dataDir,
          }),
        )
        return
      }
      if (url.pathname === '/api/local/wr-corpus/delete') {
        json(
          res,
          200,
          deleteActiveWrCorpusRecord({
            recordId: String(body.recordId ?? ''),
            ownerUserId,
            policy: body.policy === 'DELETE_AND_BLOCK_RELEARN' ? 'DELETE_AND_BLOCK_RELEARN' : 'DELETE_AND_ALLOW_RELEARN',
            dataDirOverride: dataDir,
          }),
        )
        return
      }
      if (url.pathname === '/api/local/wr-corpus/export') {
        json(res, 200, exportWrCorpusMetadata({ ownerUserId, dataDirOverride: dataDir }))
        return
      }
      if (url.pathname === '/api/local/wr-corpus/red-team') {
        json(res, 200, tryForbiddenWrCorpusAction(String(body.action ?? 'START_SECOND_ARCHITECTURE') as ForbiddenWrCorpusAction))
        return
      }
      json(res, 404, { ok: false, error: 'Unknown WR-CORPUS route.' })
    } catch (error) {
      const err = error as WrCorpusPolicyError
      json(res, 400, { ok: false, error: err.message, code: err.code ?? 'WR_CORPUS_ERROR' })
    }
  })()
  return true
}

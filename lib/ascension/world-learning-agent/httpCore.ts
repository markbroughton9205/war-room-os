/**
 * #22 Phase 13 — Local Core loopback invocation of WORLD_LEARNING_AGENT.
 * Renderer gets no Search/Research privilege. Engine stays in Core/Node.
 */
import type http from 'node:http'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { isWorldLearningAgentRuntimeAvailable } from '@/lib/ascension/world-learning-agent/identity'
import { runBoundedWorldLearningAgent } from '@/lib/ascension/world-learning-agent/runtime'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'

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

export function tryHandleWorldLearningAgentHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (url.pathname !== '/api/local/ascension/world-learning-agent/run') return false

  void (async () => {
    const host = typeof req.headers.host === 'string' ? req.headers.host : null
    const only = assertLocalOnlyRequest({
      host,
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
    })
    if (!only.ok) {
      json(res, 403, { ok: false, error: only.reason, code: only.code, status: 'DENIED' })
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
    if (!isWorldLearningAgentRuntimeAvailable()) {
      json(res, 403, { ok: false, error: 'WORLD_LEARNING_AGENT runtime disabled.', status: 'DENIED' })
      return
    }

    const store = getLocalOwnershipStore(opts?.dataDirOverride ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
    const token = extractBearerOrCookieToken({
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
      cookieHeader: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
      cookieName: LOCAL_SESSION_COOKIE,
    })
    const auth = store.verifySessionToken(token)
    if (!auth) {
      json(res, 401, { ok: false, error: 'Local Commander session required.', status: 'DENIED' })
      return
    }

    let body: Record<string, unknown> = {}
    try {
      body = await readJson(req)
    } catch (err) {
      json(res, 400, { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON body.' })
      return
    }

    const result = await runBoundedWorldLearningAgent({
      taskType: typeof body.task_type === 'string' ? body.task_type : 'LEARN_TOPIC',
      topic: typeof body.topic === 'string' ? body.topic : undefined,
      question: typeof body.question === 'string' ? body.question : undefined,
      domain: typeof body.domain === 'string' ? body.domain : null,
      ownerUserId: auth.identity.id,
      requestedBy: auth.identity.id,
      invokedBy: 'desktop_core',
      useFixtures: body.use_fixture !== false,
      internetAvailable: body.internet_available !== false,
      liveSearchAllowed: body.live_search_allowed === true,
      invokeResearchAgent: body.invoke_research_agent === true,
      useLocalModel: body.use_local_model === true,
      attemptedAction: typeof body.attempted_action === 'string' ? body.attempted_action : null,
    })

    json(res, result.status === 'DENIED' ? 403 : 200, {
      ok: result.status !== 'DENIED' && result.status !== 'FAILED' && result.status !== 'INTERNAL_ERROR',
      result,
      runtime_truth: {
        agent: 'WORLD_LEARNING_AGENT',
        implemented: true,
        operational: isWorldLearningAgentRuntimeAvailable(),
        operational_ascension_agents: operationalAscensionAgentCount(),
        corpus_handoff: 'IMPLEMENTED',
        autonomous_corpus_persistence: false,
        model_training: 'NOT_IMPLEMENTED',
        wr_corpus: 'NOT_STARTED',
        wrim: 'NOT_IMPLEMENTED',
        rael: 'NOT_IMPLEMENTED',
        renderer_search_privilege: false,
      },
    })
  })()

  return true
}

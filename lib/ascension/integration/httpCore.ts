/**
 * #22 Phase 14 — Local Core loopback invocation of bounded cross-agent workflows.
 * Not a second orchestrator. Renderer gets no agent privilege.
 */
import type http from 'node:http'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { operationalAscensionAgentCount } from '@/lib/ascension/operationalRegistry'
import { INTEGRATION_WORKFLOW_KINDS, type IntegrationWorkflowKind } from './types'
import { runIntegrationWorkflow } from './workflows'
import { runAstraBoundedMultiAgentOrchestration } from './astraBridge'
import { CROSS_AGENT_INTEGRATION_STATUS } from './identity'

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

function isWorkflowKind(value: unknown): value is IntegrationWorkflowKind {
  return typeof value === 'string' && (INTEGRATION_WORKFLOW_KINDS as readonly string[]).includes(value)
}

export function tryHandleCrossAgentIntegrationHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (url.pathname !== '/api/local/ascension/integration/run') return false

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

    const kind = isWorkflowKind(body.workflow_kind) ? body.workflow_kind : 'KNOWLEDGE_PIPELINE'
    const input = {
      ownerUserId: auth.identity.id,
      requestedBy: auth.identity.id,
      invokedBy: 'desktop_core' as const,
      dataDirOverride: opts?.dataDirOverride ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null,
      internetAvailable: body.internet_available !== false,
      liveSearchAllowed: body.live_search_allowed === true,
      useFixtures: body.use_fixture !== false,
      useLocalModel: body.use_local_model === true,
    }

    if (kind === 'ASTRA_MULTI_AGENT_MISSION') {
      const result = await runAstraBoundedMultiAgentOrchestration(input)
      json(res, 200, {
        ok: result.mission?.status === 'completed',
        result,
        runtime_truth: {
          cross_agent_integration: CROSS_AGENT_INTEGRATION_STATUS,
          operational_ascension_agents: operationalAscensionAgentCount(),
          astra_phase58a: 'NOT_APPLIED',
        },
      })
      return
    }

    const result = await runIntegrationWorkflow(kind, input)
    json(res, result.status === 'DENIED' ? 403 : 200, {
      ok: result.status !== 'DENIED' && result.status !== 'FAILED',
      result,
      runtime_truth: {
        cross_agent_integration: CROSS_AGENT_INTEGRATION_STATUS,
        operational_ascension_agents: operationalAscensionAgentCount(),
        astra_phase58a: 'NOT_APPLIED',
        production_corpus_persistence: false,
      },
    })
  })()

  return true
}

/**
 * #22 Phase 12 — Local Core loopback invocation of NAVIGATION_AGENT.
 * Renderer gets no routing privilege. Engine stays in Core/Node.
 */
import type http from 'node:http'
import {
  LOCAL_SESSION_COOKIE,
  assertLocalMutationOrigin,
  assertLocalOnlyRequest,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from '@/lib/sovereign-runtime/local-ownership'
import { isNavigationAgentRuntimeAvailable } from '@/lib/ascension/navigation-agent/identity'
import { runBoundedNavigationAgent } from '@/lib/ascension/navigation-agent/runtime'
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

export function tryHandleNavigationAgentHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  opts?: { dataDirOverride?: string | null },
): boolean {
  if (url.pathname !== '/api/local/ascension/navigation-agent/run') return false

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
    if (!isNavigationAgentRuntimeAvailable()) {
      json(res, 403, { ok: false, error: 'NAVIGATION_AGENT runtime disabled.', status: 'DENIED' })
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

    const latlng = (value: unknown): { latitude: number; longitude: number } | null => {
      if (!value || typeof value !== 'object') return null
      const rec = value as Record<string, unknown>
      if (typeof rec.latitude !== 'number' || typeof rec.longitude !== 'number') return null
      return { latitude: rec.latitude, longitude: rec.longitude }
    }

    const result = await runBoundedNavigationAgent({
      taskType: typeof body.task_type === 'string' ? body.task_type : 'PLAN_ROUTE',
      ownerUserId: auth.identity.id,
      requestedBy: auth.identity.id,
      invokedBy: 'desktop_core',
      origin: latlng(body.origin),
      destination: latlng(body.destination),
      currentLocation: latlng(body.current_location),
      locationSource:
        body.location_source === 'session_supplied' ||
        body.location_source === 'fixture' ||
        body.location_source === 'terra' ||
        body.location_source === 'explicit_input'
          ? body.location_source
          : 'explicit_input',
      useFixtureGraph: body.use_fixture !== false,
      internetAvailable: body.internet_available !== false,
      claimLiveDeviceGps: body.claim_live_device_gps === true,
      requestReroute: body.request_reroute === true,
      autoExecuteReroute: body.auto_execute_reroute === true,
      attemptedAction: typeof body.attempted_action === 'string' ? body.attempted_action : null,
    })

    json(res, result.status === 'DENIED' ? 403 : 200, {
      ok: result.status !== 'DENIED' && result.status !== 'FAILED' && result.status !== 'INTERNAL_ERROR',
      result,
      runtime_truth: {
        agent: 'NAVIGATION_AGENT',
        implemented: true,
        operational: isNavigationAgentRuntimeAvailable(),
        operational_ascension_agents: operationalAscensionAgentCount(),
        live_traffic: 'NOT_IMPLEMENTED',
        mobile_gnss: 'NOT_SUPPORTED',
        renderer_routing_privilege: false,
      },
    })
  })()

  return true
}

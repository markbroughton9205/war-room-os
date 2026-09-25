/**
 * Bounded public-research HTTP transport for Foundry Application Builder.
 * One shared keep-alive pool for the long-lived runtime. Mission-owned AbortControllers
 * abort in-flight requests on cancel/terminal without destroying the shared pool.
 * Loopback preview verification stays on agent:false elsewhere — this module is public research only.
 */
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

export const FOUNDRY_RESEARCH_MAX_SOCKETS = 8
export const FOUNDRY_RESEARCH_MAX_FREE_SOCKETS = 4
export const FOUNDRY_RESEARCH_KEEPALIVE_MS = 4_000
export const FOUNDRY_RESEARCH_REQUEST_TIMEOUT_MS = 15_000

type MissionTransportState = {
  controller: AbortController
  refs: number
  inFlight: number
}

let httpsAgent: https.Agent | null = null
let httpAgent: http.Agent | null = null
let agentGeneration = 0
const missions = new Map<string, MissionTransportState>()

function createAgents(): void {
  httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: FOUNDRY_RESEARCH_KEEPALIVE_MS,
    maxSockets: FOUNDRY_RESEARCH_MAX_SOCKETS,
    maxFreeSockets: FOUNDRY_RESEARCH_MAX_FREE_SOCKETS,
    timeout: FOUNDRY_RESEARCH_REQUEST_TIMEOUT_MS,
    scheduling: 'lifo',
  })
  httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: FOUNDRY_RESEARCH_KEEPALIVE_MS,
    maxSockets: FOUNDRY_RESEARCH_MAX_SOCKETS,
    maxFreeSockets: FOUNDRY_RESEARCH_MAX_FREE_SOCKETS,
    timeout: FOUNDRY_RESEARCH_REQUEST_TIMEOUT_MS,
    scheduling: 'lifo',
  })
  agentGeneration += 1
}

function ensureAgents(): { httpsAgent: https.Agent; httpAgent: http.Agent } {
  if (!httpsAgent || !httpAgent) createAgents()
  return { httpsAgent: httpsAgent!, httpAgent: httpAgent! }
}

function socketCount(agent: http.Agent | https.Agent | null): { live: number; free: number } {
  if (!agent) return { live: 0, free: 0 }
  const live = Object.values(agent.sockets).reduce((n, sockets) => n + (sockets?.length ?? 0), 0)
  const free = Object.values(agent.freeSockets).reduce((n, sockets) => n + (sockets?.length ?? 0), 0)
  return { live, free }
}

export function getFoundryResearchTransportDiagnostics(): {
  agentGeneration: number
  activeMissions: number
  inFlight: number
  maxSockets: number
  keepAliveMs: number
  httpsLive: number
  httpsFree: number
  httpLive: number
  httpFree: number
  totalSockets: number
} {
  const httpsSockets = socketCount(httpsAgent)
  const httpSockets = socketCount(httpAgent)
  let inFlight = 0
  for (const mission of missions.values()) inFlight += mission.inFlight
  return {
    agentGeneration,
    activeMissions: missions.size,
    inFlight,
    maxSockets: FOUNDRY_RESEARCH_MAX_SOCKETS,
    keepAliveMs: FOUNDRY_RESEARCH_KEEPALIVE_MS,
    httpsLive: httpsSockets.live,
    httpsFree: httpsSockets.free,
    httpLive: httpSockets.live,
    httpFree: httpSockets.free,
    totalSockets: httpsSockets.live + httpsSockets.free + httpSockets.live + httpSockets.free,
  }
}

export function beginFoundryResearchMission(missionId: string): void {
  if (!missionId) return
  const existing = missions.get(missionId)
  if (existing) {
    existing.refs += 1
    return
  }
  missions.set(missionId, { controller: new AbortController(), refs: 1, inFlight: 0 })
}

export function abortFoundryResearchMission(missionId: string): { aborted: boolean; inFlight: number } {
  const mission = missions.get(missionId)
  if (!mission) return { aborted: false, inFlight: 0 }
  if (!mission.controller.signal.aborted) mission.controller.abort()
  return { aborted: true, inFlight: mission.inFlight }
}

export function releaseFoundryResearchMission(missionId: string, input?: { terminal?: boolean }): {
  released: boolean
  remainingMissions: number
} {
  const mission = missions.get(missionId)
  if (!mission) return { released: true, remainingMissions: missions.size }
  if (input?.terminal) {
    if (mission.inFlight > 0 && !mission.controller.signal.aborted) mission.controller.abort()
    missions.delete(missionId)
    return { released: true, remainingMissions: missions.size }
  }
  mission.refs = Math.max(0, mission.refs - 1)
  if (mission.refs === 0 && mission.inFlight === 0) missions.delete(missionId)
  return { released: true, remainingMissions: missions.size }
}

export async function closeFoundryResearchTransport(input?: { ifIdle?: boolean }): Promise<{
  closed: boolean
  reason: string
}> {
  if (input?.ifIdle) {
    const diag = getFoundryResearchTransportDiagnostics()
    if (diag.activeMissions > 0 || diag.inFlight > 0) {
      return { closed: false, reason: 'active research missions still hold the shared pool' }
    }
  }
  httpsAgent?.destroy()
  httpAgent?.destroy()
  httpsAgent = null
  httpAgent = null
  return { closed: true, reason: 'shared research agents destroyed' }
}

export function researchAbortSignal(missionId?: string): AbortSignal | undefined {
  if (!missionId) return undefined
  return missions.get(missionId)?.controller.signal
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((item): item is AbortSignal => Boolean(item))
  if (!live.length) return undefined
  if (live.length === 1) return live[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live)
  const controller = new AbortController()
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}

function headerRecord(headers?: HeadersInit): http.OutgoingHttpHeaders {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

export async function foundryResearchFetch(
  input: string | URL,
  init: RequestInit = {},
  ctx?: { missionId?: string; timeoutMs?: number; redirects?: number },
): Promise<Response> {
  const url = typeof input === 'string' ? new URL(input) : input
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('FOUNDRY_RESEARCH_TRANSPORT: only http/https are supported.')
  }
  const { httpsAgent: tlsAgent, httpAgent: plainAgent } = ensureAgents()
  const agent = url.protocol === 'https:' ? tlsAgent : plainAgent
  const method = (init.method ?? 'GET').toUpperCase()
  const timeoutMs = ctx?.timeoutMs ?? FOUNDRY_RESEARCH_REQUEST_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = combineSignals([init.signal ?? undefined, researchAbortSignal(ctx?.missionId), timeout])
  const mission = ctx?.missionId ? missions.get(ctx.missionId) : undefined
  const redirects = ctx?.redirects ?? 0
  if (mission && redirects === 0) mission.inFlight += 1

  const body = init.body == null ? undefined : typeof init.body === 'string' || Buffer.isBuffer(init.body)
    ? init.body
    : undefined

  try {
    const response = await new Promise<Response>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: headerRecord(init.headers),
        agent,
        timeout: timeoutMs,
      }, res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          const headers = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (value == null) continue
            headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers,
          }))
        })
      })
      const abort = () => {
        req.destroy()
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      }
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
      })
      if (body != null) req.write(body)
      req.end()
    })
    const location = response.headers.get('location')
    if (
      location
      && redirects < 5
      && (init.redirect === 'follow' || init.redirect == null)
      && response.status >= 301
      && response.status <= 308
    ) {
      return foundryResearchFetch(new URL(location, url), {
        ...init,
        method: response.status === 303 ? 'GET' : method,
        body: response.status === 303 ? undefined : init.body,
      }, { ...ctx, redirects: redirects + 1 })
    }
    return response
  } finally {
    if (mission && redirects === 0) {
      mission.inFlight = Math.max(0, mission.inFlight - 1)
      if (mission.refs === 0 && mission.inFlight === 0) missions.delete(ctx!.missionId!)
    }
  }
}

export function foundryResearchFetchForMission(missionId: string): typeof fetch {
  const bound = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input : input.url
    return foundryResearchFetch(url, init, { missionId })
  }
  return bound as typeof fetch
}

export function sameFoundryResearchAgents(): boolean {
  const first = ensureAgents()
  const second = ensureAgents()
  return first.httpsAgent === second.httpsAgent && first.httpAgent === second.httpAgent
}

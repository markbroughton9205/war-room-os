/**
 * #22 Phase 10 — Loopback-only War Room Local Core HTTP server.
 * Bind: 127.0.0.1:3847 — never 0.0.0.0 in foundation mode.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONNECTIVITY_PRIORITY,
  LOCAL_CORE_HOST,
  LOCAL_CORE_PORT,
  COMMANDER_CONTROL_SURFACE_SLOTS,
  type CoreBootState,
  type LocalHealthContract,
} from './constants'
import { classifyPortConflict, createBootTracker, desktopShutdownPlan } from './boot'
import {
  buildIdentity,
  buildOfflineCapabilityReport,
  getSovereignRuntimeTruth,
} from './runtimeTruth'
import { isLoopbackRequestHost, mintLocalDesktopSession, assertServiceRoleIsNotCommander } from './session'
import { WEBSITE_DEPENDENCE_INVENTORY } from './dependenceInventory'
import { decideDesktopNavigation, defaultDesktopStartUrl } from './desktopSecurity'
import { discoverLocalModels, runLocalModelInference } from './local-model'
import { tryHandleLocalOwnershipHttp } from './local-ownership/httpCore'
import { tryHandleNavigationAgentHttp } from '@/lib/ascension/navigation-agent/httpCore'
import {
  LOCAL_SESSION_COOKIE,
  extractBearerOrCookieToken,
  getLocalOwnershipStore,
} from './local-ownership'

export type LocalCoreServerOptions = {
  host?: string
  port?: number
  rendererDir?: string
  gitSha?: string | null
  /** Isolated AppData override for tests (WAR_ROOM_LOCAL_DATA_DIR). */
  localDataDir?: string | null
  simulate?: {
    internet?: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
    publicWebsiteReachable?: boolean
    cloudflareReachable?: boolean
    ollamaReachable?: boolean | null
    supabaseReachable?: boolean | null
  }
}

export type LocalCoreHandle = {
  server: http.Server
  host: string
  port: number
  boot: ReturnType<typeof createBootTracker>
  close: () => Promise<void>
  shutdownPlan: ReturnType<typeof desktopShutdownPlan>
}

function resolveDefaultRendererDir(): string {
  // Packaged CJS uses __dirname; ESM/dev uses import.meta.url when available.
  const here =
    typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath((import.meta as { url?: string }).url || 'file:///'))
  return path.resolve(here, '..', '..', 'desktop', 'renderer')
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-war-room-local-core': '1',
  })
  res.end(payload)
}

function denyNonLoopback(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const host = req.headers.host ?? null
  // Also check socket remote address
  const ra = req.socket.remoteAddress
  const remoteOk =
    !ra ||
    ra === '127.0.0.1' ||
    ra === '::1' ||
    ra === '::ffff:127.0.0.1'
  if (!remoteOk || !isLoopbackRequestHost(host)) {
    json(res, 403, {
      ok: false,
      error: 'Local core accepts loopback clients only.',
      bind: 'loopback_only',
    })
    return true
  }
  return false
}

export function buildLocalHealth(boot: CoreBootState, opts: LocalCoreServerOptions): LocalHealthContract {
  const sim = opts.simulate ?? {}
  const offline = buildOfflineCapabilityReport({
    internet: sim.internet,
    publicWebsiteReachable: sim.publicWebsiteReachable,
    cloudflareReachable: sim.cloudflareReachable,
    ollamaReachable: sim.ollamaReachable ?? null,
    coreOnline: boot === 'CORE_READY' || boot === 'CORE_RUNNING' || boot === 'CORE_DEGRADED',
    coreDegraded: boot === 'CORE_DEGRADED',
  })
  const status =
    boot === 'CORE_FAILED' || boot === 'CORE_PORT_CONFLICT'
      ? 'failed'
      : boot === 'CORE_DEGRADED'
        ? 'degraded'
        : 'ok'
  return {
    surface: 'LOCAL_CORE',
    status,
    boot_state: boot,
    host: LOCAL_CORE_HOST,
    port: LOCAL_CORE_PORT,
    bind: 'loopback_only',
    identity: buildIdentity({ git_sha: opts.gitSha ?? null }),
    offline,
    connectivity_priority: CONNECTIVITY_PRIORITY,
    website_fallback: 'DENIED',
    notes: [
      'WEBSITE != WAR ROOM',
      'Cloudflare = OPTIONAL_REMOTE_CONNECTIVITY',
      'No silent fallback to warroomos.com',
      'GATE16_PREBUILD = PASS 14/14 (commander-identity gate still first in prebuild chain)',
    ],
  }
}

export async function startLocalCoreServer(opts: LocalCoreServerOptions = {}): Promise<LocalCoreHandle> {
  const host = opts.host ?? LOCAL_CORE_HOST
  const port = opts.port ?? LOCAL_CORE_PORT
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('Local core foundation refuses non-loopback bind.')
  }
  const boot = createBootTracker()
  boot.set('CORE_STARTING')
  const rendererDir = opts.rendererDir ?? resolveDefaultRendererDir()

  const server = http.createServer((req, res) => {
    if (denyNonLoopback(req, res)) return
    const url = new URL(req.url || '/', `http://${LOCAL_CORE_HOST}:${port}`)

    if (
      tryHandleLocalOwnershipHttp(req, res, url, {
        dataDirOverride: opts.localDataDir ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null,
      })
    ) {
      return
    }

    if (
      tryHandleNavigationAgentHttp(req, res, url, {
        dataDirOverride: opts.localDataDir ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null,
      })
    ) {
      return
    }

    if (url.pathname === '/api/local/health') {
      return json(res, 200, { ok: true, health: buildLocalHealth(boot.snapshot(), opts) })
    }
    if (url.pathname === '/api/local/status') {
      return void (async () => {
        const models = await discoverLocalModels().catch(err => ({
          error: err instanceof Error ? err.message : String(err),
        }))
        json(res, 200, {
          ok: true,
          runtime_truth: getSovereignRuntimeTruth(),
          health: buildLocalHealth(boot.snapshot(), opts),
          session: mintLocalDesktopSession(),
          service_role_probe: assertServiceRoleIsNotCommander(),
          dependence_inventory_count: WEBSITE_DEPENDENCE_INVENTORY.length,
          commander_control_surface_slots: COMMANDER_CONTROL_SURFACE_SLOTS,
          default_start_url: defaultDesktopStartUrl(),
          navigation_sample: decideDesktopNavigation('https://warroomos.com/'),
          local_models: models,
        })
      })()
    }
    if (url.pathname === '/api/local/capabilities') {
      return json(res, 200, {
        ok: true,
        offline: buildLocalHealth(boot.snapshot(), opts).offline,
        runtime_truth: getSovereignRuntimeTruth(),
      })
    }
    if (url.pathname === '/api/local/shutdown-plan') {
      return json(res, 200, { ok: true, plan: desktopShutdownPlan(true) })
    }
    if (url.pathname === '/api/local/models/status' && req.method === 'GET') {
      return void (async () => {
        try {
          const discovery = await discoverLocalModels()
          json(res, 200, { ok: true, ...discovery })
        } catch (err) {
          json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })()
    }
    if (url.pathname === '/api/local/models/infer' && req.method === 'POST') {
      return void (async () => {
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          let body: Record<string, unknown> = {}
          if (chunks.length) {
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
            } catch {
              json(res, 400, { ok: false, error: 'Invalid JSON body.' })
              return
            }
          }
          const store = getLocalOwnershipStore(opts.localDataDir ?? process.env.WAR_ROOM_LOCAL_DATA_DIR ?? null)
          const token = extractBearerOrCookieToken({
            authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
            cookieHeader: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
            cookieName: LOCAL_SESSION_COOKIE,
          })
          const auth = store.verifySessionToken(token)
          const wantsOwnerContext =
            Boolean(body.conversation_id) ||
            Boolean(body.owner_user_id) ||
            Boolean(body.resource_owner_user_id)
          if (wantsOwnerContext && !auth) {
            json(res, 401, { ok: false, error: 'Local Commander session required for owned inference context.' })
            return
          }
          // Session owner is authoritative — client cannot forge owner IDs.
          const ownerId = auth?.identity.id ?? null
          const result = await runLocalModelInference({
            prompt: typeof body.prompt === 'string' ? body.prompt : '',
            system: typeof body.system === 'string' ? body.system : undefined,
            model: typeof body.model === 'string' ? body.model : null,
            ownerUserId: ownerId,
            resourceOwnerUserId: ownerId,
            conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : null,
            attemptToolAuthorization: body.attempt_tool_authorization === true,
            attemptDeployAuthorization: body.attempt_deploy_authorization === true,
            attemptPushAuthorization: body.attempt_push_authorization === true,
            attemptFinanceAuthorization: body.attempt_finance_authorization === true,
            attemptAgentSpawn: body.attempt_agent_spawn === true,
            attemptApproveGovernance: body.attempt_approve_governance === true,
            claimIsWrim: body.claim_is_wrim === true,
            claimIsRael: body.claim_is_rael === true,
          })
          json(res, result.ok ? 200 : 422, { ok: result.ok, result })
        } catch (err) {
          json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      })()
    }

    // Static local UI assets
    const rel = url.pathname === '/' ? '/index.html' : url.pathname
    if (rel.includes('..')) {
      json(res, 400, { ok: false, error: 'Path traversal denied.' })
      return
    }
    const filePath = path.join(rendererDir, rel.replace(/^\//, ''))
    if (!filePath.startsWith(rendererDir)) {
      json(res, 400, { ok: false, error: 'Path escape denied.' })
      return
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // Diagnostic page rather than blank / remote fallback
      res.writeHead(boot.snapshot() === 'CORE_FAILED' ? 503 : 404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><body style="font-family:system-ui;background:#0b0f14;color:#e8eef7;padding:2rem">
        <h1>War Room Local Core</h1>
        <p>Asset not found: ${rel}</p>
        <p>Boot: ${boot.snapshot()}</p>
        <p>Website fallback: DENIED</p>
      </body></html>`)
      return
    }
    const ext = path.extname(filePath)
    const type =
      ext === '.html' ? 'text/html; charset=utf-8' :
      ext === '.js' ? 'text/javascript; charset=utf-8' :
      ext === '.css' ? 'text/css; charset=utf-8' :
      'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
    fs.createReadStream(filePath).pipe(res)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', err => {
      const classified = classifyPortConflict(err as NodeJS.ErrnoException)
      boot.set('CORE_PORT_CONFLICT')
      reject(new Error(classified.ok ? String(err) : classified.reason))
    })
    server.listen(port, host, () => {
      boot.set('CORE_READY')
      resolve()
    })
  })

  return {
    server,
    host,
    port,
    boot,
    shutdownPlan: desktopShutdownPlan(true),
    close: () =>
      new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()))
      }),
  }
}

/** Failure simulations — configuration only; does not touch real DNS/tunnel/production. */
export function simulateDomainUnavailable(opts: LocalCoreServerOptions = {}): LocalCoreServerOptions {
  return {
    ...opts,
    simulate: {
      ...(opts.simulate ?? {}),
      publicWebsiteReachable: false,
      internet: opts.simulate?.internet ?? 'ONLINE',
    },
  }
}

export function simulateTunnelUnavailable(opts: LocalCoreServerOptions = {}): LocalCoreServerOptions {
  return {
    ...opts,
    simulate: {
      ...(opts.simulate ?? {}),
      cloudflareReachable: false,
    },
  }
}

export function simulateInternetUnavailable(opts: LocalCoreServerOptions = {}): LocalCoreServerOptions {
  return {
    ...opts,
    simulate: {
      ...(opts.simulate ?? {}),
      internet: 'OFFLINE',
      publicWebsiteReachable: false,
      cloudflareReachable: false,
      ollamaReachable: opts.simulate?.ollamaReachable ?? true,
    },
  }
}

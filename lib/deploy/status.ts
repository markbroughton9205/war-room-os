import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  DeploymentBlocker,
  DeploymentProvider,
  DeployStatusResponse,
  DevServerHint,
  ProductionConfig,
  SupabaseDeployReadiness,
} from './types'

const LOCAL_PROBE_MS = 2500
const PRODUCTION_PROBE_MS = 5000

function trimEnv(name: string): string {
  return typeof process.env[name] === 'string' ? process.env[name]!.trim() : ''
}

/** Best-effort commit hint from CI / Vercel / Pages env (no fabricated value). */
export function resolveGitCommitShortFromEnv(): string | null {
  const raw = trimEnv('VERCEL_GIT_COMMIT_SHA') || trimEnv('GITHUB_SHA') || trimEnv('CF_PAGES_COMMIT_SHA')
  if (!raw) return null
  return raw.length >= 7 ? raw.slice(0, 7) : raw
}

function withHttps(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `https://${url}`
}

/**
 * Public URL candidates (no values logged). Order: site URL, Vercel preview host, Netlify URLs.
 */
export function resolveProductionCandidateUrl(): { url: string | null; sources: string[] } {
  const sources: string[] = []
  const site = trimEnv('NEXT_PUBLIC_SITE_URL')
  if (site) {
    sources.push('NEXT_PUBLIC_SITE_URL')
    return { url: withHttps(site), sources }
  }
  const vercelUrl = trimEnv('VERCEL_URL')
  if (vercelUrl) {
    sources.push('VERCEL_URL')
    return { url: withHttps(vercelUrl), sources }
  }
  const prime = trimEnv('DEPLOY_PRIME_URL')
  if (prime) {
    sources.push('DEPLOY_PRIME_URL')
    return { url: withHttps(prime), sources }
  }
  const netlifyUrl = trimEnv('URL')
  if (netlifyUrl) {
    sources.push('URL')
    return { url: withHttps(netlifyUrl), sources }
  }
  return { url: null, sources: [] }
}

export function detectDeploymentProvider(): DeploymentProvider {
  if (trimEnv('VERCEL')) return 'vercel'
  if (trimEnv('NETLIFY') === 'true' || trimEnv('NETLIFY') === '1') return 'netlify'
  return 'unknown'
}

export function resolveLastDeploymentLabel(): string | null {
  const depId = trimEnv('VERCEL_DEPLOYMENT_ID')
  if (depId) return `vercel:${depId}`
  const runId = trimEnv('GITHUB_RUN_ID')
  const sha = trimEnv('GITHUB_SHA')
  if (runId && sha) return `github_actions:run:${runId}:sha:${sha.slice(0, 7)}`
  if (runId) return `github_actions:run:${runId}`
  if (sha) return `github_actions:sha:${sha.slice(0, 7)}`
  return null
}

async function probeLocalhost3000(): Promise<Pick<DevServerHint, 'devServerReachable' | 'localDevProbe' | 'localDevProbeDetail'>> {
  const url = 'http://127.0.0.1:3000'
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(LOCAL_PROBE_MS),
      cache: 'no-store',
    })
    const ok = res.ok
    return {
      devServerReachable: ok,
      localDevProbe: ok ? 'reachable' : 'unreachable',
      localDevProbeDetail: ok ? 'GET / responded OK.' : `GET / returned HTTP ${res.status}.`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'probe failed'
    return {
      devServerReachable: false,
      localDevProbe: 'error',
      localDevProbeDetail: msg,
    }
  }
}

async function probeProductionUrl(url: string): Promise<Pick<ProductionConfig, 'productionReachable' | 'productionProbeDetail'>> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(PRODUCTION_PROBE_MS),
      cache: 'no-store',
    })
    if (res.ok) {
      return { productionReachable: 'reachable', productionProbeDetail: 'HEAD request succeeded.' }
    }
    return {
      productionReachable: 'unreachable',
      productionProbeDetail: `HEAD returned HTTP ${res.status}.`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'probe failed'
    return { productionReachable: 'error', productionProbeDetail: msg }
  }
}

function buildSupabaseReadiness(): SupabaseDeployReadiness {
  const urlPresent = Boolean(trimEnv('NEXT_PUBLIC_SUPABASE_URL'))
  const anonKeyPresent = Boolean(trimEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
  const serviceRolePresent = Boolean(trimEnv('SUPABASE_SERVICE_ROLE_KEY'))
  const serverPersistenceReady = urlPresent && serviceRolePresent
  const clientBundleReady = urlPresent && anonKeyPresent
  return {
    urlPresent,
    anonKeyPresent,
    serviceRolePresent,
    serverPersistenceReady,
    clientBundleReady,
    status: serverPersistenceReady ? 'configured' : 'config_needed',
  }
}

function collectBlockers(supabase: SupabaseDeployReadiness): DeploymentBlocker[] {
  const blockers: DeploymentBlocker[] = []
  if (!supabase.serviceRolePresent) {
    blockers.push({
      id: 'supabase_service_role',
      message: 'SUPABASE_SERVICE_ROLE_KEY is missing — server persistence and elevated Supabase routes are unavailable.',
      severity: 'blocking',
    })
  }
  if (!supabase.urlPresent) {
    blockers.push({
      id: 'supabase_url',
      message: 'NEXT_PUBLIC_SUPABASE_URL is missing — Supabase client cannot target a project.',
      severity: 'blocking',
    })
  }
  if (supabase.urlPresent && !supabase.anonKeyPresent) {
    blockers.push({
      id: 'supabase_anon',
      message: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing — browser-side Supabase is not configured.',
      severity: 'warning',
    })
  }
  return blockers
}

async function readHasBuildScript(): Promise<boolean> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    return typeof pkg.scripts?.build === 'string' && pkg.scripts.build.length > 0
  } catch {
    return false
  }
}

export async function collectDeployStatus(): Promise<DeployStatusResponse> {
  const checkedAt = new Date().toISOString()
  const provider = detectDeploymentProvider()
  const lastDeployment = resolveLastDeploymentLabel()
  const { url: candidateUrl, sources: urlSources } = resolveProductionCandidateUrl()

  const nodeEnv = process.env.NODE_ENV ?? 'unknown'
  let localDevProbe: DevServerHint['localDevProbe'] = 'disabled'
  let localDevProbeDetail: string | undefined
  let devServerReachable: boolean | undefined
  if (trimEnv('DEPLOY_STATUS_PROBE_LOCALHOST') === '1') {
    const p = await probeLocalhost3000()
    localDevProbe = p.localDevProbe
    localDevProbeDetail = p.localDevProbeDetail
    devServerReachable = p.devServerReachable
  } else {
    localDevProbeDetail = 'Set DEPLOY_STATUS_PROBE_LOCALHOST=1 to allow a short GET to http://127.0.0.1:3000.'
  }

  const localDev: DevServerHint = {
    inferFrom: 'NODE_ENV',
    nodeEnv,
    localDevProcessRunning: 'unknown',
    devServerReachable,
    localDevProbe,
    localDevProbeDetail,
  }

  let production: ProductionConfig = {
    candidateUrl,
    urlSources,
    productionReachable: 'not_probed',
  }
  const siteForProbe = trimEnv('NEXT_PUBLIC_SITE_URL')
  const allowProdProbe = trimEnv('DEPLOY_STATUS_PROBE_PRODUCTION') === '1'
  if (!siteForProbe) {
    production = {
      ...production,
      productionReachable: 'not_probed',
      productionProbeDetail: 'Production URL probe requires NEXT_PUBLIC_SITE_URL (strict) and DEPLOY_STATUS_PROBE_PRODUCTION=1.',
    }
  } else if (!allowProdProbe) {
    production = {
      ...production,
      productionReachable: 'not_probed',
      productionProbeDetail: 'Set DEPLOY_STATUS_PROBE_PRODUCTION=1 to probe NEXT_PUBLIC_SITE_URL (HEAD, short timeout).',
    }
  } else {
    const probeUrlResolved = withHttps(siteForProbe)
    const pr = await probeProductionUrl(probeUrlResolved)
    production = {
      ...production,
      productionReachable: pr.productionReachable,
      productionProbeDetail: pr.productionProbeDetail,
    }
  }

  const supabase = buildSupabaseReadiness()
  const blockers = collectBlockers(supabase)
  const hasBuildScript = await readHasBuildScript()

  const offlineHint =
    localDevProbe !== 'disabled' && devServerReachable === false
      ? 'War Room dev server is offline. Start with start-war-room.bat.'
      : undefined

  return {
    awarenessOnly: true,
    checkedAt,
    provider,
    lastDeployment,
    gitCommitShort: resolveGitCommitShortFromEnv(),
    localDev,
    ...(offlineHint ? { offlineHint } : {}),
    production,
    supabase,
    build: { hasBuildScript },
    blockers,
  }
}

/**
 * @deprecated Prefer `collectDeployStatus()` — kept for internal workers that only need a coarse snapshot.
 */
export async function getDeploymentStatus() {
  const s = await collectDeployStatus()
  return {
    checkedAt: s.checkedAt,
    awarenessOnly: s.awarenessOnly,
    supabase: { status: s.supabase.status },
    provider: s.provider,
    productionUrl: s.production.candidateUrl,
  }
}

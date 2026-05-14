export type DeploymentProvider = 'vercel' | 'netlify' | 'unknown'

/**
 * Honest local development hints. We cannot see whether `next dev` is running
 * from another terminal without an explicit localhost probe (opt-in).
 */
export type DevServerHint = {
  inferFrom: 'NODE_ENV'
  nodeEnv: string
  /** No side channel to the dev parent process */
  localDevProcessRunning: 'unknown'
  /** Present only when `DEPLOY_STATUS_PROBE_LOCALHOST=1` ran */
  devServerReachable?: boolean
  localDevProbe: 'disabled' | 'reachable' | 'unreachable' | 'error'
  localDevProbeDetail?: string
}

/**
 * How we resolve and probe the public deployment URL.
 *
 * URL resolution order (first hit wins):
 * - `NEXT_PUBLIC_SITE_URL` — canonical public site
 * - `VERCEL_URL` — Vercel deployment host (https prepended when missing)
 * - `DEPLOY_PRIME_URL` or `URL` — Netlify primary / alias URL
 *
 * Production HTTP probe runs only when **both**:
 * - `NEXT_PUBLIC_SITE_URL` is set (strict gate; avoids treating preview hosts as “the” production site)
 * - `DEPLOY_STATUS_PROBE_PRODUCTION=1`
 */
export type ProductionConfig = {
  candidateUrl: string | null
  /** Which env keys contributed to `candidateUrl` (no values) */
  urlSources: string[]
  productionReachable: 'not_probed' | 'reachable' | 'unreachable' | 'error'
  productionProbeDetail?: string
}

export type EnvVarPresence = {
  name: string
  present: boolean
}

export type DeploymentBlocker = {
  id: string
  message: string
  severity: 'blocking' | 'warning'
}

export type EnvReadinessGroupSummary = {
  groupId: string
  label: string
  required: EnvVarPresence[]
  optional: EnvVarPresence[]
}

export type EnvReadinessResponse = {
  source: 'process.env'
  groups: EnvReadinessGroupSummary[]
}

export type DeployEngineSummary = {
  id: string
  category: string
  configured: boolean
  reachable: boolean
  functional: boolean
}

export type DeployInternetSummary = {
  lastChecked: string
  tavily: { apiKeyPresent: boolean; status: string; notes: string }
  firecrawl: { apiKeyPresent: boolean; status: string; notes: string }
  grok: { apiKeyPresent: boolean; status: string; notes: string }
  gemini: { apiKeyPresent: boolean; configured: boolean; reachable: boolean; notes: string }
  fetch: {
    allowed: boolean
    exampleComProbe: { status: string; notes: string }
  }
}

export type SupabaseDeployReadiness = {
  urlPresent: boolean
  anonKeyPresent: boolean
  serviceRolePresent: boolean
  /** Server-side persistence (service role) */
  serverPersistenceReady: boolean
  /** Browser client bundle can talk to Supabase */
  clientBundleReady: boolean
  /** Back-compat for workers: configured when URL + service role present */
  status: 'configured' | 'config_needed'
}

export type DeployStatusResponse = {
  awarenessOnly: true
  checkedAt: string
  provider: DeploymentProvider
  lastDeployment: string | null
  localDev: DevServerHint
  /**
   * Present only when localhost probe ran (`DEPLOY_STATUS_PROBE_LOCALHOST=1`) and GET / did not succeed.
   * Omitted when the probe is disabled so we do not imply the dev server is down.
   */
  offlineHint?: string
  production: ProductionConfig
  supabase: SupabaseDeployReadiness
  build: { hasBuildScript: boolean }
  blockers: DeploymentBlocker[]
  /** Filled by `/api/deploy/status` using request-scoped origin + engine/internet collectors */
  engines?: DeployEngineSummary[]
  internet?: DeployInternetSummary
  /** Populated by `/api/deploy/status` alongside `collectDeployStatus` */
  envReadiness?: EnvReadinessResponse
  /** Route-only marker */
  runtime?: 'nodejs'
}

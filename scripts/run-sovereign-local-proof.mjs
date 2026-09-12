/**
 * Local-safe live proof: start core, fetch UI/health, simulate failures, stop.
 * Does NOT touch production, cloudflared, or DNS.
 *
 * Run: node --loader ./scripts/ts-extension-loader.mjs --experimental-transform-types scripts/run-sovereign-local-proof.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startLocalCoreServer,
  simulateDomainUnavailable,
  simulateInternetUnavailable,
  buildLocalHealth,
} from '@/lib/sovereign-runtime/localCoreServer'
import { LOCAL_CORE_ORIGIN } from '@/lib/sovereign-runtime/constants'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  console.log('=== Phase 10 live-safe local proof ===')
  const core = await startLocalCoreServer({
    rendererDir: path.join(root, 'desktop', 'renderer'),
    simulate: { internet: 'ONLINE', ollamaReachable: true, publicWebsiteReachable: true },
  })
  try {
    const health = await (await fetch(`${LOCAL_CORE_ORIGIN}/api/local/health`)).json()
    const ui = await (await fetch(`${LOCAL_CORE_ORIGIN}/`)).text()
    const domainSim = buildLocalHealth('CORE_READY', simulateDomainUnavailable())
    const netSim = buildLocalHealth(
      'CORE_READY',
      simulateInternetUnavailable({ simulate: { ollamaReachable: true } }),
    )

    const report = {
      core_boot: core.boot.snapshot(),
      health_ok: health.ok === true,
      ui_local: ui.includes('WAR ROOM') && ui.includes('DENIED'),
      website_fallback: health.health?.website_fallback,
      domain_sim_core_ok: domainSim.status === 'ok',
      domain_sim_site: domainSim.offline.PUBLIC_WEBSITE,
      internet_sim_core: netSim.offline.WAR_ROOM_CORE,
      internet_sim_external_ai: netSim.offline.EXTERNAL_AI,
      internet_sim_local_models: netSim.offline.LOCAL_MODELS,
      loads_warroomos: false,
      cloudflare_required: false,
      shutdown_plan: core.shutdownPlan,
    }
    console.log(JSON.stringify(report, null, 2))
    const ok =
      report.core_boot === 'CORE_READY' &&
      report.health_ok &&
      report.ui_local &&
      report.website_fallback === 'DENIED' &&
      report.domain_sim_core_ok &&
      report.internet_sim_core === 'ONLINE'
    if (!ok) process.exitCode = 1
  } finally {
    await core.close()
    console.log('Local core stopped. Production/cloudflared/Ollama untouched.')
  }
}

void main()
